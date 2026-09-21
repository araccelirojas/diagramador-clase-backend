# Backend base — diagramador UML

Proyecto Spring Boot vacío pero funcionando, pensado para que un exportador escriba dentro de
él las entidades, DTOs, repositorios, servicios y controladores derivados de un diagrama UML
de clases.

Arranca con un solo comando y sin configurar nada: no hace falta instalar una base de datos,
ni crear un usuario, ni editar un fichero.

---

## Requisitos

Un **JDK 21**. Nada más.

```bash
java -version   # debe decir 21
```

Maven no hace falta: el proyecto trae el wrapper (`mvnw`, `mvnw.cmd`), que la primera vez se
descarga Maven 3.9.9 y las dependencias — o sea que el primer arranque necesita red y tarda
un minuto largo; los siguientes son inmediatos. Docker tampoco hace falta, salvo que quieras
usar Postgres.

---

## Arrancar

```bash
./mvnw spring-boot:run
```

En Windows con `cmd` o PowerShell, `mvnw spring-boot:run`.

Levanta en unos segundos con una base H2 **en memoria**, que se crea sola y desaparece al
parar la aplicación. Cuando veas `Started BackendApplication`, esto ya responde:

| URL | Qué es |
|---|---|
| <http://localhost:8080/api/ejemplos> | el CRUD de ejemplo — devuelve `[]` la primera vez |
| <http://localhost:8080/swagger-ui.html> | documentación interactiva de todos los endpoints |
| <http://localhost:8080/v3/api-docs> | el mismo OpenAPI en JSON |
| <http://localhost:8080/h2-console> | consola de la base H2 |

Para entrar a la consola H2, en **JDBC URL** poné `jdbc:h2:mem:diagramador`, usuario `sa` y
contraseña vacía.

---

## Arrancar con Postgres

Solo si querés una base que sobreviva al reinicio. Todo lo demás funciona igual.

```bash
docker compose up -d --wait
./mvnw spring-boot:run -Dspring-boot.run.profiles=postgres
```

El `docker-compose.yml` levanta un Postgres 16 con base `diagramador`, usuario `postgres` y
contraseña `postgres` — exactamente los valores por defecto del perfil, así que no hay que
configurar nada en ninguno de los dos lados.

Para pararlo: `docker compose down` (o `docker compose down -v` para borrar también los datos).

### Si ya tenés un Postgres instalado en la máquina

Entonces el 5432 está ocupado y hay que mover el del contenedor. Basta con `DB_PORT`, que
vale para las dos mitades a la vez — el puerto que publica Docker y el puerto al que se
conecta la aplicación:

```bash
DB_PORT=5433 docker compose up -d --wait
DB_PORT=5433 ./mvnw spring-boot:run -Dspring-boot.run.profiles=postgres
```

O poné `DB_PORT=5433` en el `.env` una vez y olvidate.

Ojo con el síntoma, porque despista: en Windows, `docker compose up` puede enlazar el 5432
sin quejarse aunque ya haya un Postgres local escuchando, y entonces la aplicación acaba
conectándose **al Postgres local y no al contenedor**. Se ve como
`FATAL: la autentificación password falló para el usuario «postgres»` — un error de
credenciales, no de puerto. Si te pasa eso teniendo el contenedor sano, es esto.

---

## Compilar, empaquetar y ejecutar el `.jar`

```bash
./mvnw clean package                          # compila y corre los tests
java -jar target/backend-0.0.1-SNAPSHOT.jar   # ejecuta el jar (H2 en memoria)
```

Con Postgres:

```bash
SPRING_PROFILES_ACTIVE=postgres java -jar target/backend-0.0.1-SNAPSHOT.jar
```

En producción, sumá el perfil `prod` — pone `ddl-auto=validate`, o sea que la aplicación
comprueba el esquema pero no lo modifica:

```bash
SPRING_PROFILES_ACTIVE=postgres,prod java -jar target/backend-0.0.1-SNAPSHOT.jar
```

---

## Tests

```bash
./mvnw test
```

Corren contra H2, sin nada levantado. Cubren que el contexto arranca y el CRUD completo de
`Ejemplo`, incluidos el 404 de un id inexistente y el 400 de un cuerpo inválido.

---

## Variables de entorno

