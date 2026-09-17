const repository = require('../repositories/usuario.repository');
const password = require('../utils/password');
const AppError = require('../utils/AppError');
const { requiereTexto, requiereCorreo, requierePassword } = require('../utils/validators');

const NOT_FOUND = 'P2025';
const DUPLICADO = 'P2002';

function traducirError(error) {
  if (error.code === NOT_FOUND) return new AppError('Usuario no encontrado', 404);
  if (error.code === DUPLICADO) return new AppError('Ya existe un usuario con ese correo', 409);
  return error;
}

async function list() {
  return repository.findAll();
}

async function getById(idUsuario) {
  const usuario = await repository.findById(idUsuario);
  if (!usuario) throw new AppError('Usuario no encontrado', 404);
  return usuario;
}

// Solo el propio usuario puede modificar o eliminar su cuenta.
function verificarPropiedad(idUsuario, idSolicitante) {
  if (idUsuario !== idSolicitante) {
    throw new AppError('No tienes permiso sobre este usuario', 403);
  }
}

async function update(idUsuario, body, idSolicitante) {
  verificarPropiedad(idUsuario, idSolicitante);

  const data = {};
  if (body.nombre !== undefined) data.nombre = requiereTexto(body.nombre, 'nombre');
  if (body.correo !== undefined) data.correo = requiereCorreo(body.correo);
  if (body.password !== undefined) data.password = await password.hash(requierePassword(body.password));
  if (body.estado !== undefined) {
    if (typeof body.estado !== 'boolean') {
      throw new AppError('El campo "estado" debe ser booleano', 422);
    }
    data.estado = body.estado;
  }

  if (!Object.keys(data).length) throw new AppError('No se envio ningun campo a actualizar', 422);

  try {
    return await repository.update(idUsuario, data);
  } catch (error) {
    throw traducirError(error);
  }
}

async function remove(idUsuario, idSolicitante) {
  verificarPropiedad(idUsuario, idSolicitante);

  try {
    await repository.remove(idUsuario);
  } catch (error) {
    throw traducirError(error);
  }
}

module.exports = { list, getById, update, remove };
