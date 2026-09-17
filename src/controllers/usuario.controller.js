const service = require('../services/usuario.service');

async function list(req, res, next) {
  try {
    res.json(await service.list());
  } catch (error) {
    next(error);
  }
}

async function getById(req, res, next) {
  try {
    res.json(await service.getById(req.params.id));
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

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id, req.usuario.idUsuario);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = { list, getById, update, remove };
