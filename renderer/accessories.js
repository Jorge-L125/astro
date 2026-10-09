// Registro de diseños (accesorios) de la gota. Cada uno se construye la primera vez que se usa.
// Un diseño devuelve sus piezas: el grupo de la cabeza/cuerpo, objetos en la mano derecha, piezas
// sobre la cara y extras colgados del cuerpo. Nunca se guardan objetos de Three.js en userData:
// Object3D.clone() lo copia con JSON (las mini-gotas de atrás llevan una copia del grupo).
import * as THREE from '../node_modules/three/build/three.module.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

let M = null; // materiales compartidos entre diseños, creados una vez
function mats(kit) {
  if (M) return M;
  const felt = kit.felt;
  M = {
    red: felt(0xd23b3b), fur: felt(0xf8f5ee), band: felt(0x8a5cf0), gold: felt(0xf2c94c),
    witch: new THREE.MeshStandardMaterial({ color: 0x2a2233, roughness: 0.7 }),
    sheet: new THREE.MeshPhysicalMaterial({ color: 0xf7f6f3, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide }),
    cape: new THREE.MeshStandardMaterial({ color: 0x17141c, roughness: 0.55 }),
    capeIn: new THREE.MeshStandardMaterial({ color: 0xa3172a, roughness: 0.45, side: THREE.BackSide }),
    hair: new THREE.MeshPhysicalMaterial({ color: 0x16141a, roughness: 0.35, clearcoat: 0.6 }),
    fang: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
  };
  return M;
}

// Sombrero por tramos: cada tramo cuelga del anterior y se balancea con el movimiento (kit.sway).
export function bentHat(kit, mat, segs) {
  const r = new THREE.Group(); let parent = r;
  segs.forEach(([rb, rt, h, bend], i) => {
    const g = new THREE.Group(); g.rotation.z = bend; g.userData = { bend, w: i }; parent.add(g); kit.sway.push(g);
    const m = new THREE.Mesh(rt > 0 ? new THREE.CylinderGeometry(rt, rb, h, 40) : new THREE.ConeGeometry(rb, h, 40), mat); m.position.y = h / 2; g.add(m);
    const nx = new THREE.Group(); nx.position.y = h; g.add(nx); parent = nx;
  });
  return { root: r, tip: parent };
}

const blank = over => ({ props: [], face: [], extras: [], handMaterial: null, eyesDark: false, faceLift: 1, parts: {}, ...over });

function buildSanta(kit) {
  const m = mats(kit), g = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.13, 20, 64), m.fur); brim.rotation.x = Math.PI / 2; g.add(brim);
  const h = bentHat(kit, m.red, [[0.58, 0.4, 0.38, 0], [0.4, 0.2, 0.36, -0.45], [0.2, 0, 0.34, -0.6]]); g.add(h.root);
  h.tip.add(new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 16), m.fur));
  g.position.set(0.05, 0.8, 0); g.rotation.set(-0.12, 0, 0.12);
  return blank({ group: g });
}

function buildWitch(kit) {
  const m = mats(kit), g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.035, 64), m.witch));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.53, 0.14, 48), m.band); band.position.y = 0.08; g.add(band);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.03), m.gold); buckle.position.set(0, 0.08, 0.525); g.add(buckle);
  const h = bentHat(kit, m.witch, [[0.52, 0.34, 0.5, 0], [0.34, 0.15, 0.45, 0.35], [0.15, 0, 0.4, 0.55]]); g.add(h.root);
  g.position.set(-0.04, 0.84, 0); g.rotation.set(-0.1, 0, -0.14);
  return blank({ group: g });
}

function buildParty(kit) {
  const m = mats(kit);
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#fff7e6'; x.fillRect(0, 0, 128, 128); x.lineWidth = 14;
  ['#ff6fb5', '#3a8bff', '#f2c94c'].forEach((col, j) => { for (let i = -6 + j; i < 8; i += 3) { x.strokeStyle = col; x.beginPath(); x.moveTo(i * 22, 128); x.lineTo(i * 22 + 128, 0); x.stroke(); } });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 1);
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.78, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })); cone.position.y = 0.39; g.add(cone);
  const pom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), m.gold); pom.position.y = 0.8; g.add(pom);
  g.position.set(0.3, 0.84, 0.12); g.rotation.set(0.1, 0, -0.36);
  return blank({ group: g });
}

