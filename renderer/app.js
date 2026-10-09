import { createGota } from './gota.js';
import { esc, inline, md, buildSheets, previewText } from './markdown.js';
import { formatAccel, altKey } from './keys.js';
import { parseSlash, suggest, commandReply, plainReply } from './slash.js';
import { groupDenials } from './tools.js';
import { contextInfo, usageQuestion, contextSpeech } from './usage.js';
import { ACCESSORY_LIST } from './accessories.js';
import { outfitFor, choose, withMode, loadOutfitPrefs, saveOutfitPrefs, outfitRequest, seasonSuggestion } from './outfits.js';

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
const cfg = { color: store.get('color', '#ff6b4a'), side: store.get('side', 'right'), theme: store.get('theme', 'auto'), glass: store.get('glass', 'glass') };
// Diseño de cada sesión: por carpeta de trabajo o siempre el mismo (renderer/outfits.js).
// astro-acc es el accesorio único de versiones anteriores: se migra una vez.
let { prefs: outfitPrefs, legacy: legacyAcc } = loadOutfitPrefs(store.get('outfits', null), store.get('acc', null));
const saveOutfits = () => store.set('outfits', saveOutfitPrefs(outfitPrefs));
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
function mkSession(name, color, folder = null) {
  const clouds = document.createElement('div');
  clouds.className = 'clouds';
  watchFade(clouds);
  clouds.setAttribute('aria-live', 'polite');
  return { id: ++seq, name, color, renamed: false, claudeId: null, history: [], busy: false, mood: 'neutral', clouds, agents: [], tasksEl: null, ids: new Set(), stopped: false, pending: null, folder, steps: [], stepsT0: 0, acc: outfitFor(outfitPrefs, folder) };
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
  // Glass (neutro) y Glass de color comparten el vidrio; el de color además lo tiñe con el de Astro.
  body.classList.toggle('glass', cfg.glass === 'glass' || cfg.glass === 'tint');
  body.classList.toggle('tint', cfg.glass === 'tint');
  for (const [id, key] of [['seg-side', 'side'], ['seg-theme', 'theme'], ['seg-glass', 'glass']]) {
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
for (const [id, key] of [['seg-side', 'side'], ['seg-theme', 'theme'], ['seg-glass', 'glass']]) {
  $(id).addEventListener('click', e => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v) return;
    cfg[key] = v; store.set(key, v); applyLayout();
  });
}
// Diseño de una sesión según su carpeta (o el de siempre). La de delante lo lleva completo; las de atrás, una copia.
function applyOutfit(s, react) {
  const k = outfitFor(outfitPrefs, s.folder);
  if (k === s.acc && !react) return;
  s.acc = k;
  if (s === active) gota.setAccessory(k, react); else gota.setMiniAccessory(s.id, k);
}
// Elegir un diseño: para el proyecto de la sesión de delante (y las demás sesiones en esa carpeta) o para todas.
function setAccessory(k, react) {
  outfitPrefs = choose(outfitPrefs, active.folder, k); saveOutfits();
  for (const s of sessions) applyOutfit(s, s === active && react);
  renderOutfitUi();
}
function setOutfitMode(mode) {
  outfitPrefs = withMode(outfitPrefs, mode, active.acc); saveOutfits();
  for (const s of sessions) applyOutfit(s, false);
  renderOutfitUi();
}
function renderOutfitUi() {
  [...$('accs').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === active.acc)));
  [...$('seg-accmode').children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === outfitPrefs.mode)));
  $('acc-hint').textContent = outfitPrefs.mode === 'always' ? 'Todas las sesiones llevan el mismo diseño'
    : active.folder ? `Para el proyecto «${baseName(active.folder)}»` : 'Para esta sesión';
}
$('seg-accmode').addEventListener('click', e => { const v = e.target.dataset && e.target.dataset.v; if (v) setOutfitMode(v); });
ACCESSORY_LIST.forEach(({ key: k, label, emoji }) => {
  const b = document.createElement('button');
  b.textContent = emoji; b.title = label; b.setAttribute('aria-label', label); b.dataset.k = k;
  b.onclick = () => setAccessory(k, true);
  $('accs').append(b);
});
gota.setAccessory(active.acc, false);
renderOutfitUi();
function toggleSettings(open = $('settings').hidden) {
  $('settings').hidden = !open;
  body.classList.toggle('settings-open', open);
  $('bSettings').setAttribute('aria-expanded', String(open));
  if (open) gota.react('curious', 1200);
}
$('bSettings').onclick = () => toggleSettings();
$('bAsk').onclick = () => (askEl ? closeAsk() : openAsk());
$('bNew').onclick = () => newSession();
$('bReset').onclick = () => confirmReset(active);
$('bResume').onclick = () => openResume();
$('bMin').onclick = () => gota.minimize();
$('bQuit').onclick = () => api.quit();
// Preferencias que guarda el proceso principal (también se cambian desde la bandeja).
function showPrefs(p) {
  document.querySelectorAll('.toggle[data-pref]').forEach(t => t.setAttribute('aria-checked', String(!!p[t.dataset.pref])));
  if (!p.watchCaptures) dropOffer();
  displayPref = p.display || 'auto';
  showDisplays();
}

/* ---------- pantalla ---------- */
// "Auto" sigue al cursor; un número fija Astro en esa pantalla (numeradas de izquierda a derecha).
let displays = [], displayPref = 'auto';
function showDisplays() {
  const seg = $('seg-display');
  $('grp-display').hidden = displays.length < 2;
  seg.innerHTML = '';
  const opts = [{ id: 'auto', text: 'Auto', title: 'Aparece en la pantalla donde esté el cursor' },
    ...displays.map(d => ({ id: d.id, text: String(d.n) + (d.primary ? ' ★' : ''), title: `${d.name} · ${d.size}${d.primary ? ' · principal' : ''}` }))];
  for (const o of opts) {
    const b = document.createElement('button');
    b.dataset.v = o.id; b.textContent = o.text; b.title = o.title;
    b.setAttribute('aria-pressed', String(o.id === displayPref));
    b.onclick = () => api.setPref('display', o.id);
    seg.append(b);
  }
  const chosen = displays.find(d => d.id === displayPref);
  $('display-hint').textContent = displayPref === 'auto' ? 'Aparece donde esté el cursor'
    : chosen ? `Siempre en ${chosen.name} (${chosen.size})`
    : 'La pantalla elegida no está conectada: mientras tanto sigue al cursor';
}
api.on('astro:displays', list => { displays = Array.isArray(list) ? list : []; showDisplays(); });
document.querySelectorAll('.toggle[data-pref]').forEach(t => {
  t.onclick = () => {
    const on = t.getAttribute('aria-checked') !== 'true';
    t.setAttribute('aria-checked', String(on));
    api.setPref(t.dataset.pref, on);
  };
});
api.on('astro:prefs', showPrefs);
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
function stickToBottom(s) { s.clouds.scrollTop = s.clouds.scrollHeight; fadeEdges(s.clouds); }
// Marca los bordes con más contenido detrás para desvanecerlos (ver .fade-top / .fade-bottom).
function fadeEdges(el) {
  const top = el.scrollTop > 2;
  const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2;
  el.classList.toggle('fade-top', top);
  el.classList.toggle('fade-bottom', bottom);
}
function watchFade(el) {
  el.addEventListener('scroll', () => fadeEdges(el), { passive: true });
  new ResizeObserver(() => fadeEdges(el)).observe(el);
  new MutationObserver(() => requestAnimationFrame(() => fadeEdges(el))).observe(el, { childList: true, subtree: true, characterData: true });
}
function clearClouds(s) {
  if (offer && offer.s === s) dropOffer();
  s.clouds.innerHTML = ''; s.tasksEl = null;
  if (s === active) { askEl = null; detachCapture(); }
}
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
  if (askEl) { renderAttachment(); askEl.querySelector('textarea').focus(); return; }
  gota.wake();
  gota.react('surprised', 500);
  active.clouds.querySelectorAll('.quip').forEach(c => c.remove());
  askEl = cloud(active, 'ask');
  askEl.classList.remove('old');
  askEl.innerHTML = '<textarea rows="1" aria-label="Tu pregunta" placeholder="¿En qué te ayudo?"></textarea><button class="send" aria-label="Enviar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button>';
  const ta = askEl.querySelector('textarea'), b = askEl.querySelector('.send');
  // Mientras se escribe, Claude Code arranca (o despierta) para que la respuesta no espere al CLI.
  api.prewarm(active.id, active.folder);
  const menu = commandMenu(ta);
  askEl.prepend(menu.el);
  askEl.prepend(folderButton(active));
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; gota.typing(); menu.update(); });
  ta.addEventListener('keydown', e => {
    if (menu.handleKey(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); b.click(); }
    if (e.key === 'Escape') { closeAsk(); api.blur(); }
  });
  b.onclick = () => {
    const v = ta.value.trim();
    if (!v) return;
    const cmd = parseSlash(v);
    if (cmd && !cmd.args && (cmd.name === 'resume' || cmd.name === 'clear')) { runLocal(cmd.name); return; }
    if (isCompliment(v)) gota.compliment();
    const cap = attached;
    attached = null; // pasa a la pregunta: ya no se descarta al cerrar
    ask(active, v, cap);
  };
  renderAttachment();
  ta.focus();
}
/* ---------- comandos / ---------- */
// La lista llega del proceso principal (lo que anuncia Claude Code) y se actualiza sola.
let commands = [];
api.on('astro:commands', list => { commands = Array.isArray(list) ? list : commands; });
const KIND_LABEL = { local: 'Astro', info: 'Info', task: 'Tarea', skill: 'Skill' };

