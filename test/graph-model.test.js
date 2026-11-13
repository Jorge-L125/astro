const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/graph-model.js');

// Dos comunidades: A (a1..a4, con a1 de centro) y B (b1..b3), unidas por a4→b1. «isla» no se conecta con nadie.
const raw = () => ({
  nodes: [
    ...['a1', 'a2', 'a3', 'a4'].map(id => ({ id, label: id, community: 0, community_name: 'Núcleo', file_type: 'code', source_file: `${id}.js`, source_location: 'L1' })),
    ...['b1', 'b2', 'b3'].map(id => ({ id, label: id, community: 1, community_name: 'Borde' })),
    { id: 'isla', label: 'isla', community: 2 },
  ],
  links: [
    { source: 'a1', target: 'a2', relation: 'calls' }, { source: 'a1', target: 'a3', relation: 'calls' }, { source: 'a1', target: 'a4', relation: 'calls' },
    { source: 'a4', target: 'b1', relation: 'uses' }, { source: 'b1', target: 'b2', relation: 'calls' }, { source: 'b1', target: 'b3', relation: 'calls' },
    { source: 'a1', target: 'a2', relation: 'repetido' }, // duplicado
    { source: 'a1', target: 'a1', relation: 'consigo' }, // a sí mismo
    { source: 'a1', target: 'fantasma', relation: 'roto' }, // extremo que no existe
  ],
});

test('descarta enlaces repetidos, a sí mismos y a nodos que no existen', async () => {
  const { buildGraph } = await load();
  const G = buildGraph(raw(), { title: 'demo' });
  assert.equal(G.all.links.length, 6);
  assert.equal(G.nodes.length, 8);
  assert.equal(G.title, 'demo');
  assert.deepEqual([G.total.nodes, G.total.links, G.capped], [8, 6, false]);
});

test('sin nodos lanza un error claro', async () => {
  const { buildGraph } = await load();
  assert.throws(() => buildGraph({ nodes: [], links: [] }), /sin nodos/);
  assert.throws(() => buildGraph(null), /sin nodos/);
});

test('usa las comunidades de graphify con sus nombres, ordenadas por tamaño, con colores', async () => {
  const { buildGraph } = await load();
  const G = buildGraph(raw());
  assert.deepEqual(G.comms.map(c => [c.name, c.list.length]), [['Núcleo', 4], ['Borde', 3], ['isla', 1]]);
  assert.ok(G.comms.every(c => /^#[0-9a-f]{6}$/i.test(c.color)));
  assert.equal(G.nodes.find(n => n.id === 'a2').c, 0);
});

test('sin comunidades en el grafo las calcula por propagación de etiquetas', async () => {
  const { buildGraph } = await load();
  const r = raw(); r.nodes.forEach(n => { delete n.community; delete n.community_name; });
  const G = buildGraph(r);
  assert.ok(G.comms.length >= 1 && G.comms.length <= 8);
  assert.equal(G.comms.reduce((s, c) => s + c.list.length, 0), 8);
});

test('grado, radio y campos de un nodo (acepta el formato crudo y el reducido)', async () => {
  const { buildGraph } = await load();
  const G = buildGraph(raw());
  const a1 = G.nodes.find(n => n.id === 'a1');
  assert.equal(a1.deg, 3);
  assert.ok(a1.r > G.nodes.find(n => n.id === 'a2').r);
  assert.deepEqual([a1.type, a1.file, a1.loc], ['code', 'a1.js', 'L1']);
  const slim = buildGraph({ nodes: [{ id: 'x', label: 'x', type: 'code', file: 'x.js', loc: 'L2', community: 0, communityName: 'Uno', desc: '' }], links: [] });
  assert.deepEqual([slim.nodes[0].file, slim.nodes[0].loc, slim.comms[0].name], ['x.js', 'L2', 'Uno']);
});

test('find: exacto > prefijo > contiene, sin tildes, el más conectado gana y lo corto no vale', async () => {
  const { buildGraph, find } = await load();
  const G = buildGraph({ nodes: [{ id: '1', label: 'Gráfico' }, { id: '2', label: 'graficoRaro' }, { id: '3', label: 'mapa' }, { id: '4', label: 'mapa' }, { id: '5', label: 'x' }],
    links: [{ source: '4', target: '5' }, { source: '4', target: '1' }] });
  assert.equal(find(G, 'grafico').id, '1', 'exacto sin tildes ni mayúsculas');
  assert.equal(find(G, 'graf').id, '1', 'prefijo');
  assert.equal(find(G, 'afico').id, '1', 'contiene');
  assert.equal(find(G, 'mapa').id, '4', 'dos con la misma etiqueta: el más conectado');
  assert.equal(find(G, 'x'), null, 'menos de 2 letras');
  assert.equal(find(G, 'zzz'), null);
  assert.equal(find(G, 'afico', true), null, 'estricto: solo exacto o prefijo');
  assert.equal(find(G, 'gra', true).id, '1');
  assert.equal(find(G, 'el mapa').id, '4', 'quita el artículo');
});

test('shortestPath encuentra la ruta más corta y devuelve null entre componentes separadas', async () => {
  const { buildGraph, find, shortestPath } = await load();
  const G = buildGraph(raw());
  const p = shortestPath(G, find(G, 'a2'), find(G, 'b3'));
  assert.deepEqual(p.nodes.map(n => n.id), ['a2', 'a1', 'a4', 'b1', 'b3']);
  assert.equal(p.edges.length, 4);
  assert.equal(shortestPath(G, find(G, 'a2'), find(G, 'isla')), null);
});

test('tourOrder da hasta 10 nodos sin repetir y empieza donde se pide; top es el más conectado', async () => {
  const { buildGraph, find, tourOrder, top } = await load();
  const G = buildGraph(raw());
  const order = tourOrder(G, find(G, 'a2'));
  assert.equal(order[0].id, 'a2');
  assert.equal(new Set(order).size, order.length);
  assert.ok(order.length <= 10);
  assert.equal(top(G).id, 'a1');
});

test('describe cuenta las conexiones en singular y plural', async () => {
  const { buildGraph, find, describe } = await load();
  const G = buildGraph(raw());
  assert.equal(describe(G, find(G, 'b2')), 'b2: 1 conexión, con b1.');
  assert.match(describe(G, find(G, 'a1')), /^a1 \(code\): 3 conexiones, con /);
  assert.equal(describe(G, find(G, 'isla')), 'isla: 0 conexiones.');
});

test('neighbors ordena por grado y luego por etiqueta', async () => {
  const { buildGraph, find, neighbors } = await load();
  const G = buildGraph(raw());
  assert.deepEqual(neighbors(G, find(G, 'a1')).map(e => e.n.id), ['a4', 'a2', 'a3']);
});

// Un grafo grande: cadena con un centro conectado a los primeros 300.
function big(n = 2000) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: 'n' + i, label: 'n' + i, community: i % 5 }));
  const links = [];
  for (let i = 0; i < n - 1; i++) links.push({ source: 'n' + i, target: 'n' + (i + 1) });
  for (let i = 1; i < 300; i++) links.push({ source: 'n0', target: 'n' + i });
  return { nodes, links };
}

