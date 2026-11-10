const mensajeRepository = require('../repositories/mensaje.repository');
const mensajeService = require('../services/mensaje.service');
const { completar, completarConHerramientas } = require('./openai');
const { sintetizar } = require('./audio');
const audios = require('../almacenamiento/audios');
const { crearCola } = require('./cola');
const { construirMensajes, mencionaIA, MAX_HISTORIAL } = require('./contexto');
const { resumirExportacion } = require('./exportador');
const { HERRAMIENTAS, MAX_OPERACIONES, leerLlamadas } = require('./herramientas');
const { leerAplicacion, turnosDeResultado, indicacionTrasAplicar, ANOTADA } = require('./propuesta');

/**
 * La IA del chat de la sala (CU-02): de una pregunta con @IA a una respuesta guardada y
 * repartida a todos.
 *
 *   ia-escribiendo { activo: true }  -> la IA empezo con esta pregunta
 *   mensaje { autor: 'IA', respondeA, mencionA }
 *   ia-escribiendo { activo: false }
 *   ia-error { respondeA, mencionA, message }  -> si algo fallo; no se guarda nada
 *
 * Con `cambios` (CU-04) la IA ademas puede modificar el diagrama. El modelo pide
 * herramientas; un cliente de la sala las aplica como un solo lote provisional; con lo
 * que salio el modelo escribe su respuesta, y la sala vota si el cambio se queda.
 *
 * Un error no se guarda como mensaje de la IA: quedaria en el historial para siempre y
 * la proxima pregunta se lo pasaria al modelo como si fuera algo que la IA dijo.
 */

const cola = crearCola({ maxPendientes: 5 });

const MAX_LARGO_RESUMEN = 60000;

/** Lo que manda el cliente sobre su diagrama. Se acepta solo si tiene la forma esperada. */
function leerDiagrama(diagrama) {
  if (!diagrama || typeof diagrama !== 'object') return { resumen: null, contenido: null };

  const resumen =
    typeof diagrama.resumen === 'string' ? diagrama.resumen.slice(0, MAX_LARGO_RESUMEN) : null;
  const contenido =
    diagrama.contenido && typeof diagrama.contenido === 'object' && !Array.isArray(diagrama.contenido)
      ? diagrama.contenido
      : null;

  return { resumen, contenido };
}

/**
 * @param {object} p
 * @param {string} p.idProyecto
 * @param {object} p.pregunta       el mensaje ya guardado que menciona a @IA
 * @param {unknown} p.diagrama      { resumen, contenido } del cliente que pregunta
 * @param {string} [p.nombreProyecto]
 * @param {() => Promise<string[]>} [p.participantes]  quien esta en la sala al responder
 * @param {(evento: string, datos: object) => void} p.emitir  a toda la sala
 * @param {boolean} [p.enVoz]  le preguntaron por voz (CU-03): responde con una nota de voz
 * @param {boolean} [p.enLlamada]  se lo dijeron a Jarvis en la llamada de voz grupal: la
 *   respuesta suena para todos los que estan en la llamada
 * @param {object} [p.cambios]  ver `votacion.cambiosPara`; sin esto, la IA solo conversa
 * @param {object} [deps]  para los tests
 */
async function responderPregunta(
  {
    idProyecto,
    pregunta,
    diagrama,
    nombreProyecto,
    participantes,
    emitir,
    enVoz = false,
    enLlamada = false,
    cambios = null,
  },
  deps = {},
) {
  const {
    completarFn = completar,
    completarConHerramientasFn = completarConHerramientas,
    paginaAnterior = mensajeRepository.paginaAnterior,
    guardar = mensajeService.guardarRespuestaIA,
    sintetizarFn = sintetizar,
    guardarAudio = audios.guardar,
  } = deps;

  const respondeA = pregunta.idMensaje;
  const mencionA = pregunta.usuario ? pregunta.usuario.idUsuario : null;
  const { resumen, contenido } = leerDiagrama(diagrama);

  try {
    await cola.encolar(idProyecto, async () => {
      emitir('ia-escribiendo', { activo: true, respondeA });

      try {
        // El historial se lee AHORA, no cuando llego la pregunta: si estaba en cola, la
        // respuesta anterior de la IA ya esta guardada y tiene que verla.
        const { mensajes } = await paginaAnterior(idProyecto, { limite: MAX_HISTORIAL + 20 });
        const hastaLaPregunta = mensajes.filter(
          (m) => new Date(m.fecha) <= new Date(pregunta.fecha),
        );

        // Se mira ahora: mientras esta pregunta esperaba en la cola pudo abrirse una votacion.
        const modoCambios = !cambios ? null : cambios.votacionAbierta() ? 'votacion' : 'disponible';

        const conversacion = construirMensajes({
          historial: hastaLaPregunta,
          pregunta,
          nombreProyecto,
          participantes: participantes ? await participantes() : [],
          resumen,
          exportador: resumirExportacion(contenido),
          modoCambios,
          enLlamada,
        });

        const texto =
          modoCambios === 'disponible'
            ? await responderConCambios({
                conversacion,
                cambios,
                solicitante: pregunta.usuario || null,
                completarFn,
                completarConHerramientasFn,
              })
            : await completarFn(conversacion);

        // Por voz se contesta con voz. Si la sintesis falla, la respuesta no se pierde:
        // llega como texto, que es mejor que un error despues de haberla pensado.
        let audio = null;
        if (enVoz) {
          try {
            const voz = await sintetizarFn(texto);
            audio = { clave: await guardarAudio(voz.buffer, voz.mime), mime: voz.mime };
          } catch (error) {
            console.error('IA: no se pudo generar la voz de la respuesta:', error.message);
          }
        }

        const respuesta = await guardar(idProyecto, { texto, respondeA, mencionA, audio });
        emitir('mensaje', respuesta);
      } finally {
        emitir('ia-escribiendo', { activo: false, respondeA });
      }
    });
  } catch (error) {
    emitir('ia-error', {
      respondeA,
      mencionA,
      message: error.isOperational ? error.message : 'La IA no pudo responder.',
    });
    if (!error.isOperational) console.error('IA:', error);
  }
}

