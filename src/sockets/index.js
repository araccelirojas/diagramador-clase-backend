const { Server } = require('socket.io');

const jwt = require('../utils/jwt');
const proyectoService = require('../services/proyecto.service');
const { corsOrigins, autosaveIntervalMs } = require('../config/env');
const {
  nombreDeSala,
  obtenerSala,
  detenerTemporizador,
  cerrarSala,
  pedirSnapshot,
} = require('./salas');

/**
 * Colaboracion en tiempo real.
 *
 * Cada proyecto tiene su sala ("proyecto:<uuid>") y los cambios se difunden a
 * todos los que estan dentro. Lo que viaja son los COMANDOS del editor, que ya
 * son objetos JSON serializables por diseno, no el documento entero: mover una
 * caja son unas decenas de bytes, no un diagrama completo.
 *
 * El guardado es aparte y no viaja con cada cambio. Ver `salas.js`: un
 * temporizador por sala, del lado del servidor.
 */

function idDeSocket(socket) {
  return socket.data.usuario.idUsuario;
}

/** Marca la sala como sucia y arranca su temporizador si aun no corre. */
function asegurarTemporizador(io, sala) {
  sala.sucia = true;
  sala.version += 1;

  if (sala.temporizador) return;

  sala.temporizador = setInterval(async () => {
    if (!sala.sucia) return;

    // La version ANTES de pedir el documento: lo que llegue despues no puede
    // darse por guardado.
    const versionPedida = sala.version;

    const snapshot = await pedirSnapshot(io, sala, 'autoguardado');
    if (!snapshot) return;

    try {
      await proyectoService.guardarContenido(
        sala.idProyecto,
        snapshot.contenido,
        snapshot.idUsuario,
      );

      // Solo si nadie toco nada mientras tanto. Si alguien lo hizo, la sala
      // sigue sucia y el proximo tick lo escribe; sin esto ese cambio se
      // perderia hasta que alguien volviera a editar.
      if (sala.version === versionPedida) sala.sucia = false;
      io.to(nombreDeSala(sala.idProyecto)).emit('guardado', { at: Date.now() });
    } catch (error) {
      io.to(nombreDeSala(sala.idProyecto)).emit('error-guardado', {
        message: error.isOperational ? error.message : 'No se pudo guardar el diagrama.',
      });
    }
  }, autosaveIntervalMs);
}

/** Quien manda el documento cuando toca guardar. El primero que quede sirve. */
async function reasignarEscritor(io, sala) {
  const sockets = await io.in(nombreDeSala(sala.idProyecto)).fetchSockets();

  if (sockets.length === 0) {
    cerrarSala(sala.idProyecto);
    return;
  }

  if (!sockets.some((socket) => socket.id === sala.escritor)) {
    sala.escritor = sockets[0].id;
  }
}

function registrar(io, socket) {
  let idProyectoActual = null;

  const salir = async () => {
    if (!idProyectoActual) return;

    const sala = obtenerSala(idProyectoActual);
    const nombre = nombreDeSala(idProyectoActual);

    socket.leave(nombre);
    socket.to(nombre).emit('salio', { idUsuario: idDeSocket(socket) });

    const quedan = await io.in(nombre).fetchSockets();

    if (quedan.length === 0) {
      // Se fue el ultimo: no queda a quien pedirle el documento, asi que el
      // temporizador de la sala muere con ella. Lo que quedara sin guardar lo
      // cubre el guardado de salida del propio cliente (useAutosave), que es
      // la otra mitad del trato.
      detenerTemporizador(sala);
      cerrarSala(idProyectoActual);
    } else {
      await reasignarEscritor(io, sala);
    }

    idProyectoActual = null;
  };

  socket.on('unirse', async ({ idProyecto } = {}, respuesta) => {
    const responder = typeof respuesta === 'function' ? respuesta : () => {};

    try {
      // La misma regla que el REST: dueno o invitado aceptado. Sin esto la
      // sala seria una puerta trasera al contenido de cualquier proyecto.
      const proyecto = await proyectoService.getById(idProyecto, idDeSocket(socket));

      await salir();

      idProyectoActual = proyecto.idProyecto;
      const nombre = nombreDeSala(idProyectoActual);
      const sala = obtenerSala(idProyectoActual);

      socket.join(nombre);

      const antes = await io.in(nombre).fetchSockets();
      const soloYo = antes.length === 1;

      await reasignarEscritor(io, sala);

      socket.to(nombre).emit('entro', {
        idUsuario: idDeSocket(socket),
        nombre: socket.data.usuario.nombre ?? null,
      });

      // Quien llega tarde no puede fiarse de la base: puede haber cambios en
      // las pantallas de los demas que todavia no se guardaron. Se los pedimos.
      const estado = soloYo ? null : await pedirSnapshot(io, sala, 'estado-inicial');

      responder({
        ok: true,
        contenido: estado ? estado.contenido : null,
        miembros: antes.length,
      });
    } catch (error) {
      responder({
        ok: false,
        message: error.isOperational ? error.message : 'No se pudo entrar al proyecto.',
      });
    }
  });

  /** Un cambio del editor: se reparte y marca la sala para el proximo guardado. */
  socket.on('cambio', (payload) => {
    if (!idProyectoActual) return;

    const nombre = nombreDeSala(idProyectoActual);
    // `socket.to` excluye al que lo mando: ya lo aplico en su pantalla.
    socket.to(nombre).emit('cambio', { ...payload, de: idDeSocket(socket) });

    asegurarTemporizador(io, obtenerSala(idProyectoActual));
  });

  /** Respuesta a `pedir-snapshot`. */
  socket.on('snapshot', ({ contenido } = {}) => {
    if (!idProyectoActual) return;

    const sala = obtenerSala(idProyectoActual);
    if (!sala.esperando) return;

    sala.esperando({ contenido, idUsuario: idDeSocket(socket) });
  });

  socket.on('disconnect', () => {
    void salir();
  });
}

function crearServidorDeSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins.length ? corsOrigins : '*',
      methods: ['GET', 'POST'],
    },
  });

  // Mismo JWT que el REST. Un socket sin token no llega a tener sala.
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;

    if (!token) return next(new Error('Token no proporcionado'));

    try {
      const payload = jwt.verify(token);
      socket.data.usuario = { idUsuario: payload.idUsuario, correo: payload.correo };
      next();
    } catch (error) {
      next(new Error(error.name === 'TokenExpiredError' ? 'Token expirado' : 'Token invalido'));
    }
  });

  io.on('connection', (socket) => registrar(io, socket));

  return io;
}

module.exports = { crearServidorDeSockets };
