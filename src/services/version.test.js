const test = require('node:test');
const assert = require('node:assert/strict');

const { automatica, crear, huellaDe, contar } = require('./version.service');
const { pedirSnapshot } = require('../sockets/salas');
const { versionAutoMs } = require('../config/env');

const diagrama = (extra = {}) => ({
  schemaVersion: 2,
  meta: { name: 'Tienda', updatedAt: '2026-11-07T10:00:00.000Z' },
  diagrams: [{ id: 'd_main', viewport: { x: 0, y: 0, zoom: 1 } }],
  nodes: {
    n1: { id: 'n1', kind: 'class', name: 'Cliente' },
    n2: { id: 'n2', kind: 'note', name: 'nota' },
  },
  edges: { e1: { id: 'e1', source: 'n1', target: 'n1' } },
  ...extra,
});

/** Un repositorio en memoria con lo que usa el servicio. */
function repoFalso(previa = null) {
  const creadas = [];
  let podadas = 0;
  return {
    creadas,
    get podadas() { return podadas; },
    ultima: async () => previa,
    crear: async (data) => {
      const version = { idVersion: `v${creadas.length + 1}`, numero: creadas.length + 1, ...data };
      creadas.push(version);
      return version;
    },
    podarAutomaticas: async () => { podadas += 1; },
  };
}

test('huellaDe: solo el modelo; ni la vista ni las fechas ni el orden de las claves', () => {
  const base = huellaDe(diagrama());

  assert.equal(huellaDe(diagrama({ diagrams: [{ id: 'd_main', viewport: { x: 500, y: 9, zoom: 2 } }] })), base);
  assert.equal(huellaDe(diagrama({ meta: { name: 'Tienda', updatedAt: 'otra' } })), base);
  // Mismas clases, claves en otro orden: misma huella.
  assert.equal(huellaDe({ edges: diagrama().edges, nodes: { n2: diagrama().nodes.n2, n1: diagrama().nodes.n1 } }), base);

  const renombrada = diagrama();
  renombrada.nodes.n1 = { ...renombrada.nodes.n1, name: 'Comprador' };
  assert.notEqual(huellaDe(renombrada), base);
});

test('contar: las notas y paquetes no son clases', () => {
  assert.deepEqual(contar(diagrama()), { clases: 1, relaciones: 1 });
  assert.deepEqual(contar({}), { clases: 0, relaciones: 0 });
});

test('crear: guarda huella y conteo, y avisa a la sala', async () => {
  const repo = repoFalso();
  const avisos = [];
  const version = await crear(
    'p1',
    { contenido: diagrama(), origen: 'MANUAL', nombre: 'Antes de la entrega', idUsuario: 'u1' },
    { repo, emitir: (...args) => avisos.push(args) },
  );

  assert.equal(version.clases, 1);
  assert.equal(version.huella, huellaDe(diagrama()));
  assert.deepEqual(avisos, [['p1', 'version-creada', version]]);
  await assert.rejects(crear('p1', { contenido: [], origen: 'MANUAL' }, { repo, emitir: () => {} }), /objeto JSON/);
});

test('automatica: la primera siempre, y despues solo si paso el tiempo y cambio algo', async () => {
  const emitir = () => {};
  const ahora = Date.parse('2026-11-07T12:00:00.000Z');

  const vacia = repoFalso(null);
  assert.ok(await automatica('p1', diagrama(), 'u1', { repo: vacia, ahora, emitir }));
  assert.equal(vacia.creadas[0].origen, 'AUTOMATICA');
  assert.equal(vacia.podadas, 1);

  const reciente = repoFalso({ numero: 3, huella: 'otra', fecha: new Date(ahora - versionAutoMs / 2) });
  assert.equal(await automatica('p1', diagrama(), 'u1', { repo: reciente, ahora, emitir }), null);

  const igual = repoFalso({ numero: 3, huella: huellaDe(diagrama()), fecha: new Date(ahora - versionAutoMs * 2) });
  assert.equal(await automatica('p1', diagrama(), 'u1', { repo: igual, ahora, emitir }), null);

  const vieja = repoFalso({ numero: 3, huella: 'otra', fecha: new Date(ahora - versionAutoMs * 2) });
  assert.ok(await automatica('p1', diagrama(), 'u1', { repo: vieja, ahora, emitir }));
});

test('pedirSnapshot: dos pedidos a la vez reciben la misma respuesta', async () => {
  const pedidos = [];
  const sala = { escritor: 's1', esperando: null, pedido: null };
  const io = { sockets: { sockets: new Map([['s1', { emit: (evento) => pedidos.push(evento) }]]) } };

  const a = pedirSnapshot(io, sala, 'autoguardado');
  const b = pedirSnapshot(io, sala, 'version');
  sala.esperando({ contenido: { ok: true }, idUsuario: 'u1' });

  assert.deepEqual(await a, await b);
  assert.equal(pedidos.length, 1);
  assert.equal(sala.pedido, null);

  // Sin escritor no queda ningun pedido colgado.
  const sinNadie = { escritor: null, esperando: null, pedido: null };
  assert.equal(await pedirSnapshot(io, sinNadie, 'x'), null);
  assert.equal(sinNadie.pedido, null);
});
