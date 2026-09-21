package com.diagramador.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Punto de entrada. El escaneo de componentes arranca en este paquete, así que todo lo que
 * el exportador escriba bajo `com.diagramador.backend.*` queda registrado sin tocar nada aquí.
 */
@SpringBootApplication
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendApplication.class, args);
    }
}
