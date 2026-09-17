const { Router } = require('express');
const controller = require('../controllers/usuario.controller');
const validarUuid = require('../middlewares/validarUuid');

const router = Router();
const id = validarUuid('id');

router.get('/', controller.list);
router.get('/:id', id, controller.getById);
router.put('/:id', id, controller.update);
router.delete('/:id', id, controller.remove);

module.exports = router;