function commandMenu(ta) {
  const el = document.createElement('div');
  el.className = 'cmds';
  el.setAttribute('role', 'listbox');
  el.hidden = true;
  let items = [], sel = 0;
  const pick = c => {
    if (c.kind === 'local') { el.hidden = true; runLocal(c.name); return; }
    ta.value = '/' + c.name + ' ';
    el.hidden = true;
    ta.focus();
    ta.dispatchEvent(new Event('input'));
  };
  const render = () => {
    el.innerHTML = '';
    items.forEach((c, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cmd' + (i === sel ? ' on' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === sel));
      row.innerHTML = '<b></b><span></span><em></em>';
      row.querySelector('b').textContent = '/' + c.name;
      row.querySelector('span').textContent = c.arg ? c.desc + ' (' + c.arg + ')' : c.desc;
      row.querySelector('em').textContent = KIND_LABEL[c.kind] || '';
      row.onmousedown = e => { e.preventDefault(); pick(c); };
      el.append(row);
    });
    el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  return {
    el,
    update() {
      items = suggest(commands, ta.value);
      sel = 0;
      el.hidden = !items.length;
      if (items.length) render();
    },
    // Devuelve true si la tecla era para el menú.
    handleKey(e) {
      if (el.hidden) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        render();
        return true;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) { e.preventDefault(); pick(items[sel]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); el.hidden = true; return true; }
      return false;
    },
  };
}

// Un mensaje corto con un cumplido para Astro ("eres lindo", "te quiero"…). Claude responde igual.
function isCompliment(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return t.length <= 60 && /\b(te quiero|te amo|lind[oa]|bonit[oa]|tiern[oa]|adorable|precios[oa]|cute|eres (el|la) mejor|eres genial)\b/.test(t);
}
// Cerrar la pregunta sin enviarla descarta la captura adjunta.
function closeAsk() { if (askEl) askEl.remove(); askEl = null; detachCapture(); }

// Comandos que resuelve Astro sin llamar a Claude.
function runLocal(name) {
  closeAsk();
  if (name === 'resume') openResume();
  else if (name === 'clear') confirmReset(active);
}

/* ---------- capturas de pantalla ---------- */
// Una captura se ofrece en una nube y solo viaja a Claude si se usa en una pregunta; si no, se descarta.
const CAPTURE_TTL = 90 * 1000;
let offer = null; // { cap, el, use, s, timer }: nube que ofrece la captura
let attached = null; // captura adjunta a la pregunta abierta

function dropOffer(discard = true) {
  if (!offer) return;
  clearTimeout(offer.timer);
  offer.el.remove();
  if (discard) api.discardCapture(offer.cap.id);
  offer = null;
}
function detachCapture() {
  if (!attached) return;
  api.discardCapture(attached.id);
  attached = null;
  renderAttachment();
}
function offerSeason() {
  const sug = seasonSuggestion(new Date(), active.acc, id => store.get('season-' + id, '') === 'no');
  if (!sug) return;
  const c = cloud(active, 'capture');
  c.innerHTML = '<p></p><div class="row"><button class="btn use">Póntelo</button><button class="opt drop">No, gracias</button></div>';
  c.querySelector('p').textContent = sug.text;
  c.querySelector('.use').onclick = () => { c.remove(); setAccessory(sug.key, true); };
  c.querySelector('.drop').onclick = () => { c.remove(); store.set('season-' + sug.id, 'no'); gota.act('nod'); };
}
function offerCapture(cap) {
  dropOffer();
  const s = active;
  const c = cloud(s, 'capture');
  c.innerHTML = '<img alt="Captura de pantalla"><p></p><div class="row"><button class="btn use">Preguntar sobre ella</button><button class="opt drop">Descartar</button></div>';
  c.querySelector('img').src = cap.thumb;
  c.querySelector('p').textContent = pick(['¡Vi una captura! ¿Te ayudo con ella?', 'Cacé una captura. ¿La miramos juntos?', '¡Captura a la vista! ¿Pregunto sobre ella?']);
  const use = c.querySelector('.use');
  use.disabled = s.busy;
  use.onclick = useCapture;
  c.querySelector('.drop').onclick = () => { dropOffer(); gota.act('nod'); };
  offer = { cap, el: c, use, s, timer: setTimeout(() => dropOffer(), CAPTURE_TTL) };
  gota.wake();
  gota.react('surprised', 900);
  gota.act('hop');
}
function useCapture() {
  if (!offer || offer.s !== active || active.busy) return;
  const cap = offer.cap;
  dropOffer(false);
  if (attached && attached.id !== cap.id) api.discardCapture(attached.id);
  attached = cap;
  openAsk();
}
function renderAttachment() {
  if (!askEl) return;
  let el = askEl.querySelector('.att');
  if (!attached) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'att';
    el.innerHTML = '<img alt=""><span><b>Captura adjunta</b><small></small></span><button class="cx" aria-label="Quitar la captura" title="Quitar la captura">×</button>';
    el.querySelector('.cx').onclick = () => { detachCapture(); askEl && askEl.querySelector('textarea').focus(); };
    askEl.prepend(el);
  }
  el.querySelector('img').src = attached.thumb;
  el.querySelector('small').textContent = `${attached.width} × ${attached.height} · solo se envía si preguntas`;
}
api.on('astro:capture', cap => {
  if (gota.isMinimized()) restoreThen(() => offerCapture(cap)); else offerCapture(cap);
});

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

