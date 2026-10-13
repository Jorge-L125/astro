// OpenCode como segundo motor de Astro. Un único servidor (`opencode serve` en este equipo o uno que
// ya corre, p. ej. en Docker) atiende todas las conversaciones; cada una es una sesión del servidor.
// La conversación ofrece la misma interfaz que la de Claude Code (send/queue/cancel/close…) y traduce
// los eventos del servidor a los de Astro.
const { spawn } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const map = require('./opencode-map');
const { describeTool } = require('./claude');

const EXPECTED = /^1\.19\./; // versión con la que se construyó la integración
const START_TIMEOUT_MS = 20000;
const fail = (code, message) => Object.assign(new Error(message), { code });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

/**
 * settings(): { mode: 'local'|'remote', url, password, pathMap: [{host, server}], bin }
 * - local: Astro arranca `opencode serve` en un puerto libre con una contraseña de un solo uso.
 * - remote: se conecta a `url` (con `password` si el servidor la pide).
 */
// En Windows OpenCode corre bajo cmd.exe (shell): hay que cerrar el árbol entero, no solo la consola.
function stop(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill();
  } catch { /* ya cerrado */ }
}

function createOpencodeServer({ settings, spawnImpl = spawn, fetchImpl = (...a) => fetch(...a) }) {
  let starting = null; // Promise<{ base, headers, version }>
  let proc = null;
  const streams = new Map(); // carpeta del servidor -> { listeners:Set, abort }

  function headersFor(password) {
    const h = { 'Content-Type': 'application/json' };
    if (password) h.Authorization = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
    return h;
  }

  async function health(base, headers) {
    let r;
    try { r = await fetchImpl(`${base}/global/health`, { headers }); } catch (e) { throw fail('opencode_unreachable', `No pude conectar con OpenCode en ${base}: ${e.message}`); }
    if (r.status === 401) throw fail('opencode_auth', 'OpenCode rechazó la contraseña.');
    if (!r.ok) throw fail('opencode_unreachable', `OpenCode respondió ${r.status} en ${base}.`);
    const j = await r.json();
    return j.version || '';
  }

  async function startLocal(cfg) {
    const port = await freePort();
    const password = crypto.randomBytes(18).toString('hex');
    const bin = cfg.bin || 'opencode';
    const args = ['serve', '--hostname', '127.0.0.1', '--port', String(port)];
    const opts = { env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }, windowsHide: true };
    // En Windows `opencode` suele ser un .cmd (npm): va por la consola, como una sola línea.
    const child = process.platform === 'win32' ? spawnImpl([bin, ...args].join(' '), [], { ...opts, shell: true }) : spawnImpl(bin, args, opts);
    proc = child;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(fail('opencode_unreachable', 'OpenCode no arrancó a tiempo.')), START_TIMEOUT_MS);
      let out = '';
      const onData = d => { out += d; if (/listening on/i.test(out)) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData);
      child.stderr.on('data', d => { out += d; });
      child.on('error', e => { clearTimeout(timer); reject(fail('opencode_missing', `No encuentro el comando opencode (${e.message}).`)); });
      // Si se cierra después de arrancar, la próxima petición lo vuelve a lanzar.
      child.on('exit', code => { clearTimeout(timer); if (proc === child) { proc = null; starting = null; } reject(fail('opencode_missing', `OpenCode se cerró al arrancar (código ${code}). ${out.slice(-300)}`)); });
    });
    return { base: `http://127.0.0.1:${port}`, headers: headersFor(password) };
  }

  async function ready() {
    if (!starting) {
      starting = (async () => {
        const cfg = settings();
        const conn = cfg.mode === 'local' ? await startLocal(cfg) : { base: String(cfg.url || '').replace(/\/+$/, ''), headers: headersFor(cfg.password) };
        if (!conn.base) throw fail('opencode_unreachable', 'Falta la dirección del servidor de OpenCode en Ajustes.');
        const version = await health(conn.base, conn.headers);
        return { ...conn, version, supported: EXPECTED.test(version) };
      })();
      starting.catch(() => { starting = null; });
    }
    return starting;
  }

  async function request(method, path, { dir, body, query } = {}) {
    const { base, headers } = await ready();
    const qs = new URLSearchParams(query || {});
    if (dir) qs.set('directory', dir);
    const url = `${base}${path}${qs.toString() ? '?' + qs : ''}`;
    let r;
    try { r = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); } catch (e) { throw fail('opencode_unreachable', e.message); }
    if (r.status === 401) throw fail('opencode_auth', 'OpenCode rechazó la contraseña.');
    if (r.status === 204) return null;
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw fail('opencode_http', (data && data.data && data.data.message) || `OpenCode respondió ${r.status} a ${method} ${path}`);
    return data;
  }

  /** La carpeta de una conversación tal como la ve el servidor (equivalencias de Ajustes). */
  function dirFor(hostCwd) {
    const cfg = settings();
    const dir = cfg.mode === 'local' ? hostCwd : map.toServerPath(hostCwd, cfg.pathMap || []);
    if (!dir) throw fail('opencode_path', `La carpeta ${hostCwd} no está compartida con el servidor de OpenCode (revisa las equivalencias de carpetas en Ajustes).`);
    return dir;
  }

  // Un flujo de eventos (SSE) por carpeta del servidor, compartido por todas sus conversaciones.
  function subscribe(dir, fn) {
    let s = streams.get(dir);
    if (!s) {
      s = { listeners: new Set(), ctrl: null, closed: false };
      streams.set(dir, s);
      const loop = async () => {
        let wait = 500;
        while (!s.closed) {
          try {
            const { base, headers } = await ready();
            s.ctrl = new AbortController();
            const r = await fetchImpl(`${base}/event?directory=${encodeURIComponent(dir)}`, { headers, signal: s.ctrl.signal });
            if (!r.ok || !r.body) throw new Error('sin flujo de eventos');
            wait = 500;
            const dec = new TextDecoder();
            let buf = '';
            for await (const chunk of r.body) {
              buf += dec.decode(chunk, { stream: true });
              let i;
              while ((i = buf.indexOf('\n\n')) >= 0) {
                const data = buf.slice(0, i).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
                buf = buf.slice(i + 2);
                if (!data) continue;
                let ev;
                try { ev = JSON.parse(data); } catch { continue; }
                for (const l of [...s.listeners]) { try { l(ev); } catch (e) { console.error('[astro] evento de OpenCode:', e.message); } }
              }
            }
          } catch { /* se reconecta */ }
          if (s.closed) break;
          await new Promise(r => setTimeout(r, wait));
          wait = Math.min(wait * 2, 10000);
        }
      };
      loop();
    }
    s.listeners.add(fn);
    return () => {
      s.listeners.delete(fn);
      if (!s.listeners.size) { s.closed = true; if (s.ctrl) s.ctrl.abort(); streams.delete(dir); }
    };
  }

  /** Cambiaron los ajustes: se suelta todo y la próxima petición conecta de nuevo. */
  function reset() {
    for (const s of streams.values()) { s.closed = true; if (s.ctrl) s.ctrl.abort(); }
    streams.clear();
    starting = null;
    if (proc) { stop(proc); proc = null; }
  }

  return { ready, request, dirFor, subscribe, reset, close: reset };
}

