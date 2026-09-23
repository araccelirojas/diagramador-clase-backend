#!/usr/bin/env bash
#
# Crea desde cero toda la infraestructura del diagramador en AWS y deja un
# fichero con TODO lo que hay que pegar en los secretos de GitHub.
#
#   ./aws-up.sh                  crea todo
#   ./aws-up.sh --rotar-claves   ademas, genera una access key nueva para el CI
#   ./aws-up.sh --esperar-dns    ademas, espera a que el dominio resuelva
#
# SOLO infraestructura: no compila, no construye imagenes y no despliega. De
# eso se encargan los pipelines. Por eso este fichero no depende del codigo de
# ninguna de las dos aplicaciones, ni de ningun otro script: es autocontenido,
# lo puedes dejar donde quieras y lo unico que necesita es la CLI de AWS.
#
# Lo que construye:
#
#   ECR          dos repositorios, uno por imagen (backend y frontend)
#   IAM          rol de la instancia (SSM + lectura de ECR) y su perfil
#   IAM          usuario de CI con su access key y una politica que solo le
#                deja desplegar en ESTA instancia
#   SG           80 y 443 abiertos; el 22 cerrado, se entra por SSM
#   Elastic IP   IP fija, para que el registro DNS no cambie al reiniciar
#   EC2          una instancia con Docker, Docker Compose y 2 GB de swap
#   Route 53     los registros, SOLO si el dominio esta alojado ahi
#
# Deja dos ficheros junto a si mismo:
#
#   .env.deploy                secretos de la aplicacion
#   credenciales-github.txt    todo lo que va en GitHub, listo para copiar
#
# Los dos contienen credenciales en claro. No los subas a git.
#
# Es idempotente: si algo falla a la mitad, vuelve a lanzarlo y solo crea lo
# que falte. La instancia queda vacia, con Docker y nada mas: quien la llena
# es el primer push a main.

set -euo pipefail

# ===========================================================================
# CONFIGURACION
# ===========================================================================
# Todo se puede sobrescribir desde el entorno:
#   AWS_REGION=sa-east-1 APP_DOMAIN=otro.com ./aws-up.sh
#
# Si cambias PROJECT, AWS_REGION, APP_DOMAIN o WEB_VOLUME, cambialos tambien
# en el infra/config.sh de los dos repositorios: los scripts de despliegue
# localizan los recursos por estos mismos nombres.

PROJECT="${PROJECT:-diagramador}"
STACK="${STACK:-${PROJECT}}"

# us-east-1 es la region mas barata. sa-east-1 (Sao Paulo) puede bajar la
# latencia desde Sudamerica a cambio de un 20-30% mas de factura.
AWS_REGION="${AWS_REGION:-us-east-1}"

# Dominio unico: la aplicacion en / y la API en /api, sobre la misma instancia.
APP_DOMAIN="${APP_DOMAIN:-galflabs.tech}"

# t3.micro entra en la capa gratuita (750 h/mes el primer ano) y aguanta el
# stack gracias a los 2 GB de swap que monta el user-data.
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
ROOT_VOLUME_GB="${ROOT_VOLUME_GB:-30}"

# Nombres derivados. Normalmente no hace falta tocarlos.
ECR_REPO="${ECR_REPO:-${STACK}-backend}"
ECR_REPO_FRONTEND="${ECR_REPO_FRONTEND:-${STACK}-frontend}"
SG_NAME="${SG_NAME:-${STACK}-sg}"
ROLE_NAME="${ROLE_NAME:-${STACK}-ec2-role}"
PROFILE_NAME="${PROFILE_NAME:-${STACK}-ec2-profile}"
INSTANCE_NAME="${INSTANCE_NAME:-${STACK}}"
CI_USER="${CI_USER:-${STACK}-ci}"
CI_POLICY="${CI_POLICY:-${STACK}-ci-deploy}"

# Volumen de Docker donde el pipeline del frontend deja su build.
WEB_VOLUME="${WEB_VOLUME:-${PROJECT}_web}"

