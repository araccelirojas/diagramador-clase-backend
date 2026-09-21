/**
 * Controladores REST. ← EL EXPORTADOR ESCRIBE AQUÍ
 *
 * <p>Un {@code @RestController XxxController} por entidad, montado en
 * {@code /api/<nombre-en-plural-minúsculas>}, con el CRUD completo:
 * {@code GET /}, {@code GET /{id}}, {@code POST /}, {@code PUT /{id}}, {@code DELETE /{id}}.
 *
 * <p>Pluralización: {@code Estudiante → /api/estudiantes}, {@code Curso → /api/cursos}.
 * Si el nombre acaba en consonante distinta de «s» o «z», {@code -es}
 * ({@code Profesor → /api/profesores}); si acaba en «z», {@code -ces}
 * ({@code Lapiz → /api/lapices}).
 *
 * <p>Reglas fijas: solo llama al servicio, nunca al repositorio; {@code @Valid} en el cuerpo;
 * {@code POST} devuelve 201 con cabecera {@code Location}; {@code DELETE} devuelve 204;
 * sin {@code try/catch} (de los errores se encarga
 * {@link com.diagramador.backend.common.GlobalExceptionHandler}).
 *
 * <p>Plantilla a imitar: {@link com.diagramador.backend.controller.EjemploController}.
 */
package com.diagramador.backend.controller;
