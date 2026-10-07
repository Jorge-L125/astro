import { createGota } from './gota.js';

const api = window.astro;
const $ = id => document.getElementById(id);
const root = document.documentElement, body = document.body;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = a => a[Math.floor(Math.random() * a.length)];
let uid = 0;
const newId = () => `r${Date.now().toString(36)}${(uid++).toString(36)}`;

/* ---------- ajustes ---------- */
const COLORS = ['#ff6b4a', '#ff9f1c', '#f2c94c', '#8fd14f', '#2ec4a6', '#3a8bff', '#6c5ce7', '#ff6fb5', '#3b3a40'];
const SESS_COLORS = ['#3a8bff', '#8fd14f', '#6c5ce7', '#ff6fb5', '#f2c94c', '#2ec4a6', '#ff6b4a'];
const AGENT_COLORS = ['#3a8bff', '#8fd14f', '#ff6fb5', '#f2c94c', '#6c5ce7', '#2ec4a6'];
const MAX_SESSIONS = 6;
const store = {
  get(k, d) { try { const v = localStorage.getItem('astro-' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('astro-' + k, v); } catch { /* sin almacenamiento */ } },
};
const cfg = { color: store.get('color', '#ff6b4a'), side: store.get('side', 'right'), theme: store.get('theme', 'auto') };
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = v => clamp(Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt), 0, 255);
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(x => x.toString(16).padStart(2, '0')).join('');
}
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/* ---------- sesiones ---------- */
// Cada sesión es una conversación propia con Claude Code: su historial, sus nubes y sus ayudantes.
let seq = 0;
function mkSession(name, color) {
  const clouds = document.createElement('div');
  clouds.className = 'clouds';
  clouds.setAttribute('aria-live', 'polite');
  return { id: ++seq, name, color, renamed: false, claudeId: null, history: [], busy: false, mood: 'neutral', clouds, agents: [], tasksEl: null, ids: new Set(), pending: null };
}
const sessions = [];
let active = mkSession('Principal', cfg.color);
sessions.push(active);
$('cloudslot').append(active.clouds);

/* ---------- personaje ---------- */
const gota = createGota($('char'), {
  color: active.color,
  side: cfg.side === 'left' ? -1 : 1,
  sessionId: active.id,
  zzzHost: $('zzz'),
  say: quip,
  onClick: () => (askEl ? closeAsk() : openAsk()),
  onModeChange: m => {
    body.classList.toggle('minimized', m === 'minimizing' || m === 'minimized');
    if (m === 'minimizing') { closeAsk(); closePanel(); toggleSettings(false); }
    if (m === 'awake' && afterRestore) { const fn = afterRestore; afterRestore = null; setTimeout(fn, 250); }
  },
  onMiniClick: id => {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    if (gota.isMinimized()) restoreThen(() => switchTo(s));
    else switchTo(s);
  },
  onAgentClick: id => { const a = active.agents.find(x => x.id === id); if (a) openAgent(a); },
  onAgentHover: id => highlightTask(id),
  onSwitched: id => onSwitched(id),
});

let afterRestore = null;
function restoreThen(fn) { afterRestore = fn; gota.restore(); }

function setMood(s, m) { s.mood = m; if (s === active) gota.setMood(m); }

