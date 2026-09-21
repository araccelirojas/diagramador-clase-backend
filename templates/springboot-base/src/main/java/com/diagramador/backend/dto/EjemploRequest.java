package com.diagramador.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * PLANTILLA — lo que entra por POST y PUT. No incluye `id` ni campos calculados: el id viaja
 * en la ruta y los derivados los pone el servidor.
 *
 * Las anotaciones de validación salen del UML: multiplicidad "1" en un atributo -> @NotNull
 * (o @NotBlank si es String).
 */
public record EjemploRequest(

        @NotBlank(message = "el nombre es obligatorio")
        @Size(max = 120, message = "el nombre no puede superar los 120 caracteres")
        String nombre,

        @Size(max = 500, message = "la descripción no puede superar los 500 caracteres")
        String descripcion,

        @NotNull(message = "activo es obligatorio")
        Boolean activo
) {
}
