const AppError = require('../utils/AppError');
const {
  openaiApiKey,
  iaTimeoutMs,
  transcripcionModelo,
  ttsModelo,
  vozVoz,
} = require('../config/env');
const { extensionDe, tipoBase } = require('../almacenamiento/audios');

/**
 * Audio <-> texto con OpenAI, para las notas de voz del chat (CU-03).
 *
 *   transcribir: la nota de una persona -> texto (lo que lee la IA y lo que se muestra
 *                debajo del reproductor).
 *   sintetizar:  la respuesta de la IA -> audio, cuando le preguntaron por voz.
 */

const TRANSCRIPCIONES = 'https://api.openai.com/v1/audio/transcriptions';
const VOZ = 'https://api.openai.com/v1/audio/speech';

/** El TTS acepta hasta 4096 caracteres por peticion. */
const MAX_TTS = 4000;

function comprobarClave() {
  if (!openaiApiKey) {
    throw new AppError('Falta OPENAI_API_KEY en el .env del backend: no se puede procesar audio.', 503);
  }
}

async function llamar(url, opciones, queHacia) {
  let respuesta;
  try {
    respuesta = await fetch(url, {
      ...opciones,
      headers: { ...opciones.headers, Authorization: `Bearer ${openaiApiKey}` },
      signal: AbortSignal.timeout(iaTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new AppError(`OpenAI tardó demasiado en ${queHacia}.`, 504);
    }
    throw new AppError('No se pudo contactar con OpenAI.', 502);
  }

  if (!respuesta.ok) {
    const detalle = (await respuesta.text().catch(() => '')).slice(0, 300);
    throw new AppError(
      respuesta.status === 401
        ? 'OpenAI rechazó la clave del servidor.'
        : `OpenAI no pudo ${queHacia} (${respuesta.status}): ${detalle}`,
      502,
    );
  }

  return respuesta;
}

/** @returns {Promise<string>} lo que se dijo; '' si la nota no tiene voz. */
async function transcribir(buffer, mime) {
  comprobarClave();

  const formulario = new FormData();
  // El nombre con extension no es decorativo: OpenAI deduce el formato de ahi.
  formulario.append(
    'file',
    new Blob([buffer], { type: tipoBase(mime) }),
    `nota.${extensionDe(mime) || 'webm'}`,
  );
  formulario.append('model', transcripcionModelo);
  formulario.append('language', 'es');
  formulario.append('response_format', 'json');

  const respuesta = await llamar(TRANSCRIPCIONES, { method: 'POST', body: formulario }, 'transcribir la nota');
  const datos = await respuesta.json().catch(() => null);

  return datos && typeof datos.text === 'string' ? datos.text.trim() : '';
}

/** @returns {Promise<{ buffer: Buffer, mime: string }>} */
async function sintetizar(texto) {
  comprobarClave();

  const respuesta = await llamar(
    VOZ,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ttsModelo,
        voice: vozVoz,
        input: texto.slice(0, MAX_TTS),
        response_format: 'mp3',
      }),
    },
    'generar la voz de la respuesta',
  );

  return { buffer: Buffer.from(await respuesta.arrayBuffer()), mime: 'audio/mpeg' };
}

module.exports = { transcribir, sintetizar };
