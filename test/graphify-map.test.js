const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGraphMap } = require('../src/graphify-map');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-gmap-'));
const found = { command: 'C:/g/graphify.exe', shell: false, found: true };
const make = (over = {}) => createGraphMap({ dir: tmp(), home: '/home/ana', platform: 'linux', enabled: () => true, resolveBin: () => found, ...over });

test('nunca se mapea la carpeta de usuario, la raíz de una unidad ni la carpeta de datos de Astro', () => {
  const win = createGraphMap({ dir: 'C:\\Users\\Ana\\AppData\\Roaming\\Astro\\graphs', home: 'C:\\Users\\Ana', platform: 'win32', resolveBin: () => found });
  for (const f of ['C:\\Users\\Ana', 'c:/users/ana/', 'C:\\Users\\ANA\\', 'C:\\', 'c:', 'C:\\Users\\Ana\\AppData\\Roaming\\Astro\\graphs', 'C:\\Users\\Ana\\AppData\\Roaming\\Astro\\graphs\\ab12']) {
    assert.equal(win.mappable(f), false, f);
  }
  assert.equal(win.mappable('C:\\Users\\Ana\\proyectos\\app'), true);
  const posix = createGraphMap({ dir: '/home/ana/.config/Astro/graphs', home: '/home/ana', platform: 'linux', resolveBin: () => found });
  for (const f of ['/home/ana', '/home/ana/', '/', '/home/ana/.config/Astro/graphs/x']) assert.equal(posix.mappable(f), false, f);
  assert.equal(posix.mappable('/home/ana/proyectos/app'), true);
});

test('folderId es estable, distinto entre carpetas e igual con o sin barra final', () => {
  const gm = make();
  assert.equal(gm.folderId('/home/ana/app'), gm.folderId('/home/ana/app/'));
  assert.notEqual(gm.folderId('/home/ana/app'), gm.folderId('/home/ana/otra'));
  assert.match(gm.folderId('/home/ana/app'), /^[0-9a-f]{12}$/);
});

test('el estado recorre apagado → no mapeable → sin graphify → sin permiso → rechazada o lista para construir', () => {
  let on = false, bin = found;
  const gm = make({ enabled: () => on, resolveBin: () => bin });
  const f = '/home/ana/app';
  assert.equal(gm.state(f).status, 'off');
  on = true;
  assert.equal(gm.state('/home/ana').status, 'unmappable');
  bin = { command: 'graphify', shell: false, found: false };
  assert.equal(gm.state(f).status, 'missing');
  bin = found;
  assert.equal(gm.state(f).status, 'unasked');
  gm.choose(f, false);
  assert.equal(gm.state(f).status, 'declined');
  gm.choose(f, true);
  assert.equal(gm.state(f).status, 'idle');
});

test('el permiso por carpeta se recuerda entre arranques y un index.json dañado no rompe nada', () => {
  const dir = tmp();
  const a = createGraphMap({ dir, home: '/home/ana', platform: 'linux', resolveBin: () => found });
  a.choose('/home/ana/app', true);
  a.choose('/home/ana/otra', false);
  const b = createGraphMap({ dir, home: '/home/ana', platform: 'linux', resolveBin: () => found });
  assert.equal(b.state('/home/ana/app').status, 'idle');
  assert.equal(b.state('/home/ana/otra').status, 'declined');
  fs.writeFileSync(path.join(dir, 'index.json'), '{esto no es json');
  const c = createGraphMap({ dir, home: '/home/ana', platform: 'linux', resolveBin: () => found });
  assert.equal(c.state('/home/ana/app').status, 'unasked');
});

test('choose avisa del cambio de estado y no acepta carpetas protegidas', () => {
  const seen = [];
  const gm = make({ onChange: (folder, st) => seen.push([folder, st.status]) });
  gm.choose('/home/ana/app', true);
  assert.deepEqual(seen, [['/home/ana/app', 'idle']]);
  gm.choose('/home/ana', true);
  assert.equal(seen.length, 1, 'la carpeta de usuario no se puede aceptar');
  assert.equal(gm.state('/home/ana').status, 'unmappable');
});

// Deja un mapa «listo»: índice con builtAt y un graph.json en su sitio.
function withGraph(gm, dir, folder, extra = {}) {
  const id = gm.folderId(folder);
  fs.mkdirSync(path.join(dir, id, 'graphify-out'), { recursive: true });
  fs.writeFileSync(path.join(dir, id, 'graphify-out', 'graph.json'), JSON.stringify({ nodes: [{ id: 'a' }], links: [] }));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ version: 1, folders: { [id]: { folder, choice: 'yes', builtAt: 1000, nodes: 3, edges: 2, ...extra } } }));
  return id;
}

test('con el mapa listo, el estado trae los datos y extras da las instrucciones y los cinco permisos', () => {
  const dir = tmp();
  const f = '/home/ana/app';
  const probe = createGraphMap({ dir, home: '/home/ana', platform: 'linux', resolveBin: () => found });
  const id = withGraph(probe, dir, f, { reduction: 12.5 });
  const gm = createGraphMap({ dir, home: '/home/ana', platform: 'linux', resolveBin: () => found });
  const st = gm.state(f);
  assert.deepEqual([st.status, st.nodes, st.edges, st.at, st.reduction], ['ready', 3, 2, 1000, 12.5]);
  const graph = gm.graphPath(f);
  assert.ok(graph.replace(/\\/g, '/').endsWith(`${id}/graphify-out/graph.json`));
  const ex = gm.extras(f);
  assert.ok(ex.rules.includes(`--graph "${graph.replace(/\\/g, '/')}"`), 'el grafo va entrecomillado');
  assert.equal(ex.tools.length, 5);
  assert.ok(ex.tools.every(t => t.startsWith('Bash(C:/g/graphify.exe ')));
});

test('sin interruptor, sin graphify o sin mapa, extras es null y graphPath también', () => {
  const dir = tmp();
  const f = '/home/ana/app';
  const probe = createGraphMap({ dir, home: '/home/ana', platform: 'linux', resolveBin: () => found });
  withGraph(probe, dir, f);
  let on = true, bin = found;
  const gm = createGraphMap({ dir, home: '/home/ana', platform: 'linux', enabled: () => on, resolveBin: () => bin });
  assert.ok(gm.extras(f));
  on = false; assert.equal(gm.extras(f), null); on = true;
  bin = { command: 'graphify', shell: false, found: false }; assert.equal(gm.extras(f), null); bin = found;
  assert.equal(gm.extras('/home/ana/sin-mapa'), null);
  assert.equal(gm.graphPath('/home/ana/sin-mapa'), null);
});