# PostgreSQL vive dentro de la instancia y no sale a internet.
POSTGRES_USER="${POSTGRES_USER:-diagramador}"
POSTGRES_DB="${POSTGRES_DB:-diagramador}"

# Directorio de la instancia donde el pipeline dejara el stack.
REMOTE_DIR="${REMOTE_DIR:-/opt/${PROJECT}}"

# Repositorios de GitHub, para los comandos de `gh` del fichero final.
GH_REPO_BACKEND="${GH_REPO_BACKEND:-araccelirojas/diagramador-clase-backend}"
GH_REPO_FRONTEND="${GH_REPO_FRONTEND:-araccelirojas/diagramador-clase-frontend}"

# Los ficheros de salida van junto a este script, no en el directorio desde el
# que lo lanzas: asi siempre sabes donde quedaron.
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

need() { command -v "$1" >/dev/null 2>&1 || die "falta el comando '$1'. ${2:-}"; }

# Todas las llamadas a AWS pasan por aqui para no repetir la region.
awsc() { aws --region "$AWS_REGION" "$@"; }

# "None" es lo que devuelve la CLI con --output text cuando no encuentra nada.
none_to_empty() { [ "$1" = "None" ] && echo "" || echo "$1"; }

b64() {
  if base64 --help 2>&1 | grep -q -- '-w'; then base64 -w0; else base64 | tr -d '\n'; fi
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "${1:-32}"
  else node -e "console.log(require('crypto').randomBytes(${1:-32}).toString('hex'))"; fi
}

leer_env()    { [ -f "$ENV_FILE" ] || return 0; sed -n "s/^$1=//p" "$ENV_FILE" | head -1; }
leer_salida() { [ -f "$OUT_FILE" ] || return 0; sed -n "s/^ *$1=//p" "$OUT_FILE" | head -1; }

# --- Busqueda de recursos, siempre por nombre o etiqueta ---------------------
# No hay fichero de estado: cualquier maquina con credenciales encuentra lo
# mismo, y borrar el directorio no deja recursos huerfanos.

find_vpc() {
  none_to_empty "$(awsc ec2 describe-vpcs --filters Name=isDefault,Values=true \
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
  none_to_empty "$(awsc ec2 describe-addresses --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
    --query 'Addresses[0].AllocationId' --output text)"
}

ecr_uri() {
  none_to_empty "$(awsc ecr describe-repositories --repository-names "$1" \
    --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo None)"
}

# Crea el repositorio si falta y le pone la politica de ciclo de vida. Sin ella
# cada push deja una capa huerfana y el repositorio crece sin limite.
ensure_ecr() {
  local repo="$1" pol
  if [ -z "$(ecr_uri "$repo")" ]; then
    log "Creando repositorio ECR $repo"
    awsc ecr create-repository --repository-name "$repo" \
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

# --- DNS --------------------------------------------------------------------

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

dns_upsert() {
  local tmp; tmp="$(mktemp)"
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

wait_dns() {
  local host="$1" want="$2" got=''
  log "Esperando a que $host resuelva a $want"
  for _ in $(seq 1 "${3:-60}"); do
    got="$(resolve_host "$host")"
    if [ "$got" = "__sin_resolver__" ]; then
      warn "sin dig ni nslookup: no puedo comprobar el DNS"; return 0
    fi
    if [ "$got" = "$want" ]; then ok "$host -> $want"; return 0; fi
    skip "$host resuelve a '${got:-nada}', reintento en 10s"
    sleep 10
  done
  warn "$host todavia no resuelve a $want"
  return 1
}

# --- SSM: comandos dentro de la instancia sin abrir el puerto 22 -------------

wait_ssm_ready() {
  local id="$1" n
  log "Esperando a que $id se registre en SSM"
  for _ in $(seq 1 60); do
    n="$(awsc ssm describe-instance-information --filters "Key=InstanceIds,Values=$id" \
      --query 'length(InstanceInformationList)' --output text 2>/dev/null || echo 0)"
    if [ "$n" = "1" ]; then ok "instancia registrada en SSM"; return 0; fi
    sleep 10
  done
  die "la instancia no aparece en SSM. Revisa el rol $ROLE_NAME y su salida a internet."
}

# Ejecuta por stdin un script de shell completo dentro de la instancia. Va en
# base64 para no pelearse con el escapado de JSON de la CLI.
ssm_run() {
  local id="$1" desc="${2:-comando remoto}" payload cmd_id estado
  payload="$(b64)"
  cmd_id="$(awsc ssm send-command --instance-ids "$id" \
    --document-name AWS-RunShellScript --comment "$desc" --timeout-seconds 600 \
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
        ok "$desc"; return 0 ;;
      Failed|Cancelled|TimedOut)
        awsc ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
          --query 'StandardErrorContent' --output text >&2
        die "$desc fallo con estado $estado" ;;
    esac
    sleep 5
  done
  die "$desc no termino en 10 minutos"
}

# ===========================================================================
# ARRANQUE
# ===========================================================================

ROTAR=0
ESPERAR_DNS=0
for arg in "$@"; do
  case "$arg" in
    --rotar-claves) ROTAR=1 ;;
    --esperar-dns)  ESPERAR_DNS=1 ;;
    -h|--help)      sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "opcion desconocida: $arg" ;;
  esac
