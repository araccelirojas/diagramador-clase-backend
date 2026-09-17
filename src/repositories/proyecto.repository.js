const prisma = require('../config/prisma');

const withUsuario = {
  usuario: { select: { idUsuario: true, nombre: true, correo: true } },
};

// Proyectos propios + aquellos donde el usuario tiene invitacion aceptada.
function accesiblePor(idUsuario) {
  return {
    OR: [
      { idUsuario },
      { invitaciones: { some: { idUsuario, estado: 'ACEPTADA' } } },
    ],
  };
}

async function findAllAccesibles(idUsuario) {
  return prisma.proyecto.findMany({
    where: accesiblePor(idUsuario),
    include: withUsuario,
    orderBy: { fechaCreacion: 'desc' },
  });
}

async function findById(idProyecto) {
  return prisma.proyecto.findUnique({ where: { idProyecto }, include: withUsuario });
}

async function create(data) {
  return prisma.proyecto.create({ data, include: withUsuario });
}

async function update(idProyecto, data) {
  return prisma.proyecto.update({ where: { idProyecto }, data, include: withUsuario });
}

async function remove(idProyecto) {
  return prisma.proyecto.delete({ where: { idProyecto } });
}

// True si el usuario es dueno o tiene invitacion aceptada.
async function tieneAcceso(idProyecto, idUsuario) {
  const count = await prisma.proyecto.count({
    where: { idProyecto, ...accesiblePor(idUsuario) },
  });
  return count > 0;
}

module.exports = { findAllAccesibles, findById, create, update, remove, tieneAcceso };
