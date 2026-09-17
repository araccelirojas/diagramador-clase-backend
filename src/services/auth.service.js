const usuarioRepository = require('../repositories/usuario.repository');
const password = require('../utils/password');
const jwt = require('../utils/jwt');
const AppError = require('../utils/AppError');
const { requiereTexto, requiereCorreo, requierePassword } = require('../utils/validators');

function emitirToken(usuario) {
  const token = jwt.sign({ idUsuario: usuario.idUsuario, correo: usuario.correo });
  return { token, usuario };
}

async function registro(body) {
  const nombre = requiereTexto(body.nombre, 'nombre');
  const correo = requiereCorreo(body.correo);
  const plano = requierePassword(body.password);

  const existente = await usuarioRepository.findByCorreoWithPassword(correo);
  if (existente) throw new AppError('Ya existe un usuario con ese correo', 409);

  const usuario = await usuarioRepository.create({
    nombre,
    correo,
    password: await password.hash(plano),
  });

  return emitirToken(usuario);
}

async function login(body) {
  const correo = requiereCorreo(body.correo);
  const plano = requiereTexto(body.password, 'password');

  const usuario = await usuarioRepository.findByCorreoWithPassword(correo);

  // Mismo mensaje para correo inexistente y password incorrecta: no revelamos
  // que correos estan registrados.
  if (!usuario || !(await password.compare(plano, usuario.password))) {
    throw new AppError('Credenciales invalidas', 401);
  }

  if (!usuario.estado) throw new AppError('La cuenta esta desactivada', 403);

  const { password: _, ...sinPassword } = usuario;
  return emitirToken(sinPassword);
}

async function perfil(idUsuario) {
  const usuario = await usuarioRepository.findById(idUsuario);
  if (!usuario) throw new AppError('Usuario no encontrado', 404);
  return usuario;
}

module.exports = { registro, login, perfil };