function buildGhost(kit) {
  const m = mats(kit);
  const pts = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * 1.07, Math.cos(a) * 1.07)); }
  for (let i = 1; i <= 14; i++) { const k = i / 14; pts.push(new THREE.Vector2(1.07 + 0.17 * k * k, -1.08 * k)); }
  const geo = new THREE.LatheGeometry(pts, 96), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); if (y >= -0.4) continue;
    const k = (-0.4 - y) / 0.68, w = Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7), s = 1 + w * 0.03 * k;
    p.setY(i, y + w * 0.09 * k * k); p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s);
  }
  geo.computeVertexNormals();
  const g = new THREE.Group(); const sheet = new THREE.Mesh(geo, m.sheet); g.add(sheet);
  const parts = { sheet };
  return blank({ group: g, handMaterial: [m.sheet, m.sheet], eyesDark: true, faceLift: 1.09, parts,
    update: st => { sheet.rotation.y = st.T * 0.35; } });
}

function buildVampire(kit) {
  const m = mats(kit), g = new THREE.Group();
  const ts = Math.PI - 1.35, tl = 2.7;
  const collar = new THREE.CylinderGeometry(1.32, 1.0, 0.75, 64, 1, true, ts, tl), cape = new THREE.CylinderGeometry(1.0, 1.3, 0.95, 64, 1, true, ts, tl);
  for (const mat of [m.cape, m.capeIn]) { const a = new THREE.Mesh(collar, mat); a.position.y = -0.05; const b = new THREE.Mesh(cape, mat); b.position.y = -0.9; g.add(a, b); }
  const cap = new THREE.SphereGeometry(1.012, 64, 24, 0, Math.PI * 2, 0, 0.62), cp = cap.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(cp, i), phi = Math.atan2(v.x, v.z), pol = Math.acos(clamp(v.y / 1.012, -1, 1));
    const np = pol * (1 + 0.5 * Math.exp(-((phi / 0.32) ** 2)) * (pol / 0.62) ** 3), sp = Math.sin(np);
    cp.setXYZ(i, Math.sin(phi) * sp * 1.012, Math.cos(np) * 1.012, Math.cos(phi) * sp * 1.012);
  }
  cap.computeVertexNormals(); g.add(new THREE.Mesh(cap, m.hair));
  const fangs = [-1, 1].map(sg => {
    const f = new THREE.Group(); const fm = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.095, 16), m.fang);
    fm.rotation.z = Math.PI; fm.position.y = -0.035; fm.scale.z = 0.55; f.add(fm);
    return kit.onSurface(f, 0.085 * sg, -0.25, 0.004);
  });
  return blank({ group: g, face: fangs });
}

function buildCowboy(kit) {
  const g = new THREE.Group();
  const mTan = kit.felt(0xb47a45), mLeather = kit.felt(0x4a2f1c);
  const bp = []; for (let i = 0; i <= 12; i++) bp.push(new THREE.Vector2(0.45 + 0.57 * i / 12, 0.02)); bp.push(new THREE.Vector2(1.035, 0)); for (let i = 12; i >= 0; i--) bp.push(new THREE.Vector2(0.45 + 0.57 * i / 12, -0.02));
  const brimGeo = new THREE.LatheGeometry(bp, 96), b = brimGeo.attributes.position;
  for (let i = 0; i < b.count; i++) {
    const x = b.getX(i), z = b.getZ(i), sx = Math.max(0, Math.abs(x) - 0.48) / 0.55;
    b.setY(i, b.getY(i) + 0.34 * sx * sx - 0.05 * Math.max(0, z - 0.4) / 0.6);
  }
  brimGeo.computeVertexNormals(); g.add(new THREE.Mesh(brimGeo, mTan));
  const crownGeo = new THREE.CylinderGeometry(0.4, 0.5, 0.52, 48, 8), c = crownGeo.attributes.position;
  for (let i = 0; i < c.count; i++) {
    const x = c.getX(i), y = c.getY(i), z = c.getZ(i), t = (y + 0.26) / 0.52;
    c.setX(i, x * (1 - 0.22 * t * t * Math.max(0, z) / 0.45)); c.setY(i, y - (t > 0.99 ? 0.11 * Math.exp(-((x / 0.22) ** 2)) : 0));
  }
  crownGeo.computeVertexNormals();
  const crown = new THREE.Mesh(crownGeo, mTan); crown.position.y = 0.26; g.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.485, 0.5, 0.1, 48, 1, true), mLeather); band.position.y = 0.06; g.add(band);
  g.position.set(0.03, 0.82, -0.02); g.rotation.set(-0.16, 0, 0.1);
  return blank({ group: g });
}

