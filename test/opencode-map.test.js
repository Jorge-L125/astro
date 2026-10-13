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
