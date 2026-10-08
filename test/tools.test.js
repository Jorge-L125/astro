const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/tools.js');

test('cuenta en palabras qué quiso hacer Claude', async () => {
  const { describeRequest } = await load();
  const edit = describeRequest('Edit', { file_path: 'C:\\proyecto\\src\\main.js' });
  assert.equal(edit.label, 'Editar archivos');
  assert.equal(edit.detail, 'main.js');
  assert.ok(edit.risk);
  const bash = describeRequest('Bash', { command: 'pnpm test\nmás líneas' });
  assert.equal(bash.detail, 'pnpm test');
  assert.equal(describeRequest('WebFetch', { url: 'https://example.com/a?b' }).detail, 'example.com');
  assert.equal(describeRequest('Read', { file_path: '/x/y.txt' }).risk, null, 'leer no cambia nada');
  assert.equal(describeRequest('mcp__github__create_issue').label, 'Usar create_issue de github');
  assert.equal(describeRequest('Raro').label, 'Usar Raro');
});

test('agrupa las peticiones por herramienta y cuenta las repetidas', async () => {
  const { groupDenials } = await load();
  const g = groupDenials([
    { tool: 'Edit', input: { file_path: 'a.js' } },
    { tool: 'Edit', input: { file_path: 'b.js' } },
    { tool: 'Bash', input: { command: 'ls' } },
    'Write',
    null,
  ]);
  assert.deepEqual(g.map(x => [x.tool, x.count, x.detail]), [['Edit', 2, 'a.js'], ['Bash', 1, 'ls'], ['Write', 1, '']]);
});
