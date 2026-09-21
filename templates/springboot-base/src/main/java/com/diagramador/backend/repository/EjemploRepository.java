package com.diagramador.backend.repository;

import com.diagramador.backend.model.Ejemplo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * PLANTILLA — repositorio. Una interfaz vacía: JpaRepository ya trae findAll, findById, save
 * y deleteById, que es todo lo que consume el CRUD generado.
 *
 * El segundo parámetro es siempre Long, porque toda entidad generada lleva
 * `Long id` con @GeneratedValue(IDENTITY).
 */
@Repository
public interface EjemploRepository extends JpaRepository<Ejemplo, Long> {
}
