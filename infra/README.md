# Infraestructura y despliegue en AWS

Dos cosas separadas, y conviene no mezclarlas:

| | Quien lo hace | Con que |
|---|---|---|
| **Infraestructura** | tu, a mano, muy de vez en cuando | `aws-up.sh` / `aws-down.sh` |
| **Despliegue** | el CI, en cada push a `main` | `aws-deploy.sh` de cada repositorio |

`aws-up.sh` no compila nada, no construye imagenes y no despliega: crea
recursos de AWS y se para. No depende del codigo de ninguna de las dos
aplicaciones, ni necesita Docker ni Node. Deja la instancia con Docker
instalado y vacia, esperando al primer push.

Vive en el repositorio del backend por comodidad, pero podrias moverlo a
cualquier sitio: lo unico que toca son recursos de AWS.

## Que se levanta

```
                         Internet
                            |
                      galflabs.tech
                            |
        +-------------------v--------------------+   EC2 t3.micro (AL2023)
        |  Caddy  :80 :443                       |
        |    certificado Let's Encrypt automatico|
        |                                        |
        |    /api/*        --> app :3000         |
        |    /socket.io/*  --> app :3000         |
        |    todo lo demas --> /srv/www          |
        |                        ^               |
        |    app  --> postgres   | volumen web   |
        +------------------------|---------------+
                                 |
                       lo deposita el pipeline
                            del frontend
```

Los tres contenedores y el volumen aparecen en el primer despliegue, no aqui.
Las decisiones que hay detras:

**Un solo dominio.** La aplicacion en `/` y la API en `/api` comparten origen,
asi que no hay CORS que configurar, ni preflights, ni un handshake de Socket.IO
que pueda rechazarse por el `Origin`. El frontend se compila con
`VITE_API_URL=/api`, una ruta relativa que sigue siendo valida si algun dia
cambias de dominio.

**PostgreSQL en la misma maquina.** Cada consulta es un salto dentro del host
en vez de una ida y vuelta a RDS. El precio de esa decision es que el disco de
la instancia es el unico sitio donde estan los datos: si la terminas sin
`--snapshot`, no hay copia.

**El frontend no es un servicio.** Es contenido estatico dentro del volumen
`web`. Su despliegue arranca un contenedor de un solo uso que copia los
ficheros ahi y muere. Por eso los dos pipelines pueden desplegar por separado
sin pisarse: cada uno toca una cosa distinta.

**Sin puerto 22.** Los despliegues y la consola remota van por Session
Manager, que pasa por la API de AWS. No hay ninguna clave SSH guardada en los
secretos de GitHub ni en ningun otro sitio.

## Requisitos

Para la infraestructura, solo la CLI de AWS:

| Herramienta | Para que | Como |
|---|---|---|
| AWS CLI v2 | `aws-up.sh`, `aws-down.sh` | https://aws.amazon.com/cli/ y luego `aws configure` |
| Git Bash | ejecutar los scripts en Windows | viene con Git para Windows |

Docker y Node solo hacen falta si quieres desplegar a mano con
`aws-deploy.sh`, saltandote el CI. Los scripts son bash: en Windows, abrelos
desde **Git Bash**, no desde PowerShell ni CMD.

## Puesta en marcha, de cero

### 1. Crear la infraestructura

```bash
cd diagramador-backend
./infra/aws-up.sh
```

Tarda unos 3 minutos. Es idempotente: si se corta a la mitad, lo vuelves a
lanzar y solo crea lo que falte. Al terminar te imprime la IP publica, los dos
repositorios de ECR y la lista de lo que queda por configurar.

Tambien genera `.env.deploy` con una contrasena de PostgreSQL y un
`JWT_SECRET` aleatorios. Ese fichero **no se sube a git** (ya esta en
`.gitignore`) pero es el unico sitio donde estan esos valores: guardalo.

### 2. Apuntar el dominio