function applyAccent() {
  const c = active.color;
  root.style.setProperty('--accent', c);
  root.style.setProperty('--on-accent', lum(c) > 0.45 ? '#1f2633' : '#ffffff');
  root.style.setProperty('--accent-ink', shade(c, -0.35));
  [...$('swatches').querySelectorAll('.sw')].forEach(s => s.setAttribute('aria-pressed', String(s.dataset.c === c)));
}
function setSessionColor(c) {
  active.color = c;
  if (active === sessions[0]) { cfg.color = c; store.set('color', c); }
  gota.setColor(c);
  applyAccent();
  renderSessions();
}
function applyLayout() {
  body.classList.toggle('left-side', cfg.side === 'left');
  gota.setSide(cfg.side === 'left' ? -1 : 1);
  if (cfg.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = cfg.theme;
  for (const [id, key] of [['seg-side', 'side'], ['seg-theme', 'theme']]) {
    [...$(id).children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === cfg[key])));
  }
}
COLORS.forEach(c => {
  const b = document.createElement('button');
  b.className = 'sw'; b.style.setProperty('--c', c); b.dataset.c = c; b.setAttribute('aria-label', 'Color ' + c);
  b.onclick = () => { setSessionColor(c); gota.react('happy', 1200); gota.act('giggle'); };
  $('swatches').append(b);
});
const custom = document.createElement('label');
custom.className = 'custom'; custom.title = 'Color personalizado';
custom.innerHTML = '+<input type="color" aria-label="Color personalizado">';
custom.querySelector('input').addEventListener('input', e => setSessionColor(e.target.value));
$('swatches').append(custom);
for (const [id, key] of [['seg-side', 'side'], ['seg-theme', 'theme']]) {
  $(id).addEventListener('click', e => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v) return;
    cfg[key] = v; store.set(key, v); applyLayout();
  });
}
function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  body.classList.toggle('settings-open', open);
  $('bSettings').setAttribute('aria-expanded', String(open));
  if (open) gota.react('curious', 1200);
}
$('bSettings').onclick = () => toggleSettings();
$('bAsk').onclick = () => (askEl ? closeAsk() : openAsk());
$('bNew').onclick = () => newSession();
$('bReset').onclick = () => resetConversation(active);
$('bMin').onclick = () => gota.minimize();
$('bQuit').onclick = () => api.quit();
addEventListener('pointerdown', e => {
  if (!$('settings').hidden && !$('settings').contains(e.target) && !$('bSettings').contains(e.target)) toggleSettings(false);
});

/* ---------- clics que atraviesan la ventana ---------- */
// La ventana cubre toda la pantalla; solo captura el ratón sobre la gota y los elementos .hit.
let ignoring = true;
function updateIgnore(x, y) {
  const el = document.elementFromPoint(x, y);
  let hit = !!(el && el.closest('.hit'));
  if (!hit && el && el.closest('#char')) hit = gota.hitTest(x, y);
  if (gota.isDragging()) hit = true;
  if (hit === ignoring) { ignoring = !hit; api.setIgnore(ignoring); }
}
addEventListener('mousemove', e => updateIgnore(e.clientX, e.clientY));

/* ---------- nubes ---------- */
let askEl = null;
function stickToBottom(s) { s.clouds.scrollTop = s.clouds.scrollHeight; }
function clearClouds(s) { s.clouds.innerHTML = ''; s.tasksEl = null; if (s === active) askEl = null; }
function cloud(s, cls) {
  s.clouds.querySelectorAll('.cloud.tail').forEach(c => c.classList.remove('tail'));
  s.clouds.querySelectorAll('.cloud:not(.ask):not(.tasks)').forEach(c => c.classList.add('old'));
  const d = document.createElement('div');
  d.className = 'cloud tail hit ' + (cls || '');
  s.clouds.append(d);
  stickToBottom(s);
  return d;
}
function typeInto(s, el, text) {
  return new Promise(res => {
    if (s === active) gota.talk(text.length);
    if (reduce) { el.textContent = text; stickToBottom(s); return res(); }
    setMood(s, 'talking');
    let i = 0;
    const t = setInterval(() => {
      i += 2; el.textContent = text.slice(0, i); stickToBottom(s);
      if (i >= text.length) { clearInterval(t); res(); }
    }, 18);
  });
}
// Frases sueltas de personalidad; no interrumpen una conversación en curso.
function quip(text) {
  gota.talk(text.length);
  if (active.busy || askEl || body.classList.contains('minimized')) return;
  const c = cloud(active, 'quip');
  c.textContent = text;
  setTimeout(() => c.remove(), 2800);
}

function openAsk() {
  if (active.busy || gota.isSwapping()) return;
  if (gota.isMinimized()) { restoreThen(openAsk); return; }
  if (askEl) { askEl.querySelector('textarea').focus(); return; }
  gota.wake();
  gota.react('surprised', 500);
  active.clouds.querySelectorAll('.quip').forEach(c => c.remove());
  askEl = cloud(active, 'ask');
  askEl.classList.remove('old');
  askEl.innerHTML = '<textarea rows="1" aria-label="Tu pregunta" placeholder="¿En qué te ayudo?"></textarea><button class="send" aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>';
  const ta = askEl.querySelector('textarea'), b = askEl.querySelector('.send');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; gota.react('curious', 800); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); b.click(); }
    if (e.key === 'Escape') { closeAsk(); api.blur(); }
  });
  b.onclick = () => { const v = ta.value.trim(); if (v) ask(active, v); };
  ta.focus();
}
function closeAsk() { if (askEl) askEl.remove(); askEl = null; }

