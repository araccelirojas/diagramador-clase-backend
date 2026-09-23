#!/usr/bin/env bash
#
# Crea la infraestructura del diagramador en AWS. SOLO la infraestructura.
#
#   ./infra/aws-up.sh                crea todo y te dice como configurar el CI
#   ./infra/aws-up.sh --esperar-dns  ademas, espera a que el dominio resuelva
#
# No compila nada, no construye imagenes y no despliega: de eso se encargan
# los pipelines de cada repositorio. Por eso no depende del codigo de ninguna
# de las dos aplicaciones, ni necesita Docker ni Node instalados. Lo unico que
# hace falta es la CLI de AWS.
#
# Vive en el repositorio del backend por comodidad, pero podrias moverlo a
# cualquier sitio: lo unico que toca son recursos de AWS.
#
# Es idempotente: si algo falla a la mitad, vuelve a lanzarlo y solo crea lo
# que falte. Lo que construye:
#
#   ECR                dos repositorios, uno por imagen (backend y frontend)
#   IAM                rol de instancia (SSM + lectura de ECR) y su perfil
#   Security Group     80 y 443 abiertos; el 22 se queda cerrado, se entra por SSM
#   Elastic IP         IP fija, para que el registro DNS no cambie al reiniciar
#   EC2                una instancia con Docker, Docker Compose y 2 GB de swap
#   Route 53           el registro A, SOLO si el dominio esta alojado ahi
#
# La instancia queda vacia y esperando. El primer push a main del backend le
# enviara el docker-compose.yml, el Caddyfile y el .env, y levantara el stack.

cd "$(dirname "$0")/.."
source infra/config.sh
source infra/lib.sh

ESPERAR_DNS=0
for arg in "$@"; do
  case "$arg" in
    --esperar-dns) ESPERAR_DNS=1 ;;
    *) die "opcion desconocida: $arg" ;;
  esac
done

check_aws

ACCOUNT="$(account_id)"
log "Cuenta $ACCOUNT, region $AWS_REGION, stack $STACK"

# ---------------------------------------------------------------------------
# 1. Secretos
# ---------------------------------------------------------------------------
# Generarlos aqui no es desplegar: son las credenciales de los recursos que
# este script crea, y sin ellas no se puede configurar el CI. Salen de
# openssl, no del codigo de la aplicacion.
if [ ! -f "$ENV_FILE" ]; then
  log "Generando $ENV_FILE con secretos nuevos"
  cat > "$ENV_FILE" <<ENVEOF
# Secretos del despliegue. Generado por infra/aws-up.sh.
# NO subir a git: ya esta en .gitignore.
#
# Estos dos valores van tambien en los secretos del repositorio del backend
# en GitHub. Tienen que coincidir: PostgreSQL crea su usuario con la
# contrasena del primer despliegue y despues ya no la cambia.

POSTGRES_PASSWORD=$(rand_hex 24)
JWT_SECRET=$(rand_hex 48)

JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=10

# Lectura de bocetos y agente de voz. Sin clave, esos dos endpoints responden
# 503 y el resto de la API sigue funcionando con normalidad.
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_TIMEOUT_MS=90000
OPENAI_VOZ_MODELO=gpt-realtime-2.1-mini
OPENAI_VOZ=marin

BOCETO_MAX_BYTES=10485760
AUTOSAVE_INTERVAL_MS=15000
AUTO_MIGRATE=true
ENVEOF
  ok "$ENV_FILE creado"
else
  skip "$ENV_FILE ya existe, se respeta"
fi

# ---------------------------------------------------------------------------
# 2. ECR: un repositorio por aplicacion
# ---------------------------------------------------------------------------
# Se crean vacios. Los llenan los pipelines en su primer push.
ensure_ecr "$ECR_REPO"
ensure_ecr "$ECR_REPO_FRONTEND"

# ---------------------------------------------------------------------------
# 3. Rol de instancia
# ---------------------------------------------------------------------------
if ! aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  log "Creando rol IAM $ROLE_NAME"
  TRUST_TMP="$(mktemp)"
  cat > "$TRUST_TMP" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow",
"Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  aws iam create-role --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://$TRUST_TMP" \
    --tags "Key=$TAG_KEY,Value=$TAG_VALUE" >/dev/null
  rm -f "$TRUST_TMP"
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
[ -n "$VPC_ID" ] || die "no hay VPC por defecto en $AWS_REGION. Creala en la consola (VPC > Acciones > Crear VPC predeterminada)."
SUBNET_ID="$(find_subnet "$VPC_ID")"
[ -n "$SUBNET_ID" ] || die "no hay subred publica en $VPC_ID"
ok "VPC $VPC_ID, subred $SUBNET_ID"

SG_ID="$(find_sg)"
if [ -z "$SG_ID" ]; then
  log "Creando security group $SG_NAME"
  SG_ID="$(awsc ec2 create-security-group \
    --group-name "$SG_NAME" \
    --description "HTTP y HTTPS para $STACK" \
    --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_NAME},{Key=$TAG_KEY,Value=$TAG_VALUE}]" \
    --query 'GroupId' --output text)"
  ok "security group $SG_ID"
else
  skip "security group $SG_ID ya existe"
fi

