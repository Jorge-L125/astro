const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, clipboard, shell, powerMonitor, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { createClaudeSession, createPool } = require('./src/claude');
const { resolveClaude } = require('./src/claude-bin');
const { ASTRO_RULES, ASTRO_SCHEMA, agentPrompt, integrationPrompt } = require('./src/prompts');
const { startNotifyServer } = require('./src/notify-server');
const { writeRuntimeInfo, removeRuntimeInfo } = require('./src/runtime-info');
const { makeIconPng } = require('./src/icon');
const { createCaptureStore } = require('./src/captures');
const { createPrefs } = require('./src/prefs');
const { describeDisplays, pinnedDisplay } = require('./src/displays');
const { createCommandStore } = require('./src/commands');
const { findScreenshotDir, isScreenshotName } = require('./src/screenshot-dir');
const { loginShellPath, mergePath } = require('./src/shell-path');
const { listConversations, readConversation } = require('./src/history');
const { readPlan } = require('./src/plans');
const { createUpdater } = require('./src/updater');
const { createOpencodeServer, createOpencodeSession } = require('./src/opencode');
const { createOpencodeSettings } = require('./src/opencode-settings');
const ocMap = require('./src/opencode-map');

// Instancia única: si Astro ya está abierto (como ejecutable o con `pnpm start`), esta copia solo
// avisa a la primera, que se muestra con la pregunta abierta ('second-instance'), y termina antes
// de arrancar nada: ni ventana, ni procesos de Claude, ni servidor de avisos.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  return; // CommonJS permite salir del módulo aquí: no se ejecuta nada más
}

const IS_MAC = process.platform === 'darwin';
// Abierta desde el Finder, la app no tiene el PATH de la terminal (Homebrew, ~/.local/bin…).
if (IS_MAC) {
  const shellPath = loginShellPath();
  if (shellPath) process.env.PATH = mergePath(process.env.PATH, shellPath);
}

const DEFAULTS = {
  shortcut: 'CommandOrControl+Shift+Space',
  workingDirectory: '',
  model: 'sonnet',
  claudePath: 'claude',
  allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
  permissionMode: 'default',
  notifyPort: 4545,
  warmPool: true,
  idleMinutes: 5,
};

// En desarrollo se usa astro.config.json del proyecto. En el ejecutable la carpeta de la app es de
// solo lectura (va dentro de app.asar): la configuración vive en la carpeta de datos del usuario
// (%APPDATA%\Astro en Windows) y se crea con los valores por defecto en el primer arranque.
function configFile() {
  const bundled = path.join(__dirname, 'astro.config.json');
  if (!app.isPackaged) return bundled;
  const file = path.join(app.getPath('userData'), 'astro.config.json');
  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.copyFileSync(bundled, file);
    } catch (e) {
      console.error('[astro] No pude crear la configuración:', e.message);
    }
  }
  return file;
}
const CONFIG_FILE = configFile();

// El hook lo ejecuta un `node` externo, que no puede leer dentro de app.asar: en el ejecutable
// va desempaquetado en app.asar.unpacked (ver "asarUnpack" en package.json).
const HOOK_FILE = path.join(__dirname.replace(/app\.asar$/, 'app.asar.unpacked'), 'hooks', 'astro-notify.js');
const hookCommand = () => `node "${HOOK_FILE.split(path.sep).join('/')}"`;

function loadConfig() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[astro] astro.config.json inválido:', e.message); }
  const cfg = { ...DEFAULTS, ...user };
  if (!cfg.workingDirectory) cfg.workingDirectory = os.homedir();
  return cfg;
}

const config = loadConfig();
// `astro` en una terminal pasa --here: Astro se coloca en la carpeta desde la que se llamó.
// El acceso directo del escritorio no lo pasa (su carpeta es la de instalación).
const launchDir = process.argv.includes('--here') ? process.cwd() : null;
let win = null;
let tray = null;
let updates = null; // actualizaciones automáticas (src/updater.js)
const running = new Map(); // id de petición -> función para cancelarla
const conversations = new Map(); // id de sesión de la interfaz -> proceso de Claude Code que la atiende
const prefs = createPrefs(app.getPath('userData'));
const commands = createCommandStore(app.getPath('userData'), { home: os.homedir(), cwd: config.workingDirectory });

