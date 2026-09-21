package com.diagramador.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Recorre el CRUD completo de la rebanada de ejemplo contra H2. Si el exportador cambia la
 * plantilla, este test dice si el contrato que promete el README sigue siendo cierto.
 */
@SpringBootTest
@AutoConfigureMockMvc
class EjemploCrudTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper json;

    private String cuerpo(String nombre, String descripcion, boolean activo) throws Exception {
        return json.writeValueAsString(Map.of(
                "nombre", nombre,
                "descripcion", descripcion,
                "activo", activo));
    }

    @Test
    void crudCompleto() throws Exception {
        // POST -> 201 con cabecera Location
        String creado = mockMvc.perform(post("/api/ejemplos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo("Primero", "creado por el test", true)))
                .andExpect(status().isCreated())
                .andExpect(header().exists("Location"))
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.nombre").value("Primero"))
                .andExpect(jsonPath("$.creadoEn").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        long id = json.readTree(creado).get("id").asLong();

        // GET /{id}
        mockMvc.perform(get("/api/ejemplos/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nombre").value("Primero"));

        // GET lista
        mockMvc.perform(get("/api/ejemplos"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());

        // PUT
        mockMvc.perform(put("/api/ejemplos/{id}", id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo("Renombrado", "actualizado", false)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nombre").value("Renombrado"))
                .andExpect(jsonPath("$.activo").value(false));

        // DELETE -> 204, y después 404
        mockMvc.perform(delete("/api/ejemplos/{id}", id))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/ejemplos/{id}", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.path").value("/api/ejemplos/" + id));
    }

    @Test
    void idInexistenteDevuelve404ConLaFormaDeApiError() throws Exception {
        mockMvc.perform(get("/api/ejemplos/{id}", 999999))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.timestamp").isNotEmpty())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.message").isNotEmpty())
                .andExpect(jsonPath("$.path").value("/api/ejemplos/999999"));
    }

    @Test
    void cuerpoInvalidoDevuelve400ConElCampoQueFalla() throws Exception {
        mockMvc.perform(post("/api/ejemplos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nombre\":\"  \",\"activo\":null}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.fields.nombre").isNotEmpty())
                .andExpect(jsonPath("$.fields.activo").isNotEmpty());
    }

    @Test
    void rutaInexistenteDevuelve404YNo500() throws Exception {
        mockMvc.perform(get("/api/no-existe"))
                .andExpect(status().isNotFound());
    }
}
