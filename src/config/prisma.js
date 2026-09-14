const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { databaseUrl, nodeEnv } = require('./env');

// Desde Prisma 7 la conexion se pasa por adaptador, no desde schema.prisma.
const adapter = new PrismaPg({ connectionString: databaseUrl });

const prisma = new PrismaClient({
  adapter,
  log: nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
