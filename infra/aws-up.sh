#!/usr/bin/env bash
#
# Levanta en AWS todo lo que necesitan el backend y el frontend para correr y,
# si termina bien, deja infra/secretos-github.txt con los secretos que van en
# cada repositorio de GitHub (nombre y valor), para que los pipelines
# desplieguen solos en cada push a main.
#
#   ./infra/aws-up.sh
#
# Es secuencial: muestra cada paso y, si uno falla (o lo cortas con Ctrl+C),
# se detiene, dice en que paso fallo y borra todo lo que esta ejecucion
# alcanzo a crear. La cuenta queda como estaba.
#
# Lo que crea, en este orden:
#
#   ECR         dos repositorios de imagenes: backend y frontend
#   IAM         rol y perfil de la instancia (SSM y lectura de ECR)
#   SG          puertos 80 y 443 abiertos; sin 22, se entra por SSM
#   Elastic IP  IP fija
#   EC2         t3.micro con Docker, Docker Compose y 2 GB de swap
#   IAM         usuario del CI con su access key; solo puede desplegar
#
# La aplicacion no se instala aqui: la despliegan los pipelines en cada push.
# En la instancia corren Caddy (HTTPS), la API, PostgreSQL y el build del
# frontend, todo bajo el mismo dominio.
#
# Dominio: por defecto <ip>.sslip.io, que ya resuelve a la IP de la instancia
# y tiene HTTPS sin tocar ningun DNS. Para usar un dominio propio:
#
#   APP_DOMAIN=midominio.com ./infra/aws-up.sh
#
# y apunta su registro A a la IP que imprime el script antes del primer deploy.
#
# Requisitos: AWS CLI v2 con sesion iniciada (aws login o aws configure).
# En Windows, ejecutalo desde Git Bash.

set -Eeuo pipefail

# Git Bash convierte los argumentos que empiezan por / en rutas de Windows y
# romperia cosas como /aws/service/... o 0.0.0.0/0.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' AWS_PAGER=''

# ===========================================================================
# CONFIGURACION
# ===========================================================================
PROJECT="diagramador"
AWS_REGION="${AWS_REGION:-us-east-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
DISK_GB="${DISK_GB:-20}"
APP_DOMAIN="${APP_DOMAIN:-}"

GH_REPO_BACKEND="araccelirojas/diagramador-clase-backend"
GH_REPO_FRONTEND="araccelirojas/diagramador-clase-frontend"

# Los scripts de despliegue (infra/config.sh de cada repositorio) buscan los
# recursos por estos nombres: no los cambies solo aqui.
ECR_BACKEND="$PROJECT-backend"
ECR_FRONTEND="$PROJECT-frontend"
ROLE_NAME="$PROJECT-ec2-role"
PROFILE_NAME="$PROJECT-ec2-profile"
SG_NAME="$PROJECT-sg"
INSTANCE_NAME="$PROJECT"
CI_USER="$PROJECT-ci"
CI_POLICY="$PROJECT-ci-deploy"
TAG="Key=Project,Value=$PROJECT"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_FILE="$DIR/secretos-github.txt"
TMP_DIR="$(mktemp -d)"

# La terminal de verdad, guardada: si falla un comando con la salida a
# /dev/null, el aviso del fallo y el rollback tienen que verse igual.
exec 3>&1 4>&2

# ===========================================================================
# PANTALLA
# ===========================================================================
if [ -t 1 ]; then
  R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; B=$'\033[1;34m'; D=$'\033[2m'; N=$'\033[0m'
else
  R=''; G=''; Y=''; B=''; D=''; N=''
fi

TOTAL=16
PASO=0
PASO_DESC="antes de empezar"

paso()  { PASO=$((PASO + 1)); PASO_DESC="$1"; printf '\n%s[%2d/%d]%s %s\n' "$B" "$PASO" "$TOTAL" "$N" "$1"; }
ok()    { printf '        %sok%s %s\n' "$G" "$N" "$*"; }
info()  { printf '        %s%s%s\n' "$D" "$*" "$N"; }
falla() { printf '        %s%s%s\n' "$R" "$*" "$N" >&2; exit 1; }

