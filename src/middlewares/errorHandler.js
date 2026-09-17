const { nodeEnv } = require('../config/env');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  // JSON malformado en el body (lo lanza express.json()).
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'El cuerpo de la peticion no es JSON valido' });
  }

  const statusCode = err.statusCode || 500;

  if (!err.isOperational) console.error(err);

  res.status(statusCode).json({
    message: err.isOperational ? err.message : 'Error interno del servidor',
    ...(nodeEnv === 'development' && !err.isOperational ? { stack: err.stack } : {}),
  });
};
