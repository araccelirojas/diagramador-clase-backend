package com.diagramador.backend.common;

/**
 * La lanza el service cuando un id no existe. GlobalExceptionHandler la traduce a 404.
 * Cada service generado la usa igual: `throw new NotFoundException("Ejemplo", id)`.
 */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }

    public NotFoundException(String entidad, Object id) {
        super(entidad + " no encontrado con id " + id);
    }
}
