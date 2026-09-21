const { Router } = require('express');
const multer = require('multer');

const controller = require('../controllers/boceto.controller');
const AppError = require('../utils/AppError');
const { bocetoMaxBytes } = require('../config/env');

const router = Router();

// En memoria: la imagen viaja a OpenAI y se descarta. Escribirla en disco solo dejaria
// fotos de pizarras acumulandose en el servidor.
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: bocetoMaxBytes, files: 1 },
});

/** Traduce el error de multer a uno del formato de la API, en vez de un 500. */
function recibirImagen(req, res, next) {
  subida.single('imagen')(req, res, (error) => {
    if (!error) return next();

    const esTamano = error.code === 'LIMIT_FILE_SIZE';
    next(
      new AppError(
        esTamano
          ? `La imagen supera el máximo de ${Math.round(bocetoMaxBytes / 1024 / 1024)} MB.`
          : 'No se pudo leer la imagen enviada.',
        esTamano ? 413 : 400,
      ),
    );
  });
}

router.post('/interpretar', recibirImagen, controller.interpretar);

module.exports = router;
