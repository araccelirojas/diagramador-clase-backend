const AppError = require('../utils/AppError');
const { ESQUEMA_BOCETO } = require('./esquema');
const { INSTRUCCIONES } = require('./prompt');
const { openaiApiKey, openaiModelo, openaiTimeoutMs } = require('../config/env');

/**
 * La llamada al modelo de vision. Es lo unico de esta funcionalidad que necesita la clave,
 * y por eso vive en el backend: una clave de OpenAI en el navegador es una clave publica.
 *
 * La forma de la respuesta la garantiza Structured Outputs con `strict: true`, asi que no
 * hace falta validar campo por campo lo que vuelve. Lo que si hay que comprobar es que la
 * peticion no se haya rechazado a medias (`refusal`, `length`).
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** Tipos que un navegador manda de verdad al subir una foto. */
const TIPOS_ACEPTADOS = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function comprobarConfiguracion() {
  if (!openaiApiKey) {
    throw new AppError(
      'Falta OPENAI_API_KEY en el .env del backend: sin ella no se puede leer un boceto.',
      503,
    );
  }
}

/**
 * @param {Buffer} imagen
 * @param {string} tipoMime
 * @returns {Promise<{ boceto: object, uso: object }>}
 */
async function interpretarBoceto(imagen, tipoMime) {
  comprobarConfiguracion();

  if (!TIPOS_ACEPTADOS.has(tipoMime)) {
    throw new AppError(`No se puede leer un archivo de tipo "${tipoMime}". Subí una imagen.`, 415);
  }

  const cuerpo = {
    model: openaiModelo,
    messages: [
      { role: 'system', content: INSTRUCCIONES },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${tipoMime};base64,${imagen.toString('base64')}` },
          },
          { type: 'text', text: 'Leé este diagrama de clases y devolvé su contenido.' },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'boceto_uml', strict: true, schema: ESQUEMA_BOCETO },
    },
  };

  // Un modelo de visión sobre una foto grande puede tardar; sin límite, la petición se
  // quedaría colgada y con ella la conexión del usuario.
  const corte = AbortSignal.timeout(openaiTimeoutMs);

  let respuesta;

  try {
    respuesta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(cuerpo),
      signal: corte,
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new AppError('El modelo tardó demasiado en leer el boceto. Probá de nuevo.', 504);
    }
    throw new AppError('No se pudo contactar con OpenAI.', 502);
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    // La clave y el cuerpo nunca se registran; el mensaje de OpenAI sí, que es lo útil.
    throw new AppError(
      `OpenAI rechazó la petición (${respuesta.status}): ${recortar(detalle)}`,
      respuesta.status === 401 ? 503 : 502,
    );
  }

  const datos = await respuesta.json();
  const eleccion = datos.choices && datos.choices[0];

  if (!eleccion) throw new AppError('OpenAI devolvió una respuesta vacía.', 502);

  if (eleccion.message && eleccion.message.refusal) {
    throw new AppError(`El modelo se negó a leer la imagen: ${eleccion.message.refusal}`, 422);
  }

  if (eleccion.finish_reason === 'length') {
    throw new AppError(
      'El diagrama es demasiado grande para leerlo de una vez: el modelo se quedó sin espacio.',
      422,
    );
  }

  let boceto;

  try {
    boceto = JSON.parse(eleccion.message.content);
  } catch {
    throw new AppError('OpenAI devolvió algo que no es JSON.', 502);
  }

  return { boceto, uso: datos.usage || null };
}

const recortar = (texto) => (texto.length > 300 ? `${texto.slice(0, 300)}…` : texto);

module.exports = { interpretarBoceto, TIPOS_ACEPTADOS };
