/**
 * La vuelta de una propuesta de la IA (CU-04): lo que contesta el cliente que la aplico,
 * leido sin confiar en el, y convertido en los turnos `tool` que el modelo necesita para
 * explicar que hizo.
 */

const MAX_IDS = 500;
const MAX_LARGO_ID = 64;
const MAX_LARGO_RESULTADO = 500;
/** La reversion lleva entidades enteras; un "ordenar diagrama" las toca todas. */
const MAX_BYTES_REVERSION = 2_000_000;

const NO_RESPONDIO = 'La pantalla que tenía que aplicar el cambio no respondió.';

function ids(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_LARGO_ID)
    .slice(0, MAX_IDS);
}

function reversionValida(reversion) {
  if (!reversion || typeof reversion !== 'object') return null;
  if (typeof reversion.type !== 'string' || !reversion.payload || typeof reversion.payload !== 'object') {
    return null;
  }
  try {
    return JSON.stringify(reversion).length <= MAX_BYTES_REVERSION ? reversion : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} ack          lo que devolvio el cliente a `ia-propuesta`
 * @param {object[]} operaciones las que se le mandaron, para alinear los resultados
 */
function leerAplicacion(ack, operaciones) {
  if (!ack || typeof ack !== 'object') return { ok: false, message: NO_RESPONDIO };
  if (ack.ok !== true) {
    return { ok: false, message: typeof ack.message === 'string' ? ack.message : NO_RESPONDIO };
  }

  const crudos = Array.isArray(ack.resultados) ? ack.resultados : [];
  const resultados = operaciones.map((operacion, indice) => {
    const r = crudos[indice];
    return {
      nombre: operacion.nombre,
      ok: Boolean(r && r.ok === true),
      texto:
        r && typeof r.texto === 'string' ? r.texto.slice(0, MAX_LARGO_RESULTADO) : 'Sin resultado.',
    };
  });

  const reversion = reversionValida(ack.reversion);

  return {
    ok: true,
    // Sin la forma de deshacerlo no hay votacion posible: no se podria descartar.
    aplicado: ack.aplicado === true && reversion !== null,
    resultados,
    nodos: ids(ack.nodos),
    aristas: ids(ack.aristas),
    reversion,
  };
}

/** Un turno `tool` por llamada: OpenAI los exige todos antes de volver a responder. */
function turnosDeResultado(llamadas, aplicacion) {
  return llamadas.map((llamada, indice) => {
    let contenido;
    if (!aplicacion.ok) contenido = `NO SE APLICÓ: ${aplicacion.message}`;
    else {
      const resultado = aplicacion.resultados[indice];
      contenido = resultado.ok ? `OK: ${resultado.texto}` : `ERROR: ${resultado.texto}`;
    }
    return { role: 'tool', tool_call_id: llamada.id, content: contenido };
  });
}

/** Lo que el modelo tiene que hacer con esos resultados. */
function indicacionTrasAplicar(aplicacion) {
  if (aplicacion.ok && aplicacion.aplicado) {
    return (
      'Los cambios que funcionaron ya están en el diagrama, pero son PROVISIONALES: la sala ' +
      'tiene dos minutos para votar si se conservan o se descartan. Contá en pocas palabras ' +
      'qué cambiaste (y qué no se pudo, si algo falló) y pedí que voten con los botones ' +
      'Conservar o Descartar del chat, o respondiendo "sí" o "no".'
    );
  }
  return (
    'No se aplicó ningún cambio al diagrama. Explicá brevemente por qué, según los ' +
    'resultados, y qué haría falta. No pidas que voten: no hay nada que votar.'
  );
}

/**
 * Lo que se le contesta al modelo por cada herramienta MIENTRAS junta operaciones: nada
 * se aplica todavia. Sin esto un modelo que llama de a una herramienta por vuelta se
 * quedaria en la primera ("cree la clase; faltan los atributos").
 */
const ANOTADA =
  'Anotada; todavía no se aplicó. Todo lo que pidas en esta respuesta se aplica junto al ' +
  'final, en el orden en que lo pediste. Si falta algo de lo que te pidieron, llamá ya a las ' +
  'herramientas que falten; si ya está todo, respondé solo "listo", sin herramientas.';

module.exports = { leerAplicacion, turnosDeResultado, indicacionTrasAplicar, ANOTADA, NO_RESPONDIO };
