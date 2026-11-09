const test = require('node:test');
const assert = require('node:assert/strict');

const { responderPregunta } = require('./index');
const { leerLlamadas } = require('./herramientas');
const { leerAplicacion } = require('./propuesta');

/**
 * La IA del chat cambiando el diagrama (CU-04), sin red: el modelo, la pantalla que
 * aplica y la votacion son falsos, y lo que se mira es el orden y lo que viaja.
 */

const ana = { idUsuario: 'u-ana', nombre: 'Ana' };
const pregunta = {
  idMensaje: 'q1',
  autor: 'USUARIO',
  texto: '@IA agregá la clase Pedido con fecha',
  usuario: ana,
  fecha: '2026-11-07T10:00:00.000Z',
};
const reversion = { type: 'document.restoreEntities', payload: { nodes: { n_p: null }, edges: {} } };

const llamada = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

function escenario({ ack, abrirFalla = false, votacionAbierta = false, llamadas }) {
  const registro = { orden: [], aplicadas: null, abierta: null, segunda: null, descartada: null, eventos: [] };

  const cambios = {
    votacionAbierta: () => votacionAbierta,
    aplicar: async (operaciones) => {
      registro.orden.push('aplicar');
      registro.aplicadas = operaciones;
      return ack;
    },
    abrir: async (datos) => {
      registro.orden.push('abrir');
      if (abrirFalla) throw new Error('ocupada');
      registro.abierta = datos;
    },
    descartar: async (comando) => {
      registro.orden.push('descartar');
      registro.descartada = comando;
    },
  };

  const deps = {
    paginaAnterior: async () => ({ mensajes: [pregunta], hayMas: false }),
    // Pide las herramientas en la primera vuelta y despues dice "listo", como un modelo real.
    completarConHerramientasFn: async (mensajes, herramientas) => {
      registro.orden.push('modelo-1');
      registro.herramientas = herramientas;
      const yaPidio = mensajes.some((m) => m.role === 'tool');
      return yaPidio ? { texto: 'listo', llamadas: [] } : { texto: '', llamadas };
    },
    completarFn: async (mensajes) => {
      registro.orden.push('modelo-2');
      registro.segunda = mensajes;
      return 'Ana, agregué Pedido. ¿Lo conservamos?';
    },
    guardar: async (_id, datos) => {
      registro.orden.push('guardar');
      return { idMensaje: 'r1', autor: 'IA', ...datos };
    },
  };

  const correr = () =>
    responderPregunta(
      {
        idProyecto: `p-${Math.random()}`,
        pregunta,
        diagrama: { resumen: 'CLASES\n  Cliente' },
        emitir: (evento, datos) => registro.eventos.push([evento, datos]),
        cambios,
      },
      deps,
    );

  return { registro, correr };
}

const dosLlamadas = [
  llamada('c1', 'crear_clase', { nombre: 'Pedido' }),
  llamada('c2', 'agregar_atributo', { clase: 'Pedido', nombre: 'fecha', tipo: 'Date' }),
];

const ackBueno = {
  ok: true,
  aplicado: true,
  resultados: [
    { nombre: 'crear_clase', ok: true, texto: 'Creada la clase Pedido.' },
    { nombre: 'agregar_atributo', ok: false, texto: 'No hay ninguna clase que se llame "Pedidos".' },
  ],
  nodos: ['n_p'],
  aristas: [],
  reversion,
};

test('cambios: aplica, abre la votacion ANTES de explicar, y le pasa los resultados al modelo', async () => {
  const { registro, correr } = escenario({ ack: ackBueno, llamadas: dosLlamadas });
  await correr();

  assert.deepEqual(registro.orden, ['modelo-1', 'modelo-1', 'aplicar', 'abrir', 'modelo-2', 'guardar']);
  assert.ok(registro.herramientas.some((h) => h.function.name === 'crear_clase'));
  assert.deepEqual(registro.aplicadas, [
    { nombre: 'crear_clase', argumentos: { nombre: 'Pedido' } },
    { nombre: 'agregar_atributo', argumentos: { clase: 'Pedido', nombre: 'fecha', tipo: 'Date' } },
  ]);

  // La votacion lleva solo lo que funciono, quien lo pidio y como deshacerlo.
  assert.deepEqual(registro.abierta.cambios, ['Creada la clase Pedido.']);
  assert.deepEqual(registro.abierta.solicitante, ana);
  assert.deepEqual(registro.abierta.reversion, reversion);

  // Segunda vuelta: el turno del asistente con sus llamadas y un `tool` por cada una.
  const herramientas = registro.segunda.filter((m) => m.role === 'tool');
  assert.deepEqual(herramientas.map((m) => m.tool_call_id), ['c1', 'c2']);
  assert.match(herramientas[0].content, /^OK: Creada/);
  assert.match(herramientas[1].content, /^ERROR:/);
  assert.match(registro.segunda.at(-1).content, /PROVISIONALES/);

  const respuesta = registro.eventos.find((e) => e[0] === 'mensaje')[1];
  assert.equal(respuesta.respondeA, 'q1');
});

