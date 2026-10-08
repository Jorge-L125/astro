const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCaptureStore, toImageBlock, fingerprint, MAX_EDGE } = require('../src/captures');

const delay = ms => new Promise(r => setTimeout(r, ms));

// NativeImage de mentira: los píxeles salen de la etiqueta; `alpha` cambia solo el canal alfa.
function fakeImage(label, width = 1920, height = 1080, { pngBytes = 1000, alpha = 255 } = {}) {
  const img = {
    label,
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }) => fakeImage(label, w, h ?? Math.round(w * height / width), { pngBytes, alpha }),
    toBitmap: () => {
      const b = Buffer.alloc(width * height * 4);
      for (let i = 0; i < b.length; i += 4) {
        const c = label.charCodeAt((i / 4) % label.length);
        b[i] = c * 7; b[i + 1] = c * 13; b[i + 2] = c * 3; b[i + 3] = alpha;
      }
      return b;
    },
    toPNG: () => Buffer.alloc(pngBytes, 1),
    toJPEG: q => Buffer.from(`jpeg${q}`),
    toDataURL: () => `data:image/png;base64,${label}-${width}`,
  };
  return img;
}

function setup(opts = {}) {
  let clip = null, reads = 0, clock = 0;
  const seen = [];
  const store = createCaptureStore({
    hasClipboardImage: async () => !!clip,
    readClipboardImage: async () => { reads++; return clip; },
    loadImage: () => null,
    onCapture: c => seen.push(c),
    intervalMs: 60 * 60 * 1000, // las pruebas llaman a pollClipboard() a mano
    now: () => clock,
    ...opts,
  });
  return {
    store, seen,
    copy: img => { clip = img; },
    clear: () => { clip = null; },
    reads: () => reads,
    advance: ms => { clock += ms; },
  };
}

test('lo que ya estaba en el portapapeles al arrancar no cuenta', async t => {
  const h = setup();
  t.after(() => h.store.stop());
  h.copy(fakeImage('vieja'));
  await h.store.start();
  h.advance(60000);
  await h.store.pollClipboard();
  assert.equal(h.seen.length, 0);
});

test('avisa una vez por imagen nueva, con miniatura y tamaño', async t => {
  const h = setup();
  t.after(() => h.store.stop());
  await h.store.start();
  h.copy(fakeImage('a'));
  await h.store.pollClipboard();
  await h.store.pollClipboard();
  assert.equal(h.seen.length, 1);
  assert.deepEqual([h.seen[0].width, h.seen[0].height, h.seen[0].thumb], [1920, 1080, 'data:image/png;base64,a-360']);
  h.clear();
  await h.store.pollClipboard();
  h.advance(5000);
  h.copy(fakeImage('b'));
  await h.store.pollClipboard();
  assert.equal(h.seen.length, 2);
  assert.notEqual(h.seen[0].id, h.seen[1].id);
});

test('una imagen que se queda en el portapapeles se lee cada vez menos', async t => {
  const h = setup();
  t.after(() => h.store.stop());
  await h.store.start();
  h.copy(fakeImage('a'));
  await h.store.pollClipboard();
  const after = h.reads();
  // 60 s de sondeo a 1 s: con lecturas espaciadas (2, 4, 8, 16 s…) son muchas menos de 60.
  for (let i = 0; i < 60; i++) { h.advance(1000); await h.store.pollClipboard(); }
  const extra = h.reads() - after;
  assert.ok(extra >= 3 && extra <= 8, `lecturas completas: ${extra}`);
});

test('detecta una captura nueva aunque ya hubiera otra imagen en el portapapeles', async t => {
  const h = setup();
  t.after(() => h.store.stop());
  await h.store.start();
  h.copy(fakeImage('a'));
  await h.store.pollClipboard();
  h.advance(5000);
  h.copy(fakeImage('b'));
  for (let i = 0; i < 3 && h.seen.length < 2; i++) { h.advance(1000); await h.store.pollClipboard(); }
  assert.equal(h.seen.length, 2);
});

