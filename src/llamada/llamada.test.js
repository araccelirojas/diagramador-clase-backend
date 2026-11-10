const test = require('node:test');
const assert = require('node:assert/strict');

const llamadas = require('./llamadas');
const { detectarJarvis, crearFiltroDeRepetidas } = require('./jarvis');
const { construirMensajes } = require('../ia/contexto');

const P = 'proyecto-1';
const ana = { idSocket: 's-ana', idUsuario: 'u-ana', nombre: 'Ana' };
const beto = { idSocket: 's-beto', idUsuario: 'u-beto', nombre: 'Beto' };

test.beforeEach(() => llamadas.reiniciar());

/* ------------------------------------------------------------------ */
/* Quien esta en la llamada                                            */
/* ------------------------------------------------------------------ */

test('quien entra recibe a quienes ya estaban, que son a los que tiene que llamar', () => {
  assert.deepEqual(llamadas.entrar(P, ana), []);
  assert.deepEqual(llamadas.entrar(P, beto), ['s-ana']);
  assert.deepEqual(
    llamadas.participantes(P).map((p) => p.nombre),
    ['Ana', 'Beto'],
  );
});

test('entrar dos veces no duplica ni se cuenta a si mismo entre los otros', () => {
  llamadas.entrar(P, ana);
  llamadas.entrar(P, beto);
  assert.deepEqual(llamadas.entrar(P, beto), ['s-ana']);
  assert.equal(llamadas.participantes(P).length, 2);
});

test('salir saca a la persona, y la llamada vacia desaparece', () => {
  llamadas.entrar(P, ana);
  assert.equal(llamadas.salir(P, 's-ana'), true);
  assert.equal(llamadas.salir(P, 's-ana'), false);
  assert.deepEqual(llamadas.participantes(P), []);
  assert.equal(llamadas.estaEn(P, 's-ana'), false);
});

test('una llamada llena rechaza al siguiente con un error que se puede mostrar', () => {
  for (let i = 0; i < llamadas.MAX_PARTICIPANTES; i += 1) {
    llamadas.entrar(P, { idSocket: `s${i}`, idUsuario: `u${i}`, nombre: `P${i}` });
  }
  assert.throws(
    () => llamadas.entrar(P, ana),
    (error) => error.isOperational && error.statusCode === 409,
  );
});

test('silenciar cambia solo a esa persona; fuera de la llamada no hace nada', () => {
  llamadas.entrar(P, ana);
  llamadas.entrar(P, beto);
  assert.equal(llamadas.silenciar(P, 's-ana', true), true);
  assert.equal(llamadas.silenciar(P, 's-nadie', true), false);
  const [a, b] = llamadas.participantes(P);
  assert.equal(a.silenciado, true);
  assert.equal(b.silenciado, false);
});

test('las llamadas de proyectos distintos no se mezclan', () => {
  llamadas.entrar(P, ana);
  llamadas.entrar('otro', beto);
  assert.equal(llamadas.estaEn(P, 's-beto'), false);
  assert.deepEqual(llamadas.entrar(P, { ...beto, idSocket: 's-beto-2' }), ['s-ana']);
});

/* ------------------------------------------------------------------ */
/* "Jarvis"                                                            */
/* ------------------------------------------------------------------ */

test('detecta el nombre al principio y devuelve lo que viene despues', () => {
  assert.deepEqual(detectarJarvis('Jarvis, ¿cómo está el proyecto actualmente?'), {
    resto: '¿cómo está el proyecto actualmente?',
  });
  assert.deepEqual(detectarJarvis('jarvis agregá la clase Socio'), { resto: 'agregá la clase Socio' });
});

test('acepta como lo suele escribir el transcriptor', () => {
  for (const dicho of ['Yarvis, hola', 'Jarbis, hola', 'Harvis hola', 'Llarvis, hola', 'Jarvys, hola', 'JARVIS: hola']) {
    assert.deepEqual(detectarJarvis(dicho), { resto: 'hola' }, dicho);
  }
});

test('acepta una o dos palabras antes: "oye Jarvis", "ok, Jarvis"', () => {
  assert.deepEqual(detectarJarvis('Oye Jarvis, ¿qué falta?'), { resto: '¿qué falta?' });
  assert.deepEqual(detectarJarvis('Ok, Jarvis. Borrá Película'), { resto: 'Borrá Película' });
});

test('solo "Jarvis" da un resto vacio: la pregunta viene en la frase siguiente', () => {
  assert.deepEqual(detectarJarvis('Jarvis.'), { resto: '' });
});

test('si no le hablan a Jarvis, o lo nombran en medio de una frase, no es para el', () => {
  assert.equal(detectarJarvis('¿Cómo está el proyecto?'), null);
  assert.equal(detectarJarvis('ayer le pregunté a Jarvis por la herencia'), null);
  assert.equal(detectarJarvis('Jarra de agua'), null);
  assert.equal(detectarJarvis(''), null);
  assert.equal(detectarJarvis(null), null);
});

test('la misma frase en la misma sala unos segundos despues es eco, no otra pregunta', () => {
  const esRepetida = crearFiltroDeRepetidas({ ventanaMs: 10000 });
  assert.equal(esRepetida(P, 'Jarvis, ¿cómo está el proyecto?', 0), false);
  assert.equal(esRepetida(P, 'jarvis como esta el proyecto', 3000), true);
  // Otra sala, o pasado el plazo, si cuenta.
  assert.equal(esRepetida('otra', 'Jarvis, ¿cómo está el proyecto?', 3000), false);
  assert.equal(esRepetida(P, 'Jarvis, ¿cómo está el proyecto?', 20000), false);
  // Otra pregunta, aunque se parezca, tambien.
  assert.equal(esRepetida(P, 'Jarvis, ¿cómo está la clase Socio?', 21000), false);
});

/* ------------------------------------------------------------------ */
/* Lo que recibe la IA                                                 */
/* ------------------------------------------------------------------ */

test('una pregunta de la llamada le dice a la IA que se la hicieron en voz alta como Jarvis', () => {
  const pregunta = {
    idMensaje: 'm1',
    tipo: 'TEXTO',
    texto: '📞 Jarvis, ¿cómo está el proyecto?',
    usuario: { nombre: 'Ana' },
  };
  const mensajes = construirMensajes({ historial: [], pregunta, enLlamada: true });
  const ultimo = mensajes[mensajes.length - 1];

  assert.equal(ultimo.role, 'user');
  assert.match(ultimo.content, /^Ana te habla en la llamada de voz \(te llaman Jarvis\): /);
  assert.match(ultimo.content, /¿cómo está el proyecto\?$/);
  assert.match(mensajes[0].content, /te llaman "Jarvis"/);
});

test('sin enLlamada, la pregunta se arma exactamente como antes', () => {
  const pregunta = { idMensaje: 'm1', tipo: 'TEXTO', texto: '@IA hola', usuario: { nombre: 'Ana' } };
  const mensajes = construirMensajes({ historial: [], pregunta });
  assert.equal(mensajes[mensajes.length - 1].content, 'Ana te pregunta: @IA hola');
});
