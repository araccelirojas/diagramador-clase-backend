const jwt = require('../utils/jwt');
const AppError = require('../utils/AppError');

// Exige "Authorization: Bearer <token>" y deja el usuario en req.usuario.
module.exports = (req, res, next) => {
  const header = req.headers.authorization || '';
  const [esquema, token] = header.split(' ');

  if (esquema !== 'Bearer' || !token) {
    return next(new AppError('Token no proporcionado', 401));
  }

  try {
    const payload = jwt.verify(token);
    req.usuario = { idUsuario: payload.idUsuario, correo: payload.correo };
    next();
  } catch (error) {
    const expirado = error.name === 'TokenExpiredError';
    next(new AppError(expirado ? 'Token expirado' : 'Token invalido', 401));
  }
};
