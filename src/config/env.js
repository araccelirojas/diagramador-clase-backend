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
  // Lectura de bocetos con un modelo de vision de OpenAI. Sin clave, la funcionalidad
  // responde 503 explicando que falta: no rompe nada mas.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModelo: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  openaiTimeoutMs: Number(process.env.OPENAI_TIMEOUT_MS || 90000),

  // El agente de voz. `mini` cuesta un tercio que el completo y para editar un diagrama
  // —turnos cortos, el trabajo lo hacen los esquemas de las herramientas— rinde igual.
  vozModelo: process.env.OPENAI_VOZ_MODELO || 'gpt-realtime-2.1-mini',
  vozVoz: process.env.OPENAI_VOZ || 'marin',
  // Tamano maximo de la imagen subida.
  bocetoMaxBytes: Number(process.env.BOCETO_MAX_BYTES || 10 * 1024 * 1024),
  // Cada cuanto guarda una sala de colaboracion. UNO por sala, no por persona.
  autosaveIntervalMs: Number(process.env.AUTOSAVE_INTERVAL_MS || 15000),
  // Aplica las migraciones pendientes al arrancar. AUTO_MIGRATE=false lo desactiva.
  autoMigrate: process.env.AUTO_MIGRATE !== 'false',
};
