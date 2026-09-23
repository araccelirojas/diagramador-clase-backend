# Infraestructura y despliegue en AWS

Dos cosas separadas, y conviene no mezclarlas:

| | Quien lo hace | Con que | Depende del codigo |
|---|---|---|---|
| **Infraestructura** | tu, a mano, muy de vez en cuando | `aws-up.sh` / `aws-down.sh` | no |
| **Despliegue** | el CI, en cada push a `main` | `aws-deploy.sh` de cada repositorio | si |

`aws-up.sh` y `aws-down.sh` son **autocontenidos**: un solo fichero cada uno,
sin dependencias, solo necesitan la CLI de AWS. Puedes copiarlos a cualquier
carpeta fuera del repositorio y ejecutarlos desde ahi. Los ficheros que generan
quedan siempre junto al script, no en el directorio desde el que lo lanzas.

`config.sh`, `lib.sh`, `aws-deploy.sh` y `logs.sh` si viven en el repositorio:
el pipeline los ejecuta con el checkout puesto.

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

Los tres contenedores y el volumen aparecen en el primer despliegue, no en
`aws-up.sh`. Las decisiones que hay detras:

**Un solo dominio.** La aplicacion en `/` y la API en `/api` comparten origen,
asi que no hay CORS que configurar, ni preflights, ni un handshake de Socket.IO
que pueda rechazarse por el `Origin`. El frontend se compila con
`VITE_API_URL=/api`, una ruta relativa.

**PostgreSQL en la misma maquina.** Cada consulta es un salto dentro del host
en vez de una ida y vuelta a RDS. El precio es que el disco de la instancia es
el unico sitio donde estan los datos: sin `--snapshot`, no hay copia.

**El frontend no es un servicio.** Es contenido estatico dentro del volumen
`web`. Su despliegue arranca un contenedor de un solo uso que copia los
ficheros ahi y muere. Por eso los dos pipelines no se pisan.

**Sin puerto 22.** Todo va por Session Manager. No hay ninguna clave SSH
guardada en los secretos de GitHub ni en ningun otro sitio.

**El usuario de CI solo puede desplegar.** Su politica limita `ssm:SendCommand`
al ARN de *esta* instancia y al documento `AWS-RunShellScript`, y el push a ECR
a los dos repositorios del proyecto. No puede crear ni borrar infraestructura,
ni tocar ninguna otra maquina de la cuenta.

## Puesta en marcha, de cero

### 1. Crear la infraestructura

```bash
./infra/aws-up.sh
```

Tarda unos 3 minutos. Es idempotente: si se corta a la mitad, lo vuelves a
lanzar y solo crea lo que falte. Crea ECR (×2), el rol y perfil de la
instancia, el security group, la Elastic IP, la EC2, y el **usuario IAM del CI
con su access key**.

Deja dos ficheros junto al script:

| Fichero | Contiene |
|---|---|
| `.env.deploy` | los secretos de la aplicacion (`POSTGRES_PASSWORD`, `JWT_SECRET`, …) |
| `credenciales-github.txt` | **todo lo que va en GitHub, con sus valores**, mas los pasos de DNS |

Los dos llevan credenciales en claro y estan en `.gitignore`. No los subas ni
los pegues en un chat.

### 2. Apuntar el dominio

Paso 1 de `credenciales-github.txt`. El script te dice ademas en que estado
esta el DNS ahora mismo. Resumen para Hostinger (hPanel > Dominios >
galflabs.tech > **DNS / Nameservers**):

| Tipo | Nombre | Contenido | TTL |
|---|---|---|---|
| `A` | `@` | la IP que imprimio el script | `300` |
| `CNAME` | `www` | `galflabs.tech` | `300` |

- **Edita el `A @` que ya existe, no anadas otro.** Dos registros A para el
  mismo nombre reparten el trafico y la mitad de las visitas acabaria en el
  servidor equivocado.
- **Borra el `A api`** si lo tienes de una version anterior.
- **Si el registro vuelve solo a una IP que no es la tuya**, el dominio esta
  atado a un plan de hosting: desvinculalo en hPanel > Sitios web.
- No toques los `MX` ni `TXT` si usas el correo de ese dominio, ni actives SSL
  en el panel: el certificado lo emite Caddy en el primer despliegue.

Para que el script espere a que propague: `./infra/aws-up.sh --esperar-dns`.

### 3. Pegar los secretos en GitHub

