const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startNotifyServer } = require('../src/notify-server');
const { writeRuntimeInfo, readRuntimeInfo, removeRuntimeInfo, runtimeFile } = require('../src/runtime-info');

const HOOK = path.join(__dirname, '..', 'hooks', 'astro-notify.js');
const TOKEN = 'secreto-de-prueba';

// Arranca el servidor en un puerto libre y devuelve { port, events, close }.
function serve(t, token = TOKEN) {
  return new Promise(resolve => {
    const events = [];
    const server = startNotifyServer(0, ev => events.push(ev), {
      token,
      onListening: port => resolve({ port, events }),
    });
    t.after(() => server.close());
  });
}

const post = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}/event`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-astro-token': TOKEN, ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-home-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { ASTRO_HOME: dir };
}

function runHook(env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK], { env: { ...process.env, ASTRO_INTERNAL: '', ...env } });
    child.on('error', reject);
    child.on('close', resolve);
    child.stdin.end(JSON.stringify(input));
  });
}

test('acepta avisos con el token y recorta los campos', async t => {
  const { port, events } = await serve(t);
  const res = await post(port, { event: 'Stop', project: 'p'.repeat(100), message: 'm'.repeat(500) });
  assert.equal(res.status, 204);
  assert.equal(events.length, 1);
  assert.equal(events[0].project.length, 60);
  assert.equal(events[0].message.length, 280);
});

test('rechaza peticiones sin token, con token incorrecto o que no son JSON', async t => {
  const { port, events } = await serve(t);
  assert.equal((await post(port, { event: 'Stop' }, { 'x-astro-token': '' })).status, 403);
  assert.equal((await post(port, { event: 'Stop' }, { 'x-astro-token': 'otro' })).status, 403);
  // Lo que podría enviar una página web sin preflight:
  assert.equal((await post(port, '{"event":"Stop"}', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post(port, 'no es json')).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}/otra`)).status, 404);
  assert.equal(events.length, 0);
});

test('runtime-info escribe, lee y solo borra el archivo de su propio proceso', t => {
  const env = tmpHome(t);
  writeRuntimeInfo({ port: 1, token: 'x', pid: 42 }, env);
  assert.deepEqual(readRuntimeInfo(env), { port: 1, token: 'x', pid: 42 });
  removeRuntimeInfo(7, env);
  assert.ok(fs.existsSync(runtimeFile(env)), 'no es de este proceso: no se borra');
  removeRuntimeInfo(42, env);
  assert.equal(readRuntimeInfo(env), null);
});

test('el hook avisa a Astro usando el puerto y el token publicados', async t => {
  const env = tmpHome(t);
  const { port, events } = await serve(t);
  writeRuntimeInfo({ port, token: TOKEN, pid: process.pid }, env);
  const code = await runHook(env, { hook_event_name: 'Stop', cwd: path.join('home', 'mi-proyecto'), last_assistant_message: 'Listo   todo\n bien' });
  assert.equal(code, 0);
  assert.deepEqual(events, [{ event: 'Stop', project: 'mi-proyecto', message: 'Listo todo bien' }]);
});

test('el hook toma el último texto del transcript si no viene el mensaje', async t => {
  const env = tmpHome(t);
  const { port, events } = await serve(t);
  writeRuntimeInfo({ port, token: TOKEN, pid: process.pid }, env);
  const transcript = path.join(env.ASTRO_HOME, 't.jsonl');
  fs.writeFileSync(transcript, [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'primero' }] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'último' }] } },
    { type: 'user', message: { content: 'gracias' } },
  ].map(x => JSON.stringify(x)).join('\n'));
  await runHook(env, { hook_event_name: 'Stop', transcript_path: transcript });
  assert.equal(events[0].message, 'último');
});

test('el hook no hace nada si Astro no está abierto o la llamada es del propio Astro', async t => {
  const env = tmpHome(t);
  assert.equal(await runHook(env, { hook_event_name: 'Stop' }), 0);
  const { port, events } = await serve(t);
  writeRuntimeInfo({ port, token: TOKEN, pid: process.pid }, env);
  assert.equal(await runHook({ ...env, ASTRO_INTERNAL: '1' }, { hook_event_name: 'Notification', message: 'hola' }), 0);
  assert.equal(events.length, 0);
});