# El 80 no es decorativo: Let's Encrypt valida el dominio por HTTP-01 y Caddy
# lo usa ademas para redirigir a HTTPS. Sin puerto 22: se entra por SSM.
for puerto in 80 443; do
  awsc ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" --protocol tcp --port "$puerto" --cidr 0.0.0.0/0 \
    >/dev/null 2>&1 || true
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

  UD_TMP="$(mktemp)"
  cat > "$UD_TMP" <<USERDATA
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
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --subnet-id "$SUBNET_ID" \
    --security-group-ids "$SG_ID" \
    --iam-instance-profile "Name=$PROFILE_NAME" \
    --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=1" \
    --block-device-mappings "DeviceName=/dev/xvda,Ebs={VolumeSize=$ROOT_VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true}" \
    --user-data "file://$UD_TMP" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME},{Key=$TAG_KEY,Value=$TAG_VALUE}]" \
    --query 'Instances[0].InstanceId' --output text)"
  rm -f "$UD_TMP"
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
# 7. Instancia lista para recibir despliegues
# ---------------------------------------------------------------------------
wait_ssm_ready "$INSTANCE_ID"

log "Comprobando que cloud-init dejo Docker instalado"
printf '%s\n' 'cloud-init status --wait || true' 'docker --version' 'docker compose version' \
  | ssm_run "$INSTANCE_ID" "verificar Docker"

# ---------------------------------------------------------------------------
# 8. DNS
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

RESUELVE="$(resolve_host "$APP_DOMAIN")"

if [ "$DNS_MANUAL" = "1" ]; then
  # El apex se escribe "@" en casi todos los paneles; un subdominio, solo la
  # parte de la izquierda.
  case "$APP_DOMAIN" in
    *.*.*) NOMBRE_REGISTRO="${APP_DOMAIN%%.*}" ;;
    *)     NOMBRE_REGISTRO="@" ;;
  esac

  cat <<AVISO

  ${C_YELLOW}DNS: hay que tocarlo a mano${C_RESET}

  $APP_DOMAIN no esta en Route 53. Si lo tienes en Hostinger, entra en
  hPanel > Dominios > $APP_DOMAIN > DNS / Nameservers y deja los registros asi:

    Tipo    Nombre   Contenido              TTL
    ----    ------   --------------------   ----
    A       $NOMBRE_REGISTRO        $PUBLIC_IP   300
    CNAME   www      $APP_DOMAIN   300

  1. El registro A: si ya hay uno con nombre "$NOMBRE_REGISTRO", ${C_YELLOW}EDITALO${C_RESET}. No anadas
     un segundo: dos registros A para el mismo nombre reparten el trafico y la
     mitad de las visitas acabaria en el servidor equivocado.

  2. El CNAME www: dejalo o crealo. El Caddyfile tiene un bloque que redirige
     www a la raiz, asi que si borras este registro, borra tambien ese bloque
     o Caddy reintentara sacarle un certificado indefinidamente.

  3. Si tienes un registro A llamado "api" de una version anterior, ${C_YELLOW}borralo${C_RESET}.
     Con un solo dominio, la API vive en https://$APP_DOMAIN/api.

  4. Baja el TTL a 300. Con el valor por defecto de Hostinger (14400 = 4 h) un
     cambio de IP tarda horas en propagarse.

AVISO

  if [ "$RESUELVE" = "$PUBLIC_IP" ]; then
    ok "$APP_DOMAIN ya resuelve a $PUBLIC_IP: no tienes que tocar nada"
  elif [ -z "$RESUELVE" ] || [ "$RESUELVE" = "__sin_resolver__" ]; then
    warn "$APP_DOMAIN todavia no resuelve a ninguna IP"
  else
    warn "$APP_DOMAIN resuelve ahora mismo a $RESUELVE, no a $PUBLIC_IP"
  fi
fi

if [ "$ESPERAR_DNS" = "1" ]; then
  wait_dns "$APP_DOMAIN" "$PUBLIC_IP" 60 || true
fi

# ---------------------------------------------------------------------------
# 9. Que hacer ahora
# ---------------------------------------------------------------------------
cat <<FIN

  ${C_GREEN}Infraestructura lista${C_RESET}

    Instancia     $INSTANCE_ID ($INSTANCE_TYPE)
    IP publica    $PUBLIC_IP
    Dominio       https://$APP_DOMAIN
    ECR backend   $(ecr_uri "$ECR_REPO")
    ECR frontend  $(ecr_uri "$ECR_REPO_FRONTEND")
    Consola       aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION

  La instancia esta vacia: tiene Docker y nada mas. Quien la llena es el CI.

  ${C_BLUE}1.${C_RESET} Registro DNS en tu proveedor (ver arriba).

  ${C_BLUE}2.${C_RESET} Secretos en el repositorio del BACKEND
     Settings > Secrets and variables > Actions > Secrets

       AWS_ACCESS_KEY_ID       del usuario IAM de despliegue
       AWS_SECRET_ACCESS_KEY   idem
       POSTGRES_PASSWORD       el valor de $ENV_FILE
       JWT_SECRET              el valor de $ENV_FILE
       OPENAI_API_KEY          opcional

  ${C_BLUE}3.${C_RESET} Secretos en el repositorio del FRONTEND
     Los dos de AWS, la misma access key. Nada mas.

  ${C_BLUE}4.${C_RESET} Push a main en el backend, y despues en el frontend.
     El orden importa solo la primera vez: el backend es quien envia el
     docker-compose.yml y crea el volumen donde el frontend deja su build.

  Los valores de POSTGRES_PASSWORD y JWT_SECRET estan en $ENV_FILE.
  No se imprimen aqui a proposito, para que no acaben en una captura.

FIN
