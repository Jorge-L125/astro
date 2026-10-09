// El plan de Claude Code: en modo plan lo escribe en ~/.claude/plans/<nombre>.md y la respuesta final
// solo lo resume. Astro lo lee de ahí (solo de esa carpeta) para enseñarlo entero en el panel.
const fs = require('fs');
const path = require('path');

const MAX_PLAN = 200 * 1024;
const WRITERS = new Set(['Write', 'Edit', 'MultiEdit']);
const PLAN_FILE = /[\\/]\.claude[\\/]plans[\\/][^\\/]+\.md$/i;

/** Ruta del plan si esta llamada de herramienta lo escribe; null si es otra cosa. */
function planFileOf(tool, input) {
  const file = input && input.file_path;
  return WRITERS.has(tool) && typeof file === 'string' && PLAN_FILE.test(file) ? file : null;
}

/** Texto del plan, solo si el archivo está de verdad dentro de ~/.claude/plans. */
function readPlan(file, home) {
  if (!file || !home) return null;
  const dir = path.resolve(home, '.claude', 'plans') + path.sep;
  const full = path.resolve(file);
  if (!full.startsWith(dir)) return null;
  try { return fs.readFileSync(full, 'utf8').slice(0, MAX_PLAN); } catch { return null; }
}

module.exports = { planFileOf, readPlan };
