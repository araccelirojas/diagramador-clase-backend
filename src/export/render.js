/**
 * Plan -> ficheros Java.
 *
 * Cada funcion de aca escribe UNA capa, con la misma forma que la rebanada `Ejemplo` de la
 * plantilla. Aburrido y explicito a proposito: es codigo que nadie va a leer para aprender,
 * sino para comprobar que dice lo que el diagrama decia.
 */

const PAQUETE = 'com.diagramador.backend';

/** Bloque de imports ordenado y sin repetidos. */
function imports(lista) {
  const unicos = [...new Set(lista.filter(Boolean))].sort();
  return unicos.map((i) => `import ${i};`).join('\n');
}

const cabecera = (subpaquete, lineasImport) =>
  `package ${PAQUETE}.${subpaquete};\n\n${imports(lineasImport)}\n`;

/**
 * Los DTO y el mapper ven lo heredado ADEMAS de lo propio: un Estudiante que hereda `nombre`
 * de Persona tiene que poder recibirlo, aunque el campo no se declare en su clase.
 * La entidad, en cambio, solo declara lo suyo: lo del padre ya lo tiene por herencia.
 */
const atributosDe = (entidad) => entidad.atributosTodos || entidad.atributos;
const relacionesDe = (entidad) => entidad.relacionesTodas || entidad.relaciones;

/** Los `-to-one` de los que la entidad es propietaria: los unicos que el request acepta. */
const relacionesAUno = (entidad) =>
  relacionesDe(entidad).filter(
    (r) => (r.tipo === 'ManyToOne' || r.tipo === 'OneToOne') && r.propietaria && !r.oculto,
  );

const relacionesAMuchos = (entidad) =>
  relacionesDe(entidad).filter((r) => r.tipo === 'OneToMany' || r.tipo === 'ManyToMany');

/**
 * Las colecciones que la API PUEDE escribir: solo el muchos-a-muchos del lado propietario.
 *
 * El inverso lleva `mappedBy` y JPA ignora lo que se le escriba, asi que ofrecerlo en el
 * request seria mentir. Y un `OneToMany` no hace falta: se puebla poniendo el id del padre
 * desde el CRUD del hijo, que es quien lleva la clave foranea.
 */
const coleccionesEscribibles = (entidad) =>
  relacionesDe(entidad).filter((r) => r.tipo === 'ManyToMany' && r.propietaria && !r.oculto);

/** Todo lo que el servicio tiene que resolver contra otro repositorio. */
const relacionesEnlazables = (entidad) => [
  ...relacionesAUno(entidad),
  ...coleccionesEscribibles(entidad),
];

/** Atributos que se pueden escribir desde la API. */
const atributosEscribibles = (entidad) =>
  atributosDe(entidad).filter((a) => !a.derivado && !a.esColeccion);

/**
 * El tipo Java de la clave primaria.
 *
 * No hay ninguna impuesta: o la declara una propiedad marcada con {id} en el diagrama, o es
 * la clave compuesta de una clase de asociacion. `construirPlan` se niega a exportar si
 * falta, asi que aqui siempre hay una.
 */
const tipoClave = (entidad) =>
  entidad.claveCompuesta ? `${entidad.clase}Id` : entidad.clave ? entidad.clave.java : 'Long';

/** Como se lee la clave desde la entidad. */
const getterClave = (entidad) =>
  entidad.claveCompuesta ? 'getId()' : `get${capitalizar(entidad.clave.campo)}()`;

/** Los dos @ManyToOne que forman la identidad de una clase de asociacion. */
const relacionesDeClave = (entidad) =>
  entidad.claveCompuesta
    ? relacionesDe(entidad).filter((r) => r.tipo === 'ManyToOne' && r.propietaria).slice(0, 2)
    : [];

/**
 * El tipo con el que viaja el id del otro extremo de una relación.
 *
 * No es `Long`: es la clave que ese destino declaró en el diagrama. Fijarlo a Long fue lo
 * que rompió en cuanto una clase usó una clave natural de texto.
 */
const tipoIdDestino = (relacion) => tipoClave(relacion.destino);

/** El import que ese tipo necesita, si lo necesita. */
const importeIdDestino = (relacion) =>
  relacion.destino.claveCompuesta
    ? `${PAQUETE}.model.${relacion.destino.clase}Id`
    : relacion.destino.clave
      ? relacion.destino.clave.importar
      : null;

/** Una relacion que forma parte de la clave no se escribe aparte: viene con @MapsId. */
const esRelacionDeClave = (entidad, relacion) => relacionesDeClave(entidad).includes(relacion);

// ---------------------------------------------------------------- entidad

