#!/usr/bin/env bash
#
# Borra TODO lo que creo aws-up.sh. Incluida la base de datos.
#
#   ./infra/aws-down.sh              pide confirmacion escribiendo el nombre
#   ./infra/aws-down.sh --snapshot   antes de borrar, guarda una copia del disco
#   ./infra/aws-down.sh --yes        sin preguntar (para automatizaciones)
#
# El volumen de la instancia se borra con ella, y ahi vive PostgreSQL: sin
# --snapshot, los proyectos y los usuarios desaparecen y no hay vuelta atras.

cd "$(dirname "$0")/.."
source infra/config.sh
source infra/lib.sh

CON_SNAPSHOT=0
SIN_PREGUNTAR=0
for arg in "$@"; do
  case "$arg" in
    --snapshot) CON_SNAPSHOT=1 ;;
    --yes|-y)   SIN_PREGUNTAR=1 ;;
    *) die "opcion desconocida: $arg" ;;
  esac
done

check_aws
log "Cuenta $(account_id), region $AWS_REGION, stack $STACK"

INSTANCE_ID="$(find_instance)"
ALLOC_ID="$(find_eip_alloc)"
SG_ID="$(find_sg)"
REPO_URI="$(ecr_uri)"
REPO_URI_FE="$(ecr_uri "$ECR_REPO_FRONTEND")"

cat <<RESUMEN

  Se van a eliminar estos recursos:

    Instancia EC2       ${INSTANCE_ID:-(no existe)}
    Elastic IP          ${ALLOC_ID:-(no existe)}
    Security group      ${SG_ID:-(no existe)}
    ECR backend         ${REPO_URI:-(no existe)}
    ECR frontend        ${REPO_URI_FE:-(no existe)}
    Rol IAM             $ROLE_NAME
    Perfil de instancia $PROFILE_NAME
    Registro DNS        $APP_DOMAIN (solo si esta en Route 53)

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
  log "Creando snapshot del volumen $VOL_ID"
  # Paramos los contenedores antes: un snapshot de PostgreSQL en caliente puede
  # quedar en un estado que exija recuperacion al restaurar.
  printf 'cd %s && docker compose stop || true\n' "$REMOTE_DIR" \
    | ssm_run "$INSTANCE_ID" "parar contenedores" || warn "no pude pararlos, sigo"
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
# 5. IAM
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
# 6. ECR
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
# 7. DNS
# ---------------------------------------------------------------------------
ZONE_ID="$(find_hosted_zone "$APP_DOMAIN")"
if [ -n "$ZONE_ID" ]; then
  VALOR="$(awsc route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${APP_DOMAIN}.' && Type=='A'].ResourceRecords[0].Value | [0]" \
    --output text 2>/dev/null || echo None)"
  VALOR="$(none_to_empty "$VALOR")"
  if [ -n "$VALOR" ]; then
    log "Borrando el registro A de $APP_DOMAIN"
    TMP="$(mktemp)"
    printf '{"Changes":[{"Action":"DELETE","ResourceRecordSet":{"Name":"%s","Type":"A","TTL":60,"ResourceRecords":[{"Value":"%s"}]}}]}' \
      "$APP_DOMAIN" "$VALOR" > "$TMP"
    awsc route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
      --change-batch "file://$TMP" >/dev/null
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

  $ENV_FILE sigue en tu disco con los secretos. Si vas a volver a desplegar te
  sirve tal cual; si no, borralo.

FIN
