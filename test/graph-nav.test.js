const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = async () => ({ ...(await import('../renderer/graph-model.js')), ...(await import('../renderer/graph-nav.js')) });

// a1 es el centro de la comunidad «Núcleo»; b1 de «Borde»; a4→b1 las une; «isla» está sola; hay un nodo cuyo nombre contiene «graphify».
const raw = () => ({
  nodes: [
    ...['a1', 'a2', 'a3', 'a4'].map(id => ({ id, label: id, community: 0, community_name: 'Núcleo', file_type: 'code', source_file: `${id}.js`, source_location: 'L1' })),
    ...['b1', 'b2', 'b3'].map(id => ({ id, label: id, community: 1, community_name: 'Borde' })),
    { id: 'isla', label: 'isla', community: 2 },
    { id: 'gm', label: 'graphify-map', community: 1 },
  ],
  links: [
    { source: 'a1', target: 'a2', relation: 'calls' }, { source: 'a1', target: 'a3', relation: 'calls' }, { source: 'a1', target: 'a4', relation: 'calls' },
    { source: 'a4', target: 'b1', relation: 'uses' }, { source: 'b1', target: 'b2', relation: 'calls' }, { source: 'b1', target: 'b3', relation: 'calls' },
    { source: 'b1', target: 'gm', relation: 'uses' },
  ],
});
const make = async (r = raw(), o = {}) => { const m = await load(); const G = m.buildGraph(r, o); return { ...m, G, nav: m.createNav(G) }; };

test('«ve a X» enfoca el nodo, lo describe y pide a la vista que vuele hasta él', async () => {
  const { nav, reply } = await make();
  const t = reply(nav, 've a a2');
  assert.match(t, /^a2 \(code\): 1 conexión, con a1\.$/);
  assert.equal(nav.focus.id, 'a2');
  assert.equal(nav.last.fly.id, 'a2');
  assert.equal(nav.last.look.id, 'a2');
});

test('un nombre que no existe lo dice y no cambia nada', async () => {
  const { nav, reply } = await make();
  assert.equal(reply(nav, 'busca nada'), 'No encuentro «nada» en el grafo.');
  assert.equal(nav.focus, null);
});

test('un nombre con «graphify» dentro no se confunde con «el grafo»', async () => {
  const { nav, reply } = await make();
  assert.match(reply(nav, 've a graphify-map'), /^graphify-map/);
  assert.equal(nav.focus.id, 'gm');
});

test('«camino de A a B» enseña la ruta, y avisa si no hay o no encuentra', async () => {
  const { nav, reply } = await make();
  assert.match(reply(nav, 'camino de a2 a b3'), /^4 saltos: a2 → a1 → a4 → /);
  assert.deepEqual(nav.path.nodes.map(n => n.id), ['a2', 'a1', 'a4', 'b1', 'b3']);
  assert.equal(nav.focus.id, 'b3');
  assert.equal(nav.last.fit.length, 5);
  assert.equal(reply(nav, 'camino de a2 a isla'), 'No hay camino entre a2 y isla.');
  assert.equal(reply(nav, 'camino de zzz a b3'), 'No encuentro «zzz» en el grafo.');
});

test('siguiente, anterior, entra y atrás recorren los vecinos', async () => {
  const { nav, reply } = await make();
  reply(nav, 've a a1');
  assert.match(reply(nav, 'siguiente'), /^1\/3: a4 \(calls\)|^1\/3: a4 \(← calls\)/);
  assert.match(reply(nav, 'siguiente'), /^2\/3: /);
  assert.match(reply(nav, 'anterior'), /^1\/3: /);
  assert.match(reply(nav, 'entra'), /^a4/);
  assert.equal(nav.focus.id, 'a4');
  assert.equal(reply(nav, 'atrás'), 'De vuelta en a1.');
  assert.equal(nav.focus.id, 'a1');
  assert.equal(reply(nav, 'atrás'), 'Ya estamos al principio.');
});

test('entra sin haber elegido vecino, y siguiente sin nodo, dan ayuda', async () => {
  const { nav, reply } = await make();
  assert.equal(reply(nav, 'siguiente'), 'Primero elige un nodo: dime «ve a …».');
  reply(nav, 've a a1');
  assert.equal(reply(nav, 'entra'), 'Dime «siguiente» para elegir un vecino.');
});

test('el recorrido avanza nodo a nodo, termina solo y «para» lo detiene', async () => {
  const { nav, reply } = await make();
  assert.match(reply(nav, 'hazme un recorrido'), /^¡Vamos! Te enseño \d+ nodos empezando por /);
  assert.ok(nav.tour);
  const first = nav.tourNext();
  assert.ok(first.node && first.text);
  assert.equal(reply(nav, 'para'), 'Me detengo aquí.');
  assert.equal(nav.tour, null);
  assert.deepEqual(nav.tourNext(), { idle: true });

  reply(nav, 'recorrido');
  let steps = 0, r;
  while (!(r = nav.tourNext()).done && steps < 30) steps++;
  assert.ok(r.done && steps >= 1 && steps <= 10);
  assert.equal(r.text, 'Fin del recorrido. ¿A dónde vamos ahora?');
  assert.equal(nav.tour, null);
});

test('stop() sin recorrido no dice nada', async () => {
  const { nav } = await make();
  assert.equal(nav.stop(), '');
});

