const nombres = require('./naming');
const tipos = require('./javaTypes');

/**
 * Documento UML -> plan de exportacion.
 *
 * Aca vive TODA la semantica UML -> JPA. Los renderizadores de mas abajo solo escriben texto
 * a partir de este plan: si algo hay que decidir, se decide aca y se decide una vez.
 *
 * Direcciones que se invierten con facilidad (documentadas en MAPEO-UML-JPA.md):
 *   - agregacion y composicion: `source` es EL TODO, `target` es la parte.
 *   - generalizacion: `source` es la SUBCLASE, `target` el padre.
 *   - realizacion: `source` es la clase, `target` la interfaz.
 */

const KINDS_ENTIDAD = new Set(['class', 'association-class']);
/**
 * Relaciones que se materializan como campos entre las dos entidades que unen.
 *
 * `association-class` NO esta aca, y esa ausencia es la correccion de un error: una clase
 * de asociacion ES la asociacion (UML 2.5 §11.5), no una asociacion mas una clase al lado.
 * Tratarla como las demas generaba DOS tablas de union para una sola arista del diagrama:
 * la @JoinTable del @ManyToMany y la tabla de la propia clase. Su mapeo entero vive en el
 * paso 5.
 */
const KINDS_RELACION_DATOS = new Set([
  'association',
  'directed-association',
  'aggregation',
  'composition',
]);

/** "0..*" -> { min: 0, max: Infinity }. Un valor vacio significa "sin especificar". */
function leerMultiplicidad(texto) {
  if (texto === null || texto === undefined || String(texto).trim() === '') {
    return { min: 0, max: 1, especificada: false };
  }

  const limpio = String(texto).trim();

  if (limpio === '*') return { min: 0, max: Infinity, especificada: true };

  const partes = limpio.split('..');
  const bajo = partes[0].trim();
  const alto = (partes[1] === undefined ? partes[0] : partes[1]).trim();

  const min = bajo === '*' ? 0 : Number(bajo);
  const max = alto === '*' ? Infinity : Number(alto);

  return {
    min: Number.isNaN(min) ? 0 : min,
    max: Number.isNaN(max) ? 1 : max,
    especificada: true,
  };
}

const esMuchos = (multiplicidad) => multiplicidad.max > 1;
const esObligatorio = (multiplicidad) => multiplicidad.especificada && multiplicidad.min >= 1;

/** Cascada segun el tipo de relacion: la parte de una composicion muere con el todo. */
function cascadaDe(kind) {
  if (kind === 'composition') {
    return { cascade: 'jakarta.persistence.CascadeType.ALL', orphanRemoval: true };
  }
  if (kind === 'aggregation') {
    return {
      cascade: '{ jakarta.persistence.CascadeType.PERSIST, jakarta.persistence.CascadeType.MERGE }',
      orphanRemoval: false,
    };
  }
  return { cascade: null, orphanRemoval: false };
}

/** Atributos que no llegan a ser columna, con el motivo, para explicarlo en el codigo. */
function clasificarAtributo(propiedad) {
  if (propiedad.isStatic) return 'static';
  return null;
}