/* ---------- panel de hojas ---------- */
const blobIco = c => `<svg viewBox="0 0 40 40"><path d="M20 3c6 7 13 13 13 21a13 13 0 0 1-26 0C7 16 14 10 20 3z" fill="${c}"/><rect x="14" y="20" width="3.4" height="7" rx="1.7" fill="#141416"/><rect x="22.6" y="20" width="3.4" height="7" rx="1.7" fill="#141416"/></svg>`;
let panelAgent = null;
function openShell(title, sub, ico) {
  panelSteps = null;
  $('ptitle').textContent = title; $('ptitle').title = title; $('psub').textContent = sub; $('pico').innerHTML = ico;
  $('tabs').innerHTML = ''; $('tabs').hidden = true;
  $('pbody').innerHTML = ''; $('pbody').scrollTop = 0;
  body.classList.add('panel-open'); $('panel').setAttribute('aria-hidden', 'false');
}
function closePanel() { body.classList.remove('panel-open'); $('panel').setAttribute('aria-hidden', 'true'); panelAgent = null; panelSteps = null; }
$('close').onclick = closePanel;

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
function showStepsButton(s) {
  const b = document.createElement('button');
  b.className = 'stepsbtn hit';
  b.textContent = `🧭 Ver los ${s.steps.length === 1 ? 'pasos (1)' : s.steps.length + ' pasos'}`;
  b.onclick = () => openSteps(s);
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
    watchFade(s.tasksEl);
    s.clouds.append(s.tasksEl);
  }
  const n = s.agents.filter(a => a.status === 'working').length;
  // Se redibuja a menudo (cada paso de cada subagente): conserva dónde estaba desplazada la lista.
  const keep = s.tasksEl.scrollTop;
  s.tasksEl.innerHTML = '';
  const ttl = document.createElement('p');
  ttl.className = 'ttl';
  const who = s.agents.every(a => a.internal) ? 'Subagentes' : 'Ayudantes';
  ttl.textContent = n ? `${who} · ${n} trabajando` : `${who} · terminaron`;
  s.tasksEl.append(ttl);
  if (n) {
    const stop = stopButton(s);
    ttl.append(stop);
  }
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
  s.tasksEl.scrollTop = keep;
  fadeEdges(s.tasksEl);
  if (atBottom || created) stickToBottom(s);
}
function highlightTask(id) {
  if (!active.tasksEl) return;
  active.tasksEl.querySelectorAll('.task').forEach(r => { r.style.background = String(id) === r.dataset.id ? 'color-mix(in srgb,var(--ink) 7%,transparent)' : ''; });
}
function setAgentStatus(s, a, status) {
  a.status = status;
  gota.finishAgent(a.id, status === 'done');
  if (s === active && status === 'error' && !s.stopped) quip(`${a.name} tuvo un problema.`);
  renderTasks(s);
  if (panelAgent === a) renderAgent(a);
}
function openAgent(a) { openShell((a.internal ? 'Subagente · ' : 'Ayudante · ') + a.name, '', blobIco(a.color)); panelAgent = a; renderAgent(a); }
function renderAgent(a) {
  $('psub').textContent = a.status === 'working' ? 'Trabajando ahora' : a.status === 'done' ? 'Tarea terminada' : 'No pudo terminar';
  const pb = $('pbody');
  const atBottom = pb.scrollHeight - pb.scrollTop - pb.clientHeight < 40;
  pb.innerHTML = `<article class="sheet"><p class="label">Tarea asignada</p><p>${inline(a.task)}</p>
    <span class="status-chip ${a.status === 'done' ? 'ok' : a.status === 'error' ? 'err' : ''}">${a.status === 'working' ? '● Trabajando' : a.status === 'done' ? '✓ Terminado' : '! Error'}</span>
    ${a.status === 'working' && a.activity ? `<p class="activity">${esc(a.activity)}…</p>` : ''}</article>
    <article class="sheet"><p class="label">${a.status === 'working' ? 'Lo que lleva hasta ahora' : 'Resultado'}</p>
    <div class="${a.status === 'working' ? 'caret' : ''}">${a.output ? md(a.output) : '<p style="color:var(--muted)">Analizando la tarea…</p>'}</div></article>
    ${a.steps && a.steps.length ? `<article class="sheet"><p class="label">Pasos (${a.steps.length})</p><ol class="steps">${a.steps.map(st => `<li><span class="ico">${esc(st.icon)}</span><span>${esc(st.text)}</span></li>`).join('')}</ol></article>` : ''}`;
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
    const r = await api[kind]({ id, cwd: s.folder, ...payload });
    if (!r.ok) throw { code: r.code, message: r.message };
    return r;
  } finally {
    s.ids.delete(id);
    listeners.delete(id);
  }
}
// Detiene lo que esté haciendo la sesión, incluidos los ayudantes y la respuesta que los integra.
function cancelAll(s) { s.stopped = true; for (const id of s.ids) api.cancel(id); }

