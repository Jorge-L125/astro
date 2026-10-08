const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { findScreenshotDir, isScreenshotName } = require('../src/screenshot-dir');

test('en Windows manda la carpeta del registro aunque Imágenes esté en OneDrive', async () => {
  const dir = await findScreenshotDir({
    platform: 'win32',
    home: 'C:\\Users\\u',
    pictures: 'C:\\Users\\u\\OneDrive\\Imágenes',
    query: async () => 'C:\\Users\\u\\Imágenes\\Screenshots',
    exists: () => true,
  });
  assert.equal(dir, 'C:\\Users\\u\\Imágenes\\Screenshots');
});

test('si el registro no responde, prueba las carpetas habituales que existan', async () => {
  const pictures = path.join('home', 'Fotos');
  const dir = await findScreenshotDir({
    platform: 'win32', home: 'home', pictures,
    query: async () => null,
    exists: d => d === path.join('home', 'Pictures', 'Screenshots'),
  });
  assert.equal(dir, path.join('home', 'Pictures', 'Screenshots'));
});

test('devuelve null si no hay ninguna carpeta (solo se usará el portapapeles)', async () => {
  assert.equal(await findScreenshotDir({ platform: 'linux', home: 'h', pictures: 'p', exists: () => false }), null);
});

test('lee de verdad el registro de Windows', { skip: process.platform !== 'win32' && 'solo en Windows' }, async () => {
  const { registryScreenshots } = require('../src/screenshot-dir');
  const dir = await registryScreenshots();
  assert.ok(dir === null || (path.isAbsolute(dir) && !dir.includes('%')), `valor: ${dir}`);
});

test('en macOS usa la carpeta elegida en Captura de pantalla o, si no, el Escritorio', async () => {
  const home = path.join('Users', 'ana');
  const custom = await findScreenshotDir({ platform: 'darwin', home, query: async () => path.join(home, 'Capturas'), exists: () => true });
  assert.equal(custom, path.join(home, 'Capturas'));
  const desktop = await findScreenshotDir({ platform: 'darwin', home, query: async () => null, exists: d => d === path.join(home, 'Desktop') });
  assert.equal(desktop, path.join(home, 'Desktop'));
});

test('en macOS solo cuentan los archivos con nombre de captura (el Escritorio tiene de todo)', () => {
  assert.equal(isScreenshotName('Captura de pantalla 2026-10-07 a las 19.02.50.png', 'darwin'), true);
  assert.equal(isScreenshotName('Screenshot 2026-10-07 at 19.02.50.png', 'darwin'), true);
  assert.equal(isScreenshotName('Bildschirmfoto 2026-10-07.png', 'darwin'), true);
  assert.equal(isScreenshotName('logo-final.png', 'darwin'), false);
  assert.equal(isScreenshotName('.Screenshot 2026-10-07.png', 'darwin'), false, 'temporal oculto mientras se escribe');
  assert.equal(isScreenshotName('logo-final.png', 'win32'), true, 'en Windows la carpeta solo tiene capturas');
});
