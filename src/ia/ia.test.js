const test = require('node:test');
const assert = require('node:assert/strict');

const { construirMensajes, mencionaIA, MAX_HISTORIAL } = require('./contexto');
const { crearCola } = require('./cola');
const { resumirExportacion } = require('./exportador');
const { responderPregunta, leerDiagrama } = require('./index');

const ana = { idUsuario: 'u-ana', nombre: 'Ana' };
const beto = { idUsuario: 'u-beto', nombre: 'Beto' };

function msg(id, autor, texto, usuario = null, fecha = '2026-11-05T10:00:00.000Z') {
  return { idMensaje: id, autor, texto, usuario, fecha };
}

test('mencionaIA: @IA como palabra suelta, en cualquier lugar', () => {
  assert.equal(mencionaIA('@IA que opinas?'), true);
  assert.equal(mencionaIA('che @ia, mira esto'), true);
  assert.equal(mencionaIA('pregunta para (@IA)'), true);
  assert.equal(mencionaIA('hola @IAN'), false);
  assert.equal(mencionaIA('escribime a yo@ia.com'), false);
  assert.equal(mencionaIA('sin mencion'), false);
});

test('construirMensajes: instrucciones, contexto, historial con autores y la pregunta', () => {
  const pregunta = msg('m3', 'USUARIO', '@IA falta algo?', beto);
  const mensajes = construirMensajes({
    historial: [
      msg('m1', 'USUARIO', 'agregue Cliente', ana),
      msg('m2', 'IA', 'Bien, ahora falta la clave.'),
      pregunta,
    ],
    pregunta,
    nombreProyecto: 'Tienda',
    participantes: ['Ana', 'Beto'],
    resumen: 'CLASES\n  Cliente',
    exportador: 'Con CRUD: Cliente',
  });

  assert.equal(mensajes[0].role, 'system');
  assert.match(mensajes[1].content, /PROYECTO: Tienda/);
  assert.match(mensajes[1].content, /EN LA SALA AHORA: Ana, Beto/);
  assert.match(mensajes[1].content, /Cliente/);
  assert.match(mensajes[1].content, /Con CRUD: Cliente/);

  assert.deepEqual(mensajes[2], { role: 'user', content: 'Ana: agregue Cliente' });
  assert.deepEqual(mensajes[3], { role: 'assistant', content: 'Bien, ahora falta la clave.' });
  // La pregunta no se repite como historial, y dice quien pregunta.
  assert.equal(mensajes.length, 5);
  assert.equal(mensajes[4].content, 'Beto te pregunta: @IA falta algo?');
});

test('construirMensajes: el historial se corta a los ultimos MAX_HISTORIAL', () => {
  const historial = Array.from({ length: MAX_HISTORIAL + 10 }, (_, i) =>
    msg(`m${i}`, 'USUARIO', `texto ${i}`, ana),
  );
  const pregunta = msg('q', 'USUARIO', '@IA hola', ana);
  const mensajes = construirMensajes({ historial, pregunta });

  assert.equal(mensajes.length, 2 + MAX_HISTORIAL + 1);
  assert.equal(mensajes[2].content, `Ana: texto 10`);
});

test('cola: dentro de una sala de a una y en orden; una tarea que falla no la corta', async () => {
  const cola = crearCola();
  const orden = [];
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  const a = cola.encolar('s1', async () => { await espera(20); orden.push('a'); });
  const b = cola.encolar('s1', async () => { orden.push('b'); throw new Error('falla'); });
  const c = cola.encolar('s1', async () => { orden.push('c'); });

  await a;
  await assert.rejects(b);
  await c;
  assert.deepEqual(orden, ['a', 'b', 'c']);
  assert.equal(cola.pendientes('s1'), 0);
});

test('cola: salas distintas no se esperan, y hay tope por sala', async () => {
  const cola = crearCola({ maxPendientes: 1 });
  let liberar;
  const bloqueada = cola.encolar('s1', () => new Promise((r) => { liberar = r; }));

  await assert.rejects(cola.encolar('s1', async () => {}), /demasiadas preguntas/);
  await cola.encolar('s2', async () => {}); // no espera a s1

  liberar();
  await bloqueada;
});

test('resumirExportacion: dice que tiene CRUD y que falta la clave', () => {
  const contenido = {
    meta: { name: 'Tienda' },
    nodes: {
      n1: {
        id: 'n1', kind: 'class', name: 'Cliente', isAbstract: false, keywords: [],
        compartments: { attributes: [], operations: [] }, diagramId: 'd', parentId: null, associationId: null,
      },
    },
    edges: {},
  };

  const texto = resumirExportacion(contenido);
  assert.match(texto, /Con CRUD: Cliente/);
  assert.match(texto, /BLOQUEADA/);
  assert.equal(resumirExportacion(null), null);
});

test('leerDiagrama: solo acepta la forma esperada', () => {
  assert.deepEqual(leerDiagrama(null), { resumen: null, contenido: null });
  assert.deepEqual(leerDiagrama({ resumen: 3, contenido: [] }), { resumen: null, contenido: null });
  assert.equal(leerDiagrama({ resumen: 'x', contenido: {} }).resumen, 'x');
});

test('responderPregunta: avisa, responde a quien pregunto y apaga el indicador', async () => {
  const eventos = [];
  const pregunta = msg('q1', 'USUARIO', '@IA hola', ana);
  let recibido;

  await responderPregunta(
    {
      idProyecto: 'p-ok',
      pregunta,
      diagrama: { resumen: 'CLASES' },
      emitir: (evento, datos) => eventos.push([evento, datos]),
    },
    {
      paginaAnterior: async () => ({ mensajes: [pregunta], hayMas: false }),
      completarFn: async (mensajes) => { recibido = mensajes; return 'Hola Ana'; },
      guardar: async (_id, datos) => ({ idMensaje: 'r1', autor: 'IA', ...datos }),
    },
  );

  assert.deepEqual(eventos.map((e) => e[0]), ['ia-escribiendo', 'mensaje', 'ia-escribiendo']);
  assert.equal(eventos[1][1].texto, 'Hola Ana');
  assert.equal(eventos[1][1].respondeA, 'q1');
  assert.equal(eventos[1][1].mencionA, 'u-ana');
  assert.equal(eventos[2][1].activo, false);
  assert.match(recibido[recibido.length - 1].content, /^Ana te pregunta/);
});

test('responderPregunta: un fallo se avisa con ia-error y no se guarda nada', async () => {
  const eventos = [];
  let guardado = false;

  await responderPregunta(
    {
      idProyecto: 'p-error',
      pregunta: msg('q2', 'USUARIO', '@IA hola', ana),
      emitir: (evento, datos) => eventos.push([evento, datos]),
    },
    {
      paginaAnterior: async () => ({ mensajes: [], hayMas: false }),
      completarFn: async () => {
        const error = new Error('La IA tardó demasiado');
        error.isOperational = true;
        throw error;
      },
      guardar: async () => { guardado = true; },
    },
  );

  assert.equal(guardado, false);
  const error = eventos.find((e) => e[0] === 'ia-error');
  assert.equal(error[1].respondeA, 'q2');
  assert.equal(error[1].mencionA, 'u-ana');
  assert.match(error[1].message, /tardó demasiado/);
  // El indicador se apaga aunque falle.
  assert.equal(eventos.filter((e) => e[0] === 'ia-escribiendo').pop()[1].activo, false);
});
