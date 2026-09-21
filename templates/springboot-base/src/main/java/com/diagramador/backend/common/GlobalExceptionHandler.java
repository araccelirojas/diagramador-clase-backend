package com.diagramador.backend.common;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.ErrorResponseException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Traduce excepciones a ApiError. Al estar centralizado, ningún controlador generado necesita
 * try/catch: el exportador escribe controladores limpios y los errores salen todos iguales.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 404: el id pedido no existe. */
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(NotFoundException ex, HttpServletRequest req) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiError.of(404, ex.getMessage(), req.getRequestURI()));
    }

    /** 400: falló @Valid sobre un @RequestBody. Devuelve campo -> motivo. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> handleValidation(MethodArgumentNotValidException ex,
                                                     HttpServletRequest req) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
                .forEach(fe -> fields.putIfAbsent(fe.getField(), fe.getDefaultMessage()));
        return ResponseEntity.badRequest()
                .body(ApiError.of(400, "Error de validación", req.getRequestURI(), fields));
    }

    /** 400: falló una restricción sobre parámetros (@Validated en el controlador). */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiError> handleConstraint(ConstraintViolationException ex,
                                                     HttpServletRequest req) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getConstraintViolations()
                .forEach(v -> fields.putIfAbsent(v.getPropertyPath().toString(), v.getMessage()));
        return ResponseEntity.badRequest()
                .body(ApiError.of(400, "Error de validación", req.getRequestURI(), fields));
    }

    /** 400: el cuerpo no es JSON válido o no encaja con el DTO. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> handleUnreadable(HttpMessageNotReadableException ex,
                                                     HttpServletRequest req) {
        return ResponseEntity.badRequest()
                .body(ApiError.of(400, "Cuerpo de la petición ilegible o mal formado",
                        req.getRequestURI()));
    }

    /** 400: /api/ejemplos/abc cuando se espera un Long. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiError> handleTypeMismatch(MethodArgumentTypeMismatchException ex,
                                                       HttpServletRequest req) {
        return ResponseEntity.badRequest()
                .body(ApiError.of(400, "Valor inválido para el parámetro '" + ex.getName() + "'",
                        req.getRequestURI()));
    }

    /** 409: unicidad, clave foránea, no-nulo a nivel de base de datos. */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiError> handleIntegrity(DataIntegrityViolationException ex,
                                                    HttpServletRequest req) {
        log.warn("Violación de integridad en {}: {}", req.getRequestURI(), ex.getMostSpecificCause().getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of(409, "La operación viola una restricción de integridad",
                        req.getRequestURI()));
    }

    /**
     * 404: la ruta no existe. Hay que declararlo: el handler de Exception de más abajo se
     * traga todo lo que no tenga un @ExceptionHandler más específico, así que sin esto una
     * URL mal escrita saldría como 500.
     */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiError> handleNoResource(NoResourceFoundException ex,
                                                     HttpServletRequest req) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiError.of(404, "Ruta no encontrada", req.getRequestURI()));
    }

    /** 405: la ruta existe pero no con ese verbo. */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiError> handleMethodNotSupported(HttpRequestMethodNotSupportedException ex,
                                                             HttpServletRequest req) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED)
                .body(ApiError.of(405, "Método " + ex.getMethod() + " no permitido en esta ruta",
                        req.getRequestURI()));
    }

    /** 415: falta el Content-Type application/json o es otro. */
    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ApiError> handleMediaType(HttpMediaTypeNotSupportedException ex,
                                                    HttpServletRequest req) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE)
                .body(ApiError.of(415, "Tipo de contenido no soportado", req.getRequestURI()));
    }

    /** Respeta el estado de las excepciones que ya traen uno propio. */
    @ExceptionHandler({ResponseStatusException.class, ErrorResponseException.class})
    public ResponseEntity<ApiError> handleWithStatus(ErrorResponseException ex,
                                                     HttpServletRequest req) {
        int status = ex.getStatusCode().value();
        return ResponseEntity.status(status)
                .body(ApiError.of(status, ex.getBody().getDetail(), req.getRequestURI()));
    }

    /** 500: cualquier otra cosa. Se registra completa, pero no se filtra al cliente. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> handleOther(Exception ex, HttpServletRequest req) {
        log.error("Error no controlado en {}", req.getRequestURI(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiError.of(500, "Error interno del servidor", req.getRequestURI()));
    }
}
