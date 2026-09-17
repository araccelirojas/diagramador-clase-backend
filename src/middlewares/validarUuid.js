const AppError = require('../utils/AppError');
const { UUID_RE } = require('../utils/validators');

// Evita llegar a Prisma con un id malformado (que daria un 500).
module.exports = (param) => (req, res, next) => {
  if (!UUID_RE.test(req.params[param])) {
    return next(new AppError(`El parametro "${param}" debe ser un UUID valido`, 400));
  }
  next();
};
