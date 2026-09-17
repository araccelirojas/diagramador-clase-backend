const app = require('./app');
const prisma = require('./config/prisma');
const { aplicarMigracionesPendientes } = require('./config/migrate');
const { port, autoMigrate } = require('./config/env');

async function main() {
  if (autoMigrate) await aplicarMigracionesPendientes();

  // Una query real: con adaptadores, $connect() no valida las credenciales.
  await prisma.$queryRaw`SELECT 1`;
  console.log('Conectado a PostgreSQL');

  const server = app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
  });

  const shutdown = async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (error) => {
  console.error('No se pudo iniciar el servidor:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});