/* ---------- OpenCode (segundo motor) ---------- */
// La contraseña del servidor y la clave del proveedor se cifran con el almacén del sistema.
const ocSettings = createOpencodeSettings(app.getPath('userData'), {
  available: () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } },
  encrypt: text => safeStorage.encryptString(text).toString('base64'),
  decrypt: b64 => safeStorage.decryptString(Buffer.from(b64, 'base64')),
});
const ocServer = createOpencodeServer({ settings: () => ocSettings.server() });
// El proveedor compatible con OpenAI de Ajustes se registra en el servidor (también en uno de Docker),
// con su clave aparte, sin escribir archivos de configuración.
const OC_PROVIDER = 'astro-openai';
let ocSynced = null;
function ocReady() {
  if (!ocSynced) {
    ocSynced = ocServer.ready().then(async info => {
      const o = ocSettings.openai();
      if (o.baseURL && o.models.length) {
        const models = Object.fromEntries(o.models.map(m => [m, { name: m }]));
        await ocServer.request('PATCH', '/global/config', { body: { provider: { [OC_PROVIDER]: { npm: '@ai-sdk/openai-compatible', name: o.name || 'Compatible con OpenAI', options: { baseURL: o.baseURL }, models } } } });
        if (o.key) await ocServer.request('PUT', `/auth/${OC_PROVIDER}`, { body: { type: 'api', key: o.key } });
      }
      return info;
    });
    ocSynced.catch(() => { ocSynced = null; });
  }
  return ocSynced;
}
// Modelos conectados (y su contexto), pedidos una vez por conexión.
let ocProviders = null;
async function ocModels() {
  if (!ocProviders) {
    ocProviders = ocReady().then(() => ocServer.request('GET', '/provider')).then(j => {
      const out = [];
      for (const p of j.all || []) {
        if (!(j.connected || []).includes(p.id)) continue;
        for (const [id, m] of Object.entries(p.models || {})) {
          out.push({ id: `${p.id}/${id}`, name: m.name || id, provider: p.name || p.id, context: (m.limit && m.limit.context) || null, free: p.id === 'opencode' && !!(m.cost && !m.cost.input && !m.cost.output) });
        }
      }
      return out;
    });
    ocProviders.catch(() => { ocProviders = null; });
  }
  return ocProviders;
}
const ocContext = async model => ((await ocModels()).find(m => m.id === model) || {}).context || null;
// Cambiaron los ajustes de conexión: se suelta todo y las conversaciones de OpenCode empiezan de nuevo.
function ocReset() {
  for (const [conv, s] of conversations) if (s.engine === 'opencode') endConversation(conv);
  ocServer.reset();
  ocSynced = null;
  ocProviders = null;
}

/* ---------- capturas de pantalla ---------- */
// Electron 44 tiene un portapapeles asíncrono al estilo de navigator.clipboard.
async function readClipboardImage() {
  const item = (await clipboard.read()).find(i => i.types.includes('image/png'));
  if (!item) return null;
  const blob = await item.getType('image/png');
  return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
}
const captures = createCaptureStore({
  hasClipboardImage: () => clipboard.has('image/png'),
  readClipboardImage,
  loadImage: file => nativeImage.createFromPath(file),
  acceptName: name => isScreenshotName(name),
  onCapture: cap => {
    if (process.env.ASTRO_DEBUG) console.log(`[astro] Captura nueva ${cap.id}: ${cap.width}×${cap.height}`);
    // Sin "siempre encima" Astro puede estar detrás: sube un momento para ofrecer la captura.
    if (win && !win.isDestroyed()) win.moveTop();
    send('astro:capture', cap);
  },
});

/* ---------- preferencias ---------- */
function applyPrefs() {
  const p = prefs.get();
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(p.alwaysOnTop, 'floating');
    if (!p.alwaysOnTop) win.moveTop();
  }
  if (p.watchCaptures) captures.start(); else captures.stop();
  const pinned = pinnedHere();
  if (pinned) fitToScreen(pinned);
  if (tray) buildTrayMenu();
  send('astro:prefs', p);
}
function setPref(key, value) {
  if (prefs.set(key, value)) applyPrefs();
}

