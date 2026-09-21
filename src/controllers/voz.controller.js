const { crearSesionDeVoz } = require('../voz/sesion');

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

module.exports = { sesion };