test('con más nodos que el tope enseña los más conectados y lo dice', async () => {
  const { buildGraph, CAP } = await load();
  assert.equal(CAP, 1500);
  const G = buildGraph(big());
  assert.equal(G.nodes.length, 1500);
  assert.deepEqual([G.capped, G.total.nodes], [true, 2000]);
  const hidden = G.all.nodes.filter(n => n.hidden), shown = G.nodes;
  assert.equal(hidden.length, 500);
  assert.ok(Math.min(...shown.map(n => n.deg)) >= Math.max(...hidden.map(n => n.deg)));
  assert.ok(G.links.every(l => !l.s.hidden && !l.t.hidden));
  assert.ok(G.comms.reduce((s, c) => s + c.list.length, 0) === 2000, 'la leyenda cuenta todo el grafo');
});

test('find, vecinos y caminos ven también los nodos ocultos', async () => {
  const { buildGraph, find, shortestPath, neighbors } = await load();
  const G = buildGraph(big());
  const h = G.all.nodes.find(n => n.hidden);
  assert.equal(find(G, h.label), h);
  assert.ok(neighbors(G, h).length >= 1);
  assert.ok(shortestPath(G, G.nodes[0], h));
});

test('reveal hace visible un nodo oculto con sus enlaces a visibles; repetirlo no hace nada', async () => {
  const { buildGraph, reveal } = await load();
  const G = buildGraph(big());
  const h = G.all.nodes.find(n => n.hidden);
  const shownBefore = G.comms[h.c].shown, linksBefore = G.links.length;
  assert.equal(reveal(G, [h]), 1);
  assert.equal(h.hidden, false);
  assert.ok(G.nodes.includes(h));
  assert.ok(G.links.length > linksBefore);
  assert.ok(G.links.every(l => !l.s.hidden && !l.t.hidden));
  assert.equal(G.comms[h.c].shown, shownBefore + 1);
  assert.ok(Number.isFinite(h.x) && Number.isFinite(h.y));
  assert.equal(reveal(G, [h]), 0);
});

test('esc escapa lo que podría ser HTML', async () => {
  const { esc, norm } = await load();
  assert.equal(esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(norm('  ÁÉÍ  '), 'aei');
});
