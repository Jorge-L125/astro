const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ASTRO_RULES } = require('../src/prompts');
const { createOpencodeSession } = require('../src/opencode');
const map = require('../src/opencode-map');
const { mapTools } = require('../src/graphify-prompt');

test('ASTRO_RULES sin extra no cambia y con extra lo añade al final', () => {
  const base = ASTRO_RULES('/x');
  assert.ok(base.startsWith('Te llamas Astro'));
  assert.equal(ASTRO_RULES('/x', undefined), base);
  assert.equal(ASTRO_RULES('/x', ''), base);
  const con = ASTRO_RULES('/x', 'MAPA DEL PROYECTO');
  assert.ok(con.startsWith(base));
  assert.ok(con.endsWith('\n\nMAPA DEL PROYECTO'));
});

test('rulesFor de OpenCode: igual que hoy sin extra; con extra, al final', () => {
  assert.equal(map.rulesFor('/x'), map.OPENCODE_RULES('/x'));
  assert.equal(map.rulesFor('/x', ''), map.OPENCODE_RULES('/x'));
  assert.equal(map.rulesFor('/x', 'MAPA'), map.OPENCODE_RULES('/x') + '\n\nMAPA');
});

// Un servidor de mentira que dice qué API habla y apunta lo que se le pide.
function fakeServer(api) {
  const calls = [];
  return {
    calls,
    ready: async () => ({ api, version: api === 'v2' ? '2.0.28' : '1.19.0' }),
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
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

async function rulesSent(api, rulesExtra) {
  const srv = fakeServer(api);
  const s = createOpencodeSession({ server: srv, cwd: 'C:/p', model: 'opencode/cat', ...(rulesExtra ? { rulesExtra } : {}) });
  const h = s.send('hola', () => {});
  await settle();
  h.cancel();
  await assert.rejects(h.done, { code: 'cancelled' });
  const c = api === 'v2' ? srv.calls.find(x => /instructions\/entries\/astro$/.test(x.path)) : srv.calls.find(x => /prompt_async$/.test(x.path));
  return api === 'v2' ? c.body.value : c.body.system;
}

test('OpenCode 2.x: las instrucciones de la sesión llevan el extra solo si se da', async () => {
  const con = await rulesSent('v2', 'MAPA DEL PROYECTO');
  assert.ok(con.includes('Te llamas Astro') && con.endsWith('\n\nMAPA DEL PROYECTO'));
  const sin = await rulesSent('v2');
  assert.ok(!sin.includes('MAPA DEL PROYECTO'));
  assert.equal(sin, map.OPENCODE_RULES('C:/p'));
});

test('OpenCode 1.x: el system del prompt lleva el extra solo si se da', async () => {
  const con = await rulesSent('v1', 'MAPA DEL PROYECTO');
  assert.ok(con.endsWith('\n\nMAPA DEL PROYECTO'));
  const sin = await rulesSent('v1');
  assert.equal(sin, map.OPENCODE_RULES('C:/p'));
});

test('los permisos del mapa dejan las consultas de solo lectura y nada más', () => {
  const tools = mapTools('C:/g/graphify.exe');
  for (const ok of ['query "dónde" --graph "C:/m/graph.json" --budget 1500', 'explain "x" --graph "y"', 'path "A" "B" --graph "y"', 'affected "x" --graph "y"', 'god-nodes --graph "y"']) {
    assert.equal(map.allowsRequest(tools, 'shell', ['C:/g/graphify.exe ' + ok]), true, ok);
  }
  for (const no of ['uninstall --purge', 'extract . --out x', 'install --platform claude', 'update .', 'label .']) {
    assert.equal(map.allowsRequest(tools, 'shell', ['C:/g/graphify.exe ' + no]), false, no);
  }
  assert.equal(map.allowsRequest(tools, 'shell', ['rm -rf x']), false);
});
