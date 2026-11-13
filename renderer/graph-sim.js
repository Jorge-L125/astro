// Simulación de fuerzas y cámara del visor del grafo. Puro (sin DOM): portado del prototipo `Astro v3.html`
// (gvSim, gvFit, gvFly, gvFrame) para poder probarlo en Node. Usa solo los nodos y relaciones visibles de G.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function createSim(G, { random = Math.random } = {}) {
  const sim = {
    alpha: 1, cam: { x: 0, y: 0, k: 1 }, camT: null, w: 0, h: 0, side: 1, // side: 1 = tarjeta a la izquierda, -1 = a la derecha

    /** Un paso de fuerzas: repulsión entre cercanos (con rejilla), muelles de las relaciones y atracción a la órbita de la comunidad. */
    step() {
      const N = G.nodes, a = sim.alpha;
      if (a < 0.003) return;
      const cell = 220, grid = new Map();
      for (const n of N) { const k = Math.floor(n.x / cell) + ',' + Math.floor(n.y / cell); (grid.get(k) || grid.set(k, []).get(k)).push(n); }
      for (const n of N) {
        const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          const list = grid.get((gx + i) + ',' + (gy + j));
          if (!list) continue;
          for (const m of list) {
            if (m === n) continue;
            let dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
            if (d2 > cell * cell) continue;
            if (d2 < 0.01) { dx = random() - 0.5; dy = random() - 0.5; d2 = 0.5; }
            const f = (700 + (n.r + m.r) * 40) * a / d2;
            n.vx += dx * f * 0.5; n.vy += dy * f * 0.5;
          }
        }
      }
      for (const l of G.links) {
        const { s, t } = l, dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 1;
        const goal = (s.c === t.c ? 38 : 90) + s.r + t.r, f = (d - goal) / d * 0.05 * a;
        s.vx += dx * f; s.vy += dy * f; t.vx -= dx * f; t.vy -= dy * f;
      }
      for (const n of N) {
        const c = G.comms[n.c];
        n.vx += (c.ax - n.x) * 0.004 * a - n.x * 0.0008 * a; n.vy += (c.ay - n.y) * 0.004 * a - n.y * 0.0008 * a;
        if (n.pin) { n.vx = n.vy = 0; continue; }
        n.vx *= 0.78; n.vy *= 0.78;
        n.x += clamp(n.vx, -40, 40); n.y += clamp(n.vy, -40, 40);
      }
      sim.alpha *= 0.988;
    },

    /** Deja el grafo ya colocado al abrirlo (así no se ve «caer»). */
    warm(n = Math.min(260, Math.max(60, Math.round(120000 / Math.max(1, G.nodes.length))))) {
      for (let i = 0; i < n; i++) sim.step();
      sim.alpha = Math.max(sim.alpha, 0.25);
    },
    heat(a) { sim.alpha = Math.max(sim.alpha, a); },

    size(w, h) { sim.w = w; sim.h = h; },
    // con espacio, la tarjeta lateral ocupa un lado: la cámara deja ese hueco
    cardOff() { return sim.w > 760 ? 166 : 0; },
    toScreen(n, cam = sim.cam) { return { x: (n.x - cam.x) * cam.k + sim.w / 2, y: (n.y - cam.y) * cam.k + sim.h / 2 }; },
    toWorld(x, y) { const c = sim.cam; return { x: (x - sim.w / 2) / c.k + c.x, y: (y - sim.h / 2) / c.k + c.y }; },

    /** Hacia un nodo, acercándose (k) sin taparlo con la tarjeta. */
    fly(n, k) {
      const kk = clamp(k ?? Math.max(sim.cam.k, 1.5), 0.15, 4);
      sim.camT = { x: n.x - sim.side * sim.cardOff() / kk, y: n.y + (sim.w > 720 ? 0 : sim.h * 0.18 / kk), k: kk };
      return sim.camT;
    },
    /** Encuadra una lista de nodos (o todos los visibles). */
    fit(list, { instant = false } = {}) {
      list = list && list.length ? list : G.nodes;
      if (!list.length || !sim.w) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      list.forEach(n => { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); });
      const aw = sim.w - sim.cardOff() * 2 - 60, ah = sim.h - 190;
      const k = clamp(Math.min(aw / Math.max(60, x1 - x0), ah / Math.max(60, y1 - y0)), 0.12, 2.6);
      sim.camT = { x: (x0 + x1) / 2 - sim.side * sim.cardOff() / k, y: (y0 + y1) / 2 - 10 / k, k };
      if (instant) { sim.cam = { ...sim.camT }; sim.camT = null; }
      return sim.camT;
    },

    /** Acerca la cámara a su destino (suavizado exponencial). */
    tick(dt) {
      if (!sim.camT) return;
      const q = 1 - Math.exp(-5.5 * dt), c = sim.cam, g = sim.camT;
      c.x = lerp(c.x, g.x, q); c.y = lerp(c.y, g.y, q); c.k = Math.exp(lerp(Math.log(c.k), Math.log(g.k), q));
      if (Math.abs(c.k - g.k) < 1e-3 && Math.hypot(c.x - g.x, c.y - g.y) < 0.05) sim.camT = null;
    },

    /** Sin nada que animar: la vista puede dejar de dibujar hasta que pase algo. */
    get settled() { return sim.alpha < 0.003 && !sim.camT; },
  };
  return sim;
}
