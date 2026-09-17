const service = require('../services/proyecto.service');

async function list(req, res, next) {
  try {
    res.json(await service.list(req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

async function getById(req, res, next) {
  try {
    res.json(await service.getById(req.params.id, req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  try {
    res.status(201).json(await service.create(req.body, req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    res.json(await service.update(req.params.id, req.body, req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

// PUT /proyectos/:id/contenido -> guardar el diagrama
async function guardarContenido(req, res, next) {
  try {
    res.json(await service.guardarContenido(req.params.id, req.body.contenido, req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

// GET /proyectos/:id/contenido -> cargar el diagrama
async function cargarContenido(req, res, next) {
  try {
    const proyecto = await service.getById(req.params.id, req.usuario.idUsuario);
    res.json({ idProyecto: proyecto.idProyecto, contenido: proyecto.contenido });
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id, req.usuario.idUsuario);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = { list, getById, create, update, guardarContenido, cargarContenido, remove };
