const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/router.js');
const base = { engine: 'claude', hasHistory: false, pinned: false, hasCapture: false, opencodeModel: 'opencode/big-pickle', opencodeReady: true };

test('una pregunta corta de explicar se sugiere para OpenCode', async () => {
  const { suggestRoute } = await load();
  for (const q of [
    '¿Qué hace la función calcularTotal?',
    'Explica qué significa idempotente',
    'Traduce esto al inglés: buenos días',
    'Resume en dos frases qué es un closure',
    'Cuál es la diferencia entre let y const',
    'Why is this slow?',
    'What does idempotent mean',
  ]) {
    const s = suggestRoute(q, base);
    assert.ok(s, q);
    assert.deepEqual([s.engine, s.model], ['opencode', 'opencode/big-pickle'], q);
    assert.ok(s.reason.length > 5);
  }
});

test('el trabajo pesado se sugiere para Claude Code cuando se está en OpenCode', async () => {
  const { suggestRoute } = await load();
  const oc = { ...base, engine: 'opencode' };
  for (const q of [
    'Refactoriza el módulo de pagos y actualiza las pruebas',
    'Crea un componente de login y añade sus tests',
    'Arregla el bug del archivo main.js',
    'Refactor the auth module and update the tests',
    'Diseña la arquitectura de notificaciones',
    'Cambia el nombre de la función en todos los archivos',
    'Dame un plan para migrar la base de datos',
  ]) {
    const s = suggestRoute(q, oc);
    assert.ok(s, q);
    assert.deepEqual([s.engine, s.model], ['claude', null], q);
  }
  assert.ok(suggestRoute('x'.repeat(700), oc), 'un texto muy largo es trabajo pesado');
  assert.ok(suggestRoute('mira esto:\n```js\nconst a = 1;\n```\n¿lo mejoras y lo meto en el proyecto?', oc), 'con un bloque de código');
});

test('si no está claro, o ya va por el motor adecuado, no sugiere nada', async () => {
  const { suggestRoute } = await load();
  assert.equal(suggestRoute('hola', base), null);
  assert.equal(suggestRoute('Crea una lista de ideas para el fin de semana', base), null, 'crear algo que no es código es dudoso');
  assert.equal(suggestRoute('Refactoriza el módulo de pagos', base), null, 'ya está en Claude Code');
  assert.equal(suggestRoute('¿Qué hace esta función?', { ...base, engine: 'opencode' }), null, 'ya está en OpenCode');
});

test('nunca sugiere en estos casos', async () => {
  const { suggestRoute } = await load();
  const q = '¿Qué hace la función calcularTotal?';
  assert.ok(suggestRoute(q, base), 'control');
  assert.equal(suggestRoute(q, { ...base, hasHistory: true }), null, 'conversación ya empezada');
  assert.equal(suggestRoute(q, { ...base, pinned: true }), null, 'el usuario eligió un modelo a mano');
  assert.equal(suggestRoute(q, { ...base, hasCapture: true }), null, 'con captura no se manda a OpenCode');
  assert.equal(suggestRoute(q, { ...base, opencodeReady: false }), null, 'OpenCode no disponible');
  assert.equal(suggestRoute(q, { ...base, opencodeModel: null }), null, 'sin modelo de OpenCode elegido');
  assert.equal(suggestRoute('/context', base), null, 'los comandos / dependen del motor');
  assert.equal(suggestRoute('   ', base), null);
  assert.equal(suggestRoute(null, base), null);
});

test('con una captura sí puede sugerir Claude Code para trabajo pesado', async () => {
  const { suggestRoute } = await load();
  const s = suggestRoute('Arregla el estilo del botón de esta captura en el archivo app.css', { ...base, engine: 'opencode', hasCapture: true });
  assert.equal(s.engine, 'claude');
});

test('classify distingue pesado, corto y dudoso', async () => {
  const { classify } = await load();
  assert.equal(classify('¿Cómo funciona el actualizador?'), 'light');
  assert.equal(classify('Implementa el endpoint de pagos en el proyecto'), 'heavy');
  assert.equal(classify('buenas'), 'unknown');
});