function showChoice(s, choice) {
  const c = cloud(s, 'choice'), multi = !!choice.multi, picked = new Set();
  const h = document.createElement('h3'); h.textContent = choice.prompt || '¿Qué prefieres?';
  const ul = document.createElement('ul'); ul.className = 'opts';
  const go = document.createElement('button'); go.className = 'btn'; go.textContent = 'Continuar'; go.disabled = true; go.hidden = !multi;
  (choice.options || []).slice(0, 6).forEach(o => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.className = 'opt'; b.textContent = o;
    if (multi) b.setAttribute('aria-pressed', 'false');
    b.onclick = () => {
      if (multi) { const on = !picked.has(o); on ? picked.add(o) : picked.delete(o); b.setAttribute('aria-pressed', String(on)); go.disabled = !picked.size; }
      else { c.remove(); ask(s, o); }
    };
    li.append(b); ul.append(li);
  });
  const li = document.createElement('li'), oth = document.createElement('button');
  oth.className = 'opt other'; oth.textContent = 'Otra respuesta…';
  oth.onclick = () => { c.remove(); if (s === active) openAsk(); };
  li.append(oth); ul.append(li);
  const row = document.createElement('div'); row.className = 'row';
  const hint = document.createElement('small'); hint.textContent = multi ? 'Puedes marcar varias' : 'Flechas para moverte';
  go.onclick = () => { c.remove(); ask(s, [...picked].join(', ')); };
  row.append(hint, go); c.append(h, ul, row);
  ul.addEventListener('keydown', e => {
    const bs = [...ul.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length].focus(); }
  });
  stickToBottom(s);
}

/* ---------- markdown simple ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
function mdBlock(b) {
  const L = b.split('\n');
  if (L.every(l => /^\s*[-*] /.test(l))) return '<ul>' + L.map(l => '<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>').join('') + '</ul>';
  if (L.every(l => /^\s*\d+[.)] /.test(l))) return '<ol>' + L.map(l => '<li>' + inline(l.replace(/^\s*\d+[.)] /, '')) + '</li>').join('') + '</ol>';
  if (/^#{1,4} /.test(b)) return '<h4>' + inline(b.replace(/^#+ /, '')) + '</h4>';
  return '<p>' + L.map(inline).join('<br>') + '</p>';
}
function md(src) {
  return String(src || '').split('```').map((p, i) => {
    if (i % 2) { const nl = p.indexOf('\n'); return '<pre><code>' + esc((nl >= 0 ? p.slice(nl + 1) : p).replace(/\n$/, '')) + '</code></pre>'; }
    return p.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).map(mdBlock).join('');
  }).join('');
}

/* ---------- panel de hojas ---------- */
const blobIco = c => `<svg viewBox="0 0 40 40"><path d="M20 3c6 7 13 13 13 21a13 13 0 0 1-26 0C7 16 14 10 20 3z" fill="${c}"/><rect x="14" y="20" width="3.4" height="7" rx="1.7" fill="#141416"/><rect x="22.6" y="20" width="3.4" height="7" rx="1.7" fill="#141416"/></svg>`;
let panelAgent = null;
function openShell(title, sub, ico) {
  $('ptitle').textContent = title; $('ptitle').title = title; $('psub').textContent = sub; $('pico').innerHTML = ico;
  $('tabs').innerHTML = ''; $('tabs').hidden = true;
  $('pbody').innerHTML = ''; $('pbody').scrollTop = 0;
  body.classList.add('panel-open'); $('panel').setAttribute('aria-hidden', 'false');
}
function closePanel() { body.classList.remove('panel-open'); $('panel').setAttribute('aria-hidden', 'true'); panelAgent = null; }
$('close').onclick = closePanel;

