const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = async () => ({ ...(await import('../renderer/graph-model.js')), ...(await import('../renderer/graph-sim.js')) });

// Un generador con semilla para que las pruebas no dependan del azar.
const seeded = seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

// k comunidades de m nodos: anillo y cuerdas dentro de cada una, y un enlace entre comunidades vecinas.
function clusters(k, m) {
  const nodes = [], links = [];
  for (let c = 0; c < k; c++) for (let i = 0; i < m; i++) nodes.push({ id: `c${c}n${i}`, label: `c${c}n${i}`, community: c });
  for (let c = 0; c < k; c++) {
    for (let i = 0; i < m; i++) { links.push({ source: `c${c}n${i}`, target: `c${c}n${(i + 1) % m}` }); links.push({ source: `c${c}n${i}`, target: `c${c}n${(i + 3) % m}` }); }
    links.push({ source: `c${c}n0`, target: `c${(c + 1) % k}n0` });
  }
  return { nodes, links };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('tras calentar no hay números rotos y las posiciones quedan acotadas', async () => {
  const { buildGraph, createSim } = await load();
  const G = buildGraph(clusters(3, 20));
  const sim = createSim(G, { random: seeded(1) });
  sim.warm();
  for (const n of G.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && Math.abs(n.x) < 5000 && Math.abs(n.y) < 5000, `${n.id}: ${n.x},${n.y}`);
});

test('los nodos de una comunidad quedan más juntos entre sí que con los de otra', async () => {
  const { buildGraph, createSim } = await load();
  const G = buildGraph(clusters(3, 20));
  createSim(G, { random: seeded(2) }).warm();
  let intra = 0, ni = 0, inter = 0, nx = 0;
  for (let i = 0; i < G.nodes.length; i++) for (let j = i + 1; j < G.nodes.length; j++) {
    const d = dist(G.nodes[i], G.nodes[j]);
    if (G.nodes[i].c === G.nodes[j].c) { intra += d; ni++; } else { inter += d; nx++; }
  }
  assert.ok(intra / ni < inter / nx, `${intra / ni} vs ${inter / nx}`);
});

test('con la simulación fría no se mueve nada, y un nodo fijado tampoco', async () => {
  const { buildGraph, createSim } = await load();
  const G = buildGraph(clusters(2, 10));
  const sim = createSim(G, { random: seeded(3) });
  sim.alpha = 0.001;
  const before = G.nodes.map(n => [n.x, n.y]);
  sim.step();
  assert.deepEqual(G.nodes.map(n => [n.x, n.y]), before);
  sim.heat(0.5);
  const p = G.nodes[0]; p.pin = true; const [px, py] = [p.x, p.y];
  for (let i = 0; i < 20; i++) sim.step();
  assert.deepEqual([p.x, p.y], [px, py]);
  assert.ok(G.nodes.slice(1).some((n, i) => n.x !== before[i + 1][0]), 'los demás sí se mueven');
});

test('1500 nodos y miles de relaciones se calientan en menos de 3 segundos', async () => {
  const { buildGraph, createSim } = await load();
  const nodes = Array.from({ length: 1500 }, (_, i) => ({ id: 'n' + i, label: 'n' + i, community: i % 8 }));
  const rnd = seeded(7), links = [];
  for (let i = 0; i < 4000; i++) links.push({ source: 'n' + Math.floor(rnd() * 1500), target: 'n' + Math.floor(rnd() * 1500) });
  const G = buildGraph({ nodes, links });
  const sim = createSim(G, { random: seeded(4) });
  const t0 = Date.now();
  sim.warm();
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  assert.ok(G.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('fit encuadra todos los nodos dentro de la pantalla', async () => {
  const { buildGraph, createSim } = await load();
  const G = buildGraph(clusters(3, 20));
  const sim = createSim(G, { random: seeded(5) });
  sim.warm(); sim.size(1000, 700); sim.fit(null, { instant: true });
  for (const n of G.nodes) { const p = sim.toScreen(n); assert.ok(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 700, `${n.id}: ${p.x},${p.y}`); }
});

test('toWorld deshace toScreen', async () => {
  const { buildGraph, createSim } = await load();
  const G = buildGraph(clusters(2, 8));
  const sim = createSim(G, { random: seeded(6) });
  sim.size(800, 600); sim.cam = { x: 30, y: -20, k: 1.7 };
  const n = G.nodes[3], w = sim.toWorld(sim.toScreen(n).x, sim.toScreen(n).y);
  assert.ok(Math.abs(w.x - n.x) < 1e-9 && Math.abs(w.y - n.y) < 1e-9);
});

test('la cámara se acerca sola al destino y la simulación acaba por asentarse', async () => {
  const { buildGraph, createSim } = await load();
  const G = buildGraph(clusters(3, 15));
  const sim = createSim(G, { random: seeded(8) });
  sim.size(900, 600); sim.warm();
  sim.fly(G.nodes[0], 2);
  assert.equal(sim.settled, false);
  let i = 0;
  while (!sim.settled && i++ < 5000) { sim.step(); sim.tick(0.016); }
  assert.ok(sim.settled, 'se asienta');
  assert.ok(Math.abs(sim.cam.k - 2) < 0.01);
});
