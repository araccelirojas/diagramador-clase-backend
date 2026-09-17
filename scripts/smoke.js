/**
 * Prueba de humo del flujo completo contra un servidor ya levantado.
 * Uso: npm run dev (en otra terminal) y luego npm run smoke
 */
const BASE = process.env.SMOKE_URL || 'http://localhost:3000/api';

let fallos = 0;

async function req(metodo, ruta, { token, body } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const texto = await res.text();
  return { status: res.status, data: texto ? JSON.parse(texto) : null };
}

function check(nombre, condicion, detalle = '') {
  if (condicion) {
    console.log(`  OK   ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  FALLA ${nombre} ${detalle}`);
  }
}

async function main() {
  const sufijo = Date.now();
  const ana = { nombre: 'Ana', correo: `ana${sufijo}@test.com`, password: 'secreta123' };
  const beto = { nombre: 'Beto', correo: `beto${sufijo}@test.com`, password: 'secreta123' };

  console.log('\nAutenticacion');
  const rA = await req('POST', '/auth/registro', { body: ana });
  check('registro de Ana', rA.status === 201 && rA.data.token, JSON.stringify(rA.data));
  check('la respuesta no expone la password', rA.data?.usuario?.password === undefined);

  const rB = await req('POST', '/auth/registro', { body: beto });
  check('registro de Beto', rB.status === 201);

  const dup = await req('POST', '/auth/registro', { body: ana });
  check('correo duplicado -> 409', dup.status === 409, JSON.stringify(dup.data));

  const mal = await req('POST', '/auth/login', { body: { correo: ana.correo, password: 'incorrecta' } });
  check('password incorrecta -> 401', mal.status === 401);

  const login = await req('POST', '/auth/login', { body: { correo: ana.correo, password: ana.password } });
  check('login correcto', login.status === 200 && !!login.data.token);

  const tokenAna = login.data.token;
  const tokenBeto = rB.data.token;

  const perfil = await req('GET', '/auth/perfil', { token: tokenAna });
  check('perfil con token', perfil.status === 200 && perfil.data.correo === ana.correo);

  console.log('\nProyectos y diagrama');
  const diagrama = {
    nodos: [{ id: 'n1', tipo: 'clase', nombre: 'Usuario', x: 10, y: 20 }],
    relaciones: [{ desde: 'n1', hasta: 'n1', tipo: 'asociacion' }],
  };

  const cre = await req('POST', '/proyectos', { token: tokenAna, body: { nombre: 'Mi diagrama', contenido: diagrama } });
  check('crear proyecto', cre.status === 201, JSON.stringify(cre.data));
  const idProyecto = cre.data?.idProyecto;

  const guardado = await req('PUT', `/proyectos/${idProyecto}/contenido`, {
    token: tokenAna,
    body: { contenido: { ...diagrama, version: 2 } },
  });
  check('guardar contenido', guardado.status === 200 && guardado.data.contenido.version === 2);

  const cargado = await req('GET', `/proyectos/${idProyecto}/contenido`, { token: tokenAna });
  check('cargar contenido', cargado.status === 200 && cargado.data.contenido.nodos[0].nombre === 'Usuario');

  const ajeno = await req('GET', `/proyectos/${idProyecto}`, { token: tokenBeto });
  check('Beto no accede al proyecto de Ana -> 403', ajeno.status === 403, JSON.stringify(ajeno.data));

  console.log('\nInvitaciones');
  const inv = await req('POST', '/invitaciones', { token: tokenAna, body: { idProyecto, correo: beto.correo } });
  check('Ana invita a Beto', inv.status === 201, JSON.stringify(inv.data));
  const idInvitacion = inv.data?.idInvitacion;

  const repetida = await req('POST', '/invitaciones', { token: tokenAna, body: { idProyecto, correo: beto.correo } });
  check('invitacion repetida -> 409', repetida.status === 409);

  const ajena = await req('PATCH', `/invitaciones/${idInvitacion}`, { token: tokenAna, body: { estado: 'ACEPTADA' } });
  check('Ana no puede responder por Beto -> 403', ajena.status === 403);

  const acepta = await req('PATCH', `/invitaciones/${idInvitacion}`, { token: tokenBeto, body: { estado: 'ACEPTADA' } });
  check('Beto acepta', acepta.status === 200 && acepta.data.estado === 'ACEPTADA');

  const ahoraSi = await req('GET', `/proyectos/${idProyecto}`, { token: tokenBeto });
  check('Beto ya accede tras aceptar', ahoraSi.status === 200);

  const borraBeto = await req('DELETE', `/proyectos/${idProyecto}`, { token: tokenBeto });
  check('Beto no puede borrar el proyecto -> 403', borraBeto.status === 403);

  console.log('\nLimpieza');
  check('Ana borra el proyecto', (await req('DELETE', `/proyectos/${idProyecto}`, { token: tokenAna })).status === 204);
  check('Ana borra su cuenta', (await req('DELETE', `/usuarios/${rA.data.usuario.idUsuario}`, { token: tokenAna })).status === 204);
  check('Beto borra su cuenta', (await req('DELETE', `/usuarios/${rB.data.usuario.idUsuario}`, { token: tokenBeto })).status === 204);

  console.log(fallos === 0 ? '\nTodo correcto.\n' : `\n${fallos} comprobacion(es) fallaron.\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nError ejecutando la prueba:', e.message);
  console.error('Asegurate de que el servidor esta levantado (npm run dev).\n');
  process.exit(1);
});
