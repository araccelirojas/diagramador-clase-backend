const AppError = require('../utils/AppError');
const { INSTRUCCIONES } = require('./instrucciones');
const {
  openaiApiKey,
  vozModelo,
  vozVoz,
  openaiTimeoutMs,
} = require('../config/env');

/**
 * El token efimero de una sesion de voz.
 *
 * El navegador habla por WebRTC DIRECTAMENTE con OpenAI: es lo que hace que la latencia sea
 * de llamada y no de peticion. Para eso necesita una credencial, y una clave de OpenAI en el
 * navegador es una clave publica. La solucion de OpenAI es este token: lo pide el servidor
 * con la clave real, dura unos minutos y solo sirve para una sesion.
 *
 * El modelo, la voz y las instrucciones se fijan AQUI y viajan dentro del token. Asi el
 * frontend no puede cambiarlos: no puede pedir un modelo mas caro ni reescribir el prompt.
 * Lo unico que anade despues es el resumen del diagrama, que cambia a cada rato.
 */

const ENDPOINT = 'https://api.openai.com/v1/realtime/client_secrets';

function comprobarConfiguracion() {
  if (!openaiApiKey) {
    throw new AppError(
      'Falta OPENAI_API_KEY en el .env del backend: sin ella no se puede abrir la llamada.',
      503,
    );
  }
}

/**
 * @returns {Promise<{ valor: string, expiraEn: number, modelo: string }>}
 */
async function crearSesionDeVoz() {
  comprobarConfiguracion();

  const cuerpo = {
    session: {
      type: 'realtime',
      model: vozModelo,
      instructions: INSTRUCCIONES,
      audio: {
        input: {
          // El modelo decide cuando el usuario termino de hablar. Es lo que permite
          // interrumpirlo a media frase sin pulsar nada.
          turn_detection: { type: 'semantic_vad', interrupt_response: true },
          transcription: { model: 'whisper-1', language: 'es' },
        },
        output: { voice: vozVoz },
      },
    },
  };

  let respuesta;

  try {
    respuesta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(openaiTimeoutMs),
    });
  } catch (error) {
    const esTiempo = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new AppError(
      esTiempo
        ? 'OpenAI tardó demasiado en responder. Probá de nuevo.'
        : 'No se pudo contactar con OpenAI para abrir la llamada.',
      503,
    );
  }

  const datos = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    const detalle = datos && datos.error && datos.error.message;

    if (respuesta.status === 401) {
      throw new AppError('OpenAI rechazó la clave del servidor.', 502);
    }

    throw new AppError(
      `OpenAI no pudo crear la sesión de voz${detalle ? `: ${detalle}` : '.'}`,
      502,
    );
  }

  // La respuesta trae el secreto en `value` y cuando caduca en `expires_at`.
  const valor = datos && (datos.value || (datos.client_secret && datos.client_secret.value));

  if (!valor) {
    throw new AppError('OpenAI devolvió una sesión sin credencial utilizable.', 502);
  }

  return {
    valor,
    expiraEn: (datos && datos.expires_at) || 0,
    modelo: vozModelo,
    /**
     * Las instrucciones viajan tambien al frontend.
     *
     * No es que las necesite para funcionar —ya van dentro del token— sino porque cada vez
     * que le pasa el resumen del diagrama tiene que reenviarlas: en `session.update` el
     * campo `instructions` REEMPLAZA lo que habia, no se suma. Mandarlas desde aqui evita
     * tener el mismo prompt escrito en dos sitios, que es tener dos prompts distintos en
     * cuanto alguien toque uno.
     */
    instrucciones: INSTRUCCIONES,
  };
}

module.exports = { crearSesionDeVoz };
