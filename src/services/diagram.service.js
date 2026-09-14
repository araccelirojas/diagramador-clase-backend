const repository = require('../repositories/diagram.repository');
const AppError = require('../utils/AppError');

// Prisma lanza P2025 cuando un update/delete no encuentra el registro.
const NOT_FOUND = 'P2025';

async function list() {
  return repository.findAll();
}

async function getById(id) {
  const diagram = await repository.findById(id);
  if (!diagram) throw new AppError('Diagrama no encontrado', 404);
  return diagram;
}

async function create({ name, description, nodes }) {
  if (!name || !name.trim()) {
    throw new AppError('El campo "name" es obligatorio', 422);
  }

  return repository.create({
    name: name.trim(),
    ...(description !== undefined && { description }),
    ...(nodes !== undefined && { nodes }),
  });
}

async function update(id, { name, description, nodes }) {
  if (name !== undefined && !name.trim()) {
    throw new AppError('El campo "name" no puede estar vacio', 422);
  }

  try {
    return await repository.update(id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(nodes !== undefined && { nodes }),
    });
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Diagrama no encontrado', 404);
    throw error;
  }
}

async function remove(id) {
  try {
    await repository.remove(id);
  } catch (error) {
    if (error.code === NOT_FOUND) throw new AppError('Diagrama no encontrado', 404);
    throw error;
  }
}

module.exports = { list, getById, create, update, remove };
