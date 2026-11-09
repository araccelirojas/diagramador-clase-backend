const service = require('../services/mensaje.service');
const { procesarNotaDeVoz } = require('../ia/notaDeVoz');

// GET /proyectos/:id/mensajes -> una pagina del chat, del mas viejo al mas nuevo
async function listar(req, res, next) {
  try {
    res.json(await service.listar(req.params.id, req.usuario.idUsuario, req.query));
  } catch (error) {
    next(error);
  }
}

/** El diagrama llega como texto JSON en un campo del formulario. Mal formado = sin diagrama. */
function leerDiagrama(valor) {
  if (typeof valor !== 'string' || valor === '') return null;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

/**
 * POST /proyectos/:id/mensajes/voz  (multipart: audio, idCliente, duracionMs, paraIA, diagrama)
 *
 * Responde en cuanto la nota esta guardada. La transcripcion y, si iba para la IA, su
 * respuesta llegan despues por el socket de la sala (ver `ia/notaDeVoz.js`).
 */
async function subirVoz(req, res, next) {
  try {
    const { mensaje, duplicado, proyecto } = await service.enviarVoz(
      req.params.id,
      req.usuario.idUsuario,
      { archivo: req.file, idCliente: req.body.idCliente, duracionMs: req.body.duracionMs },
    );

    res.status(duplicado ? 200 : 201).json({ mensaje });

    // Un reintento de algo ya guardado: ya se repartio y ya se transcribio.
    if (duplicado) return;

    void procesarNotaDeVoz({
      idProyecto: req.params.id,
      mensaje,
      buffer: req.file.buffer,
      mime: req.file.mimetype,
      paraIA: req.body.paraIA === 'true',
      diagrama: leerDiagrama(req.body.diagrama),
      nombreProyecto: proyecto.nombre,
    }).catch((error) => console.error('Nota de voz:', error));
  } catch (error) {
    next(error);
  }
}

// GET /proyectos/:id/mensajes/:idMensaje/audio -> el audio, si tenes acceso al proyecto
async function audio(req, res, next) {
  try {
    const { stream, tamano, tipo } = await service.abrirAudio(
      req.params.id,
      req.params.idMensaje,
      req.usuario.idUsuario,
    );

    res.setHeader('Content-Type', tipo);
    res.setHeader('Content-Length', tamano);
    // Un audio no cambia nunca: el navegador lo puede guardar un dia. `private` porque
    // depende de la sesion: ningun proxy intermedio debe quedarse con una copia.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');

    stream.on('error', () => res.destroy());
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
}

module.exports = { listar, subirVoz, audio };
