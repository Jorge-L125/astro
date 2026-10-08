const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createClaudeSession, createPool, describeTool, buildArgs, lineSplitter } = require('../src/claude');

const launcher = { command: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-claude.js')], env: {} };
const session = (opts = {}) => createClaudeSession({ launcher, cwd: __dirname, ...opts });
const delay = ms => new Promise(r => setTimeout(r, ms));

test('mantiene el mismo proceso entre turnos', async t => {
  const s = session();
  t.after(() => s.close());
  const a = await s.send('hola').done;
  const b = await s.send('otra').done;
  assert.equal(a.structured.echo, 'hola');
  assert.equal(b.structured.echo, 'otra');
  assert.equal(a.structured.pid, b.structured.pid, 'el segundo turno no debe relanzar el CLI');
  assert.equal(b.structured.turn, 2);
  assert.equal(b.sessionId, a.sessionId);
  assert.deepEqual(a.denials, ['Bash']);
});

test('envía bloques de contenido (imagen + texto) tal cual', async t => {
  const s = session();
  t.after(() => s.close());
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'text', text: '¿qué ves?' },
  ];
  const r = await s.send(content).done;
  assert.deepEqual(r.structured.echo, content);
});

test('emite progreso: inicio, herramientas y texto', async t => {
  const s = session();
  t.after(() => s.close());
  const events = [];
  await s.send('hola', ev => events.push(ev)).done;
  assert.equal(events[0].type, 'start');
  assert.deepEqual(events.find(e => e.type === 'tool'), { type: 'tool', name: 'Read', label: 'Leyendo main.js' });
  assert.deepEqual(events.find(e => e.type === 'text'), { type: 'text', text: 'mirando' });
});

test('no rompe caracteres multibyte partidos entre trozos de salida', async t => {
  const s = session();
  t.after(() => s.close());
  const r = await s.send('split').done;
  assert.equal(r.structured.echo, 'adiós ñandú');
});

test('cancelar corta el turno y el siguiente reanuda la conversación con --resume', async t => {
  const s = session();
  t.after(() => s.close());
  const first = await s.send('hola').done;
  const h = s.send('slow');
  await delay(100);
  h.cancel();
  await assert.rejects(h.done, { code: 'cancelled' });
  assert.equal(s.busy, false);
  const next = await s.send('sigue').done;
  assert.notEqual(next.structured.pid, first.structured.pid, 'debe ser un proceso nuevo');
  assert.equal(next.structured.resume, first.sessionId);
  assert.equal(next.structured.turn, 1);
});

test('rechaza un segundo turno mientras hay uno en curso', async t => {
  const s = session();
  t.after(() => s.close());
  const h = s.send('slow');
  await assert.rejects(s.send('otra').done, { code: 'busy' });
  h.cancel();
  await assert.rejects(h.done, { code: 'cancelled' });
});

test('informa del stderr si el CLI se cae y se recupera en el siguiente turno', async t => {
  const s = session();
  t.after(() => s.close());
  await assert.rejects(s.send('crash').done, err => err.code === 'failed' && /boom/.test(err.message));
  assert.equal(s.alive, false);
  const r = await s.send('hola').done;
  assert.equal(r.structured.echo, 'hola');
});

test('un resultado con is_error se rechaza con su mensaje', async t => {
  const s = session();
  t.after(() => s.close());
  await assert.rejects(s.send('error').done, { code: 'failed', message: 'algo salió mal' });
});

test('si la conversación guardada no existe, el siguiente intento empieza de cero', async t => {
  const s = session({ resume: 'missing' });
  t.after(() => s.close());
  await assert.rejects(s.send('hola').done, { code: 'failed' });
  assert.equal(s.sessionId, null);
  const r = await s.send('hola').done;
  assert.equal(r.structured.resume, null);
});

test('un ejecutable inexistente da not_found', async () => {
  const s = createClaudeSession({ launcher: { command: 'no-existe-claude-xyz', args: [], env: {} }, cwd: __dirname });
  await assert.rejects(s.send('hola').done, { code: 'not_found' });
  s.close();
});

test('cierra el proceso tras el tiempo de inactividad y luego lo reanuda', async t => {
  const s = session({ idleMs: 80 });
  t.after(() => s.close());
  const a = await s.send('hola').done;
  assert.equal(s.alive, true);
  await delay(250);
  assert.equal(s.alive, false);
  const b = await s.send('otra').done;
  assert.equal(b.structured.resume, a.sessionId);
});

test('close() rechaza el turno en curso y los envíos posteriores', async () => {
  const s = session();
  const h = s.send('slow');
  s.close();
  await assert.rejects(h.done, { code: 'cancelled' });
  await assert.rejects(s.send('hola').done, { code: 'cancelled' });
});

test('warm() arranca el proceso antes del primer turno', async t => {
  const s = session().warm();
  t.after(() => s.close());
  const pid = s.pid;
  assert.ok(pid);
  const r = await s.send('hola').done;
  assert.equal(r.structured.pid, pid);
});

test('el pool entrega procesos ya arrancados', async t => {
  const created = [];
  const pool = createPool(() => { const s = session(); created.push(s); return s; });
  t.after(() => { pool.closeAll(); created.forEach(s => s.close()); });
  pool.fill(2);
  assert.equal(pool.size, 2);
  const s = pool.take();
  assert.equal(pool.size, 1);
  assert.equal(s.alive, true);
  assert.equal((await s.send('hola').done).structured.echo, 'hola');
  pool.take();
  pool.take(); // vacío: crea uno nuevo
  assert.equal(created.length, 3);
});

test('buildArgs arma la línea de comandos esperada', () => {
  const args = buildArgs({ model: 'haiku', schema: { a: 1 }, resume: 'abc', allowedTools: ['Read', 'Grep'], permissionMode: 'default', systemPrompt: 'hola' });
  assert.deepEqual(args.slice(0, 6), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose']);
  assert.ok(args.includes('--resume') && args.includes('abc'));
  assert.equal(args[args.indexOf('--json-schema') + 1], '{"a":1}');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Grep');
  assert.ok(!args.includes('--permission-mode'), 'el modo por defecto no se pasa');
  assert.ok(buildArgs({ permissionMode: 'plan' }).includes('plan'));
});

test('lineSplitter junta líneas partidas', () => {
  const lines = [];
  const sp = lineSplitter(l => lines.push(l));
  sp.push('{"a":'); sp.push('1}\n{"b"'); sp.push(':2}\nfin');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  sp.flush();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', 'fin']);
});

test('describeTool resume cada herramienta', () => {
  assert.equal(describeTool('Read', { file_path: path.join('x', 'y.txt') }), 'Leyendo y.txt');
  assert.equal(describeTool('Bash', { command: 'pnpm test --watch' }), 'Ejecutando pnpm');
  assert.equal(describeTool('Grep', { pattern: 'x'.repeat(50) }), `Buscando "${'x'.repeat(30)}"`);
  assert.equal(describeTool('Raro'), 'Usando Raro');
});