const transcript = s => s.history.map(h => (h.role === 'user' ? 'Usuario: ' + h.text : 'Astro: ' + JSON.stringify(h.data))).join('\n');
function errLines(e) {
  const code = e && e.code;
  if (code === 'cancelled') return ['Listo, me detuve.'];
  if (code === 'not_found') return ['No encuentro el comando claude. ¿Está instalado y en el PATH?'];
  if (code === 'capture_gone') return ['Esa captura ya caducó.', 'Haz otra y vuelve a preguntarme.'];
  if (code === 'bad') return ['Claude respondió en un formato que no entendí. ¿Lo intentamos otra vez?'];
  const msg = String((e && e.message) || '').replace(/\s+/g, ' ').slice(0, 110);
  return ['Algo falló al hablar con Claude.', msg || 'Prueba de nuevo en un momento.'];
}
// Botón de detener como el de Claude: un cuadrado dentro de un círculo.
function stopButton(s) {
  const b = document.createElement('button');
  b.className = 'stop'; b.title = 'Detener'; b.setAttribute('aria-label', 'Detener');
  b.innerHTML = '<i></i>';
  b.onclick = () => cancelAll(s);
  return b;
}
function thinkingCloud(s) {
  const t = cloud(s);
  t.classList.add('thinking');
  t.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="status"></span>';
  t.append(stopButton(s));
  return t;
}
/* ---------- pasos de Claude y sus subagentes ---------- */
// Todo lo que hace Claude mientras responde queda en s.steps para seguirlo en vivo en el panel.
let panelSteps = null;
const TOOL_ICON = { Read: '📖', Glob: '🔍', Grep: '🔍', Edit: '✏️', MultiEdit: '✏️', Write: '📝', NotebookEdit: '✏️', Bash: '💻', PowerShell: '💻', WebFetch: '🌐', WebSearch: '🔎', Agent: '🤖', Task: '🤖', TodoWrite: '🗒️', Skill: '🧩' };
// Si Claude escribe su respuesta en el formato de Astro (JSON), se toma su primera frase.
const sayLine = (text, structured) => {
  let data = structured;
  if (!data && /^\s*\{/.test(String(text || ''))) { try { data = JSON.parse(text); } catch { return ''; } }
  if (data && Array.isArray(data.lines) && data.lines.length) return firstLine(data.lines[0]);
  return data ? '' : firstLine(text);
};
const firstLine = text => { const l = String(text || '').split('\n').map(x => x.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean) || ''; return l.length > 140 ? l.slice(0, 139) + '…' : l; };
const clock = ms => { const sec = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
function addStep(s, step) {
  s.steps.push({ at: Date.now(), ...step });
  if (s.stepsLink) s.stepsLink.textContent = `Ver pasos (${s.steps.length})`;
  if (panelSteps === s) renderSteps(s);
}
function openSteps(s) {
  openShell('Pasos de Claude', '', blobIco(s.color));
  panelSteps = s;
  renderSteps(s);
}
function renderSteps(s) {
  const working = s.busy;
  $('psub').textContent = `${s.steps.length === 1 ? '1 paso' : s.steps.length + ' pasos'} · ${working ? 'trabajando' : 'terminado'}`;
  const pb = $('pbody');
  const atBottom = pb.scrollHeight - pb.scrollTop - pb.clientHeight < 40;
  pb.innerHTML = '';
  const ol = document.createElement('ol');
  ol.className = 'steps live';
  for (const st of s.steps) {
    const li = document.createElement('li');
    li.innerHTML = '<time></time><span class="ico"></span><span class="txt"></span>';
    li.querySelector('time').textContent = clock(st.at - s.stepsT0);
    li.querySelector('.ico').textContent = st.icon;
    li.querySelector('.txt').textContent = st.text;
    if (st.agent) {
      li.classList.add('sub');
      li.style.setProperty('--c', st.agent.color);
      li.title = `${st.agent.name}: ver su detalle`;
      li.onclick = () => openAgent(st.agent);
    }
    ol.append(li);
  }
  if (working) { const li = document.createElement('li'); li.className = 'now'; li.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>'; ol.append(li); }
  pb.append(ol);
  if (atBottom) pb.scrollTop = pb.scrollHeight;
}
// Enlace «Ver pasos» en la nube de pensando.
function stepsLink(s, t) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'stepslink';
  b.textContent = `Ver pasos (${s.steps.length})`;
  b.onclick = () => openSteps(s);
  t.querySelector('.status').after(b);
  s.stepsLink = b;
}
// Cuántos subagentes de Claude siguen trabajando, para la línea de estado.
const subWorking = s => s.agents.filter(a => a.internal && a.status === 'working').length;
const progressInto = (el, s) => ev => {
  const st = el.querySelector('.status');
  const say = text => { if (st) st.textContent = text; };
  const find = key => s.agents.find(a => a.key === key);
  if (ev.type === 'tool') {
    // Lanzar un subagente ya tiene su propio paso y su estado («N subagentes trabajando»).
    if (ev.name === 'Agent' || ev.name === 'Task') return;
    say(ev.label + '…');
    addStep(s, { icon: TOOL_ICON[ev.name] || '🔧', text: ev.label });
  } else if (ev.type === 'text') {
    const l = sayLine(ev.text);
    if (l) addStep(s, { icon: '💬', text: l });
  } else if (ev.type === 'partial') {
    const l = sayLine(ev.text, ev.structured);
    if (l) { addStep(s, { icon: '💬', text: l }); say(`${l} · esperando a ${subWorking(s) || 'los'} subagente${subWorking(s) === 1 ? '' : 's'}…`); }
  } else if (ev.type === 'agent-start') {
    const a = {
      id: ++agentSeq, key: ev.key, internal: true, name: String(ev.name || 'Subagente').slice(0, 40), task: ev.task || '', kind: ev.kind || '',
      color: AGENT_COLORS[(agentSeq - 1) % AGENT_COLORS.length], status: 'working', output: '', activity: '', steps: [],
    };
    s.agents.push(a);
    gota.spawnAgent(a.id, a.color, s.id);
    if (s === active && gota.react) gota.react('focus', 900);
    renderTasks(s);
    addStep(s, { icon: '🤖', text: `Lanzó a «${a.name}»`, agent: a });
    say(`${subWorking(s)} subagente${subWorking(s) === 1 ? '' : 's'} trabajando…`);
  } else if (ev.type === 'agent-tool') {
    const a = find(ev.key); if (!a) return;
    a.activity = ev.label;
    a.steps.push({ icon: TOOL_ICON[ev.name] || '🔧', text: ev.label });
    addStep(s, { icon: TOOL_ICON[ev.name] || '🔧', text: `${a.name}: ${ev.label}`, agent: a });
    renderTasks(s);
    if (panelAgent === a) renderAgent(a);
  } else if (ev.type === 'agent-text') {
    const a = find(ev.key); if (!a) return;
    a.output = (a.output ? a.output + '\n\n' : '') + ev.text;
    a.steps.push({ icon: '💬', text: firstLine(ev.text) });
    if (panelAgent === a) renderAgent(a);
  } else if (ev.type === 'agent-end') {
    const a = find(ev.key); if (!a || a.status !== 'working') return;
    if (ev.text) a.output = ev.text;
    a.activity = '';
    addStep(s, { icon: ev.ok ? '✓' : '!', text: `«${a.name}» ${ev.ok ? 'terminó' : 'no pudo terminar'}`, agent: a });
    setAgentStatus(s, a, ev.ok ? 'done' : 'error');
    const n = subWorking(s);
    say(n ? `${n} subagente${n === 1 ? '' : 's'} trabajando…` : 'Juntando los resultados…');
  }
};

async function runAgent(s, a) {
  try {
    const r = await call(s, 'agent', { name: a.name, task: a.task, transcript: transcript(s) }, ev => {
      if (ev.type === 'text') a.output = (a.output ? a.output + '\n\n' : '') + ev.text;
      if (ev.type === 'tool') {
        a.activity = ev.label;
        (a.steps ||= []).push({ icon: TOOL_ICON[ev.name] || '🔧', text: ev.label });
        addStep(s, { icon: TOOL_ICON[ev.name] || '🔧', text: `${a.name}: ${ev.label}`, agent: a });
        renderTasks(s);
      }
      if (panelAgent === a) renderAgent(a);
    });
    a.output = r.text || a.output;
    setAgentStatus(s, a, 'done');
  } catch (e) {
    a.output += (a.output ? '\n\n' : '') + '**No pudo terminar:** ' + (e && e.code === 'cancelled' ? 'se detuvo.' : (e && e.message) || 'ocurrió un error.');
    setAgentStatus(s, a, 'error');
  }
}

// Respuesta con el formato de Astro; si Claude respondió con texto plano (p. ej. /cost), se adapta.
function validData(r) {
  const data = r && r.data;
  if (data && Array.isArray(data.lines) && data.lines.length) return data;
  const text = String((r && r.text) || '').trim();
  if (!text) throw { code: 'bad' };
  return plainReply(text);
}
function setBusy(s, b) {
  s.busy = b;
  if (offer && offer.s === s) offer.use.disabled = b;
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

// Datos de Astro si la respuesta trae el formato esperado; null si no (p. ej. la salida de un comando).
function softData(r) { try { return validData(r); } catch { return null; } }

/* ---------- uso del contexto ---------- */
// Cuánto lleva la conversación de cada sesión frente al límite del modelo. El anillo junto a Astro solo
// aparece desde el 75% (como en Claude Code); en Ajustes se ve siempre.
function trackContext(s, r, cmd = null) {
  if (cmd && cmd.name === 'compact') s.ctx = null; // tras compactar, el tamaño real llega en el siguiente turno
  else if (r && r.context) s.ctx = { ...r.context, last: s.ctx ? r.context.used - s.ctx.used : 0 };
  if (s === active) renderContext();
}
function contextCard(info) {
  const wrap = document.createElement('div');
  if (!info) {
    wrap.className = 'ctxcard empty';
    wrap.textContent = 'Aún sin datos: aparecen tras la primera respuesta de esta sesión.';
    return wrap;
  }
  wrap.className = 'ctxcard ' + info.level;
  wrap.innerHTML = '<p class="t"><i></i><span></span></p><p class="n"><b></b> <small></small></p><div class="bar"><i></i></div><p class="left"></p><button class="btn compact">Compactar sesión</button>';
  wrap.querySelector('.t span').textContent = info.title;
  wrap.querySelector('.n b').textContent = info.used;
  wrap.querySelector('.n small').textContent = '/ ' + info.window + ' · ' + info.pct + '%';
  wrap.querySelector('.bar i').style.width = info.pct + '%';
  wrap.querySelector('.left').textContent = 'Quedan ' + info.left + (info.last ? ' · último ' + info.last : '');
  const b = wrap.querySelector('.compact');
  b.disabled = active.busy;
  b.title = 'Resume la conversación para liberar contexto (/compact)';
  b.onclick = () => { $('ctxpop').hidden = true; toggleSettings(false); if (!active.busy) ask(active, '/compact'); };
  return wrap;
}
// Mientras Astro explica el uso, el anillo se ve aunque esté por debajo del 75%.
let explaining = null;
async function explainContext(s, text) {
  if (s !== active) return;
  closeAsk(); closePanel();
  clearClouds(s);
  const you = document.createElement('div'); you.className = 'cloud you hit'; you.textContent = text; s.clouds.append(you);
  const info = contextInfo(s.ctx);
  clearTimeout(explaining);
  explaining = setTimeout(() => { explaining = null; renderContext(); }, 9000);
  renderContext();
  $('ctxpop').hidden = false;
  $('ctxpop').replaceChildren(contextCard(info));
  // "Presenta" el anillo: saluda con la mano hacia él y lo mira mientras habla.
  gota.wake();
  gota.act('wave');
  gota.react(info && info.level !== 'ok' ? 'thinking' : 'happy', 1600);
  for (const line of contextSpeech(info)) { const c = cloud(s); await typeInto(s, c, line); await wait(250); }
  setMood(s, 'neutral');
  gota.act('nod');
}

function renderContext() {
  const info = contextInfo(active.ctx);
  const ring = $('ctxring');
  ring.hidden = !(info && (info.show || explaining));
  if (info) {
    ring.className = 'ctxring hit ' + info.level;
    ring.querySelector('.val').style.strokeDasharray = info.pct + ' 100';
    ring.querySelector('b').textContent = info.pct + '%';
    ring.title = `Contexto: ${info.used} de ${info.window} (${info.pct}%)`;
  }
  if (ring.hidden) $('ctxpop').hidden = true;
  if (!$('ctxpop').hidden) $('ctxpop').replaceChildren(contextCard(info));
  $('ctx-settings').replaceChildren(contextCard(info));
}
$('ctxring').onclick = () => {
  const pop = $('ctxpop');
  pop.hidden = !pop.hidden;
  if (!pop.hidden) pop.replaceChildren(contextCard(contextInfo(active.ctx)));
};
renderContext();
addEventListener('pointerdown', e => {
  if (!$('ctxpop').hidden && !$('ctxpop').contains(e.target) && !$('ctxring').contains(e.target)) $('ctxpop').hidden = true;
});

async function ask(s, text, capture = null) {
  if (s.busy) return;
  let cmd = capture ? null : parseSlash(text);
  // "¿Cuántos tokens quedan?": lo responde Astro con los datos que ya tiene, sin llamar a Claude.
  // Si es sobre el límite del plan, eso lo sabe /usage.
  const uq = !capture && !cmd ? usageQuestion(text) : null;
  if (uq === 'context') { explainContext(s, text); return; }
  if (uq === 'plan') cmd = parseSlash('/usage');
  // "Ponte el sombrero de pirata": lo hace Astro, sin llamar a Claude.
  const oq = !capture && !cmd ? outfitRequest(text) : null;
  if (oq) { if (s === active) { closeAsk(); closePanel(); } setAccessory(oq, true); return; }
  // /clear lo hace Astro: pide confirmación y reinicia la sesión, sin llamar a Claude.
  if (cmd && cmd.name === 'clear') { if (s === active) closeAsk(); confirmReset(s); return; }
  setBusy(s, true);
  s.stopped = false;
  if (s === active) { closeAsk(); closePanel(); }
  clearClouds(s); clearAgents(s);
  if (!cmd) maybeRename(s, text);
  const you = document.createElement('div'); you.className = 'cloud you hit'; you.textContent = text;
  if (capture) { const img = document.createElement('img'); img.className = 'shot'; img.alt = 'Captura adjunta'; img.src = capture.thumb; you.prepend(img); }
  s.clouds.append(you);
  s.history.push({ role: 'user', text: capture ? text + ' [con una captura de pantalla adjunta]' : text });
  setMood(s, 'thinking');
  s.steps = []; s.stepsT0 = Date.now();
  let t = thinkingCloud(s), data, denials = [];
  stepsLink(s, t);
  try {
    let r = await call(s, 'ask', { conv: s.id, text, resume: s.claudeId, captureId: capture ? capture.id : null }, progressInto(t, s));
    s.claudeId = r.sessionId || s.claudeId;
    trackContext(s, r, cmd);
    // Un comando responde con texto libre (o nada, como /compact): se adapta a nubes y hojas.
    data = cmd ? softData(r) || commandReply(cmd.name, r.text) : validData(r);
    denials = r.denials || [];
    s.history.push({ role: 'bot', data });
    if (Array.isArray(data.delegate) && data.delegate.length) {
      t.remove();
      for (const line of data.lines.slice(0, 2)) { const c = cloud(s); await typeInto(s, c, String(line)); await wait(200); }
      setMood(s, 'delegating');
      if (s === active) gota.act('wave');
      const helpers = data.delegate.slice(0, 3).map((d, i) => ({
        id: ++agentSeq, name: String(d.name || 'Ayudante ' + (i + 1)).slice(0, 18), task: String(d.task || ''),
        color: AGENT_COLORS[(agentSeq + i) % AGENT_COLORS.length], status: 'working', output: '', activity: '', steps: [],
      }));
      s.agents = s.agents.concat(helpers);
      helpers.forEach((a, i) => setTimeout(() => gota.spawnAgent(a.id, a.color, s.id), i * 350));
      helpers.forEach(a => addStep(s, { icon: '🤝', text: `Repartió una parte a «${a.name}»`, agent: a }));
      renderTasks(s);
      renderSessions();
      await Promise.all(helpers.map(a => runAgent(s, a)));
      // Si se detuvo o se cerró la sesión mientras trabajaban, no se gasta otra llamada en integrar.
      if (s.stopped || !sessions.includes(s)) throw { code: 'cancelled' };
      const failed = helpers.filter(a => a.status === 'error');
      if (s === active) {
        if (failed.length) { gota.act('scratch'); gota.react('thinking', 1800); }
        else { gota.act('jump'); gota.react('joy', 1600); }
      }
      setMood(s, 'thinking');
      t = thinkingCloud(s);
      stepsLink(s, t);
      const results = helpers.map(a => `### ${a.name} (${a.status === 'done' ? 'terminado' : 'incompleto'})\nTarea: ${a.task}\n${a.output}`).join('\n\n');
      r = await call(s, 'ask', { conv: s.id, results, resume: s.claudeId }, progressInto(t, s));
      s.claudeId = r.sessionId || s.claudeId;
      trackContext(s, r);
      data = validData(r);
      data.delegate = null;
      denials = denials.concat(r.denials || []);
      s.history.push({ role: 'bot', data });
    }
  } catch (e) {
    data = { mood: 'worried', lines: errLines(e) };
  }
  // Los subagentes que siguieran en marcha (p. ej. al detener) se dan por terminados.
  for (const a of s.agents) if (a.internal && a.status === 'working') { a.output = a.output || 'Se detuvo antes de terminar.'; setAgentStatus(s, a, 'error'); }
  t.remove();
  s.stepsLink = null;
  for (const line of data.lines.slice(0, 2)) { const c = cloud(s); await typeInto(s, c, String(line)); await wait(250); }
  setMood(s, data.mood || 'neutral');
  if (s === active) {
    if (data.mood === 'happy') gota.act(pick(['nod', 'hop', 'giggle']));
    if (data.mood === 'surprised') gota.act('recoil');
    if (data.mood === 'worried') gota.act('shake');
  }
  if (denials.length) askPermission(s, denials);
  const sheets = buildSheets(data);
  if (sheets.length) showSheetsButton(s, sheets, data.title);
  if (data.choice && data.choice.options && data.choice.options.length) showChoice(s, data.choice);
  setBusy(s, false);
  if (s.steps.length) showStepsButton(s);
  if (panelSteps === s) renderSteps(s);
  // Si la sesión terminó mientras estaba detrás, su gota salta y muestra un aviso.
  if (s !== active && sessions.includes(s)) {
    const kind = data.mood === 'worried' ? 'error' : 'done';
    s.pending = kind;
    gota.flagSession(s.id, `${s.name} · ${kind === 'error' ? 'Error' : data.choice ? 'Pregunta' : 'Listo'}`, kind);
  }
  setTimeout(() => { if (!s.busy) setMood(s, 'neutral'); }, 2600);
}

/* ---------- permisos de herramientas ---------- */
// Si Claude intentó usar una herramienta que no tiene permitida, Astro pregunta. Al permitirla se
// añade a `allowedTools` (en la configuración, para todas las sesiones) y Claude sigue donde estaba.
let toolsAllowed = [];
const listEs = a => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1]);
function askPermission(s, denials) {
  const items = groupDenials(denials).filter(x => !toolsAllowed.includes(x.tool));
  if (!items.length) return;
  const c = cloud(s, 'perm');
  c.innerHTML = '<h3></h3><ul></ul><p></p><div class="row"><button class="btn yes">Permitir y seguir</button><button class="opt no">No, gracias</button></div>';
  c.querySelector('h3').textContent = items.length === 1 ? 'Necesito tu permiso para seguir' : 'Necesito tu permiso para estas herramientas';
  const ul = c.querySelector('ul');
  for (const it of items) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="ico" aria-hidden="true"></span><span><b></b><code></code><small></small></span>';
    li.querySelector('.ico').textContent = it.icon;
    li.querySelector('b').textContent = it.label;
    li.querySelector('code').textContent = it.detail;
    li.querySelector('small').textContent = it.count > 1 ? `y ${it.count - 1} más` : '';
    li.title = it.tool;
    ul.append(li);
  }
  const risks = [...new Set(items.map(x => x.risk).filter(Boolean))];
  c.querySelector('p').textContent = (risks.length
    ? `Si lo permites, podré ${listEs(risks)} en tus proyectos sin volver a preguntarte. `
    : 'Si lo permites, no volveré a preguntarte. ')
    + 'Se guarda en tu configuración y puedes quitarlo en Ajustes.';
  if (risks.length) c.classList.add('risky');
  const names = items.map(x => x.tool);
  c.querySelector('.yes').onclick = async () => {
    c.remove();
    try { toolsAllowed = await api.grantTools(names); } catch { quip('No pude guardar el permiso.'); return; }
    renderTools();
    gota.act('nod');
    if (!s.busy) ask(s, `Te di permiso para usar ${listEs(names)}. Sigue con lo que estabas haciendo.`);
  };
  c.querySelector('.no').onclick = () => { c.remove(); gota.act('nod'); };
  if (s === active) gota.react('worried', 1200);
}
// Ajustes: lo que Claude puede usar sin preguntar, con una × para quitarlo.
function renderTools() {
  const el = $('tools');
  el.innerHTML = '';
  for (const t of toolsAllowed) {
    const b = document.createElement('button');
    b.className = 'tool'; b.title = `Quitar ${t}`;
    b.setAttribute('aria-label', `Quitar ${t}`);
    b.innerHTML = '<span></span><i aria-hidden="true">×</i>';
    b.querySelector('span').textContent = t;
    b.onclick = async () => { toolsAllowed = await api.revokeTool(t); renderTools(); };
    el.append(b);
  }
  if (!toolsAllowed.length) el.textContent = 'Ninguna: Claude preguntará antes de usar cualquier herramienta.';
}

