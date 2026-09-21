package com.diagramador.backend.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Metadatos de la documentación OpenAPI. springdoc descubre solo los controladores, así que
 * los endpoints que el exportador genere aparecen en /swagger-ui.html sin tocar esta clase.
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI apiInfo() {
        return new OpenAPI().info(new Info()
                .title("Diagramador — API generada")
                .version("0.0.1")
                .description("Backend generado a partir de un diagrama UML de clases."));
    }
}
