const prisma = require('../config/prisma');

// Unica capa que habla con la base de datos.
async function findAll() {
  return prisma.diagram.findMany({ orderBy: { createdAt: 'desc' } });
}

async function findById(id) {
  return prisma.diagram.findUnique({ where: { id } });
}

async function create(data) {
  return prisma.diagram.create({ data });
}

async function update(id, data) {
  return prisma.diagram.update({ where: { id }, data });
}

async function remove(id) {
  return prisma.diagram.delete({ where: { id } });
}

module.exports = { findAll, findById, create, update, remove };
