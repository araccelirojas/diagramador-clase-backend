/**
 * Lógica de negocio. ← EL EXPORTADOR ESCRIBE AQUÍ
 *
 * <p>Un {@code @Service XxxService} por entidad, con cinco métodos:
 * {@code listar()}, {@code obtenerPorId(Long)}, {@code crear(XxxRequest)},
 * {@code actualizar(Long, XxxRequest)} y {@code eliminar(Long)}.
 *
 * <p>Reglas fijas: recibe y devuelve DTOs, nunca entidades; inyección por constructor;
 * {@code @Transactional(readOnly = true)} en la clase y {@code @Transactional} en los
 * métodos que escriben; un id inexistente lanza
 * {@link com.diagramador.backend.common.NotFoundException}.
 *
 * <p>Plantilla a imitar: {@link com.diagramador.backend.service.EjemploService}.
 */
package com.diagramador.backend.service;
