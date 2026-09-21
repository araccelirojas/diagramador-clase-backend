const { Router } = require('express');
const auth = require('../middlewares/auth');

const authRoutes = require('./auth.routes');
const usuarioRoutes = require('./usuario.routes');
const proyectoRoutes = require('./proyecto.routes');
const invitacionRoutes = require('./invitacion.routes');
const bocetoRoutes = require('./boceto.routes');
const vozRoutes = require('./voz.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));

// Publicas (registro y login).
router.use('/auth', authRoutes);

// Protegidas: exigen "Authorization: Bearer <token>".
router.use('/usuarios', auth, usuarioRoutes);
router.use('/proyectos', auth, proyectoRoutes);
router.use('/invitaciones', auth, invitacionRoutes);
router.use('/boceto', auth, bocetoRoutes);
router.use('/voz', auth, vozRoutes);

module.exports = router;
