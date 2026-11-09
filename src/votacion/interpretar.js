const { mencionaIA } = require('../ia/contexto');

/**
 * Un mensaje del chat como voto (CU-04): "sí", "dale, conservalo", "no, descartalo",
 * 👍, o lo mismo dicho en una nota de voz.
 *
 * Conservador a proposito. Un voto mal leido cambia el diagrama de todos, y un voto no
 * leido solo obliga a tocar un boton. Por eso:
 *   - solo cuentan mensajes cortos, y la decision tiene que estar AL PRINCIPIO
 *     ("si agregas X..." no es un si: es un condicional);
 *   - un mensaje para la IA es una pregunta, no un voto;
 *   - lo que dude ("no se", "no estoy seguro") no cuenta.
 */

const MAX_PALABRAS = 8;

const POSITIVAS = new Set([
  'si', 'sii', 'sip', 'dale', 'ok', 'okay', 'okey', 'oka', 'va', 'vale', 'listo',
  'conservar', 'conservalo', 'conservala', 'conservalos', 'conservarlo', 'conservemos', 'conservo',
  'mantener', 'mantenelo', 'mantenemos', 'aprobado', 'apruebo', 'aprobar',
  'acepto', 'aceptar', 'aceptado', 'perfecto', 'genial', 'excelente', 'bien', 'joya', 'de acuerdo',
]);

const NEGATIVAS = new Set([
  'no', 'nop', 'nope', 'nah',
  'descartar', 'descartalo', 'descartala', 'descartalos', 'descartemos', 'descarto',
  'rechazo', 'rechazar', 'rechazado', 'deshacelo', 'deshacer', 'sacalo', 'quitalo', 'borralo', 'revertir',
]);

/** Frases que mandan sobre las palabras sueltas: "no me gusta" empieza con "no" pero tambien trae "me gusta". */
const FRASES = [
  ['no me gusta', 'descartar'],
  ['mejor no', 'descartar'],
  ['no lo conserves', 'descartar'],
  ['me gusta', 'conservar'],
  ['de acuerdo', 'conservar'],
  ['esta bien', 'conservar'],
  ['no se', null],
  ['no estoy', null],
  ['no entiendo', null],
  ['no tengo', null],
];

/** "yo voto que si", "voto por descartar": lo que importa es lo que viene despues. */
const PREFIJO_VOTO = /^(yo )?voto( que| por)? /;

const EMOJI_SI = /^(👍|✅|✔|☑|👌)/u;
const EMOJI_NO = /^(👎|❌|✖|🚫)/u;

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} texto
 * @returns {'conservar' | 'descartar' | null}
 */
function interpretarVoto(texto) {
  if (typeof texto !== 'string' || mencionaIA(texto)) return null;

  const crudo = texto.trim();
  if (EMOJI_SI.test(crudo)) return 'conservar';
  if (EMOJI_NO.test(crudo)) return 'descartar';

  const frase = normalizar(crudo).replace(PREFIJO_VOTO, '');
  if (frase === '') return null;

  const palabras = frase.split(' ');
  if (palabras.length > MAX_PALABRAS) return null;

  for (const [inicio, voto] of FRASES) {
    if (frase === inicio || frase.startsWith(`${inicio} `)) return voto;
  }

  const [primera, segunda] = palabras;

  // "si"/"no" sueltos son muy comunes dentro de una oracion. Al principio de un mensaje
  // corto, o seguidos de otra palabra del mismo lado ("si, conservalo"), son un voto.
  const corto = palabras.length <= 3;

  if (POSITIVAS.has(primera)) {
    if (primera === 'si' && !corto && !POSITIVAS.has(segunda)) return null;
    return 'conservar';
  }

  if (NEGATIVAS.has(primera)) {
    if (primera === 'no' && !corto && !NEGATIVAS.has(segunda)) return null;
    return 'descartar';
  }

  return null;
}

module.exports = { interpretarVoto };
