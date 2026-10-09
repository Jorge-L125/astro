// Partículas cortas (confeti, chispas, humo) para los gestos de los diseños. Tope fijo de piezas vivas.
const KINDS = {
  confetti: { life: 1.6, speed: [1.6, 3.2], up: 2.4, gravity: -6, size: 0.085, colors: [0xff6fb5, 0x3a8bff, 0xf2c94c, 0x8fd14f, 0xff6b4a], spin: 8, grow: 0 },
  sparkle: { life: 0.9, speed: [0.4, 1.2], up: 0.8, gravity: 0.4, size: 0.05, colors: [0xfff3b0, 0xc9a7ff, 0xffffff], spin: 0, grow: 0 },
  smoke: { life: 1.1, speed: [0.3, 0.8], up: 0.6, gravity: 0.3, size: 0.16, colors: [0x9a979f, 0xc4c2c8], spin: 1, grow: 1.5 },
};

export function createFx(THREE, scene, max = 60) {
  const root = new THREE.Group(); scene.add(root);
  const geos = { confetti: new THREE.PlaneGeometry(1, 0.6), sparkle: new THREE.OctahedronGeometry(1), smoke: new THREE.SphereGeometry(1, 10, 8) };
  const live = [];
  /** Lanza n partículas desde origin; devuelve cuántas caben (las demás se descartan). */
  function burst(kind, origin, n = 18) {
    const k = KINDS[kind]; if (!k) return 0;
    const take = Math.max(0, Math.min(n, max - live.length));
    for (let i = 0; i < take; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: k.colors[i % k.colors.length], transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geos[kind], mat); m.scale.setScalar(k.size); m.position.copy(origin);
      const a = Math.random() * Math.PI * 2, s = k.speed[0] + Math.random() * (k.speed[1] - k.speed[0]);
      live.push({ m, k, age: 0, v: new THREE.Vector3(Math.cos(a) * s, k.up * (0.6 + Math.random() * 0.6), Math.sin(a) * s * 0.5), r: (Math.random() - 0.5) * k.spin });
      root.add(m);
    }
    return take;
  }
  function kill(i) { const p = live[i]; root.remove(p.m); p.m.material.dispose(); live.splice(i, 1); }
  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i]; p.age += dt;
      if (p.age >= p.k.life) { kill(i); continue; }
      p.v.y += p.k.gravity * dt; p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.r * dt; p.m.rotation.z += p.r * dt;
      const f = p.age / p.k.life;
      p.m.material.opacity = Math.min(1, p.age * 8) * (1 - f);
      if (p.k.grow) p.m.scale.setScalar(p.k.size * (1 + f * p.k.grow));
    }
  }
  return { burst, update, count: () => live.length, clear: () => { for (let i = live.length - 1; i >= 0; i--) kill(i); } };
}