function buildSheets(data) {
  const sheets = [];
  const text = data.detail ? String(data.detail).split(/\n{2,}/) : [];
  let cur = [], len = 0;
  for (const p of text.map(s => s.trim()).filter(Boolean)) {
    if (len && len + p.length > 750) { sheets.push({ kind: 'text', text: cur.join('\n\n') }); cur = []; len = 0; }
    cur.push(p); len += p.length;
  }
  if (cur.length) sheets.push({ kind: 'text', text: cur.join('\n\n') });
  if (data.code && data.code.content) sheets.push({ kind: 'code', code: data.code });
  return sheets;
}
function showSheetsButton(s, sheets, title) {
  const b = document.createElement('button');
  b.className = 'sheets hit';
  b.innerHTML = '<span class="stack"><span></span><span></span><span></span><b></b></span><span class="lbl"><strong>Ver respuesta completa</strong><small></small></span>';
  b.querySelector('b').textContent = sheets.length;
  b.querySelector('small').textContent = sheets.length === 1 ? '1 hoja' : sheets.length + ' hojas';
  b.onclick = () => openSheets(sheets, title);
  s.clouds.append(b);
  stickToBottom(s);
}
function openSheets(sheets, title) {
  panelAgent = null;
  openShell(title || 'Respuesta completa', sheets.length === 1 ? '1 hoja' : sheets.length + ' hojas', blobIco(active.color));
  const pb = $('pbody'), tabs = $('tabs');
  sheets.forEach((s, i) => {
    const art = document.createElement('article');
    art.className = 'sheet' + (s.kind === 'code' ? ' codesheet' : '');
    art.id = 'sheet-' + i;
    if (s.kind === 'code') {
      art.innerHTML = '<div class="codebar"><span></span><button>Copiar</button></div><pre><code></code></pre>';
      art.querySelector('span').textContent = 'Hoja ' + (i + 1) + ' · ' + (s.code.lang || 'código');
      art.querySelector('code').textContent = s.code.content;
      const cb = art.querySelector('button');
      cb.onclick = async () => {
        try { await navigator.clipboard.writeText(s.code.content); cb.textContent = 'Copiado'; } catch { cb.textContent = 'Selecciona y copia'; }
        setTimeout(() => { cb.textContent = 'Copiar'; }, 1600);
      };
    } else {
      art.innerHTML = '<p class="n"></p>' + md(s.text);
      art.querySelector('.n').textContent = 'Hoja ' + (i + 1) + ' de ' + sheets.length;
    }
    pb.append(art);
    const t = document.createElement('button');
    t.className = 'tab' + (i ? '' : ' on');
    t.textContent = s.kind === 'code' ? 'Código' : 'Hoja ' + (i + 1);
    t.onclick = () => art.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    tabs.append(t);
  });
  tabs.hidden = sheets.length < 2;
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { const i = +e.target.id.split('-')[1]; [...tabs.children].forEach((t, j) => t.classList.toggle('on', i === j)); }
  }), { root: pb, threshold: 0.5 });
  pb.querySelectorAll('.sheet').forEach(s => io.observe(s));
}

