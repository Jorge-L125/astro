const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/accessories.js');
const three = () => import('../node_modules/three/build/three.module.js');

// Lo mínimo de la gota que necesita el registro para construir los diseños.
async function fakeKit() {
  const THREE = await three();
  const bot = new THREE.Group(), accRoot = new THREE.Group(), hands = [new THREE.Group(), new THREE.Group()];
  return { THREE, bot, accRoot, hands, face: new THREE.Group(), scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    bodyMaterial: new THREE.MeshStandardMaterial(), eyeMaterial: new THREE.MeshStandardMaterial(), sway: [], agents: () => [],
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

test('el gato mueve las orejas y la cola de vez en cuando, y más si lo acarician', async () => {
  const { createAccessories } = await load();
  const accs = createAccessories(await fakeKit());
  const cat = accs.get('cat');
  const { ears, tail } = cat.parts;
  const restZ = ears.map(e => e.rotation.z);
  const st = (T, extra = {}) => ({ T, dt: 1 / 30, busy: false, awake: true, acting: false, hands: [], hw: 1, helpers: [],
    spring: { ax: 0, az: 0 }, look: {}, setLook() {}, petting: false, hover: false, ...extra });
  let twitches = 0, quiet = 0, swish = 0, calm = 0;
  for (let i = 0; i < 30 * 20; i++) {
    cat.update(st(i / 30));
    const moved = Math.max(...ears.map((e, k) => Math.abs(e.rotation.z - restZ[k])));
    if (moved > 0.15) twitches++; else quiet++;
    if (Math.abs(tail.rotation.y) > 0.4) swish++; else calm++;
  }
  assert.ok(twitches > 0 && quiet > twitches * 4, `orejas: ${twitches} fotogramas moviéndose, ${quiet} quietas`);
  assert.ok(swish > 0 && calm > swish * 2, `cola: ${swish} fotogramas meneándose, ${calm} tranquila`);
  cat.update(st(30, { petting: true }));
  assert.ok(ears.every(e => e.rotation.x < -0.2), 'con mimos, las orejas se echan hacia atrás');
});

test('con el gato, los ayudantes son ovillos de lana (y dejan de serlo al cambiar de diseño)', async () => {
  const THREE = await three();
  const { createAccessories } = await load();
  const kit = await fakeKit();
  const helper = { id: 1, mat: new THREE.MeshStandardMaterial({ color: 0x3a8bff }), m: new THREE.Mesh(new THREE.SphereGeometry(0.13)) };
  kit.agents = () => [helper];
  const cat = createAccessories(kit).get('cat');
  cat.update({ T: 1, dt: 0.016, busy: true, awake: true, acting: false, hands: [], hw: 1, helpers: [helper], spring: { ax: 0, az: 0 }, look: {}, setLook() {} });
  assert.ok(helper.yarn && helper.yarn.visible, 'lleva su ovillo');
  assert.equal(helper.yarn.parent, helper.m, 'pegado al ayudante');
  let sameColor = false;
  helper.yarn.traverse(o => { if (o.isMesh && o.material === helper.mat) sameColor = true; });
  assert.ok(sameColor, 'del color del ayudante');
  cat.hide();
  assert.equal(helper.yarn.visible, false);
});
