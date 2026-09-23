/**
 * Plan -> coleccion de Postman (formato v2.1) con todos los endpoints del backend generado.
 *
 * Los cuerpos de ejemplo NO se deciden aqui: salen de las mismas reglas con las que
 * `render.js` escribe cada DTO de entrada (`atributosEscribibles`, `relacionesAUno`, ...).
 * Si mañana el request gana o pierde un campo, la coleccion lo sigue sola.
 *
 * La coleccion se puede ejecutar entera con el Runner de Postman, de arriba abajo:
 *
 *  - Cada clase tiene una variable con su clave (`{{personaId}}`), y el POST la usa como
 *    valor del campo {id}. Las relaciones reutilizan la variable del otro extremo, asi que un
 *    `Estudiante` se crea apuntando a la `Carrera` que se creo antes.
 *  - Las carpetas van en orden de dependencias: primero lo que otros referencian.
 *  - Los DELETE van todos juntos en una carpeta final y en orden INVERSO. Dentro de cada
 *    carpeta borrarian a un padre antes de crear a sus hijos, y la clave foranea lo impide.
 */

const render = require('./render');

const ESQUEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

const URL_BASE = 'http://localhost:8080';

const NUMEROS_ENTEROS = new Set(['Integer', 'Long', 'Short', 'Byte']);
const NUMEROS_DECIMALES = new Set(['Double', 'Float', 'BigDecimal']);

/** En JSON van sin comillas: numeros y booleanos. Todo lo demas es texto. */
const vaSinComillas = (java) =>
  NUMEROS_ENTEROS.has(java) || NUMEROS_DECIMALES.has(java) || java === 'Boolean';

const minuscula = (texto) => texto.charAt(0).toLowerCase() + texto.slice(1);

/** Nombre de la variable de coleccion que guarda la clave de una entidad. */
const variableDe = (entidad) => `${minuscula(entidad.clase)}Id`;

/**
 * Valor de ejemplo, ya como literal JSON, para un campo que no es clave.
 * `editado` da otro valor distinto, para que el PUT se note en la respuesta.
 */
function valorDeEjemplo(java, campo, editado) {
  if (NUMEROS_ENTEROS.has(java)) return editado ? '2' : '1';
  if (NUMEROS_DECIMALES.has(java)) return editado ? '20.75' : '10.5';

  switch (java) {
    case 'Boolean':
      return editado ? 'false' : 'true';
    case 'Character':
      return editado ? '"B"' : '"A"';
    case 'LocalDate':
      return editado ? '"2025-02-20"' : '"2025-01-15"';
    case 'LocalDateTime':
      return editado ? '"2025-02-20T16:45:00"' : '"2025-01-15T10:30:00"';
    case 'UUID':
      return editado
        ? '"6f1c2a4e-9b7d-4c3a-8e21-5d0f7a9b3c12"'
        : '"3a7e5c1b-2d4f-4b8a-9c6e-1f0a2b3c4d5e"';
    case 'Void':
      return 'null';
    default:
      // String, y cualquier tipo que el exportador no conocia y bajo a String.
      return JSON.stringify(editado ? `${campo} editado` : `${campo} de ejemplo`);
  }
}

/**
 * El valor que toma la clave de cada entidad. Distinto entre entidades a proposito: con
 * herencia en una sola tabla, padre e hijo comparten el espacio de claves, y dos `1`
 * chocarian con un 409.
 */
function valorDeClave(java, entidad, indice) {
  const n = indice + 1;

  if (NUMEROS_ENTEROS.has(java) || NUMEROS_DECIMALES.has(java)) return String(n);

  switch (java) {
    case 'Boolean':
      return 'true';
    case 'LocalDate':
      return `2025-01-${String(Math.min(n, 28)).padStart(2, '0')}`;
    case 'LocalDateTime':
      return `2025-01-${String(Math.min(n, 28)).padStart(2, '0')}T10:30:00`;
    case 'UUID':
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    default:
      return `${minuscula(entidad.clase)}-1`;
  }
}

/**
 * Una clase abstracta no tiene CRUD, asi que nunca se crea un registro suyo: quien apunta a
 * ella tiene que apuntar a una subclase concreta. Esto elige la primera que la hereda.
 */
function representante(destino, plan) {
  if (destino.generaCrud) return destino;

  const desciende = (entidad) => {
    for (let actual = entidad.padre; actual; actual = actual.padre) {
      if (actual === destino) return true;
    }
    return false;
  };

  return plan.conCrud.find(desciende) || destino;
}

/**
 * La clave de una entidad escrita como valor JSON, apuntando a su variable.
 * Una clave compuesta es un objeto con sus dos partes, igual que su clase `XId`.
 */
function referenciaAClave(entidad, plan, visitadas = new Set()) {
  const real = representante(entidad, plan);

  if (real.claveCompuesta && !visitadas.has(real)) {
    visitadas.add(real);
    const partes = render
      .relacionesDeClave(real)
      .map((r) => `"${r.campo}Id": ${referenciaAClave(r.destino, plan, visitadas)}`);

    return `{ ${partes.join(', ')} }`;
  }

  const variable = `{{${variableDe(real)}}}`;
  return vaSinComillas(render.tipoClave(real)) ? variable : `"${variable}"`;
}

/** El segmento de ruta con la clave: `{{personaId}}`, o dos segmentos si es compuesta. */
function rutaDeClave(entidad, plan) {
  if (!entidad.claveCompuesta) return `{{${variableDe(entidad)}}}`;

  return render
    .relacionesDeClave(entidad)
    .map((r) => `{{${variableDe(representante(r.destino, plan))}}}`)
    .join('/');
}

