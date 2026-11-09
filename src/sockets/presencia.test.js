const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizarEfimero,
  presenciaInicial,
  recordar,
  participanteDe,
} = require('./presencia');

test('cursor valido y cursor fuera del lienzo', () => {
  assert.deepEqual(normalizarEfimero({ tipo: 'cursor', cursor: { x: 1.5, y: -3 } }), {
    tipo: 'cursor',
    cursor: { x: 1.5, y: -3 },
  });
  assert.deepEqual(normalizarEfimero({ tipo: 'cursor', cursor: null }), {
    tipo: 'cursor',
    cursor: null,
  });
});

test('cursor con coordenadas que no son numeros se descarta', () => {
  assert.equal(normalizarEfimero({ tipo: 'cursor', cursor: { x: '1', y: 2 } }), null);
  assert.equal(normalizarEfimero({ tipo: 'cursor', cursor: { x: Infinity, y: 2 } }), null);
  assert.equal(normalizarEfimero({ tipo: 'cursor' }), null);
});

test('seleccion: solo listas de ids razonables', () => {
  assert.deepEqual(normalizarEfimero({ tipo: 'seleccion', nodos: ['n_1'], aristas: [] }), {
    tipo: 'seleccion',
    nodos: ['n_1'],
    aristas: [],
  });
  assert.equal(normalizarEfimero({ tipo: 'seleccion', nodos: [1], aristas: [] }), null);
  assert.equal(normalizarEfimero({ tipo: 'seleccion', nodos: ['x'.repeat(65)], aristas: [] }), null);
  assert.equal(
    normalizarEfimero({ tipo: 'seleccion', nodos: Array(501).fill('n'), aristas: [] }),
    null,
  );
});

test('estado: solo los conocidos; "desconectado" lo decide el servidor, no el cliente', () => {
  assert.deepEqual(normalizarEfimero({ tipo: 'estado', estado: 'grabando' }), {
    tipo: 'estado',
    estado: 'grabando',
  });
  assert.equal(normalizarEfimero({ tipo: 'estado', estado: 'desconectado' }), null);
});

test('tipos desconocidos y basura se descartan', () => {
  assert.equal(normalizarEfimero(null), null);
  assert.equal(normalizarEfimero('hola'), null);
  assert.equal(normalizarEfimero({ tipo: 'contenido', contenido: {} }), null);
});

test('recordar guarda estado y seleccion, no el cursor', () => {
  const presencia = presenciaInicial();

  recordar(presencia, { tipo: 'estado', estado: 'editando' });
  recordar(presencia, { tipo: 'seleccion', nodos: ['n_1'], aristas: ['e_1'] });
  recordar(presencia, { tipo: 'cursor', cursor: { x: 1, y: 1 } });

  assert.deepEqual(presencia, {
    estado: 'editando',
    seleccion: { nodos: ['n_1'], aristas: ['e_1'] },
  });
});

test('participanteDe arma lo que ven los demas', () => {
  const socket = {
    id: 'abc',
    data: { usuario: { idUsuario: 'u1', nombre: 'Ana', correo: 'a@a.com' } },
  };

  assert.deepEqual(participanteDe(socket), {
    idSocket: 'abc',
    idUsuario: 'u1',
    nombre: 'Ana',
    estado: 'conectado',
    seleccion: { nodos: [], aristas: [] },
  });
});
