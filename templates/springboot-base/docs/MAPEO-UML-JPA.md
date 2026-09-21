# Mapeo UML → JPA

Tabla de correspondencias entre el JSON del diagramador y el código que el exportador debe
escribir en este proyecto. **Este proyecto no implementa el exportador**: esto es el contrato
que el exportador tiene que cumplir, y la razón por la que el proyecto base está organizado
como está.

La plantilla de referencia es la rebanada `Ejemplo` (entidad, DTOs, mapper, repositorio,
servicio, controlador). Todo lo de abajo describe cómo rellenar esa plantilla.

---

## 1. Forma del documento de entrada

```jsonc
{
  "schemaVersion": 2,
  "kind": "uml-class-model",
  "meta": { "name": "Sistema de Matrículas", "createdAt": "...", "updatedAt": "..." },
  "diagrams": [{ "id": "d_main", "name": "...", "viewport": { "x": 0, "y": 0, "zoom": 1 } }],
  "nodes": { "n_xxx": { /* nodo */ } },   // indexado por id, NO es un array
  "edges": { "e_xxx": { /* arista */ } }
}
```

`nodes` y `edges` son **objetos indexados por id**, no listas: para recorrerlos hay que
iterar los valores, y para resolver `edge.source` se busca `nodes[edge.source]`.

### Nodo

```jsonc
{
  "id": "n_xxx", "diagramId": "d_main",
  "kind": "class" | "interface" | "association-class",
  "name": "Estudiante",
  "keywords": [], "isAbstract": false, "visibility": "+",
  "position": {...}, "size": {...}, "z": 0, "parentId": null,
  "associationId": null,        // solo en association-class: id de la arista a la que pertenece
  "compartments": {
    "attributes": [ /* Property[] */ ],
    "operations": [ /* Operation[] */ ]
  }
}
```

`position`, `size`, `z`, `viewport` y `waypoints` son datos de dibujo: **el exportador los
ignora por completo**.

- **Property** — `{ kind:"property", id, name, type|null, visibility, multiplicity|null, defaultValue|null, isStatic, isDerived, isReadOnly, isOrdered, isUnique }`
- **Operation** — `{ kind:"operation", id, name, visibility, parameters[], returnType|null, isStatic, isAbstract, isQuery }`
- **Parameter** — `{ id, name, type|null, direction, defaultValue|null }`

### Arista

```jsonc
{
  "id": "e_xxx", "diagramId": "d_main",
  "kind": "association" | "directed-association" | "aggregation" | "composition"
        | "generalization" | "realization" | "association-class",
  "source": "n_aaa", "target": "n_bbb",
  "name": null, "nameDirection": "none",
  "ends": {
    "source": { "role": null, "multiplicity": "1", "visibility": null, "navigable": null,
                "isOrdered": false, "isUnique": true },
    "target": { "...": "igual" }
  },
  "waypoints": [], "routing": "straight"
}
```

`visibility` es `"+" | "-" | "#" | "~"`. Las multiplicidades son cadenas: `"1"`, `"0..1"`,
`"0..*"`, `"1..*"`, `"*"`.

---

## 2. Dirección de las relaciones — leerlo dos veces

Es lo que más se invierte al escribir un exportador.

| Relación | `source` es | `target` es |
|---|---|---|
| `aggregation`, `composition` | **el todo / el contenedor** (el rombo se dibuja en el origen) | la parte |
| `generalization` | **la subclase** (hija) | la superclase (padre) |
| `realization` | la clase que implementa | la interfaz |
| `association`, `directed-association` | un extremo cualquiera | el otro |
| `association-class` | un extremo | el otro; además existe un **nodo** con `associationId` apuntando a esta arista |

Dicho al revés, para las dos que más se equivocan:

- En `generalization`, el `extends` se escribe en `nodes[edge.source]`, y lo que se extiende
  es `nodes[edge.target]`. **La flecha del diagrama apunta al padre.**
- En `composition`, el que manda (la cascada, el `orphanRemoval`, el lado `@OneToMany`) es
  `source`. El rombo está en el origen.

---

## 3. Qué genera cada tipo de nodo

