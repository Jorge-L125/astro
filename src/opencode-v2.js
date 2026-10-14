// OpenCode 2.x como motor de Astro. Misma interfaz que la conversación de 1.x (src/opencode.js) y que la
// de Claude Code: send/queue/cancel/reply/close. Cambia la API (todo bajo /api), los eventos (`data` en
// lugar de `properties`, uno por tramo de texto o de herramienta) y los permisos (hay que contestarlos
// en la sesión que preguntó; las reglas no se fijan por sesión, así que Astro aprueba lo ya permitido).
const map = require('./opencode-map');
const { describeTool } = require('./claude');

const fail = (code, message) => Object.assign(new Error(message), { code });

// Bloques de contenido al estilo de la API de Anthropic (imagen + texto) → texto + archivos de 2.x.
function promptOf(content) {
  if (!Array.isArray(content)) return { text: String(content) };
  const text = content.filter(b => b.type !== 'image').map(b => String(b.text || '')).join('\n').trim();
  const files = content.filter(b => b.type === 'image' && b.source).map(b => ({ mime: b.source.media_type, name: 'captura.png', data: b.source.data }));
  return files.length ? { text, files } : { text };
}

const textOfContent = c => (Array.isArray(c) ? c : []).filter(x => x && x.type === 'text' && x.text).map(x => x.text).join('\n').trim();

