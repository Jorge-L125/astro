// Consultas a OpenCode que cambian de una versión a otra (modelos, comandos /, conversaciones guardadas):
// cada una pregunta al servidor qué API habla (1.x o 2.x) y devuelve lo mismo para la interfaz.
const map = require('./opencode-map');

const isV2 = async server => (await server.ready()).api === 'v2';
const MAX_PAGES = 5; // de 200 mensajes: más allá solo se lee el principio de una conversación enorme

/** Modelos conectados, con su contexto. */
async function models(server) {
  if (await isV2(server)) {
    const r = await server.request('GET', '/api/model');
    return map.modelsV2(r && r.data);
  }
  const j = await server.request('GET', '/provider');
  const out = [];
  for (const p of j.all || []) {
    if (!(j.connected || []).includes(p.id)) continue;
    for (const [id, m] of Object.entries(p.models || {})) {
      out.push({ id: `${p.id}/${id}`, name: m.name || id, provider: p.name || p.id, context: (m.limit && m.limit.context) || null, free: p.id === 'opencode' && !!(m.cost && !m.cost.input && !m.cost.output) });
    }
  }
  return out;
}

/** Comandos / del servidor para la carpeta (ya en el formato del menú de Astro). */
async function commands(server, hostCwd, { retryMs = 800 } = {}) {
  const dir = server.dirFor(hostCwd);
  if (await isV2(server)) {
    // Recién abierta la carpeta, 2.x contesta con la lista vacía y la rellena al cabo de un instante.
    for (let i = 0; ; i++) {
      const r = await server.request('GET', '/api/command', { dir });
      const list = map.commandListV2(r && r.data);
      if (list.length || i >= 2) return list;
      await new Promise(res => setTimeout(res, retryMs));
    }
  }
  return map.commandList(await server.request('GET', '/command', { dir }));
}

const norm = p => String(p || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();

/** Las conversaciones de la carpeta, de la más reciente a la más antigua, como elementos de /resume. */
async function sessions(server, hostCwd) {
  const dir = server.dirFor(hostCwd);
  if (await isV2(server)) {
    const r = await server.request('GET', '/api/session', { dir, query: { limit: '100' } });
    const list = ((r && r.data) || [])
      .filter(x => !x.parentID && x.location && norm(x.location.directory) === norm(dir))
      .sort((a, b) => ((b.time && b.time.updated) || 0) - ((a.time && a.time.updated) || 0))
      .slice(0, 30);
    const items = await Promise.all(list.map(async x => {
      const m = await server.request('GET', `/api/session/${x.id}/message`, { dir, query: { limit: '100' } }).catch(() => null);
      return map.listItemV2(x, (m && m.data) || []);
    }));
    return items.filter(x => x.questions);
  }
  const list = await server.request('GET', '/session', { dir, query: { roots: 'true', limit: '30' } });
  const own = (Array.isArray(list) ? list : []).filter(x => x.directory === dir).sort((a, b) => b.time.updated - a.time.updated).slice(0, 30);
  const items = await Promise.all(own.map(async x => map.listItem(x, await server.request('GET', `/session/${x.id}/message`, { dir, query: { limit: '20' } }).catch(() => []))));
  return items.filter(x => x.questions);
}

/** Una conversación entera en el formato de /historial: [{ role, text | data, at }]. */
async function conversation(server, hostCwd, id) {
  const dir = server.dirFor(hostCwd);
  const path = `/api/session/${encodeURIComponent(id)}/message`;
  if (await isV2(server)) {
    const all = [];
    let query = { limit: '200', order: 'asc' };
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await server.request('GET', path, { dir, query });
      const data = (r && r.data) || [];
      if (!data.length) break;
      all.push(...data);
      const next = r.cursor && r.cursor.next;
      if (!next) break;
      query = { limit: '200', cursor: next };
    }
    return map.conversationItemsV2(all);
  }
  return map.conversationItems(await server.request('GET', `/session/${encodeURIComponent(id)}/message`, { dir }));
}

module.exports = { models, commands, sessions, conversation };
