/**
 * Lo que la IA del chat puede hacerle al diagrama (CU-04).
 *
 * Son las mismas herramientas del agente de voz, por NOMBRE: quien las ejecuta es el
 * frontend (`src/voz/herramientas.ts`, filtradas por `src/ia/proposal.ts`), porque el
 * modelo UML vive alla. Aca solo se describen para el modelo. Si se agrega o renombra una
 * alla, hay que reflejarla aca; una que no exista en el cliente vuelve como error en el
 * resultado, no rompe nada.
 *
 * Diferencias con el agente de voz, a proposito:
 *   - No hay herramientas de lectura: el diagrama ya va en el contexto.
 *   - No hay `deshacer`: deshaceria lo ultimo que hizo una persona en su pantalla.
 *   - Borrar no pide `confirmado`: la votacion de la sala es la confirmacion.
 */

const texto = (description) => ({ type: 'string', description });
const VISIBILIDAD = { type: 'string', enum: ['publico', 'privado', 'protegido', 'paquete'] };
const DIRECCION = { type: 'string', enum: ['derecha', 'izquierda', 'arriba', 'abajo', 'cerca'] };
const MULTIPLICIDAD = texto('1, 0..1, 1..*, 0..*');

function herramienta(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

const HERRAMIENTAS = [
  herramienta('crear_clase', 'Crea UNA clase nueva.', {
    nombre: texto('Nombre de la clase nueva.'),
    tipo: { type: 'string', enum: ['clase', 'interfaz'], description: 'Por defecto clase.' },
    cerca_de: texto('Clase junto a la cual colocarla.'),
    direccion: DIRECCION,
  }, ['nombre']),
  herramienta('renombrar_clase', 'Le cambia el nombre a una clase.', {
    actual: texto('Cómo se llama ahora.'),
    nuevo: texto('Cómo se va a llamar.'),
  }, ['actual', 'nuevo']),
  herramienta('eliminar_clase', 'Borra una clase y todas sus relaciones.', {
    nombre: texto('Clase a borrar.'),
  }, ['nombre']),
  herramienta('mover_clase', 'Mueve una clase junto a otra.', {
    nombre: texto('Clase que se mueve.'),
    referencia: texto('Clase de referencia.'),
    direccion: DIRECCION,
  }, ['nombre', 'referencia', 'direccion']),
  herramienta('agregar_atributo', 'Agrega un atributo a una clase.', {
    clase: texto('Clase que recibe el atributo.'),
    nombre: texto('Nombre del atributo.'),
    tipo: texto('String, int, Long, Date, BigDecimal...'),
    visibilidad: VISIBILIDAD,
    multiplicidad: MULTIPLICIDAD,
    es_clave: { type: 'boolean', description: 'true si es la clave primaria {id}.' },
  }, ['clase', 'nombre']),
  herramienta('modificar_atributo', 'Cambia nombre, tipo, visibilidad, multiplicidad o clave de un atributo.', {
    clase: texto('Clase a la que pertenece.'),
    nombre: texto('Atributo a cambiar.'),
    nuevo_nombre: texto('Nombre nuevo.'),
    tipo: texto('Tipo nuevo.'),
    visibilidad: VISIBILIDAD,
    multiplicidad: MULTIPLICIDAD,
    es_clave: { type: 'boolean' },
  }, ['clase', 'nombre']),
  herramienta('quitar_atributo', 'Quita un atributo de una clase.', {
    clase: texto('Clase.'),
    nombre: texto('Atributo a quitar.'),
  }, ['clase', 'nombre']),
  herramienta('agregar_operacion', 'Agrega una operación (método) a una clase.', {
    clase: texto('Clase.'),
    nombre: texto('Nombre de la operación.'),
    tipo_retorno: texto('Lo que devuelve.'),
    visibilidad: VISIBILIDAD,
    parametros: { type: 'array', items: { type: 'string' }, description: 'Como "curso: Curso".' },
  }, ['clase', 'nombre']),
  herramienta('quitar_operacion', 'Quita una operación de una clase.', {
    clase: texto('Clase.'),
    nombre: texto('Operación a quitar.'),
  }, ['clase', 'nombre']),
  herramienta(
    'crear_relacion',
    'Conecta dos clases. En generalización el origen es la SUBCLASE; en composición y ' +
      'agregación el origen es el TODO, el del rombo.',
    {
      origen: texto('Clase de origen.'),
      destino: texto('Clase de destino.'),
      tipo: {
        type: 'string',
        enum: [
          'asociacion',
          'asociacion dirigida',
          'agregacion',
          'composicion',
          'generalizacion',
          'realizacion',
          'clase de asociacion',
        ],
      },
      multiplicidad_origen: MULTIPLICIDAD,
      multiplicidad_destino: MULTIPLICIDAD,
      nombre: texto('Nombre de la relación.'),
      rol_origen: texto('Rol del extremo de origen.'),
      rol_destino: texto('Rol del extremo de destino.'),
      clase_asociacion: texto('Solo para clase de asociación: nombre de la clase colgante.'),
    },
    ['origen', 'destino', 'tipo'],
  ),
  herramienta('modificar_relacion', 'Cambia multiplicidades, roles o el nombre de una relación.', {
    origen: texto('Una de las dos clases.'),
    destino: texto('La otra.'),
    tipo: texto('Tipo, si hay varias entre esas dos clases.'),
    multiplicidad_origen: MULTIPLICIDAD,
    multiplicidad_destino: MULTIPLICIDAD,
    nombre: texto('Nombre nuevo.'),
    rol_origen: texto('Rol nuevo del lado de origen.'),
    rol_destino: texto('Rol nuevo del lado de destino.'),
  }, ['origen', 'destino']),
  herramienta('eliminar_relacion', 'Borra una relación.', {
    origen: texto('Una de las dos clases.'),
    destino: texto('La otra.'),
    tipo: texto('Tipo, si hay varias entre esas dos clases.'),
  }, ['origen', 'destino']),
  herramienta(
    'ordenar_diagrama',
    'Recoloca TODAS las clases con un algoritmo, sin cajas encimadas. Solo si lo piden o ' +
      'si agregaste varias clases y el diagrama quedó desordenado.',
  ),
  herramienta('cambiar_trazado', 'Cambia la forma de una línea: recta, ortogonal o curva.', {
    origen: texto('Una de las dos clases.'),
    destino: texto('La otra.'),
    trazado: { type: 'string', enum: ['recta', 'ortogonal', 'curva'] },
  }, ['origen', 'destino', 'trazado']),
  herramienta('enderezar_relacion', 'Quita los quiebres puestos a mano en una línea.', {
    origen: texto('Una de las dos clases.'),
    destino: texto('La otra.'),
  }, ['origen', 'destino']),
];

/** Mas que esto en una sola respuesta no es un cambio: es otro diagrama. */
const MAX_OPERACIONES = 40;

/**
 * Las llamadas del modelo, como operaciones para el cliente. Los argumentos llegan como
 * texto JSON; uno que no se puede leer se manda vacio y la herramienta lo rechaza con un
 * error que vuelve al modelo.
 */
function leerLlamadas(toolCalls) {
  return toolCalls.slice(0, MAX_OPERACIONES).map((llamada) => {
    let argumentos = {};
    try {
      const leidos = JSON.parse(llamada.function.arguments || '{}');
      if (leidos && typeof leidos === 'object' && !Array.isArray(leidos)) argumentos = leidos;
    } catch {
      // queda vacio
    }
    return { id: llamada.id, nombre: llamada.function.name, argumentos };
  });
}

module.exports = { HERRAMIENTAS, MAX_OPERACIONES, leerLlamadas };
