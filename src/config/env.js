require('dotenv').config();

const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
  console.error('Copia .env.example a .env y completa los valores.');
  process.exit(1);
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  // Origenes autorizados del frontend, separados por coma. Vacio = cualquiera.
  corsOrigins: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),
  // Aplica las migraciones pendientes al arrancar. AUTO_MIGRATE=false lo desactiva.
  autoMigrate: process.env.AUTO_MIGRATE !== 'false',
};
