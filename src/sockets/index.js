const { Server } = require('socket.io');

const jwt = require('../utils/jwt');
const proyectoService = require('../services/proyecto.service');
const usuarioRepository = require('../repositories/usuario.repository');
const proyectoRepository = require('../repositories/proyecto.repository');
const mensajeService = require('../services/mensaje.service');
const versionService = require('../services/version.service');
const ia = require('../ia');
const votaciones = require('../votacion');
const {
  registrarIo,
  emitirASala,
  nombresEnSala,
  usuariosEnSala,
  pedirAUnoDeLaSala,
} = require('./emisor');
const { corsOrigins, autosaveIntervalMs } = require('../config/env');
const {
  salas,
  nombreDeSala,
  obtenerSala,
  detenerTemporizador,
  cerrarSala,
  pedirSnapshot,
} = require('./salas');
const { normalizarEfimero, presenciaInicial, recordar, participanteDe } = require('./presencia');
const { registrarLlamada } = require('../llamada');
const llamadas = require('../llamada/llamadas');

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

      // CU-05: de paso, una version automatica si toca. Un fallo aca no es un fallo
      // del guardado: el diagrama ya esta escrito.
      versionService
        .automatica(sala.idProyecto, snapshot.contenido, snapshot.idUsuario)
        .catch((error) => console.error('Version automatica:', error.message));
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
  // Para el contexto de la IA (CU-02): el nombre del proyecto sin otra consulta.
  let nombreProyectoActual = null;

  // La llamada de voz grupal y Jarvis (ver `llamada/index.js`).
  const llamada = registrarLlamada(io, socket, () =>
    idProyectoActual ? { idProyecto: idProyectoActual, nombreProyecto: nombreProyectoActual } : null,
  );

  /**
   * `motivo` le dice a los demas si la persona se fue (cerro el editor, cambio
   * de proyecto) o se le corto la conexion. En el segundo caso la muestran como
   * "desconectado" un rato, porque lo normal es que vuelva sola.
   */
  const salir = async (motivo = 'salida') => {
    if (!idProyectoActual) return;

    const sala = obtenerSala(idProyectoActual);
    const nombre = nombreDeSala(idProyectoActual);

    socket.leave(nombre);
    // Fuera de la sala no se puede seguir en su llamada.
    llamada.alSalirDeSala(idProyectoActual);
    socket.to(nombre).emit('salio', {
      idSocket: socket.id,
      idUsuario: idDeSocket(socket),
      nombre: socket.data.usuario.nombre,
      motivo,
    });

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

    // CU-04: quien se fue ya no "falta" votar, y quizas los que quedan ya votaron todos.
    void votaciones.revisar(sala.idProyecto);

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
      nombreProyectoActual = proyecto.nombre;
      const nombre = nombreDeSala(idProyectoActual);
      const sala = obtenerSala(idProyectoActual);

      // Cada sala empieza de cero: el estado de la anterior no viaja con uno.
      socket.data.presencia = presenciaInicial();
      socket.join(nombre);

      const antes = await io.in(nombre).fetchSockets();
      const soloYo = antes.length === 1;

      await reasignarEscritor(io, sala);

      socket.to(nombre).emit('entro', participanteDe(socket));

      // Quien llega tarde no puede fiarse de la base: puede haber cambios en
      // las pantallas de los demas que todavia no se guardaron. Se los pedimos.
      const estado = soloYo ? null : await pedirSnapshot(io, sala, 'estado-inicial');

      // Se vuelve a preguntar: alguien pudo entrar o irse mientras esperabamos
      // el snapshot. Incluye a quien pregunta; el cliente se reconoce por su
      // socket.id.
      const presentes = await io.in(nombre).fetchSockets();

      responder({
        ok: true,
        contenido: estado ? estado.contenido : null,
        miembros: presentes.length,
        participantes: presentes.map(participanteDe),
        // CU-04: la votacion en curso, y una reversion que cerro con la sala vacia y no
        // tuvo a quien llegar. Solo a quien entra solo: si hay alguien, ya la recibio.
        votacion: votaciones.estadoPublico(idProyectoActual, await usuariosEnSala(idProyectoActual)),
        reversion: soloYo ? votaciones.tomarReversionPendiente(idProyectoActual) : null,
        // Quien esta en la llamada de voz, para ofrecer unirse.
        llamada: llamadas.participantes(idProyectoActual),
      });

      // Uno mas que puede votar: los demas lo ven entre los que faltan.
      void votaciones.revisar(idProyectoActual);
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

  /**
   * Cursor, seleccion y estado. Se reenvian y nada mas: no ensucian la sala ni
   * pasan por el guardado (ver `presencia.js`).
   */
  socket.on('efimero', (payload) => {
    if (!idProyectoActual) return;

    const mensaje = normalizarEfimero(payload);
    if (!mensaje) return;

    recordar(socket.data.presencia, mensaje);

    // Solo el cursor es volatile: si la red va lenta, un cursor viejo no vale
    // la pena encolarlo y el siguiente lo reemplaza. Un estado o una seleccion
    // perdidos, en cambio, se quedan mal hasta el proximo cambio.
    const emisor = mensaje.tipo === 'cursor' ? socket.volatile : socket;
    emisor.to(nombreDeSala(idProyectoActual)).emit('efimero', { ...mensaje, de: socket.id });
  });

  /**
   * Un mensaje del chat (CU-02). Se guarda, se reparte a toda la sala (incluido quien lo
   * mando: sus otras pestanas tambien lo tienen que ver) y, si menciona a @IA, la IA lo
   * contesta en segundo plano.
   *
   * El ack lleva el mensaje guardado: es lo que convierte el "enviando..." del cliente en
   * un mensaje real. Si no llega, el cliente reintenta con el mismo `idCliente`.
   */
  socket.on('mensaje', async (payload = {}, respuesta) => {
    const responder = typeof respuesta === 'function' ? respuesta : () => {};

    if (!idProyectoActual) {
      responder({ ok: false, message: 'No estás en ninguna sala.' });
      return;
    }

    const idProyecto = idProyectoActual;
    const nombre = nombreDeSala(idProyecto);

    try {
      const { mensaje, duplicado } = await mensajeService.enviar(
        idProyecto,
        idDeSocket(socket),
        payload,
      );

      responder({ ok: true, mensaje });

      // Un reintento de algo ya guardado: los demas ya lo vieron y la IA ya lo tiene.
      if (duplicado) return;

      io.to(nombre).emit('mensaje', mensaje);

      if (ia.mencionaIA(mensaje.texto)) {
        void ia.responderPregunta({
          idProyecto,
          pregunta: mensaje,
          diagrama: payload.diagrama,
          nombreProyecto: nombreProyectoActual,
          participantes: () => nombresEnSala(idProyecto),
          emitir: (evento, datos) => io.to(nombre).emit(evento, datos),
          cambios: votaciones.cambiosPara(idProyecto, idDeSocket(socket)),
        });
      } else {
        // CU-04: "si", "dale", "no, descartalo" mientras la sala vota.
        void votaciones.votarPorMensaje(idProyecto, socket.data.usuario, mensaje.texto);
      }
    } catch (error) {
      if (!error.isOperational) console.error('Chat:', error);
      responder({
        ok: false,
        message: error.isOperational ? error.message : 'No se pudo enviar el mensaje.',
      });
    }
  });

  /** Un voto con los botones del chat (CU-04). */
  socket.on('votar', async ({ idPropuesta, voto } = {}, respuesta) => {
    const responder = typeof respuesta === 'function' ? respuesta : () => {};

    if (!idProyectoActual) {
      responder({ ok: false, message: 'No estás en ninguna sala.' });
      return;
    }

    try {
      responder(
        await votaciones.votar(
          idProyectoActual,
          socket.data.usuario,
          voto,
          typeof idPropuesta === 'string' ? idPropuesta : null,
        ),
      );
    } catch (error) {
      console.error('Votacion:', error);
      responder({ ok: false, message: 'No se pudo registrar el voto.' });
    }
  });

  /** Respuesta a `pedir-snapshot`. */
  socket.on('snapshot', ({ contenido } = {}) => {
    if (!idProyectoActual) return;

    const sala = obtenerSala(idProyectoActual);
    if (!sala.esperando) return;

    sala.esperando({ contenido, idUsuario: idDeSocket(socket) });
  });

  socket.on('disconnect', (razon) => {
    // Cerrar el editor desconecta "del lado del cliente"; todo lo demas
    // (red caida, ping vencido, servidor reiniciado) es un corte.
    void salir(razon === 'client namespace disconnect' ? 'salida' : 'desconexion');
  });
}