function renderEntidad(entidad) {
  const usa = [
    'jakarta.persistence.Entity',
    'jakarta.persistence.Table',
    'lombok.Getter',
    'lombok.Setter',
    'lombok.NoArgsConstructor',
  ];

  const lineas = [];

  // La clave primaria solo la declara la raiz de la jerarquia.
  if (!entidad.padre && entidad.claveCompuesta) {
    usa.push('jakarta.persistence.EmbeddedId');
    lineas.push('    /** Su identidad ES la de sus dos extremos: ver ' + entidad.clase + 'Id. */');
    lineas.push('    @EmbeddedId');
    lineas.push(`    private ${entidad.clase}Id id = new ${entidad.clase}Id();`);
    lineas.push('');
  }

  for (const atributo of entidad.atributos) {
    // La propiedad marcada con {id} es la clave: asignada, sin @GeneratedValue. Quien crea
    // el objeto la trae, como cualquier otro dato del dominio.
    if (atributo.esId && !entidad.padre && !entidad.claveCompuesta) {
      if (atributo.importar) usa.push(atributo.importar);
      usa.push('jakarta.persistence.Id', 'jakarta.persistence.Column');

      lineas.push('    /** {id} en el diagrama: la identidad del objeto, no una clave técnica. */');
      lineas.push('    @Id');
      lineas.push(`    @Column(name = "${atributo.columna}", nullable = false, updatable = false)`);
      lineas.push(`    private ${atributo.java} ${atributo.campo};`);
      lineas.push('');
      continue;
    }

    if (atributo.importar) usa.push(atributo.importar);

    if (atributo.tipoDesconocido) {
      lineas.push(`    // TODO revisar: el tipo UML "${atributo.tipoUml}" no se reconoció.`);
    }

    if (atributo.derivado) {
      usa.push('jakarta.persistence.Transient');
      lineas.push('    /** Derivado en el diagrama: se calcula, no se guarda. */');
      lineas.push('    @Transient');
      lineas.push(`    private ${atributo.java} ${atributo.campo};`);
      lineas.push('');
      continue;
    }

    if (atributo.esColeccion) {
      usa.push('jakarta.persistence.ElementCollection', 'java.util.List');
      lineas.push('    @ElementCollection');
      lineas.push(`    private List<${atributo.java}> ${atributo.campo};`);
      lineas.push('');
      continue;
    }

    usa.push('jakarta.persistence.Column');
    const partes = [`name = "${atributo.columna}"`];
    if (atributo.obligatorio) partes.push('nullable = false');
    if (atributo.soloLectura) partes.push('updatable = false');
    if (atributo.esTexto) partes.push('length = 255');

    lineas.push(`    @Column(${partes.join(', ')})`);
    lineas.push(`    private ${atributo.java} ${atributo.campo};`);
    lineas.push('');
  }

  for (const relacion of entidad.relaciones) {
    if (relacion.oculto) {
      lineas.push('    /** No navegable en el diagrama, pero es quien lleva la clave foránea. */');
    }

    // @MapsId: este extremo llena una de las dos mitades de la clave compuesta. Es lo que
    // hace que la FK Y la PK sean la misma columna, en vez de duplicarla.
    if (esRelacionDeClave(entidad, relacion)) {
      usa.push(
        'jakarta.persistence.ManyToOne',
        'jakarta.persistence.MapsId',
        'jakarta.persistence.JoinColumn',
        'jakarta.persistence.FetchType',
      );
      lineas.push('    @ManyToOne(fetch = FetchType.LAZY, optional = false)');
      lineas.push(`    @MapsId("${relacion.campo}Id")`);
      lineas.push(`    @JoinColumn(name = "${relacion.columnaUnion}")`);
      lineas.push(`    private ${relacion.destino.clase} ${relacion.campo};`);
      lineas.push('');
      continue;
    }

    usa.push(`jakarta.persistence.${relacion.tipo}`);
    usa.push('jakarta.persistence.FetchType');

    const opciones = [];
    if (relacion.mappedBy) opciones.push(`mappedBy = "${relacion.mappedBy}"`);
    opciones.push(`fetch = FetchType.LAZY`);
    if (relacion.cascade) opciones.push(`cascade = ${relacion.cascade}`);
    if (relacion.orphanRemoval) opciones.push('orphanRemoval = true');

    lineas.push(`    @${relacion.tipo}(${opciones.join(', ')})`);

    if (relacion.tipo === 'ManyToMany' && relacion.propietaria) {
      usa.push('jakarta.persistence.JoinTable', 'jakarta.persistence.JoinColumn');
      lineas.push('    @JoinTable(');
      lineas.push(`            name = "${relacion.tablaUnion}",`);
      lineas.push(`            joinColumns = @JoinColumn(name = "${relacion.columnaUnion}"),`);
      lineas.push(`            inverseJoinColumns = @JoinColumn(name = "${relacion.columnaInversa}"))`);
    } else if (relacion.propietaria && relacion.columnaUnion) {
      usa.push('jakarta.persistence.JoinColumn');
      const nulo = relacion.obligatorio ? ', nullable = false' : '';
      lineas.push(`    @JoinColumn(name = "${relacion.columnaUnion}"${nulo})`);
    }

    if (relacion.tipo === 'OneToMany' || relacion.tipo === 'ManyToMany') {
      usa.push('java.util.List', 'java.util.ArrayList');
      lineas.push(`    private List<${relacion.destino.clase}> ${relacion.campo} = new ArrayList<>();`);
    } else {
      lineas.push(`    private ${relacion.destino.clase} ${relacion.campo};`);
    }
    lineas.push('');
  }

  // Una subclase en una jerarquia SINGLE_TABLE NO puede llevar @Table: la tabla la declara
  // la raiz, y Hibernate rechaza el arranque si ambas la anotan.
  const anotaciones = entidad.padre
    ? ['@Entity']
    : ['@Entity', `@Table(name = "${entidad.tabla}")`];

  if (entidad.tieneHijas && !entidad.padre) {
    usa.push('jakarta.persistence.Inheritance', 'jakarta.persistence.InheritanceType');
    anotaciones.push('@Inheritance(strategy = InheritanceType.SINGLE_TABLE)');
  }

  anotaciones.push('@Getter', '@Setter', '@NoArgsConstructor');

  const firma = [
    entidad.esAbstracta ? 'public abstract class' : 'public class',
    entidad.clase,
    entidad.padre ? `extends ${entidad.padre.clase}` : '',
    entidad.interfaces.length > 0
      ? `implements ${entidad.interfaces.map((i) => i.clase).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  lineas.push(...metodosDe(entidad, usa));

  const avisos = entidad.avisos.map((a) => ` * AVISO: ${a}`).join('\n');

  return `${cabecera('model', usa)}
/**
 * Generado a partir de la clase UML "${entidad.nombreUml}".
${avisos ? `${avisos}\n` : ''} */
${anotaciones.join('\n')}
${firma} {

${lineas.join('\n')}}
`;
}

/**
 * La clave compuesta de una clase de asociacion.
 *
 * `@Embeddable` y no `@IdClass`: es lo recomendado cuando la clave se usa como objeto, da
 * una firma clara al repositorio y permite `findById(new MatriculaId(a, b))`. La unica
 * ventaja de `@IdClass` —admitir `@GeneratedValue`— aqui no aplica: las dos mitades vienen
 * de las claves foraneas via `@MapsId`, no se generan.
 *
 * `equals` y `hashCode` NO son opcionales: sin ellos Hibernate no puede comparar dos
 * instancias de la clave y el `findById` falla de formas dificiles de diagnosticar.
 */
function renderClaveEmbebida(entidad) {
  const partes = relacionesDeClave(entidad).map((relacion) => ({
    campo: `${relacion.campo}Id`,
    java: tipoClave(relacion.destino),
    importar: relacion.destino.clave ? relacion.destino.clave.importar : null,
  }));

  const usa = [
    'jakarta.persistence.Embeddable',
    'java.io.Serializable',
    'java.util.Objects',
    'lombok.Getter',
    'lombok.Setter',
    'lombok.NoArgsConstructor',
    'lombok.AllArgsConstructor',
    ...partes.map((p) => p.importar),
  ];

  const campos = partes.map((p) => `    private ${p.java} ${p.campo};`).join('\n');
  const comparaciones = partes
    .map((p) => `Objects.equals(${p.campo}, otra.${p.campo})`)
    .join('\n                && ');
  const hash = partes.map((p) => p.campo).join(', ');

  return `${cabecera('model', usa)}
/** Identidad de ${entidad.clase}: la combinación de las claves de sus dos extremos. */
@Embeddable
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ${entidad.clase}Id implements Serializable {

${campos}

    @Override
    public boolean equals(Object objeto) {
        if (this == objeto) return true;
        if (objeto == null || getClass() != objeto.getClass()) return false;

        ${entidad.clase}Id otra = (${entidad.clase}Id) objeto;
        return ${comparaciones};
    }

    @Override
    public int hashCode() {
        return Objects.hash(${hash});
    }

    /** Sin esto, un mensaje de error muestra \`${entidad.clase}Id@3e1\` en vez de la clave. */
    @Override
    public String toString() {
        return ${partes.map((p) => `"${p.campo}=" + ${p.campo}`).join(' + ", " + ')};
    }
}
`;
}

function renderInterfaz(interfaz) {
  const usa = [];

  const metodos = interfaz.operaciones.map((operacion) => {
    if (operacion.retornoImportar) usa.push(operacion.retornoImportar);
    for (const parametro of operacion.parametros) {
      if (parametro.importar) usa.push(parametro.importar);
    }

    const parametros = operacion.parametros.map((p) => `${p.java} ${p.nombre}`).join(', ');
    return `    ${operacion.retorno} ${operacion.nombre}(${parametros});`;
  });

  const bloque = usa.length > 0 ? `\n${imports(usa)}\n` : '';

  return `package ${PAQUETE}.model;
${bloque}
/**
 * Generada a partir de la interfaz UML "${interfaz.nombreUml}".
 * No es una entidad: no tiene tabla ni CRUD.
 */
public interface ${interfaz.clase} {

${metodos.join('\n')}${metodos.length > 0 ? '\n' : ''}}
`;
}

/**
 * Los metodos que la entidad TIENE que declarar para compilar: los de las interfaces que
 * realiza, mas sus propias operaciones del diagrama.
 *
 * Con cuerpo que lanza UnsupportedOperationException y no vacio: un metodo que devuelve null
 * en silencio es peor que uno que dice a gritos que falta escribirlo.
 */
function metodosDe(entidad, usa) {
  const vistos = new Set();
  const lineas = [];

  // Lombok ya genera los accesores: declarar uno otra vez seria un metodo duplicado.
  const prohibidos = new Set();
  for (const campo of [...entidad.atributos, ...entidad.relaciones]) {
    prohibidos.add(`get${capitalizar(campo.campo)}`);
    prohibidos.add(`set${capitalizar(campo.campo)}`);
  }

  const candidatas = [
    ...entidad.interfaces.flatMap((i) => i.operaciones.map((o) => ({ ...o, heredadaDe: i.clase }))),
    ...entidad.operaciones.map((o) => ({ ...o, heredadaDe: null })),
  ];

  for (const operacion of candidatas) {
    if (vistos.has(operacion.firma) || prohibidos.has(operacion.nombre)) continue;
    vistos.add(operacion.firma);

    if (operacion.retornoImportar) usa.push(operacion.retornoImportar);
    for (const parametro of operacion.parametros) {
      if (parametro.importar) usa.push(parametro.importar);
    }

    const parametros = operacion.parametros.map((p) => `${p.java} ${p.nombre}`).join(', ');

    if (operacion.heredadaDe) lineas.push('    @Override');

    // Una operacion abstracta de una clase abstracta se declara, no se implementa.
    if (operacion.esAbstracta && entidad.esAbstracta && !operacion.heredadaDe) {
      lineas.push(`    public abstract ${operacion.retorno} ${operacion.nombre}(${parametros});`);
      lineas.push('');
      continue;
    }

    lineas.push(`    public ${operacion.retorno} ${operacion.nombre}(${parametros}) {`);
    lineas.push(
      `        throw new UnsupportedOperationException("TODO: implementar ${operacion.nombre}");`,
    );
    lineas.push('    }');
    lineas.push('');
  }

  return lineas;
}

// ---------------------------------------------------------------- DTOs

function renderRequest(entidad) {
  const usa = [];
  const campos = [];

  for (const atributo of atributosEscribibles(entidad)) {
    if (atributo.soloLectura) continue;
    if (atributo.importar) usa.push(atributo.importar);

    const anotaciones = [];
    if (atributo.obligatorio) {
      if (atributo.esTexto) {
        usa.push('jakarta.validation.constraints.NotBlank');
        anotaciones.push(`        @NotBlank(message = "${atributo.campo} es obligatorio")`);
      } else {
        usa.push('jakarta.validation.constraints.NotNull');
        anotaciones.push(`        @NotNull(message = "${atributo.campo} es obligatorio")`);
      }
    }
    if (atributo.esTexto) {
      usa.push('jakarta.validation.constraints.Size');
      anotaciones.push(`        @Size(max = 255)`);
    }

    campos.push(`${anotaciones.join('\n')}${anotaciones.length ? '\n' : ''}        ${atributo.java} ${atributo.campo}`);
  }

  // Las relaciones viajan como el id del otro lado, no como objetos anidados.
  for (const relacion of relacionesAUno(entidad)) {
    const anotaciones = [];
    if (relacion.obligatorio) {
      usa.push('jakarta.validation.constraints.NotNull');
      anotaciones.push(`        @NotNull(message = "${relacion.campo}Id es obligatorio")`);
    }
    usa.push(importeIdDestino(relacion));
    campos.push(
      `${anotaciones.join('\n')}${anotaciones.length ? '\n' : ''}        ${tipoIdDestino(relacion)} ${relacion.campo}Id`,
    );
  }

  // El muchos-a-muchos del lado propietario: sin esto la coleccion solo se puede leer,
  // y no habria ningun endpoint capaz de poblarla.
  for (const relacion of coleccionesEscribibles(entidad)) {
    usa.push('java.util.List', importeIdDestino(relacion));
    campos.push(`        List<${tipoIdDestino(relacion)}> ${relacion.campo}Ids`);
  }

  const cuerpo = campos.length > 0 ? `\n${campos.join(',\n\n')}\n` : '';

  return `${cabecera('dto', usa)}
/**
 * Lo que entra por POST y PUT de ${entidad.clase}. Sin \`id\`: ese viaja en la ruta.
 *
 * Las relaciones llegan como ids, nunca como objetos anidados:
 *  - \`<campo>Id\`  — el otro extremo de una relación a uno.
 *  - \`<campo>Ids\` — un muchos-a-muchos del que esta clase es propietaria. Si llega null
 *    se deja como está; si llega una lista (aunque sea vacía) reemplaza a la anterior.
 *
 * Una colección de un uno-a-muchos NO aparece aquí: se puebla poniendo el id del padre
 * desde el CRUD del hijo, que es quien lleva la clave foránea.
 */
public record ${entidad.clase}Request(${cuerpo}) {
}
`;
}

function renderResponse(entidad) {
  const usa = [];
  // Sin `Long id` fijo: la clave es la propiedad marcada con {id}, que ya viaja entre los
  // atributos; en una clase de asociación son los dos ids de sus extremos.
  const campos = [];

  for (const atributo of atributosDe(entidad)) {
    if (atributo.importar) usa.push(atributo.importar);
    if (atributo.esColeccion) {
      usa.push('java.util.List');
      campos.push(`        List<${atributo.java}> ${atributo.campo}`);
    } else {
      campos.push(`        ${atributo.java} ${atributo.campo}`);
    }
  }

  for (const relacion of relacionesAUno(entidad)) {
    usa.push(importeIdDestino(relacion));
    campos.push(`        ${tipoIdDestino(relacion)} ${relacion.campo}Id`);
  }

  for (const relacion of relacionesAMuchos(entidad)) {
    usa.push('java.util.List', importeIdDestino(relacion));
    campos.push(`        List<${tipoIdDestino(relacion)}> ${relacion.campo}Ids`);
  }

  return `${cabecera('dto', usa)}
/** Lo que devuelve la API de ${entidad.clase}. Las relaciones salen como ids. */
public record ${entidad.clase}Response(
${campos.join(',\n')}
) {
}
`;
}

// ---------------------------------------------------------------- mapper

function renderMapper(entidad) {
  const usa = [
    `${PAQUETE}.dto.${entidad.clase}Request`,
    `${PAQUETE}.dto.${entidad.clase}Response`,
    `${PAQUETE}.model.${entidad.clase}`,
    'org.springframework.stereotype.Component',
    'java.util.List',
  ];

  const escribibles = atributosEscribibles(entidad).filter((a) => !a.soloLectura);

  const linea = (a) => `        entidad.set${capitalizar(a.campo)}(request.${a.campo}());`

  // El alta asigna la clave; la modificación no. Cambiar la identidad de una fila no es
  // actualizarla, y su columna está declarada `updatable = false`.
  const settersAlta = escribibles.map(linea).join('\n')
  const settersEdicion = escribibles
    .filter((a) => !a.esId)
    .map(linea)
    .join('\n')

  const metodoClave = (destino) =>
    destino.claveCompuesta ? 'getId' : `get${capitalizar(destino.clave.campo)}`

  const responseCampos = [
    ...atributosDe(entidad).map((a) => `                entidad.get${capitalizar(a.campo)}()`),
    // La clave del otro extremo, que no tiene por qué llamarse `id`.
    ...relacionesAUno(entidad).map(
      (r) =>
        `                entidad.get${capitalizar(r.campo)}() == null ? null : entidad.get${capitalizar(r.campo)}().${metodoClave(r.destino)}()`,
    ),
    ...relacionesAMuchos(entidad).map(
      (r) =>
        `                entidad.get${capitalizar(r.campo)}() == null ? List.of()\n                        : entidad.get${capitalizar(r.campo)}().stream().map(${r.destino.clase}::${metodoClave(r.destino)}).toList()`,
    ),
  ];

  for (const relacion of relacionesAMuchos(entidad)) {
    usa.push(`${PAQUETE}.model.${relacion.destino.clase}`);
  }

  return `${cabecera('mapper', usa)}
/**
 * Conversión entidad <-> DTO de ${entidad.clase}, campo por campo.
 * Las relaciones las resuelve el servicio: aquí solo se copian los valores propios.
 */
@Component
public class ${entidad.clase}Mapper {

    public ${entidad.clase} toEntity(${entidad.clase}Request request) {
        ${entidad.clase} entidad = new ${entidad.clase}();
${settersAlta}
        return entidad;
    }

    /** No toca la clave: la identidad de una fila no se actualiza. */
    public void updateEntity(${entidad.clase} entidad, ${entidad.clase}Request request) {
${settersEdicion}
    }

    public ${entidad.clase}Response toResponse(${entidad.clase} entidad) {
        return new ${entidad.clase}Response(
${responseCampos.join(',\n')}
        );
    }

    public List<${entidad.clase}Response> toResponseList(List<${entidad.clase}> entidades) {
        return entidades.stream().map(this::toResponse).toList();
    }
}
`;
}

const capitalizar = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

// ---------------------------------------------------------------- repositorio

function renderRepositorio(entidad) {
  const importeClave = entidad.claveCompuesta
    ? `\nimport ${PAQUETE}.model.${entidad.clase}Id;`
    : entidad.clave.importar
      ? `\nimport ${entidad.clave.importar};`
      : ''

  return `package ${PAQUETE}.repository;

import ${PAQUETE}.model.${entidad.clase};${importeClave}
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Repositorio de ${entidad.clase}. Su clave es \`${tipoClave(entidad)}\`, la que declara el
 * diagrama: no hay ningún \`Long id\` impuesto por el generador.
 */
@Repository
public interface ${entidad.clase}Repository extends JpaRepository<${entidad.clase}, ${tipoClave(entidad)}> {
}
`;
}

// ---------------------------------------------------------------- servicio

function renderServicio(entidad) {
  const relaciones = relacionesEnlazables(entidad);

  // Un repositorio por cada destino distinto, sin repetir y sin el propio.
  const destinos = [];
  const vistos = new Set([entidad.clase]);
  for (const relacion of relaciones) {
    if (vistos.has(relacion.destino.clase)) continue;
    vistos.add(relacion.destino.clase);
    destinos.push(relacion.destino);
  }

  const usa = [
    `${PAQUETE}.common.NotFoundException`,
    `${PAQUETE}.dto.${entidad.clase}Request`,
    `${PAQUETE}.dto.${entidad.clase}Response`,
    `${PAQUETE}.mapper.${entidad.clase}Mapper`,
    `${PAQUETE}.model.${entidad.clase}`,
    `${PAQUETE}.repository.${entidad.clase}Repository`,
    'org.springframework.stereotype.Service',
    'org.springframework.transaction.annotation.Transactional',
    'java.util.List',
    ...destinos.map((d) => `${PAQUETE}.repository.${d.clase}Repository`),
    ...destinos.map((d) => `${PAQUETE}.model.${d.clase}`),
  ];

  const campos = [
    `    private final ${entidad.clase}Repository repository;`,
    `    private final ${entidad.clase}Mapper mapper;`,
    ...destinos.map((d) => `    private final ${d.clase}Repository ${minuscula(d.clase)}Repository;`),
  ];

  const parametros = [
    `${entidad.clase}Repository repository`,
    `${entidad.clase}Mapper mapper`,
    ...destinos.map((d) => `${d.clase}Repository ${minuscula(d.clase)}Repository`),
  ];

  const asignaciones = [
    '        this.repository = repository;',
    '        this.mapper = mapper;',
    ...destinos.map(
      (d) => `        this.${minuscula(d.clase)}Repository = ${minuscula(d.clase)}Repository;`,
    ),
  ];

  // Resolver cada relacion es explicito a proposito: se ve de donde sale cada objeto.
  const enlazar = relaciones
    .map((relacion) => {
      const repositorio =
        relacion.destino.clase === entidad.clase
          ? 'repository'
          : `${minuscula(relacion.destino.clase)}Repository`;

      if (relacion.tipo === 'ManyToMany') {
        // findAllById descarta en silencio los ids que no existen: comparar los tamaños
        // es lo que convierte "te ignore la mitad de la lista" en un 404 honesto.
        return `        if (request.${relacion.campo}Ids() != null) {
            List<${relacion.destino.clase}> ${relacion.campo} = ${repositorio}.findAllById(request.${relacion.campo}Ids());
            if (${relacion.campo}.size() != request.${relacion.campo}Ids().stream().distinct().count()) {
                throw new NotFoundException("${relacion.destino.clase}", request.${relacion.campo}Ids());
            }
            entidad.set${capitalizar(relacion.campo)}(${relacion.campo});
        }`;
      }

      const buscar = `${repositorio}.findById(request.${relacion.campo}Id())
                    .orElseThrow(() -> new NotFoundException("${relacion.destino.clase}", request.${relacion.campo}Id()))`;

      if (relacion.obligatorio) {
        return `        entidad.set${capitalizar(relacion.campo)}(${buscar});`;
      }

      return `        entidad.set${capitalizar(relacion.campo)}(
                request.${relacion.campo}Id() == null ? null
                        : ${buscar});`;
    })
    .join('\n');

  const bloqueEnlazar = relaciones.length > 0 ? `\n${enlazar}\n` : '';

  const clave = tipoClave(entidad);

  if (entidad.claveCompuesta) usa.push(`${PAQUETE}.model.${entidad.clase}Id`);
  else if (entidad.clave.importar) usa.push(entidad.clave.importar);

  usa.push('org.springframework.http.HttpStatus', 'org.springframework.web.server.ResponseStatusException');

  // Con qué se construye la clave a partir del request, para saber si ya existe ANTES de
  // guardar. Con una clave asignada, `save()` con un id que ya existe hace un merge: sin
  // esta comprobación, un POST repetido sobrescribiría la fila en silencio en vez de dar 409.
  const claveDelRequest = entidad.claveCompuesta
    ? `new ${entidad.clase}Id(${relacionesDeClave(entidad)
        .map((r) => `request.${r.campo}Id()`)
        .join(', ')})`
    : `request.${entidad.clave.campo}()`;

  return `${cabecera('service', usa)}
/**
 * CRUD de ${entidad.clase}. Única capa que ve entidades: recibe y devuelve DTOs.
 * Las relaciones llegan como ids y se resuelven aquí contra su repositorio.
 *
 * La clave es \`${clave}\`, asignada y no generada: la trae quien crea el objeto.
 */
@Service
@Transactional(readOnly = true)
public class ${entidad.clase}Service {

${campos.join('\n')}

    public ${entidad.clase}Service(${parametros.join(',\n            ')}) {
${asignaciones.join('\n')}
    }

    public List<${entidad.clase}Response> listar() {
        return mapper.toResponseList(repository.findAll());
    }

    public ${entidad.clase}Response obtenerPorId(${clave} id) {
        return mapper.toResponse(buscar(id));
    }

    @Transactional
    public ${entidad.clase}Response crear(${entidad.clase}Request request) {
        ${clave} clave = ${claveDelRequest};

        // save() sobre una clave asignada que ya existe es un UPDATE, no un INSERT.
        if (repository.existsById(clave)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Ya existe un ${entidad.clase} con la clave " + clave);
        }

        ${entidad.clase} entidad = mapper.toEntity(request);
${bloqueEnlazar}        return mapper.toResponse(repository.save(entidad));
    }

    @Transactional
    public ${entidad.clase}Response actualizar(${clave} id, ${entidad.clase}Request request) {
        ${entidad.clase} entidad = buscar(id);
        mapper.updateEntity(entidad, request);
${bloqueEnlazar}        return mapper.toResponse(repository.save(entidad));
    }

    @Transactional
    public void eliminar(${clave} id) {
        if (!repository.existsById(id)) {
            throw new NotFoundException("${entidad.clase}", id);
        }
        repository.deleteById(id);
    }

    private ${entidad.clase} buscar(${clave} id) {
        return repository.findById(id)
                .orElseThrow(() -> new NotFoundException("${entidad.clase}", id));
    }
}
`;
}

const minuscula = (texto) => texto.charAt(0).toLowerCase() + texto.slice(1);

// ---------------------------------------------------------------- controlador

function renderControlador(entidad) {
  const usa = [
    `${PAQUETE}.dto.${entidad.clase}Request`,
    `${PAQUETE}.dto.${entidad.clase}Response`,
    `${PAQUETE}.service.${entidad.clase}Service`,
    'io.swagger.v3.oas.annotations.Operation',
    'io.swagger.v3.oas.annotations.responses.ApiResponse',
    'io.swagger.v3.oas.annotations.responses.ApiResponses',
    'io.swagger.v3.oas.annotations.tags.Tag',
    'jakarta.validation.Valid',
    'org.springframework.http.ResponseEntity',
    'org.springframework.web.bind.annotation.DeleteMapping',
    'org.springframework.web.bind.annotation.GetMapping',
    'org.springframework.web.bind.annotation.PathVariable',
    'org.springframework.web.bind.annotation.PostMapping',
    'org.springframework.web.bind.annotation.PutMapping',
    'org.springframework.web.bind.annotation.RequestBody',
    'org.springframework.web.bind.annotation.RequestMapping',
    'org.springframework.web.bind.annotation.RestController',
    'org.springframework.web.util.UriComponentsBuilder',
    'java.net.URI',
    'java.util.List',
  ];

  const clave = tipoClave(entidad);
  const partesClave = relacionesDeClave(entidad);

  if (entidad.claveCompuesta) usa.push(`${PAQUETE}.model.${entidad.clase}Id`);
  else if (entidad.clave.importar) usa.push(entidad.clave.importar);

  for (const parte of partesClave) {
    if (!parte.destino.claveCompuesta && parte.destino.clave.importar) {
      usa.push(parte.destino.clave.importar);
    }
  }

  /**
   * Una clave compuesta no cabe en un solo segmento de ruta, así que se parte en dos:
   * `/api/matriculas/{estudianteId}/{cursoId}`. Meterla como un string con separador
   * obligaría a inventar un formato y a parsearlo a mano en cada petición.
   */
  const rutaId = entidad.claveCompuesta
    ? partesClave.map((r) => `{${r.campo}Id}`).join('/')
    : '{id}';

  const parametrosId = entidad.claveCompuesta
    ? partesClave
        .map((r) => `@PathVariable ${tipoClave(r.destino)} ${r.campo}Id`)
        .join(',\n                                                          ')
    : `@PathVariable ${clave} id`;

  const argumentoId = entidad.claveCompuesta
    ? `new ${entidad.clase}Id(${partesClave.map((r) => `${r.campo}Id`).join(', ')})`
    : 'id';

  const expandirUri = entidad.claveCompuesta
    ? partesClave.map((r) => `creado.${r.campo}Id()`).join(', ')
    : `creado.${entidad.clave.campo}()`;

  return `${cabecera('controller', usa)}
/** CRUD REST de ${entidad.clase}, generado desde la clase UML "${entidad.nombreUml}". */
@RestController
@RequestMapping("/api/${entidad.ruta}")
@Tag(name = "${entidad.clase}", description = "Operaciones sobre ${entidad.nombreUml}")
public class ${entidad.clase}Controller {

    private final ${entidad.clase}Service service;

    public ${entidad.clase}Controller(${entidad.clase}Service service) {
        this.service = service;
    }

    @GetMapping
    @Operation(summary = "Lista todos los registros de ${entidad.clase}")
    @ApiResponse(responseCode = "200", description = "Listado devuelto")
    public ResponseEntity<List<${entidad.clase}Response>> listar() {
        return ResponseEntity.ok(service.listar());
    }

    @GetMapping("/${rutaId}")
    @Operation(summary = "Obtiene un ${entidad.clase} por su clave")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Encontrado"),
            @ApiResponse(responseCode = "404", description = "No existe ese id")
    })
    public ResponseEntity<${entidad.clase}Response> obtenerPorId(${parametrosId}) {
        return ResponseEntity.ok(service.obtenerPorId(${argumentoId}));
    }

    @PostMapping
    @Operation(summary = "Crea un ${entidad.clase}")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "Creado"),
            @ApiResponse(responseCode = "400", description = "Datos inválidos"),
            @ApiResponse(responseCode = "409", description = "Ya existe esa clave")
    })
    public ResponseEntity<${entidad.clase}Response> crear(@Valid @RequestBody ${entidad.clase}Request request,
                                                          UriComponentsBuilder uriBuilder) {
        ${entidad.clase}Response creado = service.crear(request);
        URI ubicacion = uriBuilder.path("/api/${entidad.ruta}/${rutaId}")
                .buildAndExpand(${expandirUri}).toUri();
        return ResponseEntity.created(ubicacion).body(creado);
    }

    @PutMapping("/${rutaId}")
    @Operation(summary = "Actualiza un ${entidad.clase} existente")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "Actualizado"),
            @ApiResponse(responseCode = "400", description = "Datos inválidos"),
            @ApiResponse(responseCode = "404", description = "No existe ese id")
    })
    public ResponseEntity<${entidad.clase}Response> actualizar(${parametrosId},
                                                               @Valid @RequestBody ${entidad.clase}Request request) {
        return ResponseEntity.ok(service.actualizar(${argumentoId}, request));
    }

    @DeleteMapping("/${rutaId}")
    @Operation(summary = "Elimina un ${entidad.clase}")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "Eliminado"),
            @ApiResponse(responseCode = "404", description = "No existe ese id")
    })
    public ResponseEntity<Void> eliminar(${parametrosId}) {
        service.eliminar(${argumentoId});
        return ResponseEntity.noContent().build();
    }
}
`;
}

module.exports = {
  PAQUETE,
  // Las reglas de que campos lleva cada DTO y como es la clave. La coleccion de Postman las
  // reutiliza en vez de copiarlas: si el request cambia, los cuerpos de ejemplo cambian con el.
  atributosEscribibles,
  relacionesAUno,
  coleccionesEscribibles,
  relacionesDeClave,
  tipoClave,
  renderEntidad,
  renderClaveEmbebida,
  renderInterfaz,
  renderRequest,
  renderResponse,
  renderMapper,
  renderRepositorio,
  renderServicio,
  renderControlador,
};
