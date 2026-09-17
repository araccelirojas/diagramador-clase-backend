const repository = require('../repositories/proyecto.repository');
const AppError = require('../utils/AppError');
const { requiereTexto } = require('../utils/validators');

const NOT_FOUND = 'P2025';

// "contenido" guarda el diagrama completo como JSON; se acepta cualquier
// objeto para no acoplar el backend a la forma que use el editor.
function validarContenido(contenido) {
  if (contenido === null || typeof contenido !== 'object' || Array.isArray(contenido)) {
    throw new AppError('El campo "contenido" debe ser un objeto JSON', 422);
  }
  return contenido;
}

async function list(idUsuario) {
  return repository.findAllAccesibles(idUsuario);
}

async function getById(idProyecto, idUsuario) {
  const proyecto = await repository.findById(idProyecto);
  if (!proyecto) throw new AppError('Proyecto no encontrado', 404);

  const acceso = proyecto.idUsuario === idUsuario
    || (await repository.tieneAcceso(idProyecto, idUsuario));
  if (!acceso) throw new AppError('No tienes acceso a este proyecto', 403);

  return proyecto;
}

async function create(body, idUsuario) {
  return repository.create({
    nombre: requiereTexto(body.nombre, 'nombre'),
    contenido: body.contenido === undefined ? {} : validarContenido(body.contenido),
    idUsuario,
  });
}

// Editar el diagrama: dueno o invitado aceptado.
async function update(idProyecto, body, idUsuario) {
  await getById(idProyecto, idUsuario);

  const data = {};
  if (body.nombre !== undefined) data.nombre = requiereTexto(body.nombre, 'nombre');
  if (body.contenido !== undefined) data.contenido = validarContenido(body.contenido);

  if (!Object.keys(data).length) throw new AppError('No se envio ningun campo a actualizar', 422);

  try {
    return await repository.update(idProyecto, data);
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Proyecto no encontrado', 404);
    throw error;
  }
}

// Atajo para que el editor guarde el diagrama sin tocar el nombre.
async function guardarContenido(idProyecto, contenido, idUsuario) {
  await getById(idProyecto, idUsuario);

  try {
    return await repository.update(idProyecto, { contenido: validarContenido(contenido) });
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Proyecto no encontrado', 404);
    throw error;
  }
}

// Eliminar es exclusivo del dueno.
async function remove(idProyecto, idUsuario) {
  const proyecto = await repository.findById(idProyecto);
  if (!proyecto) throw new AppError('Proyecto no encontrado', 404);
  if (proyecto.idUsuario !== idUsuario) {
    throw new AppError('Solo el dueno puede eliminar el proyecto', 403);
  }

  try {
    await repository.remove(idProyecto);
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Proyecto no encontrado', 404);
    throw error;
  }
}

module.exports = { list, getById, create, update, guardarContenido, remove };
