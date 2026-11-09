const AppError = require('../utils/AppError');

/**
 * Una cola por sala para las preguntas a la IA (CU-02).
 *
 * Dentro de una sala las preguntas se contestan de a una y en orden: si dos personas
 * preguntan a la vez, la segunda respuesta tiene que ver la primera en el historial, y
 * el chat no puede quedar con las respuestas cruzadas. Salas distintas no se esperan.
 *
 * Con tope: una sala no puede encolar preguntas sin fin mientras la IA esta lenta.
 */
function crearCola({ maxPendientes = 5 } = {}) {
  const salas = new Map();

  function encolar(idSala, tarea) {
    const sala = salas.get(idSala) || { cola: Promise.resolve(), pendientes: 0 };

    if (sala.pendientes >= maxPendientes) {
      return Promise.reject(
        new AppError('La IA tiene demasiadas preguntas pendientes en esta sala. Esperá un momento.', 429),
      );
    }

    sala.pendientes += 1;
    salas.set(idSala, sala);

    // El contador baja ANTES de que quien espera se entere del resultado: si no, una
    // pregunta hecha justo al terminar la anterior la veria todavia ocupando lugar.
    const resultado = sala.cola.then(async () => {
      try {
        return await tarea();
      } finally {
        sala.pendientes -= 1;
        if (sala.pendientes === 0) salas.delete(idSala);
      }
    });

    // Una tarea que falla no corta la cola: la siguiente arranca igual.
    sala.cola = resultado.catch(() => {});

    return resultado;
  }

  const pendientes = (idSala) => (salas.get(idSala) ? salas.get(idSala).pendientes : 0);

  return { encolar, pendientes };
}

module.exports = { crearCola };
