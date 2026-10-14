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
// Lo que la gota pasa a un diseño cada fotograma.
const frame = (over = {}) => ({ T: 1, dt: 0.05, busy: false, awake: true, acting: false, hover: false, petting: false, idleFor: 10, hands: [], hw: 1, helpers: [], finished: [],
  spring: { ax: 0, az: 0 }, look: {}, setLook() {}, say() {}, play() {}, setExpr() {}, ...over });
const newPose = () => ({ rx: 0, ry: 0, rz: 0, x: 0, y: 0, sy: 1, sxw: 1, hl: 0, hr: 0, hlx: 0, hrx: 0 });

test('con el robot, los ayudantes son tuercas y tornillos (y vuelven a ser gotas al cambiar de diseño)', async () => {
  const THREE = await three();
  const { createAccessories } = await load();
  const kit = await fakeKit();
  const ball = new THREE.SphereGeometry(0.13);
  const mk = id => ({ id, mat: new THREE.MeshPhysicalMaterial({ color: 0x3a8bff, roughness: 0.25, metalness: 0 }), m: new THREE.Mesh(ball), base: new THREE.Color(0x3a8bff) });
  const a = mk(1), b = mk(2);
  kit.agents = () => [a, b];
  const robot = createAccessories(kit).get('robot');
  robot.update(frame({ busy: true, helpers: [a, b] }));
  assert.notEqual(a.m.geometry, ball);
  assert.notEqual(b.m.geometry, ball);
  assert.notEqual(a.m.geometry, b.m.geometry, 'unos son tuercas y otros tornillos');
  assert.ok(a.mat.metalness > 0.5, 'de metal');
  const r0 = a.m.rotation.y;
  robot.update(frame({ T: 1.05, busy: true, helpers: [a, b] }));
  assert.notEqual(a.m.rotation.y, r0, 'gira');
  robot.hide();
  assert.equal(a.m.geometry, ball);
  assert.equal(a.mat.metalness, 0);
  assert.equal(a.mat.roughness, 0.25);
  assert.equal(a.mat.color.getHex(), 0x3a8bff);
});

test('al darle varios clics seguidos, el robot suelta equis de error', async () => {
  const THREE = await three();
  const { createAccessories } = await load();
  const accs = createAccessories(await fakeKit());
  const d = accs.def('robot');
  assert.equal(typeof d.poke, 'function');
  const bursts = [], said = [];
  const m = { play() {}, setExpr() {}, say: t => said.push(t), pick: a => a[0], T: 1, fx: { burst: (k, at, n) => { bursts.push([k, n]); return n; } }, at: new THREE.Vector3(), built: accs.get('robot') };
  d.poke(m, 1); d.poke(m, 2);
  assert.equal(bursts.length, 0, 'uno o dos clics no son un golpe');
  d.poke(m, 3);
  assert.equal(bursts.length, 1);
  assert.equal(bursts[0][0], 'cross');
  assert.ok(bursts[0][1] >= 3);
  d.poke(m, 5);
  assert.ok(bursts[1][1] > bursts[0][1], 'cuantos más clics, más equis');
  assert.ok(said.length >= 1 && /ERROR/.test(said[0]));
  assert.equal(accs.def('santa').poke, undefined, 'los demás diseños no cambian');
});

test('con el pollo, al terminar un ayudante el huevo eclosiona y sale un pollito', async () => {
  const THREE = await three();
  const { createAccessories } = await load();
  const kit = await fakeKit();
  const mk = id => ({ id, status: 'done', mat: new THREE.MeshStandardMaterial(), m: new THREE.Mesh(new THREE.SphereGeometry(0.13)), pos: new THREE.Vector3(0.5, 0.3, 0) });
  const ok = mk(1), bad = mk(2); bad.status = 'error';
  kit.agents = () => [ok, bad];
  const chick = createAccessories(kit).get('chicken');
  const before = kit.scene.children.length;
  chick.update(frame({ finished: [ok] }));
  assert.equal(kit.scene.children.length, before + 1, 'aparece el huevo abierto con su pollito');
  assert.equal(ok.m.visible, false, 'el huevo de la gota se esconde');
  chick.update(frame({ T: 1.05, finished: [bad] }));
  assert.equal(kit.scene.children.length, before + 1, 'si falla, no nace nada');
  for (let i = 0; i < 200; i++) chick.update(frame({ T: 2 + i * 0.05 }));
  assert.equal(kit.scene.children.length, before, 'el pollito se va y la escena queda limpia');
});

