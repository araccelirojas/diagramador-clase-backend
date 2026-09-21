package com.diagramador.backend.service;

import com.diagramador.backend.common.NotFoundException;
import com.diagramador.backend.dto.EjemploRequest;
import com.diagramador.backend.dto.EjemploResponse;
import com.diagramador.backend.mapper.EjemploMapper;
import com.diagramador.backend.model.Ejemplo;
import com.diagramador.backend.repository.EjemploRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * PLANTILLA — servicio. Es la única capa que ve entidades: recibe y devuelve DTOs siempre.
 *
 * Inyección por constructor y no por @Autowired en el campo: deja las dependencias en una
 * firma que el exportador escribe de una vez, y la clase sigue siendo instanciable en un test
 * sin levantar Spring.
 */
@Service
@Transactional(readOnly = true)
public class EjemploService {

    private final EjemploRepository repository;
    private final EjemploMapper mapper;

    public EjemploService(EjemploRepository repository, EjemploMapper mapper) {
        this.repository = repository;
        this.mapper = mapper;
    }

    public List<EjemploResponse> listar() {
        return mapper.toResponseList(repository.findAll());
    }

    public EjemploResponse obtenerPorId(Long id) {
        Ejemplo entidad = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Ejemplo", id));
        return mapper.toResponse(entidad);
    }

    @Transactional
    public EjemploResponse crear(EjemploRequest request) {
        Ejemplo entidad = mapper.toEntity(request);
        Ejemplo guardado = repository.save(entidad);
        return mapper.toResponse(guardado);
    }

    @Transactional
    public EjemploResponse actualizar(Long id, EjemploRequest request) {
        Ejemplo entidad = repository.findById(id)
                .orElseThrow(() -> new NotFoundException("Ejemplo", id));
        mapper.updateEntity(entidad, request);
        Ejemplo guardado = repository.save(entidad);
        return mapper.toResponse(guardado);
    }

    @Transactional
    public void eliminar(Long id) {
        if (!repository.existsById(id)) {
            throw new NotFoundException("Ejemplo", id);
        }
        repository.deleteById(id);
    }
}