# Todas las llamadas a AWS pasan por aqui: fija la region y la salida en texto,
# y quita los \r que la CLI de Windows deja al final de cada linea (en Git Bash
# acabarian pegados a los ids).
awsc() { ULTIMO_AWS="aws $*"; aws --region "$AWS_REGION" --output text "$@" | tr -d '\r'; }
ULTIMO_AWS=""

# La CLI de Windows no entiende las rutas /tmp/... de Git Bash.
archivo_cli() {
  if command -v cygpath >/dev/null 2>&1; then echo "file://$(cygpath -w "$1")"; else echo "file://$1"; fi
}

vacio() { [ -z "$1" ] || [ "$1" = "None" ]; }

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1"
  else node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; fi
}

# ===========================================================================
# DESHACER SI ALGO FALLA
# ===========================================================================
# Cada recurso, nada mas crearse, apunta aqui como se borra. Si el script se
# corta, al_salir los borra en orden inverso: lo ultimo creado, primero.
DESHACER=()
PENDIENTES=()
TERMINADO=0
ERROR_EN=""

deshecho()    { printf '        %sborrado%s %s\n' "$G" "$N" "$1"; }
no_deshecho() { printf '        %sNO se pudo borrar%s %s\n' "$R" "$N" "$1"; PENDIENTES+=("$1"); }

borrar_ecr() {
  if awsc ecr delete-repository --repository-name "$1" --force >/dev/null; then
    deshecho "repositorio ECR $1"
  else
    no_deshecho "repositorio ECR $1"
  fi
}

borrar_rol() {
  local arn
  for arn in $(awsc iam list-attached-role-policies --role-name "$ROLE_NAME" \
                 --query 'AttachedPolicies[].PolicyArn' 2>/dev/null); do
    awsc iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$arn" >/dev/null
  done
  if awsc iam delete-role --role-name "$ROLE_NAME" >/dev/null; then
    deshecho "rol IAM $ROLE_NAME"
  else
    no_deshecho "rol IAM $ROLE_NAME"
  fi
}

borrar_perfil() {
  awsc iam remove-role-from-instance-profile --instance-profile-name "$PROFILE_NAME" \
    --role-name "$ROLE_NAME" >/dev/null 2>&1
  if awsc iam delete-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null; then
    deshecho "perfil de instancia $PROFILE_NAME"
  else
    no_deshecho "perfil de instancia $PROFILE_NAME"
  fi
}

# La interfaz de red de la instancia tarda un poco en soltarse tras terminarla.
borrar_sg() {
  local i
  for i in $(seq 1 18); do
    if awsc ec2 delete-security-group --group-id "$1" >/dev/null 2>&1; then
      deshecho "security group $1"; return 0
    fi
    info "el security group sigue en uso, reintento en 10s ($i/18)"
    sleep 10
  done
  no_deshecho "security group $1"
}

# Una Elastic IP sin liberar se sigue cobrando aunque no tenga instancia.
liberar_eip() {
  local i asoc
  asoc="$(awsc ec2 describe-addresses --allocation-ids "$1" \
            --query 'Addresses[0].AssociationId' 2>/dev/null)"
  if ! vacio "$asoc"; then
    awsc ec2 disassociate-address --association-id "$asoc" >/dev/null 2>&1
  fi
  for i in $(seq 1 6); do
    if awsc ec2 release-address --allocation-id "$1" >/dev/null 2>&1; then
      deshecho "Elastic IP $1"; return 0
    fi
    sleep 5
  done
  no_deshecho "Elastic IP $1"
}

terminar_instancia() {
  info "terminando la instancia $1 (1-2 minutos)"
  if awsc ec2 terminate-instances --instance-ids "$1" >/dev/null \
     && awsc ec2 wait instance-terminated --instance-ids "$1"; then
    deshecho "instancia EC2 $1 (con su disco)"
  else
    no_deshecho "instancia EC2 $1"
  fi
}

