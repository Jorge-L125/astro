const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpencodeSessionV2 } = require('../src/opencode-v2');

// Un servidor 2.x de mentira: apunta las peticiones y deja soltar eventos a mano.
function fakeServer(over = {}) {
  const calls = [];
  let listener = null;
  const srv = {
    calls,
    ready: async () => ({ api: 'v2', version: '2.0.28' }),
    dirFor: p => p,
    subscribe: (_dir, fn) => { listener = fn; return () => { listener = null; }; },
    emit: (type, data, extra = {}) => listener && listener({ type, data, ...extra }),
    request: async (method, path, opts = {}) => {
      calls.push({ method, path, body: opts.body, dir: opts.dir, query: opts.query });
      if (over.request) { const r = await over.request(method, path, opts); if (r !== undefined) return r; }
      if (method === 'POST' && path === '/api/session') return { data: { id: 'ses_1' } };
      if (method === 'POST' && /\/prompt$/.test(path)) return { data: { id: 'msg_' + calls.length } };
      if (method === 'GET' && /\/message/.test(path)) return { data: [{ id: 'm2', type: 'assistant', time: { created: 2, completed: 3 }, content: [{ type: 'text', text: '{"mood":"happy","title":"T","lines":["Hecho"],"detail":null}' }], tokens: { input: 100, output: 20 } }] };
      return null;
    },
  };
  return srv;
}
const tick = () => new Promise(r => setImmediate(r));
const collect = () => { const ev = []; return { ev, on: e => ev.push(e) }; };
const reply = '{"mood":"happy","title":"T","lines":["Hecho"],"detail":null}';

test('2.x: crea la sesión en su carpeta, le da las instrucciones de Astro y envía la pregunta', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: 'opencode/cat-jam-free' });
  const { ev, on } = collect();
  const h = s.send('hola', on);
  await tick(); await tick(); await tick();
  const create = srv.calls.find(c => c.path === '/api/session');
  assert.deepEqual(create.body.location, { directory: 'C:/p' });
  const instr = srv.calls.find(c => /instructions\/entries\/astro$/.test(c.path));
  assert.equal(instr.method, 'PUT');
  assert.match(instr.body.value, /Te llamas Astro/);
  const prompt = srv.calls.find(c => /\/prompt$/.test(c.path));
  assert.equal(prompt.path, '/api/session/ses_1/prompt');
  assert.equal(prompt.body.text, 'hola');
  assert.deepEqual(prompt.body.model, { providerID: 'opencode', id: 'cat-jam-free' });
  assert.deepEqual(ev[0], { type: 'start', sessionId: 'ses_1' });
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  const r = await h.done;
  assert.equal(r.sessionId, 'ses_1');
  assert.equal(r.structured.lines[0], 'Hecho');
  assert.deepEqual(r.context, null, 'sin ventana de contexto no se calcula');
  assert.equal(s.busy, false);
});

test('2.x: retomar no crea otra sesión pero sí repone las instrucciones', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: null, resume: 'ses_viejo' });
  const h = s.send('sigue', () => {});
  await tick(); await tick(); await tick();
  assert.equal(srv.calls.some(c => c.method === 'POST' && c.path === '/api/session'), false);
  assert.ok(srv.calls.some(c => /ses_viejo\/instructions\/entries\/astro$/.test(c.path)));
  assert.ok(srv.calls.some(c => c.path === '/api/session/ses_viejo/prompt'));
  assert.equal(srv.calls.find(c => /prompt$/.test(c.path)).body.model, undefined);
  srv.emit('session.execution.succeeded', { sessionID: 'ses_viejo' });
  await h.done;
});

test('2.x: las herramientas se cuentan como en Claude Code y el texto intermedio se muestra', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: null });
  const { ev, on } = collect();
  const h = s.send('cuenta', on);
  await tick(); await tick(); await tick();
  srv.emit('session.tool.input.started', { sessionID: 'ses_1', id: 'c1', name: 'shell' });
  srv.emit('session.tool.called', { sessionID: 'ses_1', id: 'c1', input: { command: 'ls src' } });
  srv.emit('session.tool.called', { sessionID: 'ses_1', id: 'c1', input: { command: 'ls src' } });
  srv.emit('session.text.ended', { sessionID: 'ses_1', text: 'Voy a mirar la carpeta' });
  srv.emit('session.text.ended', { sessionID: 'ses_1', text: reply });
  srv.emit('session.text.ended', { sessionID: 'ses_otra', text: 'de otra conversación' });
  const tools = ev.filter(e => e.type === 'tool');
  assert.deepEqual(tools.map(t => [t.name, t.label]), [['Bash', 'Ejecutando ls src']], 'cada llamada se cuenta una sola vez');
  assert.deepEqual(ev.filter(e => e.type === 'text').map(e => e.text), ['Voy a mirar la carpeta'], 'la respuesta JSON no se enseña como texto');
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h.done;
});

