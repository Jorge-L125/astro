const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/slash.js');
const LIST = [
  { name: 'clear', kind: 'local', desc: '' },
  { name: 'compact', kind: 'task', desc: '' },
  { name: 'context', kind: 'info', desc: '' },
  { name: 'code-review', kind: 'skill', desc: '' },
  { name: 'anthropic-skills:pdf', kind: 'skill', desc: '' },
];

test('parseSlash reconoce el comando y sus argumentos', async () => {
  const { parseSlash } = await load();
  assert.deepEqual(parseSlash('/model haiku'), { name: 'model', args: 'haiku' });
  assert.deepEqual(parseSlash('  /context '), { name: 'context', args: '' });
  assert.deepEqual(parseSlash('/anthropic-skills:pdf resume esto'), { name: 'anthropic-skills:pdf', args: 'resume esto' });
  assert.equal(parseSlash('¿qué es /etc/hosts?'), null);
  assert.equal(parseSlash('/'), null);
});

test('suggest filtra por el principio, por lo que va tras los dos puntos y por contenido', async () => {
  const { suggest } = await load();
  assert.deepEqual(suggest(LIST, '/co').map(c => c.name), ['compact', 'context', 'code-review']);
  assert.deepEqual(suggest(LIST, '/pdf').map(c => c.name), ['anthropic-skills:pdf']);
  assert.deepEqual(suggest(LIST, '/view').map(c => c.name), ['code-review']);
  assert.equal(suggest(LIST, '/').length, LIST.length);
  assert.deepEqual(suggest(LIST, '/compact ahora'), [], 'tras el espacio ya no sugiere');
  assert.deepEqual(suggest(LIST, 'hola'), []);
});

test('suggest también busca en la descripción, desde 3 letras', async () => {
  const { suggest } = await load();
  const list = [{ name: 'tech-doc', desc: 'Genera la documentación técnica' }, { name: 'clear', desc: 'Empieza de cero' }];
  assert.deepEqual(suggest(list, '/docum').map(c => c.name), ['tech-doc']);
  assert.deepEqual(suggest(list, '/ce').map(c => c.name), [], 'con 2 letras no mira la descripción');
});

test('commandReply convierte la salida en nube y hojas', async () => {
  const { commandReply } = await load();
  const usage = commandReply('context', '## Context Usage\n**Model:** haiku\n| Category | Tokens |\n|---|---|\n| System | 3k |');
  assert.deepEqual(usage.lines, ['Context Usage']);
  assert.match(usage.detail, /Category/);
  assert.deepEqual(commandReply('compact', '').lines, ['Compacté la conversación: ahora ocupa menos contexto.']);
  assert.equal(commandReply('compact', '').detail, null);
  assert.deepEqual(commandReply('raro', '').lines, ['Listo: /raro.']);
});

test('plainReply pone la primera línea en la nube y el texto completo en hojas', async () => {
  const { plainReply } = await load();
  const r = plainReply('## Uso\nTe queda un 40 % del plan.');
  assert.deepEqual(r.lines, ['Uso']);
  assert.match(r.detail, /40 %/);
  assert.equal(plainReply('Hola').detail, null);
});
