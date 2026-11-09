const service = require('../services/version.service');

/** Historial de versiones del diagrama (CU-05). */

// GET /proyectos/:id/versiones?limite=&antesDe= -> de la mas nueva a la mas vieja, sin contenido
async function listar(req, res, next) {
  try {
    res.json(await service.listar(req.params.id, req.usuario.idUsuario, req.query));
  } catch (error) {
    next(error);
  }
}

// POST /proyectos/:id/versiones { nombre?, contenido } -> "Guardar version"
async function guardar(req, res, next) {
  try {
    res.status(201).json(await service.guardarManual(req.params.id, req.usuario.idUsuario, req.body));
  } catch (error) {
    next(error);
  }
}

// POST /proyectos/:id/versiones/:idVersion/restaurar { contenidoActual } -> { version, respaldo }
async function restaurar(req, res, next) {
  try {
    res.json(
      await service.restaurar(req.params.id, req.params.idVersion, req.usuario.idUsuario, req.body),
    );
  } catch (error) {
    next(error);
  }
}

// GET /versiones/:id -> una version con su contenido
async function obtener(req, res, next) {
  try {
    res.json(await service.obtener(req.params.id, req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

module.exports = { listar, guardar, restaurar, obtener };