| `kind` | Qué se escribe |
|---|---|
| `class` | Entidad JPA en `model/` + las seis capas de la plantilla |
| `class` con `isAbstract: true` | `public abstract class`; si solo es raíz de una herencia y nadie la instancia, entidad sí, controlador no |
| `interface` | `interface` Java en `model/`, **sin `@Entity`**. No lleva tabla, ni repositorio, ni servicio, ni controlador |
| `association-class` | Entidad propia con su tabla, dos `@ManyToOne` a los extremos de la arista que indica su `associationId`, y sus atributos como columnas. Sí genera las seis capas |

---

## 4. Tipos UML → Java

| UML | Java |
|---|---|
| `String`, `char` | `String`, `Character` |
| `Boolean` | `Boolean` |
| `Integer`, `int`, `short`, `byte` | `Integer`, `Short`, `Byte` |
| `long` | `Long` |
| `Real`, `double`, `float` | `Double`, `Float` |
| `decimal` | `BigDecimal` |
| `date` | `LocalDate` |
| `datetime`, `timestamp` | `LocalDateTime` |
| `UnlimitedNatural` | `Integer` |
| `object`, `null`, desconocido | `String` (y dejar un `// TODO` visible) |
| `void` | `void` (solo en retornos de operaciones) |
| Nombre de otra clase del diagrama | esa entidad — **es una relación, no una columna** |

Siempre los tipos envoltorio (`Integer`, no `int`): un primitivo no puede ser `null`, y una
columna opcional sí. Con `int`, una columna vacía se lee como `0`, que es un valor legítimo y
por tanto indistinguible de «no hay dato».

---

## 5. Atributos → columnas

| En el JSON | En la entidad |
|---|---|
| `multiplicity: "1"` (o `null`, que es el caso por defecto) | `@Column(nullable = false)`; en el request DTO, `@NotNull` — o `@NotBlank` si es `String` |
| `multiplicity: "0..1"` | columna que admite null, sin anotación de validación |
| `isDerived: true` | `@Transient` — se calcula, no se guarda |
| `isReadOnly: true` | `@Column(updatable = false)`; el mapper no lo toca en `updateEntity` |
| `isStatic: true` | campo `static` de la clase; **no es columna** y no aparece en los DTOs |
| `defaultValue` | inicializador del campo en Java |
| `visibility` | se ignora: los campos de una entidad JPA van `private` siempre, y el acceso lo dan los getters |
| nombre `id`, o `isReadOnly` con tipo entero | **no dupliques la clave primaria**: toda entidad ya lleva su `Long id` con `@GeneratedValue(IDENTITY)`. Si el diagrama declara un `id` propio, se descarta |

Las **operaciones** (`compartments.operations`) no generan nada por defecto. Como mucho, un
método vacío en el servicio con un `// TODO`: el diagrama declara la firma, no el cuerpo.

---

## 6. Relaciones → JPA

### Cardinalidad

| Multiplicidades (source → target) | JPA |
|---|---|
| `1` → `0..*` / `1..*` / `*` | `@OneToMany` en source + `@ManyToOne` en target |
| `0..*` → `1` | `@ManyToOne` en source + `@OneToMany` en target |
| muchos → muchos | `@ManyToMany` (o entidad intermedia si hay `association-class`) |
| `1` → `1` / `0..1` | `@OneToOne` |

El lado `@ManyToOne` es siempre el **dueño** de la relación: es el que lleva la clave foránea.
El lado `@OneToMany` lleva `mappedBy` apuntando al nombre del campo del otro lado.

### Semántica

| `kind` | Qué añadir |
|---|---|
| `composition` | `cascade = CascadeType.ALL`, `orphanRemoval = true` — la parte no vive sin el todo |
| `aggregation` | `cascade = {CascadeType.PERSIST, CascadeType.MERGE}`, **sin** `orphanRemoval` |
| `association`, `directed-association` | sin cascada |
| `generalization` | herencia Java (`extends`) más `@Inheritance(strategy = InheritanceType.SINGLE_TABLE)` en el padre; si el padre es `isAbstract`, clase `abstract` |
| `realization` | `implements` de la interfaz; una `interface` **no** es una entidad |
| `association-class` | **entidad propia** con su tabla, dos `@ManyToOne` a los extremos y sus atributos como columnas. Es el muchos-a-muchos con datos |

### Colecciones

