#!/usr/bin/env bash
#
# Borra TODO lo que creo aws-up.sh. Incluida la base de datos.
#
#   ./aws-down.sh              pide confirmacion escribiendo el nombre
#   ./aws-down.sh --snapshot   antes de borrar, guarda una copia del disco
#   ./aws-down.sh --yes        sin preguntar (para automatizaciones)
#
# Autocontenido, como aws-up.sh: no depende de ningun otro fichero ni del
# codigo de las aplicaciones. Dejalo junto a aws-up.sh.
#
# El volumen de la instancia se borra con ella, y ahi vive PostgreSQL: sin
# --snapshot, los proyectos y los usuarios desaparecen y no hay vuelta atras.

set -euo pipefail

# ===========================================================================
# CONFIGURACION  ·  tiene que coincidir con la de aws-up.sh
# ===========================================================================
PROJECT="${PROJECT:-diagramador}"
STACK="${STACK:-${PROJECT}}"
AWS_REGION="${AWS_REGION:-us-east-1}"
APP_DOMAIN="${APP_DOMAIN:-galflabs.tech}"

ECR_REPO="${ECR_REPO:-${STACK}-backend}"
ECR_REPO_FRONTEND="${ECR_REPO_FRONTEND:-${STACK}-frontend}"
SG_NAME="${SG_NAME:-${STACK}-sg}"
ROLE_NAME="${ROLE_NAME:-${STACK}-ec2-role}"
PROFILE_NAME="${PROFILE_NAME:-${STACK}-ec2-profile}"
INSTANCE_NAME="${INSTANCE_NAME:-${STACK}}"
CI_USER="${CI_USER:-${STACK}-ci}"
REMOTE_DIR="${REMOTE_DIR:-/opt/${PROJECT}}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$DIR/.env.deploy}"
OUT_FILE="${OUT_FILE:-$DIR/credenciales-github.txt}"

TAG_KEY="Project"
TAG_VALUE="$STACK"

# ===========================================================================
# UTILIDADES
# ===========================================================================
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

awsc() { aws --region "$AWS_REGION" "$@"; }
none_to_empty() { [ "$1" = "None" ] && echo "" || echo "$1"; }

b64() {
  if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0; else base64 | tr -d '\n'; fi
}

find_instance() {
  none_to_empty "$(awsc ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
              "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[0].InstanceId | [0]' --output text)"
}

find_eip_alloc() {
  none_to_empty "$(awsc ec2 describe-addresses --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
    --query 'Addresses[0].AllocationId' --output text)"
}

find_sg() {
  none_to_empty "$(awsc ec2 describe-security-groups \
    --filters "Name=group-name,Values=$SG_NAME" \
    --query 'SecurityGroups[0].GroupId' --output text)"
}

ecr_uri() {
  none_to_empty "$(awsc ecr describe-repositories --repository-names "$1" \
    --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo None)"
}