done

need aws "Instalalo desde https://aws.amazon.com/cli/"
awsc sts get-caller-identity >/dev/null 2>&1 \
  || die "la CLI de AWS no tiene credenciales validas. Ejecuta: aws configure"

ACCOUNT="$(awsc sts get-caller-identity --query Account --output text)"
log "Cuenta $ACCOUNT, region $AWS_REGION, stack $STACK"

# ---------------------------------------------------------------------------
# 1. Secretos de la aplicacion
# ---------------------------------------------------------------------------
# Generarlos aqui no es desplegar: son las credenciales de los recursos que
# este script crea, y sin ellas no se puede configurar el CI. Salen de
# openssl, no del codigo de la aplicacion.
if [ ! -f "$ENV_FILE" ]; then
  log "Generando $ENV_FILE"
  cat > "$ENV_FILE" <<ENVEOF
# Secretos de la aplicacion. Generado por aws-up.sh.
# NO subir a git.

POSTGRES_PASSWORD=$(rand_hex 24)
JWT_SECRET=$(rand_hex 48)

JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10

# Sin OPENAI_API_KEY, /api/boceto y /api/voz responden 503 y el resto de la
# API funciona con normalidad.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_TIMEOUT_MS=90000
OPENAI_VOZ_MODELO=gpt-realtime-2.1-mini
OPENAI_VOZ=marin

BOCETO_MAX_BYTES=10485760
AUTOSAVE_INTERVAL_MS=15000
AUTO_MIGRATE=true
ENVEOF
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  ok "$ENV_FILE creado"
else
  skip "$ENV_FILE ya existe, se respeta"
fi

# ---------------------------------------------------------------------------
# 2. ECR
# ---------------------------------------------------------------------------
ensure_ecr "$ECR_REPO"
ensure_ecr "$ECR_REPO_FRONTEND"

# ---------------------------------------------------------------------------
# 3. Rol de la instancia
# ---------------------------------------------------------------------------
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "Creando rol IAM $ROLE_NAME"
  TMP="$(mktemp)"
  cat > "$TMP" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
"Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TMP" \
    --tags "Key=$TAG_KEY,Value=$TAG_VALUE" >/dev/null
  rm -f "$TMP"
  ok "rol creado"
else
  skip "rol $ROLE_NAME ya existe"
fi

# SSM da la consola remota y la ejecucion de comandos; ECR read deja a la
# instancia bajarse las imagenes sin credenciales guardadas en disco.
for arn in \
  arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore \
  arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly
do
  aws iam attach-role-policy --role-name "$ROLE_NAME" --policy-arn "$arn" >/dev/null
done
ok "politicas del rol al dia"