function crearServidorDeSockets(httpServer) {
  const io = new Server(httpServer, {
    // El diagrama entero viaja por aqui (undo, importar, y como contexto de la IA en
    // CU-02). Con el 1 MB por defecto, un diagrama grande cortaria la conexion.
    maxHttpBufferSize: 5e6,
    cors: {
      origin: corsOrigins.length ? corsOrigins : '*',
      methods: ['GET', 'POST'],
    },
  });

  // Mismo JWT que el REST. Un socket sin token no llega a tener sala.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;

    if (!token) return next(new Error('Token no proporcionado'));

    let payload;
    try {
      payload = jwt.verify(token);
    } catch (error) {
      return next(
        new Error(error.name === 'TokenExpiredError' ? 'Token expirado' : 'Token invalido'),
      );
    }

    try {
      // El nombre no viaja en el token, y es lo que los demas ven en la lista
      // de participantes y junto al cursor. Se lee una vez, al conectar.
      const usuario = await usuarioRepository.findById(payload.idUsuario);

      if (!usuario) return next(new Error('Usuario no encontrado'));
      if (!usuario.estado) return next(new Error('La cuenta esta desactivada'));

      socket.data.usuario = {
        idUsuario: usuario.idUsuario,
        correo: usuario.correo,
        nombre: usuario.nombre,
      };
      socket.data.presencia = presenciaInicial();
      next();
    } catch {
      next(new Error('No se pudo validar la sesion'));
    }
  });

  io.on('connection', (socket) => registrar(io, socket));

  // Para lo que llega por HTTP y tiene que avisar a una sala (notas de voz, CU-03).
  registrarIo(io);

  // CU-04: lo que las votaciones necesitan de las salas.
  votaciones.configurar({
    usuariosEnSala,
    emitir: emitirASala,
    pedirPropuesta: (idProyecto, idUsuario, datos) =>
      pedirAUnoDeLaSala(idProyecto, idUsuario, 'ia-propuesta', datos),
    difundirCambio: async (idProyecto, comando) => {
      const nombre = nombreDeSala(idProyecto);
      const sockets = await io.in(nombre).fetchSockets();
      if (sockets.length === 0) return false;

      // Como cualquier otro cambio: a toda la sala, y la sala queda para guardar.
      io.to(nombre).emit('cambio', { kind: 'command', command: comando, de: 'ia' });
      asegurarTemporizador(io, obtenerSala(idProyecto));
      return true;
    },
    guardarResultado: (idProyecto, { texto, mencionA }) =>
      mensajeService.guardarRespuestaIA(idProyecto, { texto, respondeA: null, mencionA }),
    // CU-05: lo conservado queda como version. El diagrama se le pide a la sala, que ya
    // tiene el cambio aplicado; si se fueron todos, lo ultimo guardado.
    alConservar: async (idProyecto, votacion) => {
      const sala = salas.get(idProyecto);
      const snapshot = sala ? await pedirSnapshot(io, sala, 'version') : null;
      const proyecto = snapshot ? null : await proyectoRepository.findById(idProyecto);
      const contenido = snapshot ? snapshot.contenido : proyecto && proyecto.contenido;
      if (!contenido) return;

      await versionService.desdeIA(idProyecto, {
        contenido,
        idUsuario: votacion.solicitante ? votacion.solicitante.idUsuario : null,
        cambios: votacion.cambios,
      });
    },
  });

  return io;
}

module.exports = { crearServidorDeSockets };
