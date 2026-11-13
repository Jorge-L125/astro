// Modelo del grafo del proyecto para el visor: nodos, relaciones, comunidades, búsqueda y caminos. Puro (sin DOM),
// portado del prototipo `Astro v3.html` (gvLoad, gvFind, gvPath…) para poder probarlo en Node.

/** Cuántos nodos se dibujan a la vez; si el grafo tiene más, se enseñan los más conectados y el resto se «revela». */
export const CAP = 1500;

const PAL = ['#7aa2ff', '#ff8a65', '#5ee0b0', '#ffd166', '#c792ff', '#ff7eb6', '#4fd1ff', '#a8e05f', '#ffb37a', '#9aa8ff', '#e0e4f0'];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Comunidades por propagación de etiquetas, cuando el grafo no trae las suyas.
function labelPropagation(nodes, adj) {
  const lab = new Map(nodes.map((n, i) => [n, i]));
  for (let it = 0; it < 15; it++) {
    let changed = false;
    for (const n of [...nodes].sort(() => Math.random() - 0.5)) {
      const cnt = new Map();
      adj.get(n).forEach(e => cnt.set(lab.get(e.n), (cnt.get(lab.get(e.n)) || 0) + 1));
      let best = lab.get(n), bc = 0;
      cnt.forEach((c, k) => { if (c > bc || (c === bc && k < best)) { bc = c; best = k; } });
      if (best !== lab.get(n)) { lab.set(n, best); changed = true; }
    }
    if (!changed) break;
  }
  return n => lab.get(n);
}

/**
 * buildGraph(raw, { title, cap }) → G
 * raw: el graph.json de graphify o su versión reducida ({ nodes, links|edges }).
 * G.nodes / G.links son lo que se ve; G.all tiene todo (la búsqueda, los vecinos y los caminos usan todo).
 */
export function buildGraph(raw, { title = 'Grafo', cap = CAP } = {}) {
  if (raw && raw.graph && !raw.nodes && raw.graph.nodes) raw = raw.graph;
  const rawN = (raw && raw.nodes) || [], rawL = (raw && (raw.links || raw.edges)) || [];
  if (!rawN.length) throw new Error('sin nodos');
  const nodes = rawN.map((n, i) => ({
    id: String(n.id ?? n.name ?? i), label: String(n.label ?? n.name ?? n.title ?? n.id ?? i),
    type: String(n.file_type ?? n.type ?? n.kind ?? ''), file: String(n.source_file ?? n.file ?? n.path ?? ''), loc: String(n.source_location ?? n.loc ?? n.line ?? ''),
    rc: n.community ?? n.group ?? n.cluster, rcn: n.community_name ?? n.communityName ?? n.community_label ?? null,
    desc: String(n.description ?? n.summary ?? n.docstring ?? n.desc ?? ''),
    x: 0, y: 0, vx: 0, vy: 0, deg: 0, r: 4, c: 0, pin: false, hidden: false,
  }));
  const byId = new Map(nodes.map(n => [n.id, n])), seen = new Set(), links = [], adj = new Map(nodes.map(n => [n, []]));
  for (const l of rawL) {
    const s = byId.get(String(l.source?.id ?? l.source ?? l.from)), t = byId.get(String(l.target?.id ?? l.target ?? l.to));
    if (!s || !t || s === t) continue;
    const key = s.id + '\u0000' + t.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const L = { s, t, rel: String(l.relation ?? l.label ?? l.type ?? 'relacionado'), conf: l.confidence ?? '', h: Math.random() };
    links.push(L); adj.get(s).push({ n: t, l: L, out: true }); adj.get(t).push({ n: s, l: L, out: false });
  }
  nodes.forEach(n => { n.deg = adj.get(n).length; n.r = 3.2 + Math.sqrt(n.deg) * 2.3; });

  // comunidades: las de graphify si vienen en más de la mitad de los nodos; si no, propagación de etiquetas
  const has = nodes.filter(n => n.rc != null).length > nodes.length * 0.5;
  const raw2 = has ? (n => String(n.rc ?? '?')) : labelPropagation(nodes, adj);
  const groups = new Map();
  nodes.forEach(n => { const k = raw2(n); (groups.get(k) || groups.set(k, []).get(k)).push(n); });
  const comms = [...groups.values()].sort((a, b) => b.length - a.length).map((list, i) => {
    const hub = [...list].sort((a, b) => b.deg - a.deg)[0];
    const name = list.find(n => n.rcn)?.rcn || (list.length > 1 ? `Grupo de ${hub.label}` : hub.label);
    list.forEach(n => { n.c = i; });
    return { i, list, name: String(name), color: PAL[Math.min(i, PAL.length - 1)], shown: list.length };
  });

  // posiciones iniciales: cada comunidad en su órbita
  const R = 26 * Math.sqrt(nodes.length) + 40;
  comms.forEach((c, i) => {
    const a = (i / comms.length) * Math.PI * 2 - Math.PI / 2, rr = comms.length > 1 ? R * (i === 0 ? 0.35 : 1) : 0;
    c.ax = Math.cos(a) * rr; c.ay = Math.sin(a) * rr;
    c.list.forEach(n => { const q = Math.random() * Math.PI * 2, d = Math.random() * 18 * Math.sqrt(c.list.length); n.x = c.ax + Math.cos(q) * d; n.y = c.ay + Math.sin(q) * d; });
  });

  // con más nodos que el tope: se ven los más conectados
  let visible = nodes;
  if (nodes.length > cap) {
    visible = [...nodes].sort((a, b) => b.deg - a.deg || a.label.localeCompare(b.label)).slice(0, cap);
    const keep = new Set(visible);
    nodes.forEach(n => { n.hidden = !keep.has(n); });
    visible = nodes.filter(n => !n.hidden);
  }
  comms.forEach(c => { c.shown = c.list.filter(n => !n.hidden).length; });
  const shown = new Set(visible);
  const shownLinks = links.filter(l => shown.has(l.s) && shown.has(l.t));
  return {
    title, all: { nodes, links, adj }, nodes: visible, links: shownLinks, adj, comms,
    total: { nodes: nodes.length, links: links.length }, capped: nodes.length > cap,
  };
}

