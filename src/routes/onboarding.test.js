const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const service = require('../services/auth.service');
const jwt = require('../utils/jwt');

test('PATCH onboarding exige sesión y toma solo la identidad del token', async (t) => {
  const calls = [];
  t.mock.method(service, 'completarOnboarding', async (idUsuario) => {
    calls.push(idUsuario);
    return { idUsuario, onboardingCompletado: true };
  });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('./auth.routes'));
  app.use(require('../middlewares/errorHandler'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/auth/onboarding`;

  assert.equal((await fetch(url, { method: 'PATCH' })).status, 401);
  assert.equal((await fetch(url, { method: 'PATCH', headers: { Authorization: 'Bearer invalido' } })).status, 401);
  assert.deepEqual(calls, []);

  const token = jwt.sign({ idUsuario: 'mi-cuenta', correo: 'mi-cuenta@example.test' });
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ idUsuario: 'otra-cuenta', onboardingCompletado: false }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { idUsuario: 'mi-cuenta', onboardingCompletado: true });
  assert.deepEqual(calls, ['mi-cuenta']);
});
