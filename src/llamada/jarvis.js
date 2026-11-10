/**
 * "Jarvis": el nombre con el que se le habla a la IA dentro de la llamada de voz.
 *
 * Cada navegador transcribe solo lo que dice su propia persona y manda al servidor
 * unicamente lo que empieza por "Jarvis". Lo demas —la conversacion entre ellos— no sale
 * del navegador. El frontend tiene una copia de `detectarJarvis` (src/llamada/jarvis.ts);
 * las dos tienen que reconocer lo mismo.
 */

/**
 * Como suele transcribir "Jarvis" un modelo que espera espanol. Ademas de esta lista vale
 * cualquier palabra a un cambio de "jarvis" ("jarvys", "jarvic").
 */
const VARIANTES = new Set([
  'jarvis', 'jarbis', 'jarviz', 'jarvi', 'jarbi', 'yarvis', 'yarbis', 'yarviz', 'yarvi',
  'harvis', 'harbis', 'llarvis', 'llarbis', 'charvis', 'jervis', 'yervis', 'garvis', 'shervis',
]);

/** Palabras que pueden ir antes del nombre: "oye Jarvis", "ok, Jarvis". */
const MAX_PALABRAS_ANTES = 2;

function normalizar(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distancia(a, b) {
  const filas = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) filas[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      filas[i][j] = Math.min(
        filas[i - 1][j] + 1,
        filas[i][j - 1] + 1,
        filas[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return filas[a.length][b.length];
}

function esJarvis(palabra) {
  const limpia = normalizar(palabra);
  if (VARIANTES.has(limpia)) return true;
  return limpia.length >= 5 && limpia.length <= 7 && distancia(limpia, 'jarvis') <= 1;
}

/**
 * @param {string} texto  lo que dijo alguien, ya transcrito
 * @returns {{ resto: string } | null}  `resto`: lo que viene despues del nombre (puede ser
 *   '' si solo dijo "Jarvis"); null si no le hablaba a Jarvis.
 */
function detectarJarvis(texto) {
  if (typeof texto !== 'string') return null;

  const palabras = [...texto.matchAll(/[\p{L}\p{N}]+/gu)];
  const limite = Math.min(palabras.length, MAX_PALABRAS_ANTES + 1);

  for (let i = 0; i < limite; i += 1) {
    const palabra = palabras[i];
    if (esJarvis(palabra[0])) {
      const resto = texto
        .slice(palabra.index + palabra[0].length)
        // La coma o el punto despues del nombre sobran; el "¿" de la pregunta no.
        .replace(/^[\s,.;:!?…-]+/u, '')
        .trim();
      return { resto };
    }
  }
  return null;
}

/**
 * Una misma pregunta puede llegar dos veces: si alguien habla sin auriculares, el
 * microfono de otro la capta desde sus parlantes y su navegador tambien la transcribe.
 * Lo mismo dicho en la misma sala hace unos segundos se toma como eco.
 */
function crearFiltroDeRepetidas({ ventanaMs = 10000 } = {}) {
  const recientes = new Map();

  return function esRepetida(idSala, texto, ahora = Date.now()) {
    const clave = normalizar(texto);
    const vigentes = (recientes.get(idSala) || []).filter((r) => ahora - r.en < ventanaMs);

    const repetida = vigentes.some(
      (r) =>
        r.clave === clave ||
        (clave.length >= 12 && r.clave.length >= 12 && (r.clave.includes(clave) || clave.includes(r.clave))),
    );

    if (!repetida) vigentes.push({ clave, en: ahora });
    if (vigentes.length > 0) recientes.set(idSala, vigentes);
    else recientes.delete(idSala);

    return repetida;
  };
}

module.exports = { detectarJarvis, crearFiltroDeRepetidas, normalizar };