`galflabs.tech` esta en Hostinger, no en Route 53, asi que este paso es manual.
El script te imprime la IP; en hPanel > Dominios > galflabs.tech > **DNS /
Nameservers**, los registros tienen que quedar asi:

| Tipo | Nombre | Contenido | TTL |
|---|---|---|---|
| `A` | `@` | la IP que imprimio el script | `300` |
| `CNAME` | `www` | `galflabs.tech` | `300` |

Cuatro detalles que importan:

- **Edita el `A @` que ya existe, no anadas otro.** Dos registros A para el
  mismo nombre reparten el trafico entre los dos servidores y la mitad de las
  visitas acabaria en el equivocado.
- **Borra el registro `A api`** si lo tienes de una version anterior. Con un
  solo dominio, la API vive en `https://galflabs.tech/api`.
- **Deja el `CNAME www`.** El Caddyfile tiene un bloque que lo redirige a la
  raiz. Si prefieres no tener `www`, borra el registro *y* ese bloque, o Caddy
  reintentara sacarle un certificado indefinidamente.
- **Baja el TTL a 300.** Con el valor por defecto de Hostinger (14400, o sea
  4 horas) un cambio de IP tarda horas en propagarse.

No hay que tocar los nameservers, ni activar SSL en Hostinger, ni nada mas: el
certificado lo saca Caddy solo en el primer despliegue. Y no toques los
registros `MX` ni `TXT` si usas el correo de ese dominio.

Si quieres que el script espere a que el DNS propague antes de darte el
resumen:

```bash
./infra/aws-up.sh --esperar-dns
```

### 3. Configurar los secretos de GitHub

Ver la tabla de mas abajo. Son 5 en el backend y 2 en el frontend.

### 4. Push a main

Primero en el backend, despues en el frontend. El orden importa **solo la
primera vez**: el backend es quien envia el `docker-compose.yml`, el
`Caddyfile` y el `.env` a la instancia, y quien crea el volumen donde el
frontend deposita su build. A partir de ahi da igual quien despliegue antes.

## Los scripts

```bash
./infra/aws-up.sh                # crea la infraestructura
./infra/aws-up.sh --esperar-dns  # ademas, espera a que el dominio resuelva
./infra/aws-down.sh              # borra todo
./infra/logs.sh                  # logs de los contenedores, sin SSH
./infra/aws-deploy.sh            # despliega el backend a mano (normalmente lo hace el CI)
```

### Desplegar a mano

`aws-deploy.sh` es el mismo script que ejecuta el pipeline. Existe para cuando
quieres probar algo sin pasar por un push, y necesita Docker arrancado. El del
frontend esta en su propio repositorio.

Las migraciones de Prisma se aplican solas al arrancar el contenedor
(`AUTO_MIGRATE=true`), asi que cualquier despliegue ya las incluye.

### Borrar todo

```bash
./infra/aws-down.sh              # se lleva la base de datos por delante
./infra/aws-down.sh --snapshot   # guarda antes una copia del disco
```

Borra la instancia, la Elastic IP, el security group, el rol, el perfil, los
dos repositorios de ECR y el registro DNS si esta en Route 53. Si el DNS esta
en Hostinger, el registro `A` se queda apuntando a una IP que ya no existe:
borralo a mano.

El snapshot se queda en la cuenta y factura por GB al mes; borralo desde la
consola de EC2 cuando ya no lo necesites.

## Pipelines

Son dos, uno por repositorio, y cada uno despliega solo lo suyo:

| Repositorio | Que hace en cada push a `main` |
|---|---|
| backend | pruebas, construye la imagen, la sube a ECR y reinicia los contenedores |
| frontend | lint, tipos, pruebas, compila y copia el build al volumen |

Ninguno de los dos crea ni destruye infraestructura. Los dos llaman al
`infra/aws-deploy.sh` de su repositorio, el mismo que puedes ejecutar en local.

