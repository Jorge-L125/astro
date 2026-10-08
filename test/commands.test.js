const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCommandList, createCommandStore, FALLBACK } = require('../src/commands');

const ANNOUNCED = {
  slashCommands: ['clear', 'context', 'model', 'ultrareview', 'loop', 'vim', '__remote-workflow', 'heapdump',
    'code-review', 'anthropic-skills:pdf', 'mi-skill', 'comando-raro'],
  skills: ['code-review', 'anthropic-skills:pdf', 'mi-skill', 'loop'],
  terminalCommands: ['vim'],
};

test('muestra los útiles, ordenados por tipo, y oculta los de pago, recurrentes o de terminal', () => {
  const list = buildCommandList(ANNOUNCED);
  assert.deepEqual(list.map(c => c.name), ['clear', 'context', 'model', 'anthropic-skills:pdf', 'code-review', 'mi-skill']);
  assert.deepEqual(list.map(c => c.kind), ['local', 'info', 'task', 'skill', 'skill', 'skill']);
});

test('describe en español los conocidos y marca los argumentos', () => {
  const list = buildCommandList(ANNOUNCED);
  const by = Object.fromEntries(list.map(c => [c.name, c]));
  assert.equal(by['code-review'].desc, 'Revisa los cambios buscando errores');
  assert.equal(by['mi-skill'].desc, 'Skill');
  assert.equal(by.model.arg, 'sonnet · opus · haiku');
});

test('un comando de serie desconocido no se muestra', () => {
  assert.ok(!buildCommandList(ANNOUNCED).some(c => c.name === 'comando-raro'));
});

test('el almacén arranca con los de serie y recuerda la última lista entre arranques', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-cmds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = createCommandStore(dir);
  assert.deepEqual(a.get(), FALLBACK);
  assert.ok(FALLBACK.some(c => c.name === 'compact'));
  assert.equal(a.update(ANNOUNCED), true);
  assert.equal(a.update(ANNOUNCED), false, 'sin cambios no se reescribe');
  assert.deepEqual(createCommandStore(dir).get().map(c => c.name), buildCommandList(ANNOUNCED).map(c => c.name));
});