test('2.x: un subagente aparece, trabaja y termina', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: null });
  const { ev, on } = collect();
  const h = s.send('reparte', on);
  await tick(); await tick(); await tick();
  srv.emit('session.tool.input.started', { sessionID: 'ses_1', id: 'call-A', name: 'subagent' });
  srv.emit('session.tool.called', { sessionID: 'ses_1', id: 'call-A', input: { agent: 'explore', description: 'Contar', prompt: 'Cuenta los archivos' } });
  srv.emit('session.created', { sessionID: 'ses_hija', parentID: 'ses_1', title: 'Contar', agent: 'explore' });
  srv.emit('session.tool.progress', { sessionID: 'ses_1', id: 'call-A', metadata: { sessionID: 'ses_hija', status: 'running' } });
  srv.emit('session.tool.input.started', { sessionID: 'ses_hija', id: 'h1', name: 'glob' });
  srv.emit('session.tool.called', { sessionID: 'ses_hija', id: 'h1', input: { pattern: '*.txt' } });
  srv.emit('session.text.ended', { sessionID: 'ses_hija', text: 'Hay 2 archivos' });
  srv.emit('session.execution.succeeded', { sessionID: 'ses_hija' }); // el de la hija no cierra el turno
  srv.emit('session.tool.success', { sessionID: 'ses_1', id: 'call-A', content: [{ type: 'text', text: 'Hay 2 archivos' }] });
  assert.equal(s.busy, true, 'el turno sigue');
  const start = ev.find(e => e.type === 'agent-start');
  assert.deepEqual([start.key, start.name, start.kind, start.task], ['call-A', 'Contar', 'explore', 'Cuenta los archivos']);
  assert.deepEqual(ev.filter(e => e.type === 'agent-tool').map(e => [e.key, e.name]), [['call-A', 'Glob']]);
  assert.deepEqual(ev.filter(e => e.type === 'agent-text').map(e => [e.key, e.text]), [['call-A', 'Hay 2 archivos']]);
  assert.deepEqual(ev.filter(e => e.type === 'agent-end').map(e => [e.key, e.ok, e.text]), [['call-A', true, 'Hay 2 archivos']]);
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h.done;
});

test('2.x: lo permitido se aprueba solo y lo demás se pregunta', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: null, allowedTools: ['Read', 'Bash(pnpm test:*)'] });
  const { ev, on } = collect();
  const h = s.send('haz', on);
  await tick(); await tick(); await tick();
  srv.emit('permission.asked', { id: 'per_1', sessionID: 'ses_1', action: 'read', resources: ['C:/p/a.js'], save: [] });
  srv.emit('permission.asked', { id: 'per_2', sessionID: 'ses_1', action: 'shell', resources: ['pnpm test'], save: ['pnpm *'] });
  srv.emit('permission.asked', { id: 'per_3', sessionID: 'ses_1', action: 'shell', resources: ['rm -rf dist'], save: ['rm *'] });
  await tick();
  const replies = srv.calls.filter(c => /permission\/.+\/reply$/.test(c.path));
  assert.deepEqual(replies.map(c => [c.path, c.body.decision]), [
    ['/api/session/ses_1/permission/per_1/reply', 'once'],
    ['/api/session/ses_1/permission/per_2/reply', 'once'],
  ]);
  const asked = ev.filter(e => e.type === 'permission');
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].pid, asked[0].tool, asked[0].input.command, asked[0].always], ['per_3', 'Bash', 'rm -rf dist', ['rm *']]);
  await s.reply('per_3', 'reject');
  const rej = srv.calls.filter(c => /permission\/per_3\/reply$/.test(c.path)).pop();
  assert.deepEqual([rej.path, rej.body.decision], ['/api/session/ses_1/permission/per_3/reply', 'reject']);
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h.done;
});

