const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/opencode-map');

test('lee la respuesta de Astro dentro del texto del modelo', () => {
  const r = m.parseReply('Versión `0.7.2`.\n\n{"mood":"happy","title":"Listo","lines":["Va en la 0.7.2."],"detail":null,"code":{"lang":"js","content":"const a = \\"}\\";"}}');
  assert.equal(r.data.title, 'Listo');
  assert.deepEqual(r.data.lines, ['Va en la 0.7.2.']);
  assert.equal(r.data.code.content, 'const a = "}";', 'una llave dentro de una cadena no corta el JSON');
  assert.equal(r.prose, 'Versión `0.7.2`.');
  assert.equal(m.parseReply('Solo texto, sin JSON.'), null);
  assert.equal(m.parseReply('{"a":1}'), null, 'sin "lines" no es una respuesta de Astro');
  assert.equal(m.parseReply('{"lines":["uno"],"mood":"neutral"} y después {"x":1}').data.lines[0], 'uno');
});

test('traduce las herramientas de OpenCode a las de Claude Code', () => {
  assert.deepEqual(m.toClaudeTool('read', { filePath: '/p/a.js' }).input.file_path, '/p/a.js');
  assert.equal(m.toClaudeTool('read').name, 'Read');
  assert.equal(m.toClaudeTool('bash', { command: 'ls' }).input.command, 'ls');
  assert.equal(m.toClaudeTool('task').name, 'Agent');
  assert.equal(m.toClaudeTool('raro').name, 'raro');
});

test('allowedTools se convierte en reglas de permisos de OpenCode', () => {
  const rules = m.permissionRules(['Read', 'Glob', 'Grep', 'WebFetch', 'Bash(pnpm test:*)']);
  const act = (perm, pat = '*') => rules.filter(r => r.permission === perm && r.pattern === pat).map(r => r.action).pop();
  assert.deepEqual(rules[0], { permission: '*', pattern: '*', action: 'ask' }, 'lo demás pregunta');
  assert.equal(act('read'), 'allow');
  assert.equal(act('list'), 'allow');
  assert.equal(act('webfetch'), 'allow');
  assert.equal(act('task'), 'allow', 'los subagentes van siempre');
  assert.equal(act('bash', 'pnpm test *'), 'allow', 'un comando concreto');
  assert.equal(act('bash'), undefined, 'el resto de comandos pregunta');
  assert.equal(act('edit'), undefined);
});

test('una solicitud de permiso se cuenta como en Claude Code', () => {
  const r = m.permissionRequest({ id: 'per_1', permission: 'bash', patterns: ['ls renderer', 'wc -l'], metadata: { command: 'ls renderer | wc -l' }, always: ['ls *', 'wc *'] });
  assert.deepEqual([r.id, r.tool, r.input.command, r.always.length], ['per_1', 'Bash', 'ls renderer | wc -l', 2]);
  assert.equal(m.permissionRequest({ permission: 'edit', metadata: { filepath: '/p/x.js' } }).input.file_path, '/p/x.js');
});

test('equivalencia de carpetas entre el equipo y el servidor', () => {
  const win = (...parts) => parts.join('\\');
  const map = [{ host: win('C:', 'Users', 'yo', 'Documents'), server: '/work' }];
  assert.equal(m.toServerPath(win('C:', 'Users', 'yo', 'Documents', 'proyecto'), map, true), '/work/proyecto');
  assert.equal(m.toServerPath(win('c:', 'users', 'yo', 'documents'), map, true), '/work');
  assert.equal(m.toServerPath(win('C:', 'Users', 'yo', 'Documentos'), map, true), null, 'fuera de lo compartido');
  assert.equal(m.toServerPath(win('C:', 'otra'), [], true), win('C:', 'otra'), 'sin equivalencias va tal cual');
  assert.equal(m.toHostPath('/work/proyecto/src', map), win('C:', 'Users', 'yo', 'Documents', 'proyecto', 'src'));
});

