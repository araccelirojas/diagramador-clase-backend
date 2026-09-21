/**
 * El esquema de lo que el modelo tiene que devolver al leer un boceto.
 *
 * Deliberadamente NO es el formato `contenido` del editor. Ese es profundo —nodos y aristas
 * indexados por id, invariantes, schemaVersion, associationId, waypoints, viewport— y pedirle
 * eso a un modelo es invitar a documentos invalidos. Aca se pide una forma PLANA, y el
 * documento de verdad lo construye el frontend con sus propias factories, que es donde vive
 * el contrato (CLAUDE.md §5).
 *
 * Va como Structured Output con `strict: true`, asi que la forma esta GARANTIZADA: el modelo
 * no puede devolver otra cosa. Eso obliga a que todo campo este en `required` y a que lo
 * opcional se exprese como tipo nullable, no como ausencia.
 */

/** Las relaciones que el registry del editor conoce. Nada fuera de esta lista es valido. */
const TIPOS_RELACION = [
  'association',
  'directed-association',
  'aggregation',
  'composition',
  'generalization',
  'realization',
  'association-class',
];

const VISIBILIDADES = ['+', '-', '#', '~'];

const caja = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'ancho', 'alto'],
  properties: {
    x: { type: 'number', description: 'Borde izquierdo, 0 a 1 sobre el ancho de la imagen.' },
    y: { type: 'number', description: 'Borde superior, 0 a 1 sobre el alto de la imagen.' },
    ancho: { type: 'number', description: 'Ancho de la caja, 0 a 1.' },
    alto: { type: 'number', description: 'Alto de la caja, 0 a 1.' },
  },
};

const parametro = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'tipo'],
  properties: {
    nombre: { type: 'string' },
    tipo: { type: ['string', 'null'] },
  },
};

const atributo = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'tipo', 'visibilidad', 'multiplicidad', 'esClave'],
  properties: {
    nombre: { type: 'string' },
    tipo: { type: ['string', 'null'], description: 'Tal como esta escrito: int, String, Date…' },
    visibilidad: { type: 'string', enum: VISIBILIDADES },
    multiplicidad: { type: ['string', 'null'], description: '"1", "0..1", "0..*"… o null.' },
    esClave: {
      type: 'boolean',
      description: 'true solo si el boceto lo marca como identificador: {id}, PK o subrayado.',
    },
  },
};

const operacion = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'tipoRetorno', 'visibilidad', 'parametros'],
  properties: {
    nombre: { type: 'string' },
    tipoRetorno: { type: ['string', 'null'] },
    visibilidad: { type: 'string', enum: VISIBILIDADES },
    parametros: { type: 'array', items: parametro },
  },
};

const clase = {
  type: 'object',
  additionalProperties: false,
  required: ['nombre', 'esInterfaz', 'esAbstracta', 'caja', 'atributos', 'operaciones'],
  properties: {
    nombre: { type: 'string' },
    esInterfaz: { type: 'boolean', description: 'true si lleva «interface».' },
    esAbstracta: { type: 'boolean', description: 'true si el nombre esta en itálica o dice {abstract}.' },
    caja,
    atributos: { type: 'array', items: atributo },
    operaciones: { type: 'array', items: operacion },
  },
};

const relacion = {
  type: 'object',
  additionalProperties: false,
  required: [
    'tipo',
    'origen',
    'destino',
    'nombre',
    'multiplicidadOrigen',
    'multiplicidadDestino',
    'rolOrigen',
    'rolDestino',
    'claseAsociacion',
  ],
  properties: {
    tipo: { type: 'string', enum: TIPOS_RELACION },
    origen: { type: 'string', description: 'Nombre exacto de una clase de la lista.' },
    destino: { type: 'string', description: 'Nombre exacto de una clase de la lista.' },
    nombre: {
      type: ['string', 'null'],
      description:
        'Nombre de la relacion entera: la etiqueta que nombra el vinculo, no a ninguno de ' +
        'los dos extremos. Suele ir sobre la linea, a veces con un triangulo de lectura. ' +
        'Ej: "Start", "Goal", "R1", "cursa".',
    },
    multiplicidadOrigen: { type: ['string', 'null'] },
    multiplicidadDestino: { type: ['string', 'null'] },
    rolOrigen: {
      type: ['string', 'null'],
      description:
        'Papel que juega la clase de ORIGEN dentro de la relacion, si el dibujo lo nombra. ' +
        'Es el nombre del atributo que la otra clase tendria. Ej: "supervisor", "empleados".',
    },
    rolDestino: {
      type: ['string', 'null'],
      description: 'Lo mismo para la clase de DESTINO.',
    },
    claseAsociacion: {
      type: ['string', 'null'],
      description:
        'Nombre de la clase unida a ESTA relación por una línea punteada, o null. ' +
        'Solo con tipo "association-class".',
    },
  },
};

const ESQUEMA_BOCETO = {
  type: 'object',
  additionalProperties: false,
  required: ['clases', 'relaciones'],
  properties: {
    clases: { type: 'array', items: clase },
    relaciones: { type: 'array', items: relacion },
  },
};

module.exports = { ESQUEMA_BOCETO, TIPOS_RELACION, VISIBILIDADES };
