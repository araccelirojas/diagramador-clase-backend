package com.diagramador.backend.controller;

import com.diagramador.backend.dto.EjemploRequest;
import com.diagramador.backend.dto.EjemploResponse;
import com.diagramador.backend.service.EjemploService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.List;

/**
 * PLANTILLA — controlador REST. Solo habla con el servicio: no conoce el repositorio ni la
 * entidad, y no atrapa excepciones (de eso se encarga GlobalExceptionHandler).
 *
 * La ruta se deriva del nombre de la clase: Ejemplo -> /api/ejemplos (minúsculas y plural).
 */
@RestController
@RequestMapping("/api/ejemplos")
public class EjemploController {

    private final EjemploService service;

    public EjemploController(EjemploService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<EjemploResponse>> listar() {
        return ResponseEntity.ok(service.listar());
    }

    @GetMapping("/{id}")
    public ResponseEntity<EjemploResponse> obtenerPorId(@PathVariable Long id) {
        return ResponseEntity.ok(service.obtenerPorId(id));
    }

    @PostMapping
    public ResponseEntity<EjemploResponse> crear(@Valid @RequestBody EjemploRequest request,
                                                 UriComponentsBuilder uriBuilder) {
        EjemploResponse creado = service.crear(request);
        URI ubicacion = uriBuilder.path("/api/ejemplos/{id}").buildAndExpand(creado.id()).toUri();
        return ResponseEntity.created(ubicacion).body(creado);
    }

    @PutMapping("/{id}")
    public ResponseEntity<EjemploResponse> actualizar(@PathVariable Long id,
                                                      @Valid @RequestBody EjemploRequest request) {
        return ResponseEntity.ok(service.actualizar(id, request));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> eliminar(@PathVariable Long id) {
        service.eliminar(id);
        return ResponseEntity.noContent().build();
    }
}