test('2.x: un permiso de un subagente se contesta en la sesión del subagente', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: null });
  const { ev, on } = collect();
  const h = s.send('reparte', on);
  await tick(); await tick(); await tick();
  srv.emit('session.tool.input.started', { sessionID: 'ses_1', id: 'call-A', name: 'subagent' });
  srv.emit('session.tool.called', { sessionID: 'ses_1', id: 'call-A', input: { description: 'Contar' } });
  srv.emit('session.tool.progress', { sessionID: 'ses_1', id: 'call-A', metadata: { sessionID: 'ses_hija' } });
  srv.emit('permission.asked', { id: 'per_9', sessionID: 'ses_hija', action: 'edit', resources: ['C:/p/x.js'], save: [] });
  const p = ev.find(e => e.type === 'permission');
  assert.equal(p.agent, 'call-A');
  await s.reply('per_9', 'once');
  assert.ok(srv.calls.some(c => c.path === '/api/session/ses_hija/permission/per_9/reply'));
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h.done;
});

test('2.x: escribir mientras trabaja: «Leído» llega cuando el servidor lo entrega', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: 'opencode/cat' });
  const { ev, on } = collect();
  const h = s.send('empieza', on);
  await tick(); await tick(); await tick();
  assert.equal(s.queue('y además esto', 'q1'), true);
  await tick(); await tick();
  const queued = srv.calls.filter(c => /\/prompt$/.test(c.path)).pop();
  assert.equal(queued.body.text, 'y además esto');
  srv.emit('session.inbox.delivered', { sessionID: 'ses_1', inboxID: queued && 'msg_' + (srv.calls.indexOf(queued) + 1) });
  assert.deepEqual(ev.filter(e => e.type === 'queued-read'), [{ type: 'queued-read', qid: 'q1' }]);
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h.done;
  assert.equal(s.queue('tarde', 'q2'), false, 'sin turno en curso no se encola');
});

test('2.x: detener interrumpe la sesión; un fallo del servidor se cuenta', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: null });
  const h = s.send('largo', () => {});
  await tick(); await tick(); await tick();
  h.cancel();
  await assert.rejects(h.done, e => e.code === 'cancelled');
  assert.ok(srv.calls.some(c => c.method === 'POST' && c.path === '/api/session/ses_1/interrupt'));

  const s2 = createOpencodeSessionV2({ server: fakeServer(), cwd: 'C:/p', model: null });
  const srv2 = fakeServer();
  const s3 = createOpencodeSessionV2({ server: srv2, cwd: 'C:/p', model: null });
  const h3 = s3.send('falla', () => {});
  await tick(); await tick(); await tick();
  srv2.emit('session.execution.failed', { sessionID: 'ses_1', error: { message: 'Sin crédito' } });
  await assert.rejects(h3.done, e => e.code === 'failed' && /Sin crédito/.test(e.message));
  assert.equal(s2.busy, false);
});

test('2.x: un comando / se ejecuta en el servidor y una captura viaja como archivo', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: 'opencode/cat' });
  const h = s.send('/review main', () => {});
  await tick(); await tick(); await tick();
  const cmd = srv.calls.find(c => /\/command$/.test(c.path));
  assert.deepEqual([cmd.path, cmd.body.name, cmd.body.text], ['/api/session/ses_1/command', 'review', 'main']);
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h.done;

  const srv2 = fakeServer();
  const s2 = createOpencodeSessionV2({ server: srv2, cwd: 'C:/p', model: null });
  const h2 = s2.send([{ type: 'image', source: { media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: '¿qué ves?' }], () => {});
  await tick(); await tick(); await tick();
  const p = srv2.calls.find(c => /\/prompt$/.test(c.path));
  assert.equal(p.body.text, '¿qué ves?');
  assert.deepEqual(p.body.files, [{ mime: 'image/png', name: 'captura.png', data: 'AAAA' }]);
  srv2.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  await h2.done;
});

test('2.x: el uso del contexto sale de los tokens y la ventana del modelo', async () => {
  const srv = fakeServer();
  const s = createOpencodeSessionV2({ server: srv, cwd: 'C:/p', model: 'opencode/cat', contextWindow: async () => 1000 });
  const h = s.send('hola', () => {});
  await tick(); await tick(); await tick();
  srv.emit('session.execution.succeeded', { sessionID: 'ses_1' });
  const r = await h.done;
  assert.deepEqual(r.context, { used: 120, window: 1000 });
});