/** El cuerpo de POST y PUT: exactamente los campos de `<Clase>Request`. */
function cuerpoDe(entidad, plan, editado) {
  const lineas = [];

  for (const atributo of render.atributosEscribibles(entidad)) {
    if (atributo.soloLectura) continue;

    // La clave no se edita en el PUT: viaja en la ruta y tiene que coincidir.
    const valor = atributo.esId
      ? referenciaAClave(entidad, plan)
      : valorDeEjemplo(atributo.java, atributo.campo, editado);

    lineas.push(`    "${atributo.campo}": ${valor}`);
  }

  for (const relacion of render.relacionesAUno(entidad)) {
    lineas.push(`    "${relacion.campo}Id": ${referenciaAClave(relacion.destino, plan)}`);
  }

  for (const relacion of render.coleccionesEscribibles(entidad)) {
    lineas.push(`    "${relacion.campo}Ids": [${referenciaAClave(relacion.destino, plan)}]`);
  }

  return lineas.length > 0 ? `{\n${lineas.join(',\n')}\n}` : '{}';
}

/**
 * Orden de creacion: primero las entidades a las que otras apuntan.
 *
 * Kahn estable: entre las que ya se pueden crear respeta el orden del plan. Si hay un ciclo
 * —dos clases que se apuntan entre si—, las que quedan salen en su orden original; alguna
 * de esas relaciones tendra que ser opcional para poder crearlas.
 */
function ordenDeCreacion(plan) {
  const pendientes = new Map();

  for (const entidad of plan.conCrud) {
    const destinos = [
      ...render.relacionesAUno(entidad),
      ...render.coleccionesEscribibles(entidad),
    ]
      .map((r) => representante(r.destino, plan))
      .filter((d) => d !== entidad && plan.conCrud.includes(d));

    pendientes.set(entidad, new Set(destinos));
  }

  const orden = [];

  while (pendientes.size > 0) {
    const lista = [...pendientes.keys()].find((e) =>
      [...pendientes.get(e)].every((d) => !pendientes.has(d)),
    );

    // Ciclo: se toma la siguiente en orden original para no quedarse atascado.
    const siguiente = lista || pendientes.keys().next().value;
    orden.push(siguiente);
    pendientes.delete(siguiente);
  }

  return orden;
}

/** Un test de Postman que comprueba el codigo de estado. */
function comprobar(codigo) {
  return [
    {
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          `pm.test("Responde ${codigo}", function () {`,
          `    pm.response.to.have.status(${codigo});`,
          '});',
        ],
      },
    },
  ];
}

function peticion(nombre, metodo, url, codigo, cuerpo) {
  const request = { method: metodo, header: [], url };

  if (cuerpo !== undefined) {
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: cuerpo, options: { raw: { language: 'json' } } };
  }

  return { name: nombre, event: comprobar(codigo), request };
}

/** La coleccion completa, como texto JSON listo para importar en Postman. */
function renderColeccionPostman(plan) {
  const orden = ordenDeCreacion(plan);

  const carpetas = orden.map((entidad, posicion) => {
    const base = `{{baseUrl}}/api/${entidad.ruta}`;
    const conClave = `${base}/${rutaDeClave(entidad, plan)}`;

    return {
      name: `${String(posicion + 1).padStart(2, '0')} · ${entidad.clase}`,
      description: `CRUD de la clase UML "${entidad.nombreUml}" en /api/${entidad.ruta}.`,
      item: [
        peticion(`Crear ${entidad.clase}`, 'POST', base, 201, cuerpoDe(entidad, plan, false)),
        peticion(`Listar ${entidad.clase}`, 'GET', base, 200),
        peticion(`Obtener ${entidad.clase} por clave`, 'GET', conClave, 200),
        peticion(
          `Actualizar ${entidad.clase}`,
          'PUT',
          conClave,
          200,
          cuerpoDe(entidad, plan, true),
        ),
      ],
    };
  });

  const eliminar = [...orden].reverse().map((entidad) =>
    peticion(
      `Eliminar ${entidad.clase}`,
      'DELETE',
      `{{baseUrl}}/api/${entidad.ruta}/${rutaDeClave(entidad, plan)}`,
      204,
    ),
  );

  if (eliminar.length > 0) {
    carpetas.push({
      name: `${String(carpetas.length + 1).padStart(2, '0')} · Eliminar (orden inverso)`,
      description:
        'Los DELETE van al final y al revés del orden de creación: borrar a un padre antes ' +
        'que a sus hijos lo impide la clave foránea.',
      item: eliminar,
    });
  }

  const variables = [
    { key: 'baseUrl', value: URL_BASE },
    ...plan.conCrud
      .filter((entidad) => !entidad.claveCompuesta)
      .map((entidad, indice) => ({
        key: variableDe(entidad),
        value: valorDeClave(render.tipoClave(entidad), entidad, indice),
      })),
  ];

  const coleccion = {
    info: {
      name: `${plan.nombreModelo} — API`,
      description:
        `Endpoints del backend generado desde el diagrama "${plan.nombreModelo}".\n\n` +
        'Arranca el backend (`./mvnw spring-boot:run`) y ejecuta la colección entera con el ' +
        'Runner: las carpetas van en orden de dependencias y cada petición comprueba su ' +
        'código de estado. Las claves de ejemplo están en las variables de la colección.',
      schema: ESQUEMA,
    },
    item: carpetas,
    variable: variables,
  };

  return `${JSON.stringify(coleccion, null, 2)}\n`;
}

module.exports = { renderColeccionPostman, ordenDeCreacion, cuerpoDe, variableDe };
