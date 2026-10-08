// Conversaciones guardadas de Claude Code, para retomarlas desde Astro (como /resume en la terminal).
// Claude guarda cada conversación en ~/.claude/projects/<carpeta codificada>/<id>.jsonl, una línea
// JSON por mensaje. La carpeta codificada es la ruta de trabajo con todo lo que no es letra o número
// cambiado por "-"; la letra de unidad puede aparecer en mayúscula o en minúscula.
const fs = require('fs');
const path = require('path');

const encodeCwd = cwd => String(cwd).replace(/[^A-Za-z0-9]/g, '-');

/** Carpetas de ~/.claude/projects que corresponden a la carpeta de trabajo. */
function projectDirsFor(claudeHome, cwd) {
  const base = path.join(claudeHome, 'projects');
  const want = encodeCwd(cwd).toLowerCase();
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.toLowerCase() === want)
      .map(e => path.join(base, e.name));
  } catch { return []; }
}

// Lee el principio y el final de archivos grandes: el título está al inicio y lo último, al final.
const HEAD = 256 * 1024, TAIL = 2 * 1024 * 1024;
function readLines(file, size) {
  if (size <= HEAD + TAIL) return fs.readFileSync(file, 'utf8').split('\n');
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(HEAD), tail = Buffer.alloc(TAIL);
    fs.readSync(fd, head, 0, HEAD, 0);
    fs.readSync(fd, tail, 0, TAIL, size - TAIL);
    // la última línea del principio y la primera del final pueden estar cortadas: se descartan
    return [...head.toString('utf8').split('\n').slice(0, -1), ...tail.toString('utf8').split('\n').slice(1)];
  } finally { fs.closeSync(fd); }
}

const ASTRO_HELPER = /^Eres "[^"]+", un ayudante especialista que trabaja para Astro/;
const ASTRO_INTEGRATION = /^Resultados de tus ayudantes:/;

// Texto de un mensaje del usuario; null si no es una pregunta suya (resultados de herramientas, avisos…).
function userText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain || !entry.message || entry.message.role !== 'user') return null;
  const c = entry.message.content;
  let text;
  if (typeof c === 'string') text = c;
  else if (Array.isArray(c)) {
    if (c.some(p => p && p.type === 'tool_result')) return null;
    text = c.filter(p => p && p.type === 'text').map(p => p.text).join(' ');
  } else return null;
  text = String(text || '').trim();
  // los comandos "/" quedan guardados como <command-name>/cost</command-name>…
  const cmd = /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/.exec(text);
  if (cmd) return cmd[1].startsWith('/') ? cmd[1] : '/' + cmd[1];
  if (!text || text.startsWith('<')) return null;
  return text.replace(/\n*\(Adjunto una captura de mi pantalla\.\)\s*$/, '');
}

/** Resume una conversación guardada: título, última pregunta y última respuesta. */
function summarize(file) {
  const st = fs.statSync(file);
  const info = { id: path.basename(file, '.jsonl'), mtime: st.mtimeMs, title: '', summary: '', last: '', data: null, lastText: '', questions: 0 };
  for (const line of readLines(file, st.size)) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'summary' && e.summary) { info.summary = String(e.summary); continue; }
    if ((e.type === 'custom-title' || e.type === 'ai-title') && (e.customTitle || e.aiTitle || e.title)) {
      info.summary = String(e.customTitle || e.aiTitle || e.title);
      continue;
    }
    const u = userText(e);
    if (u !== null) {
      if (!info.title) info.title = u;
      if (!ASTRO_INTEGRATION.test(u)) { info.last = u; info.questions++; }
      continue;
    }
    if (e.type === 'assistant' && !e.isSidechain && e.message && Array.isArray(e.message.content)) {
      for (const p of e.message.content) {
        if (p.type === 'tool_use' && p.name === 'StructuredOutput' && p.input && Array.isArray(p.input.lines)) info.data = p.input;
        if (p.type === 'text' && p.text && p.text.trim()) { info.lastText = p.text.trim(); }
      }
    }
  }
  return info;
}

/**
 * Conversaciones de la carpeta de trabajo, de la más reciente a la más antigua. Se omiten las de los
 * ayudantes de Astro (son piezas de otra conversación) y las que no tienen ninguna pregunta.
 */
function listConversations({ claudeHome, cwd, limit = 30 }) {
  const files = [];
  for (const dir of projectDirsFor(claudeHome, cwd)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const f = path.join(dir, e.name);
      try { files.push({ f, mtime: fs.statSync(f).mtimeMs }); } catch { /* borrado entre medias */ }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const out = [];
  for (const { f } of files) {
    if (out.length >= limit) break;
    let s;
    try { s = summarize(f); } catch { continue; }
    if (!s.title || ASTRO_HELPER.test(s.title)) continue;
    out.push({
      id: s.id,
      mtime: s.mtime,
      title: (s.summary || s.title).replace(/\s+/g, ' ').slice(0, 160),
      last: s.last.replace(/\s+/g, ' ').slice(0, 300),
      questions: s.questions,
      astro: !!s.data,
      data: s.data,
      lastText: s.data ? '' : s.lastText.slice(0, 4000),
    });
  }
  return out;
}

module.exports = { encodeCwd, projectDirsFor, userText, summarize, listConversations };
