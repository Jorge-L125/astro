const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createOpencodeServer } = require('../src/opencode');

// Un `opencode serve` de mentira: anuncia que escucha y se puede cerrar.
function fakeSpawn(calls) {
  return (cmd, list, opts) => {
    const [bin, ...args] = list.length ? [cmd, ...list] : cmd.split(' ');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 0; // sin pid: el cierre usa kill()
    child.kill = () => { child.killed = true; child.emit('exit', null); };
    calls.push({ bin, args, env: opts.env, child });
    setImmediate(() => child.stdout.emit('data', `opencode server listening on http://127.0.0.1:${args[args.indexOf('--port') + 1]}\n`));
    return child;
  };
}
const okFetch = seen => async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200, json: async () => ({ healthy: true, version: '1.19.0' }), text: async () => '{}' }; };

test('en este equipo: Astro arranca OpenCode con una contraseña de un solo uso', async () => {
  const calls = [], seen = [];
  const srv = createOpencodeServer({ settings: () => ({ mode: 'local', pathMap: [{ host: 'C:/x', server: '/w' }] }), spawnImpl: fakeSpawn(calls), fetchImpl: okFetch(seen) });
  const info = await srv.ready();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ['serve', '--hostname', '127.0.0.1']);
  const pass = calls[0].env.OPENCODE_SERVER_PASSWORD;
  assert.ok(pass && pass.length >= 24);
  assert.equal(seen[0].opts.headers.Authorization, 'Basic ' + Buffer.from('opencode:' + pass).toString('base64'));
  assert.equal(info.version, '1.19.0');
  assert.equal(info.supported, true);
  assert.equal(srv.dirFor('C:/x/p'), 'C:/x/p', 'en este equipo las carpetas van tal cual');
  await srv.ready();
  assert.equal(calls.length, 1, 'se reutiliza el mismo proceso');
  srv.close();
  assert.ok(calls[0].child.killed, 'al cerrar se apaga');
});

test('si OpenCode se cierra, la siguiente petición lo vuelve a arrancar', async () => {
  const calls = [];
  const srv = createOpencodeServer({ settings: () => ({ mode: 'local' }), spawnImpl: fakeSpawn(calls), fetchImpl: okFetch([]) });
  await srv.ready();
  calls[0].child.emit('exit', 1);
  await srv.ready();
  assert.equal(calls.length, 2);
  srv.close();
});

test('sin OpenCode instalado avisa con un código propio', async () => {
  const srv = createOpencodeServer({
    settings: () => ({ mode: 'local' }),
    spawnImpl: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; setImmediate(() => c.emit('error', new Error('spawn opencode ENOENT'))); return c; },
    fetchImpl: okFetch([]),
  });
  await assert.rejects(srv.ready(), e => e.code === 'opencode_missing');
});
