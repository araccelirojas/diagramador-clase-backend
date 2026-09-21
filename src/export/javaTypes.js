/**
 * Tipos UML -> tipos Java.
 *
 * La tabla es la de `templates/springboot-base/docs/MAPEO-UML-JPA.md`. El diagramador deja
 * escribir cualquier cosa en el campo `type` (§5.2: es un string libre, el selector ofrece
 * pero no obliga), asi que esto tiene que resolver tambien lo que no conoce sin romper.
 */

/** Siempre se usan los envoltorios, no los primitivos: un campo JPA tiene que poder ser null. */
const TABLA = {
  // Primitivos UML 2.5
  boolean: { java: 'Boolean' },
  integer: { java: 'Integer' },
  real: { java: 'Double' },
  string: { java: 'String' },
  unlimitednatural: { java: 'Integer' },

  // Tipos de dato comunes (los que ofrece Enterprise Architect)
  byte: { java: 'Byte' },
  char: { java: 'Character' },
  date: { java: 'LocalDate', importar: 'java.time.LocalDate' },
  datetime: { java: 'LocalDateTime', importar: 'java.time.LocalDateTime' },
  decimal: { java: 'BigDecimal', importar: 'java.math.BigDecimal' },
  double: { java: 'Double' },
  float: { java: 'Float' },
  int: { java: 'Integer' },
  long: { java: 'Long' },
  object: { java: 'String' },
  short: { java: 'Short' },
  timestamp: { java: 'LocalDateTime', importar: 'java.time.LocalDateTime' },
  void: { java: 'Void' },

  // Alias que la gente escribe igual
  bool: { java: 'Boolean' },
  text: { java: 'String' },
  number: { java: 'Double' },
  bigdecimal: { java: 'BigDecimal', importar: 'java.math.BigDecimal' },
  localdate: { java: 'LocalDate', importar: 'java.time.LocalDate' },
  localdatetime: { java: 'LocalDateTime', importar: 'java.time.LocalDateTime' },
  uuid: { java: 'UUID', importar: 'java.util.UUID' },
};

const DESCONOCIDO = { java: 'String', desconocido: true };

/**
 * Resuelve un tipo UML.
 *
 * Un tipo que no esta en la tabla cae a String con una marca: el exportador escribe un TODO
 * visible en el codigo. Fallar la exportacion entera por un tipo mal escrito seria peor —
 * un diagrama a medio hacer tiene tipos a medio escribir casi siempre (§9).
 */
function resolver(tipoUml) {
  if (tipoUml === null || tipoUml === undefined || String(tipoUml).trim() === '') {
    return { java: 'String', vacio: true };
  }

  const limpio = String(tipoUml).trim();
  const conocido = TABLA[limpio.toLowerCase()];

  if (conocido) return { ...conocido, original: limpio };

  return { ...DESCONOCIDO, original: limpio };
}

/**
 * Como tipo de RETORNO, `void` es la palabra reservada, no el envoltorio `Void`.
 * Da igual en un campo, pero `Void pagar(...)` obliga a devolver null y no compila igual.
 */
function resolverRetorno(tipoUml) {
  const limpio = String(tipoUml || '').trim().toLowerCase();
  if (limpio === 'void' || limpio === '') return { java: 'void' };

  return resolver(tipoUml);
}

/** true si el tipo Java admite @NotBlank (solo String lo admite). */
const esTexto = (java) => java === 'String';

/** Longitud por defecto de una columna de texto. */
const LONGITUD_TEXTO = 255;

module.exports = { resolver, resolverRetorno, esTexto, LONGITUD_TEXTO, TABLA };
