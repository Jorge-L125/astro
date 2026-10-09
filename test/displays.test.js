const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeDisplays, pinnedDisplay } = require('../src/displays');

// Como en la captura del usuario: la principal a la derecha y otra a su izquierda.
const DISPLAYS = [
  { id: 101, label: 'DELL U2419H', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
  { id: 202, label: '', bounds: { x: -1536, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 },
];

test('numera las pantallas de izquierda a derecha, con nombre y resolución real', () => {
  assert.deepEqual(describeDisplays(DISPLAYS, 101), [
    { id: '202', n: 1, name: 'Pantalla 1', size: '1920×1080', primary: false },
    { id: '101', n: 2, name: 'DELL U2419H', size: '1920×1080', primary: true },
  ]);
});

test('en modo automático no hay pantalla fija', () => {
  assert.equal(pinnedDisplay(DISPLAYS, 'auto'), null);
  assert.equal(pinnedDisplay(DISPLAYS, undefined), null);
});

test('con una pantalla elegida, Astro va a esa; si se desconecta, vuelve a seguir al cursor', () => {
  assert.equal(pinnedDisplay(DISPLAYS, '202').id, 202);
  assert.equal(pinnedDisplay(DISPLAYS.slice(0, 1), '202'), null);
});