Pasos 2 y 3 de `credenciales-github.txt`, que ya trae los valores. Al final del
fichero hay un bloque de comandos `gh` que deja los dos repositorios
configurados de una vez.

### 4. Push a main

Primero en el backend, despues en el frontend. El orden importa **solo la
primera vez**: el backend es quien envia el `docker-compose.yml`, el
`Caddyfile` y el `.env`, y quien crea el volumen donde el frontend deposita su
build.

## Los scripts

```bash
./infra/aws-up.sh                  # crea la infraestructura
./infra/aws-up.sh --rotar-claves   # ademas, genera una access key nueva
./infra/aws-up.sh --esperar-dns    # ademas, espera a que el dominio resuelva
./infra/aws-down.sh                # borra todo
./infra/aws-down.sh --snapshot     # borra todo, guardando antes el disco
./infra/aws-deploy.sh              # despliega el backend a mano
./infra/logs.sh                    # logs de los contenedores, sin SSH
```

### Sobre la access key

AWS solo muestra el secreto de una access key **en el momento de crearla**.
`aws-up.sh` lo guarda en `credenciales-github.txt` y, en ejecuciones
posteriores, lo reutiliza si esa clave sigue viva en IAM.

Si borras ese fichero o pierdes el secreto, la unica salida es rotar:

```bash
./infra/aws-up.sh --rotar-claves
```

Eso borra la clave anterior —que deja de funcionar al instante, incluidos los
pipelines— y crea una nueva. Tendras que actualizar los secretos de los dos
repositorios.

### Borrar todo

`aws-down.sh` se lleva la instancia, la Elastic IP, el security group, el rol,
el perfil, el usuario de CI con sus claves, los dos repositorios de ECR y el
registro DNS si esta en Route 53. Si el DNS esta en Hostinger, borra el `A` a
mano.

Ojo con la Elastic IP: una **sin asociar** factura unos 3,60 USD al mes. Si
paras la instancia sin terminarla, empieza a costar.

## Pipelines

Son dos, uno por repositorio:

| Repositorio | Que hace en cada push a `main` |
|---|---|
| backend | pruebas, construye la imagen, la sube a ECR y reinicia los contenedores |
| frontend | lint, tipos, pruebas, compila y copia el build al volumen |

Ninguno crea ni destruye infraestructura. Los dos llaman al
`infra/aws-deploy.sh` de su repositorio, el mismo que puedes ejecutar en local.

Los nombres de recurso tienen que coincidir entre `aws-up.sh` y los
`infra/config.sh` de los dos repositorios: `PROJECT`, `AWS_REGION`,
`APP_DOMAIN` y `WEB_VOLUME`. Es el precio de que los scripts de
infraestructura sean autocontenidos.

La lista completa de secretos y variables esta en `credenciales-github.txt`
con sus valores; aqui solo los nombres:

- **backend** · secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `POSTGRES_PASSWORD`, `JWT_SECRET`, `OPENAI_API_KEY` (opcional)
- **frontend** · secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
- variables: todas opcionales, con valor por defecto en cada workflow

`POSTGRES_PASSWORD` tiene que ser identico al del primer despliegue.
PostgreSQL ya creo el usuario con esa contrasena y despues no la cambia.

## Que cuesta

Con `t3.micro` dentro del primer ano de capa gratuita, unos **3-4 USD al mes**.
Fuera de la capa gratuita, unos **12-15 USD al mes**. Al no haber ni S3 ni
CloudFront ni ALB, no hay mas partidas.

## Cuando algo falla

**Caddy no consigue el certificado.** El DNS no apuntaba a la instancia.
Comprueba con `nslookup galflabs.tech` y repite el despliegue del backend.

**La aplicacion carga pero la API da 502.** El contenedor se esta reiniciando.
`./infra/logs.sh app 200`; si el error es de conexion a la base, revisa
`POSTGRES_PASSWORD`.

**404 en todo el sitio, pero `/api/health` responde.** El volumen `web` esta
vacio: el frontend no ha desplegado todavia.

**404 solo al recargar en una ruta interna.** El `try_files` del Caddyfile no
se aplico. Repite el despliegue del backend, que es quien lo envia.

**El pipeline da AccessDenied en SSM.** La politica del usuario de CI lleva
dentro el id de la instancia. Si la recreaste, vuelve a lanzar `aws-up.sh`:
reescribe la politica con el id nuevo.

**Entrar a la maquina:**

```bash
aws ssm start-session --target <instance-id> --region us-east-1
sudo su -
cd /opt/diagramador && docker compose ps
```
