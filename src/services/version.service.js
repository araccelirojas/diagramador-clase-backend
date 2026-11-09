const { createHash } = require('node:crypto');

const repository = require('../repositories/version.repository');
const proyectoService = require('./proyecto.service');
const emisor = require('../sockets/emisor');
const votaciones = require('../votacion');
const AppError = require('../utils/AppError');
const { requiereUuid } = require('../utils/validators');
const { versionAutoMs, versionesAutoMax } = require('../config/env');

/**
 * Historial de versiones del diagrama (CU-05).
 *
 * Cuatro origenes:
 *   MANUAL        alguien apreto "Guardar version".
 *   AUTOMATICA    el autoguardado de la sala, como mucho cada `versionAutoMs` y solo si
 *                 el diagrama cambio desde la ultima version.
 *   IA            la sala voto conservar un cambio de la IA (CU-04).
 *   RESTAURACION  el diagrama tal como estaba justo antes de restaurar otra version:
 *                 restaurar tambien se puede deshacer.
 *
 * Cada version nueva se avisa a la sala (`version-creada`) para que el panel de historial
 * de todos se actualice sin recargar.
 */

const LIMITE_POR_DEFECTO = 30;
const LIMITE_MAXIMO = 100;
const MAX_LARGO_NOMBRE = 120;

/** Lo que no son clases: se cuentan aparte de las cajas del modelo. */
const NO_SON_CLASES = new Set(['note', 'package']);

function validarContenido(contenido) {
  if (contenido === null || typeof contenido !== 'object' || Array.isArray(contenido)) {
    throw new AppError('El campo "contenido" debe ser un objeto JSON', 422);
  }
  return contenido;
}

