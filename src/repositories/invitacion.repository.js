const prisma = require('../config/prisma');

const relaciones = {
  usuario: { select: { idUsuario: true, nombre: true, correo: true } },
  proyecto: { select: { idProyecto: true, nombre: true, idUsuario: true } },
};

// Invitaciones recibidas por el usuario o emitidas sobre sus proyectos.
async function findAllVisibles(idUsuario) {
  return prisma.invitacion.findMany({
    where: {
      OR: [{ idUsuario }, { proyecto: { idUsuario } }],
    },
    include: relaciones,
    orderBy: { fechaInvitacion: 'desc' },
  });
}

async function findById(idInvitacion) {
  return prisma.invitacion.findUnique({ where: { idInvitacion }, include: relaciones });
}

async function findByUsuarioYProyecto(idUsuario, idProyecto) {
  return prisma.invitacion.findUnique({
    where: { idUsuario_idProyecto: { idUsuario, idProyecto } },
  });
}

async function create(data) {
  return prisma.invitacion.create({ data, include: relaciones });
}

async function update(idInvitacion, data) {
  return prisma.invitacion.update({ where: { idInvitacion }, data, include: relaciones });
}

async function remove(idInvitacion) {
  return prisma.invitacion.delete({ where: { idInvitacion } });
}

module.exports = {
  findAllVisibles,
  findById,
  findByUsuarioYProyecto,
  create,
  update,
  remove,
};
