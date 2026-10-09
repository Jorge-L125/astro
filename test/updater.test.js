const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater } = require('../src/updater');

// Imita lo que necesitamos de electron-updater: eventos, checkForUpdates y quitAndInstall.
function fakeUpdater() {
  const u = new EventEmitter();
  u.checks = 0; u.installed = null;
  u.checkForUpdates = async () => { u.checks++; };
  u.quitAndInstall = (silent, runAfter) => { u.installed = { silent, runAfter }; };
  return u;
}
const setup = (over = {}) => {
  const updater = fakeUpdater(), sent = [], timers = [];
  const up = createUpdater({ updater, platform: 'win32', isPackaged: true, enabled: () => true,
    send: (ch, p) => sent.push([ch, p]), log: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms, every: false }); }, setInterval: (fn, ms) => { timers.push({ fn, ms, every: true }); },
    ...over });
  return { up, updater, sent, timers };
};

test('solo funciona en Windows con la app instalada', () => {
  assert.equal(setup().up.active, true);
  assert.equal(setup({ platform: 'darwin' }).up.active, false);
  assert.equal(setup({ isPackaged: false }).up.active, false);
});

test('al arrancar mira al rato y luego cada 6 horas, si está activado', async () => {
  const { up, updater, timers } = setup();
  up.start();
  assert.equal(timers.length, 2);
  assert.ok(timers[0].ms >= 10000 && !timers[0].every, 'primera comprobación con retraso');
  assert.equal(timers[1].ms, 6 * 60 * 60 * 1000);
  await timers[0].fn(); await timers[1].fn();
  assert.equal(updater.checks, 2);
});

test('si el usuario lo apaga, las comprobaciones automáticas no hacen nada; la manual sí', async () => {
  let on = true;
  const { up, updater, timers } = setup({ enabled: () => on });
  up.start(); on = false;
  await timers[0].fn();
  assert.equal(updater.checks, 0);
  await up.checkNow();
  assert.equal(updater.checks, 1);
});

test('fuera de Windows instalado no comprueba nada', async () => {
  const { up, updater, timers } = setup({ isPackaged: false });
  up.start();
  await up.checkNow();
  assert.equal(timers.length, 0);
  assert.equal(updater.checks, 0);
});

test('avisa a la ventana cuando la versión nueva ya está descargada', () => {
  const { up, updater, sent } = setup();
  up.start();
  updater.emit('update-downloaded', { version: '0.7.1' });
  assert.deepEqual(sent, [['astro:update', { ready: true, version: '0.7.1' }]]);
});

test('una comprobación manual dice si ya está al día o si falló; las automáticas callan', async () => {
  const { up, updater, sent } = setup();
  up.start();
  updater.emit('update-not-available', {});
  updater.emit('error', new Error('sin red'));
  assert.deepEqual(sent, []);
  await up.checkNow();
  updater.emit('update-not-available', {});
  await up.checkNow();
  updater.emit('error', new Error('sin red'));
  assert.deepEqual(sent, [['astro:update', { latest: true }], ['astro:update', { error: 'sin red' }]]);
});

test('instalar reinicia en silencio y vuelve a abrir Astro', () => {
  const { up, updater } = setup();
  up.start();
  updater.emit('update-downloaded', { version: '0.7.1' });
  up.install();
  assert.deepEqual(updater.installed, { silent: true, runAfter: true });
});

test('instalar sin nada descargado no hace nada', () => {
  const { up, updater } = setup();
  up.install();
  assert.equal(updater.installed, null);
});
