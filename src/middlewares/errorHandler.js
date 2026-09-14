const { nodeEnv } = require('../config/env');

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  if (!err.isOperational) console.error(err);

  res.status(statusCode).json({
    message: err.isOperational ? err.message : 'Error interno del servidor',
    ...(nodeEnv === 'development' && !err.isOperational ? { stack: err.stack } : {}),
  });
};
