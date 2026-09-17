const { Router } = require('express');
const controller = require('../controllers/auth.controller');
const auth = require('../middlewares/auth');

const router = Router();

router.post('/registro', controller.registro);
router.post('/login', controller.login);
router.get('/perfil', auth, controller.perfil);

module.exports = router;
