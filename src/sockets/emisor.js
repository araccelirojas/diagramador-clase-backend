const { nombreDeSala } = require('./salas');
const AppError = require('../utils/AppError');

/**
 * Hablarle a una sala desde fuera del socket (CU-03, CU-04).
 *
 * Las notas de voz suben por HTTP —un audio en un evento de socket ocuparia el canal
 * de los cursores y los cambios mientras viaja— pero el resultado tiene que llegar a la
 * sala igual que un mensaje de texto. Esto es ese puente. Las votaciones y la IA lo usan
 * por lo mismo: no viven dentro del handler de ningun socket.
 */

let io = null;

function registrarIo(instancia) {
  io = instancia;
}

function emitirASala(idProyecto, evento, datos) {
  if (io) io.to(nombreDeSala(idProyecto)).emit(evento, datos);
}

async function socketsEnSala(idProyecto) {
  if (!io) return [];
  return io.in(nombreDeSala(idProyecto)).fetchSockets();
}

/** Nombres (sin repetir) de quienes estan en la sala ahora. */
async function nombresEnSala(idProyecto) {
  const sockets = await socketsEnSala(idProyecto);
  return [...new Set(sockets.map((s) => s.data.usuario.nombre))];
}

/** Personas (no pestanas) en la sala: dos pestanas de Ana son una Ana, y vota una vez. */
async function usuariosEnSala(idProyecto) {
  const porId = new Map();
  for (const socket of await socketsEnSala(idProyecto)) {
    const { idUsuario, nombre } = socket.data.usuario;
    if (!porId.has(idUsuario)) porId.set(idUsuario, { idUsuario, nombre });
  }
  return [...porId.values()];
}

/**
 * Le pide algo a UN cliente de la sala y espera su respuesta. De preferencia a una
 * pantalla de `idUsuario` (quien pregunto, en CU-04); si no esta, a cualquiera: el
 * diagrama es el mismo en todas.
 */
async function pedirAUnoDeLaSala(idProyecto, idUsuario, evento, datos, tiempoLimiteMs = 20000) {
  const sockets = await socketsEnSala(idProyecto);
  const elegido = sockets.find((s) => s.data.usuario.idUsuario === idUsuario) || sockets[0];

  if (!elegido) {
    throw new AppError('No hay nadie con el diagrama abierto para aplicar el cambio.', 409);
  }

  try {
    // El socket local, no el RemoteSocket de fetchSockets: el ack de ese es de difusion y
    // llega como un array de respuestas.
    const local = io.sockets.sockets.get(elegido.id);
    if (local) return await local.timeout(tiempoLimiteMs).emitWithAck(evento, datos);

    const respuestas = await elegido.timeout(tiempoLimiteMs).emitWithAck(evento, datos);
    return Array.isArray(respuestas) ? respuestas[0] : respuestas;
  } catch {
    throw new AppError('La pantalla que tenía que aplicar el cambio no respondió a tiempo.', 504);
  }
}

module.exports = {
  registrarIo,
  emitirASala,
  socketsEnSala,
  nombresEnSala,
  usuariosEnSala,
  pedirAUnoDeLaSala,
};
