#!/usr/bin/env bash
# Funciones compartidas por los scripts de infraestructura del backend.
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

need() {
  command -v "$1" >/dev/null 2>&1 || die "falta el comando '$1'. ${2:-}"
}

# Todas las llamadas a AWS pasan por aqui para no repetir la region.
awsc() { aws --region "$AWS_REGION" "$@"; }

# "None" es lo que devuelve la CLI con --output text cuando la consulta no
# encuentra nada. Lo tratamos como vacio para poder usar [ -z ].
none_to_empty() { [ "$1" = "None" ] && echo "" || echo "$1"; }

b64() {
  if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0; else base64 | tr -d '\n'; fi
}

rand_hex() {
  # openssl viene con Git Bash y con cualquier Linux; node es el plan B.
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}"
  else node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('hex'))"; fi
}

check_aws() {
  need aws "Instalalo desde https://aws.amazon.com/cli/"
  awsc sts get-caller-identity >/dev/null 2>&1 \
    || die "la CLI de AWS no tiene credenciales validas. Ejecuta: aws configure"
}

account_id() { awsc sts get-caller-identity --query Account --output text; }

# ---------------------------------------------------------------------------
# Busqueda de recursos por etiqueta/nombre. Sin fichero de estado: cualquier
# maquina con credenciales encuentra lo mismo.
# ---------------------------------------------------------------------------

find_vpc() {
  none_to_empty "$(awsc ec2 describe-vpcs \
    --filters Name=isDefault,Values=true \
    --query 'Vpcs[0].VpcId' --output text)"
}

find_subnet() {
  none_to_empty "$(awsc ec2 describe-subnets \
    --filters "Name=vpc-id,Values=$1" Name=map-public-ip-on-launch,Values=true \
    --query 'Subnets | sort_by(@, &AvailabilityZone) | [0].SubnetId' --output text)"
}

find_sg() {
  none_to_empty "$(awsc ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" \
    --query 'SecurityGroups[0].GroupId' --output text)"
}

# Solo instancias vivas: las terminadas siguen visibles en la API durante horas
# y si no se filtran el script cree que ya hay una y no crea nada.
find_instance() {
  none_to_empty "$(awsc ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[0].InstanceId | [0]' --output text)"
}

find_eip_alloc() {
  none_to_empty "$(awsc ec2 describe-addresses \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
    --query 'Addresses[0].AllocationId' --output text)"
}

instance_ip() {
  none_to_empty "$(awsc ec2 describe-instances --instance-ids "$1" \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)"
}

# Sin argumento devuelve el repositorio del backend; con uno, el que se pida.
ecr_uri() {
  none_to_empty "$(awsc ecr describe-repositories --repository-names "${1:-$ECR_REPO}" \
    --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo None)"
}

# Crea el repositorio si falta y le pone la politica de ciclo de vida. Sin ella
# cada push deja una capa huerfana y el repositorio crece sin limite.
ensure_ecr() {
  local repo="$1" pol
  if [ -z "$(ecr_uri "$repo")" ]; then
    log "Creando repositorio ECR $repo"
    awsc ecr create-repository \
      --repository-name "$repo" \
      --image-scanning-configuration scanOnPush=true \
      --tags "Key=$TAG_KEY,Value=$TAG_VALUE" >/dev/null
    ok "ECR $repo creado"
  else
    skip "ECR $repo ya existe"
  fi

  pol="$(mktemp)"
  cat > "$pol" <<'JSON'
{"rules":[{"rulePriority":1,"description":"Conservar solo las 5 ultimas imagenes",
"selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},
"action":{"type":"expire"}}]}
JSON
  awsc ecr put-lifecycle-policy --repository-name "$repo" \
    --lifecycle-policy-text "file://$pol" >/dev/null
  rm -f "$pol"
}

# ---------------------------------------------------------------------------
# DNS. Si el dominio esta en Route 53 se configura solo; si esta en otro
# proveedor (Hostinger, por ejemplo) el script imprime el registro exacto.
# ---------------------------------------------------------------------------

# Devuelve el hosted zone de Route 53 que cubre el dominio dado, o vacio.
# Sube nivel a nivel: api.galflabs.tech, galflabs.tech, tech.
find_hosted_zone() {
  local probe="$1" zone=''
  while [ -n "$probe" ]; do
    zone="$(awsc route53 list-hosted-zones-by-name --dns-name "$probe" \
      --query "HostedZones[?Name==\`${probe}.\`].Id | [0]" --output text 2>/dev/null || echo None)"
    zone="$(none_to_empty "$zone")"
    if [ -n "$zone" ]; then echo "${zone##*/}"; return 0; fi
    case "$probe" in
      *.*) probe="${probe#*.}" ;;
      *)   break ;;
    esac
  done
  echo ""
}

# Crea o actualiza un registro. $1 zona, $2 nombre, $3 tipo, $4 valor.
dns_upsert() {
  local tmp
  tmp="$(mktemp)"
  printf '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"%s","Type":"%s","TTL":60,"ResourceRecords":[{"Value":"%s"}]}}]}' \
    "$2" "$3" "$4" > "$tmp"
  awsc route53 change-resource-record-sets --hosted-zone-id "$1" \
    --change-batch "file://$tmp" >/dev/null
  rm -f "$tmp"
}

resolve_host() {
  if command -v dig >/dev/null 2>&1; then
    dig +short "$1" @1.1.1.1 2>/dev/null | grep -E '^[0-9.]+$' | tail -1
  elif command -v nslookup >/dev/null 2>&1; then
    nslookup "$1" 1.1.1.1 2>/dev/null | awk '/^Address: /{print $2}' | tail -1
  else
    echo "__sin_resolver__"
  fi
}

# Espera a que $1 resuelva a la IP $2. Sin esto Caddy pide el certificado antes
# de tiempo, Let's Encrypt falla el desafio HTTP-01 y aplica un rate limit.
wait_dns() {
  local host="$1" want="$2" intentos="${3:-60}" got=''
  log "Esperando a que $host resuelva a $want"
  for _ in $(seq 1 "$intentos"); do
    got="$(resolve_host "$host")"
    if [ "$got" = "__sin_resolver__" ]; then
      warn "sin dig ni nslookup: no puedo comprobar el DNS, sigo adelante"
      return 0
    fi
    if [ "$got" = "$want" ]; then ok "$host -> $want"; return 0; fi
    skip "$host resuelve a '${got:-nada}', reintento en 10s"
    sleep 10
  done
  warn "$host todavia no resuelve a $want; el certificado puede fallar"
  return 1
}

# ---------------------------------------------------------------------------
# SSM: ejecutar comandos dentro de la instancia sin abrir el puerto 22 ni
# guardar claves SSH en ningun sitio.
# ---------------------------------------------------------------------------

wait_ssm_ready() {
  local id="$1" n
  log "Esperando a que $id se registre en SSM"
  for _ in $(seq 1 60); do
    n="$(awsc ssm describe-instance-information \
      --filters "Key=InstanceIds,Values=$id" \
      --query 'length(InstanceInformationList)' --output text 2>/dev/null || echo 0)"
    if [ "$n" = "1" ]; then ok "instancia registrada en SSM"; return 0; fi
    sleep 10
  done
  die "la instancia no aparece en SSM. Revisa el rol $ROLE_NAME y su salida a internet."
}

# Ejecuta por stdin un script de shell completo dentro de la instancia.
# Viaja en base64 para no pelearse con el escapado de JSON de la CLI.
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