// Reiniciar pide confirmación si hay algo que perder de vista. La conversación no se borra:
// queda guardada en Claude Code y se puede retomar con /resume.
let confirmEl = null;
function confirmReset(s) {
  if (s.busy) { quip('Espera a que termine lo que estoy haciendo.'); return; }
  if (!s.history.length && !s.claudeId) { resetConversation(s); return; }
  askConfirm(s, `¿Reinicio «${s.name}»?`, 'Empezamos de cero. Esta conversación queda guardada y puedes retomarla con /resume.', 'Sí, reiniciar', () => resetConversation(s));
}
function askConfirm(s, title, text, yesLabel, onYes) {
  if (s !== active) return;
  if (confirmEl) confirmEl.remove();
  closeAsk();
  const c = cloud(s, 'confirm');
  confirmEl = c;
  c.innerHTML = '<h3></h3><p></p><div class="row"><button class="btn yes"></button><button class="opt no">Cancelar</button></div>';
  c.querySelector('h3').textContent = title;
  c.querySelector('p').textContent = text;
  c.querySelector('.yes').textContent = yesLabel;
  const done = () => { c.remove(); if (confirmEl === c) confirmEl = null; };
  c.querySelector('.yes').onclick = () => { done(); onYes(); };
  c.querySelector('.no').onclick = () => { done(); gota.act('nod'); };
  c.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
  gota.react('worried', 1200);
  c.querySelector('.no').focus();
}

