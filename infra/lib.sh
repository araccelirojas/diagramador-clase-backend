#!/usr/bin/env bash
# Funciones compartidas por aws-deploy.sh y logs.sh.
# No se ejecuta suelto: los otros scripts hacen `source`.

set -euo pipefail

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

log()  { printf '%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
skip() { printf '%s  ..%s %s\n' "$C_DIM" "$C_RESET" "$*"; }
warn() { printf '%s  !!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()  { printf '%serror%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "falta el comando '$1'. ${2:-}"; }

# Todas las llamadas a AWS pasan por aqui para no repetir la region.
awsc() { aws --region "$AWS_REGION" "$@"; }

# "None" es lo que devuelve la CLI con --output text cuando no encuentra nada.
none_to_empty() { [ "$1" = "None" ] && echo "" || echo "$1"; }

b64() {
  if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0; else base64 | tr -d '\n'; fi
}

check_aws() {
  need aws "Instalalo desde https://aws.amazon.com/cli/"
  awsc sts get-caller-identity >/dev/null 2>&1 \
    || die "la CLI de AWS no tiene credenciales validas. Ejecuta: aws configure"
}

# Solo instancias vivas: las terminadas siguen visibles en la API durante horas.
find_instance() {
  none_to_empty "$(awsc ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[0].InstanceId | [0]' --output text)"
}

ecr_uri() {
  none_to_empty "$(awsc ecr describe-repositories --repository-names "${1:-$ECR_REPO}" \
    --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo None)"
}

# Ejecuta por stdin un script de shell completo dentro de la instancia, sin
# abrir el puerto 22 ni guardar claves SSH. Va en base64 para no pelearse con
# el escapado de JSON de la CLI.
ssm_run() {
  local id="$1" desc="${2:-comando remoto}" payload cmd_id estado
  payload="$(b64)"

  cmd_id="$(awsc ssm send-command \
    --instance-ids "$id" \
    --document-name AWS-RunShellScript \
    --comment "$desc" \
    --timeout-seconds 600 \
    --parameters "commands=[\"echo $payload | base64 -d > /tmp/ssm-run.sh\",\"bash /tmp/ssm-run.sh\"]" \
    --query 'Command.CommandId' --output text)"

  log "SSM: $desc ($cmd_id)"
  for _ in $(seq 1 120); do
    estado="$(awsc ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
      --query 'Status' --output text 2>/dev/null || echo Pending)"
    case "$estado" in
      Success)
        awsc ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
          --query 'StandardOutputContent' --output text
        ok "$desc"
        return 0 ;;
      Failed|Cancelled|TimedOut)
        awsc ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
          --query 'StandardOutputContent' --output text >&2
        awsc ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
          --query 'StandardErrorContent' --output text >&2
        die "$desc fallo con estado $estado" ;;
    esac
    sleep 5
  done
  die "$desc no termino en 10 minutos"
}
