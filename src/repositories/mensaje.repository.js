const prisma = require('../config/prisma');

/**
 * El chat de cada proyecto (CU-02).
 *
 * Se lee siempre "hacia atras": la pagina mas reciente primero, y las anteriores al
 * subir en el chat. El cursor es el id del mensaje mas viejo que el cliente ya tiene,
 * no un numero de pagina: un numero se corre cuando llegan mensajes nuevos mientras
 * tanto, y el usuario veria repetidos.
 */

const seleccion = {
  idMensaje: true,
  idProyecto: true,
  autor: true,
  tipo: true,
  texto: true,
  fecha: true,
  idCliente: true,
  respondeA: true,
  duracionMs: true,
  transcripcion: true,
  // La clave en disco se lee solo para saber si hay audio (`tieneAudio`); `aPublico` la
  // quita. El cliente pide el audio por el id del mensaje: donde esta guardado no le sirve.
  audio: true,
  usuario: { select: { idUsuario: true, nombre: true } },
  mencionado: { select: { idUsuario: true, nombre: true } },
};

/** La forma que viaja al cliente. `mencionado` se llama `mencionA` hacia afuera. */
function aPublico(fila) {
  if (!fila) return null;

  const { mencionado, audio, ...resto } = fila;
  return { ...resto, tieneAudio: Boolean(audio), mencionA: mencionado || null };
}

/**
 * Los `limite` mensajes anteriores a `antesDe` (o los ultimos, sin cursor), en orden
 * cronologico, y si quedan mas atras.
 */
async function paginaAnterior(idProyecto, { antesDe = null, limite }) {
  const filas = await prisma.mensaje.findMany({
    where: { idProyecto },
    // El id desempata dos mensajes con la misma fecha: sin esto el orden entre ellos
    // no es estable y el cursor podria saltarse uno.
    orderBy: [{ fecha: 'desc' }, { idMensaje: 'desc' }],
    take: limite + 1,
    ...(antesDe ? { cursor: { idMensaje: antesDe }, skip: 1 } : {}),
    select: seleccion,
  });

  return {
    mensajes: filas.slice(0, limite).reverse().map(aPublico),
    hayMas: filas.length > limite,
  };
}

async function buscarPorId(idMensaje) {
  return aPublico(await prisma.mensaje.findUnique({ where: { idMensaje }, select: seleccion }));
}

async function buscarPorCliente(idUsuario, idCliente) {
  return aPublico(
    await prisma.mensaje.findUnique({
      where: { idUsuario_idCliente: { idUsuario, idCliente } },
      select: seleccion,
    }),
  );
}

async function crear(data) {
  return aPublico(await prisma.mensaje.create({ data, select: seleccion }));
}

async function actualizar(idMensaje, data) {
  return aPublico(await prisma.mensaje.update({ where: { idMensaje }, data, select: seleccion }));
}

/** Donde esta guardado el audio de un mensaje. Solo para servirlo. */
async function buscarAudio(idMensaje) {
  return prisma.mensaje.findUnique({
    where: { idMensaje },
    select: { idProyecto: true, audio: true, audioTipo: true },
  });
}

module.exports = {
  paginaAnterior,
  buscarPorId,
  buscarPorCliente,
  crear,
  actualizar,
  buscarAudio,
  aPublico,
};
