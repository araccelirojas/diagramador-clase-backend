package com.diagramador.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * PLANTILLA — entidad de ejemplo. Borrable: no es parte de ningún dominio.
 *
 * Por cada clase del diagrama, el exportador escribe una entidad exactamente con esta forma,
 * sustituyendo el nombre y la lista de campos.
 *
 * Nota deliberada: @Getter/@Setter y no @Data. @Data genera equals/hashCode sobre todos los
 * campos, y en una entidad JPA eso rompe en cuanto hay colecciones perezosas o el id se asigna
 * al persistir.
 */
@Entity
@Table(name = "ejemplo")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class Ejemplo {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String nombre;

    @Column(length = 500)
    private String descripcion;

    @Column(nullable = false)
    private Boolean activo;

    /** Se rellena al crear y no se vuelve a tocar: de ahí updatable = false. */
    @Column(name = "creado_en", nullable = false, updatable = false)
    private LocalDateTime creadoEn;
}