test('cambiar de diseño con un pollito en pantalla no lo deja colgado', async () => {
  const THREE = await three();
  const { createAccessories } = await load();
  const kit = await fakeKit();
  const h = { id: 1, status: 'done', mat: new THREE.MeshStandardMaterial(), m: new THREE.Mesh(new THREE.SphereGeometry(0.13)), pos: new THREE.Vector3() };
  kit.agents = () => [h];
  const chick = createAccessories(kit).get('chicken');
  const before = kit.scene.children.length;
  chick.update(frame({ finished: [h] }));
  assert.equal(kit.scene.children.length, before + 1);
  chick.hide();
  assert.equal(kit.scene.children.length, before);
});

test('el pollo empolla mientras trabaja y vuelve a su postura al terminar', async () => {
  const { createAccessories } = await load();
  const chick = createAccessories(await fakeKit()).get('chicken');
  const said = [];
  let pose = newPose();
  for (let i = 0; i < 100; i++) { pose = newPose(); chick.pose(frame({ T: i * 0.05, busy: true, say: t => said.push(t) }), pose); }
  assert.ok(pose.sy < 0.95 && pose.sxw > 1.03 && pose.y < -0.05, 'agachado sobre los huevos');
  assert.equal(said.filter(t => /Empollando/.test(t)).length, 1, 'avisa una sola vez');
  let rest = newPose();
  for (let i = 0; i < 100; i++) { rest = newPose(); chick.pose(frame({ T: 5 + i * 0.05, busy: false }), rest); }
  assert.ok(Math.abs(rest.sy - 1) < 0.01 && Math.abs(rest.y) < 0.01, 'en reposo, derecho');
});

test('el pollo picotea de vez en cuando, solo si está tranquilo', async () => {
  const { createAccessories } = await load();
  const chick = createAccessories(await fakeKit()).get('chicken');
  const plays = [];
  const run = over => { for (let i = 0; i < 400; i++) chick.update(frame({ T: i * 0.05, play: x => plays.push(x), ...over })); };
  run({ busy: true }); run({ hover: true }); run({ acting: true }); run({ idleFor: 0.5 }); run({ awake: false });
  assert.equal(plays.length, 0, 'ocupado, mirado, en un gesto, activo o dormido: no picotea');
  run({});
  assert.ok(plays.length >= 1 && plays.every(x => x === 'peck'), 'tranquilo, picotea');
  assert.ok(plays.length <= 6, 'cada 5-10 s, no sin parar: ' + plays.length);
});

test('el ninja se tapa la cara con las manos cuando lo miras', async () => {
  const THREE = await three();
  const { createAccessories } = await load();
  const ninja = createAccessories(await fakeKit()).get('ninja');
  const hands = [new THREE.Group(), new THREE.Group()];
  const place = () => { hands[0].position.set(-1, -0.4, 0.2); hands[1].position.set(1, -0.4, 0.2); };
  const said = [], exprs = [];
  const base = { hands, say: t => said.push(t), setExpr: e => exprs.push(e) };
  for (let i = 0; i < 80; i++) { place(); ninja.update(frame({ ...base, T: i * 0.05, hover: true })); }
  assert.ok(Math.abs(hands[0].position.x + 0.3) < 0.05 && Math.abs(hands[1].position.x - 0.3) < 0.05, 'las manos suben a la cara');
  assert.ok(hands[0].position.z > 1, 'delante de la cara');
  const pose = newPose(); ninja.pose(frame({ hover: true }), pose);
  assert.ok(pose.rx > 0 && pose.sy < 1, 'se encoge un poco');
  assert.equal(said.length, 1);
  assert.ok(exprs.includes('shy'));
  for (let i = 0; i < 80; i++) { place(); ninja.update(frame({ ...base, T: 10 + i * 0.05, hover: false })); }
  assert.ok(Math.abs(hands[0].position.x + 1) < 0.05, 'sin mirarlo, las manos vuelven a su sitio');
  for (let i = 0; i < 80; i++) { place(); ninja.update(frame({ ...base, T: 20 + i * 0.05, hover: true, petting: true })); }
  assert.ok(Math.abs(hands[0].position.x + 1) < 0.05, 'si lo acarician, no se esconde');
});
