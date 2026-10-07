const { app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { runClaude } = require('./src/claude');
const { ASTRO_RULES, ASTRO_SCHEMA, agentPrompt, integrationPrompt } = require('./src/prompts');
const { startNotifyServer } = require('./src/notify-server');
const { makeIconPng } = require('./src/icon');

const DEFAULTS = {
  shortcut: 'CommandOrControl+Shift+Space',
  workingDirectory: '',
  model: 'sonnet',
  claudePath: 'claude',
  allowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
  permissionMode: 'default',
  notifyPort: 4545,
};

function loadConfig() {
  let user = {};
  try { user = JSON.parse(fs.readFileSync(path.join(__dirname, 'astro.config.json'), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[astro] astro.config.json inválido:', e.message); }
  const cfg = { ...DEFAULTS, ...user };
  if (!cfg.workingDirectory) cfg.workingDirectory = os.homedir();
  return cfg;
}

const config = loadConfig();
let win = null;
let tray = null;
const running = new Map(); // id de petición -> función para cancelarla

if (!app.requestSingleInstanceLock()) app.quit();

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function fitToScreen() {
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds(workArea);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    ...workArea,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), process.env.ASTRO_DEBUG ? { query: { debug: '1' } } : undefined);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (process.env.ASTRO_DEBUG) {
    win.webContents.on('console-message', e => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  }
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
}

function summon() {
  if (!win) return;
  win.showInactive();
  win.focus();
  send('astro:summon');
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(makeIconPng(32)));
  tray.setToolTip('Astro');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Preguntar a Astro', accelerator: config.shortcut, click: summon },
    { label: 'Nueva conversación', click: () => send('astro:new') },
    { label: 'Minimizar a gota', click: () => send('astro:minimize') },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]));
  tray.on('click', summon);
}

function track(id, handle) {
  running.set(id, handle.cancel);
  return handle.done.finally(() => running.delete(id));
}

function toReply(promise, pick) {
  return promise.then(r => ({ ok: true, ...pick(r) }), e => ({ ok: false, code: e.code || 'failed', message: e.message || '' }));
}

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
}));

ipcMain.handle('claude:ask', (_e, { id, text, results, resume }) => {
  const handle = runClaude({
    bin: config.claudePath,
    prompt: results ? integrationPrompt(results) : text,
    systemPrompt: ASTRO_RULES(config.workingDirectory),
    schema: ASTRO_SCHEMA,
    resume,
    model: config.model,
    cwd: config.workingDirectory,
    allowedTools: config.allowedTools,
    permissionMode: config.permissionMode,
    onEvent: ev => send('claude:event', { id, ...ev }),
  });
  return toReply(track(id, handle), r => ({ data: r.structured, text: r.text, sessionId: r.sessionId, denials: r.denials }));
});

ipcMain.handle('claude:agent', (_e, { id, name, task, transcript }) => {
  const handle = runClaude({
    bin: config.claudePath,
    prompt: agentPrompt(name, task, transcript),
    model: config.model,
    cwd: config.workingDirectory,
    allowedTools: config.allowedTools,
    permissionMode: config.permissionMode,
    onEvent: ev => send('claude:event', { id, ...ev }),
  });
  return toReply(track(id, handle), r => ({ text: r.text }));
});

ipcMain.on('claude:cancel', (_e, id) => {
  const cancel = running.get(id);
  if (cancel) cancel();
});

app.on('second-instance', summon);

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (!globalShortcut.register(config.shortcut, summon)) {
    console.error(`[astro] No pude registrar el atajo ${config.shortcut}; otra aplicación lo está usando.`);
  }
  startNotifyServer(config.notifyPort, payload => send('astro:notify', payload));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  for (const cancel of running.values()) cancel();
});

app.on('window-all-closed', () => app.quit());
