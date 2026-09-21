const proyectoService = require('../services/proyecto.service');

/**
 * El estado vivo de cada sala.
 *
 * Una sala por proyecto, y **un solo temporizador de guardado por sala**: no
 * uno por persona conectada. Si hay tres colaboradores no hay tres contadores
 * desfasados escribiendo lo mismo tres veces; hay uno, del lado del servidor,
 * que es el unico que decide cuando se persiste.
 *
 * El servidor no aplica los comandos ni entiende el modelo UML: eso vive en el
 * frontend y duplicarlo aca seria tener dos verdades. Lo que hace es marcar la
 * sala como sucia cuando pasa algo, y al vencer el plazo pedirle el documento
 * completo a un cliente (el "escritor") para guardarlo.
 */

const salas = new Map();

function nombreDeSala(idProyecto) {
  return `proyecto:${idProyecto}`;
}

function obtenerSala(idProyecto) {
  let sala = salas.get(idProyecto);

  if (!sala) {
    sala = {
      idProyecto,
      // socket.id del cliente al que se le pide el documento para guardar.
      escritor: null,
      // Hubo cambios desde el ultimo guardado. Sin esto el temporizador
      // escribiria cada n segundos aunque nadie haya tocado nada.
      sucia: false,
      // Sube con cada cambio. Es lo que distingue "ya guarde todo" de "guarde
      // una foto vieja": si la version cambio entre que pedimos el documento y
      // que terminamos de escribirlo, la sala sigue sucia y se vuelve a guardar.
      version: 0,
      temporizador: null,
      // Resuelve el snapshot que pedimos, o null si no hay ninguno pendiente.
      esperando: null,
    };
    salas.set(idProyecto, sala);
  }

  return sala;
}

function detenerTemporizador(sala) {
  if (sala.temporizador) {
    clearInterval(sala.temporizador);
    sala.temporizador = null;
  }
}

function cerrarSala(idProyecto) {
  const sala = salas.get(idProyecto);
  if (!sala) return;

  detenerTemporizador(sala);
  salas.delete(idProyecto);
}

/**
 * Pide el documento al escritor y espera su respuesta.
 *
 * Con timeout: si el escritor se cae justo despues de que se le pregunte, la
 * sala no puede quedarse esperando para siempre y sin volver a guardar nunca.
 */
function pedirSnapshot(io, sala, motivo, tiempoLimite = 5000) {
  return new Promise((resolve) => {
    const escritor = sala.escritor && io.sockets.sockets.get(sala.escritor);

    if (!escritor) {
      resolve(null);
      return;
    }

    let resuelto = false;

    const terminar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      sala.esperando = null;
      resolve(valor);
    };

    sala.esperando = terminar;
    setTimeout(() => terminar(null), tiempoLimite);

    escritor.emit('pedir-snapshot', { motivo });
  });
}

module.exports = {
  nombreDeSala,
  obtenerSala,
  detenerTemporizador,
  cerrarSala,
  pedirSnapshot,
  salas,
  proyectoService,
};
