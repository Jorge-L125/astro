const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpencodeSession } = require('../src/opencode');

// Un servidor de mentira que dice qué API habla y apunta la primera petición de la conversación.
function fakeServer(api, over = {}) {
  const calls = [];
  return {
    calls,
    ready: async () => { if (over.readyError) throw over.readyError; return { api, version: api === 'v2' ? '2.0.28' : '1.19.0' }; },
    dirFor: p => p,
    subscribe: () => () => {},
    request: async (method, path, opts = {}) => {
      calls.push({ method, path, body: opts.body });
      if (method === 'POST' && (path === '/api/session' || path === '/session')) return api === 'v2' ? { data: { id: 'ses_9' } } : { id: 'ses_9' };
      if (/\/prompt/.test(path)) return api === 'v2' ? { data: { id: 'msg_1' } } : null;
      return null;
    },
  };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

test('con un servidor 2.x habla la API de /api', async () => {
  const srv = fakeServer('v2');
  const s = createOpencodeSession({ server: srv, cwd: 'C:/p', model: 'opencode/cat' });
  const h = s.send('hola', () => {});
  await settle();
  assert.ok(srv.calls.some(c => c.method === 'POST' && c.path === '/api/session'));
  assert.equal(s.sessionId, 'ses_9');
  assert.equal(s.busy, true);
  h.cancel();
  await assert.rejects(h.done, { code: 'cancelled' });
});

test('con un servidor 1.x sigue hablando la API de siempre', async () => {
  const srv = fakeServer('v1');
  const s = createOpencodeSession({ server: srv, cwd: 'C:/p', model: 'opencode/cat' });
  const h = s.send('hola', () => {});
  await settle();
  assert.ok(srv.calls.some(c => c.method === 'POST' && c.path === '/session'));
  assert.ok(srv.calls.some(c => c.path === '/session/ses_9/prompt_async'));
  h.cancel();
  await assert.rejects(h.done, { code: 'cancelled' });
});

test('mientras se decide la API ya cuenta como ocupada y se puede cancelar', async () => {
  const srv = fakeServer('v2');
  const s = createOpencodeSession({ server: srv, cwd: 'C:/p', model: null });
  const h = s.send('hola', () => {});
  assert.equal(s.busy, true);
  h.cancel();
  await assert.rejects(h.done, { code: 'cancelled' });
  await settle();
  assert.equal(srv.calls.some(c => /prompt/.test(c.path)), false, 'una pregunta cancelada antes de empezar no se envía');
  assert.equal(s.busy, false);
});

test('si OpenCode no está disponible, el error llega y se puede reintentar', async () => {
  const err = Object.assign(new Error('No encuentro el comando opencode'), { code: 'opencode_missing' });
  const srv = fakeServer('v2', { readyError: err });
  const s = createOpencodeSession({ server: srv, cwd: 'C:/p', model: null });
  await assert.rejects(s.send('hola', () => {}).done, { code: 'opencode_missing' });
  assert.equal(s.busy, false);
  await assert.rejects(s.send('otra', () => {}).done, { code: 'opencode_missing' });
});

test('setTools, queue y reply antes de empezar no rompen', async () => {
  const s = createOpencodeSession({ server: fakeServer('v2'), cwd: 'C:/p', model: null });
  assert.equal(s.setTools(['Read']), s);
  assert.equal(s.queue('x', 'q'), false);
  await assert.rejects(s.reply('per', 'once'));
  s.close();
});
