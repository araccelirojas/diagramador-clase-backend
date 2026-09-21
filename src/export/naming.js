/**
 * Nombres Java a partir de nombres UML.
 *
 * Lo que el usuario escribe en el lienzo no tiene por que ser un identificador valido:
 * "Orden de compra", "Matrícula", "2024 Item", "class". Todo lo que salga de aca tiene que
 * compilar, y tiene que ser DETERMINISTA: exportar dos veces el mismo diagrama debe dar los
 * mismos nombres, o el codigo generado deja de ser comparable entre versiones.
 */

/** Palabras que no pueden ser un identificador Java. */
const RESERVADAS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'record', 'var', 'yield', 'sealed', 'permits',
]);

/**
 * Palabras reservadas de SQL, que no pueden ser un nombre de columna sin comillas.
 *
 * `id` NO esta aca, aunque lo estuvo: no es una palabra reservada en SQL ni en Postgres.
 * Estaba por un motivo que ya no existe —chocaba con la clave `id` que el generador
 * imponia— y el resultado era renombrar a `id_` la columna de quien llamaba `id` a su
 * propio atributo. Reservar algo "por si acaso" sale caro cuando el acaso desaparece.
 */
const RESERVADAS_SQL = new Set(['order', 'group', 'user', 'table', 'select', 'from', 'where']);

/** "Matrícula" -> "Matricula". Un acento en un identificador Java compila, pero en un nombre
 *  de tabla o de ruta HTTP es una fuente de problemas de codificacion que no aporta nada. */
function sinAcentos(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Parte un nombre en palabras, venga como venga: espacios, guiones, snake o camelCase. */
function palabras(texto) {
  return sinAcentos(String(texto || ''))
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/** "orden de compra" -> "OrdenDeCompra" */
function pascal(texto) {
  const partes = palabras(texto);
  if (partes.length === 0) return '';

  return partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
}

/** "Fecha Inscripcion" -> "fechaInscripcion" */
function camel(texto) {
  const resultado = pascal(texto);
  return resultado === '' ? '' : resultado.charAt(0).toLowerCase() + resultado.slice(1);
}

/** "OrdenDeCompra" -> "orden_de_compra" */
function snake(texto) {
  return palabras(texto).map((p) => p.toLowerCase()).join('_');
}

/**
 * Plural castellano para la ruta REST. Reglas suficientes para nombres de clases:
 * vocal -> +s, z -> ces, consonante -> +es.
 */
function plural(texto) {
  const base = snake(texto).replace(/_/g, '-');
  if (base === '') return '';

  const ultima = base.charAt(base.length - 1);

  if (ultima === 'z') return `${base.slice(0, -1)}ces`;
  if ('aeiou'.includes(ultima)) return `${base}s`;
  if (ultima === 's') return base;

  return `${base}es`;
}

/** Un identificador de clase valido, con reserva por si el nombre queda vacio. */
function nombreDeClase(texto, respaldo) {
  let nombre = pascal(texto);
  if (nombre === '') nombre = pascal(respaldo) || 'Entidad';

  // Java no admite un identificador que empiece por digito.
  if (/^[0-9]/.test(nombre)) nombre = `E${nombre}`;

  return nombre;
}

/** Un identificador de campo valido y que no sea palabra reservada. */
function nombreDeCampo(texto, respaldo) {
  let nombre = camel(texto);
  if (nombre === '') nombre = camel(respaldo) || 'campo';

  if (/^[0-9]/.test(nombre)) nombre = `c${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`;
  if (RESERVADAS.has(nombre)) nombre = `${nombre}Valor`;

  return nombre;
}

/** Nombre de columna o tabla, evitando las palabras que SQL se reserva. */
function nombreDeTabla(texto, respaldo) {
  let nombre = snake(texto) || snake(respaldo) || 'entidad';
  if (/^[0-9]/.test(nombre)) nombre = `t_${nombre}`;
  if (RESERVADAS_SQL.has(nombre)) nombre = `${nombre}_`;

  return nombre;
}

/**
 * Hace unico un nombre dentro de un conjunto, agregando un sufijo numerico.
 *
 * Dos clases distintas pueden llamarse igual en el lienzo —el validador solo AVISA de los
 * nombres repetidos, no los impide (§9)— y dos ficheros Java con el mismo nombre no pueden
 * convivir. Renombrar es mejor que perder una de las dos.
 */
function unico(nombre, usados) {
  if (!usados.has(nombre)) {
    usados.add(nombre);
    return nombre;
  }

  let indice = 2;
  while (usados.has(`${nombre}${indice}`)) indice += 1;

  const resultado = `${nombre}${indice}`;
  usados.add(resultado);
  return resultado;
}

module.exports = {
  sinAcentos,
  palabras,
  pascal,
  camel,
  snake,
  plural,
  nombreDeClase,
  nombreDeCampo,
  nombreDeTabla,
  unico,
  RESERVADAS,
};
