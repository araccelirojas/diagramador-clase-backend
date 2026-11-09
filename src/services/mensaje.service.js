const repository = require('../repositories/mensaje.repository');
const proyectoService = require('./proyecto.service');
const audios = require('../almacenamiento/audios');
const { audioMaxMs } = require('../config/env');
const AppError = require('../utils/AppError');
const { UUID_RE } = require('../utils/validators');

const UNICO_VIOLADO = 'P2002';

const LIMITE_POR_DEFECTO = 30;
const LIMITE_MAXIMO = 100;
const MAX_LARGO_TEXTO = 4000;
const MAX_LARGO_ID_CLIENTE = 64;

function leerLimite(valor) {
  if (valor === undefined) return LIMITE_POR_DEFECTO;

  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new AppError('"limite" debe ser un entero positivo', 400);
  }
  return Math.min(numero, LIMITE_MAXIMO);
}

function validarTexto(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') {
    throw new AppError('El mensaje esta vacio', 422);
  }
  if (texto.length > MAX_LARGO_TEXTO) {
    throw new AppError(`El mensaje no puede pasar de ${MAX_LARGO_TEXTO} caracteres`, 422);
  }
  return texto.trim();
}

function validarIdCliente(idCliente) {
  if (idCliente === undefined || idCliente === null) return null;
  if (typeof idCliente !== 'string' || idCliente === '' || idCliente.length > MAX_LARGO_ID_CLIENTE) {
    throw new AppError('"idCliente" no es valido', 422);
  }
  return idCliente;
}

/** GET /proyectos/:id/mensajes?antesDe=<idMensaje>&limite=30 */
async function listar(idProyecto, idUsuario, query = {}) {
  await proyectoService.getById(idProyecto, idUsuario);

  const limite = leerLimite(query.limite);
  const antesDe = query.antesDe || null;

  if (antesDe) {
    if (!UUID_RE.test(antesDe)) throw new AppError('"antesDe" debe ser un UUID valido', 400);

    // Un cursor de otro proyecto haria que Prisma pagine desde un punto que no esta en
    // este chat: mejor decirlo que devolver una pagina rara.
    const cursor = await repository.buscarPorId(antesDe);
    if (!cursor || cursor.idProyecto !== idProyecto) {
      throw new AppError('El mensaje "antesDe" no pertenece a este proyecto', 404);
    }
  }

  return repository.paginaAnterior(idProyecto, { antesDe, limite });
}

/**
 * Guarda un mensaje de una persona. El acceso al proyecto ya se comprobo al entrar a la
 * sala (`unirse`), que es el unico camino por el que llega aqui.
 *
 * Idempotente por `idCliente`: si el cliente reintenta porque no le llego el ack, se le
 * devuelve el mismo mensaje con `duplicado: true` y nadie lo ve dos veces.
 */
async function enviar(idProyecto, idUsuario, { idCliente, texto } = {}) {
  const limpio = validarTexto(texto);
  const id = validarIdCliente(idCliente);

  if (id) {
    const previo = await repository.buscarPorCliente(idUsuario, id);
    if (previo) return { mensaje: previo, duplicado: true };
  }

  try {
    const mensaje = await repository.crear({
      autor: 'USUARIO',
      texto: limpio,
      idCliente: id,
      idProyecto,
      idUsuario,
    });
    return { mensaje, duplicado: false };
  } catch (error) {
    // Dos reintentos que llegaron a la vez: el otro gano la carrera.
    if (error.code === UNICO_VIOLADO && id) {
      return { mensaje: await repository.buscarPorCliente(idUsuario, id), duplicado: true };
    }
    throw error;
  }
}

/**
 * La respuesta de la IA a una pregunta, dirigida a quien pregunto. Con `audio`, es una
 * nota de voz (CU-03) y el texto va como su transcripcion.
 */
async function guardarRespuestaIA(idProyecto, { texto, respondeA, mencionA, audio = null }) {
  return repository.crear({
    autor: 'IA',
    idProyecto,
    respondeA,
    mencionA,
    ...(audio
      ? { tipo: 'VOZ', texto: '', transcripcion: texto, audio: audio.clave, audioTipo: audio.mime }
      : { texto }),
  });
}

/* ---------------------------------------------------------------------- */
/* Notas de voz (CU-03)                                                    */
/* ---------------------------------------------------------------------- */

function leerDuracion(valor) {
  const numero = Number(valor);
  // Un poco de margen sobre el maximo: el reloj del navegador y el corte de MediaRecorder
  // no coinciden al milisegundo.
  if (!Number.isFinite(numero) || numero < 0 || numero > audioMaxMs + 5000) {
    throw new AppError('"duracionMs" no es valida', 422);
  }
  return Math.round(numero);
}

/**
 * Guarda una nota de voz recien subida. La transcripcion llega despues (`transcripcion`
 * queda null mientras tanto): la nota se ve en el chat al instante, sin esperar a OpenAI.
 *
 * @returns {{ mensaje, duplicado, proyecto }}
 */
async function enviarVoz(idProyecto, idUsuario, { archivo, idCliente, duracionMs }) {
  // Por HTTP no hay sala que haya comprobado el acceso antes: se comprueba aca.
  const proyecto = await proyectoService.getById(idProyecto, idUsuario);

  if (!archivo || !archivo.buffer || archivo.buffer.length === 0) {
    throw new AppError('Falta el audio en el campo "audio".', 400);
  }
  if (!audios.extensionDe(archivo.mimetype)) {
    throw new AppError(`No se puede usar un audio de tipo "${archivo.mimetype}".`, 415);
  }

  const id = validarIdCliente(idCliente);
  const duracion = leerDuracion(duracionMs);

  if (id) {
    const previo = await repository.buscarPorCliente(idUsuario, id);
    if (previo) return { mensaje: previo, duplicado: true, proyecto };
  }

  const clave = await audios.guardar(archivo.buffer, archivo.mimetype);

  try {
    const mensaje = await repository.crear({
      autor: 'USUARIO',
      tipo: 'VOZ',
      texto: '',
      audio: clave,
      audioTipo: audios.tipoBase(archivo.mimetype),
      duracionMs: duracion,
      idCliente: id,
      idProyecto,
      idUsuario,
    });
    return { mensaje, duplicado: false, proyecto };
  } catch (error) {
    if (error.code === UNICO_VIOLADO && id) {
      return { mensaje: await repository.buscarPorCliente(idUsuario, id), duplicado: true, proyecto };
    }
    throw error;
  }
}

async function guardarTranscripcion(idMensaje, transcripcion) {
  return repository.actualizar(idMensaje, { transcripcion });
}

/** El audio de un mensaje, si quien lo pide tiene acceso a su proyecto. */
async function abrirAudio(idProyecto, idMensaje, idUsuario) {
  await proyectoService.getById(idProyecto, idUsuario);

  const fila = await repository.buscarAudio(idMensaje);
  if (!fila || fila.idProyecto !== idProyecto || !fila.audio) {
    throw new AppError('Ese mensaje no tiene audio', 404);
  }

  const { stream, tamano } = await audios.abrir(fila.audio);
  return { stream, tamano, tipo: fila.audioTipo || 'application/octet-stream' };
}

module.exports = {
  listar,
  enviar,
  guardarRespuestaIA,
  enviarVoz,
  guardarTranscripcion,
  abrirAudio,
  MAX_LARGO_TEXTO,
};