if ! aws iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  log "Creando perfil de instancia $PROFILE_NAME"
  aws iam create-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null
  aws iam add-role-to-instance-profile \
    --instance-profile-name "$PROFILE_NAME" --role-name "$ROLE_NAME" >/dev/null
  # IAM es eventualmente consistente: si lanzamos la instancia de inmediato,
  # EC2 todavia no ve el perfil y el RunInstances falla.
  log "Esperando 15s a que IAM propague el perfil"
  sleep 15
  ok "perfil creado"
else
  skip "perfil $PROFILE_NAME ya existe"
fi

# ---------------------------------------------------------------------------
# 4. Red y Security Group
# ---------------------------------------------------------------------------
VPC_ID="$(find_vpc)"
[ -n "$VPC_ID" ] || die "no hay VPC por defecto en $AWS_REGION. Creala en la consola: VPC > Acciones > Crear VPC predeterminada."
SUBNET_ID="$(find_subnet "$VPC_ID")"
[ -n "$SUBNET_ID" ] || die "no hay subred publica en $VPC_ID"
ok "VPC $VPC_ID, subred $SUBNET_ID"

SG_ID="$(find_sg)"
if [ -z "$SG_ID" ]; then
  log "Creando security group $SG_NAME"
  SG_ID="$(awsc ec2 create-security-group --group-name "$SG_NAME" \
    --description "HTTP y HTTPS para $STACK" --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_NAME},{Key=$TAG_KEY,Value=$TAG_VALUE}]" \
    --query 'GroupId' --output text)"
  ok "security group $SG_ID"
else
  skip "security group $SG_ID ya existe"
fi

# El 80 no es decorativo: Let's Encrypt valida el dominio por HTTP-01 y Caddy
# lo usa ademas para redirigir a HTTPS. Sin puerto 22: se entra por SSM.
for puerto in 80 443; do
  awsc ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port "$puerto" --cidr 0.0.0.0/0 >/dev/null 2>&1 || true
done
ok "puertos 80 y 443 abiertos"

# ---------------------------------------------------------------------------
# 5. Instancia EC2
# ---------------------------------------------------------------------------
INSTANCE_ID="$(find_instance)"
if [ -z "$INSTANCE_ID" ]; then
  AMI_ID="$(awsc ssm get-parameter \
    --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
    --query 'Parameter.Value' --output text)"
  log "Lanzando $INSTANCE_TYPE con AMI $AMI_ID"

  TMP="$(mktemp)"
  cat > "$TMP" <<USERDATA
#!/bin/bash
set -eux

dnf update -y
dnf install -y docker

# El plugin de compose no esta en los repos de AL2023: se baja el binario.
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL -o /usr/local/lib/docker/cli-plugins/docker-compose \\
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

systemctl enable --now docker
usermod -aG docker ec2-user

# t3.micro son 1 GB de RAM y ahi conviviran Node, PostgreSQL y Caddy. Con 2 GB
# de swap el pico del arranque con migraciones deja de matar contenedores.
if [ ! -f /swapfile ]; then
  dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Donde el pipeline del backend dejara el compose, el Caddyfile y el .env.
mkdir -p $REMOTE_DIR
USERDATA

  INSTANCE_ID="$(awsc ec2 run-instances \
    --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
    --subnet-id "$SUBNET_ID" --security-group-ids "$SG_ID" \
    --iam-instance-profile "Name=$PROFILE_NAME" \
    --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=1" \
    --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$ROOT_VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true}" \
    --user-data "file://$TMP" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=$TAG_KEY,Value=$TAG_VALUE}]" \
    --query 'Instances[0].InstanceId' --output text)"
  rm -f "$TMP"
  ok "instancia $INSTANCE_ID lanzada"
else
  skip "instancia $INSTANCE_ID ya existe"
fi

log "Esperando a que la instancia este en running"
awsc ec2 wait instance-running --instance-ids "$INSTANCE_ID"
ok "instancia en running"