function createOpencodeSessionV2({ server, cwd, model, allowedTools = [], resume = null, contextWindow = async () => null }) {
  let sessionId = resume;
  let turn = null;
  let unsub = null;
  let closed = false;
  let tools = [...allowedTools];
  let instructed = false; // las instrucciones de Astro ya están puestas en la sesión
  const permSessions = new Map(); // id de permiso -> sesión que preguntó (puede ser la de un subagente)

  async function ensureSession(dir) {
    if (!sessionId) {
      const r = await server.request('POST', '/api/session', { dir, body: { title: 'Astro', location: { directory: dir } } });
      sessionId = r && r.data && r.data.id;
      if (!sessionId) throw fail('failed', 'OpenCode no creó la sesión.');
    }
    if (!instructed) {
      await server.request('PUT', `/api/experimental/session/${sessionId}/instructions/entries/astro`, { dir, body: { value: map.OPENCODE_RULES(cwd) } });
      instructed = true;
    }
    return sessionId;
  }

  function reply(permissionId, decision) {
    const sid = permSessions.get(permissionId) || sessionId;
    return server.request('POST', `/api/session/${sid}/permission/${encodeURIComponent(permissionId)}/reply`, { dir: server.dirFor(cwd), body: { decision } });
  }

  function onServerEvent(ev) {
    const t = turn;
    if (!t) return;
    const d = ev.data || {};
    const sid = d.sessionID;

    // Una sesión hija: el subagente que lanzó la llamada de herramienta de la misma descripción.
    if (ev.type === 'session.created' && d.parentID && (d.parentID === sessionId || t.children.has(d.parentID))) {
      const title = String(d.title || '');
      const key = [...t.tasks.entries()].find(([, v]) => !v.child && title.startsWith(v.description))?.[0]
        || [...t.tasks.entries()].find(([, v]) => !v.child)?.[0];
      if (key) { t.tasks.get(key).child = d.sessionID; t.children.set(d.sessionID, key); }
      return;
    }
    if (ev.type === 'session.inbox.delivered') {
      if (d.inboxID) t.delivered.add(d.inboxID);
      const q = t.pending.find(x => x.msg && x.msg === d.inboxID);
      if (q) { t.pending = t.pending.filter(x => x !== q); t.onEvent({ type: 'queued-read', qid: q.id }); }
      return;
    }
    if (!sid || (sid !== sessionId && !t.children.has(sid))) return;
    const child = sid !== sessionId ? t.children.get(sid) : null;

    switch (ev.type) {
      case 'session.tool.input.started':
        if (d.id && d.name) t.toolNames.set(d.id, d.name);
        return;
      case 'session.tool.called': {
        if (t.seen.has(d.id)) return;
        t.seen.add(d.id);
        const name = d.name || t.toolNames.get(d.id) || 'tool';
        const ct = map.toClaudeTool(name, d.input);
        if (child) { t.onEvent({ type: 'agent-tool', key: child, name: ct.name, label: describeTool(ct.name, ct.input) }); return; }
        if (name === 'subagent') {
          const i = d.input || {};
          t.tasks.set(d.id, { description: String(i.description || 'Subagente'), child: null });
          t.onEvent({ type: 'agent-start', key: d.id, name: String(i.description || 'Subagente'), kind: String(i.agent || i.subagent_type || ''), task: String(i.prompt || '') });
        }
        t.onEvent({ type: 'tool', name: ct.name, label: describeTool(ct.name, ct.input) });
        return;
      }
      case 'session.tool.progress': {
        // La llamada del subagente dice qué sesión le sirve de hija.
        const task = t.tasks.get(d.id);
        const cs = d.metadata && d.metadata.sessionID;
        if (task && cs) { task.child = cs; t.children.set(cs, d.id); }
        return;
      }
      case 'session.tool.success':
      case 'session.tool.error':
      case 'session.tool.failed': {
        if (!t.tasks.has(d.id) || child) return;
        const ok = ev.type === 'session.tool.success';
        const out = ok ? textOfContent(d.content) : String((d.error && d.error.message) || d.message || 'El subagente falló');
        t.onEvent({ type: 'agent-end', key: d.id, ok, text: out.replace(/<\/?task[^>]*>/g, '').trim() });
        return;
      }
      case 'session.text.ended':
        if (!d.text) return;
        if (child) t.onEvent({ type: 'agent-text', key: child, text: d.text });
        else if (!map.parseReply(d.text)) t.onEvent({ type: 'text', text: d.text });
        return;
      case 'session.step.ended':
        if (!child && d.tokens) t.tokens = d.tokens;
        return;
      case 'permission.asked': {
        permSessions.set(d.id, sid);
        if (map.allowsRequest(tools, d.action, d.resources)) { reply(d.id, 'once').catch(() => {}); return; }
        // `id` es el de la petición de la interfaz: el del permiso viaja como `pid`.
        const { id: pid, ...req } = map.permissionRequestV2(d);
        t.onEvent({ type: 'permission', pid, ...req, agent: child || null });
        return;
      }
      case 'session.error':
        if (!child && !t.error) t.error = d.error || { message: d.message };
        return;
      case 'session.execution.succeeded':
        if (!child) finish(t);
        return;
      case 'session.execution.failed':
        if (!child) fault(t, d.error || { message: d.message });
        return;
      case 'session.execution.interrupted':
        if (!child) { turn = null; t.reject(fail('cancelled', 'Cancelado')); }
        return;
      default:
    }
  }

  function fault(t, err) {
    if (turn !== t) return;
    turn = null;
    const e = err || t.error || {};
    t.reject(fail('failed', e.message || e.name || 'OpenCode no pudo responder'));
  }

  async function finish(t) {
    if (turn !== t || t.finishing) return;
    t.finishing = true;
    try {
      const r = await server.request('GET', `/api/session/${sessionId}/message`, { dir: server.dirFor(cwd), query: { limit: '6' } });
      const list = (r && Array.isArray(r.data) ? r.data : []).filter(m => m.type === 'assistant').sort((a, b) => ((b.time && b.time.created) || 0) - ((a.time && a.time.created) || 0));
      const last = list.find(m => textOfContent(m.content)) || list[0];
      if (turn !== t) return;
      turn = null;
      const text = last ? textOfContent(last.content) : '';
      if (!text && t.error) return t.reject(fail('failed', t.error.message || t.error.name || 'OpenCode no pudo responder'));
      const parsed = map.parseReply(text);
      const window = await contextWindow(model).catch(() => null);
      t.resolve({
        text: parsed ? parsed.prose : text,
        structured: parsed ? parsed.data : null,
        sessionId,
        denials: [],
        context: map.contextUsage((last && last.tokens) || t.tokens, window),
      });
    } catch (e) {
      if (turn !== t) return;
      turn = null;
      t.reject(e.code ? e : fail('failed', e.message));
    }
  }

  function interrupt() {
    if (sessionId) server.request('POST', `/api/session/${sessionId}/interrupt`, { dir: server.dirFor(cwd) }).catch(() => {});
  }

  return {
    get sessionId() { return sessionId; },
    get busy() { return !!turn; },
    get model() { return model; },
    engine: 'opencode',

    warm() { server.ready().catch(() => {}); return this; },
    setIdle() { return this; },
    // Las reglas valen enseguida: Astro decide al llegar cada pregunta de permiso.
    setTools(list) { tools = [...list]; return this; },

    send(text, onEvent = () => {}) {
      let t;
      const done = new Promise((resolve, reject) => {
        t = { resolve, reject, onEvent, pending: [], tasks: new Map(), children: new Map(), toolNames: new Map(), seen: new Set(), delivered: new Set(), error: null, tokens: null, finishing: false };
      });
      if (closed) { t.reject(fail('cancelled', 'Conversación cerrada')); return { done, cancel() {} }; }
      if (turn) { t.reject(fail('busy', 'Ya hay una pregunta en curso')); return { done, cancel() {} }; }
      turn = t;
      (async () => {
        const dir = server.dirFor(cwd);
        await ensureSession(dir);
        if (!unsub) unsub = server.subscribe(dir, onServerEvent);
        t.onEvent({ type: 'start', sessionId });
        const m = map.splitModelV2(model);
        const slash = typeof text === 'string' && /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
        if (slash) {
          // Un comando / de OpenCode: el servidor lo ejecuta y la respuesta llega por eventos.
          await server.request('POST', `/api/session/${sessionId}/command`, { dir, body: { name: slash[1], text: slash[2] || '', ...(m ? { model: m } : {}) } });
        } else {
          await server.request('POST', `/api/session/${sessionId}/prompt`, { dir, body: { ...promptOf(text), ...(m ? { model: m } : {}) } });
        }
      })().catch(e => { if (turn === t) { turn = null; t.reject(e.code ? e : fail('failed', e.message)); } });
      return {
        done,
        cancel() {
          if (turn !== t) return;
          turn = null;
          interrupt();
          t.reject(fail('cancelled', 'Cancelado'));
        },
      };
    },

    /** Otro mensaje mientras trabaja: OpenCode lo incorpora a la tarea en curso. */
    queue(text, id) {
      if (closed || !turn || !sessionId || typeof text !== 'string' || !text.trim()) return false;
      const t = turn;
      const q = { id, text, msg: null };
      t.pending.push(q);
      const m = map.splitModelV2(model);
      server.request('POST', `/api/session/${sessionId}/prompt`, { dir: server.dirFor(cwd), body: { text, ...(m ? { model: m } : {}) } })
        .then(r => {
          q.msg = r && r.data && r.data.id;
          // Si el servidor ya lo había entregado antes de contestar, se da por leído ahora.
          if (q.msg && t.delivered.has(q.msg) && t.pending.includes(q)) { t.pending = t.pending.filter(x => x !== q); t.onEvent({ type: 'queued-read', qid: q.id }); }
        })
        .catch(() => {});
      return true;
    },

    /** Respuesta a una solicitud de permiso: 'once' | 'always' | 'reject'. */
    reply,

    close() {
      closed = true;
      if (turn) { const t = turn; turn = null; interrupt(); t.reject(fail('cancelled', 'Conversación cerrada')); }
      if (unsub) { unsub(); unsub = null; }
    },
  };
}

module.exports = { createOpencodeSessionV2, promptOf };