- `isUnique: false` en un extremo `*` → `List<Xxx>`, inicializado a `new ArrayList<>()`
- `isUnique: true` → `Set<Xxx>`, inicializado a `new LinkedHashSet<>()`
- `isOrdered: true` → añadir `@OrderColumn`, o `@OrderBy` si hay un criterio natural

Toda relación se genera `FetchType.LAZY`. `@ManyToOne` es `EAGER` por defecto en JPA, así que
hay que escribirlo explícitamente: con `open-in-view=false` (ver `application.yml`) cada
`EAGER` de más se paga en todas las consultas de esa entidad.

### Nombre del campo

Del `role` del extremo si existe; si no, del nombre de la clase del otro lado:

- lado «uno» → el nombre en singular y camelCase: `Carrera` → `carrera`
- lado «muchos» → el nombre en plural y camelCase: `Estudiante` → `estudiantes`

---

## 7. Cómo se refleja una relación en los DTOs

Las relaciones **no viajan como objetos anidados**. Arrastrarían el grafo entero, y con dos
entidades que se apuntan mutuamente la serialización entra en ciclo.

| En la entidad | En `XxxRequest` | En `XxxResponse` |
|---|---|---|
| `@ManyToOne Carrera carrera` | `Long carreraId` | `Long carreraId` (y opcionalmente `String carreraNombre`) |
| `@OneToMany List<Alumno> alumnos` | — (no se acepta por aquí) | `List<Long> alumnoIds`, o nada |
| `@ManyToMany Set<Curso> cursos` | `Set<Long> cursoIds` | `Set<Long> cursoIds` |

Cuando el request trae un `Long xxxId`, el mapper de esa entidad recibe por constructor el
repositorio del otro lado y resuelve la referencia, lanzando `NotFoundException` si el id no
existe.

---

## 8. Nombres

| Cosa | Convención | Ejemplo |
|---|---|---|
| Clase de entidad | tal cual, PascalCase singular | `Estudiante` |
| Tabla | snake_case singular | `@Table(name = "estudiante")` |
| Columna | snake_case | `@Column(name = "fecha_nacimiento")` |
| DTOs | `XxxRequest`, `XxxResponse` | `EstudianteRequest` |
| Mapper, repositorio, servicio, controlador | `XxxMapper`, `XxxRepository`, `XxxService`, `XxxController` | `EstudianteService` |
| Ruta REST | `/api/` + plural en minúsculas | `/api/estudiantes` |

**Pluralización** (castellano, la mínima que hace falta):

- acaba en vocal → `+s`: `Curso` → `cursos`
- acaba en `z` → `-z +ces`: `Lapiz` → `lapices`
- acaba en otra consonante → `+es`: `Profesor` → `profesores`

Nombres con acento o `ñ` en la clase: quitar acentos para la ruta y la tabla, conservarlos en
la clase Java. `Matrícula` → clase `Matricula`, tabla `matricula`, ruta `/api/matriculas`.

---

## 9. Puntos ambiguos que conviene decidir antes de escribir el exportador

Ninguno tiene una respuesta única correcta, y todos cambian el código generado:

1. **`@ManyToMany` vs. entidad intermedia siempre.** Un `@ManyToMany` deja de servir en
   cuanto la relación necesita un atributo propio, y migrarlo después obliga a tocar datos.
2. **Estrategia de herencia.** `SINGLE_TABLE` es rápida, pero obliga a que toda columna de
   las hijas admita null. `JOINED` respeta el modelo a cambio de joins.
3. **Qué hacer con las operaciones UML.** Ignorarlas, o generar métodos vacíos con `// TODO`.
4. **Dirección de navegación.** El JSON trae `navigable` en cada extremo, y el mapeo de
   arriba lo ignora: genera siempre los dos lados. Respetarlo produciría un modelo más fiel
   y más incómodo de consultar.
5. **Ciclos de composición.** `cascade = ALL` en un ciclo A→B→A borra en cascada de forma
   nada obvia. Hace falta detectar ciclos y degradar la cascada, o rechazar el diagrama.
6. **Colisiones de nombre de ruta.** Dos clases que pluralizan igual chocan en `/api/...`.
7. **Qué pasa al re-exportar.** Sobrescribir todo el paquete pierde cualquier retoque a mano;
   no sobrescribir deja código viejo conviviendo con el nuevo. Lo más manejable es
   sobrescribir siempre y prohibir editar a mano lo generado.