/* ---------- ayudantes: mini-gotas que orbitan + lista en una nube ---------- */
let agentSeq = 0;
const ST_LABEL = { working: 'Trabajando', done: 'Listo', error: 'Error' };
function renderTasks(s) {
  if (!s.agents.length) { if (s.tasksEl) { s.tasksEl.remove(); s.tasksEl = null; } return; }
  const created = !s.tasksEl;
  if (created) {
    s.tasksEl = document.createElement('div');
    s.tasksEl.className = 'cloud tasks hit';
    s.clouds.append(s.tasksEl);
  }
  const n = s.agents.filter(a => a.status === 'working').length;
  s.tasksEl.innerHTML = '';
  const ttl = document.createElement('p');
  ttl.className = 'ttl';
  ttl.textContent = n ? `Ayudantes · ${n} trabajando` : 'Ayudantes · terminaron';
  s.tasksEl.append(ttl);
  const atBottom = s.clouds.scrollHeight - s.clouds.scrollTop - s.clouds.clientHeight < 80;
  for (const a of s.agents) {
    const row = document.createElement('button');
    row.className = 'task'; row.dataset.id = a.id;
    row.innerHTML = '<span class="dot"></span><span><b></b><small></small></span><span class="st"></span>';
    row.querySelector('.dot').style.background = a.color;
    row.querySelector('b').textContent = a.name;
    row.querySelector('small').textContent = a.activity || a.task;
    const st = row.querySelector('.st');
    st.className = 'st ' + a.status; st.textContent = ST_LABEL[a.status];
    row.onclick = () => openAgent(a);
    row.onmouseenter = () => gota.highlightAgent(a.id);
    row.onmouseleave = () => gota.highlightAgent(null);
    s.tasksEl.append(row);
  }
  if (atBottom || created) stickToBottom(s);
}
function highlightTask(id) {
  if (!active.tasksEl) return;
  active.tasksEl.querySelectorAll('.task').forEach(r => { r.style.background = String(id) === r.dataset.id ? 'color-mix(in srgb,var(--ink) 7%,transparent)' : ''; });
}
function setAgentStatus(s, a, status) {
  a.status = status;
  gota.finishAgent(a.id, status === 'done');
  if (s === active && status === 'error') quip(`${a.name} tuvo un problema.`);
  renderTasks(s);
  if (panelAgent === a) renderAgent(a);
}
function openAgent(a) { panelAgent = a; openShell('Ayudante · ' + a.name, '', blobIco(a.color)); renderAgent(a); }
function renderAgent(a) {
  $('psub').textContent = a.status === 'working' ? 'Trabajando ahora' : a.status === 'done' ? 'Tarea terminada' : 'No pudo terminar';
  const pb = $('pbody');
  const atBottom = pb.scrollHeight - pb.scrollTop - pb.clientHeight < 40;
  pb.innerHTML = `<article class="sheet"><p class="label">Tarea asignada</p><p>${inline(a.task)}</p>
    <span class="status-chip ${a.status === 'done' ? 'ok' : a.status === 'error' ? 'err' : ''}">${a.status === 'working' ? '● Trabajando' : a.status === 'done' ? '✓ Terminado' : '! Error'}</span>
    ${a.status === 'working' && a.activity ? `<p class="activity">${esc(a.activity)}…</p>` : ''}</article>
    <article class="sheet"><p class="label">${a.status === 'working' ? 'Lo que lleva hasta ahora' : 'Resultado'}</p>
    <div class="${a.status === 'working' ? 'caret' : ''}">${a.output ? md(a.output) : '<p style="color:var(--muted)">Analizando la tarea…</p>'}</div></article>`;
  if (atBottom) pb.scrollTop = pb.scrollHeight;
}
function clearAgents(s) { s.agents = []; renderTasks(s); gota.clearAgents(s.id); }

/* ---------- conversación con Claude Code ---------- */
const listeners = new Map();
api.on('claude:event', ev => { const fn = listeners.get(ev.id); if (fn) fn(ev); });

async function call(s, kind, payload, onEvent) {
  const id = newId();
  s.ids.add(id);
  if (onEvent) listeners.set(id, onEvent);
  try {
    const r = await api[kind]({ id, ...payload });
    if (!r.ok) throw { code: r.code, message: r.message };
    return r;
  } finally {
    s.ids.delete(id);
    listeners.delete(id);
  }
}
function cancelAll(s) { for (const id of s.ids) api.cancel(id); }

const transcript = s => s.history.map(h => (h.role === 'user' ? 'Usuario: ' + h.text : 'Astro: ' + JSON.stringify(h.data))).join('\n');
function errLines(e) {
  const code = e && e.code;
  if (code === 'cancelled') return ['Listo, me detuve.'];
  if (code === 'not_found') return ['No encuentro el comando claude. ¿Está instalado y en el PATH?'];
  if (code === 'bad') return ['Claude respondió en un formato que no entendí. ¿Lo intentamos otra vez?'];
  const msg = String((e && e.message) || '').replace(/\s+/g, ' ').slice(0, 110);
  return ['Algo falló al hablar con Claude.', msg || 'Prueba de nuevo en un momento.'];
}
function thinkingCloud(s) {
  const t = cloud(s);
  t.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><button class="stop">Detener</button><span class="status"></span>';
  t.querySelector('.stop').onclick = () => cancelAll(s);
  return t;
}
const progressInto = el => ev => {
  if (ev.type === 'tool') { const st = el.querySelector('.status'); if (st) st.textContent = ev.label + '…'; }
};

