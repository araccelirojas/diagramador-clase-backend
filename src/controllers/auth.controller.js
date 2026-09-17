const service = require('../services/auth.service');

async function registro(req, res, next) {
  try {
    res.status(201).json(await service.registro(req.body));
  } catch (error) {
    next(error);
  }
}

async function login(req, res, next) {
  try {
    res.json(await service.login(req.body));
  } catch (error) {
    next(error);
  }
}

async function perfil(req, res, next) {
  try {
    res.json(await service.perfil(req.usuario.idUsuario));
  } catch (error) {
    next(error);
  }
}

module.exports = { registro, login, perfil };
