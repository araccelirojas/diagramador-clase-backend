const AppError = require('../utils/AppError');

/**
 * Quien esta en la llamada de voz de cada sala.
 *
 * El audio NO pasa por aca: va de navegador a navegador por WebRTC (una malla, cada uno
 * con cada uno). El servidor solo sabe quien esta adentro y reenvia las senales con las
 * que los navegadores se conectan entre si. Por eso esto es memoria y nada mas: una
 * llamada no se guarda, y si el servidor se reinicia los clientes vuelven a entrar solos.
 *
 * En una malla cada persona sube su audio una vez por cada otra. Con ocho ya son siete
 * subidas por cabeza, que es el limite razonable de una conexion domestica.
 */

const MAX_PARTICIPANTES = 8;

/** idProyecto -> Map(idSocket -> participante) */
const llamadas = new Map();

function participantes(idProyecto) {
  const llamada = llamadas.get(idProyecto);
  return llamada ? [...llamada.values()].map((p) => ({ ...p })) : [];
}

function estaEn(idProyecto, idSocket) {
  const llamada = llamadas.get(idProyecto);
  return Boolean(llamada && llamada.has(idSocket));
}

/**
 * @returns {string[]} los idSocket de quienes ya estaban: a ellos llama quien entra.
 */
function entrar(idProyecto, { idSocket, idUsuario, nombre }, ahora = Date.now()) {
  const llamada = llamadas.get(idProyecto) || new Map();

  if (!llamada.has(idSocket) && llamada.size >= MAX_PARTICIPANTES) {
    throw new AppError(`La llamada está llena (máximo ${MAX_PARTICIPANTES} personas).`, 409);
  }

  const otros = [...llamada.keys()].filter((id) => id !== idSocket);
  llamada.set(idSocket, { idSocket, idUsuario, nombre, silenciado: false, desde: ahora });
  llamadas.set(idProyecto, llamada);
  return otros;
}

/** @returns {boolean} si estaba en la llamada. */
function salir(idProyecto, idSocket) {
  const llamada = llamadas.get(idProyecto);
  if (!llamada || !llamada.delete(idSocket)) return false;
  if (llamada.size === 0) llamadas.delete(idProyecto);
  return true;
}

function silenciar(idProyecto, idSocket, silenciado) {
  const llamada = llamadas.get(idProyecto);
  const participante = llamada && llamada.get(idSocket);
  if (!participante) return false;
  participante.silenciado = Boolean(silenciado);
  return true;
}

/** Solo para los tests. */
function reiniciar() {
  llamadas.clear();
}

module.exports = { participantes, estaEn, entrar, salir, silenciar, reiniciar, MAX_PARTICIPANTES };
