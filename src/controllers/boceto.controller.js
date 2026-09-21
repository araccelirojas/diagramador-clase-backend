const { interpretarBoceto } = require('../boceto/openai');
const AppError = require('../utils/AppError');

/**
 * POST /boceto/interpretar
 *
 * Devuelve el boceto LEIDO, no un proyecto. Quien construye el documento UML es el frontend,
 * con sus propias factories: el contrato del `contenido` vive alla (CLAUDE.md §5) y tenerlo
 * tambien aca serian dos verdades que se separan al primer cambio de esquema.
 */
async function interpretar(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('Falta la imagen del boceto en el campo "imagen".', 400);
    }

    const { boceto, uso } = await interpretarBoceto(req.file.buffer, req.file.mimetype);

    res.json({
      boceto,
      // Para que se vea lo que costo la lectura, en vez de que sea un gasto invisible.
      uso,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { interpretar };