test('cambios: si la votacion no se puede abrir, el cambio se deshace en el acto', async () => {
  const { registro, correr } = escenario({ ack: ackBueno, abrirFalla: true, llamadas: dosLlamadas });
  await correr();

  assert.deepEqual(registro.descartada, reversion);
  assert.match(registro.segunda.find((m) => m.role === 'tool').content, /^NO SE APLICÓ/);
  assert.match(registro.segunda.at(-1).content, /No se aplicó ningún cambio/);
});

test('cambios: si nada se aplico, no hay votacion', async () => {
  const { registro, correr } = escenario({
    ack: { ok: true, aplicado: false, resultados: [{ ok: false, texto: 'No existe.' }], nodos: [], aristas: [], reversion: null },
    llamadas: [llamada('c1', 'renombrar_clase', { actual: 'X', nuevo: 'Y' })],
  });
  await correr();

  assert.deepEqual(registro.orden, ['modelo-1', 'modelo-1', 'aplicar', 'modelo-2', 'guardar']);
});

test('cambios: con una votacion abierta la IA solo conversa, sin herramientas', async () => {
  const { registro, correr } = escenario({ ack: ackBueno, votacionAbierta: true, llamadas: dosLlamadas });
  await correr();

  assert.deepEqual(registro.orden, ['modelo-2', 'guardar']);
  assert.match(registro.segunda[1].content, /CAMBIOS AL DIAGRAMA: NO disponibles/);
});

test('cambios: sin respuesta de la pantalla, el modelo se entera y no hay votacion', async () => {
  const { registro, correr } = escenario({ ack: undefined, llamadas: dosLlamadas });
  await correr();

  assert.equal(registro.abierta, null);
  assert.match(registro.segunda.find((m) => m.role === 'tool').content, /no respondió/);
});

test('leerLlamadas: argumentos ilegibles quedan vacios en vez de romper', () => {
  const [op] = leerLlamadas([{ id: 'c1', type: 'function', function: { name: 'crear_clase', arguments: '{roto' } }]);
  assert.deepEqual(op, { id: 'c1', nombre: 'crear_clase', argumentos: {} });
});

test('leerAplicacion: no confia en el cliente', () => {
  const ops = [{ nombre: 'crear_clase' }];

  // "Aplicado" sin forma de deshacerlo no sirve: no se podria descartar.
  assert.equal(leerAplicacion({ ok: true, aplicado: true, resultados: [], reversion: 'x' }, ops).aplicado, false);

  const leida = leerAplicacion(
    { ok: true, aplicado: true, resultados: [{ ok: true, texto: 'ok' }], nodos: ['n1', 3, 'x'.repeat(100)], reversion },
    ops,
  );
  assert.deepEqual(leida.nodos, ['n1']);
  assert.equal(leida.resultados[0].nombre, 'crear_clase');

  assert.equal(leerAplicacion({ ok: false, message: 'falló' }, ops).message, 'falló');
});

test('cambios: un modelo que pide de a una herramienta por vuelta igual aplica todo junto', async () => {
  const registro = {};
  const pasos = [dosLlamadas[0], dosLlamadas[1]];
  let vuelta = 0;

  // Un modelo que pide una herramienta por vuelta, y despues "listo".
  await responderPregunta(
    {
      idProyecto: 'p-vueltas',
      pregunta,
      emitir: () => {},
      cambios: {
        votacionAbierta: () => false,
        aplicar: async (operaciones) => { registro.aplicadas = operaciones; return ackBueno; },
        abrir: async (datos) => { registro.abierta = datos; },
        descartar: async () => {},
      },
    },
    {
      paginaAnterior: async () => ({ mensajes: [pregunta], hayMas: false }),
      completarConHerramientasFn: async (mensajes) => {
        // Cada vuelta ve las anteriores como "anotada", no como aplicadas.
        if (vuelta > 0) assert.match(mensajes.at(-1).content, /^Anotada/);
        const paso = pasos[vuelta++];
        return paso ? { texto: '', llamadas: [paso] } : { texto: 'listo', llamadas: [] };
      },
      completarFn: async (mensajes) => { registro.segunda = mensajes; return 'hecho'; },
      guardar: async (_id, datos) => ({ idMensaje: 'r1', autor: 'IA', ...datos }),
    },
  );
  assert.equal(vuelta, 3);
  assert.deepEqual(registro.aplicadas.map((o) => o.nombre), ['crear_clase', 'agregar_atributo']);
  // La explicacion ve UN turno con las dos llamadas, con sus resultados reales.
  const asistente = registro.segunda.filter((m) => m.role === 'assistant' && m.tool_calls);
  assert.equal(asistente.length, 1);
  assert.equal(asistente[0].tool_calls.length, 2);
  assert.ok(registro.segunda.filter((m) => m.role === 'tool').every((m) => !/^Anotada/.test(m.content)));
});
