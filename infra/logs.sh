#!/usr/bin/env bash
#
# Logs del stack que corre en la instancia, sin abrir SSH.
#
#   ./infra/logs.sh              ultimas 100 lineas de todo
#   ./infra/logs.sh app 300      ultimas 300 lineas de un servicio (app, db, caddy)

cd "$(dirname "$0")/.."
source infra/config.sh
source infra/lib.sh

check_aws

SERVICIO="${1:-}"
LINEAS="${2:-100}"

INSTANCE_ID="$(find_instance)"
[ -n "$INSTANCE_ID" ] || die "no encuentro la instancia '$INSTANCE_NAME'"

printf 'cd %s && docker compose ps && echo "--- logs ---" && docker compose logs --tail=%s --no-color %s\n' \
  "$REMOTE_DIR" "$LINEAS" "$SERVICIO" \
  | ssm_run "$INSTANCE_ID" "logs ${SERVICIO:-todos}"
