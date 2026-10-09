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

const DEFS = [
  { key: 'none', label: 'Ninguno', emoji: '🚫', build: () => null },
  { key: 'santa', label: 'Navidad', emoji: '🎅', build: buildSanta },
  { key: 'ghost', label: 'Fantasma', emoji: '👻', build: buildGhost },
  { key: 'vampire', label: 'Vampiro', emoji: '🧛', build: buildVampire },
  { key: 'witch', label: 'Bruja', emoji: '🧙‍♀️', build: buildWitch },
  { key: 'party', label: 'Fiesta', emoji: '🥳', build: buildParty },
  { key: 'cowboy', label: 'Vaquero', emoji: '🤠', build: buildCowboy },
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
