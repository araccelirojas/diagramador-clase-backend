const prisma = require('../config/prisma');

// Campos publicos: nunca exponen el hash de la password.
const publicFields = {
  idUsuario: true,
  nombre: true,
  correo: true,
  fechaRegistro: true,
  estado: true,
};

async function findAll() {
  return prisma.usuario.findMany({
    select: publicFields,
    orderBy: { fechaRegistro: 'desc' },
  });
}

async function findById(idUsuario) {
  return prisma.usuario.findUnique({ where: { idUsuario }, select: publicFields });
}

// Incluye la password: solo para el login.
async function findByCorreoWithPassword(correo) {
  return prisma.usuario.findUnique({ where: { correo } });
}

async function create(data) {
  return prisma.usuario.create({ data, select: publicFields });
}

async function update(idUsuario, data) {
  return prisma.usuario.update({ where: { idUsuario }, data, select: publicFields });
}

async function remove(idUsuario) {
  return prisma.usuario.delete({ where: { idUsuario }, select: publicFields });
}

module.exports = {
  findAll,
  findById,
  findByCorreoWithPassword,
  create,
  update,
  remove,
  publicFields,
};
