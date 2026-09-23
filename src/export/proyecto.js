const fs = require('node:fs/promises');
const path = require('node:path');

const { construirPlan } = require('./plan');
const render = require('./render');
const { renderColeccionPostman } = require('./postman');
const nombres = require('./naming');

/**
 * Plantilla + plan -> el arbol de ficheros del proyecto exportado.
 *
 * Devuelve una lista de { ruta, contenido } en memoria, sin escribir en disco: quien llama
 * decide si la comprime a un zip o la vuelca a una carpeta. Eso lo hace testeable sin tocar
 * el sistema de ficheros.
 */

const PLANTILLA = path.join(__dirname, '..', '..', 'templates', 'springboot-base');

const RAIZ_JAVA = 'src/main/java/com/diagramador/backend';

/**
 * La rebanada `Ejemplo` es el molde, no dominio: no viaja al proyecto exportado. Su test se
 * va con ella o el proyecto no compilaria.
 */
const DESCARTAR = new Set([
  `${RAIZ_JAVA}/model/Ejemplo.java`,
  `${RAIZ_JAVA}/dto/EjemploRequest.java`,
  `${RAIZ_JAVA}/dto/EjemploResponse.java`,
  `${RAIZ_JAVA}/mapper/EjemploMapper.java`,
  `${RAIZ_JAVA}/repository/EjemploRepository.java`,
  `${RAIZ_JAVA}/service/EjemploService.java`,
  `${RAIZ_JAVA}/controller/EjemploController.java`,
  'src/test/java/com/diagramador/backend/EjemploCrudTest.java',
]);

/** Carpetas de la plantilla que nunca se copian. */
const IGNORAR_CARPETA = new Set(['target', '.git', 'node_modules']);

/** Recorre la plantilla y devuelve sus ficheros con la ruta relativa en POSIX. */
async function leerPlantilla(base = PLANTILLA, prefijo = '') {
  const entradas = await fs.readdir(base, { withFileTypes: true });
  const ficheros = [];

  for (const entrada of entradas) {
    if (IGNORAR_CARPETA.has(entrada.name)) continue;

    const absoluta = path.join(base, entrada.name);
    const relativa = prefijo === '' ? entrada.name : `${prefijo}/${entrada.name}`;

    if (entrada.isDirectory()) {
      ficheros.push(...(await leerPlantilla(absoluta, relativa)));
      continue;
    }

    if (DESCARTAR.has(relativa)) continue;

    ficheros.push({
      ruta: relativa,
      contenido: await fs.readFile(absoluta),
      // mvnw tiene que seguir siendo ejecutable del otro lado.
      ejecutable: entrada.name === 'mvnw',
    });
  }

  return ficheros;
}

/** Nombre de artefacto Maven valido a partir del nombre del modelo. */
function artefactoDe(nombreModelo) {
  const base = nombres.snake(nombreModelo).replace(/_/g, '-');
  return base === '' ? 'backend' : base;
}

/** Ajusta el pom y el README para que hablen del modelo exportado, no de la plantilla. */
function personalizar(ficheros, plan) {
  const artefacto = artefactoDe(plan.nombreModelo);

  return ficheros.map((fichero) => {
    if (fichero.ruta === 'pom.xml') {
      const texto = fichero.contenido
        .toString('utf8')
        .replace('<artifactId>backend</artifactId>\n    <version>', `<artifactId>${artefacto}</artifactId>\n    <version>`)
        .replace('<name>backend</name>', `<name>${artefacto}</name>`)
        .replace(
          '<description>Proyecto base Spring Boot para el exportador UML</description>',
          `<description>Backend generado desde el diagrama "${plan.nombreModelo}"</description>`,
        );

      return { ...fichero, contenido: Buffer.from(texto, 'utf8') };
    }

    return fichero;
  });
}

