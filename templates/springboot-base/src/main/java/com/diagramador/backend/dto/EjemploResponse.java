package com.diagramador.backend.dto;

import java.time.LocalDateTime;

/**
 * PLANTILLA — lo que sale de la API. Incluye `id` y los campos que pone el servidor.
 * Es un tipo aparte del request a propósito: lo que se acepta y lo que se devuelve cambian
 * por motivos distintos, y unirlos obliga a inventar campos opcionales en cuanto divergen.
 */
public record EjemploResponse(
        Long id,
        String nombre,
        String descripcion,
        Boolean activo,
        LocalDateTime creadoEn
) {
}
