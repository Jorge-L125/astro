// Navegación por el grafo, frases que Astro entiende solo y el contexto que se manda al motor. Puro (sin DOM ni reloj),
// portado del prototipo `Astro v3.html` (gvFocus, gvReply, gvCard…). La vista mueve cámara y mirada con `nav.last`.
import { find, shortestPath, tourOrder, top, neighbors, describe, reveal, esc, norm } from './graph-model.js';

const clean = s => norm(s).replace(/[¿?¡!.,;:«»"'()]/g, ' ').replace(/\s+/g, ' ').trim();
const words = t => (t ? t.split(' ').length : 0);
// «grafo» como palabra suelta: un nodo que se llame «graphify-map» no cuenta.
const GRAPH_WORD = /(?<![\w-])(grafo|graph|graphify|mapa de (?:conocimiento|codigo)|knowledge graph)(?![\w-])/;
const CLOSE_WORD = /\b(cierra|cerrar|oculta|ocultar|esconde|quita|salir|sal)\b/;
const GOTO = /(?:^|\s)(?:ve a|vamos a|ir a|llevame a|busca|buscar|encuentra|muestrame|muestra|donde esta|enfoca|selecciona|abre|ensename)\s+(.+)$/;
const PATH = /(?:camino|ruta|conexion|como (?:llego|voy)) (?:de|desde|entre) (.+?) (?:a|y|hasta|con|hacia) (.+)$/;

/** Qué hace el usuario con el visor cerrado: abrirlo (con un nodo al que ir) o cerrarlo; null si es otra cosa. */
export function graphRequest(text) {
  const t = clean(text);
  if (!t || words(t) > 8 || !GRAPH_WORD.test(t)) return null;
  if (CLOSE_WORD.test(t)) return { close: true, target: null };
  if (!/\b(muestra|muestrame|abre|abrir|ver|ensename|mira)\b/.test(t) && !/^(el )?(grafo|graph|graphify|mapa)/.test(t)) return null;
  const rest = t.replace(/^.*?(?<![\w-])(grafo|graph|graphify)(?![\w-])/, '');
  const m = /(?:de|sobre|en) (.+)$/.exec(rest);
  return { close: false, target: m ? m[1] : null };
}

export function createNav(G) {
  const nav = {
    G, focus: null, cursor: -1, hist: [], path: null, tour: null, comm: null, last: {},

    focusOn(n, o = {}) {
      if (!o.fromTour) nav.tour = null;
      if (nav.focus && n && nav.focus !== n && !o.noHist) nav.hist.push(nav.focus);
      if (nav.hist.length > 60) nav.hist.shift();
      if (n && n.hidden) reveal(G, [n, ...neighbors(G, n).map(e => e.n).filter(m => m.hidden)]);
      nav.focus = n; nav.cursor = -1; nav.path = o.path || null;
      if (n) nav.comm = null;
      nav.last = n && !o.path ? { fly: n, look: n } : {};
      return n ? describe(G, n) : '';
    },

    clearFocus() {
      nav.tour = null; nav.focus = null; nav.cursor = -1; nav.path = null; nav.comm = null;
      nav.last = { fit: null };
    },

    moveCursor(d) {
      if (!nav.focus) return 'Primero elige un nodo: dime «ve a …».';
      const nb = neighbors(G, nav.focus);
      if (!nb.length) return `${nav.focus.label} no tiene vecinos.`;
      nav.cursor = ((nav.cursor < 0 ? (d > 0 ? -1 : 0) : nav.cursor) + d + nb.length) % nb.length;
      const e = nb[nav.cursor];
      nav.last = { look: e.n };
      return `${nav.cursor + 1}/${nb.length}: ${e.n.label} (${e.out ? '' : '← '}${e.l.rel}). Di «entra» para ir.`;
    },

    enter() {
      if (!nav.focus || nav.cursor < 0) return nav.focus ? 'Dime «siguiente» para elegir un vecino.' : 'Primero elige un nodo.';
      return nav.focusOn(neighbors(G, nav.focus)[nav.cursor].n);
    },

    back() {
      const p = nav.hist.pop();
      if (!p) return 'Ya estamos al principio.';
      nav.focusOn(p, { noHist: true });
      return `De vuelta en ${p.label}.`;
    },

    showPath(a, b) {
      const p = shortestPath(G, a, b);
      if (!p) return `No hay camino entre ${a.label} y ${b.label}.`;
      reveal(G, p.nodes);
      nav.tour = null; nav.focus = b; nav.cursor = -1; nav.path = p; nav.comm = null;
      nav.last = { fit: p.nodes, look: b };
      const chain = p.nodes.length > 6 ? [...p.nodes.slice(0, 3).map(n => n.label), '…', p.nodes.at(-1).label] : p.nodes.map(n => n.label);
      return `${p.nodes.length - 1} salto${p.nodes.length === 2 ? '' : 's'}: ${chain.join(' → ')}`;
    },

    startTour(start) {
      start = start || top(G);
      const q = tourOrder(G, start);
      nav.tour = { q, i: 0 };
      nav.last = {};
      return `¡Vamos! Te enseño ${q.length} nodos empezando por ${start.label}.`;
    },

    /** El siguiente paso del recorrido: { node, text }, { done, text } al acabar o { idle } si no hay recorrido. */
    tourNext() {
      if (!nav.tour) return { idle: true };
      const n = nav.tour.q[nav.tour.i++];
      if (!n) { nav.tour = null; nav.last = {}; return { done: true, text: 'Fin del recorrido. ¿A dónde vamos ahora?' }; }
      const text = nav.focusOn(n, { fromTour: true, noHist: true });
      return { node: n, text };
    },

    stop() {
      if (!nav.tour) return '';
      nav.tour = null;
      return 'Me detengo aquí.';
    },

    showCommunity(i) {
      const c = G.comms[i];
      nav.tour = null; nav.focus = null; nav.cursor = -1; nav.path = null; nav.comm = i;
      reveal(G, c.list);
      nav.last = { fit: c.list };
      return `${c.name}: ${c.list.length} nodos.`;
    },
  };
  return nav;
}

/** Lo que Astro entiende solo con el visor abierto. null = no es una orden de navegación (va al motor). */
export function reply(nav, text) {
  nav.last = {};
  const G = nav.G, t = clean(text), N = words(t);
  if (!t) return null;
  const isG = GRAPH_WORD.test(t), goto = GOTO.exec(t);
  let m;

  if (CLOSE_WORD.test(t) && (isG || /^(cierra|cerrar|salir|sal)$/.test(t))) { nav.stop(); nav.last = { close: true }; return 'Grafo guardado. Aquí sigo.'; }

  if ((m = PATH.exec(t))) {
    const a = find(G, m[1]), b = find(G, m[2]);
    if (!a || !b) return `No encuentro «${!a ? m[1] : m[2]}» en el grafo.`;
    return nav.showPath(a, b);
  }

  if (N <= 4 && nav.tour && /\b(para|detente|deten|basta|stop|quieto|pausa)\b/.test(t)) return nav.stop();
  if (N <= 7 && /recorrido|tour|guiame|paseo/.test(t)) return nav.startTour(nav.focus);
  if (N <= 4 && /\b(siguiente|proximo|otro)\b/.test(t)) return nav.moveCursor(1);
  if (N <= 4 && /\b(anterior|previo)\b/.test(t)) return nav.moveCursor(-1);
  if (/^(entra|entrar|ve ahi|vamos ahi|ese|esa|ir ahi|ok entra|dale)$/.test(t)) return nav.enter();
  if (N <= 4 && /\b(atras|volver|vuelve|regresa|regresar)\b/.test(t)) return nav.back();

  if (N <= 8 && /mas (conectad|important|central)|nodo principal|el centro|hub/.test(t)) { const n = top(G); nav.focusOn(n); return `El más conectado es ${describe(G, n)}`; }
  if (N <= 5 && /\b(aleja|vista general|todo el grafo|panorama|ajusta|completo)\b/.test(t)) { nav.clearFocus(); return 'Vista completa del grafo.'; }
  if (N <= 6 && isG && !goto) { nav.clearFocus(); return 'Aquí está el grafo completo.'; }
  if (N <= 3 && /\b(acerca|zoom|mas cerca)\b/.test(t)) { nav.last = { zoom: 1.7 }; return 'Más cerca.'; }

  if (N <= 6 && /\b(comunidad|cluster|grupo)\b/.test(t)) {
    if (nav.focus) return nav.showCommunity(nav.focus.c);
    return `Hay ${G.comms.length} comunidades: ${G.comms.slice(0, 4).map(c => c.name).join(', ')}${G.comms.length > 4 ? '…' : ''}.`;
  }
  if (N <= 6 && nav.focus && !goto && /\b(vecin|conexiones|relaciones|conectad)/.test(t)) {
    const nb = neighbors(G, nav.focus);
    nav.last = { fit: [nav.focus, ...nb.map(e => e.n)] };
    return nb.length ? `${nav.focus.label} se conecta con ${nb.slice(0, 5).map(e => e.n.label).join(', ')}${nb.length > 5 ? ` y ${nb.length - 5} más` : ''}. Di «siguiente» para recorrerlos.` : `${nav.focus.label} está solito.`;
  }

  if (goto) {
    const n = find(G, goto[1]);
    if (n) return nav.focusOn(n);
    // una petición larga que no es un nombre («busca por qué falla el build…») es una pregunta: va al motor
    return words(goto[1]) > 3 ? null : `No encuentro «${goto[1]}» en el grafo.`;
  }
  if (N <= 3) { const n = find(G, t, true); if (n) return nav.focusOn(n); }
  return null;
}

/** El contexto que viaja al motor con una pregunta libre: qué está mirando el usuario. Una sola cadena, sin HTML. */
export function engineContext(nav) {
  const G = nav.G, head = `[Contexto: el usuario mira en Astro el grafo del proyecto «${G.title}» (${G.total.nodes} nodos en ${G.comms.length} comunidades${G.capped ? `; mostrando solo los ${G.nodes.length} más conectados de ${G.total.nodes}` : ''}).`;
  const n = nav.focus;
  if (!n) return `${head} Ningún nodo elegido; los más conectados: ${[...G.nodes].sort((a, b) => b.deg - a.deg).slice(0, 5).map(x => `«${x.label}»`).join(', ')}.]`;
  const nb = neighbors(G, n);
  const meta = [n.type, n.file && n.file + (n.loc ? ':' + n.loc : '')].filter(Boolean).join(', ');
  const list = nb.slice(0, 12).map(e => `${e.out ? '→' : '←'} ${e.l.rel} «${e.n.label}»`).join('; ');
  return `${head} Nodo elegido: «${n.label}»${meta ? ` (${meta})` : ''}, ${nb.length} conexi${nb.length === 1 ? 'ón' : 'ones'}${list ? `: ${list}` : ''}${nb.length > 12 ? `; y ${nb.length - 12} más` : ''}.]`;
}

/** La tarjeta lateral (HTML). Todo lo que viene del grafo se escapa. */
export function cardHtml(nav) {
  const G = nav.G, n = nav.focus;
  const dot = c => `<i style="color:${c};background:${c}"></i>`;
  if (!n) {
    const best = [...G.nodes].sort((a, b) => b.deg - a.deg).slice(0, 6);
    return `<span class="gv-chip">${dot('var(--accent)')}Astro te guía</span><h3>${esc(G.title)}</h3>
      <p>${G.total.nodes} nodos en ${G.comms.length} comunidades. Arrastra para moverte, rueda para acercar, clic en un nodo para verlo.</p>
      <div class="gv-h">Más conectados</div><div class="gv-nbs">${best.map(t => `<button class="gv-nb" type="button" data-id="${esc(t.id)}">${dot(G.comms[t.c].color)}<span>${esc(t.label)}</span><small>${t.deg}</small></button>`).join('')}</div>
      <div class="gv-h">Pídele a Astro</div><ul class="gv-tips"><li><b>«ve a ${esc(best[0] ? best[0].label : '…')}»</b> o «busca …»</li><li><b>«siguiente» / «anterior»</b> y <b>«entra»</b> para caminar</li>
      <li><b>«camino de A a B»</b> para la ruta más corta</li><li><b>«recorrido»</b> para un paseo guiado</li><li><b>«atrás»</b>, «vista general», «cierra el grafo»</li><li>Cualquier otra pregunta se la paso a tu asistente con este nodo como contexto</li></ul>
      <p style="margin-top:10px">Teclado: ← → elegir · Enter entrar · Retroceso atrás · / buscar · Esc cerrar</p>`;
  }
  const c = G.comms[n.c], nb = neighbors(G, n);
  const pathHtml = nav.path ? `<div class="gv-h">Camino · ${nav.path.nodes.length - 1} saltos</div><div class="gv-nbs">${nav.path.nodes.map((p, i) => `<button class="gv-nb" type="button" data-id="${esc(p.id)}">${dot(G.comms[p.c].color)}<span>${i + 1}. ${esc(p.label)}</span><small></small></button>`).join('')}</div>` : '';
  return `<span class="gv-chip">${dot(c.color)}${esc(c.name)}</span><h3>${esc(n.label)}</h3>
    ${n.desc ? `<p>${esc(n.desc)}</p>` : ''}
    <dl class="gv-meta">${n.type ? `<dt>Tipo</dt><dd>${esc(n.type)}</dd>` : ''}${n.file ? `<dt>Archivo</dt><dd>${esc(n.file)}${n.loc ? ':' + esc(n.loc) : ''}</dd>` : ''}<dt>Grado</dt><dd>${n.deg}</dd></dl>
    ${pathHtml}
    <div class="gv-h">Conexiones · ${nb.length}</div>
    <div class="gv-nbs">${nb.map((e, i) => `<button class="gv-nb${i === nav.cursor ? ' cur' : ''}" type="button" data-id="${esc(e.n.id)}">${dot(G.comms[e.n.c].color)}<span>${esc(e.n.label)}</span><small>${e.out ? '→' : '←'} ${esc(e.l.rel)}</small></button>`).join('')}</div>
    <div class="gv-row"><button class="gv-btn" type="button" data-act="back"${nav.hist.length ? '' : ' disabled'}>← Atrás</button><button class="gv-btn" type="button" data-act="hood">Vecindario</button><button class="gv-btn" type="button" data-act="tour">Recorrido desde aquí</button><button class="gv-btn" type="button" data-act="clear">Soltar</button></div>`;
}
