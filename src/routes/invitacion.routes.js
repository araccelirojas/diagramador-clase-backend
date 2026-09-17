const { Router } = require('express');
const controller = require('../controllers/invitacion.controller');
const validarUuid = require('../middlewares/validarUuid');

const router = Router();
const id = validarUuid('id');

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', id, controller.getById);
router.patch('/:id', id, controller.responder);
router.delete('/:id', id, controller.remove);

module.exports = router;
