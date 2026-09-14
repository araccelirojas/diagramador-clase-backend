# diagramador-backend

API REST con Node.js + Express + PostgreSQL (Prisma), organizada en capas.

## Requisitos

- Node.js 18+
- PostgreSQL en marcha

## Puesta en marcha

```bash
npm install
cp .env.example .env     # y edita DATABASE_URL con tus credenciales
npm run db:migrate       # crea la base de datos y las tablas
npm run dev
```

## Variables de entorno

| Variable       | Descripcion                          |
|----------------|--------------------------------------|
| `PORT`         | Puerto del servidor (por defecto 3000)|
| `NODE_ENV`     | `development` o `production`          |
| `DATABASE_URL` | Cadena de conexion a PostgreSQL       |

Formato de `DATABASE_URL`:

```
postgresql://USUARIO:CONTRASENA@HOST:PUERTO/BASE_DE_DATOS?schema=public
```

El servidor no arranca si falta `DATABASE_URL`.

## Estructura

```
prisma/
  schema.prisma          modelos (capa de datos declarativa)
  migrations/            historial de migraciones
prisma.config.js         configuracion del CLI de Prisma
src/
  server.js              arranque, conexion y apagado limpio
  app.js                 construccion de la app Express
  config/                env validado y cliente de Prisma
  routes/                definicion de endpoints
  controllers/           HTTP -> servicio
  services/              reglas de negocio
  repositories/          acceso a datos (unico que usa Prisma)
  middlewares/           errores y 404
  utils/                 AppError
```

Regla: cada capa solo llama a la de abajo. El controller nunca toca el
repository, y el service nunca conoce `req`/`res`.

## Endpoints

| Metodo | Ruta                 | Descripcion         |
|--------|----------------------|---------------------|
| GET    | /api/health          | Estado del servicio |
| GET    | /api/diagrams        | Listar              |
| GET    | /api/diagrams/:id    | Obtener uno         |
| POST   | /api/diagrams        | Crear               |
| PUT    | /api/diagrams/:id    | Actualizar          |
| DELETE | /api/diagrams/:id    | Eliminar            |

## Scripts

| Script               | Uso                                    |
|----------------------|----------------------------------------|
| `npm run dev`        | Servidor con recarga automatica        |
| `npm start`          | Servidor en modo normal                |
| `npm run db:migrate` | Crear/aplicar migraciones (desarrollo) |
| `npm run db:deploy`  | Aplicar migraciones (produccion)       |
| `npm run db:generate`| Regenerar el cliente de Prisma         |
| `npm run db:studio`  | Explorador visual de la base de datos  |
