const { test } = require('node:test');
const assert = require('node:assert/strict');
const { READ_ONLY, toSlashes, mapTools, mapRules } = require('../src/graphify-prompt');

test('las consultas de solo lectura son exactamente cinco', () => {
  assert.deepEqual(READ_ONLY, ['query', 'explain', 'path', 'affected', 'god-nodes']);
});

test('toSlashes cambia las barras invertidas por barras normales', () => {
  assert.equal(toSlashes('C:\\Users\\ana\\x.exe'), 'C:/Users/ana/x.exe');
  assert.equal(toSlashes('/home/ana/x'), '/home/ana/x');
});

test('mapTools da un permiso por consulta, con la ruta absoluta y barras /', () => {
  const tools = mapTools('C:\\Users\\ana\\.local\\bin\\graphify.exe');
  const base = 'C:/Users/ana/.local/bin/graphify.exe';
  assert.deepEqual(tools, [
    `Bash(${base} query:*)`,
    `Bash(${base} explain:*)`,
    `Bash(${base} path:*)`,
    `Bash(${base} affected:*)`,
    `Bash(${base} god-nodes:*)`,
  ]);
});

test('mapRules explica el mapa sin barras invertidas y con las rutas bien entrecomilladas', () => {
  const graph = 'C:\\Users\\ana\\AppData\\Roaming\\Astro\\graphs\\ab12\\graphify-out\\graph.json';
  const text = mapRules({ command: 'C:\\Program Files\\g\\graphify.exe', graph });
  assert.ok(!text.includes('\\'), 'ninguna barra invertida: la consola del motor podría tragársela');
  assert.ok(text.includes('"C:/Program Files/g/graphify.exe"'), 'un comando con espacios va entre comillas');
  assert.ok(text.includes('--graph "C:/Users/ana/AppData/Roaming/Astro/graphs/ab12/graphify-out/graph.json"'), 'el grafo va entre comillas dobles');
  for (const verb of READ_ONLY) assert.ok(text.includes(verb), verb);
  assert.ok(text.includes('--budget 1500'));
  assert.ok(text.toLowerCase().includes('antes de abrir archivos sueltos'));
  assert.ok(/solo esos archivos/i.test(text), 'después se leen solo los archivos que dice el mapa');
});

test('mapRules no entrecomilla un comando sin espacios', () => {
  const text = mapRules({ command: 'C:\\Users\\ana\\.local\\bin\\graphify.exe', graph: 'C:\\g\\graph.json' });
  assert.ok(text.includes('C:/Users/ana/.local/bin/graphify.exe query'));
  assert.ok(!text.includes('"C:/Users/ana/.local/bin/graphify.exe"'));
});
