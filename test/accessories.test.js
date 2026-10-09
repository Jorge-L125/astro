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

test('cada diseño tiene reacción al ponérselo, gestos opcionales y frase de fin', async () => {
  const { createAccessories, ACCESSORY_LIST } = await load();
  const accs = createAccessories(await fakeKit());
  for (const { key } of ACCESSORY_LIST) {
    const d = accs.def(key);
    assert.equal(typeof d.react.on, 'function', key);
    assert.ok(d.react.idle === null || typeof d.react.idle === 'function', key);
    assert.ok(d.react.done === null || typeof d.react.done === 'function', key);
    assert.equal(typeof d.doneLine(1), 'string', key);
    assert.equal(typeof d.doneLine(3), 'string', key);
  }
  assert.equal(accs.def('chef').doneLine(2), '¡Listo para servir! 2 tareas al punto.');
  assert.equal(accs.def('none').doneLine(1), '¡Listo! 1 tarea terminada.');
  assert.equal(accs.def('viking').doneLine(3), '¡Victoria! 3 tareas conquistadas.');
});

test('las reacciones usan lo que les pasa la gota', async () => {
  const THREE = await three();
  const { createAccessories, ACCESSORY_LIST } = await load();
  const accs = createAccessories(await fakeKit());
  for (const { key } of ACCESSORY_LIST.filter(a => a.key !== 'party')) {
    const calls = [];
    const m = { play: x => calls.push(x), setExpr: () => {}, say: () => {}, pick: a => a[0], T: 1,
      fx: { burst: () => 0 }, at: new THREE.Vector3(), built: accs.get(key) };
    const d = accs.def(key);
    for (const r of ['on', 'idle', 'done']) if (d.react[r]) d.react[r](m);
    if (d.react.on && key !== 'magic') assert.ok(calls.length, key + ' hace algún gesto al ponérselo');
  }
});

test('la copia para las gotas de atrás sale limpia aunque el diseño esté a mitad de un gesto', async () => {
  const { createAccessories } = await load();
  const accs = createAccessories(await fakeKit());
  const st = T => ({ T, dt: 0.016, busy: false, awake: true, acting: false, hands: [], hw: 1, helpers: [], spring: { ax: 0, az: 0 }, look: {}, setLook() {} });
  const vamp = accs.get('vampire');
  vamp.flap(0); vamp.update(st(0.4));
  assert.ok(vamp.group.scale.x > 1.05, 'la capa está abierta');
  assert.equal(accs.miniCopy('vampire').scale.x, 1, 'la copia, cerrada');
  const magic = accs.get('magic');
  magic.popOut(0); magic.update(st(0.9));
  assert.ok(magic.parts.pop.visible, 'la mini-gota del mago asoma');
  let popVisible = false;
  accs.miniCopy('magic').traverse(o => { if (o.isMesh && o.geometry === magic.parts.pop.geometry && o.visible) popVisible = true; });
  assert.equal(popVisible, false, 'la copia no la lleva');
  assert.equal(accs.miniCopy('none'), null);
});
