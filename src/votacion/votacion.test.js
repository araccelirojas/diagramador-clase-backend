const test = require('node:test');
const assert = require('node:assert/strict');

const { interpretarVoto } = require('./interpretar');
const v = require('./votacion');
const votaciones = require('./index');

const ana = { idUsuario: 'u-ana', nombre: 'Ana' };
const beto = { idUsuario: 'u-beto', nombre: 'Beto' };
const caro = { idUsuario: 'u-caro', nombre: 'Caro' };

const reversion = { type: 'document.restoreEntities', payload: { nodes: { n_x: null }, edges: {} } };

function nueva(solicitante = ana) {
  return v.crearVotacion({
    idPropuesta: 'p1',
    solicitante,
    cambios: ['Creada la clase Pedido.'],
    nodos: ['n_x'],
    aristas: [],
    reversion,
    ahora: 0,
  });
}

/* Interpretar ---------------------------------------------------------- */

test('interpretarVoto: las formas comunes de decir que si', () => {
  for (const texto of ['sí', 'Si!', 'dale', 'Sí, conservalo', 'ok', 'de acuerdo', 'me gusta', '👍', 'yo voto que sí', 'Conservar.']) {
    assert.equal(interpretarVoto(texto), 'conservar', texto);
  }
});

test('interpretarVoto: las formas comunes de decir que no', () => {
  for (const texto of ['no', 'No.', 'nop', 'no, descartalo', 'descartar', 'no me gusta', 'mejor no', '👎', 'voto por descartar']) {
    assert.equal(interpretarVoto(texto), 'descartar', texto);
  }
});

test('interpretarVoto: lo que no es un voto no cuenta', () => {
  for (const texto of [
    'si agregamos Pedido después también hay que ver Factura', // un condicional, no un si
    'no sé qué opinan ustedes',
    'no estoy seguro',
    'no creo que eso esté bien modelado del todo', // largo: es una opinion
    '@IA sí, conservalo', // va para la IA
    'qué cambió?',
    '',
  ]) {
    assert.equal(interpretarVoto(texto), null, texto);
  }
});

/* Reglas ---------------------------------------------------------------- */

test('decidir: gana la mayoria de los votos emitidos', () => {
  const votacion = nueva();
  v.registrarVoto(votacion, ana, 'conservar');
  v.registrarVoto(votacion, beto, 'descartar');
  v.registrarVoto(votacion, caro, 'descartar');
  assert.deepEqual(v.decidir(votacion), { estado: 'descartada', motivo: 'mayoria' });
});

test('decidir: en un empate desempata quien pidio el cambio', () => {
  const votacion = nueva(beto);
  v.registrarVoto(votacion, ana, 'descartar');
  v.registrarVoto(votacion, beto, 'conservar');
  assert.deepEqual(v.decidir(votacion), { estado: 'conservada', motivo: 'desempate' });
});

test('decidir: empate sin el voto de quien pidio se descarta; sin ningun voto se conserva', () => {
  const empate = nueva(caro);
  v.registrarVoto(empate, ana, 'conservar');
  v.registrarVoto(empate, beto, 'descartar');
  assert.deepEqual(v.decidir(empate), { estado: 'descartada', motivo: 'desempate' });

  assert.deepEqual(v.decidir(nueva()), { estado: 'conservada', motivo: 'sin-votos' });
});

test('registrarVoto: se puede cambiar el voto, no repetirlo, y no despues de cerrar', () => {
  const votacion = nueva();
  assert.equal(v.registrarVoto(votacion, ana, 'conservar'), true);
  assert.equal(v.registrarVoto(votacion, ana, 'conservar'), false);
  assert.equal(v.registrarVoto(votacion, ana, 'descartar'), true);
  assert.equal(v.registrarVoto(votacion, ana, 'quizas'), false);

  votacion.estado = 'conservada';
  assert.equal(v.registrarVoto(votacion, beto, 'conservar'), false);
});

test('votaronTodos: los presentes, y nunca con la sala vacia', () => {
  const votacion = nueva();
  v.registrarVoto(votacion, ana, 'conservar');

  assert.equal(v.votaronTodos(votacion, [ana, beto]), false);
  assert.deepEqual(v.faltantes(votacion, [ana, beto]), [beto]);
  assert.equal(v.votaronTodos(votacion, [ana]), true);
  assert.equal(v.votaronTodos(votacion, []), false);
});

test('aPublico: sin la reversion, con lo que falta y el tiempo que queda', () => {
  const votacion = nueva();
  const publico = v.aPublico(votacion, [ana, beto], 30_000);

  assert.equal('reversion' in publico, false);
  assert.equal(publico.quedanMs, v.DURACION_MS - 30_000);
  assert.deepEqual(publico.faltantes, [ana, beto]);
});

