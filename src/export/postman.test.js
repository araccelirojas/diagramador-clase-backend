const test = require('node:test');
const assert = require('node:assert/strict');

const { construirPlan } = require('./plan');
const { renderColeccionPostman } = require('./postman');
const { renderRequest } = require('./render');

/**
 * La coleccion de Postman que acompaña al backend exportado.
 *
 * Lo que de verdad importa aqui no es la forma del JSON sino que se pueda ejecutar entera:
 * que cada cuerpo lleve los campos que el DTO acepta, que las relaciones apunten a registros
 * que ya se crearon, y que los DELETE no choquen con las claves foraneas.
 */

// --- Constructores del documento, con la misma forma que emite el editor ---

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

const extremo = (extra = {}) => ({
  role: null,
  multiplicity: null,
  visibility: null,
  navigable: null,
  isOrdered: false,
  isUnique: true,
  ...extra,
});

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

const documento = (nodes, edges = {}) => ({
  schemaVersion: 1,
  meta: { name: 'Universidad' },
  diagrams: [{ id: 'd_main', name: 'main' }],
  nodes,
  edges,
});

function clase(id, nombre, atributos, extra = {}) {
  const n = nodo(id, nombre, 'class', extra);
  n.compartments.attributes = atributos;
  return n;
}

/**
 * Un modelo con todo lo que cambia la forma de las peticiones: clave de texto y numerica,
 * uno a muchos, muchos a muchos, herencia desde una abstracta, y una clase de asociacion con
 * clave compuesta.
 */
function universidad() {
  return documento(
    {
      // Declarada ANTES que Carrera a proposito: el orden de la coleccion no puede depender
      // del orden en que se dibujaron las clases.
      est: clase('est', 'Estudiante', [propiedad('est_prom', 'promedio', 'Double')]),
      per: clase(
        'per',
        'Persona',
        [
          propiedad('per_ci', 'ci', 'String', { isId: true }),
          propiedad('per_nom', 'nombre', 'String', { multiplicity: '1' }),
          propiedad('per_nac', 'nacimiento', 'Date'),
        ],
        { isAbstract: true },
      ),
      car: clase('car', 'Carrera', [
        propiedad('car_cod', 'codigo', 'Long', { isId: true }),
        propiedad('car_nom', 'nombre', 'String'),
      ]),
      mat: clase('mat', 'Materia', [
        propiedad('mat_sig', 'sigla', 'String', { isId: true }),
        propiedad('mat_cred', 'creditos', 'int'),
      ]),
      ins: (() => {
        const n = nodo('ins', 'Inscripcion', 'association-class', { associationId: 'e_ins' });
        n.compartments.attributes = [propiedad('ins_nota', 'nota', 'Double')];
        return n;
      })(),
    },
    {
      e_her: arista('e_her', 'generalization', 'est', 'per'),
      e_car: arista('e_car', 'association', 'car', 'est', {
        source: { multiplicity: '1' },
        target: { multiplicity: '0..*' },
      }),
      e_pre: arista('e_pre', 'association', 'mat', 'car', {
        source: { multiplicity: '0..*' },
        target: { multiplicity: '0..*' },
      }),
      e_ins: arista('e_ins', 'association-class', 'est', 'mat', {
        source: { multiplicity: '0..*' },
        target: { multiplicity: '0..*' },
      }),
    },
  );
}

const coleccionDe = (doc) => {
  const plan = construirPlan(doc);
  return { plan, coleccion: JSON.parse(renderColeccionPostman(plan)) };
};

const carpetaDe = (coleccion, clase) =>
  coleccion.item.find((carpeta) => carpeta.name.endsWith(`· ${clase}`));

const peticionDe = (carpeta, metodo) =>
  carpeta.item.find((item) => item.request.method === metodo);

/** Sustituye las variables como hace Postman y parsea el cuerpo. */
function cuerpoResuelto(item, variables) {
  const texto = item.request.body.raw.replace(/\{\{(\w+)\}\}/g, (_, nombre) => {
    const variable = variables.find((v) => v.key === nombre);
    assert.ok(variable, `el cuerpo usa {{${nombre}}}, que no es ninguna variable de la coleccion`);
    return variable.value;
  });

  return JSON.parse(texto);
}

/** Los nombres de los componentes del record `<Clase>Request` que genera render.js. */
function camposDelRequest(entidad) {
  const java = renderRequest(entidad);
  const cuerpo = /record \w+\(([\s\S]*?)\) \{/.exec(java)[1];

  return cuerpo
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea !== '' && !linea.startsWith('@'))
    .map((linea) => linea.replace(/,$/, '').split(/\s+/).pop())
    .sort();
}

// --- Pruebas ---

