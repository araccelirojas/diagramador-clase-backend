/**
 * Una votacion sobre un cambio de la IA (CU-04), como dato. Funciones puras: el reloj
 * llega por parametro, y por eso se testea sin esperar dos minutos.
 *
 * Reglas:
 *   - Vota cualquiera que este en la sala; un voto se puede cambiar mientras este abierta.
 *   - Cierra a los 2 minutos, o antes si ya votaron todos los presentes.
 *   - Gana la mayoria de los votos emitidos.
 *   - Empate: desempata quien pidio el cambio; si no voto, se descarta.
 *   - Sin ningun voto se descarta: nadie confirmo el cambio, y confirmar es el punto.
 */

const DURACION_MS = 2 * 60 * 1000;

/**
 * @param {object} p
 * @param {string} p.idPropuesta
 * @param {{ idUsuario: string, nombre: string } | null} p.solicitante
 * @param {string[]} p.cambios       una linea por operacion que funciono
 * @param {string[]} p.nodos         lo que queda provisional en el lienzo
 * @param {string[]} p.aristas
 * @param {object} p.reversion       el comando que deshace el cambio; opaco para el servidor
 * @param {number} p.ahora
 */
function crearVotacion({ idPropuesta, solicitante, cambios, nodos, aristas, reversion, ahora }) {
  return {
    idPropuesta,
    solicitante,
    cambios,
    nodos,
    aristas,
    reversion,
    votos: new Map(),
    cierraEn: ahora + DURACION_MS,
    estado: 'abierta',
    motivo: null,
  };
}

/** @returns {boolean} si el voto cambio algo */
function registrarVoto(votacion, { idUsuario, nombre }, voto) {
  if (votacion.estado !== 'abierta') return false;
  if (voto !== 'conservar' && voto !== 'descartar') return false;

  const anterior = votacion.votos.get(idUsuario);
  if (anterior && anterior.voto === voto) return false;

  votacion.votos.set(idUsuario, { idUsuario, nombre, voto });
  return true;
}

/** Quienes estan en la sala y todavia no votaron. `presentes` sin repetidos. */
function faltantes(votacion, presentes) {
  return presentes.filter((usuario) => !votacion.votos.has(usuario.idUsuario));
}

/**
 * Ya votaron todos los que estan: no hay por que esperar al reloj. Con la sala vacia NO:
 * "todos los presentes votaron" seria cierto sin nadie presente, y la votacion cerraria
 * sola cuando se va el ultimo. Ahi se espera al reloj, o a que vuelva alguien.
 */
function votaronTodos(votacion, presentes) {
  return (
    presentes.length > 0 && votacion.votos.size > 0 && faltantes(votacion, presentes).length === 0
  );
}

function conteo(votacion) {
  let favor = 0;
  let contra = 0;
  for (const { voto } of votacion.votos.values()) {
    if (voto === 'conservar') favor += 1;
    else contra += 1;
  }
  return { favor, contra };
}

/** @returns {{ estado: 'conservada' | 'descartada', motivo: 'mayoria' | 'desempate' | 'sin-votos' }} */
function decidir(votacion) {
  const { favor, contra } = conteo(votacion);

  if (favor === 0 && contra === 0) return { estado: 'descartada', motivo: 'sin-votos' };
  if (favor > contra) return { estado: 'conservada', motivo: 'mayoria' };
  if (contra > favor) return { estado: 'descartada', motivo: 'mayoria' };

  const delSolicitante =
    votacion.solicitante && votacion.votos.get(votacion.solicitante.idUsuario);

  return {
    estado: delSolicitante && delSolicitante.voto === 'conservar' ? 'conservada' : 'descartada',
    motivo: 'desempate',
  };
}

/** Lo que ve la sala. Sin la reversion: eso es asunto del servidor. */
function aPublico(votacion, presentes, ahora) {
  return {
    idPropuesta: votacion.idPropuesta,
    solicitante: votacion.solicitante,
    cambios: votacion.cambios,
    nodos: votacion.nodos,
    aristas: votacion.aristas,
    votos: [...votacion.votos.values()],
    faltantes: votacion.estado === 'abierta' ? faltantes(votacion, presentes) : [],
    quedanMs: votacion.estado === 'abierta' ? Math.max(0, votacion.cierraEn - ahora) : 0,
    estado: votacion.estado,
    motivo: votacion.motivo,
  };
}

/** El mensaje que queda en el chat, y que la IA lee en su historial la proxima vez. */
function textoDelResultado(votacion) {
  const { favor, contra } = conteo(votacion);
  const votos = `${favor} a favor, ${contra} en contra`;
  const desempate = votacion.motivo === 'desempate' ? '; desempató quien pidió el cambio' : '';

  if (votacion.motivo === 'sin-votos') {
    return 'Votación cerrada sin votos: se descartaron mis cambios al diagrama.';
  }

  return votacion.estado === 'conservada'
    ? `Votación cerrada: se conservan mis cambios al diagrama (${votos}${desempate}).`
    : `Votación cerrada: se descartaron mis cambios al diagrama (${votos}${desempate}).`;
}

module.exports = {
  DURACION_MS,
  crearVotacion,
  registrarVoto,
  faltantes,
  votaronTodos,
  decidir,
  aPublico,
  textoDelResultado,
};
