const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loginShellPath, mergePath } = require('../src/shell-path');

test('loginShellPath saca el PATH aunque el .zshrc imprima cosas alrededor', () => {
  let call;
  const run = (shell, args) => { call = { shell, args }; return 'Bienvenido!\n__ASTRO_PATH__/opt/homebrew/bin:/usr/bin__ASTRO_PATH__\n'; };
  assert.equal(loginShellPath({ shell: '/bin/zsh', run }), '/opt/homebrew/bin:/usr/bin');
  assert.equal(call.shell, '/bin/zsh');
  assert.equal(call.args[0], '-ilc', 'shell interactivo y de login: lee .zprofile y .zshrc');
});

test('loginShellPath devuelve null si el shell falla o no responde', () => {
  assert.equal(loginShellPath({ run: () => { throw new Error('timeout'); } }), null);
  assert.equal(loginShellPath({ run: () => 'nada útil' }), null);
});

test('mergePath une sin repetir y respeta el orden del PATH actual', () => {
  assert.equal(mergePath('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin'), '/usr/bin:/bin:/opt/homebrew/bin');
  assert.equal(mergePath('', '/a'), '/a');
});

test('los atajos se muestran como en cada sistema', async () => {
  const { formatAccel, altKey } = await import('../renderer/keys.js');
  assert.equal(formatAccel('CommandOrControl+Shift+Space', false), 'Ctrl+Shift+Espacio');
  assert.equal(formatAccel('CommandOrControl+Shift+Space', true), '⌘⇧Espacio');
  assert.equal(formatAccel('Alt+K', true), '⌥K');
  assert.equal(altKey('N', false), 'Alt+N');
  assert.equal(altKey('1…6', true), '⌥1…6');
});