# IAM no deja borrar un usuario con claves o politicas colgando.
borrar_usuario_ci() {
  local k
  for k in $(awsc iam list-access-keys --user-name "$CI_USER" \
               --query 'AccessKeyMetadata[].AccessKeyId' 2>/dev/null); do
    awsc iam delete-access-key --user-name "$CI_USER" --access-key-id "$k" >/dev/null
  done
  awsc iam delete-user-policy --user-name "$CI_USER" --policy-name "$CI_POLICY" >/dev/null 2>&1
  if awsc iam delete-user --user-name "$CI_USER" >/dev/null; then
    deshecho "usuario IAM $CI_USER (con su access key)"
  else
    no_deshecho "usuario IAM $CI_USER"
  fi
}

al_salir() {
  local codigo=$? i
  exec 1>&3 2>&4
  rm -rf "$TMP_DIR"
  if [ "$TERMINADO" = 1 ]; then return 0; fi

  # A partir de aqui nada puede cortar la limpieza.
  trap '' INT TERM
  trap - ERR
  set +eEu
  if [ "$codigo" = 0 ]; then codigo=1; fi
  rm -f "$OUT_FILE.tmp"

  printf '\n%s==============================================================================%s\n' "$R" "$N"
  printf '%s FALLO en el paso %d/%d: %s%s\n' "$R" "$PASO" "$TOTAL" "$PASO_DESC" "$N"
  if [ "$codigo" = 130 ]; then
    printf ' Cancelado con Ctrl+C.\n'
  elif [ -n "$ERROR_EN" ]; then
    printf ' Comando que fallo: %s\n' "$(printf '%s' "$ERROR_EN" | head -1 | cut -c1-160)"
    printf ' El mensaje de AWS, si lo hay, esta justo encima de este recuadro.\n'
  fi
  printf '%s==============================================================================%s\n' "$R" "$N"

  if [ ${#DESHACER[@]} -eq 0 ]; then
    printf '\nTodavia no se habia creado nada en AWS: no hay nada que deshacer.\n'
  else
    printf '\n%sDeshaciendo lo creado (%d recursos, del ultimo al primero). No cierres la terminal.%s\n' \
      "$Y" "${#DESHACER[@]}" "$N"
    for (( i=${#DESHACER[@]}-1; i>=0; i-- )); do
      eval "${DESHACER[$i]}"
    done
    if [ ${#PENDIENTES[@]} -eq 0 ]; then
      printf '\n%sListo: se borro todo lo que esta ejecucion habia creado. La cuenta quedo como estaba.%s\n' "$G" "$N"
    else
      printf '\n%sNo se pudo borrar:%s\n' "$R" "$N"
      printf '  - %s\n' "${PENDIENTES[@]}"
      printf '\nReintentalo con ./infra/aws-down.sh --yes, que borra por nombre todo lo del proyecto.\n'
    fi
  fi
  exit "$codigo"
}

# Se queda con el primer comando que fallo. Si fue dentro de awsc, la llamada
# a AWS completa dice mas que la linea del pipe.
trap 'if [ -z "$ERROR_EN" ]; then
        if [ "${FUNCNAME[0]:-}" = awsc ]; then ERROR_EN="$ULTIMO_AWS"
        else ERROR_EN="linea $LINENO: $BASH_COMMAND"; fi
      fi' ERR
trap 'exit 130' INT TERM
trap al_salir EXIT

# ===========================================================================
# 1. CLI Y SESION
# ===========================================================================
paso "Comprobando la CLI de AWS y tu sesion"
command -v aws >/dev/null 2>&1 \
  || falla "no encuentro el comando 'aws'. Instala la AWS CLI v2 y abre una terminal nueva."
info "$(aws --version 2>&1 | tr -d '\r')"
IDENTIDAD="$(awsc sts get-caller-identity --query '[Account,Arn]')" \
  || falla "la CLI no tiene una sesion valida. Ejecuta 'aws login' (o 'aws configure') y vuelve a lanzar el script."
ACCOUNT="$(cut -f1 <<<"$IDENTIDAD")"
ok "cuenta $ACCOUNT como $(cut -f2 <<<"$IDENTIDAD")"
ok "region $AWS_REGION"

# ===========================================================================
# 2. RESTOS DE UNA EJECUCION ANTERIOR
# ===========================================================================
# Si ya existe algo con estos nombres no lo creo esta ejecucion, asi que ni se
# reutiliza ni se borra: se para antes de crear nada.
paso "Comprobando que no quede nada de una ejecucion anterior"
EXISTENTES=()
for repo in "$ECR_BACKEND" "$ECR_FRONTEND"; do
  if awsc ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1; then
    EXISTENTES+=("repositorio ECR $repo")
  fi
done
if awsc iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  EXISTENTES+=("rol IAM $ROLE_NAME")
fi
if awsc iam get-instance-profile --instance-profile-name "$PROFILE_NAME" >/dev/null 2>&1; then
  EXISTENTES+=("perfil de instancia $PROFILE_NAME")
fi
if awsc iam get-user --user-name "$CI_USER" >/dev/null 2>&1; then
  EXISTENTES+=("usuario IAM $CI_USER")
fi
SGS="$(awsc ec2 describe-security-groups --filters "Name=group-name,Values=$SG_NAME" \
         --query 'SecurityGroups[].GroupId')"
if [ -n "$SGS" ]; then EXISTENTES+=("security group $SGS"); fi
INSTANCIAS="$(awsc ec2 describe-instances \
  --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
            "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId')"
if [ -n "$INSTANCIAS" ]; then EXISTENTES+=("instancia EC2 $INSTANCIAS"); fi
IPS="$(awsc ec2 describe-addresses --filters "Name=tag:Name,Values=$INSTANCE_NAME" \
         --query 'Addresses[].PublicIp')"
if [ -n "$IPS" ]; then EXISTENTES+=("Elastic IP $IPS"); fi

if [ ${#EXISTENTES[@]} -gt 0 ]; then
  for e in "${EXISTENTES[@]}"; do info "ya existe: $e"; done
  falla "hay recursos del proyecto de una ejecucion anterior. Borralos con ./infra/aws-down.sh y vuelve a lanzar este script."
fi
ok "la cuenta esta limpia"

# ===========================================================================
# 3. RED
# ===========================================================================
paso "Buscando la VPC y la subred publica por defecto"
VPC_ID="$(awsc ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId')"
if vacio "$VPC_ID"; then
  falla "no hay VPC por defecto en $AWS_REGION. Creala en la consola: VPC > Acciones > Crear VPC predeterminada."
fi
# Ordenadas por zona: us-east-1e no tiene instancias t3 y no debe salir primera.
SUBNET_ID="$(awsc ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" Name=default-for-az,Values=true \
  --query 'sort_by(Subnets, &AvailabilityZone)[0].SubnetId')"
if vacio "$SUBNET_ID"; then falla "la VPC $VPC_ID no tiene subredes por defecto"; fi
ok "VPC $VPC_ID, subred $SUBNET_ID"

# ===========================================================================
# 4. SECRETOS DE LA APLICACION
# ===========================================================================
paso "Generando los secretos de la aplicacion"
POSTGRES_PASSWORD="$(rand_hex 24)"
JWT_SECRET="$(rand_hex 48)"
ok "POSTGRES_PASSWORD y JWT_SECRET aleatorios"

# La clave de OpenAI: la del entorno o, si no, la del .env de desarrollo.
OPENAI_API_KEY="${OPENAI_API_KEY:-}"
ORIGEN_OPENAI="la variable de entorno OPENAI_API_KEY"
if [ -z "$OPENAI_API_KEY" ] && [ -f "$DIR/../.env" ]; then
  OPENAI_API_KEY="$(awk '/^OPENAI_API_KEY=/{sub(/^[^=]*=/, ""); print; exit}' "$DIR/../.env" | tr -d '\r" ')"
  ORIGEN_OPENAI="el .env del backend"
fi
if [ -n "$OPENAI_API_KEY" ]; then
  ok "OPENAI_API_KEY tomada de $ORIGEN_OPENAI"
else
  info "sin OPENAI_API_KEY: la app funciona, pero la IA respondera 503 hasta que la agregues"
fi

# ===========================================================================
# 5-6. ECR
# ===========================================================================
# Con la politica de ciclo de vida, cada push no deja una imagen mas para
# siempre: se guardan las 5 ultimas.
crear_ecr() {
  local uri
  uri="$(awsc ecr create-repository --repository-name "$1" --tags "$TAG" \
           --query 'repository.repositoryUri')"
  DESHACER+=("borrar_ecr $1")
  awsc ecr put-lifecycle-policy --repository-name "$1" \
    --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"Conservar las 5 ultimas","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}' \
    >/dev/null
  ok "$uri"
}

paso "Creando el repositorio de imagenes del backend ($ECR_BACKEND)"
crear_ecr "$ECR_BACKEND"

paso "Creando el repositorio de imagenes del frontend ($ECR_FRONTEND)"
crear_ecr "$ECR_FRONTEND"

# ===========================================================================
# 7-8. ROL Y PERFIL DE LA INSTANCIA
# ===========================================================================
paso "Creando el rol IAM de la instancia ($ROLE_NAME)"
awsc iam create-role --role-name "$ROLE_NAME" --tags "$TAG" \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  >/dev/null
DESHACER+=("borrar_rol")
# SSM: el CI ejecuta los despliegues por aqui, sin SSH. ECR: bajar las imagenes.
awsc iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore >/dev/null
awsc iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly >/dev/null
ok "rol con permisos de SSM y de lectura de ECR"

paso "Creando el perfil de instancia ($PROFILE_NAME)"
awsc iam create-instance-profile --instance-profile-name "$PROFILE_NAME" --tags "$TAG" >/dev/null
DESHACER+=("borrar_perfil")
awsc iam add-role-to-instance-profile --instance-profile-name "$PROFILE_NAME" \
  --role-name "$ROLE_NAME" >/dev/null
ok "perfil con el rol $ROLE_NAME"

# ===========================================================================
# 9. SECURITY GROUP
# ===========================================================================
paso "Creando el security group ($SG_NAME)"
SG_ID="$(awsc ec2 create-security-group --group-name "$SG_NAME" \
  --description "HTTP y HTTPS de $PROJECT" --vpc-id "$VPC_ID" \
  --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_NAME},{$TAG}]" \
  --query 'GroupId')"
DESHACER+=("borrar_sg $SG_ID")
# El 80 lo necesita Let's Encrypt para validar el dominio, y redirige a HTTPS.
for puerto in 80 443; do
  awsc ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --protocol tcp --port "$puerto" --cidr 0.0.0.0/0 >/dev/null
done
ok "$SG_ID con los puertos 80 y 443 abiertos"

# ===========================================================================
# 10. ELASTIC IP
# ===========================================================================
paso "Reservando una IP publica fija (Elastic IP)"
EIP="$(awsc ec2 allocate-address --domain vpc \
  --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$INSTANCE_NAME},{$TAG}]" \
  --query '[AllocationId,PublicIp]')"
ALLOC_ID="$(cut -f1 <<<"$EIP")"
PUBLIC_IP="$(cut -f2 <<<"$EIP")"
DESHACER+=("liberar_eip $ALLOC_ID")
DOMINIO_PROPIO=1
if [ -z "$APP_DOMAIN" ]; then
  APP_DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  DOMINIO_PROPIO=0
fi
ok "$PUBLIC_IP ($ALLOC_ID)"
ok "la aplicacion quedara en https://$APP_DOMAIN"

# ===========================================================================
# 11. INSTANCIA
# ===========================================================================
paso "Lanzando la instancia EC2 ($INSTANCE_TYPE, Amazon Linux 2023, ${DISK_GB} GB)"
AMI_ID="$(awsc ssm get-parameter \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameter.Value')"
info "imagen $AMI_ID"

# Lo ejecuta cloud-init una sola vez, en el primer arranque. El paso 15
# comprueba que termino bien.
cat > "$TMP_DIR/user-data.sh" <<USERDATA
#!/bin/bash
set -euxo pipefail
dnf install -y docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL --retry 5 -o /usr/local/lib/docker/cli-plugins/docker-compose \\
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
systemctl enable --now docker
usermod -aG docker ec2-user
# 1 GB de RAM para Node, PostgreSQL y Caddy: con 2 GB de swap el arranque con
# migraciones no mata contenedores.
dd if=/dev/zero of=/swapfile bs=1M count=2048
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/$PROJECT
USERDATA

# Recien creado, el perfil puede tardar unos segundos en ser visible para EC2.
INSTANCE_ID=""
for intento in $(seq 1 12); do
  if INSTANCE_ID="$(awsc ec2 run-instances \
      --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
      --subnet-id "$SUBNET_ID" --security-group-ids "$SG_ID" \
      --iam-instance-profile "Name=$PROFILE_NAME" \
      --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=1" \
      --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$DISK_GB,VolumeType=gp3,DeleteOnTermination=true}" \
      --user-data "$(archivo_cli "$TMP_DIR/user-data.sh")" \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{$TAG}]" \
      --query 'Instances[0].InstanceId' 2>"$TMP_DIR/error.txt")"; then
    break
  fi
  if grep -qi 'instance profile' "$TMP_DIR/error.txt"; then
    INSTANCE_ID=""
    info "IAM todavia no propago el perfil, reintento en 10s ($intento/12)"
    sleep 10
    continue
  fi
  cat "$TMP_DIR/error.txt" >&2
  falla "AWS rechazo el lanzamiento de la instancia (mensaje arriba)"
done
if vacio "$INSTANCE_ID"; then falla "IAM no propago el perfil de la instancia en 2 minutos"; fi
DESHACER+=("terminar_instancia $INSTANCE_ID")
ok "instancia $INSTANCE_ID lanzada"

# ===========================================================================
# 12. ARRANQUE E IP
# ===========================================================================
paso "Esperando a que la instancia arranque y asociando la IP"
awsc ec2 wait instance-running --instance-ids "$INSTANCE_ID"
ok "instancia en marcha"
awsc ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
ok "IP $PUBLIC_IP asociada"

# ===========================================================================
# 13. USUARIO DEL CI
# ===========================================================================
paso "Creando el usuario IAM del CI ($CI_USER) y su access key"
awsc iam create-user --user-name "$CI_USER" --tags "$TAG" >/dev/null
DESHACER+=("borrar_usuario_ci")

# Solo puede subir imagenes a los dos repositorios del proyecto y ejecutar
# comandos en ESTA instancia. No puede crear ni borrar nada.
cat > "$TMP_DIR/politica-ci.json" <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "AutenticarseEnECR", "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken", "Resource": "*" },
    { "Sid": "SubirImagenes", "Effect": "Allow",
      "Action": [ "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage",
                  "ecr:CompleteLayerUpload", "ecr:DescribeRepositories",
                  "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
                  "ecr:PutImage", "ecr:UploadLayerPart" ],
      "Resource": [ "arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/$ECR_BACKEND",
                    "arn:aws:ecr:$AWS_REGION:$ACCOUNT:repository/$ECR_FRONTEND" ] },
    { "Sid": "EncontrarLaInstancia", "Effect": "Allow",
      "Action": [ "ec2:DescribeInstances", "ssm:DescribeInstanceInformation",
                  "sts:GetCallerIdentity" ],
      "Resource": "*" },
    { "Sid": "DesplegarSoloEnEstaInstancia", "Effect": "Allow",
      "Action": "ssm:SendCommand",
      "Resource": [ "arn:aws:ec2:$AWS_REGION:$ACCOUNT:instance/$INSTANCE_ID",
                    "arn:aws:ssm:$AWS_REGION::document/AWS-RunShellScript" ] },
    { "Sid": "LeerElResultado", "Effect": "Allow",
      "Action": [ "ssm:GetCommandInvocation", "ssm:ListCommandInvocations" ],
      "Resource": "*" }
  ]
}
JSON
awsc iam put-user-policy --user-name "$CI_USER" --policy-name "$CI_POLICY" \
  --policy-document "$(archivo_cli "$TMP_DIR/politica-ci.json")" >/dev/null
ok "politica $CI_POLICY: solo subir imagenes y desplegar en $INSTANCE_ID"

CLAVE="$(awsc iam create-access-key --user-name "$CI_USER" \
           --query 'AccessKey.[AccessKeyId,SecretAccessKey]')"
CI_KEY_ID="$(cut -f1 <<<"$CLAVE")"
CI_KEY_SECRET="$(cut -f2 <<<"$CLAVE")"
ok "access key $CI_KEY_ID"

# ===========================================================================
# 14. SSM
# ===========================================================================
paso "Esperando a que la instancia se conecte a SSM (1-3 minutos)"
CONECTADA=0
for intento in $(seq 1 60); do
  n="$(awsc ssm describe-instance-information \
         --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
         --query 'length(InstanceInformationList)' 2>/dev/null || echo 0)"
  if [ "$n" = "1" ]; then CONECTADA=1; break; fi
  if [ $((intento % 3)) = 0 ]; then info "todavia no aparece ($((intento * 10))s)"; fi
  sleep 10
done
if [ "$CONECTADA" != 1 ]; then
  falla "la instancia no se conecto a SSM en 10 minutos (sin eso los pipelines no pueden desplegar)"
fi
ok "instancia conectada: los pipelines ya pueden ejecutar comandos en ella"

# ===========================================================================
# 15. DOCKER
# ===========================================================================
paso "Esperando a que la instancia termine de instalar Docker"
cat > "$TMP_DIR/verificar.sh" <<'VERIF'
cloud-init status --wait >/dev/null 2>&1 || true
if ! systemctl is-active --quiet docker || ! docker compose version >/dev/null 2>&1; then
  echo "La instalacion no termino bien. Final de /var/log/cloud-init-output.log:"
  tail -n 30 /var/log/cloud-init-output.log
  exit 1
fi
docker --version
docker compose version
free -m | awk '/^Swap:/ {print "Swap: " $2 " MB"}'
VERIF
printf '{"commands":["echo %s | base64 -d | bash"]}' "$(base64 < "$TMP_DIR/verificar.sh" | tr -d '\n')" \
  > "$TMP_DIR/ssm.json"
CMD_ID="$(awsc ssm send-command --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "verificar Docker" \
  --parameters "$(archivo_cli "$TMP_DIR/ssm.json")" \
  --query 'Command.CommandId')"
info "comando SSM $CMD_ID"

ESTADO="Pending"
for intento in $(seq 1 90); do
  ESTADO="$(awsc ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
              --query 'Status' 2>/dev/null || echo Pending)"
  case "$ESTADO" in
    Pending|InProgress|Delayed) sleep 10 ;;
    *) break ;;
  esac
