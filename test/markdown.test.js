const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/markdown.js');

test('escapa HTML antes de dar formato', async () => {
  const { md, inline } = await load();
  assert.equal(inline('<img src=x onerror=alert(1)> **ok**'), '&lt;img src=x onerror=alert(1)&gt; <strong>ok</strong>');
  assert.equal(md('`<b>`'), '<p><code>&lt;b&gt;</code></p>');
  assert.equal(md('```html\n<script>x</script>\n```'), '<pre><code>&lt;script&gt;x&lt;/script&gt;</code></pre>');
});

test('convierte listas, títulos y párrafos', async () => {
  const { md } = await load();
  assert.equal(md('- uno\n- **dos**'), '<ul><li>uno</li><li><strong>dos</strong></li></ul>');
  assert.equal(md('1. a\n2) b'), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(md('## Título'), '<h4>Título</h4>');
  assert.equal(md('línea 1\nlínea 2\n\notro'), '<p>línea 1<br>línea 2</p><p>otro</p>');
  assert.equal(md(null), '');
});

test('buildSheets reparte el detalle sin partir párrafos y pone el código aparte', async () => {
  const { buildSheets } = await load();
  const big = 'x'.repeat(400), small = 'y'.repeat(200);
  const sheets = buildSheets({ detail: [big, big, small].join('\n\n'), code: { lang: 'js', content: 'let a' } });
  assert.deepEqual(sheets.map(s => s.kind), ['text', 'text', 'code']);
  assert.equal(sheets[0].text, big);
  assert.equal(sheets[1].text, `${big}\n\n${small}`);
  assert.deepEqual(sheets[2].code, { lang: 'js', content: 'let a' });
  assert.deepEqual(buildSheets({ detail: null, code: null }), []);
  assert.equal(buildSheets({ detail: 'corto\n\notro' }).length, 1);
});