test('es una coleccion v2.1 con una carpeta por clase con CRUD, mas la de eliminar', () => {
  const { plan, coleccion } = coleccionDe(universidad());

  assert.equal(
    coleccion.info.schema,
    'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  );

  const conCrud = plan.conCrud.map((e) => e.clase).sort();
  const carpetas = coleccion.item.slice(0, -1).map((c) => c.name.split('· ')[1]).sort();

  assert.deepEqual(carpetas, conCrud);
  assert.match(coleccion.item.at(-1).name, /Eliminar/);
  assert.equal(carpetaDe(coleccion, 'Persona'), undefined, 'una clase abstracta no tiene CRUD');
});

test('cada clase tiene sus cinco endpoints: POST, GET, GET por clave, PUT y DELETE', () => {
  const { plan, coleccion } = coleccionDe(universidad());
  const eliminar = coleccion.item.at(-1).item;

  for (const entidad of plan.conCrud) {
    const carpeta = carpetaDe(coleccion, entidad.clase);
    const metodos = carpeta.item.map((i) => i.request.method);

    assert.deepEqual(metodos, ['POST', 'GET', 'GET', 'PUT'], entidad.clase);
    assert.ok(
      eliminar.some((i) => i.name === `Eliminar ${entidad.clase}`),
      `falta el DELETE de ${entidad.clase}`,
    );
    assert.equal(peticionDe(carpeta, 'POST').request.url, `{{baseUrl}}/api/${entidad.ruta}`);
  }
});

test('el cuerpo de POST y PUT lleva exactamente los campos del Request generado', () => {
  const { plan, coleccion } = coleccionDe(universidad());

  for (const entidad of plan.conCrud) {
    const carpeta = carpetaDe(coleccion, entidad.clase);

    for (const metodo of ['POST', 'PUT']) {
      const cuerpo = cuerpoResuelto(peticionDe(carpeta, metodo), coleccion.variable);

      assert.deepEqual(
        Object.keys(cuerpo).sort(),
        camposDelRequest(entidad),
        `${metodo} de ${entidad.clase}`,
      );
    }
  }
});

test('la clave del POST y las relaciones usan la variable de la clase a la que apuntan', () => {
  const { coleccion } = coleccionDe(universidad());

  const post = peticionDe(carpetaDe(coleccion, 'Estudiante'), 'POST').request.body.raw;

  // La clave la hereda de Persona, pero el registro es de Estudiante: su propia variable.
  assert.match(post, /"ci": "\{\{estudianteId\}\}"/, 'una clave de texto va entre comillas');
  // Carrera tiene clave Long: sin comillas.
  assert.match(post, /"carreraId": \{\{carreraId\}\}/);
});

test('las carpetas van en orden de dependencias, sin importar el orden del diagrama', () => {
  const { coleccion } = coleccionDe(universidad());
  const posicion = (clase) => coleccion.item.findIndex((c) => c.name.endsWith(`· ${clase}`));

  assert.ok(posicion('Carrera') < posicion('Estudiante'), 'Estudiante apunta a Carrera');
  assert.ok(posicion('Estudiante') < posicion('Inscripcion'));
  assert.ok(posicion('Materia') < posicion('Inscripcion'));
});

test('los DELETE van en el orden inverso al de creacion', () => {
  const { coleccion } = coleccionDe(universidad());

  const creacion = coleccion.item.slice(0, -1).map((c) => c.name.split('· ')[1]);
  const borrado = coleccion.item.at(-1).item.map((i) => i.name.replace('Eliminar ', ''));

  assert.deepEqual(borrado, [...creacion].reverse());
});

test('la clase de asociacion usa sus dos claves en la ruta, como su controlador', () => {
  const { plan, coleccion } = coleccionDe(universidad());
  const carpeta = carpetaDe(coleccion, 'Inscripcion');
  const ruta = plan.conCrud.find((e) => e.clase === 'Inscripcion').ruta;

  assert.equal(
    peticionDe(carpeta, 'PUT').request.url,
    `{{baseUrl}}/api/${ruta}/{{estudianteId}}/{{materiaId}}`,
  );
  assert.ok(
    !coleccion.variable.some((v) => v.key === 'inscripcionId'),
    'una clave compuesta no tiene variable propia: se forma con las de sus extremos',
  );
});

test('cada peticion comprueba su codigo de estado', () => {
  const { coleccion } = coleccionDe(universidad());
  const codigo = (item) => /status\((\d+)\)/.exec(item.event[0].script.exec.join('\n'))[1];

  const carpeta = carpetaDe(coleccion, 'Carrera');
  assert.equal(codigo(peticionDe(carpeta, 'POST')), '201');
  assert.equal(codigo(peticionDe(carpeta, 'GET')), '200');
  assert.equal(codigo(peticionDe(carpeta, 'PUT')), '200');
  assert.equal(codigo(coleccion.item.at(-1).item[0]), '204');
});

test('clases con clave del mismo tipo no comparten valor: con herencia chocarian', () => {
  const { coleccion } = coleccionDe(universidad());
  const valores = coleccion.variable.filter((v) => v.key !== 'baseUrl').map((v) => v.value);

  assert.equal(new Set(valores).size, valores.length);
});

test('el backend exportado lleva la coleccion dentro de postman/', async () => {
  const { construirProyecto } = require('./proyecto');
  const { ficheros, artefacto } = await construirProyecto(universidad());

  const ruta = `postman/${artefacto}.postman_collection.json`;
  const fichero = ficheros.find((f) => f.ruta === ruta);

  assert.ok(fichero, `falta ${ruta} en el zip`);
  assert.doesNotThrow(() => JSON.parse(fichero.contenido.toString('utf8')));
});
