const { test } = require('node:test');
const assert = require('node:assert/strict');

test('la equis de error es una pieza roja centrada que sube sin girar', async () => {
  const THREE = await import('../node_modules/three/build/three.module.js');
  const { createFx, crossGeometry } = await import('../renderer/fx.js');
  const g = crossGeometry(THREE);
  assert.ok(g.attributes.position.count >= 8, 'tiene forma');
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.x) < 1e-6 && Math.abs(c.y) < 1e-6, 'centrada');
  const scene = new THREE.Scene();
  const fx = createFx(THREE, scene, 10);
  assert.equal(fx.burst('cross', new THREE.Vector3(), 4), 4);
  assert.equal(fx.burst('cross', new THREE.Vector3(), 20), 6, 'respeta el tope');
  const x = scene.children[0].children[0];
  assert.ok((x.material.color.getHex() >> 16) > 0xc0, 'rojo');
  const y0 = x.position.y;
  fx.update(0.2);
  assert.ok(x.position.y > y0, 'sube');
  assert.equal(x.rotation.z, 0, 'sin girar');
  for (let i = 0; i < 100; i++) fx.update(0.05);
  assert.equal(fx.count(), 0);
});
