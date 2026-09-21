/**
 * Conversión entidad ↔ DTO. ← EL EXPORTADOR ESCRIBE AQUÍ
 *
 * <p>Un {@code @Component XxxMapper} por entidad, con cuatro métodos siempre iguales:
 * {@code toEntity(XxxRequest)}, {@code updateEntity(Xxx, XxxRequest)},
 * {@code toResponse(Xxx)} y {@code toResponseList(List<Xxx>)}.
 *
 * <p>A mano, campo por campo. Nada de MapStruct ni reflexión: el mapeo es exactamente la
 * lista de atributos del diagrama, y conviene poder leerla.
 *
 * <p>Cuando la entidad tiene un {@code @ManyToOne}, el mapper recibe además el repositorio
 * del otro lado para resolver el id en una referencia.
 *
 * <p>Plantilla a imitar: {@link com.diagramador.backend.mapper.EjemploMapper}.
 */
package com.diagramador.backend.mapper;
