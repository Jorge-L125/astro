const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPrefs, PREF_DEFAULTS } = require('../src/prefs');

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-prefs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('empieza con los valores por defecto', t => {
  assert.deepEqual(createPrefs(tmpDir(t)).get(), PREF_DEFAULTS);
});

test('guarda los cambios y los recuerda en el siguiente arranque', t => {
  const dir = tmpDir(t);
  const a = createPrefs(dir);
  assert.equal(a.set('alwaysOnTop', false), true);
  assert.equal(createPrefs(dir).get().alwaysOnTop, false);
  assert.equal(createPrefs(dir).get().watchCaptures, true);
});

test('ignora claves desconocidas, tipos incorrectos y archivos dañados', t => {
  const dir = tmpDir(t);
  const p = createPrefs(dir);
  assert.equal(p.set('otra', true), false);
  assert.equal(p.set('alwaysOnTop', 'no'), false);
  fs.writeFileSync(path.join(dir, 'prefs.json'), '{ roto');
  assert.deepEqual(createPrefs(dir).get(), PREF_DEFAULTS);
  fs.writeFileSync(path.join(dir, 'prefs.json'), JSON.stringify({ alwaysOnTop: 'sí', watchCaptures: false }));
  assert.deepEqual(createPrefs(dir).get(), { alwaysOnTop: true, watchCaptures: false });
});