// Esfera partida en dos: lo de fuera de la ventana y lo de dentro (para cascos con visor o capuchas).
function splitSphere(r, inWin, thetaLen = Math.PI) {
  const geo = new THREE.SphereGeometry(r, 128, 80, 0, Math.PI * 2, 0, thetaLen), idx = geo.index.array, p = geo.attributes.position, a = [], b = [], v = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    v.set(0, 0, 0); for (let k = 0; k < 3; k++) { const j = idx[i + k]; v.x += p.getX(j); v.y += p.getY(j); v.z += p.getZ(j); }
    v.normalize(); (inWin(v) ? b : a).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const outG = geo.clone(); outG.setIndex(a); geo.setIndex(b); return [outG, geo];
}
const ellipseWin = (ax, ay, cy, n = 2) => v => v.z > 0 && Math.abs(v.x / ax) ** n + Math.abs((v.y - cy) / ay) ** n < 1;
function rimTube(r, ax, ay, cy, tube, mat, n = 2) {
  const se = c => Math.sign(c) * Math.abs(c) ** (2 / n);
  const pts = []; for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, x = ax * se(Math.cos(a)), y = cy + ay * se(Math.sin(a)); pts.push(new THREE.Vector3(x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))).multiplyScalar(r)); }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 144, tube, 10, true), mat);
}
let TOOLS = null; // materiales de herramientas
const tools = () => TOOLS || (TOOLS = {
  wood: new THREE.MeshStandardMaterial({ color: 0x9a6a3e, roughness: 0.6 }),
  steel: new THREE.MeshPhysicalMaterial({ color: 0xaab0b8, metalness: 0.85, roughness: 0.25 }),
});

// Texturas pintadas en un <canvas> (solo existen en el navegador; en las pruebas de Node, sin textura).
function canvasTex(w, h, paint) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'));
  return new THREE.CanvasTexture(c);
}
let METEOR_TEX = null;
function meteorTex() {
  return METEOR_TEX || (METEOR_TEX = {
    trail: canvasTex(16, 128, x => { const gr = x.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(255,120,60,0)'); gr.addColorStop(0.6, 'rgba(255,120,50,.55)'); gr.addColorStop(0.92, 'rgba(255,170,70,.95)'); gr.addColorStop(1, 'rgba(255,215,140,1)'); x.fillStyle = gr; x.fillRect(0, 0, 16, 128); }),
    halo: canvasTex(64, 64, x => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,170,80,.7)'); gr.addColorStop(1, 'rgba(255,140,60,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); }),
  });
}

