const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGraphMap } = require('../src/graphify-map');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-gbuild-'));
const tick = () => new Promise(r => setImmediate(r));
const until = async fn => { for (let i = 0; i < 400 && !fn(); i++) await tick(); };
const found = { command: 'C:/g/graphify.exe', shell: false, found: true };
const KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'];
const A = '/home/ana/app', B = '/home/ana/otra';

// Un graphify de mentira: `extract` escribe el grafo (o basura si falla) y `benchmark` imprime la reducción.
function fakeGraphify({ graph = { nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b' }] }, code = 0, stderr = '', hold = false, never = false, throwOnSpawn = false } = {}) {
  const calls = [];
  const impl = (cmd, args, opts) => {
    if (throwOnSpawn) throw new Error('boom');
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { child.killed = true; };
    const finish = () => {
      if (args[0] === 'extract') {
        const out = args[args.indexOf('--out') + 1], file = path.join(out, 'graphify-out', 'graph.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, code === 0 ? JSON.stringify(graph) : '{ grafo a medias');
        if (stderr) child.stderr.emit('data', stderr);
        child.emit('close', code);
      } else { child.stdout.emit('data', 'Reduction:       36.9x\n'); child.emit('close', 0); }
    };
    calls.push({ cmd, args, opts, child, finish });
    if (!(args[0] === 'extract' && (hold || never))) setImmediate(finish);
    return child;
  };
  impl.calls = calls;
  impl.extracts = () => calls.filter(c => c.args[0] === 'extract');
  return impl;
}

function make(spawnImpl, over = {}) {
  const clock = { t: 1_000_000 };
  const killed = [];
  const events = [];
  const gm = createGraphMap({
    dir: tmp(), home: '/home/ana', platform: 'linux', enabled: () => true, resolveBin: () => found, spawnImpl,
    killTree: c => killed.push(c), now: () => clock.t, onChange: (f, s) => events.push([f, s.status]),
    staleMs: 600000, timeoutMs: 5000, backoffMs: 3600000, ...over,
  });
  gm.choose(A, true); gm.choose(B, true);
  events.length = 0;
  return { gm, clock, killed, events };
}

test('construye con extract --code-only fuera del proyecto, sin claves, y deja el mapa listo', async () => {
  const sp = fakeGraphify();
  const { gm, events } = make(sp);
  const st = await gm.ensure(A);
  const [first] = sp.extracts();
  const out = path.dirname(path.dirname(gm.graphPath(A)));
  assert.deepEqual(first.args, ['extract', A, '--code-only', '--out', out], 'la salida es la carpeta del mapa, no el proyecto');
  assert.equal(first.cmd, 'C:/g/graphify.exe');
  for (const k of KEYS) assert.equal(first.opts.env[k], '', k);
  assert.deepEqual([st.status, st.nodes, st.edges, st.reduction], ['ready', 2, 1, 36.9]);
  assert.deepEqual(events.map(e => e[1]), ['building', 'ready']);
  assert.equal(sp.calls.some(c => c.args[0] === 'benchmark'), true);
});

test('no vuelve a construir antes de staleMs; sí pasado, y con force', async () => {
  const sp = fakeGraphify();
  const { gm, clock } = make(sp);
  await gm.ensure(A);
  assert.equal(sp.extracts().length, 1);
  clock.t += 599000; await gm.ensure(A);
  assert.equal(sp.extracts().length, 1, 'aún está fresco');
  await gm.ensure(A, { force: true });
  assert.equal(sp.extracts().length, 2, 'force siempre construye');
  clock.t += 600001; await gm.ensure(A);
  assert.equal(sp.extracts().length, 3, 'pasados 10 minutos');
});

test('sin permiso, rechazada, apagado, sin graphify o carpeta protegida: no lanza nada', async () => {
  const sp = fakeGraphify();
  let on = true, bin = found;
  const gm = createGraphMap({ dir: tmp(), home: '/home/ana', platform: 'linux', enabled: () => on, resolveBin: () => bin, spawnImpl: sp, killTree() {} });
  assert.equal((await gm.ensure(A)).status, 'unasked');
  gm.choose(B, false); assert.equal((await gm.ensure(B)).status, 'declined');
  gm.choose(A, true);
  on = false; assert.equal((await gm.ensure(A)).status, 'off'); on = true;
  bin = { command: 'graphify', shell: false, found: false }; assert.equal((await gm.ensure(A)).status, 'missing'); bin = found;
  assert.equal((await gm.ensure('/home/ana')).status, 'unmappable');
  assert.equal(sp.calls.length, 0);
});

test('un fallo con mapa anterior bueno lo conserva intacto; sin mapa previo queda en failed', async () => {
  const { gm, clock } = make(fakeGraphify({ code: 1, stderr: 'algo\nboom\n' }));
  const st0 = await gm.ensure(A);
  assert.deepEqual([st0.status, st0.error], ['failed', 'boom'], 'sin mapa previo');
  assert.equal(gm.graphPath(A), null);

  // con un mapa previo: se construye bien, pasa el tiempo y la segunda construcción falla
  let mode = 'ok';
  const spy = fakeGraphify();
  const bad = fakeGraphify({ code: 1, stderr: 'boom' });
  const { gm: g2, clock: c2 } = make((cmd, args, opts) => (mode === 'ok' ? spy : bad)(cmd, args, opts));
  await g2.ensure(A);
  const before = fs.readFileSync(g2.graphPath(A), 'utf8');
  mode = 'fail'; c2.t += 600001;
  const st = await g2.ensure(A);
  assert.deepEqual([st.status, st.error], ['ready', 'boom']);
  assert.equal(fs.readFileSync(g2.graphPath(A), 'utf8'), before, 'el grafo anterior no se estropea');
  void clock;
});

test('tras un fallo no reintenta solo hasta pasada 1 hora; con force sí', async () => {
  const sp = fakeGraphify({ code: 1, stderr: 'boom' });
  const { gm, clock } = make(sp);
  await gm.ensure(A);
  assert.equal(sp.extracts().length, 1);
  clock.t += 3599000; await gm.ensure(A);
  assert.equal(sp.extracts().length, 1, 'aún no ha pasado 1 hora');
  clock.t += 2000; await gm.ensure(A);
  assert.equal(sp.extracts().length, 2, 'pasada 1 hora');
  await gm.ensure(A, { force: true });
  assert.equal(sp.extracts().length, 3);
});

test('si se pasa del tiempo máximo, cierra el árbol de procesos y lo cuenta', async () => {
  const sp = fakeGraphify({ never: true });
  const { gm, killed } = make(sp, { timeoutMs: 20 });
  const st = await gm.ensure(A);
  assert.deepEqual([st.status, st.error], ['failed', 'tiempo agotado']);
  assert.equal(killed.length, 1);
  assert.equal(killed[0], sp.calls[0].child);
});

test('nunca dos procesos a la vez: la segunda carpeta espera su turno y no se duplica', async () => {
  const sp = fakeGraphify({ hold: true });
  const { gm } = make(sp);
  const pa = gm.ensure(A), pb = gm.ensure(B), pa2 = gm.ensure(A);
  assert.equal(pa, pa2, 'pedir lo mismo mientras construye no encola otra');
  await until(() => sp.extracts().length === 1);
  assert.equal(sp.extracts().length, 1, 'solo A está construyendo');
  assert.equal(sp.extracts()[0].args[1], A);
  assert.equal(gm.state(B).status, 'building', 'B espera su turno y se ve como pendiente');
  sp.extracts()[0].finish();
  await until(() => sp.extracts().length === 2);
  assert.equal(sp.extracts()[1].args[1], B);
  sp.extracts()[1].finish();
  const [a, b] = await Promise.all([pa, pb]);
  assert.deepEqual([a.status, b.status], ['ready', 'ready']);
});

test('close cierra el proceso en curso y vacía la cola', async () => {
  const sp = fakeGraphify({ hold: true });
  const { gm, killed } = make(sp);
  const pa = gm.ensure(A), pb = gm.ensure(B);
  await until(() => sp.extracts().length === 1);
  gm.close();
  await Promise.all([pa, pb]);
  assert.equal(killed.length, 1);
  assert.equal(sp.extracts().length, 1, 'B no llegó a empezar');
});

test('ensure nunca rechaza, aunque no se pueda lanzar el proceso', async () => {
  const { gm } = make(fakeGraphify({ throwOnSpawn: true }));
  const st = await gm.ensure(A);
  assert.equal(st.status, 'failed');
  assert.match(st.error, /boom/);
});

test('con la consola (graphify.cmd) una carpeta con & o | no puede añadir órdenes', async () => {
  const sp = fakeGraphify({ never: true });
  const { gm } = make(sp, { resolveBin: () => ({ command: 'C:/g/graphify.cmd', shell: true, found: true }) });
  const odd = '/home/ana/a&calc|x';
  gm.choose(odd, true);
  gm.ensure(odd);
  await until(() => sp.calls.length > 0);
  assert.ok(sp.calls[0].cmd.includes(`"${odd}"`), sp.calls[0].cmd);
});