function resetConversation(s) {
  if (s.busy) return;
  s.claudeId = null; s.history.length = 0;
  s.ctx = null;
  if (s === active) renderContext();
  api.endConversation(s.id);
  if (s === active) closePanel();
  clearClouds(s); clearAgents(s);
  gota.act('spin');
  greet(s, 'Página en blanco. ¿Qué hacemos ahora?');
}

/* ---------- retomar conversaciones (/resume) ---------- */
const relTime = (() => {
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  return ms => {
    let v = (ms - Date.now()) / 1000;
    for (const [n, unit] of steps) { if (Math.abs(v) < n) return rtf.format(Math.round(v), unit); v /= n; }
    return '';
  };
})();
const shortName = text => { const n = String(text).replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' '); return n.length > 22 ? n.slice(0, 21) + '…' : n; };

async function openResume() {
  if (gota.isMinimized()) { restoreThen(openResume); return; }
  closeAsk(); toggleSettings(false);
  panelAgent = null;
  openShell('Retomar una conversación', 'Buscando…', blobIco(active.color));
  const pb = $('pbody');
  pb.innerHTML = '<p class="muted">Leyendo las conversaciones guardadas…</p>';
  let res;
  try { res = await api.history(active.folder); } catch (e) { res = { ok: false, message: e.message, items: [] }; }
  if (!body.classList.contains('panel-open') || $('ptitle').textContent !== 'Retomar una conversación') return;
  const items = res.items || [];
  $('psub').textContent = res.ok
    ? `${items.length === 1 ? '1 conversación' : items.length + ' conversaciones'} en ${res.folder}`
    : 'No pude leer las conversaciones';
  pb.innerHTML = '';
  if (!res.ok) { pb.innerHTML = '<p class="muted"></p>'; pb.firstChild.textContent = res.message || 'Error desconocido'; return; }
  if (!items.length) { pb.innerHTML = '<p class="muted">Aún no hay conversaciones guardadas en esta carpeta.</p>'; return; }
  const search = document.createElement('input');
  search.type = 'search'; search.className = 'search'; search.placeholder = 'Buscar por tema…';
  search.setAttribute('aria-label', 'Buscar conversación');
  const listEl = document.createElement('div');
  listEl.className = 'convos';
  pb.append(search, listEl);
  const paint = () => {
    const q = search.value.trim().toLowerCase();
    listEl.innerHTML = '';
    for (const c of items) {
      if (q && !(c.title + ' ' + c.last).toLowerCase().includes(q)) continue;
      const open = sessions.find(x => x.claudeId === c.id);
      const b = document.createElement('button');
      b.className = 'convo';
      b.innerHTML = '<b></b><small class="meta"></small><small class="last"></small>';
      b.querySelector('b').textContent = c.title;
      const kind = c.astro ? 'Astro' : 'Terminal';
      b.querySelector('.meta').textContent = `${relTime(c.mtime)} · ${kind} · ${c.questions === 1 ? '1 pregunta' : c.questions + ' preguntas'}${open ? ` · abierta en «${open.name}»` : ''}`;
      const last = b.querySelector('.last');
      if (c.last && c.last !== c.title) last.textContent = 'Última: ' + c.last; else last.remove();
      b.onclick = () => { if (open) { closePanel(); switchTo(open); } else resumeInto(active, c); };
      listEl.append(b);
    }
    if (!listEl.childElementCount) listEl.innerHTML = '<p class="muted">Nada coincide con esa búsqueda.</p>';
  };
  search.addEventListener('input', paint);
  paint();
  search.focus();
}