# ---------------------------------------------------------------------------
# 6. Elastic IP
# ---------------------------------------------------------------------------
ALLOC_ID="$(find_eip_alloc)"
if [ -z "$ALLOC_ID" ]; then
  log "Reservando Elastic IP"
  ALLOC_ID="$(awsc ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=$TAG_KEY,Value=$TAG_VALUE}]" \
    --query 'AllocationId' --output text)"
  ok "Elastic IP $ALLOC_ID"
else
  skip "Elastic IP $ALLOC_ID ya reservada"
fi

awsc ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
PUBLIC_IP="$(awsc ec2 describe-addresses --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)"
ok "IP publica $PUBLIC_IP"

# ---------------------------------------------------------------------------
# 7. Usuario IAM del CI
# ---------------------------------------------------------------------------
if ! aws iam get-user --user-name "$CI_USER" >/dev/null 2>&1; then
  log "Creando usuario IAM $CI_USER"
  aws iam create-user --user-name "$CI_USER" \
    --tags "Key=$TAG_KEY,Value=$TAG_VALUE" >/dev/null
  ok "usuario creado"
else
  skip "usuario $CI_USER ya existe"
fi

# La politica se reescribe en cada ejecucion porque lleva dentro el id de la
# instancia: si algun dia se recrea, el permiso sigue apuntando a la correcta.
# ssm:SendCommand esta limitado a ESA instancia y al documento de shell: el CI
# no puede ejecutar nada en ninguna otra maquina de la cuenta.
log "Aplicando la politica $CI_POLICY"
TMP="$(mktemp)"
cat > "$TMP" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AutenticarseEnECR",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "SubirImagenes",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": [
        "arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/$ECR_REPO",
        "arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/$ECR_REPO_FRONTEND"
      ]
    },
    {
      "Sid": "EncontrarLaInstancia",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeAddresses",
        "ssm:DescribeInstanceInformation"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DesplegarSoloEnEstaInstancia",
      "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [
        "arn:aws:ec2:$AWS_REGION:$ACCOUNT:instance/$INSTANCE_ID",
        "arn:aws:ssm:$AWS_REGION::document/AWS-RunShellScript"
      ]
    },
    {
      "Sid": "LeerElResultado",
      "Effect": "Allow",
      "Action": [
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Identificarse",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    }
  ]
}
JSON
aws iam put-user-policy --user-name "$CI_USER" \
  --policy-name "$CI_POLICY" --policy-document "file://$TMP" >/dev/null
rm -f "$TMP"
ok "politica aplicada"

# AWS solo muestra el secreto de una access key en el momento de crearla. Si
# ya existe una y no la tenemos guardada, no hay forma de recuperarla: o se
# reutiliza la del fichero anterior, o se rota.
CLAVES="$(aws iam list-access-keys --user-name "$CI_USER" \
  --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null || echo '')"

KEY_ID=""
KEY_SECRET=""
KEY_AVISO=""

# --output text separa con tabuladores: hay que normalizarlos para poder
# buscar el id rodeado de espacios.
CLAVES_NORM=" $(printf '%s' "$CLAVES" | tr '\t' ' ') "

GUARDADA_ID="$(leer_salida AWS_ACCESS_KEY_ID)"
GUARDADA_SECRET="$(leer_salida AWS_SECRET_ACCESS_KEY)"

if [ "$ROTAR" = "0" ] && [ -n "$GUARDADA_ID" ] && [ -n "$GUARDADA_SECRET" ] \
   && printf '%s' "$CLAVES_NORM" | grep -q " $GUARDADA_ID "; then
  KEY_ID="$GUARDADA_ID"
  KEY_SECRET="$GUARDADA_SECRET"
  skip "reutilizando la access key $KEY_ID de la ejecucion anterior"

elif [ "$ROTAR" = "0" ] && [ -n "$CLAVES" ]; then
  KEY_ID="$(printf '%s' "$CLAVES" | awk '{print $1}')"
  KEY_SECRET="NO_RECUPERABLE"
  KEY_AVISO="si"
  warn "$CI_USER ya tiene access key y AWS no deja recuperar su secreto"
  warn "vuelve a lanzar el script con --rotar-claves para generar una nueva"

