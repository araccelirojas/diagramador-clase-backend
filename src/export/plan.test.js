const test = require('node:test');
const assert = require('node:assert/strict');

const { construirPlan, leerMultiplicidad, esMuchos, esObligatorio } = require('./plan');

/**
 * El plan es donde vive TODA la semantica UML -> JPA: los renderizadores solo escriben texto
 * a partir de el. Por eso estas pruebas son las que de verdad cubren la exportacion, y por
 * eso van sobre el plan y no sobre el Java generado — el texto cambia con cualquier retoque
 * de plantilla, las decisiones de mapeo no.
 *
 * Complementan a `scripts/export-smoke.js`, que comprueba que el proyecto entero compile
 * pero no puede afirmar nada sobre una decision concreta.
 */

// --- Constructores del documento, con la misma forma que emite el editor (CLAUDE.md §5) ---

function nodo(id, nombre, kind, extra = {}) {
  return {
    id,
    diagramId: 'd_main',
    kind,
    name: nombre,
    keywords: [],
    isAbstract: false,
    visibility: '+',
    position: { x: 0, y: 0 },
    size: { width: 200, height: null },
    z: 0,
    parentId: null,
    associationId: null,
    compartments: { attributes: [], operations: [] },
    ...extra,
  };
}

function propiedad(id, nombre, tipo, extra = {}) {
  return {
    kind: 'property',
    id,
    name: nombre,
    type: tipo,
    visibility: '-',
    multiplicity: null,
    defaultValue: null,
    isStatic: false,
    isDerived: false,
    isReadOnly: false,
    isId: false,
    isOrdered: false,
    isUnique: true,
    ...extra,
  };
}

function extremo(extra = {}) {
  return {
    role: null,
    multiplicity: null,
    visibility: null,
    navigable: null,
    isOrdered: false,
    isUnique: true,
    ...extra,
  };
}

function arista(id, kind, source, target, ends = {}) {
  return {
    id,
    diagramId: 'd_main',
    kind,
    source,
    target,
    name: null,
    nameDirection: 'none',
    ends: { source: extremo(ends.source), target: extremo(ends.target) },
    waypoints: [],
    routing: 'straight',
  };
}

function documento(nodes, edges = {}) {
  return {
    schemaVersion: 1,
    meta: { name: 'Modelo de prueba' },
    diagrams: [{ id: 'd_main', name: 'main' }],
    nodes,
    edges,
  };
}

/** Una entidad minima: con su clave, que es lo que la exportacion exige. */
function entidadConClave(id, nombre, extra = {}) {
  const n = nodo(id, nombre, 'class', extra);
  n.compartments.attributes = [propiedad(`${id}_id`, 'id', 'Long', { isId: true })];
  return n;
}

const buscar = (plan, clase) => plan.entidades.find((e) => e.clase === clase);
const relacion = (entidad, tipo) => entidad.relaciones.find((r) => r.tipo === tipo);

// --- Multiplicidad ---

test('leerMultiplicidad entiende las formas que escribe el diagramador', () => {
  assert.deepEqual(leerMultiplicidad('*'), { min: 0, max: Infinity, especificada: true });
  assert.deepEqual(leerMultiplicidad('0..*'), { min: 0, max: Infinity, especificada: true });
  assert.deepEqual(leerMultiplicidad('1..*'), { min: 1, max: Infinity, especificada: true });
  assert.deepEqual(leerMultiplicidad('0..1'), { min: 0, max: 1, especificada: true });
  assert.deepEqual(leerMultiplicidad('1'), { min: 1, max: 1, especificada: true });
});

test('una multiplicidad vacia se marca como NO especificada, que no es lo mismo que "0..1"', () => {
  const vacia = leerMultiplicidad('');

  assert.equal(vacia.especificada, false);
  assert.equal(leerMultiplicidad(null).especificada, false);
  assert.equal(leerMultiplicidad(undefined).especificada, false);
});

test('una multiplicidad ilegible no rompe la exportacion: cae a 0..1', () => {
  assert.deepEqual(leerMultiplicidad('abc'), { min: 0, max: 1, especificada: true });
});

test('esMuchos y esObligatorio leen el limite correcto', () => {
  assert.equal(esMuchos(leerMultiplicidad('0..*')), true);
  assert.equal(esMuchos(leerMultiplicidad('1')), false);

  assert.equal(esObligatorio(leerMultiplicidad('1')), true);
  assert.equal(esObligatorio(leerMultiplicidad('0..1')), false);
  assert.equal(
    esObligatorio(leerMultiplicidad('')),
    false,
    'sin multiplicidad escrita no se puede afirmar que sea obligatorio',
  );
});