Ninguna es obligatoria: **cada una tiene un valor por defecto que hace que el proyecto
funcione**. Podés copiar `.env.example` a `.env` y cambiar lo que quieras; si el `.env` no
existe, no pasa nada. Las variables de entorno reales ganan sobre lo que ponga el `.env`.

| Variable | Por defecto | Para qué |
|---|---|---|
| `SERVER_PORT` | `8080` | Puerto HTTP. |
| `SPRING_PROFILES_ACTIVE` | `default` | `default` = H2 en memoria · `postgres` = Postgres · `postgres,prod` = Postgres con `ddl-auto=validate`. |
| `DB_HOST` | `localhost` | Host de Postgres. Solo con el perfil `postgres`. |
| `DB_PORT` | `5432` | Puerto de Postgres. Solo con el perfil `postgres`. |
| `DB_NAME` | `diagramador` | Nombre de la base. Solo con el perfil `postgres`. |
| `DB_USER` | `postgres` (H2: `sa`) | Usuario de la base. |
| `DB_PASSWORD` | `postgres` (H2: vacío) | Contraseña de la base. |
| `CORS_ORIGINS` | `http://localhost:5173` | Orígenes permitidos por CORS, separados por comas. |
| `JPA_DDL_AUTO` | `update` | Qué hace Hibernate con el esquema: `update`, `validate`, `create-drop`, `none`. El perfil `prod` lo fuerza a `validate`. |
| `JPA_SHOW_SQL` | `false` | `true` imprime cada sentencia SQL. Útil para revisar lo que genera el exportador. |
| `LOG_LEVEL` | `INFO` | Nivel de log del código propio. |
| `H2_CONSOLE` | `true` | Habilita `/h2-console`. Solo con el perfil por defecto. |
| `DB_URL` | JDBC de H2 en memoria | Sobrescribe la URL entera. Solo con el perfil por defecto. |

---

## El CRUD de ejemplo, con `curl`

Copiables tal cual, con la aplicación corriendo. Las respuestas son las reales.

**Crear** — devuelve `201` y la cabecera `Location`:

```bash
curl -i -X POST http://localhost:8080/api/ejemplos \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Primer ejemplo","descripcion":"Creado con curl","activo":true}'
```

```
HTTP/1.1 201
Location: http://localhost:8080/api/ejemplos/1

{"id":1,"nombre":"Primer ejemplo","descripcion":"Creado con curl","activo":true,"creadoEn":"2026-09-19T21:36:49.0642179"}
```

**Listar**:

```bash
curl http://localhost:8080/api/ejemplos
```

```json
[{"id":1,"nombre":"Primer ejemplo","descripcion":"Creado con curl","activo":true,"creadoEn":"2026-09-19T21:36:49.064218"}]
```

**Obtener por id**:

```bash
curl http://localhost:8080/api/ejemplos/1
```

```json
{"id":1,"nombre":"Primer ejemplo","descripcion":"Creado con curl","activo":true,"creadoEn":"2026-09-19T21:36:49.064218"}
```

**Actualizar** — reemplaza el recurso entero; `id` y `creadoEn` no se tocan:

```bash
curl -X PUT http://localhost:8080/api/ejemplos/1 \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Ejemplo renombrado","descripcion":"Actualizado con curl","activo":false}'
```

```json
{"id":1,"nombre":"Ejemplo renombrado","descripcion":"Actualizado con curl","activo":false,"creadoEn":"2026-09-19T21:36:49.064218"}
```

**Borrar** — devuelve `204` sin cuerpo:

```bash
curl -i -X DELETE http://localhost:8080/api/ejemplos/1
```

### Los errores

Todos tienen la misma forma. Un id que no existe:

```bash
curl http://localhost:8080/api/ejemplos/999
```

```json
{"timestamp":"2026-09-19T21:36:49.7122833","status":404,"message":"Ejemplo no encontrado con id 999","path":"/api/ejemplos/999"}
```

Un cuerpo que no pasa la validación añade `fields`, con el motivo de cada campo:

```bash
curl -X POST http://localhost:8080/api/ejemplos \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"   ","activo":null}'
```

```json
{"timestamp":"2026-09-19T21:36:49.7816391","status":400,"message":"Error de validación","path":"/api/ejemplos","fields":{"nombre":"el nombre es obligatorio","activo":"activo es obligatorio"}}
```

