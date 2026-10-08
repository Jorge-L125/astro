const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['claude:event', 'astro:summon', 'astro:notify', 'astro:minimize', 'astro:new', 'astro:reset', 'astro:capture', 'astro:prefs', 'astro:commands'];

contextBridge.exposeInMainWorld('astro', {
  setIgnore: ignore => ipcRenderer.send('mouse:ignore', ignore),
  blur: () => ipcRenderer.send('app:blur'),
  quit: () => ipcRenderer.send('app:quit'),
  config: () => ipcRenderer.invoke('config:get'),
  ask: req => ipcRenderer.invoke('claude:ask', req),
  agent: req => ipcRenderer.invoke('claude:agent', req),
  cancel: id => ipcRenderer.send('claude:cancel', id),
  endConversation: conv => ipcRenderer.send('claude:end', conv),
  prewarm: conv => ipcRenderer.send('claude:prewarm', conv),
  setPref: (key, value) => ipcRenderer.send('prefs:set', { key, value }),
  discardCapture: id => ipcRenderer.send('capture:discard', id),
  on(channel, fn) {
    if (!EVENTS.includes(channel)) return () => {};
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
