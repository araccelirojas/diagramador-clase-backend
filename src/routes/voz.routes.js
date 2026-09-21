const { Router } = require('express');

const controller = require('../controllers/voz.controller');

const router = Router();

router.post('/sesion', controller.sesion);

module.exports = router;
