const test = require('node:test');
const assert = require('node:assert/strict');

const nombres = require('./naming');

/**
 * Lo que el usuario escribe en el lienzo no tiene por que compilar. Estas pruebas cubren el
 * contrato de `naming.js`: todo lo que salga de aca es un identificador Java valido y es
 * DETERMINISTA, porque exportar dos veces el mismo diagrama tiene que dar el mismo codigo.
 */

test('pascal junta las palabras venga como venga el nombre', () => {
  assert.equal(nombres.pascal('orden de compra'), 'OrdenDeCompra');
  assert.equal(nombres.pascal('orden-de-compra'), 'OrdenDeCompra');
  assert.equal(nombres.pascal('orden_de_compra'), 'OrdenDeCompra');
  assert.equal(nombres.pascal('ordenDeCompra'), 'OrdenDeCompra');
});

test('camel deja la primera en minuscula', () => {
  assert.equal(nombres.camel('Fecha Inscripcion'), 'fechaInscripcion');
});

test('snake separa con guion bajo', () => {
  assert.equal(nombres.snake('OrdenDeCompra'), 'orden_de_compra');
});

test('los acentos se pierden: un identificador acentuado compila, pero una tabla o una ruta HTTP no lo agradecen', () => {
  assert.equal(nombres.pascal('Matrícula'), 'Matricula');
  assert.equal(nombres.camel('Matrícula Alumno'), 'matriculaAlumno');
  assert.equal(nombres.snake('Añadido'), 'anadido');
});

test('un nombre que empieza por digito no puede ser una clase Java, asi que se le antepone una letra', () => {
  assert.equal(nombres.nombreDeClase('2024 Item', 'n_1'), 'E2024Item');
});

test('un nombre vacio cae al respaldo antes que producir una clase sin nombre', () => {
  assert.equal(nombres.nombreDeClase('', 'pedido'), 'Pedido');
  assert.equal(nombres.nombreDeClase('', ''), 'Entidad');
  assert.equal(nombres.nombreDeCampo('', ''), 'campo');
});

test('una palabra reservada de Java no puede ser un campo: se le agrega un sufijo', () => {
  assert.equal(nombres.nombreDeCampo('class', 'x'), 'classValor');
  assert.equal(nombres.nombreDeCampo('return', 'x'), 'returnValor');
  assert.equal(nombres.nombreDeCampo('new', 'x'), 'newValor');
});

test('una palabra reservada de SQL no puede ser una tabla sin comillas: se le agrega un guion bajo', () => {
  assert.equal(nombres.nombreDeTabla('order', 'x'), 'order_');
  assert.equal(nombres.nombreDeTabla('group', 'x'), 'group_');
  assert.equal(nombres.nombreDeTabla('user', 'x'), 'user_');
});

test('"id" NO se renombra: no es reservada en SQL y renombrarla arruinaba la columna de quien llama id a su propio atributo', () => {
  assert.equal(nombres.nombreDeTabla('id', 'x'), 'id');
});

test('el plural castellano de la ruta REST sigue la terminacion', () => {
  assert.equal(nombres.plural('Persona'), 'personas'); // vocal -> +s
  assert.equal(nombres.plural('Vez'), 'veces'); //        z     -> ces
  assert.equal(nombres.plural('Rol'), 'roles'); //        consonante -> +es
  assert.equal(nombres.plural('Lunes'), 'lunes'); //      ya plural -> igual
});

test('dos clases que se llaman igual no pueden dar dos ficheros con el mismo nombre: la segunda se numera', () => {
  const usados = new Set();

  assert.equal(nombres.unico('Pago', usados), 'Pago');
  assert.equal(nombres.unico('Pago', usados), 'Pago2');
  assert.equal(nombres.unico('Pago', usados), 'Pago3');
});

test('el mismo nombre produce SIEMPRE el mismo identificador: sin esto el codigo generado deja de ser comparable entre versiones', () => {
  const primera = nombres.nombreDeClase('Orden de compra', 'n_1');
  const segunda = nombres.nombreDeClase('Orden de compra', 'n_1');

  assert.equal(primera, segunda);
  assert.equal(nombres.nombreDeTabla('Orden de compra'), nombres.nombreDeTabla('Orden de compra'));
});
