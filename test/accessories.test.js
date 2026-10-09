const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/accessories.js');
const three = () => import('../node_modules/three/build/three.module.js');

// Lo mínimo de la gota que necesita el registro para construir los diseños.
async function fakeKit() {
  const THREE = await three();
  const bot = new THREE.Group(), accRoot = new THREE.Group(), hands = [new THREE.Group(), new THREE.Group()];
  return { THREE, bot, accRoot, hands, face: new THREE.Group(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    bodyMaterial: new THREE.MeshStandardMaterial(), sway: [], agents: () => [],
    onSurface: o => { bot.add(o); return o; }, felt: c => new THREE.MeshStandardMaterial({ color: c }) };
}

test('el registro tiene claves, nombres y emojis únicos y empieza por «Ninguno»', async () => {
  const { ACCESSORY_LIST, isAccessory } = await load();
  const { OUTFIT_KEYS } = await import('../renderer/outfits.js');
  assert.equal(ACCESSORY_LIST[0].key, 'none');
  assert.deepEqual(ACCESSORY_LIST.map(a => a.key), OUTFIT_KEYS, 'los 16 diseños, en el orden de los botones');
  for (const f of ['key', 'label', 'emoji']) assert.equal(new Set(ACCESSORY_LIST.map(a => a[f])).size, ACCESSORY_LIST.length, f);
  for (const a of ACCESSORY_LIST) assert.ok(OUTFIT_KEYS.includes(a.key), a.key);
  assert.equal(isAccessory('santa'), true);
  assert.equal(isAccessory('dragon'), false);
});

test('construye perezosamente, cachea y sobrevive a un diseño roto', async () => {
  const { createAccessories } = await load();
  const kit = await fakeKit();
  const accs = createAccessories(kit);
  assert.equal(kit.accRoot.children.length, 0, 'nada construido al crear el registro');
  const a = accs.get('santa');
  assert.ok(a.group.isObject3D);
  assert.equal(a.group.visible, false);
  assert.equal(accs.get('santa'), a, 'cacheado');
  assert.equal(kit.accRoot.children.length, 1);
  assert.equal(accs.get('none'), null);
  assert.equal(accs.get('dragon'), null);
  const orig = console.error; console.error = () => {};
  const broken = createAccessories(kit, [{ key: '__broken', label: 'x', emoji: 'x', build() { throw new Error('x'); } }]);
  try { assert.equal(broken.get('__broken'), null); } finally { console.error = orig; }
});

test('cada diseño se construye en Node y deja sus piezas ocultas', async () => {
  const { createAccessories, ACCESSORY_LIST } = await load();
  const kit = await fakeKit();
  const accs = createAccessories(kit);
  // la fiesta usa un <canvas> para su textura, que no existe en Node
  for (const { key } of ACCESSORY_LIST.filter(a => a.key !== 'none' && a.key !== 'party')) {
    const b = accs.get(key);
    assert.ok(b && b.group.isObject3D, key);
    for (const o of [b.group, ...b.props, ...b.face, ...b.extras]) assert.equal(o.visible, false, key);
    if (b.update) b.update({ T: 1, dt: 0.016, busy: true, awake: true, acting: false, hands: kit.hands, hw: 1, helpers: [], spring: { ax: 0, az: 0 }, look: {}, setLook() {} });
  }
});
