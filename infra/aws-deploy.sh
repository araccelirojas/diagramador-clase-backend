#!/usr/bin/env bash
#
# Construye la imagen del backend, la sube a ECR y la pone a correr en la
# instancia.
#
#   ./infra/aws-deploy.sh            despliegue completo
#   ./infra/aws-deploy.sh --logs     ademas, imprime los logs al terminar
#
# Lo ejecuta el pipeline en cada push a main, y tambien puedes lanzarlo a mano.
# La unica diferencia es de donde salen los secretos:
#
#   en tu maquina   del fichero .env.deploy
#   en Actions      de las variables de entorno que inyectan los secretos
#
# Si una variable esta definida en el entorno, gana sobre el fichero: asi el
# pipeline no necesita ningun .env.deploy en el repositorio.
#
# Requisito: la infraestructura tiene que existir ya. La crea aws-up.sh.

cd "$(dirname "$0")/.."
source infra/config.sh
source infra/lib.sh

MOSTRAR_LOGS=0
if [ "${1:-}" = "--logs" ]; then MOSTRAR_LOGS=1; fi

check_aws

# ---------------------------------------------------------------------------
# 1. Reunir la configuracion
# ---------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  log "Leyendo secretos de $ENV_FILE"
  # Se cargan sin pisar lo que ya venga del entorno.
  while IFS= read -r linea; do
    # Ignora comentarios, lineas en blanco y cualquier cosa sin "=".
    case "$linea" in ''|\#*) continue ;; *=*) ;; *) continue ;; esac
    clave="${linea%%=*}"
    valor="${linea#*=}"
    if [ -z "${!clave:-}" ]; then export "$clave=$valor"; fi
  done < "$ENV_FILE"
else
  skip "sin $ENV_FILE: los secretos salen del entorno"
fi

: "${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD (en $ENV_FILE o en el entorno)}"
: "${JWT_SECRET:?falta JWT_SECRET (en $ENV_FILE o en el entorno)}"

INSTANCE_ID="$(find_instance)"
[ -n "$INSTANCE_ID" ] || die "no encuentro la instancia '$INSTANCE_NAME'. Ejecuta antes aws-up.sh"

REPO_URI="$(ecr_uri)"
[ -n "$REPO_URI" ] || die "no encuentro el repositorio ECR '$ECR_REPO'. Ejecuta antes aws-up.sh"

# La etiqueta es el commit: si algo sale mal se sabe exactamente que hay
# corriendo, y volver atras es apuntar al sha anterior.
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then TAG="$TAG-dirty"; fi
IMAGE="$REPO_URI:$TAG"

log "Instancia $INSTANCE_ID, imagen $IMAGE"

# ---------------------------------------------------------------------------
# 2. Construir y subir
# ---------------------------------------------------------------------------
need docker
log "Autenticando Docker contra ECR"
awsc ecr get-login-password | docker login --username AWS --password-stdin "${REPO_URI%%/*}"

# --platform explicito: EC2 es x86_64 y aqui se puede estar construyendo desde
# un portatil ARM, donde el build por defecto saldria arm64 y no arrancaria.
log "Construyendo la imagen (unos minutos la primera vez)"
docker build --platform linux/amd64 -t "$IMAGE" -t "$REPO_URI:latest" .

log "Subiendo a ECR"
docker push "$IMAGE"
docker push "$REPO_URI:latest"
ok "imagen publicada"

# ---------------------------------------------------------------------------
# 3. Preparar los ficheros que van a la instancia
# ---------------------------------------------------------------------------
REMOTE_ENV="$(cat <<ENVEOF
# Generado por infra/aws-deploy.sh. No editar a mano en la instancia:
# el siguiente despliegue lo sobrescribe.
APP_IMAGE=$IMAGE
APP_DOMAIN=$APP_DOMAIN
WEB_VOLUME=$WEB_VOLUME

POSTGRES_USER=$POSTGRES_USER
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=$POSTGRES_DB

NODE_ENV=production
PORT=3000
CORS_ORIGIN=${CORS_ORIGIN:-https://$APP_DOMAIN}

JWT_SECRET=$JWT_SECRET
JWT_EXPIRES_IN=${JWT_EXPIRES_IN:-7d}
BCRYPT_ROUNDS=${BCRYPT_ROUNDS:-10}

OPENAI_API_KEY=${OPENAI_API_KEY:-}
OPENAI_MODEL=${OPENAI_MODEL:-gpt-5.6-terra}
OPENAI_TIMEOUT_MS=${OPENAI_TIMEOUT_MS:-90000}
OPENAI_VOZ_MODELO=${OPENAI_VOZ_MODELO:-gpt-realtime-2.1-mini}
OPENAI_VOZ=${OPENAI_VOZ:-marin}

BOCETO_MAX_BYTES=${BOCETO_MAX_BYTES:-10485760}
AUTOSAVE_INTERVAL_MS=${AUTOSAVE_INTERVAL_MS:-15000}
AUTO_MIGRATE=${AUTO_MIGRATE:-true}
ENVEOF
)"

B64_ENV="$(printf '%s\n' "$REMOTE_ENV" | b64)"
B64_COMPOSE="$(b64 < deploy/docker-compose.yml)"
B64_CADDY="$(b64 < deploy/Caddyfile)"

# ---------------------------------------------------------------------------
# 4. Desplegar en la instancia
# ---------------------------------------------------------------------------
ssm_run "$INSTANCE_ID" "desplegar $TAG" <<REMOTE
set -euo pipefail
mkdir -p $REMOTE_DIR
cd $REMOTE_DIR

echo '$B64_ENV'     | base64 -d > .env
echo '$B64_COMPOSE' | base64 -d > docker-compose.yml
echo '$B64_CADDY'   | base64 -d > Caddyfile
chmod 600 .env

aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin ${REPO_URI%%/*}

docker compose pull
# --remove-orphans limpia contenedores de versiones anteriores del compose.
docker compose up -d --remove-orphans

# Las capas viejas llenan el disco de 30 GB en pocas semanas de despliegues.
docker image prune -af --filter "until=168h" || true

echo '--- estado ---'
docker compose ps
REMOTE

# ---------------------------------------------------------------------------
# 5. Comprobar que responde
# ---------------------------------------------------------------------------
log "Comprobando https://$APP_DOMAIN/api/health"
for intento in $(seq 1 30); do
  if curl -fsS --max-time 10 "https://$APP_DOMAIN/api/health" 2>/dev/null | grep -q '"ok"'; then
    ok "la API responde en https://$APP_DOMAIN/api"
    if [ "$MOSTRAR_LOGS" = "1" ]; then ./infra/logs.sh; fi
    exit 0
  fi
  skip "intento $intento/30, reintento en 10s (la primera vez Caddy tarda en emitir el certificado)"
  sleep 10
done

warn "la API no respondio a tiempo. Revisa los logs con:"
warn "  ./infra/logs.sh"
warn "o entra a la maquina: aws ssm start-session --target $INSTANCE_ID --region $AWS_REGION"
exit 1
