const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AppError = require('../utils/AppError');
const { audioDir } = require('../config/env');

/**
 * Donde viven las notas de voz (CU-03).
 *
 * Hoy, una carpeta en disco. Todo el resto del backend habla con este modulo por una
 * CLAVE opaca ("2026/11/<uuid>.webm"), nunca con rutas: pasar a S3 es reescribir este
 * archivo y nada mas.
 *
 * Los audios no se sirven como estaticos: pasan por un endpoint que comprueba el acceso
 * al proyecto, igual que el resto del chat.
 */

/** Tipos que graba de verdad un navegador (MediaRecorder) y que acepta la transcripcion. */
const EXTENSIONES = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** "audio/webm;codecs=opus" -> "audio/webm". */
function tipoBase(mime) {
  return String(mime || '').split(';')[0].trim().toLowerCase();
}

function extensionDe(mime) {
  return EXTENSIONES[tipoBase(mime)] || null;
}

const CLAVE_VALIDA = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;

/** La ruta en disco de una clave, sin dejar salir de la carpeta ("../../etc/passwd"). */
function rutaDe(clave) {
  if (!CLAVE_VALIDA.test(clave)) throw new AppError('Clave de audio invalida', 400);
  return path.join(audioDir, clave);
}

/** @returns {Promise<string>} la clave con la que se recupera despues */
async function guardar(buffer, mime) {
  const extension = extensionDe(mime);
  if (!extension) throw new AppError(`No se puede guardar un audio de tipo "${mime}".`, 415);

  const ahora = new Date();
  const carpeta = `${ahora.getFullYear()}/${String(ahora.getMonth() + 1).padStart(2, '0')}`;
  const clave = `${carpeta}/${crypto.randomUUID()}.${extension}`;

  await fs.promises.mkdir(path.join(audioDir, carpeta), { recursive: true });
  await fs.promises.writeFile(rutaDe(clave), buffer);

  return clave;
}

/** @returns {Promise<{ stream: fs.ReadStream, tamano: number }>} */
async function abrir(clave) {
  const ruta = rutaDe(clave);

  let info;
  try {
    info = await fs.promises.stat(ruta);
  } catch {
    throw new AppError('El audio ya no esta disponible.', 404);
  }

  return { stream: fs.createReadStream(ruta), tamano: info.size };
}

module.exports = { guardar, abrir, extensionDe, tipoBase, EXTENSIONES };
