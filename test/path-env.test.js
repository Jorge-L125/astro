const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'build', 'path-env.ps1');
const onWindows = { skip: process.platform !== 'win32' && 'solo en Windows' };

// -Current hace que el script solo calcule el PATH resultante, sin tocar el registro.
const edit = (action, dir, current) => execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT,
  '-Action', action, '-Dir', dir, '-Current', current,
], { encoding: 'utf8' }).trim();

const BIN = 'C:\\Users\\u\\AppData\\Local\\Programs\\Astro\\bin';

test('añade la carpeta bin al final del PATH, una sola vez', onWindows, () => {
  assert.equal(edit('add', BIN, 'C:\\Windows;%USERPROFILE%\\bin'), `C:\\Windows;%USERPROFILE%\\bin;${BIN}`);
  assert.equal(edit('add', BIN, `C:\\Windows;${BIN.toUpperCase()}\\`), `C:\\Windows;${BIN}`, 'no la duplica aunque cambien mayúsculas o la barra final');
});

test('al desinstalar quita solo esa carpeta y conserva las variables sin expandir', onWindows, () => {
  assert.equal(edit('remove', BIN, `%USERPROFILE%\\bin;${BIN};C:\\tools;`), '%USERPROFILE%\\bin;C:\\tools');
  assert.equal(edit('remove', BIN, 'C:\\tools'), 'C:\\tools');
});
