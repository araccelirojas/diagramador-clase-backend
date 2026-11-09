const { randomUUID } = require('node:crypto');

const AppError = require('../utils/AppError');
const votacionPura = require('./votacion');
const { interpretarVoto } = require('./interpretar');

/**
 * Las votaciones abiertas, una por sala como mucho (CU-04).
 *
 * El servidor no entiende el diagrama, y no le hace falta: el cliente que aplico el
 * cambio de la IA le entrego tambien el comando que lo deshace (`reversion`). Si la sala
 * vota descartar, el servidor se lo manda a todos como un `cambio` mas. Asi descartar
 * funciona aunque quien aplico el cambio ya se haya ido.
 *
 * La votacion no muere con la sala: si se van todos y vuelve alguien antes de los dos
 * minutos, sigue ahi. Si cierra en descartar con la sala vacia, la reversion queda
 * pendiente y se le entrega al proximo que entre (ver `tomarReversionPendiente`).
 *
 * Lo que necesita de los sockets llega por `configurar`, para no depender de ellos.
 */

const abiertas = new Map();
const reversionesPendientes = new Map();

/**
 * @type {{
 *   usuariosEnSala: (idProyecto: string) => Promise<{ idUsuario: string, nombre: string }[]>,
 *   emitir: (idProyecto: string, evento: string, datos: unknown) => void,
 *   difundirCambio: (idProyecto: string, comando: object) => Promise<boolean>,
 *   pedirPropuesta: (idProyecto: string, idUsuario: string | null, datos: object) => Promise<unknown>,
 *   guardarResultado: (idProyecto: string, datos: { texto: string, mencionA: string | null }) => Promise<object>,
 *   alConservar: (idProyecto: string, votacion: object) => Promise<void>,
 * } | null}
 */
let entorno = null;

function configurar(nuevo) {
  entorno = nuevo;
}

function abierta(idProyecto) {
  return abiertas.get(idProyecto) || null;
}

async function difundirEstado(idProyecto, votacion) {
  const presentes = await entorno.usuariosEnSala(idProyecto);
  entorno.emitir(idProyecto, 'votacion', votacionPura.aPublico(votacion, presentes, Date.now()));
  return presentes;
}

async function cerrar(idProyecto, idPropuesta) {
  const votacion = abiertas.get(idProyecto);
  // El reloj y "votaron todos" pueden llegar casi juntos: cierra solo el primero.
  if (!votacion || votacion.idPropuesta !== idPropuesta) return;

  abiertas.delete(idProyecto);
  clearTimeout(votacion.temporizador);
  Object.assign(votacion, votacionPura.decidir(votacion));

  if (votacion.estado === 'descartada' && votacion.reversion) {
    const llego = await entorno.difundirCambio(idProyecto, votacion.reversion);
    if (!llego) reversionesPendientes.set(idProyecto, votacion.reversion);
  }

  await difundirEstado(idProyecto, votacion);

  // El resultado queda en el chat: para quien llegue despues, y para la IA, que lo lee
  // en su historial y sabe si lo que hizo sigue en el diagrama.
  try {
    const mensaje = await entorno.guardarResultado(idProyecto, {
      texto: votacionPura.textoDelResultado(votacion),
      mencionA: votacion.solicitante ? votacion.solicitante.idUsuario : null,
    });
    entorno.emitir(idProyecto, 'mensaje', mensaje);
  } catch (error) {
    console.error('Votacion: no se pudo guardar el resultado:', error.message);
  }

  if (votacion.estado === 'conservada') {
    try {
      await entorno.alConservar(idProyecto, votacion);
    } catch (error) {
      console.error('Votacion: fallo lo que sigue a conservar:', error.message);
    }
  }
}

/**
 * Abre la votacion sobre un cambio que ya esta aplicado (provisional) en la sala.
 * @returns {Promise<string>} el id de la propuesta
 */
async function abrir(idProyecto, { idPropuesta = randomUUID(), solicitante, cambios, nodos, aristas, reversion }) {
  if (abiertas.has(idProyecto)) {
    throw new AppError('Ya hay una votación abierta en esta sala.', 409);
  }

  const votacion = votacionPura.crearVotacion({
    idPropuesta,
    solicitante,
    cambios,
    nodos,
    aristas,
    reversion,
    ahora: Date.now(),
  });
  votacion.temporizador = setTimeout(
    () => void cerrar(idProyecto, idPropuesta),
    votacionPura.DURACION_MS,
  );
  abiertas.set(idProyecto, votacion);

  await difundirEstado(idProyecto, votacion);
  return idPropuesta;
}

/**
 * @param {string | null} idPropuesta  del boton; null si el voto vino de un mensaje
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function votar(idProyecto, usuario, voto, idPropuesta = null) {
  const votacion = abiertas.get(idProyecto);

  if (!votacion || (idPropuesta !== null && idPropuesta !== votacion.idPropuesta)) {
    return { ok: false, message: 'Esa votación ya cerró.' };
  }
  if (voto !== 'conservar' && voto !== 'descartar') {
    return { ok: false, message: 'El voto tiene que ser conservar o descartar.' };
  }

  if (!votacionPura.registrarVoto(votacion, usuario, voto)) return { ok: true };

  const presentes = await difundirEstado(idProyecto, votacion);
  if (votacionPura.votaronTodos(votacion, presentes)) await cerrar(idProyecto, votacion.idPropuesta);

  return { ok: true };
}

/** Un mensaje del chat (escrito o transcrito) que puede ser un voto. @returns si lo fue */
async function votarPorMensaje(idProyecto, usuario, texto) {
  if (!abiertas.has(idProyecto)) return false;

  const voto = interpretarVoto(texto);
  if (!voto) return false;

  await votar(idProyecto, usuario, voto);
  return true;
}

/** Alguien entro o se fue: cambian los que faltan, y quizas ya votaron todos los que quedan. */
async function revisar(idProyecto) {
  const votacion = abiertas.get(idProyecto);
  if (!votacion) return;

  const presentes = await difundirEstado(idProyecto, votacion);
  if (votacionPura.votaronTodos(votacion, presentes)) await cerrar(idProyecto, votacion.idPropuesta);
}

/** Para quien entra a la sala: la votacion en curso, si hay. */
function estadoPublico(idProyecto, presentes) {
  const votacion = abiertas.get(idProyecto);
  return votacion ? votacionPura.aPublico(votacion, presentes, Date.now()) : null;
}

/** Una reversion que no tuvo a quien llegar. Se entrega una sola vez. */
function tomarReversionPendiente(idProyecto) {
  const comando = reversionesPendientes.get(idProyecto) || null;
  reversionesPendientes.delete(idProyecto);
  return comando;
}

/**
 * Lo que la IA necesita para cambiar el diagrama de una sala (ver `ia/index.js`).
 * @param {string} idProyecto
 * @param {string | null} idUsuario  quien pregunto: su pantalla aplica el cambio si esta
 */
function cambiosPara(idProyecto, idUsuario) {
  return {
    votacionAbierta: () => abiertas.has(idProyecto),
    aplicar: (operaciones) =>
      entorno.pedirPropuesta(idProyecto, idUsuario, { idPropuesta: randomUUID(), operaciones }),
    abrir: (datos) => abrir(idProyecto, datos),
    /** Deshace un cambio que no llego a tener votacion. */
    descartar: (reversion) => entorno.difundirCambio(idProyecto, reversion),
  };
}

module.exports = {
  configurar,
  abierta,
  abrir,
  votar,
  votarPorMensaje,
  revisar,
  cerrar,
  estadoPublico,
  tomarReversionPendiente,
  cambiosPara,
};
