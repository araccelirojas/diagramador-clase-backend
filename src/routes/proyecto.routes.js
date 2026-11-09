const { Router } = require('express');
const multer = require('multer');
const controller = require('../controllers/proyecto.controller');
const mensajeController = require('../controllers/mensaje.controller');
const versionController = require('../controllers/version.controller');
const validarUuid = require('../middlewares/validarUuid');
const AppError = require('../utils/AppError');
const { audioMaxBytes } = require('../config/env');

const router = Router();
const id = validarUuid('id');

// Notas de voz (CU-03): en memoria, porque el mismo buffer va al disco y a la
// transcripcion. `fieldSize` alto: el diagrama viaja como campo cuando la nota es
// para la IA, y el limite por defecto de multer (1 MB) lo cortaria.
const subidaAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: audioMaxBytes, files: 1, fieldSize: 5 * 1024 * 1024 },
});

function recibirAudio(req, res, next) {
  subidaAudio.single('audio')(req, res, (error) => {
    if (!error) return next();

    const esTamano = error.code === 'LIMIT_FILE_SIZE';
    next(
      new AppError(
        esTamano
          ? `La nota de voz supera el máximo de ${Math.round(audioMaxBytes / 1024 / 1024)} MB.`
          : 'No se pudo leer el audio enviado.',
        esTamano ? 413 : 400,
      ),
    );
  });
}

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', id, controller.getById);
router.put('/:id', id, controller.update);
router.delete('/:id', id, controller.remove);

// Carga y guardado del diagrama (campo "contenido").
router.get('/:id/contenido', id, controller.cargarContenido);
router.put('/:id/contenido', id, controller.guardarContenido);

// Descarga del backend Spring Boot generado a partir del diagrama.
router.get('/:id/exportar', id, controller.exportar);

// Chat de la sala (CU-02). Los mensajes nuevos llegan por el socket; esto es el
// historial, paginado hacia atras.
router.get('/:id/mensajes', id, mensajeController.listar);
router.post('/:id/mensajes/voz', id, recibirAudio, mensajeController.subirVoz);
router.get('/:id/mensajes/:idMensaje/audio', id, validarUuid('idMensaje'), mensajeController.audio);

// Historial de versiones (CU-05). Una version sola, con su contenido: GET /versiones/:id.
router.get('/:id/versiones', id, versionController.listar);
router.post('/:id/versiones', id, versionController.guardar);
router.post('/:id/versiones/:idVersion/restaurar', id, validarUuid('idVersion'), versionController.restaurar);

module.exports = router;