done
SALIDA="$(awsc ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
            --query '[StandardOutputContent,StandardErrorContent]' 2>/dev/null || true)"
printf '%s\n' "$SALIDA" | sed 's/[[:space:]]*$//; /^$/d; s/^/        | /'
if [ "$ESTADO" != "Success" ]; then
  falla "la instalacion de Docker en la instancia no termino bien (estado: $ESTADO)"
fi
ok "Docker y Docker Compose listos"

# ===========================================================================
# 16. SECRETOS PARA GITHUB
# ===========================================================================
paso "Escribiendo los secretos de GitHub en $OUT_FILE"

secreto() { printf '%s\n    %s\n\n' "$1" "$2"; }

if [ -n "$OPENAI_API_KEY" ]; then
  VALOR_OPENAI="$OPENAI_API_KEY"
else
  VALOR_OPENAI="(no encontre ninguna clave: crea este secreto cuando la tengas; sin ella la IA responde 503)"
fi

if [ "$DOMINIO_PROPIO" = 1 ]; then
  NOTA_DNS="ANTES del primer deploy, en el panel DNS de $APP_DOMAIN: registro A
   con nombre @ (o el subdominio) apuntando a $PUBLIC_IP. Sin eso Caddy no
   puede sacar el certificado HTTPS."
