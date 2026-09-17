# diagramador-backend

API REST con Node.js + Express + PostgreSQL (Prisma), autenticacion JWT y
passwords hasheadas con bcrypt. Organizada en capas.

## Requisitos

- Node.js 18+
- PostgreSQL en marcha

## Puesta en marcha

```bash
npm install
cp .env.example .env     # edita DATABASE_URL con tus credenciales
npm run dev              # aplica las migraciones y levanta el servidor
```

## Migraciones automaticas

Al arrancar, el servidor ejecuta `prisma migrate deploy`: aplica las
migraciones pendientes y, si la base ya esta al dia, no hace nada. Si fallan,
el servidor no arranca (mejor eso que servir con un esquema incorrecto).

Esto aplica migraciones **ya creadas**. Cuando cambies `schema.prisma` tienes
que generar la migracion nueva a mano, una sola vez:

```bash
npm run db:migrate -- --name describe_el_cambio
```

Ese comando crea la carpeta en `prisma/migrations/` y la aplica. A partir de
ahi, cualquier otro entorno que levante el servidor la aplica solo.

Generar migraciones en el arranque no se hace nunca: `migrate dev` es
interactivo y puede pedir borrar datos, algo que no debe ocurrir sin que
alguien lo supervise.

Para desactivarlo, `AUTO_MIGRATE=false` en el `.env`.

Con el servidor levantado, en otra terminal:

```bash
npm run smoke            # prueba el flujo completo de punta a punta
```

## Variables de entorno

| Variable         | Descripcion                                   |
|------------------|-----------------------------------------------|
| `PORT`           | Puerto del servidor (por defecto 3000)        |
| `NODE_ENV`       | `development` o `production`                  |
| `DATABASE_URL`   | Cadena de conexion a PostgreSQL               |
| `JWT_SECRET`     | Clave para firmar los tokens (obligatoria)    |
| `JWT_EXPIRES_IN` | Vigencia del token (por defecto `7d`)         |
| `BCRYPT_ROUNDS`  | Coste del hash (por defecto 10)               |
| `AUTO_MIGRATE`   | Migrar al arrancar (por defecto `true`)       |

El servidor no arranca si falta `DATABASE_URL` o `JWT_SECRET`.

## Modelo de datos

```
Usuario 1 ---- 0..* Proyecto        (un usuario es dueno de N proyectos)
Usuario 1 ---- 0..* Invitacion      (un usuario recibe N invitaciones)
Proyecto 1 --- 0..* Invitacion      (un proyecto emite N invitaciones)
```

Todos los ids son UUID (`@db.Uuid`, generados por la base de datos).

`Proyecto.contenido` es una columna `Json` que guarda el diagrama completo.
El backend no impone su forma: acepta cualquier objeto JSON, de modo que el
editor decide la estructura (nodos, relaciones, posiciones, etc.).

`Invitacion.estado` es un enum: `PENDIENTE`, `ACEPTADA`, `RECHAZADA`.

## Autenticacion

1. `POST /api/auth/registro` o `POST /api/auth/login` devuelven
   `{ token, usuario }`.
2. El resto de rutas exigen la cabecera:

```
Authorization: Bearer <token>
```

Las passwords se guardan hasheadas con bcrypt y nunca se devuelven en
ninguna respuesta.

## Endpoints

### Publicos

| Metodo | Ruta                 | Descripcion            |
|--------|----------------------|------------------------|
| GET    | /api/health          | Estado del servicio    |
| POST   | /api/auth/registro   | Crear cuenta y token   |
| POST   | /api/auth/login      | Iniciar sesion         |

### Usuarios (requieren token)

| Metodo | Ruta                 | Descripcion                    |
|--------|----------------------|--------------------------------|
| GET    | /api/auth/perfil     | Datos del usuario autenticado  |
| GET    | /api/usuarios        | Listar                         |
| GET    | /api/usuarios/:id    | Obtener uno                    |
| PUT    | /api/usuarios/:id    | Actualizar (solo uno mismo)    |
| DELETE | /api/usuarios/:id    | Eliminar (solo uno mismo)      |

### Proyectos (requieren token)

| Metodo | Ruta                          | Descripcion                        |
|--------|-------------------------------|------------------------------------|
| GET    | /api/proyectos                | Listar los accesibles              |
| POST   | /api/proyectos                | Crear                              |
| GET    | /api/proyectos/:id            | Obtener uno                        |
| PUT    | /api/proyectos/:id            | Actualizar nombre y/o contenido    |
| DELETE | /api/proyectos/:id            | Eliminar (solo el dueno)           |
| GET    | /api/proyectos/:id/contenido  | Cargar el diagrama                 |
| PUT    | /api/proyectos/:id/contenido  | Guardar el diagrama                |

"Accesible" = proyectos propios + aquellos con invitacion `ACEPTADA`.

