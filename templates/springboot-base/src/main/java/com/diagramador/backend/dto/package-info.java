/**
 * DTOs de entrada y salida. ← EL EXPORTADOR ESCRIBE AQUÍ
 *
 * <p>Dos {@code record} por entidad:
 * <ul>
 *   <li>{@code XxxRequest} — lo que se acepta. Sin {@code id} y sin campos que ponga el
 *       servidor. Lleva las anotaciones de validación derivadas del UML.</li>
 *   <li>{@code XxxResponse} — lo que se devuelve. Con {@code id} y campos calculados.</li>
 * </ul>
 *
 * <p>Las relaciones no viajan como objetos anidados: un {@code @ManyToOne} a {@code Carrera}
 * se representa como {@code Long carreraId} en el request y en el response. Así se evita
 * arrastrar el grafo entero y los ciclos al serializar.
 *
 * <p>Plantilla a imitar: {@link com.diagramador.backend.dto.EjemploRequest} y
 * {@link com.diagramador.backend.dto.EjemploResponse}.
 */
package com.diagramador.backend.dto;