/* ---------- herramientas permitidas ---------- */
// Astro puede ampliar `allowedTools` cuando el usuario lo autoriza desde un aviso. Se guarda en el
// archivo de configuración (el mismo que se abre desde la bandeja) y se aplica a todos los procesos.
const TOOL_NAME = /^[A-Za-z][\w-]*(\([^()\n]{1,200}\))?$/;
function saveAllowedTools(list) {
  config.allowedTools = [...new Set(list)];
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* se crea con lo que haya */ }
  file.allowedTools = config.allowedTools;
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n'); } catch (e) { console.error('[astro] No pude guardar allowedTools:', e.message); }
  // Los procesos de reserva se descartan y los de cada conversación se relanzan con las nuevas.
  askPool.closeAll(); agentPool.closeAll();
  for (const s of conversations.values()) s.setTools(config.allowedTools);
  return config.allowedTools;
}
ipcMain.handle('tools:grant', (_e, names) => {
  const ok = (Array.isArray(names) ? names : []).filter(n => typeof n === 'string' && TOOL_NAME.test(n));
  return ok.length ? saveAllowedTools([...config.allowedTools, ...ok]) : config.allowedTools;
});
ipcMain.handle('tools:revoke', (_e, name) => saveAllowedTools(config.allowedTools.filter(n => n !== name)));

/* ---------- Claude Code ---------- */
let launcher = null;
function getLauncher() {
  if (!launcher) launcher = resolveClaude(config.claudePath);
  return launcher;
}
// Cada sesión de Astro trabaja en su carpeta (la de la configuración si no se eligió otra). Claude Code
// guarda las conversaciones por carpeta, así que quedan junto a las del proyecto.
const IS_WIN = process.platform === 'win32';
const sameDir = (a, b) => (IS_WIN ? String(a).toLowerCase() === String(b).toLowerCase() : a === b);
function folderOf(dir) {
  if (typeof dir !== 'string' || !dir.trim()) return config.workingDirectory;
  const p = path.resolve(dir);
  try { return fs.statSync(p).isDirectory() ? p : config.workingDirectory; } catch { return config.workingDirectory; }
}
const isDefault = cwd => sameDir(cwd, config.workingDirectory);
const baseOpts = (cwd = config.workingDirectory) => ({
  launcher: getLauncher(),
  cwd,
  model: config.model,
  allowedTools: config.allowedTools,
  permissionMode: config.permissionMode,
  idleMs: config.idleMinutes * 60 * 1000,
});
const askOpts = (cwd = config.workingDirectory) => ({ ...baseOpts(cwd), systemPrompt: ASTRO_RULES(cwd), schema: ASTRO_SCHEMA });
// Cada proceso de Claude Code ocupa ~400 MB, así que no se deja ninguno esperando "por si acaso":
// se arranca cuando el usuario abre la pregunta (mientras escribe le da tiempo a arrancar) y, si al
// final no se usa, se cierra a los pocos minutos.
const SPARE_IDLE_MS = 3 * 60 * 1000;
const askPool = createPool(() => createClaudeSession({ ...askOpts(), idleMs: SPARE_IDLE_MS }));
const agentPool = createPool(() => createClaudeSession({ ...baseOpts(), idleMs: SPARE_IDLE_MS }));

function prewarm(pool, n = 1) {
  if (!config.warmPool) return;
  try { pool.fill(n); } catch (e) { console.error('[astro] No pude precalentar Claude Code:', e.message); }
}

// Los procesos de reserva (pool) solo sirven para la carpeta de la configuración; en otra carpeta
// se arranca uno propio.
function freshSession(cwd, extra = {}) {
  const s = createClaudeSession({ ...askOpts(cwd), ...extra });
  s.folder = cwd;
  return s;
}
// Una conversación con OpenCode: el servidor es único y cada conversación es una sesión suya.
function ocSession(cwd, model, resume = null) {
  ocReady().catch(() => {});
  const s = createOpencodeSession({ server: ocServer, cwd, model: model || ocSettings.get().defaultModel, allowedTools: config.allowedTools, resume, contextWindow: ocContext });
  s.folder = cwd;
  return s;
}
const engineOf = s => s.engine || 'claude';
function conversationFor(conv, resume, cwd = config.workingDirectory, engine = 'claude', model = null) {
  let s = conversations.get(conv);
  // Una conversación pertenece a su carpeta y a su motor: si la sesión cambió, empieza otra.
  if (s && (!sameDir(s.folder, cwd) || engineOf(s) !== engine || (engine === 'opencode' && model && s.model !== model))) { endConversation(conv); s = null; }
  if (!s && engine === 'opencode') { s = ocSession(cwd, model, resume); conversations.set(conv, s); }
  if (!s) {
    if (resume) s = freshSession(cwd, { resume });
    else if (isDefault(cwd)) { s = askPool.take(); s.folder = cwd; }
    else s = freshSession(cwd);
    conversations.set(conv, s);
  }
  s.setIdle(config.idleMinutes * 60 * 1000);
  return s;
}

