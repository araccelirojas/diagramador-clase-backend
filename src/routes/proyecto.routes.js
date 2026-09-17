const { Router } = require('express');
const controller = require('../controllers/proyecto.controller');
const validarUuid = require('../middlewares/validarUuid');

const router = Router();
const id = validarUuid('id');

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', id, controller.getById);
router.put('/:id', id, controller.update);
router.delete('/:id', id, controller.remove);

// Carga y guardado del diagrama (campo "contenido").
router.get('/:id/contenido', id, controller.cargarContenido);
router.put('/:id/contenido', id, controller.guardarContenido);

module.exports = router;
