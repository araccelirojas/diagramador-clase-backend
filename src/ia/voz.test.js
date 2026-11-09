const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Antes de cargar nada: el almacenamiento lee la carpeta del entorno al importarse.
process.env.AUDIO_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audios-test-'));

const test = require('node:test');
const assert = require('node:assert/strict');

const audios = require('../almacenamiento/audios');
const { construirMensajes } = require('./contexto');
const { responderPregunta } = require('./index');
const { procesarNotaDeVoz } = require('./notaDeVoz');

const ana = { idUsuario: 'u-ana', nombre: 'Ana' };

function nota(overrides = {}) {
  return {
    idMensaje: 'v1',
    autor: 'USUARIO',
    tipo: 'VOZ',
    texto: '',
    transcripcion: null,
    usuario: ana,
    fecha: '2026-11-06T10:00:00.000Z',
    ...overrides,
  };
}

test('audios: tipos de MediaRecorder con parametros, y los que no son audio', () => {
  assert.equal(audios.extensionDe('audio/webm;codecs=opus'), 'webm');
  assert.equal(audios.extensionDe('audio/mp4'), 'm4a');
  assert.equal(audios.extensionDe('image/png'), null);
});

test('audios: guarda y vuelve a abrir por clave; una clave rara no sale de la carpeta', async () => {
  const clave = await audios.guardar(Buffer.from('hola'), 'audio/webm');
  assert.match(clave, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.webm$/);

  const { stream, tamano } = await audios.abrir(clave);
  assert.equal(tamano, 4);
  stream.destroy();

  await assert.rejects(audios.abrir('../../etc/passwd'), /invalida/);
  await assert.rejects(audios.guardar(Buffer.from('x'), 'text/plain'), /No se puede guardar/);
});

test('contexto: una nota de voz se lee por su transcripcion', () => {
  const mensajes = construirMensajes({
    historial: [nota({ idMensaje: 'v0', transcripcion: 'agregué Cliente' }), nota({ idMensaje: 'v-' })],
    pregunta: nota({ transcripcion: '¿falta algo?' }),
  });

  assert.equal(mensajes[2].content, 'Ana: (nota de voz) agregué Cliente');
  assert.equal(mensajes[3].content, 'Ana: (nota de voz sin transcribir)');
  assert.equal(mensajes[4].content, 'Ana te pregunta por voz: ¿falta algo?');
});

test('responderPregunta por voz: guarda la respuesta como audio', async () => {
  const eventos = [];
  let guardado;

  await responderPregunta(
    {
      idProyecto: 'p-voz',
      pregunta: nota({ transcripcion: 'hola' }),
      emitir: (evento, datos) => eventos.push([evento, datos]),
      enVoz: true,
    },
    {
      paginaAnterior: async () => ({ mensajes: [], hayMas: false }),
      completarFn: async () => 'Hola Ana',
      sintetizarFn: async () => ({ buffer: Buffer.from('mp3'), mime: 'audio/mpeg' }),
      guardarAudio: async () => '2026/11/clave.mp3',
      guardar: async (_id, datos) => { guardado = datos; return { idMensaje: 'r', ...datos }; },
    },
  );

  assert.equal(guardado.texto, 'Hola Ana');
  assert.deepEqual(guardado.audio, { clave: '2026/11/clave.mp3', mime: 'audio/mpeg' });
});

test('responderPregunta por voz: si la sintesis falla, contesta en texto igual', async () => {
  let guardado;
  const errorOriginal = console.error;
  console.error = () => {};

  try {
    await responderPregunta(
      {
        idProyecto: 'p-voz-falla',
        pregunta: nota({ transcripcion: 'hola' }),
        emitir: () => {},
        enVoz: true,
      },
      {
        paginaAnterior: async () => ({ mensajes: [], hayMas: false }),
        completarFn: async () => 'Hola Ana',
        sintetizarFn: async () => { throw new Error('tts caido'); },
        guardar: async (_id, datos) => { guardado = datos; return datos; },
      },
    );
  } finally {
    console.error = errorOriginal;
  }

  assert.equal(guardado.texto, 'Hola Ana');
  assert.equal(guardado.audio, null);
});