// La interfaz avisa al abrir la pregunta: si la sesión ya tiene conversación, se despierta su proceso
// (con --resume si se cerró por inactividad); si es nueva, se deja uno listo para su carpeta.
function warmFor(conv, cwd = config.workingDirectory, engine = 'claude') {
  if (engine === 'opencode') { ocReady().catch(() => {}); return; }
  if (!config.warmPool) return;
  const s = conversations.get(conv);
  if (s && sameDir(s.folder, cwd) && engineOf(s) === 'claude') { if (!s.busy) s.warm(); return; }
  if (s) endConversation(conv);
  if (isDefault(cwd)) prewarm(askPool);
  else conversations.set(conv, freshSession(cwd, { idleMs: SPARE_IDLE_MS }).warm());
}
function endConversation(conv) {
  const s = conversations.get(conv);
  if (s) { s.close(); conversations.delete(conv); }
}
// Retomar: la sesión de la interfaz pasa a atender una conversación guardada. El proceso arranca ya
// (con --resume) para que la primera pregunta no espere al CLI.
function resumeConversation(conv, sessionId, cwd = config.workingDirectory, engine = 'claude', model = null) {
  endConversation(conv);
  if (engine === 'opencode') { conversations.set(conv, ocSession(cwd, model, sessionId)); return; }
  const s = freshSession(cwd, { resume: sessionId });
  conversations.set(conv, config.warmPool ? s.warm() : s);
}

// Cada conversación nueva anuncia sus comandos "/"; si cambiaron, la interfaz recibe la lista nueva.
function relayEvent(id, ev, cwd) {
  if (ev.type === 'start') {
    // La lista de comandos / es grande: solo viaja a la interfaz si cambió (OpenCode no la anuncia).
    if (Array.isArray(ev.slashCommands) && commands.update(ev, cwd)) send('astro:commands', commands.get());
    ev = { type: 'start', sessionId: ev.sessionId };
  }
  send('claude:event', { id, ...ev });
}

function track(id, handle) {
  running.set(id, handle.cancel);
  return handle.done.finally(() => running.delete(id));
}

function toReply(promise, pick) {
  return promise.then(r => ({ ok: true, ...pick(r) }), e => ({ ok: false, code: e.code || 'failed', message: e.message || '' }));
}

/* ---------- ventana ---------- */
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// La ventana cubre el área de trabajo de una pantalla. En modo automático, al llamar a Astro se muda a
// la del cursor; con una pantalla elegida en Ajustes se queda siempre en esa (si está conectada).
let displayId = null;
const pinnedHere = () => pinnedDisplay(screen.getAllDisplays(), prefs.get().display);
function fitToScreen(display) {
  if (!win || win.isDestroyed()) return;
  const d = display
    || pinnedHere()
    || screen.getAllDisplays().find(x => x.id === displayId)
    || screen.getPrimaryDisplay();
  displayId = d.id;
  win.setBounds(d.workArea);
}
const displayList = () => describeDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id);
// Al conectar o desconectar una pantalla: recolocar, y avisar a Ajustes y a la bandeja de la lista nueva.
function onDisplaysChanged() {
  fitToScreen();
  if (tray) buildTrayMenu();
  send('astro:displays', displayList());
}

function createWindow() {
  const start = pinnedHere() || screen.getPrimaryDisplay();
  displayId = start.id;
  win = new BrowserWindow({
    ...start.workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: prefs.get().alwaysOnTop,
    // En macOS un panel flota sobre apps a pantalla completa y no roba el foco al pulsarlo.
    ...(IS_MAC ? { type: 'panel' } : {}),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false, // no carga diccionarios del corrector: menos memoria
    },
  });
  if (prefs.get().alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), process.env.ASTRO_DEBUG ? { query: { debug: '1' } } : undefined);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (process.env.ASTRO_DEBUG) {
    win.webContents.on('console-message', e => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  }
  screen.on('display-metrics-changed', () => fitToScreen());
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
}

function summon() {
  if (!win) return;
  const d = pinnedHere() || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  if (d.id !== displayId) fitToScreen(d);
  win.showInactive();
  win.moveTop();
  // Sin icono en el Dock, macOS no activa la app al enfocar la ventana: hay que pedirlo.
  if (IS_MAC) app.focus({ steal: true });
  win.focus();
  send('astro:summon');
}