---

## Cómo se usa como base del exportador

### Qué paquetes se rellenan

Cada uno tiene un `package-info.java` que describe qué se espera dentro. Esa es la señal de
dónde escribir.

```
com.diagramador.backend
├── BackendApplication.java
├── config/       CORS y OpenAPI                        (fijo — no se toca)
├── common/       ApiError, GlobalExceptionHandler,
│                 NotFoundException                     (fijo — no se toca)
├── model/        entidades JPA                         ← se rellena
├── dto/          XxxRequest y XxxResponse              ← se rellena
├── mapper/       entidad <-> DTO                       ← se rellena
├── repository/   interfaces JpaRepository              ← se rellena
├── service/      lógica                                ← se rellena
└── controller/   REST                                  ← se rellena
```

`config/` y `common/` son infraestructura compartida: el exportador los usa, no los reescribe.
Gracias a `GlobalExceptionHandler`, ningún controlador generado necesita `try`/`catch`.

### Convención de nombres, capa por capa

Para una clase `Estudiante` del diagrama:

| Capa | Fichero | Forma |
|---|---|---|
| Entidad | `model/Estudiante.java` | `@Entity @Table(name = "estudiante")`, `Long id` con `@GeneratedValue(IDENTITY)` |
| DTO entrada | `dto/EstudianteRequest.java` | `record`, sin `id`, con las validaciones |
| DTO salida | `dto/EstudianteResponse.java` | `record`, con `id` |
| Mapper | `mapper/EstudianteMapper.java` | `@Component`, con `toEntity`, `updateEntity`, `toResponse`, `toResponseList` |
| Repositorio | `repository/EstudianteRepository.java` | `interface … extends JpaRepository<Estudiante, Long>` |
| Servicio | `service/EstudianteService.java` | `@Service`, con `listar`, `obtenerPorId`, `crear`, `actualizar`, `eliminar` |
| Controlador | `controller/EstudianteController.java` | `@RestController @RequestMapping("/api/estudiantes")` |

Reglas que no cambian entre clases generadas:

- El servicio devuelve **DTOs, nunca entidades**. El controlador **no toca el repositorio**.
- Inyección por constructor, no `@Autowired` en el campo.
- Un id inexistente lanza `NotFoundException`, que sale como `404` con la forma de `ApiError`.
- `POST` devuelve `201` con `Location`; `DELETE` devuelve `204`.
- La ruta es el nombre de la clase en plural y minúsculas.

### `Ejemplo` es la plantilla, y es borrable

> **`Ejemplo` no es parte de ningún dominio.** Está para dos cosas: demostrar que el proyecto
> funciona recién clonado, y servir de molde exacto a lo que el exportador tiene que escribir.
> Una vez generado el código real, se borra.

Para borrarlo, estos siete ficheros y su test:

```bash
rm src/main/java/com/diagramador/backend/model/Ejemplo.java
rm src/main/java/com/diagramador/backend/dto/EjemploRequest.java
rm src/main/java/com/diagramador/backend/dto/EjemploResponse.java
rm src/main/java/com/diagramador/backend/mapper/EjemploMapper.java
rm src/main/java/com/diagramador/backend/repository/EjemploRepository.java
rm src/main/java/com/diagramador/backend/service/EjemploService.java
rm src/main/java/com/diagramador/backend/controller/EjemploController.java
rm src/test/java/com/diagramador/backend/EjemploCrudTest.java
```

Nada más depende de ellos: `./mvnw clean package` sigue pasando después.

La rebanada está escrita a propósito **aburrida y explícita** — sin genéricos, sin clases base
abstractas, sin ningún `AbstractCrudService<T, ID>`. Una jerarquía que «ahorra código» es justo
lo que impide que un programa la reproduzca sustituyendo nombres, que es lo único que el
exportador va a hacer.

### La correspondencia UML → JPA

Está entera, con las direcciones de cada relación y los casos límite, en
[`docs/MAPEO-UML-JPA.md`](docs/MAPEO-UML-JPA.md). Conviene leer la sección «Dirección de las
relaciones» antes de escribir la primera línea del exportador: es donde se equivoca todo el
mundo.
