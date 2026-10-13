const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/opencode-api');

// Un servidor de mentira con respuestas por ruta; apunta lo que se le pide.
function fakeServer(version, routes) {
  const calls = [];
  return {
    calls,
    ready: async () => ({ api: version }),
    dirFor: p => p,
    request: async (method, path, opts = {}) => {
      calls.push({ method, path, dir: opts.dir, query: opts.query });
      const key = Object.keys(routes).find(k => path === k || (k.endsWith('*') && path.startsWith(k.slice(0, -1))));
      if (!key) throw new Error('ruta no prevista ' + path);
      const r = routes[key];
      return typeof r === 'function' ? r(opts) : r;
    },
  };
}

test('modelos: 1.x los saca de /provider y 2.x de /api/model', async () => {
  const v1 = fakeServer('v1', { '/provider': { connected: ['opencode'], all: [
    { id: 'opencode', name: 'OpenCode Zen', models: { cat: { name: 'Cat', limit: { context: 1000 }, cost: { input: 0, output: 0 } } } },
    { id: 'openai', name: 'OpenAI', models: { gpt: { name: 'GPT' } } },
  ] } });
  assert.deepEqual(await api.models(v1), [{ id: 'opencode/cat', name: 'Cat', provider: 'OpenCode Zen', context: 1000, free: true }]);
  const v2 = fakeServer('v2', { '/api/model': { data: [{ id: 'cat', modelID: 'cat', providerID: 'opencode', name: 'Cat', enabled: true, status: 'active', limit: { context: 5 }, cost: [{ input: 0, output: 0 }] }] } });
  assert.deepEqual((await api.models(v2)).map(m => [m.id, m.free, m.context]), [['opencode/cat', true, 5]]);
});

test('comandos /: cada versión con su ruta', async () => {
  const v1 = fakeServer('v1', { '/command': [{ name: 'init', description: 'AGENTS.md' }] });
  assert.deepEqual((await api.commands(v1, 'C:/p')).map(c => c.name), ['init']);
  assert.equal(v1.calls[0].dir, 'C:/p');
  const v2 = fakeServer('v2', { '/api/command': { data: [{ name: 'review', description: 'revisa' }] } });
  const list = await api.commands(v2, 'C:/p');
  assert.deepEqual([list[0].name, list[0].kind], ['review', 'task']);
  assert.equal(v2.calls[0].dir, 'C:/p');
});

test('2.x: las conversaciones de la carpeta, sin subagentes ni de otras carpetas', async () => {
  const ses = (id, dir, over = {}) => ({ id, title: 'Astro', time: { created: 1, updated: Number(id.slice(-1)) }, location: { directory: dir }, ...over });
  const msgs = id => ({ data: [{ id: 'b', type: 'assistant', time: { created: 3, completed: 4 }, content: [{ type: 'text', text: 'Respuesta ' + id }] }, { id: 'a', type: 'user', time: { created: 2 }, text: 'Pregunta ' + id }] });
  const srv = fakeServer('v2', {
    '/api/session': { data: [
      ses('ses_1', 'C:\\Users\\ana\\p'),
      ses('ses_2', 'C:\\Users\\ana\\p'),
      ses('ses_3', 'C:\\Users\\ana\\otra'),
      ses('ses_4', 'C:\\Users\\ana\\p', { parentID: 'ses_1' }),
    ] },
    '/api/session/*': o => msgs(o.query && o.query.limit),
  });
  const items = await api.sessions(srv, 'C:/Users/ana/p');
  assert.deepEqual(items.map(x => x.id), ['ses_2', 'ses_1'], 'la más reciente primero');
  assert.equal(items[0].questions, 1);
  assert.equal(items[0].engine, 'opencode');
});

test('2.x: la conversación entera se lee de página en página', async () => {
  const pages = [
    { data: [{ id: 'm1', type: 'user', time: { created: 1 }, text: 'uno' }, { id: 'm2', type: 'assistant', time: { created: 2 }, content: [{ type: 'text', text: 'resp uno' }] }], cursor: { next: 'c1' } },
    { data: [{ id: 'm3', type: 'user', time: { created: 3 }, text: 'dos' }], cursor: { next: 'c2' } },
    { data: [], cursor: {} },
  ];
  let i = 0;
  const srv = fakeServer('v2', { '/api/session/*': () => pages[i++] });
  const items = await api.conversation(srv, 'C:/p', 'ses_1');
  assert.deepEqual(items.map(x => x.text), ['uno', 'resp uno', 'dos']);
  assert.equal(srv.calls[0].query.order, 'asc');
  assert.equal(srv.calls[1].query.cursor, 'c1');
  assert.equal(srv.calls[1].query.order, undefined, 'con cursor no se manda order');
});

test('1.x: la conversación y la lista siguen con la API de siempre', async () => {
  const srv = fakeServer('v1', {
    '/session/ses_1/message': [{ info: { role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: 'hola' }] }],
    '/session': [{ id: 'ses_1', title: 'Astro', directory: 'C:/p', time: { created: 1, updated: 5 } }],
    '/session/ses_1/message*': [{ info: { role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: 'hola' }] }],
  });
  assert.deepEqual((await api.conversation(srv, 'C:/p', 'ses_1')).map(x => x.text), ['hola']);
  const list = await api.sessions(srv, 'C:/p');
  assert.deepEqual(list.map(x => [x.id, x.questions]), [['ses_1', 1]]);
});

test('2.x: los comandos / recién arrancado el servidor llegan vacíos y se reintenta', async () => {
  let n = 0;
  const srv = fakeServer('v2', { '/api/command': () => ({ data: ++n < 3 ? [] : [{ name: 'init', description: 'AGENTS.md' }] }) });
  const list = await api.commands(srv, 'C:/p', { retryMs: 1 });
  assert.deepEqual(list.map(c => c.name), ['init']);
  assert.equal(n, 3);
  const vacio = fakeServer('v2', { '/api/command': { data: [] } });
  assert.deepEqual(await api.commands(vacio, 'C:/p', { retryMs: 1 }), [], 'si de verdad no hay, se rinde tras reintentar');
});
