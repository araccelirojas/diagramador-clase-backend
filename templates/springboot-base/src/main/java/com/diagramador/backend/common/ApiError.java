package com.diagramador.backend.common;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Forma única del error que devuelve la API. Un record: es inmutable y Jackson lo serializa
 * sin ayuda. `fields` solo viaja cuando hubo errores de validación (si es null, no aparece).
 */
public record ApiError(
        LocalDateTime timestamp,
        int status,
        String message,
        String path,
        Map<String, String> fields
) {
    public static ApiError of(int status, String message, String path) {
        return new ApiError(LocalDateTime.now(), status, message, path, null);
    }

    public static ApiError of(int status, String message, String path, Map<String, String> fields) {
        return new ApiError(LocalDateTime.now(), status, message, path, fields);
    }
}