function buildAstro(kit) {
  const g = new THREE.Group();
  const suit = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f0, roughness: 0.45, clearcoat: 0.4 });
  const W = [0.64, 0.42, 0.03], RH = 1.075;
  const [shellG, visorG] = splitSphere(RH, ellipseWin(...W), Math.PI * 0.8);
  g.add(new THREE.Mesh(shellG, suit));
  const visor = new THREE.Mesh(visorG, new THREE.MeshPhysicalMaterial({ color: 0xa8c8ff, roughness: 0.03, clearcoat: 1, transparent: true, opacity: 0.24, depthWrite: false }));
  visor.scale.setScalar(1.012); visor.renderOrder = 5; g.add(visor);
  const gray = new THREE.MeshPhysicalMaterial({ color: 0x9aa0aa, metalness: 0.5, roughness: 0.35 });
  g.add(rimTube(RH + 0.01, W[0], W[1], W[2], 0.05, gray));
  const collar = new THREE.Mesh(new THREE.TorusGeometry(RH * Math.sin(Math.PI * 0.8), 0.08, 16, 64), gray); collar.rotation.x = Math.PI / 2; collar.position.y = RH * Math.cos(Math.PI * 0.8); g.add(collar);
  [-1, 1].forEach(s => { const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.12, 32), gray); ear.rotation.z = Math.PI / 2; ear.position.set(s * 1.06, 0.05, 0); g.add(ear); });
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff4d3d, emissive: 0xff4d3d, emissiveIntensity: 1 }));
  light.position.set(-1.13, 0.05, 0); g.add(light);

  // Meteoros que cruzan el cielo detrás de la gota; viven en coordenadas de la escena.
  const fxg = new THREE.Group(); kit.scene.add(fxg);
  const parts = { light, fxg, meteors: [], next: 0 };
  function spawnMeteor() {
    const tex = meteorTex(), m = new THREE.Group(), dir = Math.random() < 0.5 ? -1 : 1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true }));
    const trail = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 1.7), new THREE.MeshBasicMaterial({ map: tex.trail, transparent: true, depthWrite: false }));
    trail.position.y = 0.85;
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshBasicMaterial({ map: tex.halo, transparent: true, depthWrite: false })); head.add(halo);
    m.add(trail, head);
    const v = new THREE.Vector3(-dir * (2.2 + Math.random()), -(2.6 + Math.random()), 0);
    m.position.set(dir * (1.2 + Math.random() * 2.2), 4.6 + Math.random(), -3 - Math.random() * 2);
    m.rotation.z = Math.atan2(v.y, v.x) + Math.PI / 2;
    fxg.add(m); const it = { g: m, v, age: 0, life: 2.4, head, halo, trail }; parts.meteors.push(it); return it;
  }
  function drop(it) {
    fxg.remove(it.g);
    for (const o of [it.head, it.halo, it.trail]) { o.geometry.dispose(); o.material.dispose(); }
  }
  return blank({ group: g, handMaterial: [suit, suit], parts,
    update(st) {
      light.material.emissiveIntensity = st.busy ? (Math.sin(st.T * 14) > 0 ? 1.8 : 0.1) : 0.7 + 0.5 * Math.sin(st.T * 2);
      if (st.awake && st.T > parts.next) {
        parts.next = st.T + 2.8 + Math.random() * 4;
        const it = spawnMeteor();
        if (!st.acting && !st.busy) parts.watch = it; // si no está ocupado, lo sigue con la mirada
      }
      for (let i = parts.meteors.length - 1; i >= 0; i--) {
        const it = parts.meteors[i]; it.age += st.dt; it.g.position.addScaledVector(it.v, st.dt);
        const f = it.age / it.life, a = Math.min(1, it.age * 5) * (1 - Math.max(0, (f - 0.7) / 0.3));
        it.head.material.opacity = a; it.trail.material.opacity = a; it.halo.material.opacity = a; it.trail.scale.y = Math.min(1, it.age * 2.5);
        if (it.age >= it.life) { drop(it); parts.meteors.splice(i, 1); if (parts.watch === it) parts.watch = null; }
      }
      if (parts.watch && parts.watch.age < parts.watch.life * 0.8) st.setLook(parts.watch.g.position);
    },
    hide() { parts.meteors.forEach(drop); parts.meteors.length = 0; parts.watch = null; },
  });
}

