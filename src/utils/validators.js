const AppError = require('./AppError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiereTexto(valor, campo) {
  if (typeof valor !== 'string' || !valor.trim()) {
    throw new AppError(`El campo "${campo}" es obligatorio`, 422);
  }
  return valor.trim();
}

function requiereCorreo(valor) {
  const correo = requiereTexto(valor, 'correo').toLowerCase();
  if (!CORREO_RE.test(correo)) throw new AppError('El correo no tiene un formato valido', 422);
  return correo;
}

function requierePassword(valor) {
  const password = requiereTexto(valor, 'password');
  if (password.length < 8) {
    throw new AppError('La password debe tener al menos 8 caracteres', 422);
  }
  return password;
}

function requiereUuid(valor, campo) {
  if (typeof valor !== 'string' || !UUID_RE.test(valor)) {
    throw new AppError(`El campo "${campo}" debe ser un UUID valido`, 422);
  }
  return valor;
}

module.exports = { requiereTexto, requiereCorreo, requierePassword, requiereUuid, UUID_RE };
