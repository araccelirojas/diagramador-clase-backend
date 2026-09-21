// Fijado a archiver 7 a proposito: la 8 dejo de exportar la fabrica `archiver('zip')` y su
// clase `Archiver` no acepta el formato en el constructor.
const archiver = require('archiver');

const { construirProyecto, artefactoDe } = require('./proyecto');
const nombres = require('./naming');

/**
 * Exportar un diagrama como proyecto Spring Boot listo para arrancar.
 *
 * El zip se arma en streaming contra la respuesta HTTP: un proyecto generado ronda los
 * cientos de kilobytes, y no hay motivo para tenerlo entero en memoria dos veces.
 */

/** Nombre de fichero seguro para la cabecera Content-Disposition. */
function nombreDeArchivo(nombreModelo) {
  const base = nombres.snake(nombreModelo).replace(/_/g, '-') || 'backend';
  return `${base}-backend.zip`;
}

/**
 * Escribe el zip del proyecto en `salida` (normalmente el `res` de Express).
 * Devuelve el plan, para que quien llama pueda registrar que se exporto.
 */
async function exportarComoZip(documento, salida) {
  const { plan, ficheros, artefacto } = await construirProyecto(documento);

  const zip = archiver('zip', { zlib: { level: 9 } });

  // Un fallo a mitad del stream no se puede convertir en un 500: las cabeceras ya salieron.
  // Lo unico honesto es cortar la conexion para que el cliente vea un zip truncado.
  zip.on('error', () => salida.destroy());

  zip.pipe(salida);

  for (const fichero of ficheros) {
    zip.append(fichero.contenido, {
      // Todo cuelga de una carpeta con el nombre del proyecto: descomprimir no ensucia
      // el directorio de destino.
      name: `${artefacto}/${fichero.ruta}`,
      mode: fichero.ejecutable ? 0o755 : 0o644,
    });
  }

  await zip.finalize();

  return plan;
}

module.exports = { exportarComoZip, nombreDeArchivo, construirProyecto, artefactoDe };
