/**
 * Entidades JPA. ← EL EXPORTADOR ESCRIBE AQUÍ
 *
 * <p>Una clase por cada nodo {@code kind: "class"} del diagrama. Los nodos
 * {@code kind: "interface"} NO son entidades: van como interfaces Java sin {@code @Entity}.
 * Un nodo {@code kind: "association-class"} sí es una entidad propia, con su tabla y dos
 * {@code @ManyToOne} a los extremos de la asociación.
 *
 * <p>Convención: nombre de la clase tal cual viene del diagrama, en singular y PascalCase
 * ({@code Estudiante}); tabla en snake_case y singular ({@code @Table(name = "estudiante")}).
 *
 * <p>Toda entidad lleva {@code Long id} con
 * {@code @GeneratedValue(strategy = GenerationType.IDENTITY)}, aunque el diagrama declare su
 * propio atributo {@code id}.
 *
 * <p>Plantilla a imitar: {@link com.diagramador.backend.model.Ejemplo}.
 * La correspondencia completa UML → JPA está en {@code docs/MAPEO-UML-JPA.md}.
 */
package com.diagramador.backend.model;
