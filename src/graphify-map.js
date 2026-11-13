// El mapa del proyecto (graphify) de cada carpeta de trabajo: dónde se guarda, si el usuario dejó hacerlo,
// en qué estado está y qué les cuenta Astro a Claude Code y OpenCode. Los mapas viven en la carpeta de datos
// de Astro (nunca dentro del proyecto) y solo se construyen con la extracción gratuita del código
// (`--code-only`): análisis local, sin claves ni red. Sin Electron: todo inyectable para probarlo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { resolveGraphify } = require('./graphify-bin');
const { mapRules, mapTools } = require('./graphify-prompt');

// Rutas comparables: barras `/`, sin barra final y, en Windows, sin mayúsculas.
const normPath = (p, win) => {
  const n = String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  return win ? n.toLowerCase() : n;
};

/**
 * createGraphMap({ dir, home?, platform?, enabled?, resolveBin?, onChange?, spawnImpl?, killTree?, now?, staleMs?, timeoutMs?, backoffMs? })
 * - dir: carpeta de datos de los mapas (<datos de Astro>/graphs).
 * - enabled(): ¿está encendido el interruptor «Mapa del proyecto»?
 * - resolveBin(): { command, found } de graphify.
 * - onChange(folder, state): cada vez que cambia el estado de una carpeta.
 * - staleMs: a partir de cuánto se actualiza un mapa (10 min); timeoutMs: tiempo máximo de una construcción (5 min);
 *   backoffMs: sin reintentos automáticos tras un fallo (1 h).
 */
function createGraphMap({ dir, home = os.homedir(), platform = process.platform, enabled = () => true, resolveBin = () => resolveGraphify(), onChange = () => {},
  spawnImpl = spawn, killTree = c => require('./claude').killTree(c), now = Date.now,
  staleMs = 10 * 60 * 1000, timeoutMs = 5 * 60 * 1000, backoffMs = 60 * 60 * 1000 }) {
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

  /* ---------- construcción en segundo plano ---------- */
  // Claves de API que graphify podría leer del entorno: aquí van siempre vacías (solo se usa el análisis local).
  const API_KEYS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'];
  const cleanEnv = () => { const env = { ...process.env }; for (const k of API_KEYS) env[k] = ''; return env; };
  const quote = a => (/[\s"]/.test(a) ? `"${a}"` : a);
  const lastLine = text => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).pop() || '';

  // Ejecuta graphify y devuelve { code, stdout, stderr, error? }; nunca rechaza. Pasado el tiempo, cierra el árbol.
  function run(bin, args, limit) {
    return new Promise(resolve => {
      let stdout = '', stderr = '', done = false, timer = null, child = null;
      const finish = r => { if (done) return; done = true; clearTimeout(timer); running.child = null; running.abort = null; resolve({ stdout, stderr, ...r }); };
      try {
        const opts = { env: cleanEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
        child = bin.shell ? spawnImpl([bin.command, ...args].map(quote).join(' '), [], { ...opts, shell: true }) : spawnImpl(bin.command, args, opts);
      } catch (e) { return finish({ code: null, error: e.message }); }
      running.child = child;
      running.abort = () => finish({ code: null, error: 'cerrado' });
      child.stdout.on('data', d => { stdout += d; });
      child.stderr.on('data', d => { stderr += d; });
      child.on('error', e => finish({ code: null, error: e.message }));
      child.on('close', code => finish({ code }));
      timer = setTimeout(() => { try { killTree(child); } catch { /* ya cerrado */ } finish({ code: null, error: 'tiempo agotado' }); }, limit);
      if (timer.unref) timer.unref();
    });
  }

  const running = { child: null, abort: null }; // proceso de graphify en marcha (para close)
  const queue = []; // [{ id, folder, resolve }]
  const jobs = new Map(); // id -> Promise<state>
  let busy = false, closed = false;

  // Copia el grafo bueno antes de construir: si la construcción falla, se restaura y no queda uno a medias.
  async function build(folder, id) {
    const out = path.join(dir, id), file = graphFile(id), bak = file + '.bak';
    const e = index.folders[id];
    const hadGraph = fs.existsSync(file);
    try {
      fs.mkdirSync(out, { recursive: true });
      if (hadGraph) fs.copyFileSync(file, bak);
      const bin = resolveBin();
      const r = await run(bin, ['extract', folder, '--code-only', '--out', out], timeoutMs);
      if (r.code !== 0) throw new Error(r.error || lastLine(r.stderr) || `graphify salió con código ${r.code}`);
      const graph = JSON.parse(fs.readFileSync(file, 'utf8'));
      const rb = await run(bin, ['benchmark', file], 60000);
      const m = /Reduction:\s+([\d.]+)x/.exec(rb.stdout || '');
      Object.assign(e, { builtAt: now(), nodes: (graph.nodes || []).length, edges: (graph.links || graph.edges || []).length, reduction: m ? Number(m[1]) : undefined });
      delete e.failedAt; delete e.error;
      if (hadGraph) fs.rmSync(bak, { force: true });
    } catch (err) {
      if (!closed) Object.assign(e, { failedAt: now(), error: err.message }); // cerrar Astro no cuenta como un fallo
      try { if (hadGraph && fs.existsSync(bak)) fs.copyFileSync(bak, file); else fs.rmSync(file, { force: true }); fs.rmSync(bak, { force: true }); } catch { /* sin restaurar */ }
    }
  }

  async function pump() {
    if (busy || closed || !queue.length) return;
    busy = true;
    const job = queue.shift();
    await build(job.folder, job.id);
    save();
    building.delete(job.id); jobs.delete(job.id);
    const st = state(job.folder);
    onChange(job.folder, st);
    job.resolve(st);
    busy = false;
    pump();
  }

  /**
   * Construye (o actualiza) el mapa de la carpeta si procede y devuelve su estado; nunca rechaza.
   * Procede si hay permiso y no hay mapa, si el mapa tiene más de staleMs o con { force }; tras un fallo no se
   * reintenta hasta pasado backoffMs (salvo force). Un solo proceso a la vez; lo ya pedido no se duplica.
   */
  function ensure(folder, { force = false } = {}) {
    try {
      const id = folderId(folder);
      if (jobs.has(id)) return jobs.get(id);
      const st = state(folder);
      if (!['idle', 'ready', 'failed'].includes(st.status)) return Promise.resolve(st);
      const e = entry(folder);
      if (!force) {
        if (e.failedAt && now() - e.failedAt < backoffMs) return Promise.resolve(st);
        if (st.status === 'ready' && e.builtAt && now() - e.builtAt <= staleMs) return Promise.resolve(st);
      }
      const job = new Promise(resolve => { queue.push({ id, folder, resolve }); });
      jobs.set(id, job); building.add(id);
      onChange(folder, state(folder));
      pump();
      return job;
    } catch (e) {
      return Promise.resolve({ status: 'failed', error: e.message });
    }
  }

  /** Cierra el proceso en curso y vacía la cola (al salir de Astro). */
  function close() {
    closed = true;
    if (running.child) { try { killTree(running.child); } catch { /* ya cerrado */ } if (running.abort) running.abort(); }
    for (const job of queue.splice(0)) { building.delete(job.id); jobs.delete(job.id); job.resolve(state(job.folder)); }
  }

  return { folderId, mappable, state, choose, graphPath, extras, ensure, close };
}

module.exports = { createGraphMap };