// Bloques de contenido al estilo de la API de Anthropic (imagen + texto) → partes de OpenCode.
function partsOf(content) {
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content) }];
  return content.map(b => (b.type === 'image' && b.source
    ? { type: 'file', mime: b.source.media_type, filename: 'captura.png', url: `data:${b.source.media_type};base64,${b.source.data}` }
    : { type: 'text', text: String(b.text || '') }));
}

/**
 * Una conversación de Astro con OpenCode. Misma interfaz que createClaudeSession:
 * send(text, onEvent) → { done, cancel }, queue(text, id), reply(permissionId, reply), close()…
 */
function createOpencodeSession({ server, cwd, model, allowedTools = [], resume = null, contextWindow = async () => null }) {
  let sessionId = resume;
  let turn = null;
  let unsub = null;
  let closed = false;
  let tools = [...allowedTools];

  async function ensureSession(dir) {
    if (sessionId) return sessionId;
    const s = await server.request('POST', '/session', { dir, body: { title: 'Astro', permission: map.permissionRules(tools) } });
    sessionId = s.id;
    return sessionId;
  }

  function onServerEvent(ev) {
    const t = turn;
    if (!t) return;
    const p = ev.properties || {};
    const sid = p.sessionID || (p.part && p.part.sessionID) || (p.info && p.info.sessionID);
    if (ev.type === 'session.created' && p.info && p.info.parentID && (p.info.parentID === sessionId || t.children.has(p.info.parentID))) {
      // Sesión hija de un subagente: se enlaza con la llamada a task de la misma descripción.
      const title = String(p.info.title || '');
      const key = [...t.tasks.entries()].find(([, v]) => !v.child && title.startsWith(v.description))?.[0]
        || [...t.tasks.entries()].find(([, v]) => !v.child)?.[0];
      if (key) { t.tasks.get(key).child = p.info.id; t.children.set(p.info.id, key); }
      return;
    }
    if (!sid || (sid !== sessionId && !t.children.has(sid))) return;
    const child = sid !== sessionId ? t.children.get(sid) : null;
    if (ev.type === 'message.updated' && p.info) {
      const m = p.info;
      if (m.role === 'user' && !child && !t.users.has(m.id)) {
        t.users.add(m.id);
        // El primero es la pregunta; los siguientes, lo escrito mientras trabajaba (en el orden en que se envió).
        if (t.users.size > 1) { const q = t.pending.find(x => !x.msg); if (q) q.msg = m.id; }
      }
      if (m.role === 'assistant' && !child) {
        const q = t.pending.find(x => x.msg && x.msg === m.parentID);
        if (q) { t.pending = t.pending.filter(x => x !== q); t.onEvent({ type: 'queued-read', qid: q.id }); }
        if (m.error && !t.error) t.error = m.error;
        if (m.tokens) t.tokens = m.tokens;
      }
      return;
    }
    if (ev.type === 'message.part.updated' && p.part) {
      const part = p.part;
      if (part.type === 'tool') {
        const st = part.state || {};
        const seen = t.seen.get(part.id);
        if (seen === st.status) return;
        t.seen.set(part.id, st.status);
        const ct = map.toClaudeTool(part.tool, st.input);
        if (child) {
          if (st.status === 'running' && seen !== 'running') t.onEvent({ type: 'agent-tool', key: child, name: ct.name, label: describeTool(ct.name, ct.input) });
          return;
        }
        if (part.tool === 'task') {
          if ((st.status === 'running' || st.status === 'completed') && !t.tasks.has(part.callID)) {
            const i = st.input || {};
            t.tasks.set(part.callID, { description: String(i.description || 'Subagente'), child: (st.metadata && st.metadata.sessionId) || null });
            if (st.metadata && st.metadata.sessionId) t.children.set(st.metadata.sessionId, part.callID);
            t.onEvent({ type: 'agent-start', key: part.callID, name: String(i.description || 'Subagente'), kind: String(i.subagent_type || ''), task: String(i.prompt || '') });
            t.onEvent({ type: 'tool', name: 'Agent', label: describeTool('Agent', ct.input) });
          }
          if (st.status === 'completed' || st.status === 'error') {
            const out = String(st.output || st.error || '').replace(/<\/?task[^>]*>/g, '').trim();
            t.onEvent({ type: 'agent-end', key: part.callID, ok: st.status === 'completed', text: out });
          }
          return;
        }
        if (st.status === 'running' && seen !== 'running') t.onEvent({ type: 'tool', name: ct.name, label: describeTool(ct.name, ct.input) });
        return;
      }
      if (part.type === 'text' && part.time && part.time.end && part.text && !t.texts.has(part.id)) {
        t.texts.add(part.id);
        if (child) t.onEvent({ type: 'agent-text', key: child, text: part.text });
        else if (!map.parseReply(part.text)) t.onEvent({ type: 'text', text: part.text });
      }
      return;
    }
    if (ev.type === 'permission.asked') {
      // `id` es el de la petición de la interfaz: el del permiso viaja como `pid`.
      const { id: pid, ...req } = map.permissionRequest(p);
      t.onEvent({ type: 'permission', pid, ...req, agent: child || null });
      return;
    }
    if (ev.type === 'session.error' && !child && p.error && !t.error) { t.error = p.error; return; }
    if (((ev.type === 'session.status' && p.status && p.status.type === 'idle') || ev.type === 'session.idle') && !child) finish(t);
  }

  async function finish(t) {
    if (turn !== t || t.finishing) return;
    t.finishing = true;
    try {
      const dir = server.dirFor(cwd);
      const msgs = await server.request('GET', `/session/${sessionId}/message`, { dir, query: { limit: '6' } });
      const last = (Array.isArray(msgs) ? msgs : []).filter(m => m.info && m.info.role === 'assistant').pop();
      const info = last ? last.info : {};
      const err = info.error || t.error;
      if (turn !== t) return;
      turn = null;
      if (err && !(last && last.parts && last.parts.some(x => x.type === 'text' && x.text))) {
        return t.reject(fail(err.name === 'MessageAbortedError' ? 'cancelled' : 'failed', (err.data && err.data.message) || err.name || 'OpenCode no pudo responder'));
      }
      const text = (last ? last.parts : []).filter(x => x.type === 'text' && x.text).map(x => x.text).join('\n').trim();
      const parsed = map.parseReply(text);
      const window = await contextWindow(model).catch(() => null);
      t.resolve({
        text: parsed ? parsed.prose : text,
        structured: parsed ? parsed.data : null,
        sessionId,
        denials: [],
        context: map.contextUsage(info.tokens || t.tokens, window),
      });
    } catch (e) {
      if (turn !== t) return;
      turn = null;
      t.reject(e.code ? e : fail('failed', e.message));
    }
  }

  return {
    get sessionId() { return sessionId; },
    get busy() { return !!turn; },
    get model() { return model; },
    engine: 'opencode',

    warm() { server.ready().catch(() => {}); return this; },
    setIdle() { return this; },
    // Las reglas nuevas valen para las sesiones nuevas; en las abiertas, OpenCode pregunta y se responde.
    setTools(list) { tools = [...list]; return this; },

    send(text, onEvent = () => {}) {
      let t;
      const done = new Promise((resolve, reject) => {
        t = { resolve, reject, onEvent, users: new Set(), pending: [], tasks: new Map(), children: new Map(), seen: new Map(), texts: new Set(), error: null, tokens: null, finishing: false };
      });
      if (closed) { t.reject(fail('cancelled', 'Conversación cerrada')); return { done, cancel() {} }; }
      if (turn) { t.reject(fail('busy', 'Ya hay una pregunta en curso')); return { done, cancel() {} }; }
      turn = t;
      (async () => {
        const dir = server.dirFor(cwd);
        await ensureSession(dir);
        if (!unsub) unsub = server.subscribe(dir, onServerEvent);
        t.onEvent({ type: 'start', sessionId });
        const m = map.splitModel(model);
        const slash = typeof text === 'string' && /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
        if (slash) {
          // Un comando / de OpenCode: el servidor lo ejecuta y la respuesta llega por eventos.
          server.request('POST', `/session/${sessionId}/command`, { dir, body: { command: slash[1], arguments: slash[2] || '', ...(m ? { model: model } : {}) } })
            .catch(e => { if (turn === t) { turn = null; t.reject(e); } });
        } else {
          await server.request('POST', `/session/${sessionId}/prompt_async`, { dir, body: { ...(m ? { model: m } : {}), system: map.OPENCODE_RULES(cwd), parts: partsOf(text) } });
        }
      })().catch(e => { if (turn === t) { turn = null; t.reject(e.code ? e : fail('failed', e.message)); } });
      return {
        done,
        cancel() {
          if (turn !== t) return;
          turn = null;
          if (sessionId) server.request('POST', `/session/${sessionId}/abort`, { dir: server.dirFor(cwd) }).catch(() => {});
          t.reject(fail('cancelled', 'Cancelado'));
        },
      };
    },

    /** Otro mensaje mientras trabaja: OpenCode lo incorpora a la tarea en curso. */
    queue(text, id) {
      if (closed || !turn || !sessionId || typeof text !== 'string' || !text.trim()) return false;
      const t = turn;
      t.pending.push({ id, text, msg: null });
      const m = map.splitModel(model);
      server.request('POST', `/session/${sessionId}/prompt_async`, { dir: server.dirFor(cwd), body: { ...(m ? { model: m } : {}), parts: [{ type: 'text', text }] } }).catch(() => {});
      return true;
    },

    /** Respuesta a una solicitud de permiso: 'once' | 'always' | 'reject'. */
    reply(permissionId, reply) {
      return server.request('POST', `/permission/${encodeURIComponent(permissionId)}/reply`, { dir: server.dirFor(cwd), body: { reply } });
    },

    close() {
      closed = true;
      if (turn) { const t = turn; turn = null; if (sessionId) server.request('POST', `/session/${sessionId}/abort`, { dir: server.dirFor(cwd) }).catch(() => {}); t.reject(fail('cancelled', 'Conversación cerrada')); }
      if (unsub) { unsub(); unsub = null; }
    },
  };
}

module.exports = { createOpencodeServer, createOpencodeSession, partsOf, EXPECTED };
