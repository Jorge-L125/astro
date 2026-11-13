// El mapa del proyecto (graphify) de cada carpeta de trabajo: dónde se guarda, si el usuario dejó hacerlo,
// en qué estado está y qué les cuenta Astro a Claude Code y OpenCode. Los mapas viven en la carpeta de datos
// de Astro (nunca dentro del proyecto) y solo se construyen con la extracción gratuita del código
// (`--code-only`): análisis local, sin claves ni red. Sin Electron: todo inyectable para probarlo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { resolveGraphify } = require('./graphify-bin');
const { mapRules, mapTools } = require('./graphify-prompt');

// Rutas comparables: barras `/`, sin barra final y, en Windows, sin mayúsculas.
const normPath = (p, win) => {
  const n = String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  return win ? n.toLowerCase() : n;
};

/**
 * createGraphMap({ dir, home?, platform?, enabled?, resolveBin?, onChange? })
 * - dir: carpeta de datos de los mapas (<datos de Astro>/graphs).
 * - enabled(): ¿está encendido el interruptor «Mapa del proyecto»?
 * - resolveBin(): { command, found } de graphify.
 * - onChange(folder, state): cada vez que cambia el estado de una carpeta.
 */
function createGraphMap({ dir, home = os.homedir(), platform = process.platform, enabled = () => true, resolveBin = () => resolveGraphify(), onChange = () => {} }) {
  const win = platform === 'win32';
  const norm = p => normPath(p, win);
  const nDir = norm(dir), nHome = norm(home);
  const indexFile = path.join(dir, 'index.json');
  const building = new Set(); // ids de las carpetas que se están construyendo

  const empty = () => ({ version: 1, folders: {} });
  const load = () => {
    try {
      const j = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      return j && typeof j === 'object' && j.folders && typeof j.folders === 'object' ? { version: 1, folders: j.folders } : empty();
    } catch { return empty(); }
  };
  const index = load();
  // Escritura atómica: archivo temporal y renombrar, para no dejar un índice a medias.
  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = indexFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
      fs.renameSync(tmp, indexFile);
    } catch (e) { console.error('[astro] No pude guardar el índice de mapas:', e.message); }
  }

  const folderId = folder => crypto.createHash('sha1').update(norm(folder)).digest('hex').slice(0, 12);
  const graphFile = id => path.join(dir, id, 'graphify-out', 'graph.json');
  const entry = folder => index.folders[folderId(folder)] || null;

  /** Nunca: la carpeta de usuario, la raíz de una unidad ni la carpeta de datos de Astro (ni lo que haya dentro). */
  function mappable(folder) {
    if (!folder) return false;
    const n = norm(folder);
    if (n === '' || /^[a-z]:$/i.test(n)) return false;
    return !(n === nHome || n === nDir || n.startsWith(nDir + '/'));
  }

  /** { status, nodes?, edges?, at?, reduction?, error? } — status: off|missing|unmappable|unasked|declined|idle|building|ready|failed */
  function state(folder) {
    if (!enabled()) return { status: 'off' };
    if (!mappable(folder)) return { status: 'unmappable' };
    if (!resolveBin().found) return { status: 'missing' };
    const e = entry(folder);
    if (!e || !e.choice) return { status: 'unasked' };
    if (e.choice === 'no') return { status: 'declined' };
    const id = folderId(folder);
    const data = e.builtAt && fs.existsSync(graphFile(id))
      ? { nodes: e.nodes, edges: e.edges, at: e.builtAt, reduction: e.reduction, ...(e.error ? { error: e.error } : {}) } : null;
    if (building.has(id)) return { status: 'building', ...(data || {}) };
    if (data) return { status: 'ready', ...data };
    if (e.failedAt) return { status: 'failed', error: e.error, at: e.failedAt };
    return { status: 'idle' };
  }

  /** El usuario dijo que sí (true) o «no aquí» (false) para esta carpeta. */
  function choose(folder, yes) {
    if (!mappable(folder)) return;
    const id = folderId(folder);
    index.folders[id] = { ...(index.folders[id] || {}), folder, choice: yes ? 'yes' : 'no' };
    save();
    onChange(folder, state(folder));
  }

  const graphPath = folder => (state(folder).status === 'ready' ? graphFile(folderId(folder)) : null);

  /** Lo que se añade a las sesiones de esta carpeta: { rules, tools }, o null si no hay mapa listo. */
  function extras(folder) {
    const graph = graphPath(folder);
    if (!graph) return null;
    const bin = resolveBin();
    return { rules: mapRules({ command: bin.command, graph }), tools: mapTools(bin.command) };
  }

  return { folderId, mappable, state, choose, graphPath, extras, _internals: { building, entry, save, graphFile, index: () => index, onChange } };
}

module.exports = { createGraphMap };