else
  for k in $CLAVES; do
    aws iam delete-access-key --user-name "$CI_USER" --access-key-id "$k" >/dev/null
    warn "access key $k borrada: deja de funcionar ahora mismo"
  done
  log "Creando access key para $CI_USER"
  CREDS="$(aws iam create-access-key --user-name "$CI_USER" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)"
  KEY_ID="$(printf '%s' "$CREDS" | cut -f1)"
  KEY_SECRET="$(printf '%s' "$CREDS" | cut -f2)"
  ok "access key $KEY_ID creada"
fi

# ---------------------------------------------------------------------------
# 8. Instancia lista para recibir despliegues
# ---------------------------------------------------------------------------
wait_ssm_ready "$INSTANCE_ID"

log "Comprobando que cloud-init dejo Docker instalado"
printf '%s\n' 'cloud-init status --wait || true' 'docker --version' 'docker compose version' \
  | ssm_run "$INSTANCE_ID" "verificar Docker"

# ---------------------------------------------------------------------------
# 9. DNS
# ---------------------------------------------------------------------------
DNS_MANUAL=0
ZONE_ID="$(find_hosted_zone "$APP_DOMAIN")"
if [ -n "$ZONE_ID" ]; then
  log "Creando registros en Route 53 (zona $ZONE_ID)"
  dns_upsert "$ZONE_ID" "$APP_DOMAIN" A "$PUBLIC_IP"
  dns_upsert "$ZONE_ID" "www.$APP_DOMAIN" CNAME "$APP_DOMAIN"
  ok "$APP_DOMAIN y www -> $PUBLIC_IP"
else
  DNS_MANUAL=1
fi

# El apex se escribe "@" en casi todos los paneles; un subdominio, solo la
# parte de la izquierda.
case "$APP_DOMAIN" in
  *.*.*) NOMBRE_REGISTRO="${APP_DOMAIN%%.*}" ;;
  *)     NOMBRE_REGISTRO="@" ;;
esac

RESUELVE="$(resolve_host "$APP_DOMAIN")"
if [ "$RESUELVE" = "$PUBLIC_IP" ]; then
  DNS_ESTADO="ya resuelve a $PUBLIC_IP: correcto"
elif [ -z "$RESUELVE" ] || [ "$RESUELVE" = "__sin_resolver__" ]; then
  DNS_ESTADO="todavia no resuelve a ninguna IP"
else
  DNS_ESTADO="resuelve a $RESUELVE, deberia resolver a $PUBLIC_IP"
fi

if [ "$DNS_MANUAL" = "1" ]; then
  if [ "$RESUELVE" = "$PUBLIC_IP" ]; then
    ok "DNS: $DNS_ESTADO"
  else
    warn "DNS: $DNS_ESTADO (ver $OUT_FILE)"
  fi
fi

if [ "$ESPERAR_DNS" = "1" ]; then
  wait_dns "$APP_DOMAIN" "$PUBLIC_IP" 60 || true
fi

# ---------------------------------------------------------------------------
# 10. El fichero con todo lo que va a GitHub
# ---------------------------------------------------------------------------
POSTGRES_PASSWORD="$(leer_env POSTGRES_PASSWORD)"
JWT_SECRET="$(leer_env JWT_SECRET)"
OPENAI_API_KEY="$(leer_env OPENAI_API_KEY)"
[ -n "$OPENAI_API_KEY" ] || OPENAI_API_KEY="(opcional: pon tu clave o no crees el secreto)"

log "Escribiendo $OUT_FILE"
cat > "$OUT_FILE" <<SALIDA
===============================================================================
 $STACK  ·  secretos y variables de GitHub
 Generado por aws-up.sh el $(date '+%Y-%m-%d %H:%M')
 Cuenta AWS $ACCOUNT · region $AWS_REGION

 CONTIENE CREDENCIALES EN CLARO. No lo subas a git ni lo pegues en un chat.
