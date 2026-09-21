package com.diagramador.backend.mapper;

import com.diagramador.backend.dto.EjemploRequest;
import com.diagramador.backend.dto.EjemploResponse;
import com.diagramador.backend.model.Ejemplo;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;

/**
 * PLANTILLA — conversión entidad <-> DTO, a mano y campo por campo.
 *
 * A mano y no con MapStruct ni reflexión: el exportador ya está generando texto, y un mapper
 * explícito es una lista de líneas `dto.campo()` que sale directa del diagrama. Una librería
 * de mapeo añadiría un paso de compilación más y escondería justo lo que hay que revisar.
 */
@Component
public class EjemploMapper {

    /** Request -> entidad nueva. El id lo pone la base de datos; creadoEn, el servidor. */
    public Ejemplo toEntity(EjemploRequest request) {
        Ejemplo entidad = new Ejemplo();
        entidad.setNombre(request.nombre());
        entidad.setDescripcion(request.descripcion());
        entidad.setActivo(request.activo());
        entidad.setCreadoEn(LocalDateTime.now());
        return entidad;
    }

    /** Request -> entidad existente. No toca id ni creadoEn: son inmutables tras el alta. */
    public void updateEntity(Ejemplo entidad, EjemploRequest request) {
        entidad.setNombre(request.nombre());
        entidad.setDescripcion(request.descripcion());
        entidad.setActivo(request.activo());
    }

    /** Entidad -> response. */
    public EjemploResponse toResponse(Ejemplo entidad) {
        return new EjemploResponse(
                entidad.getId(),
                entidad.getNombre(),
                entidad.getDescripcion(),
                entidad.getActivo(),
                entidad.getCreadoEn()
        );
    }

    public List<EjemploResponse> toResponseList(List<Ejemplo> entidades) {
        return entidades.stream().map(this::toResponse).toList();
    }
}
