// Descripciones de skills y comandos personalizados de Claude Code, leídas del encabezado YAML de
// sus archivos (SKILL.md o comando .md) en ~/.claude, en el proyecto y en los plugins.
const fs = require('fs');
const path = require('path');

/** Descripción del encabezado YAML (`description: ...`) de un SKILL.md o un comando .md. */
function parseDescription(text) {
  // sin exigir el cierre "---": en encabezados muy largos puede quedar fuera de lo leído
  const m = /^---\r?\n([\s\S]*?)(?:\r?\n---|$)/.exec(String(text));
  if (!m) return '';
  const line = m[1].split(/\r?\n/).find(l => /^description\s*:/.test(l));
  if (!line) return '';
  let v = line.replace(/^description\s*:\s*/, '').trim();
  if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
  if (v === '|' || v === '>' || v === '>-' || v === '|-') {
    // texto en bloque: se toma la primera línea con sangría
    const after = m[1].split(/\r?\n/).slice(m[1].split(/\r?\n/).indexOf(line) + 1);
    v = (after.find(l => /^\s+\S/.test(l)) || '').trim();
  }
  return v.replace(/\s+/g, ' ');
}

function readDesc(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return parseDescription(buf.toString('utf8', 0, n));
  } catch { return ''; }
}

const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const list = p => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } };
// Las skills instaladas con enlaces (junctions en Windows) cuentan como carpetas.
const dirEntry = (parent, e) => e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(parent, e.name)));

// Skills: <dir>/<nombre>/SKILL.md, también un par de niveles más abajo (p. ej. skills/synced/<id>/pdf).
function collectSkills(dir, out, depth = 0) {
  for (const e of list(dir)) {
    if (!dirEntry(dir, e)) continue;
    const sub = path.join(dir, e.name);
    const file = path.join(sub, 'SKILL.md');
    if (fs.existsSync(file)) { if (!out.has(e.name)) { const d = readDesc(file); if (d) out.set(e.name, d); } }
    else if (depth < 2) collectSkills(sub, out, depth + 1);
  }
}

// Recoge <base>/skills/... y <base>/commands/<nombre>.md.
function collectFrom(base, out) {
  collectSkills(path.join(base, 'skills'), out);
  for (const e of list(path.join(base, 'commands'))) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const name = e.name.slice(0, -3);
    if (!out.has(name)) { const d = readDesc(path.join(base, 'commands', e.name)); if (d) out.set(name, d); }
  }
}

// Los plugins guardan sus skills y comandos varios niveles por debajo de ~/.claude/plugins.
function collectPlugins(dir, out, depth = 0) {
  if (depth > 7) return;
  for (const e of list(dir)) {
    if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    const p = path.join(dir, e.name);
    if (e.name === 'skills' || e.name === 'commands') collectFrom(dir, out);
    else collectPlugins(p, out, depth + 1);
  }
}

/** Mapa nombre -> descripción de las skills y comandos del usuario, del proyecto y de los plugins. */
function readDescriptions({ home, cwd }) {
  const out = new Map();
  if (cwd) collectFrom(path.join(cwd, '.claude'), out);
  if (home) {
    collectFrom(path.join(home, '.claude'), out);
    const plugins = path.join(home, '.claude', 'plugins');
    if (isDir(plugins)) collectPlugins(plugins, out);
  }
  return out;
}

module.exports = { parseDescription, readDescriptions };
