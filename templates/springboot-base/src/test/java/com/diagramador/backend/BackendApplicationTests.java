package com.diagramador.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Comprueba que el contexto arranca con el perfil por defecto. Es la red de seguridad del
 * exportador: si el código generado tiene un bean mal formado o una entidad que Hibernate no
 * puede mapear, este test lo caza en `./mvnw test`, antes de intentar levantar nada.
 */
@SpringBootTest
class BackendApplicationTests {

    @Test
    void contextLoads() {
    }
}
