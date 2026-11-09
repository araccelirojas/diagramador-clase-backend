const { construirPlan } = require('../export/plan');

/**
 * Lo que la IA sabe del exportador para ESTE diagrama (CU-02): que se generaria, que no y
 * por que, y que impide exportar. Sale del mismo `construirPlan` que usa la exportacion
 * real, asi que la IA no puede contar una version distinta de la que despues baja en el zip.
 */

const MAX_AVISOS = 15;

const lista = (items) => (items.length === 0 ? 'ninguna' : items.join(', '));

function resumirExportacion(contenido) {
  if (!contenido || typeof contenido !== 'object') return null;

  let plan;
  try {
    plan = construirPlan(contenido);
  } catch {
    return 'No se pudo analizar el diagrama con el exportador.';
  }

  const sinCrud = plan.entidades.filter((e) => !e.generaCrud).map((e) => `${e.clase} (abstracta)`);

  const lineas = [
    'Genera un proyecto Spring Boot con entidad JPA, DTOs, mapper, repositorio, servicio y controlador REST con CRUD por cada clase concreta y cada clase de asociación. Las relaciones se vuelven campos JPA, no endpoints. Cada clase necesita una propiedad marcada {id} como clave; si falta, la exportación se detiene.',
    `Con CRUD: ${lista(plan.conCrud.map((e) => `${e.clase} (/api/${e.ruta})`))}.`,
    `Sin CRUD: ${lista([...sinCrud, ...plan.interfaces.map((i) => `${i.clase} (interfaz)`)])}.`,
  ];

  lineas.push(
    plan.faltanClaves.length > 0
      ? `LA EXPORTACIÓN ESTÁ BLOQUEADA, faltan claves: ${plan.faltanClaves.join('; ')}.`
      : 'Se puede exportar: todas las entidades tienen clave.',
  );

  if (plan.avisos.length > 0) {
    lineas.push(`Avisos: ${plan.avisos.slice(0, MAX_AVISOS).join(' | ')}`);
  }

  return lineas.join('\n');
}

module.exports = { resumirExportacion };