function buildHardhat(kit) {
  const { steel } = tools();
  const g = new THREE.Group();
  const yel = new THREE.MeshPhysicalMaterial({ color: 0xf5c518, roughness: 0.35, clearcoat: 0.6 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), yel); dome.scale.set(1.04, 0.82, 1.06); g.add(dome);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.045, 64), yel); brim.scale.z = 1.1; brim.position.z = 0.08; g.add(brim);
  const ridge = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 12, 48, Math.PI), yel); ridge.scale.set(1.06, 0.83, 1); ridge.rotation.y = Math.PI / 2; g.add(ridge);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.12, 24), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.4 })); lamp.rotation.x = Math.PI / 2 - 0.5; lamp.position.set(0, 0.45, 0.9); g.add(lamp);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xfff2b0, emissiveIntensity: 1.2 }));
  lens.position.set(0, 0.48, 0.965); lens.rotation.x = -0.5; g.add(lens);
  g.position.set(0, 0.52, 0); g.scale.setScalar(0.92); g.rotation.x = -0.1;

  // martillo en la mano derecha
  const hm = new THREE.Group();
  const fiber = new THREE.MeshPhysicalMaterial({ color: 0xf2b705, roughness: 0.35, clearcoat: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1f1f22, roughness: 0.9 });
  const forged = new THREE.MeshPhysicalMaterial({ color: 0x7d838c, metalness: 0.9, roughness: 0.32 });
  const polished = new THREE.MeshPhysicalMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.12 });
  const v2 = pts => pts.map(([r, y]) => new THREE.Vector2(r, y));
  hm.add(new THREE.Mesh(new THREE.LatheGeometry(v2([[0, -0.08], [0.036, -0.08], [0.04, -0.06], [0.036, 0.05], [0.03, 0.2], [0.026, 0.38], [0.028, 0.47], [0, 0.47]]), 24), fiber));
  hm.add(new THREE.Mesh(new THREE.LatheGeometry(v2([[0, -0.085], [0.043, -0.085], [0.047, -0.06], [0.042, -0.02], [0.045, 0.03], [0.041, 0.08], [0.044, 0.13], [0.034, 0.17], [0, 0.17]]), 24), rubber));
  for (let i = 0; i < 4; i++) { const rg = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.006, 6, 24), rubber); rg.rotation.x = Math.PI / 2; rg.position.y = -0.04 + i * 0.05; hm.add(rg); }
  const head = new THREE.Group(); head.position.y = 0.5; hm.add(head);
  head.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.11, 0.075), forged));
  const strike = new THREE.Mesh(new THREE.LatheGeometry(v2([[0, 0], [0.04, 0], [0.034, 0.02], [0.036, 0.06], [0.05, 0.1], [0.054, 0.15], [0.05, 0.165], [0, 0.165]]), 32), forged); strike.rotation.z = -Math.PI / 2; strike.position.x = 0.04; head.add(strike);
  const fc = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32), polished); fc.rotation.y = Math.PI / 2; fc.position.x = 0.206; head.add(fc);
  const cs = new THREE.Shape(); cs.moveTo(-0.045, 0.05); cs.quadraticCurveTo(-0.17, 0.05, -0.27, -0.075); cs.lineTo(-0.255, -0.09); cs.quadraticCurveTo(-0.16, -0.02, -0.045, -0.03); cs.closePath();
  const cg = new THREE.ExtrudeGeometry(cs, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
  [-1, 1].forEach(sz => { const c = new THREE.Mesh(cg, forged); c.position.z = sz > 0 ? 0.008 : -0.034; head.add(c); });
  const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.04), polished); wedge.position.y = 0.057; head.add(wedge);
  hm.scale.setScalar(1.1); hm.position.set(0.04, -0.02, 0.1); hm.rotation.set(0, -0.4, -0.25);

  // cinturón de herramientas
  const belt = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.7, side: THREE.DoubleSide }), dark = kit.felt(0x5e3c1e);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.935, 0.83, 0.18, 72, 1, true), leather); band.position.y = -0.48; belt.add(band);
  const buckle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 4), steel); buckle.rotation.z = Math.PI / 4; buckle.scale.y = 0.8;
  const bk = new THREE.Group(); bk.add(buckle); bk.position.set(0, -0.48, 0.895); bk.rotation.x = -0.55; belt.add(bk);
  const pouch = (ang, w, tool) => { const p = new THREE.Group(); p.position.set(Math.sin(ang) * 0.86, -0.6, Math.cos(ang) * 0.86); p.rotation.set(-0.45, ang, 0);
    p.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, 0.09), dark));
    const flap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.05, 0.1), leather); flap.position.y = 0.09; p.add(flap);
    if (tool) p.add(tool); belt.add(p); };
  const screw = new THREE.Group(); const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 12), kit.felt(0xe8463c)); sh.position.y = 0.16; screw.add(sh);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), steel); tip.position.y = 0.06; screw.add(tip); screw.position.x = -0.03;
  const wr = new THREE.Group(); const wb = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.015), steel); wb.position.y = 0.12; wr.add(wb);
  const wh = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.014, 8, 16, Math.PI * 1.5), steel); wh.position.y = 0.25; wh.rotation.z = -Math.PI * 0.25; wr.add(wh); wr.position.x = 0.03; wr.rotation.z = -0.15;
  pouch(0.75, 0.17, screw); pouch(-0.75, 0.17, wr); pouch(1.45, 0.14);

  return blank({ group: g, props: [hm], extras: [belt], parts: { hammer: hm, belt },
    update(st) {
      hm.rotation.z = -0.25 + (st.busy ? Math.max(0, Math.sin(st.T * 9)) * 0.9 : 0.06 * Math.sin(st.T * 1.5));
      belt.scale.setScalar(Math.max(0.001, st.hw));
    } });
}