===============================================================================

RECURSOS CREADOS
--------------------------------------------------------------------------------
  Instancia EC2       $INSTANCE_ID ($INSTANCE_TYPE)
  IP publica          $PUBLIC_IP
  Dominio             https://$APP_DOMAIN
  Security group      $SG_ID
  Rol de instancia    $ROLE_NAME
  Usuario de CI       $CI_USER
  ECR backend         $(ecr_uri "$ECR_REPO")
  ECR frontend        $(ecr_uri "$ECR_REPO_FRONTEND")
  Consola remota      aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION


PASO 1 · DNS
--------------------------------------------------------------------------------
  Estado ahora mismo: $APP_DOMAIN $DNS_ESTADO

  En el panel de tu proveedor (Hostinger: hPanel > Dominios > $APP_DOMAIN > DNS),
  los registros tienen que quedar exactamente asi:

    Registro 1
      Tipo:       A
      Nombre:     $NOMBRE_REGISTRO
      Contenido:  $PUBLIC_IP
      TTL:        300

    Registro 2
      Tipo:       CNAME
      Nombre:     www
      Contenido:  $APP_DOMAIN
      TTL:        300

  - Si ya existe un registro A con nombre "$NOMBRE_REGISTRO", EDITALO. No anadas un
    segundo: dos registros A para el mismo nombre reparten el trafico y la
    mitad de las visitas acabaria en el servidor equivocado.
  - Borra cualquier registro A llamado "api" de versiones anteriores. Con un
    solo dominio, la API vive en https://$APP_DOMAIN/api.
  - Si el registro vuelve solo a una IP que no es la tuya, el dominio esta
    atado a un plan de hosting: desvinculalo en hPanel > Sitios web.
  - No toques los registros MX ni TXT si usas el correo de ese dominio.
  - No hace falta activar SSL en el panel: el certificado lo emite Caddy en el
    primer despliegue.


PASO 2 · REPOSITORIO DEL BACKEND
--------------------------------------------------------------------------------
  $GH_REPO_BACKEND
  Settings > Secrets and variables > Actions

  --- Secrets (pestana Secrets) ---

  AWS_ACCESS_KEY_ID=$KEY_ID
  AWS_SECRET_ACCESS_KEY=$KEY_SECRET
  POSTGRES_PASSWORD=$POSTGRES_PASSWORD
  JWT_SECRET=$JWT_SECRET
  OPENAI_API_KEY=$OPENAI_API_KEY

  --- Variables (pestana Variables) ---
  Opcionales: el workflow ya trae estos mismos valores por defecto.

  AWS_REGION=$AWS_REGION
  APP_DOMAIN=$APP_DOMAIN
  JWT_EXPIRES_IN=$(leer_env JWT_EXPIRES_IN)
  BCRYPT_ROUNDS=$(leer_env BCRYPT_ROUNDS)
  OPENAI_MODEL=$(leer_env OPENAI_MODEL)
  OPENAI_VOZ_MODELO=$(leer_env OPENAI_VOZ_MODELO)
  OPENAI_VOZ=$(leer_env OPENAI_VOZ)
  AUTOSAVE_INTERVAL_MS=$(leer_env AUTOSAVE_INTERVAL_MS)


PASO 3 · REPOSITORIO DEL FRONTEND
--------------------------------------------------------------------------------
  $GH_REPO_FRONTEND
  Settings > Secrets and variables > Actions

  --- Secrets ---
  La MISMA access key que el backend. El frontend no lleva mas secretos: todo
  lo que entra en el bundle es publico, lo lee cualquiera con el inspector.

  AWS_ACCESS_KEY_ID=$KEY_ID
  AWS_SECRET_ACCESS_KEY=$KEY_SECRET

  --- Variables ---

  AWS_REGION=$AWS_REGION
  APP_DOMAIN=$APP_DOMAIN
  VITE_API_URL=/api