### Secretos del repositorio del backend

Settings > Secrets and variables > Actions > **Secrets**:

| Secreto | De donde sale |
|---|---|
| `AWS_ACCESS_KEY_ID` | usuario IAM de despliegue (politica mas abajo) |
| `AWS_SECRET_ACCESS_KEY` | idem |
| `POSTGRES_PASSWORD` | el valor de tu `.env.deploy` |
| `JWT_SECRET` | el valor de tu `.env.deploy` |
| `OPENAI_API_KEY` | opcional; sin el, `/api/boceto` y `/api/voz` responden 503 |

`POSTGRES_PASSWORD` tiene que ser identico al del primer despliegue.
PostgreSQL ya creo el usuario con esa contrasena y despues no la cambia: si el
secreto no coincide, la app no conecta con la base.

### Variables del repositorio del backend

Pestana **Variables**. Todas opcionales, ya tienen valor por defecto:

| Variable | Por defecto |
|---|---|
| `AWS_REGION` | `us-east-1` |
| `APP_DOMAIN` | `galflabs.tech` |
| `JWT_EXPIRES_IN` | `7d` |
| `BCRYPT_ROUNDS` | `10` |
| `OPENAI_MODEL` | `gpt-5.6-terra` |
| `OPENAI_VOZ_MODELO` | `gpt-realtime-2.1-mini` |
| `OPENAI_VOZ` | `marin` |
| `AUTOSAVE_INTERVAL_MS` | `15000` |

### Repositorio del frontend

Solo `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`, **la misma access key**.
Sus variables opcionales estan en su propio `infra/README.md`.

Si cambias `APP_DOMAIN`, cambialo en los dos repositorios.

### Usuario IAM para los dos pipelines

Crea un usuario dedicado (IAM > Users > Create user, sin acceso a consola),
generale una access key de tipo *Application running outside AWS* y adjuntale
esta politica. Sirve para los dos repositorios.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SubirImagenes",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories",
        "ecr:InitiateLayerUpload",
        "ecr:PutImage",
        "ecr:UploadLayerPart"
      ],
      "Resource": "*"
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
      "Sid": "Desplegar",
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
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
```

Este usuario solo puede desplegar, no crear ni borrar infraestructura: para
`aws-up.sh` y `aws-down.sh` usa tus credenciales de administrador.

## Que cuesta

Con `t3.micro` dentro del primer ano de capa gratuita, unos **3-4 USD al mes**:
la Elastic IP asociada es gratis, ECR cobra por almacenamiento (la politica de
ciclo de vida deja solo las 5 ultimas imagenes de cada repositorio) y el
trafico de salida son centimos. Fuera de la capa gratuita, unos **12-15 USD al
mes**. Al no haber ni S3 ni CloudFront ni ALB, no hay mas partidas.

Ojo con una: una Elastic IP **sin asociar** si factura. Si paras la instancia
sin terminarla, la IP empieza a costar unos 3,60 USD al mes.

## Cuando algo falla

**Caddy no consigue el certificado.** Casi siempre es que el DNS todavia no
apuntaba a la instancia. Comprueba con `nslookup galflabs.tech` y repite el
despliegue del backend.

**La aplicacion carga pero la API da 502.** El contenedor de la app se esta
reiniciando. `./infra/logs.sh app 200`; si el error es de conexion a la base,
revisa que `POSTGRES_PASSWORD` sea la misma que la del primer despliegue.

**404 en todo el sitio, pero `/api/health` responde.** El volumen `web` esta
vacio: el frontend no ha desplegado todavia.

**404 solo al recargar en una ruta interna.** El `try_files` del Caddyfile no
se aplico. Repite el despliegue del backend, que es quien envia el Caddyfile.

**Entrar a la maquina:**

```bash
aws ssm start-session --target <instance-id> --region us-east-1
sudo su -
cd /opt/diagramador && docker compose ps
```