/** Vueltas como mucho para juntar operaciones. Un cambio razonable entra en pocas. */
const MAX_VUELTAS = 8;

/**
 * Junta lo que el modelo quiere hacer, sin aplicar nada. Algunos modelos piden todas las
 * herramientas juntas y otros de a una por vuelta; a los dos se les contesta "anotada"
 * hasta que dejan de pedir, y lo juntado se aplica despues como UN lote.
 *
 * @returns {Promise<{ llamadas: object[], texto: string }>} `texto`: la respuesta, si no
 *   pidio ninguna herramienta.
 */
async function juntarOperaciones(conversacion, completarConHerramientasFn) {
  const llamadas = [];
  let mensajes = conversacion;

  for (let vuelta = 0; vuelta < MAX_VUELTAS && llamadas.length < MAX_OPERACIONES; vuelta += 1) {
    const respuesta = await completarConHerramientasFn(mensajes, HERRAMIENTAS);
    if (respuesta.llamadas.length === 0) {
      return { llamadas, texto: respuesta.texto };
    }

    const nuevas = respuesta.llamadas.slice(0, MAX_OPERACIONES - llamadas.length);
    llamadas.push(...nuevas);
    mensajes = [
      ...mensajes,
      { role: 'assistant', content: respuesta.texto || null, tool_calls: nuevas },
      ...nuevas.map((llamada) => ({ role: 'tool', tool_call_id: llamada.id, content: ANOTADA })),
    ];
  }

  return { llamadas, texto: '' };
}

/**
 * Con herramientas. Si el modelo pidio alguna, un cliente de la sala las aplica todas
 * juntas, se abre la votacion, y el modelo, en una ultima vuelta, cuenta lo que salio.
 *
 * La votacion se abre en cuanto el cambio esta aplicado, no despues de la explicacion: si
 * la segunda vuelta fallara, el cambio quedaria en el diagrama de todos sin votacion y
 * sin forma de descartarlo. Asi, pase lo que pase despues, la sala puede decidir.
 *
 * @returns {Promise<string>} el texto de la respuesta
 */
async function responderConCambios({
  conversacion,
  cambios,
  solicitante,
  completarFn,
  completarConHerramientasFn,
}) {
  const juntadas = await juntarOperaciones(conversacion, completarConHerramientasFn);
  if (juntadas.llamadas.length === 0) return juntadas.texto;

  const { llamadas } = juntadas;
  const operaciones = leerLlamadas(llamadas);

  let crudo;
  try {
    crudo = await cambios.aplicar(operaciones.map(({ nombre, argumentos }) => ({ nombre, argumentos })));
  } catch (error) {
    crudo = { ok: false, message: error.message };
  }
  let aplicacion = leerAplicacion(crudo, operaciones);

  if (aplicacion.ok && aplicacion.aplicado) {
    try {
      await cambios.abrir({
        solicitante: solicitante
          ? { idUsuario: solicitante.idUsuario, nombre: solicitante.nombre }
          : null,
        cambios: aplicacion.resultados.filter((r) => r.ok).map((r) => r.texto),
        nodos: aplicacion.nodos,
        aristas: aplicacion.aristas,
        reversion: aplicacion.reversion,
      });
    } catch (error) {
      // Un cambio sin votacion no se puede descartar nunca: se deshace ya.
      console.error('IA: no se pudo abrir la votacion, se revierte el cambio:', error.message);
      await cambios.descartar(aplicacion.reversion).catch(() => {});
      aplicacion = { ok: false, message: `No se pudo abrir la votación (${error.message}); se deshizo el cambio.` };
    }
  }

  // La explicacion parte de la conversacion original con UN turno que tiene todas las
  // llamadas y sus resultados reales, no los "anotada" de mientras se juntaban.
  return completarFn([
    ...conversacion,
    { role: 'assistant', content: null, tool_calls: llamadas },
    ...turnosDeResultado(llamadas, aplicacion),
    { role: 'system', content: indicacionTrasAplicar(aplicacion) },
  ]);
}

module.exports = { responderPregunta, mencionaIA, leerDiagrama };