PASO 4 · PRIMER DESPLIEGUE
--------------------------------------------------------------------------------
  1. Push a main en el BACKEND. Espera a que termine su pipeline: es quien
     envia el docker-compose.yml y el Caddyfile a la instancia, levanta
     PostgreSQL y crea el volumen "$WEB_VOLUME".
  2. Push a main en el FRONTEND.

  El orden solo importa esta primera vez. Despues, cada uno despliega cuando
  quiera sin coordinarse con el otro.


ATAJO CON LA CLI DE GITHUB
--------------------------------------------------------------------------------
  Con "gh auth login" hecho, esto deja los dos repositorios configurados:

gh secret set AWS_ACCESS_KEY_ID     --repo $GH_REPO_BACKEND  --body '$KEY_ID'
gh secret set AWS_SECRET_ACCESS_KEY --repo $GH_REPO_BACKEND  --body '$KEY_SECRET'
gh secret set POSTGRES_PASSWORD     --repo $GH_REPO_BACKEND  --body '$POSTGRES_PASSWORD'
gh secret set JWT_SECRET            --repo $GH_REPO_BACKEND  --body '$JWT_SECRET'
gh variable set AWS_REGION          --repo $GH_REPO_BACKEND  --body '$AWS_REGION'
gh variable set APP_DOMAIN          --repo $GH_REPO_BACKEND  --body '$APP_DOMAIN'

gh secret set AWS_ACCESS_KEY_ID     --repo $GH_REPO_FRONTEND --body '$KEY_ID'
gh secret set AWS_SECRET_ACCESS_KEY --repo $GH_REPO_FRONTEND --body '$KEY_SECRET'
gh variable set AWS_REGION          --repo $GH_REPO_FRONTEND --body '$AWS_REGION'
gh variable set APP_DOMAIN          --repo $GH_REPO_FRONTEND --body '$APP_DOMAIN'
gh variable set VITE_API_URL        --repo $GH_REPO_FRONTEND --body '/api'


SI ALGO SALE MAL
--------------------------------------------------------------------------------
  Logs de los contenedores, desde el repositorio del backend:
      ./infra/logs.sh          todos
      ./infra/logs.sh app 200  solo la aplicacion

  Entrar a la maquina:
      aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION
      sudo su -
      cd $REMOTE_DIR && docker compose ps

  Borrar todo:
      ./aws-down.sh --snapshot
SALIDA

chmod 600 "$OUT_FILE" 2>/dev/null || true
ok "$OUT_FILE escrito"

# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------
cat <<FIN

  ${C_GREEN}Infraestructura lista${C_RESET}

    Instancia   $INSTANCE_ID ($INSTANCE_TYPE)
    IP publica  $PUBLIC_IP
    Dominio     https://$APP_DOMAIN
    Usuario CI  $CI_USER

  Todo lo que tienes que pegar en GitHub esta aqui, con sus valores:

    ${C_BLUE}$OUT_FILE${C_RESET}

  Los secretos de la aplicacion, aqui:

    ${C_BLUE}$ENV_FILE${C_RESET}

  Ninguno de los dos se imprime en pantalla, para que no acaben en una captura.
FIN

if [ -n "$KEY_AVISO" ]; then
  cat <<AVISO
  ${C_YELLOW}Aviso:${C_RESET} el fichero lleva NO_RECUPERABLE en AWS_SECRET_ACCESS_KEY.
  El usuario $CI_USER ya tenia una access key y AWS solo muestra el secreto al
  crearla. Si no lo tienes guardado:

      ./aws-up.sh --rotar-claves

  Eso borra la clave anterior (deja de funcionar al instante) y genera una nueva.

AVISO
fi

if [ "$DNS_MANUAL" = "1" ] && [ "$RESUELVE" != "$PUBLIC_IP" ]; then
  printf '  %sSiguiente paso:%s el DNS %s. Paso 1 del fichero.\n\n' \
    "$C_YELLOW" "$C_RESET" "$DNS_ESTADO"
fi
