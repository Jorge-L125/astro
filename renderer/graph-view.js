// La vista del grafo: dibuja en un canvas 2D, escucha ratón y teclado y pinta la tarjeta y la leyenda. Toda la lógica
// (modelo, frases, simulación) está en graph-model/graph-nav/graph-sim, que se prueban en Node; esto es el pegamento con el DOM.
// Portado del prototipo `Astro v3.html` (gvDraw, gvFrame, interacción).
import { buildGraph, find, describe, esc } from './graph-model.js';
import { createNav, reply, engineContext, cardHtml } from './graph-nav.js';
import { createSim } from './graph-sim.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const $ = (root, id) => root.querySelector('#' + id);

/**
 * createGraphView({ root, gota, reduce, say, onClose, onReload, escapeFree, side })
 * root: la sección #graphView. say(texto): muestra una frase de Astro. onClose(): el usuario cerró el visor.
 * onReload(): pidió recargar el mapa. escapeFree(): ¿puede Esc cerrar el visor (no hay otra cosa abierta)? side(): 1 = tarjeta a la izquierda.
 */
export function createGraphView({ root, gota, reduce = false, say = () => {}, onClose = () => {}, onReload = () => {}, escapeFree = () => true, side = () => 1 }) {
  const cv = $(root, 'gvCanvas'), ctx = cv.getContext('2d');
  const card = $(root, 'gvCard'), legend = $(root, 'gvLeg'), status = $(root, 'gvStatus'), stale = $(root, 'gvStale');
  let G = null, nav = null, sim = null, byId = new Map();
  let isOpen = false, raf = 0, last = 0, t = 0, tourAt = null, dirty = true, hover = null, down = null, lookTimer = 0;
  const stars = [];
  const view = { at: null };

  // ---------- carga y estado ----------
  function header() {
    $(root, 'gvTitle').textContent = G.title;
    $(root, 'gvStats').textContent = `${G.total.nodes} nodos · ${G.total.links} relaciones · ${G.comms.length} comunidades${G.capped ? ` · mostrando ${G.nodes.length} de ${G.total.nodes}` : ''}`;
  }
  function renderCard() {
    card.innerHTML = cardHtml(nav);
    const cur = card.querySelector('.gv-nb.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function renderLegend() {
    legend.innerHTML = G.comms.slice(0, 10).map(c => `<button type="button" data-c="${c.i}" aria-pressed="${nav.comm === c.i}"><i style="color:${c.color};background:${c.color}"></i>${esc(c.name)} <small>${c.shown < c.list.length ? c.shown + '/' : ''}${c.list.length}</small></button>`).join('');
  }
  function render() { renderCard(); renderLegend(); root.classList.toggle('deep', !!(nav.focus || nav.path || nav.tour)); dirty = true; }
  function resize() {
    const r = cv.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    if (!r.width || !sim) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    sim.size(r.width, r.height); sim.side = side();
    if (!stars.length && !reduce) for (let i = 0; i < 180; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.6 + 0.15, p: Math.random() * 6 });
    dirty = true;
  }

  /** Carga el grafo ({ title, at, nodes, links }); lanza si no tiene nodos. */
  view.load = data => {
    const g = buildGraph(data, { title: data.title || 'Grafo' });
    G = g; nav = createNav(G); sim = createSim(G); byId = new Map(G.all.nodes.map(n => [n.id, n]));
    view.at = data.at ?? null; stale.hidden = true; status.hidden = true; tourAt = null;
    header();
    $(root, 'gvList').innerHTML = [...G.all.nodes].sort((a, b) => b.deg - a.deg).slice(0, 400).map(n => `<option value="${esc(n.label)}"></option>`).join('');
    resize(); sim.warm(); sim.fit(null, { instant: true });
    render();
  };

  /** Un mensaje en lugar del grafo (sin mapa, apagado, construyendo…). `html` ya viene escapado por quien llama. */
  view.showStatus = (html, buttons = []) => {
    G = null; nav = null; sim = null; stale.hidden = true;
    status.innerHTML = `<p>${html}</p>`;
    for (const b of buttons) { const el = document.createElement('button'); el.className = 'gv-btn'; el.type = 'button'; el.textContent = b.label; el.onclick = b.onClick; status.append(el); }
    status.hidden = false;
    card.innerHTML = ''; legend.innerHTML = '';
    $(root, 'gvTitle').textContent = 'Grafo'; $(root, 'gvStats').textContent = '—';
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  };

  view.markStale = () => { if (G) stale.hidden = false; };
  view.context = () => (nav ? engineContext(nav) : '');
  Object.defineProperty(view, 'isOpen', { get: () => isOpen });
  Object.defineProperty(view, 'hasGraph', { get: () => !!G });

  // ---------- acciones sobre el grafo ----------
  // Tras una acción de `nav`: mueve la cámara y la mirada y vuelve a pintar tarjeta y leyenda.
  function afterNav(before = G ? G.nodes.length : 0) {
    if (!nav) return;
    const L = nav.last || {};
    if (G.nodes.length !== before) sim.heat(0.3);
    if (L.fly) { sim.fly(L.fly); if (reduce) { sim.cam = { ...sim.camT }; sim.camT = null; } }
    if (L.fit !== undefined) sim.fit(L.fit, { instant: reduce });
    if (L.zoom) { const c = sim.cam; sim.camT = { x: c.x, y: c.y, k: clamp(c.k * L.zoom, 0.1, 5) }; if (reduce) { sim.cam = { ...sim.camT }; sim.camT = null; } }
    if (L.look) look(L.look);
    render();
    if (L.close) { view.close(); onClose(); }
  }
  function look(n, delay = 450) {
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => {
      if (!isOpen || !sim || !gota || !gota.lookAtPoint) return;
      const p = sim.toScreen(n, sim.camT || sim.cam), r = cv.getBoundingClientRect();
      gota.lookAtPoint(r.left + p.x, r.top + p.y, 2.4);
    }, reduce ? 0 : delay);
  }
  const act = fn => { if (!nav) return; const before = G.nodes.length; const text = fn(); afterNav(before); if (text) say(text); };

  /** Lo que Astro entiende solo; null si es una pregunta para el motor. */
  view.reply = text => {
    if (!nav) return null;
    const before = G.nodes.length, r = reply(nav, text);
    afterNav(before);
    return r;
  };
  /** Ir a un nodo por su nombre (p. ej. «muéstrame el grafo de X»). */
  view.goTo = name => { const n = G && find(G, name); if (!n) return null; let text; act(() => (text = nav.focusOn(n))); return text; };

  view.open = () => {
    isOpen = true;
    root.classList.add('open'); root.removeAttribute('inert'); root.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => { resize(); if (sim && !nav.focus) sim.fit(null, { instant: true }); dirty = true; });
    if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  };
  view.close = () => {
    isOpen = false;
    if (nav) nav.stop();
    clearTimeout(lookTimer);
    root.classList.remove('open'); root.setAttribute('inert', ''); root.setAttribute('aria-hidden', 'true');
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    down = null; hover = null;
  };
  Object.defineProperty(view, 'running', { get: () => !!raf });

  // ---------- bucle ----------
  function frame(now) {
    raf = 0;
    if (!isOpen) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now; t += dt;
    if (sim) {
      sim.step();
      if (reduce && sim.camT) { sim.cam = { ...sim.camT }; sim.camT = null; } else sim.tick(dt);
      tourTick();
      // solo se vuelve a pintar si algo se mueve o cambió: un grafo quieto no gasta CPU
      const moving = !sim.settled || nav.focus || nav.path || nav.tour || nav.comm != null || hover || down;
      if (moving || dirty) { draw(); dirty = false; }
    }
    raf = requestAnimationFrame(frame);
  }
  function tourTick() {
    if (!nav.tour) { tourAt = null; return; }
    if (tourAt === null) tourAt = t + 0.3;
    if (t < tourAt) return;
    const before = G.nodes.length, r = nav.tourNext();
    if (r.idle) return;
    afterNav(before);
    say(r.text);
    tourAt = r.done ? null : t + 3.6;
  }

  // ---------- dibujo ----------
  function draw() {
    const w = sim.w, h = sim.h, dpr = cv.width / (w || 1), cam = sim.cam, k = cam.k, hl = highlighted(), acc = accent();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const x = ((s.x * w - cam.x * 0.03 * s.r) % w + w) % w, y = ((s.y * h - cam.y * 0.03 * s.r) % h + h) % h;
      ctx.globalAlpha = 0.55 * s.a * (0.65 + 0.35 * Math.sin(t * 1.3 + s.p)); ctx.fillStyle = '#dfe4ff'; ctx.beginPath(); ctx.arc(x, y, s.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w / 2 - cam.x * k), dpr * (h / 2 - cam.y * k));
    const hov = hover, hovE = hov && !hl.N ? new Set(G.adj.get(hov).map(e => e.l)) : null;
    const curN = nav.focus && nav.cursor >= 0 ? curNeighbor() : null;
    const bez = l => { const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; return { cx: (l.s.x + l.t.x) / 2 - dy * 0.12, cy: (l.s.y + l.t.y) / 2 + dx * 0.12 }; };
    // relaciones tenues
    ctx.lineWidth = 1 / k; ctx.strokeStyle = hl.N ? 'rgba(170,180,255,.05)' : 'rgba(170,180,255,.14)';
    ctx.beginPath();
    for (const l of G.links) { if (hl.E.has(l) || (hovE && hovE.has(l))) continue; const b = bez(l); ctx.moveTo(l.s.x, l.s.y); ctx.quadraticCurveTo(b.cx, b.cy, l.t.x, l.t.y); }
    ctx.stroke();
    // relaciones destacadas, con flujo
    const strong = [...hl.E, ...(hovE || [])];
    for (const l of strong) {
      if (l.s.hidden || l.t.hidden) continue;
      const b = bez(l), g = ctx.createLinearGradient(l.s.x, l.s.y, l.t.x, l.t.y);
      g.addColorStop(0, G.comms[l.s.c].color); g.addColorStop(1, G.comms[l.t.c].color);
      const isCur = curN && curN.l === l;
      ctx.globalAlpha = isCur ? 1 : hl.E.has(l) ? 0.75 : 0.5; ctx.strokeStyle = g; ctx.lineWidth = (isCur ? 3 : nav.path ? 2.6 : 1.7) / k;
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.quadraticCurveTo(b.cx, b.cy, l.t.x, l.t.y); ctx.stroke();
      if (!reduce) for (let j = 0; j < 2; j++) {
        const u = (t * 0.35 + l.h + j * 0.5) % 1, iu = 1 - u;
        const px = iu * iu * l.s.x + 2 * iu * u * b.cx + u * u * l.t.x, py = iu * iu * l.s.y + 2 * iu * u * b.cy + u * u * l.t.y;
        ctx.globalAlpha = 0.9 * Math.sin(Math.PI * u); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 1.8 / k, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // nodos (con degradado y brillo solo si no son demasiados)
    const fancy = G.nodes.length <= 600;
    for (const n of G.nodes) {
      const on = !hl.N || hl.N.has(n), col = G.comms[n.c].color, big = n === nav.focus || n === hov || (curN && curN.n === n);
      ctx.globalAlpha = on ? 1 : 0.18;
      if (fancy && on && (hl.N || n.deg > 6 || big)) {
        const gr = ctx.createRadialGradient(n.x, n.y, n.r * 0.5, n.x, n.y, n.r * (big ? 4.2 : 3));
        gr.addColorStop(0, col + (big ? '88' : '55')); gr.addColorStop(1, col + '00');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(n.x, n.y, n.r * (big ? 4.2 : 3), 0, 7); ctx.fill();
      }
      if (fancy) {
        const g = ctx.createRadialGradient(n.x - n.r * 0.35, n.y - n.r * 0.4, n.r * 0.1, n.x, n.y, n.r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.28, col); g.addColorStop(1, col + 'aa');
        ctx.fillStyle = g;
      } else ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // el foco: anillo y una lunita que lo orbita
    const f = nav.focus;
    if (f && !f.hidden) {
      const pr = f.r + 6 + (reduce ? 0 : Math.sin(t * 3) * 1.5);
      ctx.strokeStyle = acc; ctx.lineWidth = 2.2 / k; ctx.beginPath(); ctx.arc(f.x, f.y, pr, 0, 7); ctx.stroke();
      if (!reduce) {
        ctx.globalAlpha = 0.35; ctx.lineWidth = 1 / k; ctx.beginPath(); ctx.arc(f.x, f.y, pr + 8 + (t * 14 % 14), 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        const oa = t * 1.8, orr = pr + 9;
        ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(f.x + Math.cos(oa) * orr, f.y + Math.sin(oa) * orr * 0.8, 3.2 / Math.sqrt(k), 0, 7); ctx.fill();
      }
    }
    if (curN) {
      const n = curN.n; ctx.setLineDash([4 / k, 4 / k]); ctx.lineDashOffset = -t * 12 / k;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.6 / k; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 5, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    labels(w, h, hl.N, curN);
  }
  // etiquetas en pantalla, sin solaparse; las del foco, el cursor y el ratón van primero
  function labels(w, h, hlN, curN) {
    const k = sim.cam.k, f = nav.focus;
    ctx.setTransform(cv.width / (w || 1), 0, 0, cv.width / (w || 1), 0, 0);
    ctx.font = '500 12px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const pri = n => (n === f ? 0 : curN && curN.n === n ? 1 : n === hover ? 2 : hlN && hlN.has(n) ? 3 : 4);
    const cand = G.nodes.filter(n => pri(n) < 4 || (!hlN && n.r * k > 7.5)).sort((a, b) => pri(a) - pri(b) || b.deg - a.deg).slice(0, 90);
    const placed = [];
    for (const n of cand) {
      const p = sim.toScreen(n);
      if (p.x < -50 || p.x > w + 50 || p.y < -20 || p.y > h + 20) continue;
      const txt = n.label.length > 32 ? n.label.slice(0, 30) + '…' : n.label, tw = ctx.measureText(txt).width + 12;
      const bx = p.x - tw / 2, by = p.y + n.r * k + 5, bh = 19;
      if (pri(n) > 2 && placed.some(q => bx < q[0] + q[2] && bx + tw > q[0] && by < q[1] + q[3] && by + bh > q[1])) continue;
      placed.push([bx, by, tw, bh]);
      const strongL = pri(n) <= 1;
      ctx.fillStyle = strongL ? 'rgba(255,255,255,.94)' : 'rgba(10,12,28,.72)';
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, tw, bh, 9); else ctx.rect(bx, by, tw, bh); ctx.fill();
      ctx.fillStyle = strongL ? '#11132a' : 'rgba(238,240,255,.95)'; ctx.fillText(txt, p.x, by + 3.5);
    }
  }
  function highlighted() {
    const N = new Set(), E = new Set();
    if (nav.path) { nav.path.nodes.forEach(n => N.add(n)); nav.path.edges.forEach(e => E.add(e)); }
    else if (nav.focus) { N.add(nav.focus); G.adj.get(nav.focus).forEach(e => { N.add(e.n); E.add(e.l); }); }
    else if (nav.comm != null) { G.comms[nav.comm].list.forEach(n => N.add(n)); G.links.forEach(l => N.has(l.s) && N.has(l.t) && E.add(l)); }
    return { N: N.size ? N : null, E };
  }
  const curNeighbor = () => [...G.adj.get(nav.focus)].sort((a, b) => b.n.deg - a.n.deg || a.n.label.localeCompare(b.n.label))[nav.cursor] || null;
  function accent() { const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); return v || '#ffb27c'; }

  // ---------- ratón ----------
  const at = (x, y) => {
    const p = sim.toWorld(x, y); let best = null, bd = Infinity;
    for (const n of G.nodes) { const d = Math.hypot(n.x - p.x, n.y - p.y), lim = Math.max(n.r + 3, 9 / sim.cam.k); if (d < lim && d < bd) { bd = d; best = n; } }
    return best;
  };
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', e => {
    if (!sim) return;
    const { x, y } = pos(e), n = at(x, y);
    down = { x, y, sx: x, sy: y, n, moved: false }; cv.setPointerCapture(e.pointerId);
    if (nav.tour) { nav.stop(); render(); }
    sim.camT = null;
    if (n) n.pin = true; else cv.classList.add('drag');
  });
  cv.addEventListener('pointermove', e => {
    if (!sim) return;
    const { x, y } = pos(e);
    if (!down) { const n = at(x, y); if (n !== hover) { hover = n; cv.classList.toggle('pt', !!n); dirty = true; } return; }
    if (Math.hypot(x - down.sx, y - down.sy) > 4) down.moved = true;
    if (!down.moved) return;
    if (down.n) { const p = sim.toWorld(x, y); down.n.x = p.x; down.n.y = p.y; sim.heat(0.12); }
    else { sim.cam.x -= (x - down.x) / sim.cam.k; sim.cam.y -= (y - down.y) / sim.cam.k; }
    down.x = x; down.y = y; dirty = true;
  });
  cv.addEventListener('pointerup', () => {
    if (!down || !sim) return;
    const d = down; down = null; cv.classList.remove('drag');
    if (d.n) d.n.pin = false;
    if (d.moved) return;
    if (d.n) act(() => (d.n === nav.focus ? describe(G, d.n) : nav.focusOn(d.n)));
    else if (nav.focus || nav.comm != null) act(() => { nav.clearFocus(); return ''; });
  });
  cv.addEventListener('pointerleave', () => { if (!down) { hover = null; dirty = true; } });
  cv.addEventListener('dblclick', e => {
    if (!sim) return; const { x, y } = pos(e), n = at(x, y);
    if (n) sim.fit([n, ...[...G.adj.get(n)].map(a => a.n).filter(m => !m.hidden)], { instant: reduce });
  });
  cv.addEventListener('wheel', e => {
    if (!sim) return;
    e.preventDefault(); e.stopPropagation();
    const { x, y } = pos(e), before = sim.toWorld(x, y);
    sim.camT = null; sim.cam.k = clamp(sim.cam.k * Math.exp(-e.deltaY * 0.0015), 0.1, 5);
    const after = sim.toWorld(x, y); sim.cam.x += before.x - after.x; sim.cam.y += before.y - after.y; dirty = true;
  }, { passive: false });

  // ---------- tarjeta, leyenda y controles ----------
  card.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !nav) return;
    if (b.dataset.id) { const n = byId.get(b.dataset.id); if (n) act(() => nav.focusOn(n)); return; }
    const a = b.dataset.act;
    if (a === 'back') act(() => nav.back());
    if (a === 'hood' && nav.focus) { sim.fit([nav.focus, ...[...G.adj.get(nav.focus)].map(x => x.n).filter(m => !m.hidden)], { instant: reduce }); dirty = true; }
    if (a === 'tour') act(() => nav.startTour(nav.focus));
    if (a === 'clear') act(() => { nav.clearFocus(); return ''; });
  });
  legend.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !nav) return;
    const i = +b.dataset.c;
    act(() => { if (nav.comm === i) { nav.clearFocus(); return ''; } return nav.showCommunity(i); });
  });
  $(root, 'gvSearch').addEventListener('submit', e => {
    e.preventDefault();
    if (!nav) return;
    const input = $(root, 'gvQ'), q = input.value, n = find(G, q);
    if (n) { act(() => nav.focusOn(n)); input.value = ''; input.blur(); } else say(`No encuentro «${q}».`);
  });
  $(root, 'gvQ').addEventListener('change', () => {
    if (!nav) return;
    const input = $(root, 'gvQ'), n = G.all.nodes.find(x => x.label === input.value);
    if (n) { act(() => nav.focusOn(n)); input.value = ''; }
  });
  $(root, 'gvTourB').onclick = () => act(() => nav.startTour(nav.focus));
  $(root, 'gvFitB').onclick = () => act(() => { nav.clearFocus(); return ''; });
  $(root, 'gvClose').onclick = () => { view.close(); onClose(); };
  stale.onclick = () => onReload();

  // ---------- teclado ----------
  addEventListener('keydown', e => {
    if (!isOpen) return;
    const tag = (e.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea';
    if (e.key === 'Escape') {
      if (typing || !escapeFree()) return;
      e.stopImmediatePropagation(); view.close(); onClose(); return;
    }
    if (typing || e.altKey || e.metaKey || e.ctrlKey || !nav) return;
    if (e.key === '/') { e.preventDefault(); $(root, 'gvQ').focus(); return; }
    if (tag === 'button') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); act(() => nav.moveCursor(1)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); act(() => nav.moveCursor(-1)); }
    else if (e.key === 'Enter') { e.preventDefault(); act(() => nav.enter()); }
    else if (e.key === 'Backspace') { e.preventDefault(); act(() => nav.back()); }
    else if (e.key === 'f') act(() => { nav.clearFocus(); return ''; });
  }, true);
  addEventListener('resize', () => { if (isOpen) resize(); });

  return view;
}