/** Ordenados por grado y luego por etiqueta. */
export function neighbors(G, n) {
  return n ? [...G.adj.get(n)].sort((a, b) => b.n.deg - a.n.deg || a.n.label.localeCompare(b.n.label)) : [];
}

/** El nodo que mejor responde al texto (exacto, prefijo o contiene); con `strict`, solo exacto o prefijo de 3+ letras. */
export function find(G, q, strict = false) {
  const qn = norm(q).replace(/^(el|la|los|las|un|una|nodo|a)\s+/g, '').replace(/^(nodo)\s+/, '').trim();
  const qs = qn.replace(/[^a-z0-9]/g, '');
  if (qs.length < 2) return null;
  let best = null, bs = 9;
  for (const n of G.all.nodes) {
    const ls = norm(n.label).replace(/[^a-z0-9]/g, ''), is = norm(n.id).replace(/[^a-z0-9]/g, '');
    let s = 9;
    if (ls === qs || is === qs) s = 0;
    else if (ls.startsWith(qs)) s = 1;
    else if (ls.includes(qs) || is.includes(qs)) s = 2;
    else if (!strict && ls.length >= 4 && qs.includes(ls)) s = 3;
    if (s < bs || (s === bs && best && n.deg > best.deg)) { bs = s; best = n; }
  }
  if (strict) return bs <= 1 && qs.length >= 3 ? best : null;
  return bs < 9 ? best : null;
}

/** La ruta más corta entre dos nodos: { nodes, edges } o null si no están conectados. */
export function shortestPath(G, a, b) {
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) {
    const n = q.shift();
    if (n === b) break;
    for (const e of G.adj.get(n)) if (!prev.has(e.n)) { prev.set(e.n, { n, l: e.l }); q.push(e.n); }
  }
  if (!prev.has(b)) return null;
  const nodes = [], edges = [];
  let c = b;
  while (c) { nodes.unshift(c); const p = prev.get(c); if (p) edges.push(p.l); c = p && p.n; }
  return { nodes, edges };
}

/** El recorrido guiado: hasta 10 nodos, empezando por `start` y yendo a sus vecinos. */
export function tourOrder(G, start) {
  start = start || top(G);
  const order = [start], seen = new Set(order);
  for (let i = 0; i < order.length && order.length < 10; i++) {
    for (const e of neighbors(G, order[i])) {
      if (order.length >= 10) break;
      if (!seen.has(e.n)) { seen.add(e.n); order.push(e.n); }
    }
  }
  return order;
}

/** El más conectado. */
export function top(G) { return G.all.nodes.reduce((a, b) => (b.deg > a.deg ? b : a), G.all.nodes[0]); }

export function describe(G, n) {
  const nb = neighbors(G, n), first = nb.slice(0, 3).map(e => e.n.label).join(', ');
  return `${n.label}${n.type ? ` (${n.type})` : ''}: ${nb.length} conexi${nb.length === 1 ? 'ón' : 'ones'}${first ? `, con ${first}${nb.length > 3 ? '…' : ''}` : ''}.`;
}

/** Hace visibles nodos ocultos (con sus relaciones a lo ya visible). Devuelve cuántos eran nuevos. */
export function reveal(G, list) {
  let added = 0;
  const have = new Set(G.links);
  for (const n of list) {
    if (!n.hidden) continue;
    n.hidden = false; added++;
    G.nodes.push(n);
    G.comms[n.c].shown++;
    const near = G.adj.get(n).map(e => e.n).find(m => !m.hidden && m !== n);
    if (near) { n.x = near.x + (Math.random() - 0.5) * 30; n.y = near.y + (Math.random() - 0.5) * 30; }
    n.vx = n.vy = 0;
    for (const e of G.adj.get(n)) if (!e.n.hidden && !have.has(e.l)) { have.add(e.l); G.links.push(e.l); }
  }
  return added;
}
