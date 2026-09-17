const repository = require('../repositories/invitacion.repository');
const proyectoRepository = require('../repositories/proyecto.repository');
const usuarioRepository = require('../repositories/usuario.repository');
const AppError = require('../utils/AppError');
const { requiereUuid, requiereCorreo } = require('../utils/validators');

const NOT_FOUND = 'P2025';
const ESTADOS = ['PENDIENTE', 'ACEPTADA', 'RECHAZADA'];

async function list(idUsuario) {
  return repository.findAllVisibles(idUsuario);
}

async function getById(idInvitacion, idUsuario) {
  const invitacion = await repository.findById(idInvitacion);
  if (!invitacion) throw new AppError('Invitacion no encontrada', 404);

  const esDestinatario = invitacion.idUsuario === idUsuario;
  const esDuenoDelProyecto = invitacion.proyecto.idUsuario === idUsuario;
  if (!esDestinatario && !esDuenoDelProyecto) {
    throw new AppError('No tienes acceso a esta invitacion', 403);
  }

  return invitacion;
}

// Solo el dueno del proyecto invita, y lo hace por correo del destinatario.
async function create(body, idSolicitante) {
  const idProyecto = requiereUuid(body.idProyecto, 'idProyecto');
  const correo = requiereCorreo(body.correo);

  const proyecto = await proyectoRepository.findById(idProyecto);
  if (!proyecto) throw new AppError('Proyecto no encontrado', 404);
  if (proyecto.idUsuario !== idSolicitante) {
    throw new AppError('Solo el dueno del proyecto puede invitar', 403);
  }

  const destinatario = await usuarioRepository.findByCorreoWithPassword(correo);
  if (!destinatario) throw new AppError('No existe un usuario con ese correo', 404);
  if (destinatario.idUsuario === idSolicitante) {
    throw new AppError('No puedes invitarte a tu propio proyecto', 422);
  }

  const previa = await repository.findByUsuarioYProyecto(destinatario.idUsuario, idProyecto);
  if (previa) throw new AppError('Ese usuario ya fue invitado a este proyecto', 409);

  return repository.create({ idUsuario: destinatario.idUsuario, idProyecto });
}

// Aceptar o rechazar: solo el destinatario de la invitacion.
async function responder(idInvitacion, estado, idUsuario) {
  if (!ESTADOS.includes(estado)) {
    throw new AppError(`El campo "estado" debe ser uno de: ${ESTADOS.join(', ')}`, 422);
  }

  const invitacion = await repository.findById(idInvitacion);
  if (!invitacion) throw new AppError('Invitacion no encontrada', 404);
  if (invitacion.idUsuario !== idUsuario) {
    throw new AppError('Solo el destinatario puede responder la invitacion', 403);
  }

  try {
    return await repository.update(idInvitacion, { estado });
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Invitacion no encontrada', 404);
    throw error;
  }
}

// Cancelar: el dueno del proyecto o el propio destinatario.
async function remove(idInvitacion, idUsuario) {
  await getById(idInvitacion, idUsuario);

  try {
    await repository.remove(idInvitacion);
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Invitacion no encontrada', 404);
    throw error;
  }
}

module.exports = { list, getById, create, responder, remove };
