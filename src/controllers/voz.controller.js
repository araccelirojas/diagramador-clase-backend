const { crearSesionDeVoz, crearSesionDeEscucha } = require('../voz/sesion');

/**
 * POST /voz/sesion
 *
 * Devuelve el token efimero con el que el navegador abre la llamada por WebRTC. La clave de
 * OpenAI no sale nunca de aqui.
 */
async function sesion(req, res, next) {
  try {
    res.json(await crearSesionDeVoz());
  } catch (error) {
    next(error);
  }
}

/**
 * POST /voz/escucha
 *
 * El token con el que cada navegador de la llamada grupal transcribe su propio microfono
 * para oir cuando alguien dice "Jarvis" (ver `crearSesionDeEscucha`).
 */
async function escucha(req, res, next) {
  try {
    res.json(await crearSesionDeEscucha());
  } catch (error) {
    next(error);
  }
}

module.exports = { sesion, escucha };
