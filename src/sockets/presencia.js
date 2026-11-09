/**
 * Presencia: lo efimero de cada persona en la sala (CU-01).
 *
 * Cursor, seleccion y estado viajan por el canal `efimero` y el servidor solo
 * los reenvia: no marcan la sala como sucia, no disparan guardado y jamas
 * llegan a la base. Lo unico que se recuerda es el ultimo estado y la ultima
 * seleccion de cada socket, en memoria, para que quien entre tarde vea a los
 * demas como estan y no "conectados" a secas hasta que muevan algo.
 *
 * Todo lo que llega se valida: es un canal que el servidor reenvia a ciegas a
 * otros clientes, y sin esto cualquiera podria colar un payload de megabytes o
 * con forma arbitraria en la pantalla de los demas.
 */

const ESTADOS = new Set(['conectado', 'editando', 'escribiendo', 'grabando', 'inactivo']);

const MAX_IDS = 500;
const MAX_LARGO_ID = 64;

function esNumero(valor) {
  return typeof valor === 'number' && Number.isFinite(valor);
}

function listaDeIds(valor) {
  if (!Array.isArray(valor) || valor.length > MAX_IDS) return null;
  if (!valor.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_LARGO_ID)) {
    return null;
  }
  return [...valor];
}

/**
 * Devuelve el mensaje efimero normalizado, o null si no es valido.
 *
 *   { tipo: 'cursor', cursor: { x, y } | null }     null = salio del lienzo
 *   { tipo: 'seleccion', nodos: string[], aristas: string[] }
 *   { tipo: 'estado', estado: 'conectado' | 'editando' | ... }
 */
function normalizarEfimero(payload) {
  if (!payload || typeof payload !== 'object') return null;

  switch (payload.tipo) {
    case 'cursor': {
      if (payload.cursor === null) return { tipo: 'cursor', cursor: null };

      const { cursor } = payload;
      if (!cursor || !esNumero(cursor.x) || !esNumero(cursor.y)) return null;

      return { tipo: 'cursor', cursor: { x: cursor.x, y: cursor.y } };
    }

    case 'seleccion': {
      const nodos = listaDeIds(payload.nodos);
      const aristas = listaDeIds(payload.aristas);
      if (!nodos || !aristas) return null;

      return { tipo: 'seleccion', nodos, aristas };
    }

    case 'estado':
      return ESTADOS.has(payload.estado) ? { tipo: 'estado', estado: payload.estado } : null;

    default:
      return null;
  }
}

function presenciaInicial() {
  return { estado: 'conectado', seleccion: { nodos: [], aristas: [] } };
}

/** Recuerda lo que hace falta para presentarle esta persona a quien entre despues. */
function recordar(presencia, mensaje) {
  if (mensaje.tipo === 'estado') presencia.estado = mensaje.estado;
  if (mensaje.tipo === 'seleccion') {
    presencia.seleccion = { nodos: mensaje.nodos, aristas: mensaje.aristas };
  }
}

/** Lo que los demas ven de un socket. Un socket, no un usuario: dos pestanas son dos cursores. */
function participanteDe(socket) {
  const { usuario, presencia = presenciaInicial() } = socket.data;

  return {
    idSocket: socket.id,
    idUsuario: usuario.idUsuario,
    nombre: usuario.nombre,
    estado: presencia.estado,
    seleccion: presencia.seleccion,
  };
}

module.exports = {
  ESTADOS,
  normalizarEfimero,
  presenciaInicial,
  recordar,
  participanteDe,
};