async function runAgent(s, a) {
  try {
    const r = await call(s, 'agent', { name: a.name, task: a.task, transcript: transcript(s) }, ev => {
      if (ev.type === 'text') a.output = (a.output ? a.output + '\n\n' : '') + ev.text;
      if (ev.type === 'tool') { a.activity = ev.label; renderTasks(s); }
      if (panelAgent === a) renderAgent(a);
    });
    a.output = r.text || a.output;
    setAgentStatus(s, a, 'done');
  } catch (e) {
    a.output += (a.output ? '\n\n' : '') + '**No pudo terminar:** ' + (e && e.code === 'cancelled' ? 'se detuvo.' : (e && e.message) || 'ocurrió un error.');
    setAgentStatus(s, a, 'error');
  }
}

function validData(r) {
  const data = r && r.data;
  if (!data || !Array.isArray(data.lines) || !data.lines.length) throw { code: 'bad' };
  return data;
}
function setBusy(s, b) {
  s.busy = b;
  if (s === active) gota.setBusy?.(b);
  renderSessions();
}
// La primera pregunta da nombre a una sesión nueva.
function maybeRename(s, text) {
  if (s.renamed || s === sessions[0]) return;
  s.renamed = true;
  const name = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  if (name) { s.name = name.length > 22 ? name.slice(0, 21) + '…' : name; renderSessions(); }
}

async function ask(s, text) {
  if (s.busy) return;
  setBusy(s, true);
  if (s === active) { closeAsk(); closePanel(); }
  clearClouds(s); clearAgents(s);
  maybeRename(s, text);
  const you = document.createElement('div'); you.className = 'cloud you hit'; you.textContent = text; s.clouds.append(you);
  s.history.push({ role: 'user', text });
  setMood(s, 'thinking');
  let t = thinkingCloud(s), data, denials = [];
  try {
    let r = await call(s, 'ask', { text, resume: s.claudeId }, progressInto(t));
    s.claudeId = r.sessionId || s.claudeId;
    data = validData(r);
    denials = r.denials || [];
    s.history.push({ role: 'bot', data });
    if (Array.isArray(data.delegate) && data.delegate.length) {
      t.remove();
      for (const line of data.lines.slice(0, 2)) { const c = cloud(s); await typeInto(s, c, String(line)); await wait(200); }
      setMood(s, 'delegating');
      if (s === active) gota.act('wave');
      s.agents = data.delegate.slice(0, 3).map((d, i) => ({
        id: ++agentSeq, name: String(d.name || 'Ayudante ' + (i + 1)).slice(0, 18), task: String(d.task || ''),
        color: AGENT_COLORS[(agentSeq + i) % AGENT_COLORS.length], status: 'working', output: '', activity: '',
      }));
      s.agents.forEach((a, i) => setTimeout(() => gota.spawnAgent(a.id, a.color, s.id), i * 350));
      renderTasks(s);
      renderSessions();
      await Promise.all(s.agents.map(a => runAgent(s, a)));
      const failed = s.agents.filter(a => a.status === 'error');
      if (s === active) {
        if (failed.length) { gota.act('scratch'); gota.react('thinking', 1800); }
        else { gota.act('jump'); gota.react('joy', 1600); }
      }
      setMood(s, 'thinking');
      t = thinkingCloud(s);
      const results = s.agents.map(a => `### ${a.name} (${a.status === 'done' ? 'terminado' : 'incompleto'})\nTarea: ${a.task}\n${a.output}`).join('\n\n');
      r = await call(s, 'ask', { results, resume: s.claudeId }, progressInto(t));
      s.claudeId = r.sessionId || s.claudeId;
      data = validData(r);
      data.delegate = null;
      denials = denials.concat(r.denials || []);
      s.history.push({ role: 'bot', data });
    }
  } catch (e) {
    data = { mood: 'worried', lines: errLines(e) };
  }
  t.remove();
  for (const line of data.lines.slice(0, 2)) { const c = cloud(s); await typeInto(s, c, String(line)); await wait(250); }
  setMood(s, data.mood || 'neutral');
  if (s === active) {
    if (data.mood === 'happy') gota.act(pick(['nod', 'hop', 'giggle']));
    if (data.mood === 'surprised') gota.act('recoil');
    if (data.mood === 'worried') gota.act('shake');
  }
  const blocked = [...new Set(denials)];
  if (blocked.length) { const c = cloud(s); c.textContent = 'No tuve permiso para usar: ' + blocked.join(', ') + '. Puedes permitirlo en astro.config.json.'; }
  const sheets = buildSheets(data);
  if (sheets.length) showSheetsButton(s, sheets, data.title);
  if (data.choice && data.choice.options && data.choice.options.length) showChoice(s, data.choice);
  setBusy(s, false);
  // Si la sesión terminó mientras estaba detrás, su gota salta y muestra un aviso.
  if (s !== active && sessions.includes(s)) {
    const kind = data.mood === 'worried' ? 'error' : 'done';
    s.pending = kind;
    gota.flagSession(s.id, `${s.name} · ${kind === 'error' ? 'Error' : data.choice ? 'Pregunta' : 'Listo'}`, kind);
  }
  setTimeout(() => { if (!s.busy) setMood(s, 'neutral'); }, 2600);
}

