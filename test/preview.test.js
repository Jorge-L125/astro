const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/preview.js');

test('reconoce los diseños que se pueden dibujar', async () => {
  const { designKind } = await load();
  assert.equal(designKind({ lang: 'svg', content: '<svg/>' }), 'svg');
  assert.equal(designKind({ lang: 'xml', content: '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>' }), 'svg');
  assert.equal(designKind({ lang: '', content: '  <svg viewBox="0 0 10 10"></svg>' }), 'svg');
  assert.equal(designKind({ lang: 'html', content: '<div>Hola</div>' }), 'html');
  assert.equal(designKind({ lang: 'text', content: '<!DOCTYPE html><html></html>' }), 'html');
  assert.equal(designKind({ lang: 'json', content: '{"a":1}' }), null);
  assert.equal(designKind({ lang: 'jsx', content: '<div>Hola</div>' }), null, 'JSX no es HTML que se pueda dibujar tal cual');
  assert.equal(designKind(null), null);
});

test('el SVG va como dirección data: y el HTML con fondo blanco', async () => {
  const { svgSrc, htmlDoc } = await load();
  assert.equal(svgSrc('<svg a="1"/>'), 'data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E');
  assert.match(htmlDoc('<p>x</p>'), /^<meta charset="utf-8"><style>html\{background:#fff/);
  assert.match(htmlDoc('<html><head><title>t</title></head></html>'), /<head><meta charset="utf-8">/);
});

test('solo se ofrecen para ver imágenes y páginas', async () => {
  const { isViewableFile } = await load();
  for (const f of ['/p/logo.svg', 'C:/p/index.HTML', '/p/foto.jpeg', '/p/a.webp']) assert.equal(isViewableFile(f), true, f);
  for (const f of ['/p/notas.md', '/p/app.js', '/p/svg', undefined]) assert.equal(isViewableFile(f), false, String(f));
});