/** El README que acompaña a lo generado, encima del de la plantilla. */
function renderResumen(plan) {
  const clave = (e) =>
    e.claveCompuesta
      ? '**compuesta** — las FK de sus dos extremos'
      : `\`${e.clave.campo} : ${e.clave.java}\``;

  const filas = plan.conCrud
    .map(
      (e) =>
        `| \`${e.clase}\` | \`/api/${e.ruta}\` | ${clave(e)} | ${e.atributos.length} | ${e.relaciones.length} |`,
    )
    .join('\n');

  const sinCrud = plan.entidades
    .filter((e) => !e.generaCrud)
    .map((e) => `- \`${e.clase}\` — abstracta: es tabla y padre, pero no se puede instanciar.`)
    .join('\n');

  const interfaces = plan.interfaces
    .map((i) => `- \`${i.clase}\` — interfaz Java, sin tabla ni CRUD.`)
    .join('\n');

  const avisos = plan.avisos.map((a) => `- ${a}`).join('\n');

  return `# ${plan.nombreModelo} — backend generado

Generado desde el diagrama UML por el exportador del diagramador.
**No lo edites a mano si vas a volver a exportar:** se sobrescribe.

## Arrancar

\`\`\`bash
./mvnw spring-boot:run
\`\`\`

Sin instalar nada: el perfil por defecto usa H2 en memoria.

- API: http://localhost:8080/api
- **Swagger UI: http://localhost:8080/swagger-ui.html**
- Consola H2: http://localhost:8080/h2-console

## Probar con Postman

En \`postman/${artefactoDe(plan.nombreModelo)}.postman_collection.json\` está la colección con
todos los endpoints. Impórtala en Postman (*Import* → el fichero) y ejecútala entera con el
*Runner*, o petición a petición:

- Las carpetas van **en orden de dependencias**: primero las clases a las que otras apuntan.
- Cada clase tiene una variable con su clave (\`{{personaId}}\`, …) que usan su POST, sus
  rutas y las relaciones que apuntan a ella. Se editan en la pestaña *Variables* de la
  colección. \`{{baseUrl}}\` es \`http://localhost:8080\`.
- Los **DELETE** están todos en la última carpeta, en orden inverso: borrar a un padre antes
  que a sus hijos lo impide la clave foránea.
- Cada petición comprueba su código de estado (201, 200, 204).

Para Postgres, mirá \`README.md\` (el de la plantilla), que sigue valiendo.

## Lo que se generó

| Clase | Ruta REST | Clave primaria | Atributos | Relaciones |
|---|---|---|---|---|
${filas || '| — | — | — | — | — |'}

Las claves son **asignadas**, no generadas: salen del \`{id}\` que marcaste en el diagrama y
las trae quien crea el objeto. Por eso un \`POST\` con una clave que ya existe devuelve
**409**, en vez del \`UPDATE\` silencioso que haría \`save()\` por su cuenta.

Cada una trae las seis capas: entidad, DTO de entrada, DTO de salida, mapper, repositorio,
servicio y controlador, con CRUD completo (\`GET\`, \`GET /{id}\`, \`POST\`, \`PUT /{id}\`,
\`DELETE /{id}\`) y anotada para Swagger.

${sinCrud ? `### Sin CRUD propio\n\n${sinCrud}\n` : ''}
${interfaces ? `### Interfaces\n\n${interfaces}\n` : ''}
${avisos ? `## Avisos de la exportación\n\n${avisos}\n` : ''}
## Cómo llegan las relaciones

Los DTO no anidan objetos: todo viaja como ids.

| Relación | Cómo se lee | Cómo se escribe |
|---|---|---|
| A uno (\`@ManyToOne\`, \`@OneToOne\`) | \`<campo>Id\` en la respuesta | \`<campo>Id\` en el request |
| Muchos a muchos, lado propietario | \`<campo>Ids\` | \`<campo>Ids\` en el request: \`null\` lo deja como está, una lista lo reemplaza |
| Muchos a muchos, lado inverso | \`<campo>Ids\` | **Solo lectura.** Lleva \`mappedBy\` y JPA ignora lo que se le escriba: se gestiona desde el lado propietario |
| Uno a muchos (la colección) | \`<campo>Ids\` | **Indirecto.** Se puebla poniendo el id del padre desde el CRUD del hijo, que es quien lleva la clave foránea |

### La clase de asociación

Una clase de asociación **ES la asociación**, no una asociación más una clase al lado
(UML 2.5 §11.5). Por eso su tabla es la tabla de unión: no existe ninguna \`@JoinTable\`
aparte entre las dos clases que une.

Los dos extremos reciben una colección de ella —\`@OneToMany(mappedBy = ...)\`— y la única
forma de relacionarlos es crear un registro suyo, con sus datos propios:

\`\`\`
POST /api/inscribes   { "usuarioId": 1, "materiaId": 1, "nota": 9.5 }
\`\`\`

Si además dibujás una asociación **normal** entre esas mismas dos clases, entonces sí son
dos relaciones distintas y cada una tiene su propio mapeo.
`;
}

/** Construye el arbol completo del proyecto exportado. */
/** La exportacion se detiene si alguna clase no declara su identidad. */
class ClavesFaltantesError extends Error {
  constructor(faltantes) {
    super(`Faltan claves primarias: ${faltantes.join(' · ')}`);
    this.name = 'ClavesFaltantesError';
    this.faltantes = faltantes;
    this.isOperational = true;
    this.statusCode = 422;
  }
}

async function construirProyecto(documento) {
  const plan = construirPlan(documento);

  // Antes de escribir nada: sin clave no hay entidad, y una clave inventada por el
  // generador es justo lo que no se quiere.
  if (plan.faltanClaves.length > 0) throw new ClavesFaltantesError(plan.faltanClaves);

  const ficheros = personalizar(await leerPlantilla(), plan);

  const escribir = (ruta, texto) =>
    ficheros.push({ ruta, contenido: Buffer.from(texto, 'utf8'), ejecutable: false });

  for (const interfaz of plan.interfaces) {
    escribir(`${RAIZ_JAVA}/model/${interfaz.clase}.java`, render.renderInterfaz(interfaz));
  }

  for (const entidad of plan.entidades) {
    escribir(`${RAIZ_JAVA}/model/${entidad.clase}.java`, render.renderEntidad(entidad));

    // La clave compuesta de una clase de asociacion es una clase aparte: @Embeddable.
    if (entidad.claveCompuesta && !entidad.padre) {
      escribir(`${RAIZ_JAVA}/model/${entidad.clase}Id.java`, render.renderClaveEmbebida(entidad));
    }

    // Una entidad abstracta es tabla y padre, pero no se puede crear por la API.
    if (!entidad.generaCrud) continue;

    escribir(`${RAIZ_JAVA}/dto/${entidad.clase}Request.java`, render.renderRequest(entidad));
    escribir(`${RAIZ_JAVA}/dto/${entidad.clase}Response.java`, render.renderResponse(entidad));
    escribir(`${RAIZ_JAVA}/mapper/${entidad.clase}Mapper.java`, render.renderMapper(entidad));
    escribir(
      `${RAIZ_JAVA}/repository/${entidad.clase}Repository.java`,
      render.renderRepositorio(entidad),
    );
    escribir(`${RAIZ_JAVA}/service/${entidad.clase}Service.java`, render.renderServicio(entidad));
    escribir(
      `${RAIZ_JAVA}/controller/${entidad.clase}Controller.java`,
      render.renderControlador(entidad),
    );
  }

  // La coleccion de Postman con todos los endpoints, lista para importar y ejecutar.
  escribir(
    `postman/${artefactoDe(plan.nombreModelo)}.postman_collection.json`,
    renderColeccionPostman(plan),
  );

  escribir('GENERADO.md', renderResumen(plan));

  return { plan, ficheros, artefacto: artefactoDe(plan.nombreModelo) };
}

module.exports = {
  construirProyecto,
  artefactoDe,
  leerPlantilla,
  ClavesFaltantesError,
  PLANTILLA,
  RAIZ_JAVA,
};
