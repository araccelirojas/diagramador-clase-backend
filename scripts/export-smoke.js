/**
 * Exporta un diagrama de prueba a una carpeta y la deja lista para compilar.
 *
 *   node scripts/export-smoke.js ./tmp-export
 *   cd tmp-export && ./mvnw clean package
 *
 * Es la red de seguridad del exportador: el diagrama de prueba cubre a la vez herencia,
 *
 * realizacion de interfaz, uno-a-muchos, muchos-a-muchos con clase de asociacion,
 * atributos derivados, de solo lectura y estaticos, y un tipo que no existe.
 */
const fs = require('node:fs/promises');
const path = require('node:path');

const { construirProyecto } = require('../src/export/proyecto');

const ahora = new Date().toISOString();

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

const persona = nodo('n_persona', 'Persona', 'class', { isAbstract: true });
persona.compartments.attributes = [
  propiedad('m_dni', 'dni', 'String', { multiplicity: '1', isId: true }),
  propiedad('m_nombre', 'nombre', 'String', { multiplicity: '1' }),
  propiedad('m_nacimiento', 'fechaNacimiento', 'date'),
];

const estudiante = nodo('n_est', 'Estudiante', 'class');
estudiante.compartments.attributes = [
  propiedad('m_codigo', 'codigo', 'String', { multiplicity: '1' }),
  propiedad('m_promedio', 'promedio', 'decimal', { isDerived: true }),
  propiedad('m_alta', 'fechaAlta', 'datetime', { isReadOnly: true }),
  propiedad('m_raro', 'campoRaro', 'TipoInventado'),
  propiedad('m_estatico', 'contador', 'int', { isStatic: true }),
];

const curso = nodo('n_curso', 'Curso', 'class');
curso.compartments.attributes = [
  propiedad('m_sigla', 'sigla', 'String', { multiplicity: '1', isId: true }),
  propiedad('m_titulo', 'titulo', 'String', { multiplicity: '1' }),
];

const docente = nodo('n_doc', 'Docente', 'class');
docente.compartments.attributes = [
  propiedad('m_legajo', 'legajo', 'String', { multiplicity: '1', isId: true }),
];

const pagable = nodo('n_pag', 'Pagable', 'interface');
pagable.compartments.operations = [
  {
    kind: 'operation',
    id: 'o_pagar',
    name: 'pagar',
    visibility: '+',
    parameters: [{ id: 'p_monto', name: 'monto', type: 'decimal', direction: 'in', defaultValue: null }],
    returnType: 'void',
    isStatic: false,
    isAbstract: false,
    isQuery: false,
  },
];

// Clase de asociacion del muchos-a-muchos Estudiante <-> Curso.
const matricula = nodo('n_mat', 'Matrícula', 'association-class', { associationId: 'e_mat' });
matricula.compartments.attributes = [
  propiedad('m_nota', 'nota', 'decimal'),
  propiedad('m_fecha', 'fechaInscripcion', 'datetime'),
];

const documento = {
  schemaVersion: 3,
  kind: 'uml-class-model',
  meta: { name: 'Sistema de Matrículas', createdAt: ahora, updatedAt: ahora },
  diagrams: [{ id: 'd_main', name: 'Modelo de dominio', viewport: { x: 0, y: 0, zoom: 1 } }],
  nodes: {
    n_persona: persona,
    n_est: estudiante,
    n_curso: curso,
    n_doc: docente,
    n_pag: pagable,
    n_mat: matricula,
  },
  edges: {
    e_gen: arista('e_gen', 'generalization', 'n_est', 'n_persona'),
    e_real: arista('e_real', 'realization', 'n_est', 'n_pag'),
    // Un docente dicta muchos cursos.
    e_dicta: arista('e_dicta', 'association', 'n_doc', 'n_curso', {
      source: { multiplicity: '1' },
      target: { multiplicity: '0..*', role: 'cursos' },
    }),
    // Muchos a muchos con datos propios.
    e_mat: arista('e_mat', 'association-class', 'n_est', 'n_curso', {
      source: { multiplicity: '0..*' },
      target: { multiplicity: '0..*' },
    }),
  },
};

(async () => {
  const destino = process.argv[2] || './tmp-export';
  const { plan, ficheros, artefacto } = await construirProyecto(documento);

  console.log(`artefacto Maven: ${artefacto}`);
  console.log(`entidades: ${plan.entidades.map((e) => e.clase).join(', ')}`);
  console.log(`con CRUD:  ${plan.conCrud.map((e) => `${e.clase} -> /api/${e.ruta}`).join(', ')}`);
  console.log(`interfaces: ${plan.interfaces.map((i) => i.clase).join(', ') || '(ninguna)'}`);
  if (plan.avisos.length) console.log(`avisos:\n  - ${plan.avisos.join('\n  - ')}`);
  console.log(`ficheros totales: ${ficheros.length}`);

  await fs.rm(destino, { recursive: true, force: true });

  for (const fichero of ficheros) {
    const completa = path.join(destino, fichero.ruta);
    await fs.mkdir(path.dirname(completa), { recursive: true });
    await fs.writeFile(completa, fichero.contenido);
    if (fichero.ejecutable) await fs.chmod(completa, 0o755);
  }

  console.log(`\nescrito en ${destino}`);
})();