// La sesión activa pasa a la conversación guardada y muestra dónde se quedó.
async function resumeInto(s, c) {
  if (s.busy) { quip('Espera a que termine lo que estoy haciendo.'); return; }
  closePanel();
  api.resumeConversation(s.id, c.id, s.folder);
  s.claudeId = c.id;
  s.ctx = null; // el tamaño de la conversación retomada llega con su primera respuesta
  if (s === active) renderContext();
  const data = c.data || (c.lastText ? plainReply(c.lastText) : null);
  s.history = [];
  if (c.last) s.history.push({ role: 'user', text: c.last });
  if (data) s.history.push({ role: 'bot', data });
  if (s !== sessions[0]) { s.renamed = true; s.name = shortName(c.title) || s.name; renderSessions(); }
  clearClouds(s); clearAgents(s);
  const note = cloud(s, 'notify');
  const strong = document.createElement('strong'); strong.textContent = 'Retomé esta conversación';
  note.append(strong);
  if (c.title !== c.last) { const span = document.createElement('span'); span.textContent = c.title; note.append(span); }
  if (c.last) { const you = document.createElement('div'); you.className = 'cloud you hit'; you.textContent = c.last; s.clouds.append(you); }
  if (data) {
    for (const line of data.lines.slice(0, 2)) { const l = cloud(s); l.textContent = String(line); }
    const sheets = buildSheets(data);
    if (sheets.length) showSheetsButton(s, sheets, data.title);
    if (data.choice && data.choice.options && data.choice.options.length) showChoice(s, data.choice);
  }
  stickToBottom(s);
  if (s === active) { gota.act('hop'); gota.react('happy', 1400); }
}

/* ---------- carpeta de trabajo ---------- */
// Cada sesión trabaja en una carpeta: ahí lee Claude el proyecto y ahí se guardan sus conversaciones.
// Sin elegir ninguna, es la de la configuración, como siempre.
let defaultFolder = null, isWin = navigator.userAgent.includes('Windows');
const sameDir = (a, b) => !!a && !!b && (isWin ? a.toLowerCase() === b.toLowerCase() : a === b);
const baseName = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
let recentFolders = (() => { try { return JSON.parse(store.get('folders', '[]')) || []; } catch { return []; } })();
function rememberFolder(dir) {
  if (!dir || sameDir(dir, defaultFolder)) return;
  recentFolders = [dir, ...recentFolders.filter(d => !sameDir(d, dir))].slice(0, 6);
  store.set('folders', JSON.stringify(recentFolders));
}

// La sesión pasa a otra carpeta: empieza una conversación nueva; la anterior queda guardada en la suya.
function applyFolder(s, dir) {
  const prev = s.folder;
  s.folder = dir;
  applyOutfit(s, false);
  rememberFolder(dir);
  const had = s.history.length || s.claudeId;
  s.claudeId = null; s.history.length = 0;
  s.ctx = null;
  if (s === active) renderContext();
  api.endConversation(s.id);
  if (s === active) { closeAsk(); closePanel(); }
  clearClouds(s); clearAgents(s);
  renderSessions();
  gota.act('hop');
  const kept = had && prev ? ` La conversación anterior quedó guardada en «${baseName(prev)}».` : '';
  greet(s, `Ahora trabajo en «${baseName(dir)}».${kept} ¿Qué hacemos?`);
}
// Cambiar desde la interfaz: si hay conversación, se confirma antes.
function changeFolder(s, dir) {
  if (!dir || sameDir(dir, s.folder)) return;
  if (s.busy) { quip('Espera a que termine lo que estoy haciendo.'); return; }
  if (!s.history.length && !s.claudeId) { applyFolder(s, dir); return; }
  askConfirm(s, `¿Paso «${s.name}» a «${baseName(dir)}»?`,
    `Empezamos una conversación nueva en esa carpeta. La actual queda guardada en «${baseName(s.folder)}» y la puedes retomar desde allí con /resume.`,
    'Sí, cambiar', () => applyFolder(s, dir));
}
// «📁 carpeta ▾» en la nube de pregunta: la de siempre, las recientes y elegir otra.
function folderButton(s) {
  const wrap = document.createElement('div');
  wrap.className = 'folder';
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fbtn';
  b.title = `Carpeta de trabajo: ${s.folder || ''}`;
  b.setAttribute('aria-haspopup', 'menu');
  b.innerHTML = '<span aria-hidden="true">📁</span><span class="nm"></span><span aria-hidden="true">▾</span>';
  b.querySelector('.nm').textContent = baseName(s.folder);
  const list = document.createElement('div');
  list.className = 'fmenu'; list.hidden = true; list.setAttribute('role', 'menu');
  const item = (label, title, fn) => {
    const it = document.createElement('button');
    it.type = 'button'; it.setAttribute('role', 'menuitem');
    it.textContent = label; it.title = title;
    it.onmousedown = e => e.preventDefault();
    it.onclick = () => { list.hidden = true; fn(); };
    list.append(it);
  };
  b.onmousedown = e => e.preventDefault();
  b.onclick = () => {
    list.innerHTML = '';
    if (defaultFolder && !sameDir(defaultFolder, s.folder)) item(`🏠 ${baseName(defaultFolder)} (la de siempre)`, defaultFolder, () => changeFolder(s, defaultFolder));
    for (const d of recentFolders.filter(d => !sameDir(d, s.folder))) item('📁 ' + baseName(d), d, () => changeFolder(s, d));
    item('Elegir otra carpeta…', '', async () => changeFolder(s, await api.pickFolder(s.folder)));
    list.hidden = !list.hidden;
  };
  wrap.append(b, list);
  return wrap;
}

// `astro` en una terminal: a la sesión que ya trabaja en esa carpeta; si no hay, la principal pasa a
// esa carpeta si está libre; si está ocupada, se abre una sesión nueva allí.
let markReady;
const configReady = new Promise(r => { markReady = r; });
async function openFolder(dir) {
  if (!dir) return;
  await configReady;
  const go = s => (gota.isMinimized() ? restoreThen(() => switchTo(s, openAsk)) : switchTo(s, openAsk));
  const here = sessions.find(s => sameDir(s.folder, dir));
  if (here) { go(here); return; }
  const main = sessions[0];
  if (!main.busy) { applyFolder(main, dir); go(main); return; }
  rememberFolder(dir);
  newSession({ folder: dir, name: baseName(dir) });
}
api.on('astro:folder', openFolder);