/* El gestor, con una sala falsa ----------------------------------------- */

function salaFalsa(presentes) {
  const emitidos = [];
  const cambios = [];
  const resultados = [];
  votaciones.configurar({
    usuariosEnSala: async () => presentes,
    emitir: (_id, evento, datos) => emitidos.push({ evento, datos }),
    difundirCambio: async (_id, comando) => {
      cambios.push(comando);
      return presentes.length > 0;
    },
    pedirPropuesta: async () => ({}),
    guardarResultado: async (_id, datos) => {
      resultados.push(datos);
      return { idMensaje: 'res', autor: 'IA', texto: datos.texto };
    },
    alConservar: async () => {},
  });
  return { emitidos, cambios, resultados };
}

const ultimaVotacion = (emitidos) => emitidos.filter((e) => e.evento === 'votacion').at(-1).datos;

test('gestor: cierra antes de tiempo cuando votaron todos, y descartar manda la reversion', async () => {
  const sala = salaFalsa([ana, beto]);
  await votaciones.abrir('proy-1', { idPropuesta: 'p1', solicitante: ana, cambios: [], nodos: ['n_x'], aristas: [], reversion });

  assert.equal(ultimaVotacion(sala.emitidos).estado, 'abierta');
  assert.deepEqual(await votaciones.votar('proy-1', ana, 'descartar', 'p1'), { ok: true });
  assert.equal(votaciones.abierta('proy-1') !== null, true);

  // Beto vota escribiendo en el chat.
  assert.equal(await votaciones.votarPorMensaje('proy-1', beto, 'no, descartalo'), true);

  assert.equal(votaciones.abierta('proy-1'), null);
  assert.deepEqual(sala.cambios, [reversion]);
  assert.equal(ultimaVotacion(sala.emitidos).estado, 'descartada');
  assert.match(sala.resultados[0].texto, /se descartaron/);
  assert.equal(sala.resultados[0].mencionA, 'u-ana');
  assert.ok(sala.emitidos.some((e) => e.evento === 'mensaje'));
});

test('gestor: conservar no manda ninguna reversion', async () => {
  const sala = salaFalsa([ana]);
  await votaciones.abrir('proy-2', { idPropuesta: 'p2', solicitante: ana, cambios: [], nodos: [], aristas: [], reversion });
  await votaciones.votar('proy-2', ana, 'conservar', 'p2');

  assert.deepEqual(sala.cambios, []);
  assert.match(sala.resultados[0].texto, /se conservan/);
});

test('gestor: una sola votacion por sala, y un voto a una cerrada se rechaza', async () => {
  salaFalsa([ana, beto]);
  await votaciones.abrir('proy-3', { idPropuesta: 'p3', solicitante: ana, cambios: [], nodos: [], aristas: [], reversion });

  await assert.rejects(
    votaciones.abrir('proy-3', { idPropuesta: 'p4', solicitante: ana, cambios: [], nodos: [], aristas: [], reversion }),
    /Ya hay una votación abierta/,
  );
  assert.equal((await votaciones.votar('proy-3', ana, 'conservar', 'otra')).ok, false);

  await votaciones.cerrar('proy-3', 'p3');
  assert.equal((await votaciones.votar('proy-3', ana, 'conservar', 'p3')).ok, false);
});

test('gestor: con la sala vacia la reversion queda pendiente para el proximo que entre', async () => {
  salaFalsa([]);
  await votaciones.abrir('proy-5', { idPropuesta: 'p5', solicitante: ana, cambios: [], nodos: [], aristas: [], reversion });
  // Ana voto descartar y se fue; con la sala vacia la votacion espera al reloj.
  await votaciones.votar('proy-5', ana, 'descartar', 'p5');
  assert.notEqual(votaciones.abierta('proy-5'), null);
  await votaciones.cerrar('proy-5', 'p5');

  assert.deepEqual(votaciones.tomarReversionPendiente('proy-5'), reversion);
  assert.equal(votaciones.tomarReversionPendiente('proy-5'), null);
});

test('gestor: un mensaje que no es voto, o sin votacion abierta, no cuenta', async () => {
  salaFalsa([ana]);
  assert.equal(await votaciones.votarPorMensaje('proy-sin', ana, 'sí'), false);

  await votaciones.abrir('proy-6', { idPropuesta: 'p6', solicitante: ana, cambios: [], nodos: [], aristas: [], reversion });
  assert.equal(await votaciones.votarPorMensaje('proy-6', ana, 'qué cambió exactamente?'), false);
  await votaciones.cerrar('proy-6', 'p6');
});
