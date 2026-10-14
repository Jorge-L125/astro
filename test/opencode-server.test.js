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
  const srv = createOpencodeServer({ settings: () => ({ mode: 'local', pathMap: [{ host: 'C:/x', server: '/w' }] }), resolveBin: () => ({ command: 'opencode', shell: process.platform === 'win32', found: false }), spawnImpl: fakeSpawn(calls), fetchImpl: okFetch(seen) });
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
  const srv = createOpencodeServer({ settings: () => ({ mode: 'local' }), resolveBin: () => ({ command: 'opencode', shell: process.platform === 'win32', found: false }), spawnImpl: fakeSpawn(calls), fetchImpl: okFetch([]) });
  await srv.ready();
  calls[0].child.emit('exit', 1);
  await srv.ready();
  assert.equal(calls.length, 2);
  srv.close();
});

test('sin OpenCode instalado avisa con un código propio', async () => {
  const srv = createOpencodeServer({
    settings: () => ({ mode: 'local' }), resolveBin: () => ({ command: 'opencode', shell: process.platform === 'win32', found: false }), 
    spawnImpl: () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {}; setImmediate(() => c.emit('error', new Error('spawn opencode ENOENT'))); return c; },
    fetchImpl: okFetch([]),
  });
  await assert.rejects(srv.ready(), e => e.code === 'opencode_missing');
});

/* ---------- OpenCode 2.x ---------- */
// Un servidor 2.x: la API vive bajo /api y las rutas de la 1.x devuelven la web (HTML).
const v2Fetch = (seen, version = '2.0.28') => async (url, opts) => {
  seen.push({ url, opts });
  const u = new URL(url);
  if (u.pathname === '/api/info') return { ok: true, status: 200, json: async () => ({ version }), text: async () => JSON.stringify({ version }) };
  if (u.pathname === '/api/session') return { ok: true, status: 200, json: async () => ({ data: [] }), text: async () => '{"data":[]}' };
  if (u.pathname === '/api/boom') return { ok: false, status: 400, json: async () => ({}), text: async () => '{"_tag":"InvalidRequestError","message":"Missing key text"}' };
  return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); }, text: async () => '<!doctype html>' };
};

test('2.x: se reconoce por /api/info y se da por probada', async () => {
  const seen = [];
  const srv = createOpencodeServer({ settings: () => ({ mode: 'remote', url: 'http://srv:4096' }), fetchImpl: v2Fetch(seen) });
  const info = await srv.ready();
  assert.deepEqual([info.version, info.api, info.supported], ['2.0.28', 'v2', true]);
  assert.ok(!seen.some(s => s.url.includes('/global/health')), 'no se prueba la API vieja');
});

test('1.19 sigue igual: api v1 y comprobación de salud', async () => {
  const seen = [];
  const srv = createOpencodeServer({ settings: () => ({ mode: 'remote', url: 'http://srv:4096' }), fetchImpl: okFetch(seen) });
  const info = await srv.ready();
  assert.deepEqual([info.version, info.api, info.supported], ['1.19.0', 'v1', true]);
});

test('una versión desconocida de 1.x o 2.x se marca como no probada', async () => {
  const a = createOpencodeServer({ settings: () => ({ mode: 'remote', url: 'http://srv' }), fetchImpl: v2Fetch([], '3.1.0') });
  assert.equal((await a.ready()).supported, false);
  const b = createOpencodeServer({ settings: () => ({ mode: 'remote', url: 'http://srv' }), fetchImpl: async url => (new URL(url).pathname === '/global/health'
    ? { ok: true, status: 200, json: async () => ({ healthy: true, version: '1.17.0' }) } : { ok: false, status: 404, json: async () => ({}), text: async () => '' }) });
  const info = await b.ready();
  assert.deepEqual([info.api, info.supported], ['v1', false]);
});

test('2.x: la carpeta va en una cabecera (codificada) y los errores traen su mensaje', async () => {
  const seen = [];
  const srv = createOpencodeServer({ settings: () => ({ mode: 'remote', url: 'http://srv:4096/' }), fetchImpl: v2Fetch(seen) });
  await srv.request('GET', '/api/session', { dir: 'C:/Users/ñu/日本' });
  const last = seen[seen.length - 1];
  assert.equal(last.url, 'http://srv:4096/api/session', 'sin ?directory=');
  assert.equal(last.opts.headers['x-opencode-directory'], encodeURIComponent('C:/Users/ñu/日本'));
  await assert.rejects(srv.request('GET', '/api/boom'), e => e.code === 'opencode_http' && /Missing key text/.test(e.message));
});

test('1.x: la carpeta sigue yendo en la dirección', async () => {
  const seen = [];
  const srv = createOpencodeServer({ settings: () => ({ mode: 'remote', url: 'http://srv:4096' }), fetchImpl: okFetch(seen) });
  await srv.request('GET', '/session', { dir: '/w/p' });
  assert.equal(seen[seen.length - 1].url, 'http://srv:4096/session?directory=%2Fw%2Fp');
});

/* ---------- dónde está OpenCode ---------- */
test('usa la ruta completa que encuentra, sin depender del PATH de Astro', async () => {
  const calls = [];
  const srv = createOpencodeServer({
    settings: () => ({ mode: 'local' }), spawnImpl: fakeSpawn(calls), fetchImpl: okFetch([]),
    resolveBin: () => ({ command: '/home/ana/.opencode/bin/opencode', shell: false, found: true }),
  });
  await srv.ready();
  assert.equal(calls[0].bin, '/home/ana/.opencode/bin/opencode', 'se lanza el ejecutable, sin shell');
  assert.deepEqual(calls[0].args.slice(0, 3), ['serve', '--hostname', '127.0.0.1']);
  srv.close();
});

test('un opencode.cmd con espacios en la ruta se lanza por la consola entrecomillado', async () => {
  const seen = [];
  const spawnImpl = (cmd, list, opts) => { seen.push({ cmd, list, shell: opts.shell }); return fakeSpawn([])(cmd, list, opts); };
  const srv = createOpencodeServer({
    settings: () => ({ mode: 'local' }), spawnImpl, fetchImpl: okFetch([]),
    resolveBin: () => ({ command: 'C:/Users/ana maria/npm/opencode.cmd', shell: true, found: true }),
  });
  // el servidor falso solo entiende comandos sin espacios en la ruta: aquí basta con ver cómo se lanza
  srv.ready().catch(() => {});
  await new Promise(r => setImmediate(r));
  assert.equal(seen[0].shell, true);
  assert.ok(seen[0].cmd.startsWith('"C:/Users/ana maria/npm/opencode.cmd" serve'), seen[0].cmd);
  srv.close();
});

test('si OpenCode no aparece y no arranca, el aviso dice dónde se buscó y qué hacer', async () => {
  const srv = createOpencodeServer({
    settings: () => ({ mode: 'local' }),
    spawnImpl: () => {
      const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
      setImmediate(() => { c.stderr.emit('data', '"opencode" no se reconoce como un comando interno o externo'); c.emit('exit', 1); });
      return c;
    },
    fetchImpl: okFetch([]),
    resolveBin: () => ({ command: 'opencode', shell: true, found: false }),
  });
  await assert.rejects(srv.ready(), e => e.code === 'opencode_missing' && /reinicia Astro/.test(e.message) && /\.opencode/.test(e.message));
});
