#!/usr/bin/env bash
#
# Borra TODO lo que crea aws-up.sh, buscandolo por nombre. Incluida la base de
# datos, que vive en el disco de la instancia.
#
#   ./infra/aws-down.sh              pide confirmacion escribiendo el nombre
#   ./infra/aws-down.sh --snapshot   antes de borrar, guarda una copia del disco
#   ./infra/aws-down.sh --yes        sin preguntar
#
# Sirve tambien para limpiar lo que haya quedado si aws-up.sh no pudo deshacer
# algo: lo que no existe, lo salta.

set -uo pipefail
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' AWS_PAGER=''

# Tienen que coincidir con los de aws-up.sh.
PROJECT="diagramador"
AWS_REGION="${AWS_REGION:-us-east-1}"
ECR_REPOS="$PROJECT-backend $PROJECT-frontend"
ROLE_NAME="$PROJECT-ec2-role"
PROFILE_NAME="$PROJECT-ec2-profile"
SG_NAME="$PROJECT-sg"
INSTANCE_NAME="$PROJECT"
CI_USER="$PROJECT-ci"
REMOTE_DIR="/opt/$PROJECT"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_FILE="$DIR/secretos-github.txt"

if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1;34m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; D=''; N=''
fi
log()  { printf '\n%s==>%s %s\n' "$B" "$N" "$*"; }
ok()   { printf '    %sok%s %s\n' "$G" "$N" "$*"; }
skip() { printf '    %s.. %s%s\n' "$D" "$*" "$N"; }
warn() { printf '    %s!! %s%s\n' "$Y" "$*" "$N" >&2; FALLOS=$((FALLOS + 1)); }
die()  { printf '%serror%s %s\n' "$R" "$N" "$*" >&2; exit 1; }
FALLOS=0

awsc() { aws --region "$AWS_REGION" --output text "$@" | tr -d '\r'; }
vacio() { [ -z "$1" ] || [ "$1" = "None" ]; }
archivo_cli() {
  if command -v cygpath >/dev/null 2>&1; then echo "file://$(cygpath -w "$1")"; else echo "file://$1"; fi
}

CON_SNAPSHOT=0
SIN_PREGUNTAR=0
for arg in "$@"; do
  case "$arg" in
    --snapshot) CON_SNAPSHOT=1 ;;
    --yes|-y)   SIN_PREGUNTAR=1 ;;
    -h|--help)  sed -n '2,12p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "opcion desconocida: $arg" ;;
  esac
done

command -v aws >/dev/null 2>&1 || die "falta la CLI de AWS"
ACCOUNT="$(awsc sts get-caller-identity --query Account 2>/dev/null)" \
  || die "la CLI de AWS no tiene una sesion valida. Ejecuta: aws login"

INSTANCE_ID="$(awsc ec2 describe-instances \
  --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId')"
ALLOC_IDS="$(awsc ec2 describe-addresses --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
  --query 'Addresses[].AllocationId')"
SG_IDS="$(awsc ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" \
  --query 'SecurityGroups[].GroupId')"

cat <<RESUMEN

  Cuenta $ACCOUNT, region $AWS_REGION. Se van a eliminar:

    Instancia EC2        ${INSTANCE_ID:-(no existe)}   <- con la base de datos
    Elastic IP           ${ALLOC_IDS:-(no existe)}
    Security group       ${SG_IDS:-(no existe)}
    Rol y perfil         $ROLE_NAME, $PROFILE_NAME
    Usuario del CI       $CI_USER (sus access keys dejan de servir)
    Repositorios ECR     $ECR_REPOS

RESUMEN

if [ "$CON_SNAPSHOT" = 0 ] && [ -n "$INSTANCE_ID" ]; then
  printf '  %sSin --snapshot, los proyectos y usuarios de la base se pierden para siempre.%s\n\n' "$Y" "$N"
fi
if [ "$SIN_PREGUNTAR" = 0 ]; then
  read -r -p "  Escribe '$PROJECT' para confirmar: " respuesta
  [ "$respuesta" = "$PROJECT" ] || die "cancelado, no se borro nada"
fi

# ---------------------------------------------------------------------------
# Copia del disco, si se pidio
# ---------------------------------------------------------------------------
if [ "$CON_SNAPSHOT" = 1 ] && [ -n "$INSTANCE_ID" ]; then
  log "Copia del disco de $INSTANCE_ID"
  # Parar los contenedores antes: un snapshot de PostgreSQL en caliente puede
  # pedir recuperacion al restaurarlo.
  TMP="$(mktemp)"
  printf '{"commands":["cd %s && docker compose stop || true"]}' "$REMOTE_DIR" > "$TMP"
  awsc ssm send-command --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
    --parameters "$(archivo_cli "$TMP")" >/dev/null || warn "no pude parar los contenedores, sigo"
  rm -f "$TMP"
  sleep 20
  VOL_ID="$(awsc ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId')"
  SNAP_ID="$(awsc ec2 create-snapshot --volume-id "$VOL_ID" \
    --description "Copia previa al borrado de $PROJECT" \
    --tag-specifications "ResourceType=snapshot,Tags=[{Key=Name,Value=$PROJECT-final},{Key=Project,Value=$PROJECT}]" \
    --query 'SnapshotId')" || die "no pude crear el snapshot; no se borro nada"
  printf '    esperando a que termine el snapshot %s (unos minutos)\n' "$SNAP_ID"
  awsc ec2 wait snapshot-completed --snapshot-ids "$SNAP_ID" || die "el snapshot no termino; no se borro nada"
  ok "snapshot $SNAP_ID (se queda en la cuenta y se cobra por GB al mes)"
