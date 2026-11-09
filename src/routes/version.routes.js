const { Router } = require('express');
const controller = require('../controllers/version.controller');
const validarUuid = require('../middlewares/validarUuid');

/** GET /versiones/:id (CU-05). Las que cuelgan del proyecto estan en proyecto.routes.js. */
const router = Router();

router.get('/:id', validarUuid('id'), controller.obtener);

module.exports = router;