function resetConversation(s) {
  if (s.busy) return;
  s.claudeId = null; s.history.length = 0;
  if (s === active) closePanel();
  clearClouds(s); clearAgents(s);
  gota.act('spin');
  greet(s, 'Página en blanco. ¿Qué hacemos ahora?');
}

/* ---------- gestión de sesiones ---------- */
function renderSessions() {
  const bar = $('sesbar');
  bar.innerHTML = '';
  if (sessions.length < 2) return;
  sessions.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'sch' + (s === active ? ' on' : '') + (s.busy ? ' busy' : '');
    b.innerHTML = '<span class="dot"></span><span class="nm"></span><kbd></kbd>';
    b.querySelector('.dot').style.background = s.color;
    b.querySelector('.nm').textContent = s.name;
    b.querySelector('kbd').textContent = 'Alt+' + (i + 1);
    b.title = s.name;
    b.onclick = () => switchTo(s);
    const x = document.createElement('span');
    x.className = 'cx'; x.textContent = '×'; x.title = 'Cerrar sesión';
    x.onclick = ev => { ev.stopPropagation(); closeSession(s); };
    b.append(x);
    bar.append(b);
  });
}
function newSession() {
  if (sessions.length >= MAX_SESSIONS) { quip(`Puedo llevar hasta ${MAX_SESSIONS} sesiones a la vez.`); return null; }
  if (gota.isMinimized()) { restoreThen(newSession); return null; }
  const used = sessions.map(s => s.color.toLowerCase());
  const s = mkSession(`Sesión ${sessions.length + 1}`, SESS_COLORS.find(c => !used.includes(c.toLowerCase())) || pick(SESS_COLORS));
  if (!gota.addSession(s.id, s.color)) return null;
  sessions.push(s);
  renderSessions();
  quip(`Me dividí: ${s.name}.`);
  // tras la animación de división, pasa al frente y abre la pregunta
  setTimeout(() => switchTo(s, openAsk), 1000);
  return s;
}
let afterSwitch = null;
function switchTo(s, then) {
  if (!s || !sessions.includes(s)) return;
  if (s === active) { gota.act('hop'); if (then) then(); return; }
  if (!gota.switchTo(s.id)) return;
  closeAsk(); closePanel(); toggleSettings(false);
  afterSwitch = then || null;
}
function onSwitched(id) {
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  active.clouds.remove();
  active = s;
  $('cloudslot').append(s.clouds);
  stickToBottom(s);
  applyAccent();
  gota.setMood(s.mood);
  gota.setBusy?.(s.busy);
  renderSessions();
  if (s.pending) {
    gota.react(s.pending === 'error' ? 'worried' : 'happy', 1400);
    s.pending = null;
  } else if (!s.clouds.childElementCount) {
    greet(s, `Sesión «${s.name}». ¿En qué trabajamos?`);
  }
  if (pendingClose) { const c = pendingClose; pendingClose = null; setTimeout(() => closeSession(c), 350); }
  if (afterSwitch) { const fn = afterSwitch; afterSwitch = null; setTimeout(fn, 200); }
}
let pendingClose = null;
function closeSession(s) {
  if (!s || sessions.length < 2) return;
  if (s === active) { pendingClose = s; switchTo(sessions.find(x => x !== s)); return; }
  cancelAll(s);
  gota.closeSession(s.id);
  sessions.splice(sessions.indexOf(s), 1);
  s.clouds.remove();
  renderSessions();
  quip(`Cerré «${s.name}».`);
}

addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (body.classList.contains('panel-open')) closePanel();
    else if (!$('settings').hidden) toggleSettings(false);
    return;
  }
  if (!e.altKey || e.ctrlKey) return;
  const m = /^Digit([1-6])$/.exec(e.code);
  if (m) {
    e.preventDefault();
    const s = sessions[+m[1] - 1];
    if (!s) return;
    if (gota.isMinimized()) restoreThen(() => switchTo(s)); else switchTo(s);
  }
  if (e.code === 'KeyN') { e.preventDefault(); newSession(); }
});

/* ---------- avisos de otras sesiones de Claude Code (hooks) ---------- */
api.on('astro:notify', n => {
  const show = () => {
    const c = cloud(active, 'notify');
    const title = document.createElement('strong');
    const msg = document.createElement('span');
    if (n.event === 'Notification') {
      title.textContent = (n.project || 'Claude Code') + ' necesita tu atención';
      gota.react('surprised', 1600); gota.act('jump');
    } else {
      title.textContent = '¡Terminó la tarea' + (n.project ? ' en ' + n.project : '') + '!';
      gota.react('joy', 2000); gota.act(pick(['jump', 'spin', 'dance']));
    }
    msg.textContent = n.message || '';
    c.append(title, msg);
    gota.talk(40);
  };
  if (gota.isMinimized()) restoreThen(show); else show();
});

api.on('astro:summon', () => {
  if (gota.isMinimized()) { restoreThen(openAsk); return; }
  askEl ? closeAsk() : openAsk();
});
api.on('astro:minimize', () => gota.minimize());
api.on('astro:new', () => resetConversation(active));

/* ---------- inicio ---------- */
async function greet(s, text) {
  setMood(s, 'happy');
  const c = cloud(s);
  await typeInto(s, c, text);
  setMood(s, 'neutral');
}
applyAccent();
applyLayout();
api.config().then(c => {
  $('info').innerHTML = `<p class="lbl2">Conexión</p>Atajo: <b></b><br>Carpeta: <b></b><br>Modelo: <b></b><br>Sesiones: <b>Alt+N</b> nueva · <b>Alt+1…6</b> cambiar`;
  const bs = $('info').querySelectorAll('b');
  bs[0].textContent = c.shortcut.replace('CommandOrControl', 'Ctrl');
  bs[1].textContent = c.workingDirectory;
  bs[2].textContent = c.model;
  const hr = new Date().getHours();
  const hi = hr < 12 ? '¡Buenos días!' : hr < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
  setTimeout(() => { gota.act('wave'); greet(active, `${hi} Soy Astro. Haz clic en mí o pulsa ${bs[0].textContent} para hablarme.`); }, 600);
});

/* ---------- modo de prueba (ASTRO_DEBUG) ---------- */
// Permite ensayar animaciones sin gastar llamadas a Claude.
if (new URLSearchParams(location.search).has('debug')) {
  window.astroDebug = {
    sessions: () => sessions.map(s => ({ id: s.id, name: s.name, busy: s.busy, active: s === active })),
    newSession,
    switchTo: i => switchTo(sessions[i]),
    closeSession: i => closeSession(sessions[i]),
    say: text => { const c = cloud(active); c.textContent = text; },
    fakeAgents(withError = false, sessionIndex) {
      const s = sessionIndex === undefined ? active : sessions[sessionIndex];
      s.agents = [['Investigador', 'Buscar referencias'], ['Redactor', 'Escribir el borrador'], ['Revisor', 'Revisar el resultado']].map(([name, task], i) => ({
        id: ++agentSeq, name, task, color: AGENT_COLORS[i], status: 'working', output: '', activity: '',
      }));
      s.agents.forEach((a, i) => setTimeout(() => gota.spawnAgent(a.id, a.color, s.id), i * 350));
      renderTasks(s);
      s.agents.forEach((a, i) => setTimeout(() => setAgentStatus(s, a, withError && i === 1 ? 'error' : 'done'), 3500 + i * 1500));
      setTimeout(() => {
        if (s !== active) { s.pending = withError ? 'error' : 'done'; gota.flagSession(s.id, `${s.name} · ${withError ? 'Error' : 'Listo'}`, s.pending); }
      }, 8000);
    },
  };
}
