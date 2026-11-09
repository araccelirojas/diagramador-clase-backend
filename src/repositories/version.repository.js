const prisma = require('../config/prisma');

/**
 * El historial de versiones de cada proyecto (CU-05).
 *
 * La lista nunca trae el `contenido`: un historial de cincuenta versiones de un diagrama
 * grande serian megas para mostrar fechas y nombres. El contenido se pide de a una.
 */

const resumen = {
  idVersion: true,
  idProyecto: true,
  numero: true,
  origen: true,
  nombre: true,
  clases: true,
  relaciones: true,
  fecha: true,
  usuario: { select: { idUsuario: true, nombre: true } },
};

const NUMERO_REPETIDO = 'P2002';

/** De la mas nueva a la mas vieja; `antesDe` es el numero de la ultima que ya se tiene. */
async function listar(idProyecto, { antesDe = null, limite }) {
  const filas = await prisma.version.findMany({
    where: { idProyecto, ...(antesDe === null ? {} : { numero: { lt: antesDe } }) },
    orderBy: { numero: 'desc' },
    take: limite + 1,
    select: resumen,
  });

  return { versiones: filas.slice(0, limite), hayMas: filas.length > limite };
}

async function buscarPorId(idVersion) {
  return prisma.version.findUnique({
    where: { idVersion },
    select: { ...resumen, contenido: true },
  });
}

/** La ultima, de cualquier origen: para decidir si hace falta otra automatica. */
async function ultima(idProyecto) {
  return prisma.version.findFirst({
    where: { idProyecto },
    orderBy: { numero: 'desc' },
    select: { numero: true, huella: true, fecha: true },
  });
}

/**
 * Crea con el numero siguiente. Dos al mismo tiempo pueden calcular el mismo numero; la
 * restriccion unica rechaza a la segunda, que reintenta con el siguiente.
 */
async function crear(data, intentos = 3) {
  for (let intento = 1; ; intento += 1) {
    const previa = await ultima(data.idProyecto);
    try {
      return await prisma.version.create({
        data: { ...data, numero: (previa ? previa.numero : 0) + 1 },
        select: resumen,
      });
    } catch (error) {
      if (error.code !== NUMERO_REPETIDO || intento >= intentos) throw error;
    }
  }
}

/** Deja solo las `conservar` automaticas mas nuevas. Las demas versiones no se tocan. */
async function podarAutomaticas(idProyecto, conservar) {
  const sobran = await prisma.version.findMany({
    where: { idProyecto, origen: 'AUTOMATICA' },
    orderBy: { numero: 'desc' },
    skip: conservar,
    select: { idVersion: true },
  });
  if (sobran.length === 0) return 0;

  const { count } = await prisma.version.deleteMany({
    where: { idVersion: { in: sobran.map((v) => v.idVersion) } },
  });
  return count;
}

module.exports = { listar, buscarPorId, ultima, crear, podarAutomaticas };
