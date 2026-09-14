const { Router } = require('express');
const diagramRoutes = require('./diagram.routes');

const router = Router();

router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.use('/diagrams', diagramRoutes);

module.exports = router;