### Invitaciones (requieren token)

| Metodo | Ruta                    | Descripcion                          |
|--------|-------------------------|--------------------------------------|
| GET    | /api/invitaciones       | Recibidas + emitidas sobre lo propio |
| POST   | /api/invitaciones       | Invitar (solo el dueno del proyecto) |
| GET    | /api/invitaciones/:id   | Obtener una                          |
| PATCH  | /api/invitaciones/:id   | Responder (solo el destinatario)     |
| DELETE | /api/invitaciones/:id   | Cancelar                             |

Invitar: `{ "idProyecto": "<uuid>", "correo": "destinatario@mail.com" }`
Responder: `{ "estado": "ACEPTADA" }` o `{ "estado": "RECHAZADA" }`

## Ejemplo: guardar y cargar un diagrama

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"correo":"ana@test.com","password":"secreta123"}' | jq -r .token)

# Crear proyecto con el diagrama
curl -X POST http://localhost:3000/api/proyectos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre":"Diagrama de clases","contenido":{"nodos":[],"relaciones":[]}}'

# Guardar cambios del diagrama
curl -X PUT http://localhost:3000/api/proyectos/<uuid>/contenido \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"contenido":{"nodos":[{"id":"n1","nombre":"Usuario"}],"relaciones":[]}}'

# Cargar el diagrama
curl http://localhost:3000/api/proyectos/<uuid>/contenido \
  -H "Authorization: Bearer $TOKEN"
```

## Postman

En `postman/` hay dos archivos para importar (Import -> Files, ambos a la vez):

- `diagramador-backend.postman_collection.json` — 20 peticiones en 5 carpetas
- `diagramador-local.postman_environment.json` — el environment con las variables

Son peticiones simples: JSON de ida escrito a mano, JSON de vuelta tal cual
lo devuelve la API. No hay scripts (ni pre-request ni tests) en ninguna.

### Carpetas

| Carpeta | Contenido |
|---|---|
| `00 - Salud` | Health check |
| `01 - Auth` | Registro, login y perfil |
| `02 - Usuarios` | CRUD de usuarios |
| `03 - Proyectos` | CRUD y guardado/carga del diagrama |
| `04 - Invitaciones` | Crear, listar, responder y cancelar |

### El header del token

La coleccion trae configurado, a nivel de coleccion, el header
`Authorization: Bearer {{token}}` — eso es lo unico automatico. La variable
`{{token}}` arranca vacia: despues de `01 - Auth / Login` (o `Registro`),
copias el `token` de la respuesta y lo pegas vos mismo en la variable
`token` del environment (icono del ojo, arriba a la derecha en Postman).

A partir de ahi, cualquier peticion protegida ya sale con ese token sin
que tengas que tocar sus headers uno por uno.

Para probar invitaciones necesitas dos cuentas: registra una segunda con
`Registro` cambiando el correo, y cuando le toque aceptar la invitacion,
cambia el valor de la variable `token` por el de esa cuenta.

### Los ids

`idUsuario`, `idProyecto` e `idInvitacion` son variables vacias por
defecto. Las completas igual que el token: copias el id de una respuesta
(por ejemplo el `idProyecto` que devuelve "Crear proyecto") y lo pegas en
la variable, o directamente editas la URL de la peticion.

## Estructura

```
prisma/
  schema.prisma          modelos (capa de datos declarativa)
  migrations/            historial de migraciones
prisma.config.js         configuracion del CLI de Prisma
postman/
  *.postman_collection.json   coleccion de peticiones
  *.postman_environment.json  environment local
scripts/
  smoke.js               prueba de humo end-to-end
src/
  server.js              arranque, conexion y apagado limpio
  app.js                 construccion de la app Express
  config/                env validado y cliente de Prisma
  routes/                endpoints (auth, usuarios, proyectos, invitaciones)
  controllers/           HTTP -> servicio
  services/              reglas de negocio y permisos
  repositories/          acceso a datos (unico que usa Prisma)
  middlewares/           auth JWT, validacion de UUID, errores, 404
  utils/                 AppError, hash de password, JWT, validadores
```

Regla: cada capa solo llama a la de abajo. El controller nunca toca el
repository, y el service nunca conoce `req`/`res`.

## Scripts

| Script                | Uso                                    |
|-----------------------|----------------------------------------|
| `npm run dev`         | Servidor con recarga automatica        |
| `npm start`           | Servidor en modo normal                |
| `npm run smoke`       | Prueba de humo contra el servidor      |
| `npm run db:migrate`  | Crear/aplicar migraciones (desarrollo) |
| `npm run db:deploy`   | Aplicar migraciones (produccion)       |
| `npm run db:generate` | Regenerar el cliente de Prisma         |
| `npm run db:studio`   | Explorador visual de la base de datos  |
