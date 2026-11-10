# Infraestructura y despliegue en AWS

Dos cosas separadas:

| | Quién lo hace | Con qué |
|---|---|---|
| **Infraestructura** | tú, una vez | `infra/aws-up.sh` (crear) / `infra/aws-down.sh` (borrar) |
| **Despliegue** | GitHub Actions, en cada push a `main` | `infra/aws-deploy.sh` de cada repositorio |

## Qué se levanta

```
                         Internet
                            |
                 https://<ip>.sslip.io
                            |
        +-------------------v--------------------+   EC2 t3.micro (Amazon Linux 2023)
        |  Caddy  :80 :443  (Let's Encrypt)      |
        |    /api/*        --> app :3000         |
        |    /socket.io/*  --> app :3000         |
        |    todo lo demás --> /srv/www          |
        |                        ^               |
        |    app  --> postgres   | volumen web   |
        +------------------------|---------------+
                                 |
                lo deposita el pipeline del frontend
```

`aws-up.sh` crea dos repositorios ECR, el rol y el perfil de la instancia, el
security group (80 y 443; sin 22, se entra por SSM), una Elastic IP, la
instancia con Docker y el usuario IAM del CI con su access key. Los
contenedores aparecen con el primer despliegue.

- **Un solo dominio**: la app en `/` y la API en `/api`. No hay CORS y el
  frontend se compila con `VITE_API_URL=/api`.
- **Dominio sin DNS**: por defecto `<ip-con-guiones>.sslip.io`, que resuelve
  solo a la IP de la instancia. Caddy saca el certificado HTTPS en el primer
  deploy (sin HTTPS el navegador no deja grabar notas de voz).
- **PostgreSQL en la misma máquina**, en un volumen de Docker. El disco de la
  instancia es el único lugar donde están los datos.
- **El usuario del CI solo puede desplegar**: subir imágenes a los dos
  repositorios ECR y ejecutar comandos por SSM en *esta* instancia.

## Puesta en marcha

### 0. Iniciar sesión en la CLI de AWS

Instalar la AWS CLI v2 (2.32 o más nueva) y abrir una terminal nueva:

```bash
winget install -e --id Amazon.AWSCLI
aws --version
```

Iniciar sesión con tu usuario de la consola (abre el navegador):

```bash
aws login                     # te pide la región: us-east-1
aws sts get-caller-identity   # comprueba que quedó con sesión
```

La sesión dura hasta 12 horas. Si `aws login` no está disponible, sirve
`aws configure` con la access key de un usuario IAM con permisos de
administrador.

### 1. Crear la infraestructura

Desde Git Bash, en la carpeta del backend:

```bash
./infra/aws-up.sh
```

Tarda unos 5 minutos y muestra cada paso (`[ 5/16] ...`). **Si un paso
falla** (o lo cortas con Ctrl+C), se detiene, dice en qué paso y con qué
comando falló, y borra todo lo que esa ejecución había creado. Si encuentra
recursos de una ejecución anterior, no toca nada y te pide borrarlos primero
con `./infra/aws-down.sh`.

Para usar un dominio propio en vez de sslip.io:
`APP_DOMAIN=midominio.com ./infra/aws-up.sh`, y antes del primer deploy
apunta su registro A a la IP que imprime el script.

### 2. Cargar los secretos en GitHub

Si termina bien, deja `infra/secretos-github.txt` (está en `.gitignore`) con
todos los secretos de cada repositorio, nombre y valor, separados en BACKEND
y FRONTEND. Se cargan en *Settings > Secrets and variables > Actions > New
repository secret*.

| Repositorio | Secretos |
|---|---|
| backend | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `APP_DOMAIN`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `OPENAI_API_KEY` |
| frontend | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `APP_DOMAIN` |

`OPENAI_API_KEY` la toma de la variable de entorno o del `.env` del backend.
`POSTGRES_PASSWORD` no se puede cambiar después del primer despliegue: la
base ya se creó con esa contraseña.

### 3. Primer despliegue

Push a `main` (o *Actions > Run workflow*), **primero en el backend** y,
cuando termine, en el frontend. El backend envía el `docker-compose.yml` y el
`Caddyfile` y levanta PostgreSQL. Desde ahí, cada push a `main` de cualquiera
de los dos se despliega solo.

## Pipelines

| Repositorio | Qué hace en cada push a `main` |
|---|---|
| backend | pruebas, construye la imagen, la sube a ECR y reinicia los contenedores |
| frontend | lint, tipos, pruebas, compila y copia el build al volumen |

Ninguno crea ni borra infraestructura.

## Los scripts

```bash
./infra/aws-up.sh                  # crea la infraestructura (con rollback si falla)
./infra/aws-down.sh                # borra todo, pidiendo confirmación
./infra/aws-down.sh --snapshot     # borra todo, guardando antes una copia del disco
./infra/logs.sh app 200            # logs de los contenedores (app, db, caddy), sin SSH
```

Una Elastic IP sin liberar se sigue cobrando: para dejar de pagar, usa
`aws-down.sh`, no apagues solo la instancia.

## Qué cuesta

`t3.micro` con 20 GB de disco y una IP pública: dentro de la capa gratuita
(o de los créditos de una cuenta nueva) casi nada; fuera, unos 12-15 USD al
mes. No hay balanceador, ni RDS, ni CloudFront.

## Cuando algo falla

**Caddy no consigue el certificado.** Con dominio propio, el registro A no
apuntaba a la IP. Con sslip.io, Let's Encrypt pudo haber limitado ese dominio
compartido: espera unos minutos y repite el deploy del backend.

**La aplicación carga pero la API da 502.** El contenedor se está reiniciando:
`./infra/logs.sh app 200`.

**404 en todo el sitio, pero `/api/health` responde.** El frontend todavía no
desplegó.

**Entrar a la máquina:**

```bash
aws ssm start-session --target <instance-id> --region us-east-1
sudo su -
cd /opt/diagramador && docker compose ps
```

(`start-session` necesita el *Session Manager plugin* instalado.)