function buildPhones(kit) {
  const g = new THREE.Group();
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x24242a, roughness: 0.4, clearcoat: 0.5 }), pad = kit.felt(0x3a3a42);
  const glow = new THREE.MeshStandardMaterial({ color: 0xff6b4a, emissive: 0xff6b4a, emissiveIntensity: 0.7 });
  g.add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.055, 16, 64, Math.PI), dark));
  [-1, 1].forEach(s => {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 40), dark); cup.rotation.z = Math.PI / 2; cup.position.x = s * 1.1; g.add(cup);
    const cush = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.07, 12, 32), pad); cush.rotation.y = Math.PI / 2; cush.position.x = s * 0.99; g.add(cush);
    const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.02, 32), glow); dot.rotation.z = Math.PI / 2; dot.position.x = s * 1.205; g.add(dot);
  });
  g.rotation.x = -0.22;
  return blank({ group: g, parts: { glow },
    update(st) { glow.emissiveIntensity = 0.5 + 0.5 * Math.abs(Math.sin(st.T * Math.PI * (st.busy ? 4 : 2))); } });
}

function buildNinja() {
  const g = new THREE.Group();
  const hood = new THREE.MeshStandardMaterial({ color: 0x4b4a5c, roughness: 0.8 });
  const W = [0.7, 0.29, 0.04, 3.2], RH = 1.045;
  const [hoodG] = splitSphere(RH, ellipseWin(...W)); g.add(new THREE.Mesh(hoodG, hood));
  g.add(rimTube(RH, W[0], W[1], W[2], 0.035, hood, W[3]));
  const red = new THREE.MeshStandardMaterial({ color: 0xe8463c, roughness: 0.7, side: THREE.DoubleSide });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.915, 1.0, 0.19, 64, 1, true), red); band.position.y = 0.47; g.add(band);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), red); knot.scale.set(1.2, 0.9, 0.7); knot.position.set(0.32, 0.5, -0.9); g.add(knot);
  const tailGeo = new THREE.BoxGeometry(0.12, 0.62, 0.025); tailGeo.translate(0, -0.31, 0);
  const tails = [0, 1].map(i => { const p = new THREE.Group(); p.position.set(0.34, 0.5, -0.93); p.rotation.z = i ? 1.9 : 1.35; p.add(new THREE.Mesh(tailGeo, red)); g.add(p); return p; });
  const shine = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), new THREE.MeshStandardMaterial({ color: 0x8d8c9e, roughness: 0.5 })); shine.scale.set(1.3, 0.35, 0.8); shine.position.set(0, 1.0, 0.25); shine.rotation.x = -0.25; g.add(shine);

  const s = new THREE.Shape(); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.07 : 0.24; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) s.lineTo(x, y); else s.moveTo(x, y); } s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.035, 0, Math.PI * 2, true); s.holes.push(hole);
  const sg = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }); sg.center();
  const shuriken = new THREE.Mesh(sg, new THREE.MeshPhysicalMaterial({ color: 0xc4c9d2, metalness: 0.85, roughness: 0.22 }));
  shuriken.scale.setScalar(1.5); shuriken.position.set(0.24, 0.26, 0.28);

  return blank({ group: g, props: [shuriken], handMaterial: [hood, hood], parts: { tails, shuriken },
    update(st) {
      tails.forEach((p, i) => { p.rotation.x = 0.35 + 0.15 * Math.sin(st.T * (st.busy ? 10 : 6) + i * 1.3) - st.spring.ax * 0.8; p.rotation.y = 0.12 * Math.sin(st.T * 4.5 + i); });
      shuriken.rotation.z = st.T * (st.busy ? 12 : 5);
    } });
}

