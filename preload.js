const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['claude:event', 'astro:summon', 'astro:notify', 'astro:minimize', 'astro:new', 'astro:reset', 'astro:resume', 'astro:capture', 'astro:prefs', 'astro:commands', 'astro:displays', 'astro:welcome-back', 'astro:folder', 'astro:update'];

contextBridge.exposeInMainWorld('astro', {
  setIgnore: ignore => ipcRenderer.send('mouse:ignore', ignore),
  blur: () => ipcRenderer.send('app:blur'),
  quit: () => ipcRenderer.send('app:quit'),
  config: () => ipcRenderer.invoke('config:get'),
  ask: req => ipcRenderer.invoke('claude:ask', req),
  agent: req => ipcRenderer.invoke('claude:agent', req),
  cancel: id => ipcRenderer.send('claude:cancel', id),
  endConversation: conv => ipcRenderer.send('claude:end', conv),
  prewarm: (conv, cwd) => ipcRenderer.send('claude:prewarm', { conv, cwd }),
  resumeConversation: (conv, sessionId, cwd) => ipcRenderer.send('claude:resume', { conv, sessionId, cwd }),
  history: cwd => ipcRenderer.invoke('history:list', cwd),
  pickFolder: current => ipcRenderer.invoke('folder:pick', current),
  grantTools: names => ipcRenderer.invoke('tools:grant', names),
  revokeTool: name => ipcRenderer.invoke('tools:revoke', name),
  checkFolders: list => ipcRenderer.invoke('folder:check', list),
  setPref: (key, value) => ipcRenderer.send('prefs:set', { key, value }),
  installUpdate: () => ipcRenderer.send('update:install'),
  discardCapture: id => ipcRenderer.send('capture:discard', id),
  on(channel, fn) {
    if (!EVENTS.includes(channel)) return () => {};
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
