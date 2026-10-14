const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveOpencode, parseRegPath, readWinPath } = require('../src/opencode-bin');

const isWin = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-ocbin-'));
const touch = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; };

test('lo encuentra en el PATH', () => {
  const dir = tmp();
  const exe = touch(path.join(dir, isWin ? 'opencode.exe' : 'opencode'));
  const r = resolveOpencode(undefined, { platform: process.platform, env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, home: tmp(), freshPath: () => '' });
  assert.equal(r.command, exe);
  assert.equal(r.found, true);
  assert.equal(r.shell, false, 'un ejecutable se lanza directamente, sin consola');
});

test('lo encuentra en ~/.opencode/bin aunque el PATH de Astro no lo tenga (instalado después de abrir sesión)', () => {
  const home = tmp();
  const exe = touch(path.join(home, '.opencode', 'bin', isWin ? 'opencode.exe' : 'opencode'));
  const r = resolveOpencode(undefined, { platform: process.platform, env: { PATH: tmp(), PATHEXT: '.EXE;.CMD' }, home, freshPath: () => '' });
  assert.equal(r.command, exe);
  assert.equal(r.found, true);
});

test('la ruta que indiques en los ajustes manda; si no existe, se ignora', () => {
  const dir = tmp();
  const mine = touch(path.join(dir, isWin ? 'mi-opencode.exe' : 'mi-opencode'));
  const base = { platform: process.platform, env: { PATH: tmp() }, home: tmp(), freshPath: () => '' };
  assert.equal(resolveOpencode(mine, base).command, mine);
  const r = resolveOpencode(path.join(dir, 'no-existe'), base);
  assert.equal(r.found, false);
});

test('si no está en ningún sitio, se intenta con el nombre y se avisa de que no se encontró', () => {
  const r = resolveOpencode(undefined, { platform: process.platform, env: { PATH: tmp() }, home: tmp(), freshPath: () => '' });
  assert.equal(r.command, 'opencode');
  assert.equal(r.found, false);
});

test('en macOS y Linux mira también las carpetas habituales', () => {
  const home = tmp();
  const exe = touch(path.join(home, '.local', 'bin', 'opencode'));
  const r = resolveOpencode(undefined, { platform: 'linux', env: { PATH: '/nada' }, home, freshPath: () => '' });
  assert.equal(r.command, exe);
});

test('Windows: lee el PATH que hay en el registro, que puede ser más nuevo que el de Astro', { skip: !isWin }, () => {
  const fresh = tmp();
  const exe = touch(path.join(fresh, 'opencode.exe'));
  const r = resolveOpencode(undefined, { platform: 'win32', env: { PATH: tmp(), PATHEXT: '.EXE;.CMD' }, home: tmp(), freshPath: () => `C:\\otra;${fresh}` });
  assert.equal(r.command, exe);
});

test('Windows: un opencode.cmd (npm) se lanza por la consola', { skip: !isWin }, () => {
  const dir = tmp();
  const cmd = touch(path.join(dir, 'opencode.cmd'));
  const r = resolveOpencode(undefined, { platform: 'win32', env: { PATH: dir, PATHEXT: '.EXE;.CMD' }, home: tmp(), freshPath: () => '' });
  assert.equal(r.command, cmd);
  assert.equal(r.shell, true);
});

test('lee el PATH de `reg query` y expande las variables', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    C:\\Users\\ana\\bin;%USERPROFILE%\\.opencode\\bin;%NOEXISTE%\r\n\r\n';
  assert.equal(parseRegPath(out, { USERPROFILE: 'C:\\Users\\ana' }), 'C:\\Users\\ana\\bin;C:\\Users\\ana\\.opencode\\bin;%NOEXISTE%');
  assert.equal(parseRegPath('nada', {}), '');
  assert.equal(parseRegPath('    Path    REG_SZ    C:\\x', {}), 'C:\\x');
});

test('readWinPath une el PATH del usuario y el del sistema, y no falla si el registro no responde', () => {
  const answers = [
    '    Path    REG_EXPAND_SZ    C:\\usuario',
    '    Path    REG_EXPAND_SZ    C:\\sistema',
  ];
  let i = 0;
  assert.equal(readWinPath(() => answers[i++], {}), 'C:\\usuario;C:\\sistema');
  assert.equal(readWinPath(() => { throw new Error('sin registro'); }, {}), '');
});