/** JSON con las claves ordenadas: el mismo diagrama da siempre el mismo texto. */
function estable(valor) {
  if (Array.isArray(valor)) return `[${valor.map(estable).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor)
      .sort()
      .map((clave) => `${JSON.stringify(clave)}:${estable(valor[clave])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

/**
 * La huella del MODELO: clases y relaciones. No entran el viewport ni las fechas de
 * `meta`: desplazar la vista no es un cambio que merezca otra version.
 */
function huellaDe(contenido) {
  return createHash('sha256')
    .update(estable({ nodes: contenido.nodes || {}, edges: contenido.edges || {} }))
    .digest('hex');
}

function contar(contenido) {
  const nodos = Object.values(contenido.nodes || {});
  return {
    clases: nodos.filter((nodo) => nodo && !NO_SON_CLASES.has(nodo.kind)).length,
    relaciones: Object.keys(contenido.edges || {}).length,
  };
}

function leerNombre(nombre) {
  if (nombre === undefined || nombre === null) return null;
  if (typeof nombre !== 'string') throw new AppError('El nombre de la versión debe ser texto', 422);
  const limpio = nombre.trim();
  if (limpio.length > MAX_LARGO_NOMBRE) {
    throw new AppError(`El nombre de la versión admite hasta ${MAX_LARGO_NOMBRE} caracteres`, 422);
  }
  return limpio === '' ? null : limpio;
}

/** Guarda una version y la avisa a la sala. */
async function crear(idProyecto, { contenido, origen, nombre = null, idUsuario = null }, deps = {}) {
  const { repo = repository, emitir = emisor.emitirASala } = deps;

  validarContenido(contenido);
  const version = await repo.crear({
    idProyecto,
    origen,
    nombre,
    contenido,
    huella: huellaDe(contenido),
    ...contar(contenido),
    idUsuario,
  });

  emitir(idProyecto, 'version-creada', version);
  return version;
}

/* Lo que llega por HTTP ------------------------------------------------- */

async function listar(idProyecto, idUsuario, query = {}) {
  await proyectoService.getById(idProyecto, idUsuario);

  const limite = Math.min(Number(query.limite) || LIMITE_POR_DEFECTO, LIMITE_MAXIMO);
  const antesDe = query.antesDe === undefined ? null : Number(query.antesDe);
  if (antesDe !== null && !Number.isInteger(antesDe)) {
    throw new AppError('"antesDe" debe ser un número de versión', 422);
  }

  return repository.listar(idProyecto, { antesDe, limite });
}

/** Una version con su contenido, si tenes acceso a su proyecto. */
async function obtener(idVersion, idUsuario) {
  const version = await repository.buscarPorId(requiereUuid(idVersion, 'idVersion'));
  if (!version) throw new AppError('Versión no encontrada', 404);

  await proyectoService.getById(version.idProyecto, idUsuario);
  return version;
}

/** "Guardar version": el diagrama que tiene en pantalla quien la pide. */
async function guardarManual(idProyecto, idUsuario, body = {}) {
  await proyectoService.getById(idProyecto, idUsuario);

  return crear(idProyecto, {
    contenido: body.contenido,
    origen: 'MANUAL',
    nombre: leerNombre(body.nombre),
    idUsuario,
  });
}

/**
 * Restaurar: primero una copia de lo que hay ahora (RESTAURACION), despues se devuelve la
 * version pedida. Quien restaura la aplica en su pantalla y la difunde a la sala como un
 * documento entero, igual que importar un archivo.
 *
 * Bloqueado mientras la sala vota un cambio de la IA: restaurar se llevaria puesto el
 * cambio provisional, y la votacion seguiria abierta sobre algo que ya no existe.
 */
async function restaurar(idProyecto, idVersion, idUsuario, body = {}, deps = {}) {
  const { votacionAbierta = (id) => votaciones.abierta(id) !== null } = deps;

  await proyectoService.getById(idProyecto, idUsuario);

  if (votacionAbierta(idProyecto)) {
    throw new AppError(
      'Hay una votación abierta sobre un cambio de la IA. Esperá a que cierre para restaurar.',
      409,
    );
  }

  const version = await repository.buscarPorId(requiereUuid(idVersion, 'idVersion'));
  if (!version || version.idProyecto !== idProyecto) {
    throw new AppError('Versión no encontrada', 404);
  }

  const respaldo = await crear(idProyecto, {
    contenido: validarContenido(body.contenidoActual),
    origen: 'RESTAURACION',
    nombre: `Antes de restaurar la versión ${version.numero}`,
    idUsuario,
  });

  return { version, respaldo };
}

/* Lo que pasa solo ------------------------------------------------------ */

/**
 * Despues de cada autoguardado de la sala. Devuelve la version creada, o null si no tocaba
 * (muy pronto desde la ultima, o el modelo no cambio).
 */
async function automatica(idProyecto, contenido, idUsuario, deps = {}) {
  const { repo = repository, ahora = Date.now(), emitir } = deps;

  if (!contenido || typeof contenido !== 'object') return null;

  const previa = await repo.ultima(idProyecto);
  if (previa && ahora - new Date(previa.fecha).getTime() < versionAutoMs) return null;
  if (previa && previa.huella === huellaDe(contenido)) return null;

  const version = await crear(
    idProyecto,
    { contenido, origen: 'AUTOMATICA', idUsuario },
    { repo, ...(emitir ? { emitir } : {}) },
  );
  await repo.podarAutomaticas(idProyecto, versionesAutoMax);
  return version;
}

/** La sala conservo un cambio de la IA (CU-04): queda como version propia. */
async function desdeIA(idProyecto, { contenido, idUsuario, cambios }) {
  const primero = cambios && cambios[0] ? cambios[0] : 'cambio de la IA';
  const resto = cambios && cambios.length > 1 ? ` (+${cambios.length - 1})` : '';
  const nombre = `IA: ${primero}${resto}`.slice(0, MAX_LARGO_NOMBRE);

  return crear(idProyecto, { contenido, origen: 'IA', nombre, idUsuario });
}

module.exports = {
  listar,
  obtener,
  guardarManual,
  restaurar,
  automatica,
  desdeIA,
  crear,
  huellaDe,
  contar,
};
