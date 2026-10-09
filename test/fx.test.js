const { test } = require('node:test');
const assert = require('node:assert/strict');

test('fx respeta el tope de partículas y las quita al acabar su vida', async () => {
  const THREE = await import('../node_modules/three/build/three.module.js');
  const { createFx } = await import('../renderer/fx.js');
  const scene = new THREE.Scene();
  const fx = createFx(THREE, scene, 60);
  assert.equal(fx.burst('confetti', new THREE.Vector3(), 50), 50);
  assert.equal(fx.burst('sparkle', new THREE.Vector3(), 50), 10, 'solo caben 10 más');
  assert.equal(fx.count(), 60);
  for (let i = 0; i < 200; i++) fx.update(0.05); // 10 s: más que cualquier vida
  assert.equal(fx.count(), 0);
  assert.equal(scene.children.length, 1, 'solo queda el grupo de efectos');
  fx.burst('smoke', new THREE.Vector3(), 5); fx.clear();
  assert.equal(fx.count(), 0);
  assert.equal(fx.burst('dragones', new THREE.Vector3(), 5), 0, 'un tipo desconocido no crea nada');
});