function buildMagic(kit) {
  const g = new THREE.Group();
  const black = new THREE.MeshPhysicalMaterial({ color: 0x1a1a1f, roughness: 0.45, clearcoat: 0.4 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 64), black));
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.78, 48), black); crown.position.y = 0.41; g.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.525, 0.53, 0.15, 48), kit.felt(0xc8303a)); band.position.y = 0.1; g.add(band);
  // una mini-gota que asoma del sombrero (truco de magia)
  const pop = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 20), kit.bodyMaterial); pop.visible = false; g.add(pop);
  g.position.set(-0.04, 0.86, 0); g.rotation.set(-0.08, 0, -0.1);
  const parts = { pop, popT: -9 };
  return blank({ group: g, parts,
    popOut(T) { parts.popT = T + 0.25; },
    update(st) {
      const pp = (st.T - parts.popT) / 1.3; pop.visible = pp > 0 && pp < 1;
      if (pop.visible) { pop.position.y = 0.72 + Math.sin(Math.PI * pp) * 0.55; pop.scale.setScalar(Math.min(1, pp * 6, (1 - pp) * 6)); }
    },
    hide() { parts.popT = -9; pop.visible = false; } });
}

function buildPirate(kit) {
  const g = new THREE.Group();
  const black = kit.felt(0x1c1a1e), gold = new THREE.MeshPhysicalMaterial({ color: 0xd9a93a, metalness: 0.7, roughness: 0.3 });
  const bp = []; for (let i = 0; i <= 12; i++) bp.push(new THREE.Vector2(0.45 + 0.6 * i / 12, 0.025)); for (let i = 12; i >= 0; i--) bp.push(new THREE.Vector2(0.45 + 0.6 * i / 12, -0.025));
  const geo = new THREE.LatheGeometry(bp, 120), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), phi = Math.atan2(x, z), k = clamp((r - 0.45) / 0.6);
    const s = 1 + 0.14 * Math.cos(3 * phi) * k;
    p.setX(i, x * s); p.setZ(i, z * s); p.setY(i, p.getY(i) + 0.55 * k * k * (0.5 - 0.5 * Math.cos(3 * phi)));
  }
  geo.computeVertexNormals(); g.add(new THREE.Mesh(geo, black));
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.47, 0.36, 48), black); crown.position.y = 0.18; g.add(crown);
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 24), gold); coin.rotation.x = Math.PI / 2 - 0.15; coin.position.set(0, 0.2, 0.47); g.add(coin);
  g.position.set(0, 0.8, 0); g.rotation.set(-0.14, 0.12, 0.06);

  // garfio en la mano derecha
  const hook = new THREE.Group(); const metal = new THREE.MeshPhysicalMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.18 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 16), metal); shaft.position.y = -0.2; hook.add(shaft);
  const curve = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.034, 12, 32, Math.PI * 1.25), metal); curve.rotation.x = Math.PI; curve.position.set(-0.1, -0.31, 0); hook.add(curve);
  const tipA = -Math.PI * 1.25, tip = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.08, 12), metal);
  tip.position.set(-0.1 + Math.cos(tipA) * 0.1, -0.31 - Math.sin(tipA) * 0.1, 0); tip.rotation.z = Math.PI / 4; hook.add(tip);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.05, 24), metal); plate.position.y = -0.12; hook.add(plate);
  hook.scale.set(-1.5, 1.5, 1.5); hook.position.y = 0.06;

  // parche sobre el ojo derecho y su correa alrededor de la cabeza
  const pm = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 });
  const patch = new THREE.Group(); const d = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), pm); d.scale.y = 1.3; patch.add(d);
  kit.onSurface(patch, 0.3, 0.02, 0.05);
  const pt = new THREE.Vector3(0.3, 0.02, 0.95).normalize(), n = pt.clone().cross(new THREE.Vector3(-0.6, 0.8, 0)).normalize();
  const strap = new THREE.Mesh(new THREE.TorusGeometry(1.012, 0.018, 8, 120), pm); strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n); kit.face.add(strap);

  return blank({ group: g, props: [hook], face: [patch, strap], handMaterial: [null, kit.felt(0x3a2a20)], parts: { hook },
    update(st) { hook.rotation.z = st.busy ? Math.sin(st.T * 6) * 0.3 : hook.rotation.z * 0.9; } });
}