function buildTrayMenu() {
  const p = prefs.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Preguntar a Astro', accelerator: config.shortcut, click: summon },
    { label: 'Nueva sesión', click: () => send('astro:new') },
    { label: 'Retomar una conversación…', click: () => { summon(); send('astro:resume'); } },
    { label: 'Reiniciar esta conversación', click: () => send('astro:reset') },
    { label: 'Minimizar a gota', click: () => send('astro:minimize') },
    { type: 'separator' },
    { label: 'Siempre encima', type: 'checkbox', checked: p.alwaysOnTop, click: i => setPref('alwaysOnTop', i.checked) },
    { label: 'Detectar capturas de pantalla', type: 'checkbox', checked: p.watchCaptures, click: i => setPref('watchCaptures', i.checked) },
    { label: 'Pantalla', submenu: [
      { label: 'Automática (donde esté el cursor)', type: 'radio', checked: !pinnedHere(), click: () => setPref('display', 'auto') },
      ...displayList().map(d => ({
        label: `${d.n}: ${d.name} (${d.size})${d.primary ? ' · principal' : ''}`,
        type: 'radio',
        checked: p.display === d.id,
        click: () => setPref('display', d.id),
      })),
    ] },
    { type: 'separator' },
    { label: 'Abrir configuración', click: () => shell.openPath(CONFIG_FILE) },
    { label: 'Copiar comando de avisos (hooks)', click: () => clipboard.writeText(hookCommand()) },
    ...(updates && updates.active ? [{ label: 'Buscar actualizaciones ahora', click: () => { summon(); updates.checkNow(); } }] : []),
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
}
function createTray() {
  // La barra de menús de macOS usa iconos de 18 pt; se da a doble resolución para pantallas Retina.
  tray = new Tray(IS_MAC ? nativeImage.createFromBuffer(makeIconPng(36), { scaleFactor: 2 }) : nativeImage.createFromBuffer(makeIconPng(32)));
  tray.setToolTip('Astro');
  buildTrayMenu();
  tray.on('click', summon);
}

