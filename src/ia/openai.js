const AppError = require('../utils/AppError');
const { openaiApiKey, iaModelo, iaTimeoutMs, iaRazonamientoHerramientas } = require('../config/env');

/**
 * La llamada al modelo de chat (CU-02, CU-04). La clave nunca sale del servidor.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const recortar = (texto) => (texto.length > 300 ? `${texto.slice(0, 300)}…` : texto);

/** Una peticion al modelo. Devuelve su `message` tal cual, o lanza un AppError legible. */
async function pedir(cuerpo) {
  if (!openaiApiKey) {
    throw new AppError('Falta OPENAI_API_KEY en el .env del backend: la IA no puede responder.', 503);
  }

  let respuesta;

  try {
    respuesta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify({ model: iaModelo, ...cuerpo }),
      // Sin limite, una sala entera se quedaria esperando detras de una respuesta colgada.
      signal: AbortSignal.timeout(iaTimeoutMs),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new AppError('La IA tardó demasiado en responder. Probá preguntar de nuevo.', 504);
    }
    throw new AppError('No se pudo contactar con OpenAI.', 502);
  }

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new AppError(
      respuesta.status === 401
        ? 'OpenAI rechazó la clave del servidor.'
        : `OpenAI rechazó la petición (${respuesta.status}): ${recortar(detalle)}`,
      502,
    );
  }

  const datos = await respuesta.json().catch(() => null);
  const eleccion = datos && datos.choices && datos.choices[0];
  const mensaje = eleccion && eleccion.message;

  if (mensaje && mensaje.refusal) {
    throw new AppError(`La IA no quiso responder: ${mensaje.refusal}`, 422);
  }
  if (!mensaje) throw new AppError('La IA devolvió una respuesta vacía.', 502);

  return mensaje;
}

const textoDe = (mensaje) => (typeof mensaje.content === 'string' ? mensaje.content.trim() : '');

/**
 * @param {object[]} mensajes
 * @returns {Promise<string>} el texto de la respuesta
 */
async function completar(mensajes) {
  const texto = textoDe(await pedir({ messages: mensajes }));
  if (texto === '') throw new AppError('La IA devolvió una respuesta vacía.', 502);
  return texto;
}

/**
 * Como `completar`, pero el modelo puede pedir herramientas (CU-04).
 * @returns {Promise<{ texto: string, llamadas: object[] }>} `llamadas` en el formato
 *   crudo de OpenAI, que es como hay que devolverlas en la segunda vuelta.
 */
async function completarConHerramientas(mensajes, herramientas) {
  const mensaje = await pedir({
    messages: mensajes,
    tools: herramientas,
    ...(iaRazonamientoHerramientas ? { reasoning_effort: iaRazonamientoHerramientas } : {}),
  });
  const llamadas = Array.isArray(mensaje.tool_calls)
    ? mensaje.tool_calls.filter((llamada) => llamada && llamada.type === 'function' && llamada.function)
    : [];
  const texto = textoDe(mensaje);

  if (texto === '' && llamadas.length === 0) {
    throw new AppError('La IA devolvió una respuesta vacía.', 502);
  }

  return { texto, llamadas };
}

module.exports = { completar, completarConHerramientas };
