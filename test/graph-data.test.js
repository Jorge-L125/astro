const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slimGraph, loadGraphFor } = require('../src/graph-data');

test('slimGraph deja solo los campos que usa el visor, con links o edges', () => {
  const a = slimGraph({ nodes: [{ id: 1, label: 'uno', file_type: 'code', source_file: 'a.js', source_location: 'L3', community: 2, community_name: 'Núcleo', extra: 'x' }, { id: 'b' }],
    links: [{ source: 1, target: 'b', relation: 'calls', confidence: 'EXTRACTED', otro: 1 }] });
  assert.deepEqual(a.nodes[0], { id: '1', label: 'uno', type: 'code', file: 'a.js', loc: 'L3', community: 2, communityName: 'Núcleo', desc: '' });
  assert.equal(a.nodes[1].label, 'b', 'sin label usa el id');
  assert.deepEqual(a.links, [{ source: '1', target: 'b', relation: 'calls', confidence: 'EXTRACTED' }]);
  assert.equal(slimGraph({ nodes: [{ id: 'x' }], edges: [{ source: 'x', target: 'x' }] }).links.length, 1);
});

test('slimGraph entiende {graph:{…}} y un grafo vacío', () => {
  assert.equal(slimGraph({ graph: { nodes: [{ id: 'a' }], links: [] } }).nodes.length, 1);
  assert.deepEqual(slimGraph({}), { nodes: [], links: [] });
  assert.deepEqual(slimGraph(null), { nodes: [], links: [] });
});

const fakeMap = (over = {}) => ({ graphPath: () => null, state: () => ({ status: 'unasked' }), ...over });

test('sin mapa listo explica el estado y no lee nada', async () => {
  let read = 0;
  const r = await loadGraphFor({ graphMap: fakeMap(), folder: 'C:\\a\\mi-app', readFile: async () => { read++; return '{}'; } });
  assert.deepEqual(r, { ok: false, folder: 'C:\\a\\mi-app', state: { status: 'unasked' } });
  assert.equal(read, 0);
});

test('con mapa lee solo la ruta del mapa y pone nombre y fecha', async () => {
  const asked = [];
  const gm = fakeMap({ graphPath: () => 'D:/datos/graphs/abc/graphify-out/graph.json', state: () => ({ status: 'ready', at: 123 }) });
  const r = await loadGraphFor({ graphMap: gm, folder: 'C:\\a\\mi-app', readFile: async p => { asked.push(p); return JSON.stringify({ nodes: [{ id: 'n' }], links: [] }); } });
  assert.deepEqual(asked, ['D:/datos/graphs/abc/graphify-out/graph.json']);
  assert.equal(r.ok, true);
  assert.equal(r.title, 'mi-app');
  assert.equal(r.folder, 'C:\\a\\mi-app');
  assert.equal(r.at, 123);
  assert.equal(r.nodes.length, 1);
});

test('un archivo ilegible o que no es JSON da failed', async () => {
  const gm = fakeMap({ graphPath: () => '/x/graph.json', state: () => ({ status: 'ready', at: 1 }) });
  const bad = await loadGraphFor({ graphMap: gm, folder: '/a/b', readFile: async () => '{ a medias' });
  assert.equal(bad.ok, false);
  assert.equal(bad.state.status, 'failed');
  const gone = await loadGraphFor({ graphMap: gm, folder: '/a/b', readFile: async () => { throw new Error('ENOENT'); } });
  assert.deepEqual([gone.ok, gone.state.status, gone.state.error], [false, 'failed', 'ENOENT']);
});