find_hosted_zone() {
  local probe="$1" zone=''
  while [ -n "$probe" ]; do
    zone="$(awsc route53 list-hosted-zones-by-name --dns-name "$probe" \
      --query "HostedZones[?Name==\`${probe}.\`].Id | [0]" --output text 2>/dev/null || echo None)"
    zone="$(none_to_empty "$zone")"
    if [ -n "$zone" ]; then echo "${zone##*/}"; return 0; fi
    case "$probe" in *.*) probe="${probe#*.}" ;; *) break ;; esac
  done
  echo ""
}

ssm_run() {
  local id="$1" desc="${2:-comando remoto}" payload cmd_id estado
  payload="$(b64)"
  cmd_id="$(awsc ssm send-command --instance-ids "$id" \
    --document-name AWS-RunShellScript --comment "$desc" --timeout-seconds 300 \
    --parameters "commands=[\"echo $payload | base64 -d > /tmp/ssm-run.sh\",\"bash /tmp/ssm-run.sh\"]" \
    --query 'Command.CommandId' --output text)"
  for _ in $(seq 1 60); do
    estado="$(awsc ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
      --query 'Status' --output text 2>/dev/null || echo Pending)"
    case "$estado" in
      Success) ok "$desc"; return 0 ;;
      Failed|Cancelled|TimedOut) warn "$desc fallo ($estado)"; return 1 ;;
    esac
    sleep 5
  done
  warn "$desc no termino a tiempo"; return 1
}

# ===========================================================================
CON_SNAPSHOT=0
SIN_PREGUNTAR=0
for arg in "$@"; do
  case "$arg" in
    --snapshot) CON_SNAPSHOT=1 ;;
    --yes|-y)   SIN_PREGUNTAR=1 ;;
    -h|--help)  sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "opcion desconocida: $arg" ;;
  esac
done

command -v aws >/dev/null 2>&1 || die "falta la CLI de AWS"
awsc sts get-caller-identity >/dev/null 2>&1 \
  || die "la CLI de AWS no tiene credenciales validas. Ejecuta: aws configure"

ACCOUNT="$(awsc sts get-caller-identity --query Account --output text)"
log "Cuenta $ACCOUNT, region $AWS_REGION, stack $STACK"

INSTANCE_ID="$(find_instance)"
ALLOC_ID="$(find_eip_alloc)"
SG_ID="$(find_sg)"

cat <<RESUMEN

  Se van a eliminar estos recursos:

    Instancia EC2       ${INSTANCE_ID:-(no existe)}
    Elastic IP          ${ALLOC_ID:-(no existe)}
    Security group      ${SG_ID:-(no existe)}
    ECR backend         ${ECR_REPO}
    ECR frontend        ${ECR_REPO_FRONTEND}
    Rol de instancia    $ROLE_NAME
    Perfil de instancia $PROFILE_NAME
    Usuario de CI       $CI_USER (con sus access keys)
    Registros DNS       $APP_DOMAIN (solo si esta en Route 53)

RESUMEN

if [ "$CON_SNAPSHOT" = "0" ]; then
  warn "sin --snapshot, la base de datos se pierde para siempre"
fi

if [ "$SIN_PREGUNTAR" = "0" ]; then
  read -r -p "  Escribe '$STACK' para confirmar: " respuesta
  [ "$respuesta" = "$STACK" ] || die "cancelado"
fi

# ---------------------------------------------------------------------------
# 1. Copia del disco, si se pidio
# ---------------------------------------------------------------------------
if [ "$CON_SNAPSHOT" = "1" ] && [ -n "$INSTANCE_ID" ]; then
  VOL_ID="$(awsc ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)"
  # Paramos los contenedores antes: un snapshot de PostgreSQL en caliente puede
  # quedar en un estado que exija recuperacion al restaurar.
  printf 'cd %s && docker compose stop || true\n' "$REMOTE_DIR" \
    | ssm_run "$INSTANCE_ID" "parar contenedores" || warn "no pude pararlos, sigo"
  log "Creando snapshot del volumen $VOL_ID"
  SNAP_ID="$(awsc ec2 create-snapshot --volume-id "$VOL_ID" \
    --description "Copia previa al borrado de $STACK" \
    --tag-specifications "ResourceType=snapshot,Tags=[{Key=Name,Value=$STACK-final},{Key=$TAG_KEY,Value=$TAG_VALUE}]" \
    --query 'SnapshotId' --output text)"
  log "Esperando a que el snapshot $SNAP_ID termine"
  awsc ec2 wait snapshot-completed --snapshot-ids "$SNAP_ID"
  ok "snapshot $SNAP_ID listo (se queda en la cuenta y factura por GB al mes)"
fi

# ---------------------------------------------------------------------------
# 2. Instancia
# ---------------------------------------------------------------------------
if [ -n "$INSTANCE_ID" ]; then
  log "Terminando $INSTANCE_ID"
  awsc ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null
  awsc ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
  ok "instancia terminada (su volumen se borro con ella)"
else
  skip "no hay instancia"
fi

# ---------------------------------------------------------------------------
# 3. Elastic IP
# ---------------------------------------------------------------------------
# Importante: una Elastic IP sin asociar factura ~3,60 USD al mes. Liberarla
# es lo que corta ese cobro, no terminar la instancia.
if [ -n "$ALLOC_ID" ]; then
  log "Liberando Elastic IP"
  awsc ec2 release-address --allocation-id "$ALLOC_ID" >/dev/null
  ok "Elastic IP liberada"
else
  skip "no hay Elastic IP"
fi

# ---------------------------------------------------------------------------
# 4. Security group
# ---------------------------------------------------------------------------
if [ -n "$SG_ID" ]; then
  log "Borrando security group $SG_ID"
  # La ENI de la instancia tarda un poco en soltarse tras el terminate.
  for intento in $(seq 1 12); do
    if awsc ec2 delete-security-group --group-id "$SG_ID" >/dev/null 2>&1; then
      ok "security group borrado"; break
    fi
    skip "todavia en uso, reintento $intento/12"
    sleep 10
  done
else
  skip "no hay security group"
fi

# ---------------------------------------------------------------------------
# 5. Perfil y rol de la instancia
# ---------------------------------------------------------------------------
if aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  log "Borrando perfil de instancia $PROFILE_NAME"
  aws iam remove-role-from-instance-profile \
    --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" >/dev/null 2>&1 || true
  aws iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  ok "perfil borrado"
else
  skip "no hay perfil de instancia"
fi

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "Borrando rol $ROLE_NAME"
  # IAM no deja borrar un rol con politicas enganchadas.
  for arn in $(aws iam list-attached-role-policies --role-name "$ROLE_NAME" \
                 --query 'AttachedPolicies[].PolicyArn' --output text); do
    aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$arn" >/dev/null
  done
  aws iam delete-role --role-name "$ROLE_NAME" >/dev/null
  ok "rol borrado"
else
  skip "no hay rol"
fi

# ---------------------------------------------------------------------------
# 6. Usuario de CI
# ---------------------------------------------------------------------------
# IAM exige dejar el usuario sin nada colgando antes de borrarlo: primero las
# access keys, luego las politicas en linea, y solo entonces el usuario.
if aws iam get-user --user-name "$CI_USER" >/dev/null 2>&1; then
  log "Borrando usuario $CI_USER"

  for k in $(aws iam list-access-keys --user-name "$CI_USER" \
               --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
    aws iam delete-access-key --user-name "$CI_USER" --access-key-id "$k" >/dev/null
    ok "access key $k borrada"
  done

  for p in $(aws iam list-user-policies --user-name "$CI_USER" \
               --query 'PolicyNames[]' --output text); do
    aws iam delete-user-policy --user-name "$CI_USER" --policy-name "$p" >/dev/null
    ok "politica $p borrada"
  done

  for arn in $(aws iam list-attached-user-policies --user-name "$CI_USER" \
                 --query 'AttachedPolicies[].PolicyArn' --output text); do
    aws iam detach-user-policy --user-name "$CI_USER" --policy-arn "$arn" >/dev/null
  done

  aws iam delete-user --user-name "$CI_USER" >/dev/null
  ok "usuario borrado"
  warn "los secretos AWS_* de los dos repositorios de GitHub ya no sirven"
else
  skip "no hay usuario de CI"
fi

# ---------------------------------------------------------------------------
# 7. ECR
# ---------------------------------------------------------------------------
for repo in "$ECR_REPO" "$ECR_REPO_FRONTEND"; do
  if [ -n "$(ecr_uri "$repo")" ]; then
    log "Borrando repositorio ECR $repo"
    awsc ecr delete-repository --repository-name "$repo" --force >/dev/null
    ok "ECR $repo borrado"
  else
    skip "no hay repositorio ECR $repo"
  fi
done

# ---------------------------------------------------------------------------
# 8. DNS
# ---------------------------------------------------------------------------
ZONE_ID="$(find_hosted_zone "$APP_DOMAIN")"
if [ -n "$ZONE_ID" ]; then
  VALOR="$(none_to_empty "$(awsc route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${APP_DOMAIN}.' && Type=='A'].ResourceRecords[0].Value | [0]" \
    --output text 2>/dev/null || echo None)")"
  if [ -n "$VALOR" ]; then
    log "Borrando el registro A de $APP_DOMAIN"
    TMP="$(mktemp)"
    printf '{"Changes":[{"Action":"DELETE","ResourceRecordSet":{"Name":"%s","Type":"A","TTL":60,"ResourceRecords":[{"Value":"%s"}]}}]}' \
      "$APP_DOMAIN" "$VALOR" > "$TMP"
    awsc route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
      --change-batch "file://$TMP" >/dev/null 2>&1 || warn "no pude borrar el registro A"
    rm -f "$TMP"
    ok "registro DNS borrado"
  else
    skip "no hay registro A que borrar"
  fi
else
  skip "$APP_DOMAIN no esta en Route 53: borra el registro A a mano en tu proveedor"
fi

cat <<FIN

  ${C_GREEN}Todo eliminado${C_RESET}

  Estos dos ficheros siguen en tu disco, con credenciales que ya no sirven
  para nada:

    $ENV_FILE
    $OUT_FILE

  aws-up.sh los regenera si vuelves a levantar el proyecto: detecta que la
  access key guardada ya no existe en IAM y crea una nueva.

FIN