test('la conversación de OpenCode con los formatos de /historial y /resume', () => {
  const msgs = [
    { info: { role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: '¿Qué versión?' }] },
    { info: { role: 'assistant', time: { created: 2, completed: 3 } }, parts: [{ type: 'text', text: 'Miro.' }] },
    { info: { role: 'assistant', time: { created: 4, completed: 5 } }, parts: [{ type: 'text', text: '{"mood":"happy","title":"Versión","lines":["La 0.7.2."]}' }] },
    { info: { role: 'user', time: { created: 6 } }, parts: [{ type: 'text', text: '¿Y el nombre?' }, { type: 'text', text: 'interno', synthetic: true }] },
    { info: { role: 'assistant', time: { created: 7, completed: 8 } }, parts: [{ type: 'text', text: 'astro-bot' }] },
  ];
  const items = m.conversationItems(msgs);
  assert.deepEqual(items.map(x => x.role + ':' + (x.text || x.data.lines[0])), ['user:¿Qué versión?', 'bot:La 0.7.2.', 'user:¿Y el nombre?', 'bot:astro-bot']);
  const it = m.listItem({ id: 'ses_1', title: 'Astro', time: { updated: 9 } }, msgs);
  assert.deepEqual([it.id, it.mtime, it.title, it.last, it.questions, it.astro, it.lastText, it.engine], ['ses_1', 9, '¿Qué versión?', '¿Y el nombre?', 2, false, 'astro-bot', 'opencode']);
});

test('comandos, uso de contexto y modelo', () => {
  assert.deepEqual(m.commandList([{ name: 'review', source: 'command', description: 'Revisa' }, { name: 'x', source: 'skill' }]).map(c => [c.name, c.kind]), [['review', 'task'], ['x', 'skill']]);
  assert.deepEqual(m.contextUsage({ input: 1000, output: 50, reasoning: 0, cache: { read: 8000, write: 0 } }, 200000), { used: 9050, window: 200000 });
  assert.equal(m.contextUsage({}, 0), null);
  assert.deepEqual(m.splitModel('opencode/big-pickle'), { providerID: 'opencode', modelID: 'big-pickle' });
  assert.deepEqual(m.splitModel('github-copilot/gpt-4.1'), { providerID: 'github-copilot', modelID: 'gpt-4.1' });
  assert.equal(m.splitModel('solo'), null);
  assert.match(m.OPENCODE_RULES('/work/p'), /\/work\/p/);
});

/* ---------- OpenCode 2.x ---------- */
test('2.x: sus herramientas se traducen a las de Claude Code', () => {
  assert.equal(m.toClaudeTool('shell', { command: 'ls' }).name, 'Bash');
  assert.equal(m.toClaudeTool('shell', { command: 'ls' }).input.command, 'ls');
  assert.equal(m.toClaudeTool('subagent', { agent: 'explore', description: 'Contar', prompt: 'Cuenta' }).name, 'Agent');
  assert.equal(m.toClaudeTool('subagent', { agent: 'explore' }).input.subagent_type, 'explore');
});

test('2.x: una solicitud de permiso se cuenta como en Claude Code', () => {
  const sh = m.permissionRequestV2({ id: 'per_1', action: 'shell', resources: ['echo hola'], save: ['echo *'] });
  assert.deepEqual([sh.id, sh.tool, sh.input.command, sh.always], ['per_1', 'Bash', 'echo hola', ['echo *']]);
  assert.equal(m.permissionRequestV2({ id: 'p', action: 'edit', resources: ['/p/x.js'] }).input.file_path, '/p/x.js');
  assert.equal(m.permissionRequestV2({ id: 'p', action: 'read', resources: ['/p/y.js'] }).tool, 'Read');
  assert.equal(m.permissionRequestV2({ id: 'p', action: 'webfetch', resources: ['https://a.dev/x'] }).input.url, 'https://a.dev/x');
  assert.equal(m.permissionRequestV2({ id: 'p', action: 'rara', resources: [] }).tool, 'rara');
});

