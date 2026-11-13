const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveGraphify, detectInstallers, installPlan, parseVersion, isTestedVersion, installGraphify } = require('../src/graphify-bin');

const isWin = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-gfbin-'));
const touch = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, ''); return file; };
const exe = name => (isWin ? name + '.exe' : name);
const base = home => ({ platform: process.platform, env: { PATH: tmp(), PATHEXT: '.EXE;.CMD' }, home, freshPath: () => '' });

test('encuentra graphify en el PATH', () => {
  const dir = tmp();
  const f = touch(path.join(dir, exe('graphify')));
  const r = resolveGraphify(undefined, { ...base(tmp()), env: { PATH: dir, PATHEXT: '.EXE;.CMD' } });
  assert.equal(r.command, f);
  assert.equal(r.found, true);
  assert.equal(r.shell, false);
});

test('lo encuentra en ~/.local/bin (donde lo deja uv) aunque el PATH de Astro no lo tenga', () => {
  const home = tmp();
  const f = touch(path.join(home, '.local', 'bin', exe('graphify')));
  const r = resolveGraphify(undefined, base(home));
  assert.equal(r.command, f);
  assert.equal(r.found, true);
});

test('una ruta indicada que no existe se ignora y, si no aparece, se devuelve el nombre', () => {
  const r = resolveGraphify(path.join(tmp(), 'no-existe'), base(tmp()));
  assert.equal(r.found, false);
  assert.equal(resolveGraphify(undefined, base(tmp())).command, 'graphify');
});

test('detecta uv y pipx, y ninguno si no están', () => {
  const home = tmp();
  const uv = touch(path.join(home, '.local', 'bin', exe('uv')));
  const pipx = touch(path.join(home, '.local', 'bin', exe('pipx')));
  assert.deepEqual(detectInstallers(base(home)), { uv, pipx });
  // aislado del equipo: en CI existe un pipx de verdad en /usr/local/bin
  assert.deepEqual(detectInstallers({ ...base(tmp()), posixDirs: () => [], winDirs: () => [] }), { uv: null, pipx: null });
});

test('las carpetas conocidas se pueden sustituir (así las pruebas no dependen de lo que haya instalado en el equipo)', () => {
  const dir = tmp();
  const pipx = touch(path.join(dir, 'pipx'));
  assert.deepEqual(detectInstallers({ platform: 'linux', env: { PATH: '' }, home: tmp(), freshPath: () => '', posixDirs: () => [dir] }), { uv: null, pipx });
});

test('el plan de instalación: uv, si no pipx, si no solo el comando para copiar', () => {
  assert.deepEqual(installPlan({ uv: '/x/uv', pipx: '/x/pipx' }), { kind: 'uv', command: '/x/uv', args: ['tool', 'install', 'graphifyy'], text: 'uv tool install graphifyy', canRun: true });
  assert.deepEqual(installPlan({ uv: null, pipx: '/x/pipx' }), { kind: 'pipx', command: '/x/pipx', args: ['install', 'graphifyy'], text: 'pipx install graphifyy', canRun: true });
  const none = installPlan({ uv: null, pipx: null });
  assert.deepEqual([none.kind, none.text, none.canRun], ['pip', 'pip install graphifyy', false]);
});

test('lee la versión y sabe cuáles están probadas', () => {
  assert.equal(parseVersion('graphify 0.9.105\n'), '0.9.105');
  assert.equal(parseVersion('nada'), null);
  assert.equal(isTestedVersion('0.9.3'), true);
  assert.equal(isTestedVersion('0.10.0'), false);
  assert.equal(isTestedVersion('1.0.0'), false);
  assert.equal(isTestedVersion(null), false);
});

// Un proceso falso: emite salida y se cierra con el código dado.
const fakeSpawn = ({ code = 0, out = '', never = false } = {}) => {
  const calls = [];
  const impl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    calls.push({ cmd, args, opts, child });
    if (!never) setImmediate(() => { child.stderr.emit('data', out); child.emit('close', code); });
    return child;
  };
  impl.calls = calls;
  return impl;
};
const plan = { kind: 'uv', command: '/x/uv', args: ['tool', 'install', 'graphifyy'], text: 'uv tool install graphifyy', canRun: true };

test('installGraphify: código 0 → ok, sin consola', async () => {
  const sp = fakeSpawn({ code: 0, out: 'Installed 1 executable: graphify' });
  const r = await installGraphify({ plan, spawnImpl: sp });
  assert.equal(r.ok, true);
  assert.deepEqual([sp.calls[0].cmd, sp.calls[0].args], ['/x/uv', ['tool', 'install', 'graphifyy']]);
  assert.ok(!sp.calls[0].opts.shell, 'nunca por una consola');
});

test('installGraphify: un fallo trae el final de la salida', async () => {
  const r = await installGraphify({ plan, spawnImpl: fakeSpawn({ code: 1, out: 'x'.repeat(600) + 'error: sin red' }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.ok(r.tail.endsWith('error: sin red') && r.tail.length <= 400);
});

test('installGraphify: sin uv ni pipx no lanza nada', async () => {
  const sp = fakeSpawn();
  await assert.rejects(installGraphify({ plan: installPlan({ uv: null, pipx: null }), spawnImpl: sp }));
  assert.equal(sp.calls.length, 0);
});

test('installGraphify: si se pasa del tiempo, cierra el árbol de procesos', async () => {
  const killed = [];
  const r = await installGraphify({ plan, spawnImpl: fakeSpawn({ never: true }), killTree: c => killed.push(c), timeoutMs: 20 });
  assert.equal(r.ok, false);
  assert.match(r.tail, /tiempo agotado/);
  assert.equal(killed.length, 1);
});