/* ---------- IPC ---------- */
ipcMain.on('mouse:ignore', (_e, ignore) => {
  if (win) win.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('app:blur', () => win && win.blur());
ipcMain.on('app:quit', () => app.quit());
ipcMain.handle('config:get', () => ({
  shortcut: config.shortcut,
  workingDirectory: config.workingDirectory,
  launchDir: launchDir && folderOf(launchDir),
  allowedTools: config.allowedTools,
  model: config.model,
  user: os.userInfo().username,
  platform: process.platform,
  version: app.getVersion(),
  updates: !!(updates && updates.active),
  commands: commands.get(),
  prefs: prefs.get(),
  displays: displayList(),
}));
ipcMain.on('prefs:set', (_e, { key, value }) => setPref(key, value));
ipcMain.on('update:install', () => updates && updates.install());
ipcMain.on('capture:discard', (_e, id) => captures.discard(id));

ipcMain.handle('claude:ask', (_e, { id, conv, text, results, resume, captureId, cwd: dir, engine = 'claude', model = null }) => {
  const cwd = folderOf(dir);
  let prompt = results ? integrationPrompt(results) : text;
  if (captureId && !results) {
    const image = captures.take(captureId);
    if (!image) return { ok: false, code: 'capture_gone', message: 'La captura ya no está disponible' };
    prompt = [image, { type: 'text', text: `${text}

(Adjunto una captura de mi pantalla.)` }];
  }
  let handle;
  try {
    handle = conversationFor(conv, resume, cwd, engine === 'opencode' ? 'opencode' : 'claude', model).send(prompt, ev => relayEvent(id, ev, cwd));
  } catch (e) {
    return { ok: false, code: e.code || 'not_found', message: e.message };
  }
  const done = track(id, handle).then(r => {
    // Si Claude reparte la tarea, los ayudantes arrancan ya, mientras la interfaz anuncia el reparto.
    const n = r.structured && Array.isArray(r.structured.delegate) ? r.structured.delegate.length : 0;
    if (n && !results && isDefault(cwd)) prewarm(agentPool, Math.min(3, n));
    return r;
  });
  return toReply(done, r => ({ data: r.structured, text: r.text, sessionId: r.sessionId, denials: r.denials, context: r.context, plan: r.plan || readPlan(r.planFile, os.homedir()) }));
});

ipcMain.handle('claude:agent', (_e, { id, name, task, transcript, cwd: dir }) => {
  const cwd = folderOf(dir);
  let s;
  try { s = isDefault(cwd) ? agentPool.take() : createClaudeSession(baseOpts(cwd)); } catch (e) { return { ok: false, code: e.code || 'not_found', message: e.message }; }
  const handle = s.send(agentPrompt(name, task, transcript), ev => relayEvent(id, ev, cwd));
  return toReply(track(id, handle).finally(() => s.close()), r => ({ text: r.text }));
});

// Otro mensaje mientras Claude trabaja: se le escribe al mismo proceso y lo incorpora a la tarea.
ipcMain.handle('claude:queue', (_e, { conv, id, text }) => {
  const s = conversations.get(conv);
  return { ok: !!(s && s.busy && s.queue(String(text || ''), String(id || ''))) };
});
ipcMain.on('claude:cancel', (_e, id) => {
  const cancel = running.get(id);
  if (cancel) cancel();
});
ipcMain.on('claude:end', (_e, conv) => endConversation(conv));
ipcMain.on('claude:prewarm', (_e, { conv, cwd, engine }) => warmFor(conv, folderOf(cwd), engine));
ipcMain.on('claude:resume', (_e, { conv, sessionId, cwd, engine, model }) => {
  if (typeof sessionId === 'string' && /^[\w-]{8,80}$/.test(sessionId)) resumeConversation(conv, sessionId, folderOf(cwd), engine === 'opencode' ? 'opencode' : 'claude', model);
});
ipcMain.handle('history:conversation', async (_e, { cwd: dir, id, engine }) => {
  if (engine === 'opencode') {
    try {
      const msgs = await ocServer.request('GET', `/session/${encodeURIComponent(id)}/message`, { dir: ocServer.dirFor(folderOf(dir)) });
      return { ok: true, items: ocMap.conversationItems(msgs) };
    } catch (e) { return { ok: false, message: e.message, items: [] }; }
  }
  try {
    return { ok: true, items: readConversation({ claudeHome: path.join(os.homedir(), '.claude'), cwd: folderOf(dir), id }) };
  } catch (e) {
    return { ok: false, message: e.message, items: [] };
  }
});
ipcMain.handle('history:list', async (_e, dir, engine) => {
  const cwd = folderOf(dir);
  if (engine === 'opencode') {
    try {
      await ocReady();
      const sdir = ocServer.dirFor(cwd);
      const list = await ocServer.request('GET', '/session', { dir: sdir, query: { roots: 'true', limit: '30' } });
      const sessions = (Array.isArray(list) ? list : []).filter(x => x.directory === sdir).sort((a, b) => b.time.updated - a.time.updated).slice(0, 30);
      const items = await Promise.all(sessions.map(async x => ocMap.listItem(x, await ocServer.request('GET', `/session/${x.id}/message`, { dir: sdir, query: { limit: '20' } }).catch(() => []))));
      return { ok: true, folder: cwd, items: items.filter(x => x.questions) };
    } catch (e) { return { ok: false, message: e.message, items: [] }; }
  }
  try {
    return { ok: true, folder: cwd, items: listConversations({ claudeHome: path.join(os.homedir(), '.claude'), cwd }) };
  } catch (e) {
    return { ok: false, message: e.message, items: [] };
  }
});

/* ---------- OpenCode: ajustes, modelos, comandos, permisos ---------- */
ipcMain.handle('opencode:settings', () => ocSettings.public());
ipcMain.handle('opencode:save', (_e, input) => {
  const before = JSON.stringify([ocSettings.server(), ocSettings.openai()]);
  const pub = ocSettings.set(input || {});
  if (JSON.stringify([ocSettings.server(), ocSettings.openai()]) !== before) ocReset();
  return pub;
});
ipcMain.handle('opencode:status', async () => {
  try {
    const info = await ocReady();
    return { ok: true, version: info.version, supported: info.supported, mode: ocSettings.get().mode };
  } catch (e) { return { ok: false, code: e.code || 'failed', message: e.message }; }
});
ipcMain.handle('opencode:models', async () => {
  try { return { ok: true, items: await ocModels() }; } catch (e) { return { ok: false, message: e.message, items: [] }; }
});
ipcMain.handle('opencode:commands', async (_e, dir) => {
  try {
    await ocReady();
    return { ok: true, items: ocMap.commandList(await ocServer.request('GET', '/command', { dir: ocServer.dirFor(folderOf(dir)) })) };
  } catch (e) { return { ok: false, message: e.message, items: [] }; }
});
ipcMain.handle('opencode:reply', async (_e, { conv, id, reply }) => {
  const s = conversations.get(conv);
  if (!s || !s.reply || !['once', 'always', 'reject'].includes(reply)) return { ok: false };
  try { await s.reply(String(id), reply); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; }
});
// Copilot: el servidor da una página de GitHub y un código; al autorizar, sus modelos quedan conectados.
ipcMain.handle('opencode:copilot', async () => {
  try {
    await ocReady();
    const a = await ocServer.request('POST', '/provider/github-copilot/oauth/authorize', { body: { method: 0, inputs: { deploymentType: 'github.com' } } });
    if (a && a.url) shell.openExternal(a.url);
    ocServer.request('POST', '/provider/github-copilot/oauth/callback', { body: { method: 0 } })
      .then(() => { ocProviders = null; send('astro:opencode', { type: 'copilot', ok: true }); })
      .catch(e => send('astro:opencode', { type: 'copilot', ok: false, message: e.message }));
    return { ok: true, url: a && a.url, instructions: a && a.instructions };
  } catch (e) { return { ok: false, message: e.message }; }
});

/* ---------- arranque ---------- */
app.on('second-instance', (_e, argv, workingDirectory) => {
  summon();
  if (argv.includes('--here')) send('astro:folder', folderOf(workingDirectory));
});
// Elegir otra carpeta para la sesión activa.
ipcMain.handle('folder:pick', async (_e, current) => {
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta de trabajo de esta sesión', defaultPath: folderOf(current), properties: ['openDirectory'] });
  return r.canceled || !r.filePaths[0] ? null : folderOf(r.filePaths[0]);
});
// Comprueba carpetas recordadas: las que ya no existen se descartan.
ipcMain.handle('folder:check', (_e, list) => (Array.isArray(list) ? list.filter(d => typeof d === 'string' && sameDir(folderOf(d), path.resolve(d))) : []));

app.whenReady().then(() => {
  if (IS_MAC) {
    // Astro vive en la barra de menús, no en el Dock. El menú Edición hace falta igualmente:
    // sin él, Cmd+C, Cmd+V y Cmd+A no funcionan en el cuadro de texto.
    app.dock?.hide();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
  }
  createWindow();
  createTray();
  if (!globalShortcut.register(config.shortcut, summon)) {
    console.error(`[astro] No pude registrar el atajo ${config.shortcut}; otra aplicación lo está usando.`);
  }
  const token = crypto.randomBytes(24).toString('hex');
  startNotifyServer(config.notifyPort, payload => send('astro:notify', payload), {
    token,
    onListening: port => writeRuntimeInfo({ port, token, pid: process.pid }),
  });
  // electron-updater solo se carga donde puede actualizar: Windows con la app instalada.
  const canUpdate = app.isPackaged && process.platform === 'win32';
  updates = createUpdater({
    updater: canUpdate ? require('electron-updater').autoUpdater : null,
    isPackaged: app.isPackaged,
    enabled: () => prefs.get().autoUpdate,
    send,
    log: m => console.log(m),
  });
  updates.start();
  applyPrefs();
  const shotsDir = process.env.ASTRO_SCREENSHOTS_DIR
    ? Promise.resolve(process.env.ASTRO_SCREENSHOTS_DIR)
    : findScreenshotDir({ home: os.homedir(), pictures: app.getPath('pictures') });
  shotsDir.then(dir => {
    if (process.env.ASTRO_DEBUG) console.log('[astro] Carpeta de capturas:', dir || '(no encontrada; solo portapapeles)');
    captures.setFolder(dir);
  });
  watchReturn();
});

// Si el equipo pasa 5 minutos sin teclado ni ratón, Astro saluda cuando vuelves.
function watchReturn() {
  let away = false;
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= 300) away = true;
    else if (away && idle < 5) { away = false; send('astro:welcome-back'); }
  }, 5000).unref();
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const cancel of running.values()) cancel();
  for (const s of conversations.values()) s.close();
  ocServer.close();
  captures.stop();
  askPool.closeAll();
  agentPool.closeAll();
  removeRuntimeInfo();
});

app.on('window-all-closed', () => app.quit());
