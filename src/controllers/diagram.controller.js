const service = require('../services/diagram.service');

// Solo traduce HTTP <-> servicio. Los errores van al errorHandler via next().
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

async function create(req, res, next) {
  try {
    res.status(201).json(await service.create(req.body));
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    res.json(await service.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
}

async function remove(req, res, next) {
  try {
    await service.remove(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = { list, getById, create, update, remove };
