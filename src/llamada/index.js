const llamadas = require('./llamadas');
const { detectarJarvis, crearFiltroDeRepetidas } = require('./jarvis');
const { interpretarVoto } = require('../votacion/interpretar');
const votaciones = require('../votacion');
const mensajeService = require('../services/mensaje.service');
const ia = require('../ia');
const { nombreDeSala } = require('../sockets/salas');
const { nombresEnSala } = require('../sockets/emisor');
const { llamadaTurn } = require('../config/env');

/**
 * La llamada de voz grupal de cada sala, y Jarvis dentro de ella.
 *
 *   llamada:entrar   (ack)  -> { ok, otros, iceServers }: quien entra llama a los `otros`
 *   llamada:salir
 *   llamada:senal    { para, datos }  -> reenviado tal cual a `para` como { de, datos }
 *   llamada:silencio { silenciado }
 *   llamada:jarvis   (ack)  { texto, idCliente, diagrama }: alguien le hablo a Jarvis
 *
 * A toda la sala, no solo a la llamada:
 *   llamada:estado   { participantes }  cada vez que alguien entra, sale o se silencia
 *   llamada:pregunta { idMensaje, nombre, texto }  la respuesta a ese mensaje se escucha
 *                                                    en la llamada
 *
 * Jarvis es la misma IA del chat (CU-02 a CU-04): lo que se le dice queda en el chat como
 * mensaje de quien hablo, la respuesta llega como nota de voz de la IA, y si cambia el
 * diagrama la sala vota como siempre. Lo unico propio es que su respuesta suena en la
 * llamada para todos.
 */

/** Servidores para que dos navegadores se encuentren a traves de sus routers. */
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const ICE_SERVERS = llamadaTurn ? [...STUN, llamadaTurn] : STUN;

/** Lo que se guarda en el chat delante de lo que se le dijo a Jarvis en la llamada. */
const PREFIJO_LLAMADA = '📞 ';

const MAX_LARGO_PREGUNTA = 1000;
/** Una oferta SDP con sus candidatos ronda los 5-10 KB. */
const MAX_LARGO_SENAL = 30000;

const esRepetida = crearFiltroDeRepetidas();

function difundirEstado(io, idProyecto) {
  io.to(nombreDeSala(idProyecto)).emit('llamada:estado', {
    participantes: llamadas.participantes(idProyecto),
  });
}

function sinRespuesta() {}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {() => { idProyecto: string, nombreProyecto: string | null } | null} salaActual
 */
function registrarLlamada(io, socket, salaActual) {
  socket.on('llamada:entrar', (_payload, respuesta) => {
    const responder = typeof respuesta === 'function' ? respuesta : sinRespuesta;
    const sala = salaActual();

    if (!sala) {
      responder({ ok: false, message: 'No estás en ninguna sala.' });
      return;
    }

    try {
      const { idUsuario, nombre } = socket.data.usuario;
      const otros = llamadas.entrar(sala.idProyecto, { idSocket: socket.id, idUsuario, nombre });
      responder({ ok: true, otros, iceServers: ICE_SERVERS });
      difundirEstado(io, sala.idProyecto);
    } catch (error) {
      responder({
        ok: false,
        message: error.isOperational ? error.message : 'No se pudo entrar a la llamada.',
      });
    }
  });

  socket.on('llamada:salir', () => {
    const sala = salaActual();
    if (sala && llamadas.salir(sala.idProyecto, socket.id)) difundirEstado(io, sala.idProyecto);
  });

  /**
   * Ofertas, respuestas y candidatos de WebRTC. El servidor no los mira: solo comprueba
   * que los dos esten en la misma llamada, para que nadie pueda tocarle la puerta a un
   * socket cualquiera.
   */
  socket.on('llamada:senal', ({ para, datos } = {}) => {
    const sala = salaActual();
    if (!sala || typeof para !== 'string' || !datos || typeof datos !== 'object') return;
    if (!llamadas.estaEn(sala.idProyecto, socket.id) || !llamadas.estaEn(sala.idProyecto, para)) return;
    if (JSON.stringify(datos).length > MAX_LARGO_SENAL) return;

    io.to(para).emit('llamada:senal', { de: socket.id, datos });
  });

  socket.on('llamada:silencio', ({ silenciado } = {}) => {
    const sala = salaActual();
    if (sala && llamadas.silenciar(sala.idProyecto, socket.id, silenciado)) {
      difundirEstado(io, sala.idProyecto);
    }
  });

  socket.on('llamada:jarvis', async (payload = {}, respuesta) => {
    const responder = typeof respuesta === 'function' ? respuesta : sinRespuesta;
    const sala = salaActual();

    if (!sala || !llamadas.estaEn(sala.idProyecto, socket.id)) {
      responder({ ok: false, message: 'No estás en la llamada.' });
      return;
    }

    const texto =
      typeof payload.texto === 'string' ? payload.texto.trim().slice(0, MAX_LARGO_PREGUNTA) : '';
    if (texto === '') {
      responder({ ok: false, message: 'No se entendió lo que le dijiste a Jarvis.' });
      return;
    }

    const { idProyecto, nombreProyecto } = sala;
    const usuario = socket.data.usuario;

    if (esRepetida(idProyecto, texto)) {
      responder({ ok: true, repetida: true });
      return;
    }

    try {
      // Mientras la sala vota, "Jarvis, conservalo" es un voto y no una pregunta.
      const deteccion = detectarJarvis(texto);
      const voto = votaciones.abierta(idProyecto)
        ? interpretarVoto(deteccion ? deteccion.resto : texto)
        : null;

      if (voto) {
        const resultado = await votaciones.votar(idProyecto, usuario, voto);
        responder(resultado.ok ? { ok: true, voto } : resultado);
        return;
      }

      const { mensaje, duplicado } = await mensajeService.enviar(idProyecto, usuario.idUsuario, {
        texto: `${PREFIJO_LLAMADA}${texto}`,
        idCliente: payload.idCliente,
      });

      responder({ ok: true, mensaje });
      if (duplicado) return;

      const nombre = nombreDeSala(idProyecto);
      // Antes que el mensaje: asi cada cliente ya sabe que la respuesta va a la llamada.
      io.to(nombre).emit('llamada:pregunta', {
        idMensaje: mensaje.idMensaje,
        nombre: usuario.nombre,
        texto,
      });
      io.to(nombre).emit('mensaje', mensaje);

      void ia.responderPregunta({
        idProyecto,
        pregunta: mensaje,
        diagrama: payload.diagrama,
        nombreProyecto,
        participantes: () => nombresEnSala(idProyecto),
        emitir: (evento, datos) => io.to(nombre).emit(evento, datos),
        enVoz: true,
        enLlamada: true,
        cambios: votaciones.cambiosPara(idProyecto, usuario.idUsuario),
      });
    } catch (error) {
      if (!error.isOperational) console.error('Jarvis:', error);
      responder({
        ok: false,
        message: error.isOperational ? error.message : 'Jarvis no pudo recibir la pregunta.',
      });
    }
  });

  return {
    /** Quien se va de la sala (o pierde la conexion) se va tambien de la llamada. */
    alSalirDeSala(idProyecto) {
      if (llamadas.salir(idProyecto, socket.id)) difundirEstado(io, idProyecto);
    },
  };
}

module.exports = { registrarLlamada, PREFIJO_LLAMADA, ICE_SERVERS };
