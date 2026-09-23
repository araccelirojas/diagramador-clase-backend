const test = require('node:test');
const assert = require('node:assert/strict');

const tipos = require('./javaTypes');

/**
 * El campo `type` del diagramador es texto libre: el selector ofrece tipos pero no obliga
 * (CLAUDE.md §5.2). Estas pruebas cubren que la tabla resuelva lo que conoce y, sobre todo,
 * que NO se rompa con lo que no conoce: un diagrama a medio hacer tiene tipos a medio
 * escribir casi siempre.
 */

test('los primitivos UML caen en los envoltorios, nunca en los primitivos Java', () => {
  assert.equal(tipos.resolver('boolean').java, 'Boolean');
  assert.equal(tipos.resolver('integer').java, 'Integer');
  assert.equal(tipos.resolver('real').java, 'Double');
  assert.equal(tipos.resolver('string').java, 'String');
});

test('el envoltorio es a proposito: un campo JPA tiene que poder ser null y un int no puede', () => {
  for (const tipoUml of ['boolean', 'integer', 'int', 'long', 'double', 'float', 'short', 'byte']) {
    const java = tipos.resolver(tipoUml).java;
    assert.equal(java, java.charAt(0).toUpperCase() + java.slice(1), `${tipoUml} salio primitivo`);
  }
});

test('los tipos que necesitan import lo declaran, porque el renderizador no lo adivina', () => {
  assert.deepEqual(tipos.resolver('date'), {
    java: 'LocalDate',
    importar: 'java.time.LocalDate',
    original: 'date',
  });
  assert.equal(tipos.resolver('decimal').importar, 'java.math.BigDecimal');
  assert.equal(tipos.resolver('uuid').importar, 'java.util.UUID');
  assert.equal(tipos.resolver('timestamp').java, 'LocalDateTime');
});

test('los tipos sin import no lo traen, para no escribir un import inutil', () => {
  assert.equal(tipos.resolver('string').importar, undefined);
  assert.equal(tipos.resolver('integer').importar, undefined);
});

test('da igual como se escriba: el tipo se busca en minusculas y sin espacios alrededor', () => {
  assert.equal(tipos.resolver('DateTime').java, 'LocalDateTime');
  assert.equal(tipos.resolver('  STRING  ').java, 'String');
  assert.equal(tipos.resolver('BigDecimal').java, 'BigDecimal');
});

test('un tipo desconocido cae a String CON marca, en vez de hacer fallar la exportacion entera', () => {
  const resultado = tipos.resolver('Moneda');

  assert.equal(resultado.java, 'String');
  assert.equal(resultado.desconocido, true);
  assert.equal(resultado.original, 'Moneda', 'el original se conserva para escribir el TODO en el codigo');
});

test('un tipo vacio se distingue de uno desconocido: no es lo mismo no escribirlo que escribirlo mal', () => {
  const vacio = tipos.resolver('');

  assert.equal(vacio.java, 'String');
  assert.equal(vacio.vacio, true);
  assert.equal(vacio.desconocido, undefined);

  assert.equal(tipos.resolver(null).vacio, true);
  assert.equal(tipos.resolver(undefined).vacio, true);
  assert.equal(tipos.resolver('   ').vacio, true);
});

test('como RETORNO, void es la palabra reservada y no el envoltorio: "Void pagar()" obliga a devolver null', () => {
  assert.equal(tipos.resolverRetorno('void').java, 'void');
  assert.equal(tipos.resolverRetorno('VOID').java, 'void');
  assert.equal(tipos.resolver('void').java, 'Void', 'como CAMPO sigue siendo el envoltorio');
});

test('una operacion sin tipo de retorno es void, no String', () => {
  assert.equal(tipos.resolverRetorno('').java, 'void');
  assert.equal(tipos.resolverRetorno(null).java, 'void');
});

test('solo String admite @NotBlank', () => {
  assert.equal(tipos.esTexto('String'), true);
  assert.equal(tipos.esTexto('Integer'), false);
  assert.equal(tipos.esTexto('LocalDate'), false);
});