// --- Relaciones ---

test('uno a muchos: la coleccion en el lado del uno y la clave foranea en el lado del muchos', () => {
  const plan = construirPlan(
    documento(
      { c: entidadConClave('c', 'Cliente'), p: entidadConClave('p', 'Pedido') },
      {
        e: arista('e', 'association', 'c', 'p', {
          source: { multiplicity: '1' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const unLado = relacion(buscar(plan, 'Cliente'), 'OneToMany');
  const otroLado = relacion(buscar(plan, 'Pedido'), 'ManyToOne');

  assert.equal(unLado.campo, 'pedidos');
  assert.equal(unLado.propietaria, false);
  assert.equal(unLado.mappedBy, otroLado.campo, 'el mappedBy tiene que apuntar al campo real del otro lado');

  assert.equal(otroLado.campo, 'cliente');
  assert.equal(otroLado.propietaria, true, 'la clave foranea vive del lado del muchos');
  assert.equal(otroLado.obligatorio, true, 'el origen es "1", asi que la FK no admite null');
});

test('muchos a muchos: una sola tabla de union, y solo un lado la declara', () => {
  const plan = construirPlan(
    documento(
      { a: entidadConClave('a', 'Alumno'), b: entidadConClave('b', 'Curso') },
      {
        e: arista('e', 'association', 'a', 'b', {
          source: { multiplicity: '0..*' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const propietaria = relacion(buscar(plan, 'Alumno'), 'ManyToMany');
  const inversa = relacion(buscar(plan, 'Curso'), 'ManyToMany');

  assert.equal(propietaria.propietaria, true);
  assert.equal(propietaria.tablaUnion, 'alumno_curso');

  assert.equal(inversa.propietaria, false);
  assert.equal(inversa.tablaUnion, undefined, 'el lado inverso NO repite la tabla de union');
  assert.equal(inversa.mappedBy, propietaria.campo);
});

test('uno a uno: un solo propietario', () => {
  const plan = construirPlan(
    documento(
      { a: entidadConClave('a', 'Persona'), b: entidadConClave('b', 'Pasaporte') },
      {
        e: arista('e', 'association', 'a', 'b', {
          source: { multiplicity: '1' },
          target: { multiplicity: '1' },
        }),
      },
    ),
  );

  assert.equal(relacion(buscar(plan, 'Persona'), 'OneToOne').propietaria, true);
  assert.equal(relacion(buscar(plan, 'Pasaporte'), 'OneToOne').propietaria, false);
});

test('la composicion arrastra a la parte: cascada total y borrado de huerfanos', () => {
  const plan = construirPlan(
    documento(
      { f: entidadConClave('f', 'Factura'), l: entidadConClave('l', 'Linea') },
      {
        e: arista('e', 'composition', 'f', 'l', {
          source: { multiplicity: '1' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const coleccion = relacion(buscar(plan, 'Factura'), 'OneToMany');

  assert.equal(coleccion.cascade, 'jakarta.persistence.CascadeType.ALL');
  assert.equal(coleccion.orphanRemoval, true, 'la parte de una composicion muere con el todo');
});

test('la agregacion NO arrastra: persiste y fusiona, pero la parte sobrevive sola', () => {
  const plan = construirPlan(
    documento(
      { e1: entidadConClave('e1', 'Equipo'), j: entidadConClave('j', 'Jugador') },
      {
        e: arista('e', 'aggregation', 'e1', 'j', {
          source: { multiplicity: '1' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const coleccion = relacion(buscar(plan, 'Equipo'), 'OneToMany');

  assert.match(coleccion.cascade, /PERSIST/);
  assert.match(coleccion.cascade, /MERGE/);
  assert.doesNotMatch(coleccion.cascade, /ALL/);
  assert.equal(coleccion.orphanRemoval, false, 'disolver un equipo no borra a sus jugadores');
});

test('una asociacion simple no lleva cascada: nada arrastra a nada', () => {
  const plan = construirPlan(
    documento(
      { a: entidadConClave('a', 'Autor'), l: entidadConClave('l', 'Libro') },
      {
        e: arista('e', 'association', 'a', 'l', {
          source: { multiplicity: '1' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  assert.equal(relacion(buscar(plan, 'Autor'), 'OneToMany').cascade, null);
});

test('un extremo no navegable oculta la coleccion, pero la clave foranea se genera igual', () => {
  const plan = construirPlan(
    documento(
      { c: entidadConClave('c', 'Cliente'), p: entidadConClave('p', 'Pedido') },
      {
        e: arista('e', 'association', 'c', 'p', {
          source: { multiplicity: '1', navigable: false },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const fk = relacion(buscar(plan, 'Pedido'), 'ManyToOne');

  assert.ok(fk, 'sin este lado no hay clave foranea, asi que tiene que existir');
  assert.equal(fk.oculto, true, 'lo que se omite es el acceso, no la columna');
});

// --- Herencia y realizacion ---

test('la generalizacion apunta de la subclase al padre, no al reves', () => {
  const persona = entidadConClave('per', 'Persona', { isAbstract: true });
  const alumno = nodo('alu', 'Alumno', 'class');

  const plan = construirPlan(
    documento(
      { per: persona, alu: alumno },
      { g: arista('g', 'generalization', 'alu', 'per') },
    ),
  );

  assert.equal(buscar(plan, 'Alumno').padre.clase, 'Persona');
  assert.equal(buscar(plan, 'Persona').padre, null);
});

test('la subclase hereda la clave de su raiz, para que su repositorio sepa el tipo del id', () => {
  const persona = entidadConClave('per', 'Persona', { isAbstract: true });
  const alumno = nodo('alu', 'Alumno', 'class');

  const plan = construirPlan(
    documento(
      { per: persona, alu: alumno },
      { g: arista('g', 'generalization', 'alu', 'per') },
    ),
  );

  assert.equal(buscar(plan, 'Alumno').clave.campo, buscar(plan, 'Persona').clave.campo);
  assert.deepEqual(plan.faltanClaves, [], 'la subclase no necesita su propio {id}');
});

test('la realizacion pone la interfaz en la lista de interfaces, no en la de entidades', () => {
  const plan = construirPlan(
    documento(
      { i: nodo('i', 'Pagable', 'interface'), f: entidadConClave('f', 'Factura') },
      { r: arista('r', 'realization', 'f', 'i') },
    ),
  );

  assert.deepEqual(plan.interfaces.map((x) => x.clase), ['Pagable']);
  assert.deepEqual(plan.entidades.map((x) => x.clase), ['Factura']);
  assert.deepEqual(buscar(plan, 'Factura').interfaces.map((x) => x.clase), ['Pagable']);
});

test('una interfaz no genera CRUD: no es una tabla', () => {
  const plan = construirPlan(
    documento(
      { i: nodo('i', 'Pagable', 'interface'), f: entidadConClave('f', 'Factura') },
      { r: arista('r', 'realization', 'f', 'i') },
    ),
  );

  assert.deepEqual(plan.conCrud.map((e) => e.clase), ['Factura']);
  assert.equal(buscar(plan, 'Factura').ruta, 'facturas', 'la ruta REST va en plural');
});

// --- Clase de asociacion ---

test('una clase de asociacion ES la asociacion: genera UN solo mapeo, no un ManyToMany ademas', () => {
  const alumno = entidadConClave('a', 'Alumno');
  const curso = entidadConClave('c', 'Curso');
  const matricula = nodo('m', 'Matricula', 'association-class', { associationId: 'e' });
  matricula.compartments.attributes = [propiedad('m_nota', 'nota', 'Double')];

  const plan = construirPlan(
    documento(
      { a: alumno, c: curso, m: matricula },
      {
        e: arista('e', 'association-class', 'a', 'c', {
          source: { multiplicity: '0..*' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const tiposEnAlumno = buscar(plan, 'Alumno').relaciones.map((r) => r.tipo);

  assert.deepEqual(
    tiposEnAlumno,
    ['OneToMany'],
    'un ManyToMany aqui seria una segunda tabla de union para una sola arista del diagrama',
  );
  assert.equal(buscar(plan, 'Alumno').relaciones[0].campo, 'matriculas');
});

test('la clase de asociacion cuelga de sus dos extremos con sendos ManyToOne', () => {
  const alumno = entidadConClave('a', 'Alumno');
  const curso = entidadConClave('c', 'Curso');
  const matricula = nodo('m', 'Matricula', 'association-class', { associationId: 'e' });
  matricula.compartments.attributes = [propiedad('m_nota', 'nota', 'Double')];

  const plan = construirPlan(
    documento(
      { a: alumno, c: curso, m: matricula },
      {
        e: arista('e', 'association-class', 'a', 'c', {
          source: { multiplicity: '0..*' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  const suyas = buscar(plan, 'Matricula').relaciones;

  assert.deepEqual(suyas.map((r) => r.tipo), ['ManyToOne', 'ManyToOne']);
  assert.deepEqual(suyas.map((r) => r.campo), ['alumno', 'curso']);
});

test('la identidad de una clase de asociacion es la de sus dos extremos, asi que no exige un {id} propio', () => {
  const alumno = entidadConClave('a', 'Alumno');
  const curso = entidadConClave('c', 'Curso');
  const matricula = nodo('m', 'Matricula', 'association-class', { associationId: 'e' });
  matricula.compartments.attributes = [propiedad('m_nota', 'nota', 'Double')];

  const plan = construirPlan(
    documento(
      { a: alumno, c: curso, m: matricula },
      {
        e: arista('e', 'association-class', 'a', 'c', {
          source: { multiplicity: '0..*' },
          target: { multiplicity: '0..*' },
        }),
      },
    ),
  );

  assert.equal(buscar(plan, 'Matricula').claveCompuesta, true);
  assert.deepEqual(plan.faltanClaves, []);
});

// --- Claves primarias ---

test('sin {id} la exportacion se detiene y lo dice: no se inventa un "Long id"', () => {
  const suelta = nodo('s', 'Suelta', 'class');
  suelta.compartments.attributes = [propiedad('s_n', 'nombre', 'String')];

  const plan = construirPlan(documento({ s: suelta }));

  assert.equal(plan.faltanClaves.length, 1);
  assert.match(plan.faltanClaves[0], /Suelta/);
  assert.match(plan.faltanClaves[0], /\{id\}/);
});

test('dos atributos marcados con {id} se rechazan, en vez de elegir uno en silencio', () => {
  const doble = nodo('d', 'Doble', 'class');
  doble.compartments.attributes = [
    propiedad('d_a', 'a', 'Long', { isId: true }),
    propiedad('d_b', 'b', 'Long', { isId: true }),
  ];

  const plan = construirPlan(documento({ d: doble }));

  assert.equal(plan.faltanClaves.length, 1);
  assert.match(plan.faltanClaves[0], /2 atributos/);
});

test('la clave marcada queda obligatoria: una clave asignada no puede llegar nula a Hibernate', () => {
  const plan = construirPlan(documento({ c: entidadConClave('c', 'Cliente') }));

  assert.equal(buscar(plan, 'Cliente').clave.obligatorio, true);
});

// --- Atributos ---

test('un atributo static no es una columna, y se avisa en vez de descartarlo en silencio', () => {
  const config = entidadConClave('cf', 'Config');
  config.compartments.attributes.push(
    propiedad('cf_v', 'VERSION', 'String', { isStatic: true }),
  );

  const plan = construirPlan(documento({ cf: config }));

  assert.deepEqual(buscar(plan, 'Config').atributos.map((a) => a.campo), ['id']);
  assert.equal(plan.avisos.length, 1);
  assert.match(plan.avisos[0], /static/);
});

// --- Nombres ---

test('dos clases con el mismo nombre no pueden dar dos ficheros iguales: la segunda se renombra', () => {
  const plan = construirPlan(
    documento({ a: entidadConClave('a', 'Pago'), b: entidadConClave('b', 'Pago') }),
  );

  assert.deepEqual(plan.entidades.map((e) => e.clase), ['Pago', 'Pago2']);
});

test('el nombre del modelo sale del documento, y hay respaldo si no lo trae', () => {
  const conNombre = construirPlan(documento({ c: entidadConClave('c', 'Cliente') }));
  assert.equal(conNombre.nombreModelo, 'Modelo de prueba');

  const sinNombre = construirPlan({
    schemaVersion: 1,
    meta: {},
    diagrams: [{ id: 'd_main', name: 'main' }],
    nodes: {},
    edges: {},
  });
  assert.equal(sinNombre.nombreModelo, 'Modelo');
});

test('un documento vacio da un plan vacio, no una excepcion', () => {
  const plan = construirPlan({ schemaVersion: 1, meta: {}, diagrams: [], nodes: {}, edges: {} });

  assert.deepEqual(plan.entidades, []);
  assert.deepEqual(plan.interfaces, []);
  assert.deepEqual(plan.faltanClaves, []);
});

test('una relacion hacia un nodo que no existe se ignora en vez de romper la exportacion', () => {
  const plan = construirPlan(
    documento(
      { c: entidadConClave('c', 'Cliente') },
      { e: arista('e', 'association', 'c', 'n_fantasma', { target: { multiplicity: '0..*' } }) },
    ),
  );

  assert.deepEqual(buscar(plan, 'Cliente').relaciones, []);
});
