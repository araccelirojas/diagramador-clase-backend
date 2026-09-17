const service = require('../services/invitacion.service');

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

async function responder(req, res, next) {
  try {
    res.json(await service.responder(req.params.id, req.body.estado, req.usuario.idUsuario));
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

module.exports = { list, getById, create, responder, remove };
