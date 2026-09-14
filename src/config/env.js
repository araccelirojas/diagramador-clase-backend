require('dotenv').config();

const required = ['DATABASE_URL'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Faltan variables de entorno: ${missing.join(', ')}`);
  console.error('Copia .env.example a .env y completa los valores.');
  process.exit(1);
}

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
};