else
  NOTA_DNS="No hay que tocar ningun DNS: $APP_DOMAIN ya resuelve a $PUBLIC_IP."
fi

{
  cat <<CABECERA
================================================================================
 SECRETOS DE GITHUB - $PROJECT
 Generado el $(date '+%Y-%m-%d %H:%M') por infra/aws-up.sh
 Cuenta AWS $ACCOUNT - region $AWS_REGION

 TIENE CREDENCIALES EN CLARO: no lo subas a git ni lo compartas.
================================================================================

 Aplicacion:  https://$APP_DOMAIN
 API:         https://$APP_DOMAIN/api/health

 Donde se cargan: en cada repositorio, Settings > Secrets and variables >
 Actions > New repository secret. Copia el NOMBRE y el VALOR tal cual.


################################################################################
 BACKEND  -  $GH_REPO_BACKEND
 https://github.com/$GH_REPO_BACKEND/settings/secrets/actions
################################################################################

CABECERA
  secreto AWS_ACCESS_KEY_ID "$CI_KEY_ID"
  secreto AWS_SECRET_ACCESS_KEY "$CI_KEY_SECRET"
  secreto AWS_REGION "$AWS_REGION"
  secreto APP_DOMAIN "$APP_DOMAIN"
  secreto POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
  secreto JWT_SECRET "$JWT_SECRET"
  secreto OPENAI_API_KEY "$VALOR_OPENAI"
  cat <<FRONTEND

################################################################################
 FRONTEND  -  $GH_REPO_FRONTEND
 https://github.com/$GH_REPO_FRONTEND/settings/secrets/actions
################################################################################

FRONTEND
  secreto AWS_ACCESS_KEY_ID "$CI_KEY_ID"
  secreto AWS_SECRET_ACCESS_KEY "$CI_KEY_SECRET"
  secreto AWS_REGION "$AWS_REGION"
  secreto APP_DOMAIN "$APP_DOMAIN"
  cat <<PIE

================================================================================
 PRIMER DESPLIEGUE
================================================================================
 1. $NOTA_DNS
 2. Carga los secretos de arriba en los dos repositorios.
 3. Backend primero: push a main (o Actions > "Desplegar backend" > Run
    workflow). Espera a que termine: deja Caddy, la API y PostgreSQL
    corriendo en la instancia.
 4. Frontend despues: push a main (o "Desplegar frontend" > Run workflow).
 5. Abre https://$APP_DOMAIN

 Desde ahi, cada push a main de cualquiera de los dos repositorios se
 despliega solo.

 POSTGRES_PASSWORD no se puede cambiar despues del primer despliegue: la base
 ya se creo con esa contrasena.

================================================================================
 RECURSOS CREADOS  (para borrarlos todos: ./infra/aws-down.sh)
================================================================================
 Instancia EC2       $INSTANCE_ID ($INSTANCE_TYPE)
 IP publica          $PUBLIC_IP ($ALLOC_ID)
 Security group      $SG_ID
 Rol / perfil        $ROLE_NAME / $PROFILE_NAME
 Usuario del CI      $CI_USER
 ECR                 $ECR_BACKEND, $ECR_FRONTEND
 Consola remota      aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION
PIE
} > "$OUT_FILE.tmp"
mv "$OUT_FILE.tmp" "$OUT_FILE"
chmod 600 "$OUT_FILE" 2>/dev/null || true
ok "archivo escrito"

TERMINADO=1

cat <<FIN

${G}==============================================================================
 Infraestructura lista
==============================================================================${N}

  Aplicacion   https://$APP_DOMAIN   (responde despues del primer deploy)
  Instancia    $INSTANCE_ID  ($INSTANCE_TYPE, IP $PUBLIC_IP)

  Secretos de GitHub, separados por repositorio, con nombre y valor:

    ${B}$OUT_FILE${N}

  Siguiente paso: cargarlos en GitHub y hacer push a main, primero en el
  backend y despues en el frontend. Los pasos estan al final del archivo.
FIN
