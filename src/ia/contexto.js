const { INSTRUCCIONES } = require('./instrucciones');

/**
 * Arma la conversacion que se le manda al modelo (CU-02). Funcion pura: todo lo que
 * necesita le llega por parametro, y por eso se puede testear sin red ni base.
 *
 * El orden importa:
 *   1. Las instrucciones.
 *   2. El contexto del momento: quien esta en la sala, el diagrama y el exportador.
 *   3. El historial reciente, con el nombre de cada autor delante.
 *   4. La pregunta, diciendo quien la hace.
 */

/** Cuantos mensajes previos entran. Mas atras rara vez importa y paga tokens en cada pregunta. */
const MAX_HISTORIAL = 30;
/** Un mensaje del historial larguisimo se recorta: lo que cuenta es la conversacion, no un pegote. */
const MAX_LARGO_HISTORIAL = 1500;
/** Tope del resumen del diagrama, por si llega uno enorme. */
const MAX_LARGO_RESUMEN = 40000;

/** "@IA" como palabra suelta, en cualquier lugar del texto. No "@IAN" ni "mail@ia.com". */
const MENCION_IA = /(^|[^\w@.])@ia(?![\w])/i;

function mencionaIA(texto) {
  return typeof texto === 'string' && MENCION_IA.test(texto);
}

const recortar = (texto, max) => (texto.length > max ? `${texto.slice(0, max)}…` : texto);

/**
 * Lo que dice un mensaje. Una nota de voz (CU-03) lo dice en su transcripcion; si todavia
 * no la tiene, al modelo se le cuenta que hubo una nota en vez de pasarle un texto vacio.
 */
function textoDe(mensaje) {
  if (mensaje.tipo !== 'VOZ') return mensaje.texto;
  return mensaje.transcripcion ? `(nota de voz) ${mensaje.transcripcion}` : '(nota de voz sin transcribir)';
}

function nombreDe(mensaje) {
  return (mensaje.usuario && mensaje.usuario.nombre) || 'Alguien';
}

/** Un mensaje del historial como turno del modelo. */
function aTurno(mensaje) {
  const texto = recortar(textoDe(mensaje), MAX_LARGO_HISTORIAL);

  if (mensaje.autor === 'IA') return { role: 'assistant', content: texto };

  return { role: 'user', content: `${nombreDe(mensaje)}: ${texto}` };
}

/** Si en esta respuesta la IA puede tocar el diagrama (CU-04), dicho para el modelo. */
const CAMBIOS = {
  disponible:
    'disponibles. No hay ninguna votación abierta AHORA (si el historial habla de una, ya cerró). Si te piden un cambio, hacelo con las herramientas; quedará provisional hasta que la sala vote.',
  votacion:
    'NO disponibles: la sala está votando tu cambio anterior. Si te piden otro, deciles que esperen a que cierre la votación (dura como mucho dos minutos).',
};

function bloqueContexto({ nombreProyecto, participantes, resumen, exportador, modoCambios }) {
  const presentes =
    participantes && participantes.length > 0
      ? participantes.join(', ')
      : 'solo quien pregunta';

  return [
    `PROYECTO: ${nombreProyecto || 'sin nombre'}`,
    `EN LA SALA AHORA: ${presentes}`,
    `CAMBIOS AL DIAGRAMA: ${CAMBIOS[modoCambios] || 'no disponibles en este momento: solo podés conversar.'}`,
    '',
    'DIAGRAMA ACTUAL',
    resumen ? recortar(resumen, MAX_LARGO_RESUMEN) : '(no se recibió el diagrama)',
    '',
    'EXPORTADOR A SPRING BOOT',
    exportador || '(sin datos del exportador)',
  ].join('\n');
}

/**
 * @param {object} p
 * @param {object[]} p.historial  mensajes anteriores a la pregunta, en orden cronologico
 * @param {object}   p.pregunta   el mensaje que menciona a @IA
 * @param {string}   [p.nombreProyecto]
 * @param {string[]} [p.participantes]  nombres de quienes estan en la sala
 * @param {string}   [p.resumen]  `resumirDiagrama()` del cliente que pregunta
 * @param {string}   [p.exportador]  ver `exportador.js`
 * @param {'disponible' | 'votacion' | null} [p.modoCambios]  CU-04
 * @param {boolean} [p.enLlamada]  se lo dijeron a Jarvis en la llamada de voz grupal
 */
function construirMensajes({
  historial,
  pregunta,
  nombreProyecto,
  participantes,
  resumen,
  exportador,
  modoCambios = null,
  enLlamada = false,
}) {
  const previos = historial
    .filter((mensaje) => mensaje.idMensaje !== pregunta.idMensaje)
    .slice(-MAX_HISTORIAL);

  if (enLlamada) {
    return [
      { role: 'system', content: INSTRUCCIONES },
      {
        role: 'system',
        content: bloqueContexto({ nombreProyecto, participantes, resumen, exportador, modoCambios }),
      },
      ...previos.map(aTurno),
      {
        role: 'user',
        content: `${nombreDe(pregunta)} te habla en la llamada de voz (te llaman Jarvis): ${pregunta.texto}`,
      },
    ];
  }

  return [
    { role: 'system', content: INSTRUCCIONES },
    {
      role: 'system',
      content: bloqueContexto({ nombreProyecto, participantes, resumen, exportador, modoCambios }),
    },
    ...previos.map(aTurno),
    {
      role: 'user',
      content: `${nombreDe(pregunta)} te pregunta${pregunta.tipo === 'VOZ' ? ' por voz' : ''}: ${
        pregunta.tipo === 'VOZ' ? pregunta.transcripcion || '' : pregunta.texto
      }`,
    },
  ];
}

module.exports = { construirMensajes, mencionaIA, textoDe, MAX_HISTORIAL };