const DEFS = [
  { key: 'none', label: 'Ninguno', emoji: '🚫', build: () => null },
  { key: 'santa', label: 'Navidad', emoji: '🎅', build: buildSanta },
  { key: 'ghost', label: 'Fantasma', emoji: '👻', build: buildGhost },
  { key: 'vampire', label: 'Vampiro', emoji: '🧛', build: buildVampire },
  { key: 'witch', label: 'Bruja', emoji: '🧙‍♀️', build: buildWitch },
  { key: 'party', label: 'Fiesta', emoji: '🥳', build: buildParty },
  { key: 'cowboy', label: 'Vaquero', emoji: '🤠', build: buildCowboy },
  { key: 'astro', label: 'Astronauta', emoji: '🧑‍🚀', build: buildAstro },
  { key: 'hardhat', label: 'Casco de obra', emoji: '👷', build: buildHardhat },
  { key: 'phones', label: 'Audífonos', emoji: '🎧', build: buildPhones },
  { key: 'ninja', label: 'Ninja', emoji: '🥷', build: buildNinja },
  { key: 'magic', label: 'Mago', emoji: '🎩', build: buildMagic },
  { key: 'pirate', label: 'Pirata', emoji: '🏴‍☠️', build: buildPirate },
];

export const ACCESSORY_LIST = DEFS.map(({ key, label, emoji }) => ({ key, label, emoji }));
export const isAccessory = k => DEFS.some(d => d.key === k);

/** Muestra u oculta todas las piezas de un diseño construido. */
export function showBuilt(b, on) {
  if (!b) return;
  for (const o of [b.group, ...b.props, ...b.face, ...b.extras]) o.visible = on;
  if (!on && b.hide) b.hide();
}

export function createAccessories(kit, extraDefs = []) {
  const all = [...DEFS, ...extraDefs], cache = new Map();
  const def = key => all.find(d => d.key === key) || null;
  function get(key) {
    if (cache.has(key)) return cache.get(key);
    const d = def(key);
    let b = null;
    if (d && key !== 'none') {
      try {
        b = d.build(kit);
        kit.accRoot.add(b.group);
        b.props.forEach(p => kit.hands[1].add(p));
        b.extras.forEach(e => kit.bot.add(e));
        showBuilt(b, false);
      } catch (e) { console.error(`[astro] no pude construir el diseño «${key}»:`, e); b = null; }
    }
    cache.set(key, b);
    return b;
  }
  return { get, def };
}