fi

# ---------------------------------------------------------------------------
# Instancia, IP y security group (en este orden: cada uno depende del anterior)
# ---------------------------------------------------------------------------
log "Instancia EC2"
if [ -n "$INSTANCE_ID" ]; then
  if awsc ec2 terminate-instances --instance-ids $INSTANCE_ID >/dev/null \
     && awsc ec2 wait instance-terminated --instance-ids $INSTANCE_ID; then
    ok "$INSTANCE_ID terminada (su disco se borro con ella)"
  else
    warn "no pude terminar $INSTANCE_ID"
  fi
else
  skip "no hay instancia"
fi

log "Elastic IP"
for alloc in $ALLOC_IDS; do
  asoc="$(awsc ec2 describe-addresses --allocation-ids "$alloc" --query 'Addresses[0].AssociationId')"
  if ! vacio "$asoc"; then awsc ec2 disassociate-address --association-id "$asoc" >/dev/null; fi
  if awsc ec2 release-address --allocation-id "$alloc" >/dev/null; then ok "$alloc liberada"; else warn "no pude liberar $alloc"; fi
done
[ -n "$ALLOC_IDS" ] || skip "no hay Elastic IP"

log "Security group"
for sg in $SG_IDS; do
  borrado=0
  # La interfaz de red de la instancia tarda un poco en soltarse.
  for intento in $(seq 1 18); do
    if awsc ec2 delete-security-group --group-id "$sg" >/dev/null 2>&1; then borrado=1; break; fi
    skip "todavia en uso, reintento en 10s ($intento/18)"
    sleep 10
  done
  if [ "$borrado" = 1 ]; then ok "$sg borrado"; else warn "no pude borrar $sg"; fi
done
[ -n "$SG_IDS" ] || skip "no hay security group"

# ---------------------------------------------------------------------------
# IAM
# ---------------------------------------------------------------------------
log "Perfil y rol de la instancia"
if awsc iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  awsc iam remove-role-from-instance-profile --instance-profile-name "$PROFILE_NAME" \
    --role-name "$ROLE_NAME" >/dev/null 2>&1
  if awsc iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null; then
    ok "perfil $PROFILE_NAME borrado"
  else
    warn "no pude borrar el perfil $PROFILE_NAME"
  fi
else
  skip "no hay perfil"
fi
if awsc iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  for arn in $(awsc iam list-attached-role-policies --role-name "$ROLE_NAME" \
                 --query 'AttachedPolicies[].PolicyArn'); do
    awsc iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$arn" >/dev/null
  done
  if awsc iam delete-role --role-name "$ROLE_NAME" >/dev/null; then ok "rol $ROLE_NAME borrado"; else warn "no pude borrar el rol $ROLE_NAME"; fi
else
  skip "no hay rol"
fi

log "Usuario del CI"
if awsc iam get-user --user-name "$CI_USER" >/dev/null 2>&1; then
  for k in $(awsc iam list-access-keys --user-name "$CI_USER" --query 'AccessKeyMetadata[].AccessKeyId'); do
    awsc iam delete-access-key --user-name "$CI_USER" --access-key-id "$k" >/dev/null
  done
  for p in $(awsc iam list-user-policies --user-name "$CI_USER" --query 'PolicyNames[]'); do
    awsc iam delete-user-policy --user-name "$CI_USER" --policy-name "$p" >/dev/null
  done
  if awsc iam delete-user --user-name "$CI_USER" >/dev/null; then
    ok "$CI_USER borrado: los secretos AWS_* de GitHub ya no sirven"
  else
    warn "no pude borrar el usuario $CI_USER"
  fi
else
  skip "no hay usuario del CI"
fi

# ---------------------------------------------------------------------------
# ECR
# ---------------------------------------------------------------------------
log "Repositorios ECR"
for repo in $ECR_REPOS; do
  if awsc ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    if awsc ecr delete-repository --repository-name "$repo" --force >/dev/null; then ok "$repo borrado"; else warn "no pude borrar $repo"; fi
  else
    skip "no hay repositorio $repo"
  fi
done

echo
if [ "$FALLOS" = 0 ]; then
  printf '%sTodo eliminado.%s\n' "$G" "$N"
  [ -f "$OUT_FILE" ] && printf 'El archivo %s quedo con credenciales que ya no sirven: puedes borrarlo.\n' "$OUT_FILE"
  exit 0
fi
printf '%s%d cosas no se pudieron borrar (ver los !! de arriba). Vuelve a lanzar el script.%s\n' "$R" "$FALLOS" "$N"
exit 1
