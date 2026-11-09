const mensajeService = require('../services/mensaje.service');
const emisor = require('../sockets/emisor');
const { transcribir } = require('./audio');
const { responderPregunta } = require('./index');
const votaciones = require('../votacion');

/**
 * Lo que pasa con una nota de voz despues de guardarla (CU-03), en segundo plano:
 *
 *   1. mensaje            -> la nota aparece en el chat de todos, sin transcripcion
 *   2. (transcribe)
 *   3. mensaje            -> la misma nota, ahora con `transcripcion` (el cliente la
 *                            reemplaza por id)
 *      transcripcion-error -> si no se pudo; la nota sigue ahi y se puede escuchar
 *   4. si iba para la IA, la IA responde con otra nota de voz, reutilizando todo el
 *      contexto de CU-02 (y puede proponer cambios, CU-04).
 *      Si no iba para la IA y la sala esta votando, puede ser un voto: "si, conservalo".
 */
async function procesarNotaDeVoz(
  { idProyecto, mensaje, buffer, mime, paraIA, diagrama, nombreProyecto },
  deps = {},
) {
  const {
    emitir = (evento, datos) => emisor.emitirASala(idProyecto, evento, datos),
    transcribirFn = transcribir,
    guardarTranscripcion = mensajeService.guardarTranscripcion,
    responder = responderPregunta,
    votarPorMensaje = votaciones.votarPorMensaje,
    cambiosPara = votaciones.cambiosPara,
  } = deps;

  emitir('mensaje', mensaje);

  let transcrito;
  try {
    const texto = await transcribirFn(buffer, mime);
    transcrito = await guardarTranscripcion(mensaje.idMensaje, texto);
    emitir('mensaje', transcrito);
  } catch (error) {
    const motivo = error.isOperational ? error.message : 'No se pudo transcribir la nota.';
    if (!error.isOperational) console.error('Transcripcion:', error);

    emitir('transcripcion-error', { idMensaje: mensaje.idMensaje, message: motivo });

    // La IA no puede contestar algo que no sabe que dice.
    if (paraIA) {
      emitir('ia-error', {
        respondeA: mensaje.idMensaje,
        mencionA: mensaje.usuario ? mensaje.usuario.idUsuario : null,
        message: `no se pudo entender la nota de voz (${motivo})`,
      });
    }
    return;
  }

  if (!paraIA) {
    if (transcrito.transcripcion && mensaje.usuario) {
      await votarPorMensaje(idProyecto, mensaje.usuario, transcrito.transcripcion);
    }
    return;
  }

  if (!transcrito.transcripcion) {
    emitir('ia-error', {
      respondeA: mensaje.idMensaje,
      mencionA: mensaje.usuario ? mensaje.usuario.idUsuario : null,
      message: 'la nota de voz no tiene nada que se entienda',
    });
    return;
  }

  await responder({
    idProyecto,
    pregunta: transcrito,
    diagrama,
    nombreProyecto,
    participantes: () => emisor.nombresEnSala(idProyecto),
    emitir,
    enVoz: true,
    cambios: cambiosPara(idProyecto, mensaje.usuario ? mensaje.usuario.idUsuario : null),
  });
}

module.exports = { procesarNotaDeVoz };