test('2.x: lo que ya tienes permitido se aprueba solo', () => {
  const allow = ['Read', 'Glob', 'Bash(pnpm test:*)', 'Edit'];
  assert.equal(m.allowsRequest(allow, 'read', ['/p/a.js']), true);
  assert.equal(m.allowsRequest(allow, 'edit', ['/p/a.js']), true);
  assert.equal(m.allowsRequest(allow, 'shell', ['pnpm test']), true);
  assert.equal(m.allowsRequest(allow, 'shell', ['pnpm test --watch']), true);
  assert.equal(m.allowsRequest(allow, 'shell', ['rm -rf x']), false, 'otro comando pregunta');
  assert.equal(m.allowsRequest(allow, 'shell', ['pnpm testx']), false, 'el comando debe coincidir entero');
  assert.equal(m.allowsRequest(['Bash'], 'shell', ['cualquier cosa']), true);
  assert.equal(m.allowsRequest(allow, 'webfetch', ['https://a.dev']), false);
  assert.equal(m.allowsRequest(allow, 'subagent', ['x']), true, 'los subagentes van siempre');
  assert.equal(m.allowsRequest([], 'read', ['/p/a.js']), false);
  assert.equal(m.allowsRequest(allow, 'shell', []), false, 'sin recursos no se adivina');
});

test('2.x: la conversación (más nueva primero) se lee en orden', () => {
  const msgs = [
    { id: 'm5', type: 'idle', time: { created: 5 } },
    { id: 'm4', type: 'assistant', time: { created: 4, completed: 40 }, content: [{ type: 'reasoning', text: 'pienso' }, { type: 'text', text: '{"mood":"happy","title":"T","lines":["Hecho"],"detail":null}' }] },
    { id: 'm3', type: 'assistant', time: { created: 3, completed: 30 }, content: [{ type: 'tool', name: 'shell', state: { status: 'completed' } }] },
    { id: 'm2', type: 'user', time: { created: 2 }, text: 'cuenta los archivos' },
    { id: 'm1', type: 'assistant', time: { created: 1, completed: 10 }, content: [{ type: 'text', text: 'Hola, soy yo' }] },
  ];
  const items = m.conversationItemsV2(msgs);
  assert.deepEqual(items.map(x => x.role), ['user', 'bot']);
  assert.equal(items[0].text, 'cuenta los archivos');
  assert.equal(items[1].data.lines[0], 'Hecho');
  assert.equal(items[1].at, 40);
  assert.deepEqual(m.conversationItemsV2(null), []);
});

test('2.x: una sesión es un elemento de /resume', () => {
  const msgs = [
    { id: 'm3', type: 'assistant', time: { created: 3, completed: 30 }, content: [{ type: 'text', text: 'Solo texto' }] },
    { id: 'm2', type: 'user', time: { created: 2 }, text: 'segunda pregunta' },
    { id: 'm1', type: 'user', time: { created: 1 }, text: 'primera pregunta' },
  ];
  const it = m.listItemV2({ id: 'ses_1', title: 'Astro', time: { created: 1, updated: 99 } }, msgs);
  assert.deepEqual([it.id, it.mtime, it.questions, it.engine, it.astro], ['ses_1', 99, 2, 'opencode', false]);
  assert.equal(it.title, 'primera pregunta', 'un título genérico se cambia por la primera pregunta');
  assert.equal(it.last, 'segunda pregunta');
  assert.equal(it.lastText, 'Solo texto');
});

test('2.x: modelos y comandos en el formato de Astro', () => {
  const list = m.modelsV2([
    { id: 'cat', modelID: 'cat', providerID: 'opencode', name: 'Cat', enabled: true, status: 'active', limit: { context: 262144 }, cost: [{ input: 0, output: 0 }] },
    { id: 'gpt', modelID: 'gpt', providerID: 'openai', name: 'GPT', enabled: true, status: 'active', limit: { context: 128000 }, cost: [{ input: 1, output: 2 }] },
    { id: 'off', modelID: 'off', providerID: 'openai', name: 'Off', enabled: false, status: 'active' },
    { id: 'old', modelID: 'old', providerID: 'openai', name: 'Old', enabled: true, status: 'deprecated' },
  ]);
  assert.deepEqual(list.map(x => x.id), ['opencode/cat', 'openai/gpt']);
  assert.deepEqual([list[0].free, list[1].free, list[0].context], [true, false, 262144]);
  assert.equal(m.splitModelV2('opencode/cat-jam').id, 'cat-jam');
  assert.deepEqual(m.splitModelV2('opencode/cat-jam'), { providerID: 'opencode', id: 'cat-jam' });
  assert.deepEqual(m.commandListV2([{ name: 'review', description: 'revisa' }, { name: 'init' }]).map(c => c.name), ['init', 'review']);
});
