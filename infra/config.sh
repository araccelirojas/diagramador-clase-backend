#!/usr/bin/env bash
# Ajustes de los scripts de DESPLIEGUE (aws-deploy.sh y logs.sh).
#
# aws-up.sh y aws-down.sh no leen esto: son autocontenidos a proposito, para
# poder ejecutarlos desde fuera del repositorio. Pero los valores compartidos
# tienen que coincidir con los suyos, porque los recursos se localizan por
# nombre: PROJECT, AWS_REGION, APP_DOMAIN y WEB_VOLUME.

PROJECT="${PROJECT:-diagramador}"
STACK="${STACK:-${PROJECT}}"

AWS_REGION="${AWS_REGION:-us-east-1}"

# Dominio unico: la aplicacion en / y la API en /api, misma instancia.
APP_DOMAIN="${APP_DOMAIN:-galflabs.tech}"

ECR_REPO="${ECR_REPO:-${STACK}-backend}"
INSTANCE_NAME="${INSTANCE_NAME:-${STACK}}"

# Volumen de Docker donde el frontend deja su build. Punto de encuentro entre
# los dos despliegues.
WEB_VOLUME="${WEB_VOLUME:-${PROJECT}_web}"

POSTGRES_USER="${POSTGRES_USER:-diagramador}"
POSTGRES_DB="${POSTGRES_DB:-diagramador}"

# Directorio de la instancia donde vive el stack.
REMOTE_DIR="${REMOTE_DIR:-/opt/${PROJECT}}"

# Secretos para desplegar a mano. En el CI no existe: los valores llegan por
# el entorno desde los secretos de GitHub.
ENV_FILE="${ENV_FILE:-.env.deploy}"

TAG_KEY="Project"
TAG_VALUE="${STACK}"
