# Exportador: diagrama UML -> backend Spring Boot

Convierte el `contenido` de un proyecto en un proyecto Spring Boot completo y compilable,
con CRUD y Swagger por cada clase.

`GET /api/proyectos/:id/exportar` devuelve el zip. En el frontend es el botón
**Exportar backend** de la barra del editor.

## Las piezas

| Fichero | Qué hace |
|---|---|
| `naming.js` | Nombres Java a partir de nombres UML. Acentos, espacios, palabras reservadas y duplicados |
| `javaTypes.js` | Tipos UML -> tipos Java. Lo que no conoce cae a `String` con un TODO visible |
| `plan.js` | **Toda** la semántica UML -> JPA. Si hay algo que decidir, se decide aquí y una sola vez |
| `render.js` | Plan -> texto Java. Una función por capa, con la forma de la rebanada `Ejemplo` |
| `proyecto.js` | Plantilla + plan -> árbol de ficheros en memoria |
| `index.js` | Ese árbol -> zip en streaming |

## Qué genera

Por cada **clase concreta** y cada **clase de asociación**, las siete piezas: entidad, DTO
de entrada, DTO de salida, mapper, repositorio, servicio y controlador, con CRUD completo
(`GET`, `GET /{id}`, `POST`, `PUT /{id}`, `DELETE /{id}`) anotado con `@Tag`, `@Operation`
y `@ApiResponses`.

Lo que **no** tiene CRUD, a propósito:

- **Clases abstractas**: son tabla y padre de la jerarquía, pero no se pueden instanciar.
- **Interfaces**: se generan como `interface` Java, sin tabla.
- **Relaciones**: no son un recurso REST. Se materializan como campos JPA en las entidades
  que unen. La excepción es la clase de asociación, que sí es una tabla y sí tiene su CRUD.

## La clave primaria: el generador no impone ninguna

Cada clase declara su identidad marcando una propiedad con **`{id}`**, el modificador de
UML 2.5. Vive en el documento (`Property.isId`, schemaVersion 3), se ve en el lienzo y se
elige en el diálogo que aparece antes de exportar. **Si falta, la exportación se detiene**
con un 422 que nombra las clases sin clave, en vez de inventar un `Long id`.

| Caso | Clave |
|---|---|
| Clase normal | La propiedad marcada con `{id}`. Asignada: **sin** `@GeneratedValue` |
| Subclase | La de su raíz; solo la raíz declara `@Id` |
| Clase de asociación | **Compuesta**: `@EmbeddedId` + `@MapsId` sobre sus dos `@ManyToOne` |

### Por qué `@EmbeddedId` y no `@IdClass`

Es lo recomendado cuando la clave se usa como objeto: da una firma clara al repositorio
(`JpaRepository<Matricula, MatriculaId>`) y permite `findById(new MatriculaId(a, b))`. La
única ventaja de `@IdClass` —admitir `@GeneratedValue`— aquí no aplica: las dos mitades
vienen de las claves foráneas vía `@MapsId`, no se generan.

`MatriculaId` lleva `equals` y `hashCode` generados, y no son opcionales: sin ellos
Hibernate no puede comparar dos instancias de la clave y `findById` falla de formas
difíciles de diagnosticar.

### La consecuencia de una clave asignada

Con `@GeneratedValue` el id llega nulo y Hibernate hace `INSERT`. Con una clave asignada,
`save()` sobre un id que **ya existe** ejecuta un `merge`: un `POST` repetido sobrescribiría
la fila en silencio. Por eso cada `crear()` comprueba `existsById` antes y devuelve **409**.

Además, la clave viaja en el request del alta (hay que traerla) pero `updateEntity` no la
toca y su columna es `updatable = false`: cambiar la identidad de una fila no es
actualizarla.

### Rutas con clave compuesta

`/api/matriculas/{estudianteId}/{cursoId}`. Una clave compuesta no cabe en un segmento, y
meterla como un string con separador obligaría a inventar un formato y a parsearlo a mano.

## Decisiones que conviene conocer

- **Los DTO incluyen lo heredado.** Un `Estudiante` que hereda `nombre` de `Persona` lo
  lleva en su `EstudianteRequest`. Sin esto, crear un Estudiante dejaba el `nombre` a null
  y la base rechazaba la fila: un fallo que solo aparece al ejecutar, nunca al compilar.
- **Una subclase no lleva `@Table`.** En una jerarquía `SINGLE_TABLE` la declara la raíz, y
  Hibernate rechaza el arranque si ambas la anotan.
- **Las relaciones viajan como ids**, no como objetos anidados: `cursoId` en el request, y
  el servicio lo resuelve contra el repositorio del otro extremo. Los DTO anidados obligan
  a decidir hasta qué profundidad serializar, y ninguna respuesta a eso es buena.
- **Colecciones como `List`, no `Set`**, aunque el extremo UML sea `isUnique: true`. La
  plantilla usa `@Getter/@Setter` y no `@Data` justamente para no generar `equals`/`hashCode`
  en las entidades, y un `Set` sin ellos se comporta por identidad.
- **Las operaciones UML se generan como métodos que lanzan `UnsupportedOperationException`.**
  Un método vacío que devuelve null en silencio es peor que uno que dice que falta escribirlo.
- **Una clase de asociación no genera además un `@ManyToMany`.** Es la asociación, así que
  su tabla es la tabla de unión y los extremos reciben `@OneToMany(mappedBy = ...)` de ella.
  Generar las dos cosas producía dos tablas de unión para una sola arista del diagrama, y la
  colección que se llenaba por la API no era la que guardaba los datos.
- **Una relación de un elemento consigo mismo** (jerarquía, muchos-a-muchos, o clase de
  asociación sobre sí misma) daría el mismo nombre de campo y la misma columna en los dos
  extremos. Se separan por el lado de la arista: con rol se usa el rol —`padre_id` se lee
  mucho mejor que `categoria_origen_id`— y sin rol quedan `…Origen` / `…Destino`, con un
  aviso en la exportación sugiriendo poner roles.
- **`archiver` fijado en la 7.** La 8 dejó de exportar la fábrica `archiver('zip')`.

## Verificar

```bash
npm run export:smoke -- ./tmp-export
cd tmp-export && ./mvnw clean package && java -jar target/*.jar
```

El diagrama de prueba cubre herencia, realización de interfaz, uno-a-muchos,
muchos-a-muchos con clase de asociación, atributos derivados, de solo lectura y estáticos,
y un tipo inexistente.

## Fuentes

Las decisiones de mapeo están contrastadas con:

- [Composite Primary Keys in JPA — Baeldung](https://www.baeldung.com/jpa-composite-primary-keys)
- [Many-to-Many with additional attributes — Thorben Janssen](https://thorben-janssen.com/hibernate-tip-many-to-many-association-with-additional-attributes/)
- [The Ultimate Guide on Composite IDs in JPA Entities — JPA Buddy](https://jpa-buddy.com/blog/the-ultimate-guide-on-composite-ids-in-jpa-entities/)
- [An Overview of Identifiers in Hibernate/JPA — Baeldung](https://www.baeldung.com/hibernate-identifiers)
- [Primary Key Mappings for JPA and Hibernate — Thorben Janssen](https://thorben-janssen.com/primary-key-mappings-jpa-hibernate/)
- [A beginner's guide to JPA and Hibernate Cascade Types — Vlad Mihalcea](https://vladmihalcea.com/a-beginners-guide-to-jpa-and-hibernate-cascade-types/)