test('procesarNotaDeVoz: reparte, transcribe, actualiza y le pasa la pregunta a la IA', async () => {
  const eventos = [];
  let preguntaIA;

  await procesarNotaDeVoz(
    { idProyecto: 'p', mensaje: nota(), buffer: Buffer.from('a'), mime: 'audio/webm', paraIA: true },
    {
      emitir: (evento, datos) => eventos.push([evento, datos]),
      transcribirFn: async () => '¿qué falta?',
      guardarTranscripcion: async (id, transcripcion) => nota({ idMensaje: id, transcripcion }),
      responder: async (args) => { preguntaIA = args; },
    },
  );

  assert.deepEqual(eventos.map((e) => e[0]), ['mensaje', 'mensaje']);
  assert.equal(eventos[0][1].transcripcion, null);
  assert.equal(eventos[1][1].transcripcion, '¿qué falta?');
  assert.equal(preguntaIA.enVoz, true);
  assert.equal(preguntaIA.pregunta.transcripcion, '¿qué falta?');
});

test('procesarNotaDeVoz: sin IA no llama a la IA', async () => {
  let llamada = false;

  await procesarNotaDeVoz(
    { idProyecto: 'p', mensaje: nota(), buffer: Buffer.from('a'), mime: 'audio/webm', paraIA: false },
    {
      emitir: () => {},
      transcribirFn: async () => 'hola',
      guardarTranscripcion: async (id, transcripcion) => nota({ transcripcion }),
      responder: async () => { llamada = true; },
    },
  );

  assert.equal(llamada, false);
});

test('procesarNotaDeVoz: si no se puede transcribir, avisa y la IA no responde', async () => {
  const eventos = [];

  await procesarNotaDeVoz(
    { idProyecto: 'p', mensaje: nota(), buffer: Buffer.from('a'), mime: 'audio/webm', paraIA: true },
    {
      emitir: (evento, datos) => eventos.push([evento, datos]),
      transcribirFn: async () => {
        const error = new Error('OpenAI tardó demasiado');
        error.isOperational = true;
        throw error;
      },
      responder: async () => assert.fail('no deberia responder'),
    },
  );

  assert.deepEqual(eventos.map((e) => e[0]), ['mensaje', 'transcripcion-error', 'ia-error']);
  assert.equal(eventos[1][1].idMensaje, 'v1');
  assert.equal(eventos[2][1].respondeA, 'v1');
});

test('procesarNotaDeVoz: una nota comun puede ser un voto (CU-04); una para la IA lleva cambios', async () => {
  let voto;
  await procesarNotaDeVoz(
    { idProyecto: 'p', mensaje: nota(), buffer: Buffer.from('a'), mime: 'audio/webm', paraIA: false },
    {
      emitir: () => {},
      transcribirFn: async () => 'Sí, conservalo.',
      guardarTranscripcion: async (id, transcripcion) => nota({ idMensaje: id, transcripcion }),
      votarPorMensaje: async (...args) => { voto = args; },
    },
  );
  assert.deepEqual(voto, ['p', ana, 'Sí, conservalo.']);

  let preguntaIA;
  await procesarNotaDeVoz(
    { idProyecto: 'p', mensaje: nota(), buffer: Buffer.from('a'), mime: 'audio/webm', paraIA: true },
    {
      emitir: () => {},
      transcribirFn: async () => 'agregá Pedido',
      guardarTranscripcion: async (id, transcripcion) => nota({ idMensaje: id, transcripcion }),
      responder: async (args) => { preguntaIA = args; },
      cambiosPara: (idProyecto, idUsuario) => ({ idProyecto, idUsuario }),
    },
  );
  assert.deepEqual(preguntaIA.cambios, { idProyecto: 'p', idUsuario: 'u-ana' });
});
