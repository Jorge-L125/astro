const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, clipboard, shell } = require('electron');
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
const { findScreenshotDir, isScreenshotName } = require('./src/screenshot-dir');
const { loginShellPath, mergePath } = require('./src/shell-path');

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
  idleMinutes: 10,
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
let win = null;
let tray = null;
const running = new Map(); // id de petición -> función para cancelarla
const conversations = new Map(); // id de sesión de la interfaz -> proceso de Claude Code que la atiende
const prefs = createPrefs(app.getPath('userData'));

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
  if (tray) buildTrayMenu();
  send('astro:prefs', p);
}
function setPref(key, value) {
  if (prefs.set(key, value)) applyPrefs();
}

/* ---------- Claude Code ---------- */
let launcher = null;
function getLauncher() {
  if (!launcher) launcher = resolveClaude(config.claudePath);
  return launcher;
}
const baseOpts = () => ({
  launcher: getLauncher(),
  cwd: config.workingDirectory,
  model: config.model,
  allowedTools: config.allowedTools,
  permissionMode: config.permissionMode,
  idleMs: config.idleMinutes * 60 * 1000,
});
const askOpts = () => ({ ...baseOpts(), systemPrompt: ASTRO_RULES(config.workingDirectory), schema: ASTRO_SCHEMA });
const askPool = createPool(() => createClaudeSession(askOpts()));
const agentPool = createPool(() => createClaudeSession(baseOpts()));

// Deja un proceso arrancado para la próxima conversación nueva.
function prewarm(pool, n = 1) {
  if (!config.warmPool) return;
  try { pool.fill(n); } catch (e) { console.error('[astro] No pude precalentar Claude Code:', e.message); }
}

function conversationFor(conv, resume) {
  let s = conversations.get(conv);
  if (!s) {
    s = resume ? createClaudeSession({ ...askOpts(), resume }) : askPool.take();
    conversations.set(conv, s);
    setImmediate(() => prewarm(askPool));
  }
  return s;
}
function endConversation(conv) {
  const s = conversations.get(conv);
  if (s) { s.close(); conversations.delete(conv); }
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

// La ventana cubre el área de trabajo de una pantalla; al llamar a Astro se muda a la del cursor.
let displayId = null;
function fitToScreen(display) {
  if (!win) return;
  const d = display
    || screen.getAllDisplays().find(x => x.id === displayId)
    || screen.getPrimaryDisplay();
  displayId = d.id;
  win.setBounds(d.workArea);
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  displayId = primary.id;
  win = new BrowserWindow({
    ...primary.workArea,
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
  screen.on('display-added', () => fitToScreen());
  screen.on('display-removed', () => fitToScreen());
}

function summon() {
  if (!win) return;
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
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
    { label: 'Reiniciar esta conversación', click: () => send('astro:reset') },
    { label: 'Minimizar a gota', click: () => send('astro:minimize') },
    { type: 'separator' },
    { label: 'Siempre encima', type: 'checkbox', checked: p.alwaysOnTop, click: i => setPref('alwaysOnTop', i.checked) },
    { label: 'Detectar capturas de pantalla', type: 'checkbox', checked: p.watchCaptures, click: i => setPref('watchCaptures', i.checked) },
    { type: 'separator' },
    { label: 'Abrir configuración', click: () => shell.openPath(CONFIG_FILE) },
    { label: 'Copiar comando de avisos (hooks)', click: () => clipboard.writeText(hookCommand()) },
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
  model: config.model,
  user: os.userInfo().username,
  platform: process.platform,
  prefs: prefs.get(),
}));
ipcMain.on('prefs:set', (_e, { key, value }) => setPref(key, value));
ipcMain.on('capture:discard', (_e, id) => captures.discard(id));

ipcMain.handle('claude:ask', (_e, { id, conv, text, results, resume, captureId }) => {
  let prompt = results ? integrationPrompt(results) : text;
  if (captureId && !results) {
    const image = captures.take(captureId);
    if (!image) return { ok: false, code: 'capture_gone', message: 'La captura ya no está disponible' };
    prompt = [image, { type: 'text', text: `${text}

(Adjunto una captura de mi pantalla.)` }];
  }
  let handle;
  try {
    handle = conversationFor(conv, resume).send(prompt, ev => send('claude:event', { id, ...ev }));
  } catch (e) {
    return { ok: false, code: e.code || 'not_found', message: e.message };
  }
  const done = track(id, handle).then(r => {
    // Si Claude reparte la tarea, los ayudantes arrancan ya, mientras la interfaz anuncia el reparto.
    const n = r.structured && Array.isArray(r.structured.delegate) ? r.structured.delegate.length : 0;
    if (n && !results) prewarm(agentPool, Math.min(3, n));
    return r;
  });
  return toReply(done, r => ({ data: r.structured, text: r.text, sessionId: r.sessionId, denials: r.denials }));
});

ipcMain.handle('claude:agent', (_e, { id, name, task, transcript }) => {
  let s;
  try { s = agentPool.take(); } catch (e) { return { ok: false, code: e.code || 'not_found', message: e.message }; }
  const handle = s.send(agentPrompt(name, task, transcript), ev => send('claude:event', { id, ...ev }));
  return toReply(track(id, handle).finally(() => s.close()), r => ({ text: r.text }));
});

ipcMain.on('claude:cancel', (_e, id) => {
  const cancel = running.get(id);
  if (cancel) cancel();
});
ipcMain.on('claude:end', (_e, conv) => endConversation(conv));

/* ---------- arranque ---------- */
app.on('second-instance', summon);

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
  applyPrefs();
  const shotsDir = process.env.ASTRO_SCREENSHOTS_DIR
    ? Promise.resolve(process.env.ASTRO_SCREENSHOTS_DIR)
    : findScreenshotDir({ home: os.homedir(), pictures: app.getPath('pictures') });
  shotsDir.then(dir => {
    if (process.env.ASTRO_DEBUG) console.log('[astro] Carpeta de capturas:', dir || '(no encontrada; solo portapapeles)');
    captures.setFolder(dir);
  });
  prewarm(askPool);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const cancel of running.values()) cancel();
  for (const s of conversations.values()) s.close();
  captures.stop();
  askPool.closeAll();
  agentPool.closeAll();
  removeRuntimeInfo();
});

app.on('window-all-closed', () => app.quit());