/* ---------- gestión de sesiones ---------- */
function renderSessions() {
  body.classList.toggle('multi', sessions.length > 1);
  const bar = $('sesbar');
  bar.innerHTML = '';
  if (sessions.length < 2) return;
  sessions.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'sch' + (s === active ? ' on' : '') + (s.busy ? ' busy' : '');
    b.innerHTML = '<span class="dot"></span><span class="nm"></span><kbd></kbd>';
    b.querySelector('.dot').style.background = s.color;
    b.querySelector('.nm').textContent = s.name;
    b.querySelector('kbd').textContent = altKey(i + 1);
    b.title = s.folder ? `${s.name} · ${s.folder}` : s.name;
    b.onclick = () => switchTo(s);
    const x = document.createElement('span');
    x.className = 'cx'; x.textContent = '×'; x.title = 'Cerrar sesión';
    x.onclick = ev => { ev.stopPropagation(); closeSession(s); };
    b.append(x);
    bar.append(b);
  });
}
function newSession(opts = {}) {
  if (sessions.length >= MAX_SESSIONS) { quip(`Puedo llevar hasta ${MAX_SESSIONS} sesiones a la vez.`); return null; }
  if (gota.isMinimized()) { restoreThen(() => newSession(opts)); return null; }
  const used = sessions.map(s => s.color.toLowerCase());
  const s = mkSession(opts.name || `Sesión ${sessions.length + 1}`, SESS_COLORS.find(c => !used.includes(c.toLowerCase())) || pick(SESS_COLORS), opts.folder || active.folder);
  if (opts.name) s.renamed = true;
  if (!gota.addSession(s.id, s.color, s.acc)) return null;
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
  renderContext();
  $('cloudslot').append(s.clouds);
  // la captura ofrecida sigue a la sesión que está al frente
  if (offer) { offer.s = s; offer.use.disabled = s.busy; s.clouds.append(offer.el); }
  stickToBottom(s);
  applyAccent();
  renderOutfitUi();
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
  api.endConversation(s.id);
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
    // La nube lleva un resumen; el mensaje completo, con su markdown, se abre en el panel lateral.
    const full = String(n.message || '').trim();
    msg.textContent = previewText(full);
    c.append(title, msg);
    if (full) {
      const more = document.createElement('small');
      more.className = 'more';
      more.textContent = 'Ver mensaje completo →';
      c.append(more);
      c.classList.add('openable');
      c.setAttribute('role', 'button');
      c.tabIndex = 0;
      const open = () => openSheets(buildSheets({ detail: full }), title.textContent);
      c.onclick = () => { if (!getSelection().toString()) open(); }; // seleccionar texto no la abre
      c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
    }
    gota.talk(40);
  };
  if (gota.isMinimized()) restoreThen(show); else show();
});

api.on('astro:summon', () => {
  if (gota.isMinimized()) { restoreThen(openAsk); return; }
  askEl ? closeAsk() : openAsk();
});
api.on('astro:minimize', () => gota.minimize());
api.on('astro:welcome-back', () => gota.welcomeBack());
api.on('astro:new', () => newSession());
api.on('astro:reset', () => confirmReset(active));
api.on('astro:resume', () => (gota.isMinimized() ? restoreThen(openResume) : openResume()));

/* ---------- inicio ---------- */
async function greet(s, text) {
  setMood(s, 'happy');
  const c = cloud(s);
  await typeInto(s, c, text);
  setMood(s, 'neutral');
}
applyAccent();
applyLayout();
api.config().then(async c => {
  showPrefs(c.prefs);
  defaultFolder = c.workingDirectory;
  toolsAllowed = c.allowedTools || [];
  renderTools();
  isWin = c.platform === 'win32';
  recentFolders = (await api.checkFolders(recentFolders).catch(() => recentFolders)).filter(d => !sameDir(d, defaultFolder));
  // Si `astro` ya colocó la sesión en una carpeta mientras arrancaba, se respeta.
  for (const s of sessions) if (!s.folder) s.folder = s === active && c.launchDir ? c.launchDir : defaultFolder;
  markReady();
  rememberFolder(active.folder);
  if (legacyAcc && active.folder) { outfitPrefs = choose(outfitPrefs, active.folder, legacyAcc); legacyAcc = null; saveOutfits(); }
  for (const s of sessions) applyOutfit(s, false);
  renderOutfitUi();
  offerSeason();
  if (Array.isArray(c.commands)) commands = c.commands;
  if (Array.isArray(c.displays)) { displays = c.displays; showDisplays(); }
  $('info').innerHTML = `<p class="lbl2">Conexión</p>Atajo: <b></b><br>Carpeta: <b></b><br>Modelo: <b></b><br>Sesiones: <b></b> nueva · <b></b> cambiar`;
  const bs = $('info').querySelectorAll('b');
  const shortcut = formatAccel(c.shortcut);
  bs[0].textContent = shortcut;
  bs[3].textContent = altKey('N');
  bs[4].textContent = altKey('1…6');
  $('bAsk').title = `Preguntar (${shortcut})`;
  $('bNew').title = `Nueva sesión (${altKey('N')})`;
  bs[1].textContent = c.workingDirectory;
  bs[2].textContent = c.model;
  const hr = new Date().getHours();
  const hi = hr < 12 ? '¡Buenos días!' : hr < 20 ? '¡Buenas tardes!' : '¡Buenas noches!';
  const where = sameDir(active.folder, defaultFolder) ? '' : ` Trabajo en «${baseName(active.folder)}».`;
  setTimeout(() => { gota.act('wave'); greet(active, `${hi} Soy Astro.${where} Haz clic en mí o pulsa ${bs[0].textContent} para hablarme.`); }, 600);
});

/* ---------- modo de prueba (ASTRO_DEBUG) ---------- */
// Permite ensayar animaciones sin gastar llamadas a Claude.
if (new URLSearchParams(location.search).has('debug')) {
  window.astroDebug = {
    sessions: () => sessions.map(s => ({ id: s.id, name: s.name, busy: s.busy, active: s === active })),
    // gesto de reposo del diseño puesto, sin esperar
    outfitIdle: () => gota.outfitIdle(),
    outfit: k => setAccessory(k, true),
    outfitMode: setOutfitMode,
    outfits: () => ({ prefs: outfitPrefs, sessions: sessions.map(s => ({ name: s.name, folder: s.folder, acc: s.acc, active: s === active })) }),
    newSessionIn: folder => newSession({ folder, name: baseName(folder) }),
    setFolder: (i, dir) => applyFolder(sessions[i], dir),
    // Simula el uso de contexto de la sesión activa (p. ej. context(160000, 200000) para ver el anillo).
    context: (used, window) => trackContext(active, { context: { used, window } }),
    newSession,
    switchTo: i => switchTo(sessions[i]),
    closeSession: i => closeSession(sessions[i]),
    say: text => { const c = cloud(active); c.textContent = text; },
    setCommands: list => { commands = list; },
    fakeHistory: () => { active.history.push({ role: 'user', text: 'prueba' }); },
    openAsk,
    openResume,
    openFolder,
    // Simula n subagentes de Claude (lanzar, trabajar y terminar) para ver las órbitas y los pasos.
    fakeSubagents(n = 12) {
      const s = active;
      s.steps = []; s.stepsT0 = Date.now(); clearAgents(s); setBusy(s, true);
      const t = thinkingCloud(s); stepsLink(s, t);
      const on = progressInto(t, s);
      for (let i = 0; i < n; i++) setTimeout(() => on({ type: 'agent-start', key: 'k' + i, name: 'Subagente ' + (i + 1), task: 'Tarea de prueba ' + (i + 1) }), i * 150);
      for (let i = 0; i < n; i++) setTimeout(() => on({ type: 'agent-tool', key: 'k' + i, name: 'Read', label: `Leyendo archivo${i + 1}.js` }), 2000 + i * 100);
      for (let i = 0; i < n; i++) setTimeout(() => on({ type: 'agent-end', key: 'k' + i, ok: i % 7 !== 3, text: 'Resultado ' + (i + 1) }), 6000 + i * 400);
      setTimeout(() => { t.remove(); s.stepsLink = null; setBusy(s, false); showStepsButton(s); }, 6000 + n * 400 + 1500);
    },
    folders: () => sessions.map(s => ({ name: s.name, folder: s.folder, busy: s.busy, active: s === active })),
    resumeFirst: async () => { const r = await api.history(); if (r.items[0]) resumeInto(active, r.items.find(c => c.astro) || r.items[0]); return r.items.length; },
    thinking: (status = 'Leyendo main.js…') => { const t = thinkingCloud(active); t.querySelector('.status').textContent = status; },
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
