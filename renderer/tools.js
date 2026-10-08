// Herramientas de Claude Code contadas en lenguaje normal, para pedir permiso al usuario.

const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const cut = (t, n) => { const s = String(t || '').split('\n')[0].trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const host = u => { try { return new URL(u).host; } catch { return cut(u, 60); } };

// risk: qué podrá hacer sin preguntar si se permite; null si no cambia nada en tu equipo.
const KINDS = {
  Edit: ['✏️', 'Editar archivos', i => base(i.file_path), 'cambiar archivos'],
  MultiEdit: ['✏️', 'Editar archivos', i => base(i.file_path), 'cambiar archivos'],
  NotebookEdit: ['✏️', 'Editar notebooks', i => base(i.notebook_path), 'cambiar archivos'],
  Write: ['📝', 'Crear o reescribir archivos', i => base(i.file_path), 'crear y reescribir archivos'],
  Bash: ['💻', 'Ejecutar comandos', i => cut(i.command, 80), 'ejecutar cualquier comando'],
  PowerShell: ['💻', 'Ejecutar comandos de PowerShell', i => cut(i.command, 80), 'ejecutar cualquier comando'],
  Read: ['📖', 'Leer archivos', i => base(i.file_path), null],
  Glob: ['🔍', 'Buscar archivos', i => cut(i.pattern, 60), null],
  Grep: ['🔍', 'Buscar dentro de archivos', i => cut(i.pattern, 60), null],
  WebFetch: ['🌐', 'Abrir páginas web', i => host(i.url), null],
  WebSearch: ['🔎', 'Buscar en internet', i => cut(i.query, 60), null],
  Task: ['🤖', 'Mandar a un ayudante', i => cut(i.description, 60), null],
  Agent: ['🤖', 'Mandar a un ayudante', i => cut(i.description, 60), null],
};

/** { tool, icon, label, detail, risk } de una petición de herramienta. */
export function describeRequest(tool, input = {}) {
  const k = KINDS[tool];
  if (k) return { tool, icon: k[0], label: k[1], detail: k[2](input || {}) || '', risk: k[3] };
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return { tool, icon: '🔌', label: `Usar ${mcp[2]} de ${mcp[1]}`, detail: '', risk: `usar ${mcp[1]}` };
  return { tool, icon: '🔧', label: `Usar ${tool}`, detail: '', risk: `usar ${tool}` };
}

/** Una entrada por herramienta, con lo primero que intentó hacer y cuántas veces lo pidió. */
export function groupDenials(denials = []) {
  const by = new Map();
  for (const d of denials) {
    const tool = typeof d === 'string' ? d : d && d.tool;
    if (!tool) continue;
    if (by.has(tool)) { by.get(tool).count++; continue; }
    by.set(tool, { ...describeRequest(tool, typeof d === 'string' ? {} : d.input), count: 1 });
  }
  return [...by.values()];
}
