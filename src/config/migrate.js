const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const RAIZ = path.join(__dirname, '..', '..');
const MIGRACIONES = path.join(RAIZ, 'prisma', 'migrations');

// Ejecutamos el CLI con el mismo Node del proceso, sin depender de npx ni de
// la resolucion de .cmd/.ps1 en Windows.
const CLI = path.join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');

function hayMigraciones() {
  if (!fs.existsSync(MIGRACIONES)) return false;
  return fs.readdirSync(MIGRACIONES).some((entrada) =>
    fs.statSync(path.join(MIGRACIONES, entrada)).isDirectory());
}

/**
 * Aplica las migraciones pendientes al arrancar (`prisma migrate deploy`).
 * Si la base ya esta al dia no hace nada. No genera migraciones nuevas:
 * eso se hace en desarrollo con `npm run db:migrate`.
 */
function aplicarMigracionesPendientes() {
  if (!fs.existsSync(CLI)) {
    console.warn('Prisma CLI no encontrado: se omite la migracion automatica.');
    return Promise.resolve();
  }

  if (!hayMigraciones()) {
    console.warn('No hay migraciones todavia. Ejecuta: npm run db:migrate');
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const hijo = spawn(process.execPath, [CLI, 'migrate', 'deploy'], {
      cwd: RAIZ,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let salida = '';
    hijo.stdout.on('data', (d) => { salida += d; });
    hijo.stderr.on('data', (d) => { salida += d; });

    hijo.on('error', reject);
    hijo.on('close', (codigo) => {
      if (codigo !== 0) {
        return reject(new Error(`prisma migrate deploy fallo:\n${salida.trim()}`));
      }

      const sinCambios = /No pending migrations/i.test(salida);
      const aplicadas = salida.match(/(\d+) migrations? (?:have been |was )?applied/i);

      if (sinCambios) console.log('Migraciones: la base de datos ya esta al dia');
      else if (aplicadas) console.log(`Migraciones: ${aplicadas[1]} aplicada(s)`);
      else console.log('Migraciones: verificadas');

      resolve();
    });
  });
}

module.exports = { aplicarMigracionesPendientes };