function construirPlan(documento) {
  const nodos = Object.values(documento.nodes || {});
  const aristas = Object.values(documento.edges || {});

  const usados = new Set();
  const porId = new Map();

  // --- Paso 1: un nombre Java unico y estable por nodo ---
  for (const nodo of nodos) {
    const claseJava = nombres.unico(nombres.nombreDeClase(nodo.name, nodo.id), usados);

    porId.set(nodo.id, {
      id: nodo.id,
      kindUml: nodo.kind,
      esEntidad: KINDS_ENTIDAD.has(nodo.kind),
      esInterfaz: nodo.kind === 'interface',
      esAbstracta: Boolean(nodo.isAbstract),
      nombreUml: nodo.name,
      clase: claseJava,
      campo: nombres.nombreDeCampo(claseJava, nodo.id),
      tabla: nombres.nombreDeTabla(claseJava, nodo.id),
      ruta: nombres.plural(claseJava),
      atributos: [],
      operaciones: [],
      relaciones: [],
      padre: null,
      interfaces: [],
      avisos: [],
      // Solo las clases concretas tienen CRUD: una abstracta no se puede instanciar y una
      // interfaz no es una tabla.
      generaCrud: KINDS_ENTIDAD.has(nodo.kind) && !nodo.isAbstract,
    });
  }

  const porNombreUml = new Map();
  for (const nodo of nodos) {
    const clave = nombres.pascal(nodo.name);
    if (clave !== '' && !porNombreUml.has(clave)) porNombreUml.set(clave, porId.get(nodo.id));
  }

  // --- Paso 2: atributos y operaciones ---
  for (const nodo of nodos) {
    const plan = porId.get(nodo.id);
    /**
     * Solo una clase de asociacion reserva el nombre `id`: es la unica que declara un campo
     * propio asi (`@EmbeddedId private XId id`). En el resto no hay ninguna clave impuesta,
     * asi que un atributo llamado `id` se llama `id`, y no `id2`.
     */
    const usadosEnClase = new Set(nodo.kind === 'association-class' ? ['id'] : []);
    const compartimentos = nodo.compartments || {};

    for (const miembro of compartimentos.attributes || []) {
      if (miembro.kind !== 'property') continue;

      const descartado = clasificarAtributo(miembro);
      if (descartado === 'static') {
        plan.avisos.push(`"${miembro.name}" es static en el diagrama: no se genera como columna.`);
        continue;
      }

      const multiplicidad = leerMultiplicidad(miembro.multiplicity);
      const referencia = porNombreUml.get(nombres.pascal(miembro.type || ''));

      // Un atributo cuyo tipo es otra clase del diagrama NO es una columna: es una relacion.
      if (referencia && referencia.esEntidad) {
        plan.relaciones.push({
          origen: 'atributo',
          campo: nombres.nombreDeCampo(miembro.name, miembro.id),
          destino: referencia,
          tipo: esMuchos(multiplicidad) ? 'OneToMany' : 'ManyToOne',
          propietaria: true,
          cascade: null,
          orphanRemoval: false,
          obligatorio: esObligatorio(multiplicidad) && !esMuchos(multiplicidad),
          columnaUnion: `${plan.tabla}_id`,
        });
        continue;
      }

      const tipo = tipos.resolver(miembro.type);

      plan.atributos.push({
        // {id} de UML 2.5: esta propiedad es la identidad del clasificador.
        esId: Boolean(miembro.isId),
        campo: nombres.unico(nombres.nombreDeCampo(miembro.name, miembro.id), usadosEnClase),
        columna: nombres.nombreDeTabla(miembro.name, miembro.id),
        java: tipo.java,
        importar: tipo.importar || null,
        tipoUml: miembro.type,
        tipoDesconocido: Boolean(tipo.desconocido),
        esColeccion: esMuchos(multiplicidad),
        obligatorio: esObligatorio(multiplicidad) && !esMuchos(multiplicidad),
        esTexto: tipos.esTexto(tipo.java),
        derivado: Boolean(miembro.isDerived),
        soloLectura: Boolean(miembro.isReadOnly),
        defecto: miembro.defaultValue,
      });
    }

    for (const miembro of compartimentos.operations || []) {
      if (miembro.kind !== 'operation') continue;

      const retorno = tipos.resolverRetorno(miembro.returnType);
      const parametros = (miembro.parameters || []).map((p) => {
        const tipo = tipos.resolver(p.type);
        return { nombre: nombres.nombreDeCampo(p.name, p.id), java: tipo.java, importar: tipo.importar || null };
      });

      plan.operaciones.push({
        nombre: nombres.nombreDeCampo(miembro.name, miembro.id),
        retorno: retorno.java,
        retornoImportar: retorno.importar || null,
        esAbstracta: Boolean(miembro.isAbstract),
        parametros,
        // Firma, para no declarar dos veces el mismo metodo heredado de una interfaz.
        firma: `${nombres.nombreDeCampo(miembro.name, miembro.id)}(${parametros.map((p) => p.java).join(',')})`,
      });
    }
  }

  // --- Paso 3: herencia y realizacion ---
  for (const arista of aristas) {
    const origen = porId.get(arista.source);
    const destino = porId.get(arista.target);
    if (!origen || !destino) continue;

    if (arista.kind === 'generalization') {
      // El origen es la subclase: el triangulo apunta al padre.
      if (origen.padre) {
        origen.avisos.push(
          `Herencia multiple con "${destino.clase}": Java no la admite, se mantiene "${origen.padre.clase}".`,
        );
        continue;
      }
      origen.padre = destino;
      destino.tieneHijas = true;
      continue;
    }

    if (arista.kind === 'realization') {
      if (destino.esInterfaz) origen.interfaces.push(destino);
      else {
        origen.avisos.push(
          `Realización hacia "${destino.clase}", que no es una interfaz: se ignora.`,
        );
      }
    }
  }

  /**
   * Las relaciones que unen el MISMO par de clases, agrupadas.
   *
   * Dos clases pueden estar unidas por varias relaciones a la vez —"Start" y "Goal" entre
   * Aeropuerto y Vuelo es el ejemplo de manual— y sin distinguirlas las dos generan el mismo
   * nombre de campo y la misma columna: Java no compila y Hibernate no arranca. El par se
   * toma sin direccion, porque A->B y B->A aterrizan en los mismos dos campos.
   */
  const paralelas = new Map();

  for (const arista of aristas) {
    if (!KINDS_RELACION_DATOS.has(arista.kind)) continue;

    const clave = [arista.source, arista.target].sort().join('|');
    const grupo = paralelas.get(clave);

    if (grupo) grupo.push(arista.id);
    else paralelas.set(clave, [arista.id]);
  }

  // --- Paso 4: relaciones con datos ---
  for (const arista of aristas) {
    if (!KINDS_RELACION_DATOS.has(arista.kind)) continue;

    const origen = porId.get(arista.source);
    const destino = porId.get(arista.target);
    if (!origen || !destino || !origen.esEntidad || !destino.esEntidad) continue;

    const extremoOrigen = (arista.ends && arista.ends.source) || {};
    const extremoDestino = (arista.ends && arista.ends.target) || {};

    const multOrigen = leerMultiplicidad(extremoOrigen.multiplicity);
    const multDestino = leerMultiplicidad(extremoDestino.multiplicity);

    const muchosDestino = esMuchos(multDestino);
    const muchosOrigen = esMuchos(multOrigen);

    const { cascade, orphanRemoval } = cascadaDe(arista.kind);

    // Un extremo con navigable === false no se puede alcanzar desde el otro lado.
    const haciaDestino = extremoDestino.navigable !== false;
    const haciaOrigen = extremoOrigen.navigable !== false;

    /**
     * Una auto-asociacion une la clase consigo misma, asi que los dos extremos darian el
     * MISMO nombre de campo y la misma columna. Se desambiguan por la direccion de la
     * arista. El nombre bonito lo da el rol del extremo: `supervisor` / `supervisados` se
     * lee mucho mejor que `personaOrigen`, y por eso se avisa.
     */
    const esBucle = origen === destino;

    if (esBucle && !extremoOrigen.role && !extremoDestino.role) {
      origen.avisos.push(
        'Tiene una relación consigo misma sin roles: los campos salen como "…Origen" y ' +
          '"…Destino". Poneles un rol en el diagrama para que se llamen algo con sentido.',
      );
    }

    const sufijo = (base, lado) => (esBucle ? `${base}_${lado}` : base);

    /**
     * Varias relaciones entre el mismo par de clases dan todas el mismo nombre de campo.
     * Se separan por el nombre de la relacion si lo tiene —`vuelosStart` se lee— y si no,
     * por su orden. Un rol ya distingue por si solo, asi que ahi no se toca nada.
     */
    const hermanas = paralelas.get([arista.source, arista.target].sort().join('|')) || [];
    const orden = hermanas.indexOf(arista.id);
    const hayVarias = hermanas.length > 1;

    if (hayVarias && orden === 0 && !extremoOrigen.role && !extremoDestino.role && !arista.name) {
      origen.avisos.push(
        `Hay ${hermanas.length} relaciones entre "${origen.clase}" y "${destino.clase}" sin ` +
          'rol ni nombre: los campos salen numerados. Ponéles un rol o un nombre en el ' +
          'diagrama para que se distingan solas.',
      );
    }

    const distinguir = (base) => {
      if (!hayVarias) return base;

      return arista.name ? `${base}_${arista.name}` : `${base}_${orden + 1}`;
    };

    /**
     * Red de seguridad: dos relaciones con el MISMO rol siguen chocando. El desempate tiene
     * que ocurrir aqui y no en una pasada posterior, porque `mappedBy` apunta al nombre del
     * campo del otro lado y renombrarlo despues dejaria el mapeo apuntando a un campo que
     * ya no existe.
     */
    const reservar = (entidad, nombre) => {
      const usados = entidad.camposRelacion || (entidad.camposRelacion = new Set());
      let final = nombre;
      let indice = 2;

      while (usados.has(final)) {
        final = `${nombre}${indice}`;
        indice += 1;
      }

      usados.add(final);
      return final;
    };

    // `campoDestino` es el campo que vive en la entidad ORIGEN y apunta al destino.
    const campoDestino = reservar(
      origen,
      nombres.nombreDeCampo(
        extremoDestino.role ||
          distinguir(sufijo(muchosDestino ? nombres.plural(destino.clase) : destino.clase, 'destino')),
        destino.clase,
      ),
    );
    const campoOrigen = reservar(
      destino,
      nombres.nombreDeCampo(
        extremoOrigen.role ||
          distinguir(sufijo(muchosOrigen ? nombres.plural(origen.clase) : origen.clase, 'origen')),
        origen.clase,
      ),
    );

    /**
     * Dos columnas con el mismo nombre en la misma tabla no existen, asi que en un bucle se
     * separan. Con rol se usa el rol —`padre_id` se lee mucho mejor que
     * `categoria_origen_id`— y sin rol queda el lado de la arista.
     */
    const columna = (extremo, entidad, lado) => {
      if (!hayVarias) {
        if (!esBucle) return `${entidad.tabla}_id`;
        if (extremo.role) return `${nombres.nombreDeTabla(extremo.role, lado)}_id`;

        return `${entidad.tabla}_${lado}_id`;
      }

      /**
       * Varias relaciones al mismo par: cada una necesita su columna. El rol o el nombre de
       * la relacion son distintivos ESTABLES; el numero depende del orden, asi que agregar
       * una tercera relacion renumeraria las columnas de una base que ya tiene datos. Por eso
       * el numero es el ultimo recurso y por eso se avisa cuando toca usarlo.
       */
      const distintivo = extremo.role
        ? nombres.nombreDeTabla(extremo.role)
        : arista.name
          ? nombres.nombreDeTabla(arista.name)
          : String(orden + 1);

      if (!esBucle) return `${entidad.tabla}_${distintivo}_id`;

      return `${entidad.tabla}_${lado}_${distintivo}_id`;
    };

    const columnaOrigen = columna(extremoOrigen, origen, 'origen');
    const columnaDestino = columna(extremoDestino, destino, 'destino');

    if (muchosOrigen && muchosDestino) {
      // Muchos a muchos: la propietaria es la de origen, que lleva la @JoinTable.
      if (haciaDestino) {
        origen.relaciones.push({
          campo: campoDestino,
          destino,
          tipo: 'ManyToMany',
          propietaria: true,
          tablaUnion: `${origen.tabla}_${destino.tabla}`,
          columnaUnion: columnaOrigen,
          columnaInversa: columnaDestino,
          cascade,
          orphanRemoval: false,
        });
      }
      if (haciaOrigen) {
        destino.relaciones.push({
          campo: campoOrigen,
          destino: origen,
          tipo: 'ManyToMany',
          propietaria: false,
          mappedBy: campoDestino,
          cascade: null,
          orphanRemoval: false,
        });
      }
      continue;
    }

    if (muchosDestino) {
      // Uno a muchos: la FK vive en el destino, que es quien lleva el @ManyToOne.
      if (haciaDestino) {
        origen.relaciones.push({
          campo: campoDestino,
          destino,
          tipo: 'OneToMany',
          propietaria: false,
          mappedBy: campoOrigen,
          cascade,
          orphanRemoval,
        });
      }
      destino.relaciones.push({
        campo: campoOrigen,
        destino: origen,
        tipo: 'ManyToOne',
        propietaria: true,
        columnaUnion: columnaOrigen,
        obligatorio: esObligatorio(multOrigen),
        cascade: null,
        orphanRemoval: false,
        // Sin este lado no hay clave foranea, asi que se genera aunque no sea navegable;
        // lo que se omite entonces es solo el lado de la coleccion.
        oculto: !haciaOrigen,
      });
      continue;
    }

    if (muchosOrigen) {
      if (haciaOrigen) {
        destino.relaciones.push({
          campo: campoOrigen,
          destino: origen,
          tipo: 'OneToMany',
          propietaria: false,
          mappedBy: campoDestino,
          cascade,
          orphanRemoval,
        });
      }
      origen.relaciones.push({
        campo: campoDestino,
        destino,
        tipo: 'ManyToOne',
        propietaria: true,
        columnaUnion: columnaDestino,
        obligatorio: esObligatorio(multDestino),
        cascade: null,
        orphanRemoval: false,
        oculto: !haciaDestino,
      });
      continue;
    }

    // Uno a uno: la propietaria es la de origen.
    if (haciaDestino) {
      origen.relaciones.push({
        campo: campoDestino,
        destino,
        tipo: 'OneToOne',
        propietaria: true,
        columnaUnion: columnaDestino,
        obligatorio: esObligatorio(multDestino),
        cascade,
        orphanRemoval,
      });
    }
    if (haciaOrigen) {
      destino.relaciones.push({
        campo: campoOrigen,
        destino: origen,
        tipo: 'OneToOne',
        propietaria: false,
        mappedBy: campoDestino,
        cascade: null,
        orphanRemoval: false,
      });
    }
  }

  // --- Paso 5: la clase de asociacion cuelga de su relacion ---
  for (const nodo of nodos) {
    if (nodo.kind !== 'association-class' || !nodo.associationId) continue;

    const plan = porId.get(nodo.id);
    const arista = (documento.edges || {})[nodo.associationId];
    if (!arista) {
      plan.avisos.push('Es una clase de asociación sin relación: se genera como entidad suelta.');
      continue;
    }

    const extremoA = porId.get(arista.source);
    const extremoB = porId.get(arista.target);
    if (!extremoA || !extremoB) continue;

    // Es la tabla intermedia con datos propios: dos @ManyToOne y sus atributos.
    //
    // Si los dos extremos son la MISMA clase (una amistad entre personas, por ejemplo) los
    // dos campos y las dos columnas saldrian iguales. Se separan por el lado de la arista.
    const esBucle = extremoA === extremoB;

    const campoA = esBucle ? `${extremoA.campo}Origen` : extremoA.campo;
    const campoB = esBucle ? `${extremoB.campo}Destino` : extremoB.campo;

    const columnaA = esBucle ? `${extremoA.tabla}_origen_id` : `${extremoA.tabla}_id`;
    const columnaB = esBucle ? `${extremoB.tabla}_destino_id` : `${extremoB.tabla}_id`;

    plan.relaciones.unshift(
      {
        campo: campoA,
        destino: extremoA,
        tipo: 'ManyToOne',
        propietaria: true,
        columnaUnion: columnaA,
        obligatorio: true,
        cascade: null,
        orphanRemoval: false,
      },
      {
        campo: campoB,
        destino: extremoB,
        tipo: 'ManyToOne',
        propietaria: true,
        columnaUnion: columnaB,
        obligatorio: true,
        cascade: null,
        orphanRemoval: false,
      },
    );

    /**
     * Y los dos extremos reciben su coleccion de ESTA entidad, no una @ManyToMany entre
     * ellos: la tabla de la clase de asociacion es la tabla de union. Es el patron que
     * recomienda Hibernate para un muchos-a-muchos con atributos propios.
     */
    const coleccion = nombres.plural(plan.clase).replace(/-/g, '_');

    extremoA.relaciones.push({
      campo: nombres.nombreDeCampo(esBucle ? `${coleccion}_como_${campoA}` : coleccion, plan.clase),
      destino: plan,
      tipo: 'OneToMany',
      propietaria: false,
      mappedBy: campoA,
      cascade: null,
      orphanRemoval: false,
    });

    extremoB.relaciones.push({
      // Con los dos extremos en la misma clase harian falta dos colecciones distintas.
      campo: nombres.nombreDeCampo(esBucle ? `${coleccion}_como_${campoB}` : coleccion, plan.clase),
      destino: plan,
      tipo: 'OneToMany',
      propietaria: false,
      mappedBy: campoB,
      cascade: null,
      orphanRemoval: false,
    });
  }

  const entidades = [...porId.values()].filter((p) => p.esEntidad);
  const interfaces = [...porId.values()].filter((p) => p.esInterfaz);

  /**
   * --- Paso 6: lo que se hereda ---
   *
   * La ENTIDAD no vuelve a declarar los campos del padre —los tiene por herencia— pero sus
   * DTO y su mapper SI los necesitan: sin esto, crear un Estudiante deja el `nombre` de
   * Persona a null y la base rechaza la fila por NOT NULL. Es un fallo que solo aparece al
   * ejecutar, nunca al compilar.
   */
  for (const entidad of entidades) {
    const cadena = [];
    const vistos = new Set([entidad.id]);
    let actual = entidad.padre;

    while (actual && !vistos.has(actual.id)) {
      vistos.add(actual.id);
      cadena.unshift(actual);
      actual = actual.padre;
    }

    // Primero los del padre, como en la propia jerarquia.
    entidad.atributosTodos = [...cadena.flatMap((a) => a.atributos), ...entidad.atributos];
    entidad.relacionesTodas = [...cadena.flatMap((a) => a.relaciones), ...entidad.relaciones];
  }

  /**
   * --- Paso 7: la clave primaria ---
   *
   * No se impone ninguna. Cada entidad la declara marcando una propiedad con {id}; si no
   * hay ninguna marcada, la exportacion se detiene y lo dice. Inventar un `Long id` es
   * comodo y es justo lo que hace que el modelo generado deje de parecerse al diagrama.
   *
   * La excepcion es la clase de asociacion: su identidad ES la combinacion de las claves
   * de sus dos extremos, que ya viajan como claves foraneas (@EmbeddedId + @MapsId).
   */
  for (const entidad of entidades) {
    // Una subclase comparte la identidad de su raiz.
    if (entidad.padre) continue;

    const marcados = entidad.atributos.filter((a) => a.esId);

    if (entidad.kindUml === 'association-class') {
      entidad.claveCompuesta = true;
      if (marcados.length > 0) {
        entidad.avisos.push(
          'Su identidad es la de sus dos extremos; el {id} marcado en un atributo se ignora.',
        );
      }
      continue;
    }

    if (marcados.length === 1) {
      entidad.clave = marcados[0];
      // Una clave asignada no puede llegar nula: Hibernate lanzaria
      // IdentifierGenerationException al persistir. Va en el request del alta, pero NO se
      // puede modificar despues: cambiar la identidad de una fila no es una actualizacion.
      entidad.clave.obligatorio = true;
      continue;
    }

    if (marcados.length > 1) {
      entidad.errorClave = `tiene ${marcados.length} atributos marcados con {id}; una clave compuesta propia todavía no se soporta.`;
      continue;
    }

    entidad.errorClave = 'no tiene ningún atributo marcado con {id}.';
  }

  // La subclase hereda la clave de su raiz, para que el repositorio sepa su tipo.
  for (const entidad of entidades) {
    let raiz = entidad;
    const vistos = new Set([entidad.id]);

    while (raiz.padre && !vistos.has(raiz.padre.id)) {
      vistos.add(raiz.padre.id);
      raiz = raiz.padre;
    }

    if (raiz !== entidad) {
      entidad.clave = raiz.clave;
      entidad.claveCompuesta = raiz.claveCompuesta;
      entidad.errorClave = raiz.errorClave ? `su raíz "${raiz.clase}" ${raiz.errorClave}` : null;
    }
  }

  const faltantes = entidades
    .filter((e) => e.errorClave)
    .map((e) => `${e.clase} ${e.errorClave}`);

  return {
    nombreModelo: (documento.meta && documento.meta.name) || 'Modelo',
    faltanClaves: faltantes,
    entidades,
    interfaces,
    conCrud: entidades.filter((e) => e.generaCrud),
    avisos: [...porId.values()].flatMap((p) => p.avisos.map((a) => `${p.clase}: ${a}`)),
  };
}

module.exports = { construirPlan, leerMultiplicidad, esMuchos, esObligatorio };
