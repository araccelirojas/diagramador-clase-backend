const test = require('node:test');
const assert = require('node:assert/strict');
const { completarOnboarding } = require('./auth.service');

test('completar/omitir persiste true y repetir no vuelve a escribir ni restablece false', async () => {
  let stored = { idUsuario: 'propietario', estado: true, onboardingCompletado: false };
  const writes = [];
  const repository = {
    findById: async (id) => id === stored.idUsuario ? { ...stored } : null,
    update: async (id, data) => {
      writes.push({ id, data });
      stored = { ...stored, ...data };
      return { ...stored };
    },
  };

  assert.equal((await completarOnboarding('propietario', repository)).onboardingCompletado, true);
  assert.equal((await repository.findById('propietario')).onboardingCompletado, true);
  assert.equal((await completarOnboarding('propietario', repository)).onboardingCompletado, true);
  assert.deepEqual(writes, [{ id: 'propietario', data: { onboardingCompletado: true } }]);
  await assert.rejects(completarOnboarding('otra-cuenta', repository), { statusCode: 404 });
});

test('una cuenta desactivada no puede completar su onboarding', async () => {
  let wrote = false;
  const repository = {
    findById: async () => ({ estado: false, onboardingCompletado: false }),
    update: async () => { wrote = true; },
  };
  await assert.rejects(completarOnboarding('inactivo', repository), { statusCode: 403 });
  assert.equal(wrote, false);
});
