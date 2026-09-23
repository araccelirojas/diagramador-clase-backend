# Imagen de produccion del backend.
#
# Debian slim y no alpine: Prisma 7 descarga motores compilados contra glibc y
# en musl falla la deteccion. La diferencia de tamano no compensa el riesgo.
FROM node:22-slim AS base

# openssl lo necesita el motor de Prisma; curl lo usa el healthcheck de Docker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Las dependencias en su propia capa: mientras package-lock.json no cambie,
# Docker reutiliza esta capa y el build tarda segundos.
COPY package.json package-lock.json ./

# Instalacion completa, sin --omit=dev a proposito: el servidor arranca
# ejecutando el CLI de prisma (src/config/migrate.js) para aplicar las
# migraciones pendientes, y ese CLI vive en devDependencies.
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
COPY templates ./templates
COPY prisma.config.js ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

# Sin npm por medio: asi las senales SIGTERM llegan a node y el apagado
# ordenado de server.js (cerrar sockets, desconectar Prisma) funciona.
CMD ["node", "src/server.js"]