test('la huella ignora el canal alfa y la misma captura no se ofrece dos veces', async t => {
  assert.equal(fingerprint(fakeImage('z', 800, 600, { alpha: 0 })), fingerprint(fakeImage('z', 800, 600)));
  const h = setup();
  t.after(() => h.store.stop());
  await h.store.start();
  h.copy(fakeImage('z', 800, 600, { alpha: 0 }));
  await h.store.pollClipboard();
  h.advance(10000);
  h.clear(); await h.store.pollClipboard();
  h.copy(fakeImage('z', 800, 600));
  await h.store.pollClipboard();
  assert.equal(h.seen.length, 1);
});

test('solo acepta los archivos que el filtro de nombres reconoce', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-shots-'));
  const h = setup({ loadImage: file => fakeImage(path.basename(file)), now: Date.now, acceptName: n => n.startsWith('Captura') });
  t.after(() => { h.store.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await h.store.start();
  h.store.setFolder(dir);
  fs.writeFileSync(path.join(dir, 'logo.png'), 'png');
  fs.writeFileSync(path.join(dir, 'Captura 1.png'), 'png');
  await delay(900);
  assert.deepEqual(h.seen.map(s => s.thumb), ['data:image/png;base64,Captura 1.png-360']);
});

test('vigila la carpeta de capturas y deduplica con el portapapeles', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-shots-'));
  const h = setup({ loadImage: file => fakeImage(path.basename(file)), now: Date.now });
  t.after(() => { h.store.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await h.store.start();
  h.store.setFolder(dir);
  fs.writeFileSync(path.join(dir, 'notas.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'Screenshot 1.png'), 'png');
  await delay(900);
  assert.equal(h.seen.length, 1, 'el .png sí, el .txt no');
  // La misma captura copiada al portapapeles un instante después:
  h.copy(fakeImage('Screenshot 1.png'));
  await h.store.pollClipboard();
  assert.equal(h.seen.length, 1);
});

test('take() entrega la imagen una vez; discard() la borra', async t => {
  const h = setup();
  t.after(() => h.store.stop());
  await h.store.start();
  h.copy(fakeImage('a')); await h.store.pollClipboard();
  h.advance(5000);
  h.clear(); await h.store.pollClipboard();
  h.copy(fakeImage('b')); await h.store.pollClipboard();
  const [a, b] = h.seen;
  const block = h.store.take(a.id);
  assert.equal(block.type, 'image');
  assert.equal(block.source.media_type, 'image/png');
  assert.equal(h.store.take(a.id), null, 'no se puede usar dos veces');
  h.store.discard(b.id);
  assert.equal(h.store.take(b.id), null);
  assert.equal(h.store.size, 0);
});

test('las capturas caducan y solo se guardan las últimas', async t => {
  const h = setup({ ttlMs: 60000, max: 2 });
  t.after(() => h.store.stop());
  await h.store.start();
  for (const l of ['a', 'b', 'c']) {
    h.advance(5000); h.clear(); await h.store.pollClipboard();
    h.copy(fakeImage(l)); await h.store.pollClipboard();
  }
  assert.equal(h.seen.length, 3);
  assert.equal(h.store.size, 2);
  assert.equal(h.store.take(h.seen[0].id), null, 'la más antigua se descartó');
  h.advance(120000);
  assert.equal(h.store.take(h.seen[2].id), null, 'caducada');
});

test('stop() descarta todo lo guardado', async () => {
  const h = setup();
  await h.store.start();
  h.copy(fakeImage('a')); await h.store.pollClipboard();
  h.store.stop();
  assert.equal(h.store.running, false);
  assert.equal(h.store.take(h.seen[0].id), null);
});

test('toImageBlock reduce las capturas grandes y usa JPEG si el PNG pesa demasiado', () => {
  let resized = null;
  const big = fakeImage('x', 3840, 2160);
  const orig = big.resize;
  big.resize = o => { resized = o; return orig(o); };
  toImageBlock(big);
  assert.equal(resized.width, MAX_EDGE);
  assert.equal(resized.height, Math.round(2160 * MAX_EDGE / 3840));

  const heavy = toImageBlock(fakeImage('y', 800, 600, { pngBytes: 4 * 1024 * 1024 }));
  assert.equal(heavy.source.media_type, 'image/jpeg');
  assert.equal(Buffer.from(heavy.source.data, 'base64').toString(), 'jpeg85');
});
