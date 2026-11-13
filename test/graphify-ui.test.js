const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/graphify-ui.js');
const bin = { found: true, version: '0.9.105', tested: true };
const NOW = 10 * 60 * 60 * 1000;

test('una línea de estado por cada situación', async () => {
  const { statusLine } = await load();
  const line = (status, extra = {}, b = bin) => statusLine({ state: { status, ...extra }, bin: b }, NOW);
  assert.equal(line('off'), 'Apagado');
  assert.equal(line('missing', {}, { found: false, version: null, tested: true }), 'graphify no está instalado');
  assert.equal(line('unmappable'), 'Esta carpeta no se mapea (es la de usuario o una raíz)');
  assert.equal(line('unasked'), 'Pendiente de tu permiso para esta carpeta');
  assert.equal(line('declined'), 'No se mapea esta carpeta');
  assert.equal(line('idle'), 'Sin mapa todavía');
  assert.equal(line('building'), 'Construyendo el mapa…');
  assert.equal(line('failed', { error: 'tiempo agotado' }), 'Falló: tiempo agotado');
});

test('con el mapa listo dice cuántas piezas, cuánto hace y el ahorro como estimación', async () => {
  const { statusLine } = await load();
  const at = NOW - 3 * 60000;
  const sin = statusLine({ state: { status: 'ready', nodes: 898, at }, bin }, NOW);
  assert.equal(sin, '898 piezas · actualizado hace 3 min');
  const con = statusLine({ state: { status: 'ready', nodes: 898, at, reduction: 36.9 }, bin }, NOW);
  assert.ok(con.startsWith('898 piezas · actualizado hace 3 min · ≈37× menos tokens por consulta que leer todo el código'), con);
  assert.match(con, /estimación/);
  assert.match(con, /ahorro real es menor/, 'se dice que es una cota máxima');
  assert.equal(statusLine({ state: { status: 'ready', nodes: 5, at: NOW }, bin }, NOW), '5 piezas · actualizado ahora');
  assert.equal(statusLine({ state: { status: 'ready', nodes: 5, at: NOW - 2 * 3600000 }, bin }, NOW), '5 piezas · actualizado hace 2 h');
});

test('un fallo con un mapa anterior bueno lo cuenta sin esconder el mapa', async () => {
  const { statusLine } = await load();
  const s = statusLine({ state: { status: 'ready', nodes: 10, at: NOW - 60000, error: 'boom' }, bin }, NOW);
  assert.ok(s.startsWith('10 piezas · actualizado hace 1 min'));
  assert.match(s, /el último intento falló: boom/);
});

test('actualizando un mapa que ya existía dice «Actualizando»', async () => {
  const { statusLine } = await load();
  assert.equal(statusLine({ state: { status: 'building', nodes: 10, at: NOW - 60000 }, bin }, NOW), 'Actualizando el mapa…');
});

test('una versión de graphify no probada se avisa, y una sin versión conocida no', async () => {
  const { statusLine } = await load();
  const warn = statusLine({ state: { status: 'idle' }, bin: { found: true, version: '0.10.2', tested: false } }, NOW);
  assert.equal(warn, 'Sin mapa todavía · Astro está probado con graphify 0.9: esta versión puede fallar');
  assert.equal(statusLine({ state: { status: 'idle' }, bin: { found: true, version: null, tested: true } }, NOW), 'Sin mapa todavía');
});

test('el texto del permiso nombra la carpeta', async () => {
  const { consentText } = await load();
  assert.equal(consentText('mi-proyecto'), '¿Hago el mapa de «mi-proyecto»? Tarda unos segundos y se queda en tu equipo.');
});
