#!/usr/bin/env bash
# Ajustes compartidos por aws-up.sh, aws-deploy.sh, aws-down.sh y logs.sh.
# Todo se puede sobrescribir desde el entorno: AWS_REGION=sa-east-1 ./infra/aws-up.sh

# Prefijo de TODO lo que se crea en AWS. Los scripts encuentran los recursos
# por nombre/etiqueta a partir de aqui, asi que no hay ningun fichero de estado
# que se pueda perder ni desincronizar entre tu maquina y GitHub Actions.
PROJECT="${PROJECT:-diagramador}"
STACK="${STACK:-${PROJECT}}"

# us-east-1 es la mas barata. sa-east-1 (Sao Paulo) puede bajar la latencia
# desde Sudamerica a costa de un 20-30% mas de factura.
AWS_REGION="${AWS_REGION:-us-east-1}"

# Dominio unico: la aplicacion en / y la API en /api, sobre la misma instancia.
# Caddy saca el certificado para este nombre, asi que tiene que resolver a la
# IP de la instancia antes del despliegue.
APP_DOMAIN="${APP_DOMAIN:-galflabs.tech}"

# t3.micro entra en la capa gratuita (750 h/mes el primer ano) y aguanta el
# stack gracias a los 2 GB de swap que monta el user-data. Si notas el editor
# lento con varias salas abiertas, sube a t3.small.
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"
ROOT_VOLUME_GB="${ROOT_VOLUME_GB:-30}"

# Nombres derivados. Normalmente no hace falta tocarlos.
ECR_REPO="${ECR_REPO:-${STACK}-backend}"
# El frontend tambien viaja como imagen de ECR, aunque solo contenga ficheros
# estaticos: asi los dos repositorios despliegan con el mismo mecanismo y no
# hace falta ni un bucket intermedio ni claves SSH.
ECR_REPO_FRONTEND="${ECR_REPO_FRONTEND:-${STACK}-frontend}"
SG_NAME="${SG_NAME:-${STACK}-sg}"
ROLE_NAME="${ROLE_NAME:-${STACK}-ec2-role}"
PROFILE_NAME="${PROFILE_NAME:-${STACK}-ec2-profile}"
INSTANCE_NAME="${INSTANCE_NAME:-${STACK}}"

# Volumen de Docker donde vive el build del frontend. Tiene que coincidir con
# el WEB_VOLUME del repositorio del frontend: es el punto de encuentro entre
# los dos despliegues.
WEB_VOLUME="${WEB_VOLUME:-${PROJECT}_web}"

# Credenciales de PostgreSQL dentro de la instancia. La base no sale a
# internet, pero la contrasena se genera sola en aws-up.sh y se guarda en
# .env.deploy; no la dejes en blanco a mano.
POSTGRES_USER="${POSTGRES_USER:-diagramador}"
POSTGRES_DB="${POSTGRES_DB:-diagramador}"

# Directorio de la instancia donde vive el stack.
REMOTE_DIR="${REMOTE_DIR:-/opt/${PROJECT}}"

# Fichero local con los secretos de la aplicacion para el despliegue manual.
# Esta en .gitignore: nunca se sube.
ENV_FILE="${ENV_FILE:-.env.deploy}"

# Etiqueta comun para poder listar y borrar todo lo del proyecto.
TAG_KEY="Project"
TAG_VALUE="${STACK}"