test('más conectado, vista general, comunidad, vecinos y cerrar', async () => {
  const { nav, reply } = await make();
  assert.match(reply(nav, 'cuál es el más conectado'), /^El más conectado es /);
  assert.equal(nav.focus.id, 'b1');
  assert.equal(reply(nav, 'vista general'), 'Vista completa del grafo.');
  assert.equal(nav.focus, null);
  assert.equal(nav.last.fit, null);
  reply(nav, 've a a2');
  assert.equal(reply(nav, 'comunidad'), 'Núcleo: 4 nodos.');
  assert.equal(nav.comm, 0);
  assert.equal(nav.focus, null);
  reply(nav, 've a a1');
  assert.match(reply(nav, 'vecinos'), /^a1 se conecta con a4, a2, a3\. Di «siguiente»/);
  assert.equal(reply(nav, 'cierra el grafo'), 'Grafo guardado. Aquí sigo.');
  assert.equal(nav.last.close, true);
});

test('una frase que no es una orden de navegación no la responde (va al motor)', async () => {
  const { nav, reply } = await make();
  assert.equal(reply(nav, '¿por qué a1 depende de otro módulo y no de otro más sencillo?'), null);
  assert.equal(reply(nav, 'explícame la arquitectura de este proyecto'), null);
  assert.equal(reply(nav, 'qué es graphify-map'), null);
  assert.equal(reply(nav, 'busca por qué falla el build de la aplicación'), null);
  assert.equal(nav.focus, null);
});

test('escribir solo el nombre de un nodo lo enfoca', async () => {
  const { nav, reply } = await make();
  assert.match(reply(nav, 'isla'), /^isla/);
  assert.equal(nav.focus.id, 'isla');
});

test('graphRequest: abrir y cerrar con el visor cerrado', async () => {
  const { graphRequest } = await load();
  assert.deepEqual(graphRequest('Muéstrame el grafo'), { close: false, target: null });
  assert.deepEqual(graphRequest('abre el grafo de graphify-map'), { close: false, target: 'graphify-map' });
  assert.deepEqual(graphRequest('cierra el grafo'), { close: true, target: null });
  assert.equal(graphRequest('hola'), null);
  assert.equal(graphRequest('explícame qué es un grafo de dependencias y cómo se calcula en un compilador'), null);
});

test('engineContext con un nodo elegido da archivo, tipo y hasta 12 vecinos', async () => {
  const star = { nodes: [{ id: 'hub', label: 'hub', community: 0, file_type: 'code', source_file: 'hub.js', source_location: 'L9' }], links: [] };
  for (let i = 0; i < 20; i++) { star.nodes.push({ id: 'v' + i, label: 'v' + i, community: 0 }); star.links.push({ source: 'hub', target: 'v' + i, relation: i % 2 ? 'uses' : 'calls' }); }
  const { nav, reply, engineContext } = await make(star, { title: 'estrella' });
  reply(nav, 've a hub');
  const c = engineContext(nav);
  assert.match(c, /«estrella»/);
  assert.match(c, /«hub» \(code, hub\.js:L9\)/);
  assert.match(c, /20 conexiones/);
  assert.equal((c.match(/«v\d+»/g) || []).length, 12);
  assert.match(c, /y 8 más/);
  assert.ok(!c.includes('<'));
});

test('engineContext sin nodo elegido cuenta nodos y comunidades; con tope lo dice', async () => {
  const { nav, engineContext } = await make();
  const c = engineContext(nav);
  assert.match(c, /Ningún nodo elegido/);
  assert.match(c, /9 nodos/);
  assert.match(c, /3 comunidades/);
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i, label: 'n' + i, community: 0 }));
  const links = nodes.slice(1).map(n => ({ source: 'n0', target: n.id }));
  const small = await make({ nodes, links }, { cap: 5 });
  assert.match(small.engineContext(small.nav), /mostrando solo los 5 más conectados de 12/);
});

test('cardHtml escapa todo lo que viene del grafo', async () => {
  const evil = { nodes: [{ id: 'e', label: '<img src=x onerror=1>', community: 0, community_name: '<b>Grupo</b>', file_type: 'co"de', source_file: 'a"b<c>.js', source_location: "L'1", description: '<script>x</script>' },
    { id: 'f', label: 'f&f', community: 0 }], links: [{ source: 'e', target: 'f', relation: 'a<b&c' }] };
  const { nav, reply, cardHtml } = await make(evil);
  reply(nav, 've a f');
  nav.focusOn(nav.G.all.nodes[0]);
  const h = cardHtml(nav);
  assert.ok(!/<img|<script|<b>/.test(h), h);
  assert.ok(h.includes('&lt;img src=x onerror=1&gt;'));
  assert.ok(h.includes('a&lt;b&amp;c'));
});

test('cardHtml sin foco enseña un resumen y los más conectados', async () => {
  const { nav, cardHtml } = await make();
  const h = cardHtml(nav);
  assert.match(h, /9 nodos en 3 comunidades/);
  assert.ok(h.includes('data-id="a1"'));
});

test('elegir un nodo oculto lo revela junto a sus vecinos ocultos', async () => {
  const nodes = Array.from({ length: 2000 }, (_, i) => ({ id: 'n' + i, label: 'n' + i, community: i % 5 }));
  const links = [];
  for (let i = 0; i < 1999; i++) links.push({ source: 'n' + i, target: 'n' + (i + 1) });
  for (let i = 1; i < 300; i++) links.push({ source: 'n0', target: 'n' + i });
  const { nav, G } = await make({ nodes, links });
  const h = G.all.nodes.find(n => n.hidden);
  const before = G.nodes.length;
  nav.focusOn(h);
  assert.equal(h.hidden, false);
  assert.ok(G.nodes.length > before);
  assert.equal(nav.focus, h);
});
