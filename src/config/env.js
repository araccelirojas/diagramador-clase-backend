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

  // La IA del chat de la sala (CU-02). Por defecto el mismo modelo que los bocetos.
  iaModelo: process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  iaTimeoutMs: Number(process.env.IA_TIMEOUT_MS || 60000),
  // CU-04: los modelos de razonamiento solo aceptan herramientas en chat completions con
  // `reasoning_effort: 'none'`. Vacio = no se manda (para modelos que no razonan).
  iaRazonamientoHerramientas:
    process.env.IA_RAZONAMIENTO_HERRAMIENTAS === undefined
      ? 'none'
      : process.env.IA_RAZONAMIENTO_HERRAMIENTAS,

  // Notas de voz del chat (CU-03).
  // Carpeta donde se guardan los audios. En Docker tiene que ser un volumen, o se pierden
  // con cada despliegue.
  audioDir: process.env.AUDIO_DIR || require('node:path').join(__dirname, '..', '..', 'almacenamiento', 'audios'),
  audioMaxBytes: Number(process.env.AUDIO_MAX_BYTES || 10 * 1024 * 1024),
  audioMaxMs: Number(process.env.AUDIO_MAX_MS || 120000),
  transcripcionModelo: process.env.OPENAI_TRANSCRIPCION_MODEL || 'whisper-1',
  ttsModelo: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',

  // El agente de voz. `mini` cuesta un tercio que el completo y para editar un diagrama
  // —turnos cortos, el trabajo lo hacen los esquemas de las herramientas— rinde igual.
  vozModelo: process.env.OPENAI_VOZ_MODELO || 'gpt-realtime-2.1-mini',
  vozVoz: process.env.OPENAI_VOZ || 'marin',
  // Tamano maximo de la imagen subida.
  bocetoMaxBytes: Number(process.env.BOCETO_MAX_BYTES || 10 * 1024 * 1024),
  // Cada cuanto guarda una sala de colaboracion. UNO por sala, no por persona.
  autosaveIntervalMs: Number(process.env.AUTOSAVE_INTERVAL_MS || 15000),
  // Historial (CU-05): una version automatica como mucho cada tanto, y solo si el
  // diagrama cambio. Las mas viejas de mas alla del tope se borran; las manuales nunca.
  versionAutoMs: Number(process.env.VERSION_AUTO_MS || 10 * 60 * 1000),
  versionesAutoMax: Number(process.env.VERSIONES_AUTO_MAX || 50),
  // Aplica las migraciones pendientes al arrancar. AUTO_MIGRATE=false lo desactiva.
  autoMigrate: process.env.AUTO_MIGRATE !== 'false',
};
