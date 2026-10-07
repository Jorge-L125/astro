// Personaje 3D de Astro (diseño "Gota"): esfera expresiva que se derrite en gota al minimizar,
// se divide en sesiones y lanza mini-gotas (ayudantes) que orbitan mientras trabajan.
import * as THREE from '../node_modules/three/build/three.module.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const bump = (p, a, b) => (p >= a && p <= b ? Math.sin(Math.PI * (p - a) / (b - a)) : 0);
const pick = a => a[Math.floor(Math.random() * a.length)];

// Estados de ánimo de la interfaz -> expresión de la cara.
const MOOD_EXPR = { neutral: 'neutral', happy: 'happy', thinking: 'thinking', surprised: 'surprised', worried: 'worried', talking: 'neutral', delegating: 'focus' };
// Posiciones de las sesiones que esperan detrás: [x, y, z, escala].
const SLOTS = [[-1.05, 1.0, -1.4, 0.48], [1.05, 1.0, -1.4, 0.48], [0, 1.6, -2.5, 0.42], [-1.8, 1.5, -2.7, 0.4], [1.8, 1.5, -2.7, 0.4]];

export function createGota(host, opts = {}) {
  const noop = () => {};
  const say = opts.say || noop;
  const onClick = opts.onClick || noop;
  const onModeChange = opts.onModeChange || noop;
  const onMiniClick = opts.onMiniClick || noop;
  const onAgentClick = opts.onAgentClick || noop;
  const onAgentHover = opts.onAgentHover || noop;
  const onSwitched = opts.onSwitched || noop;
  const SLEEP_AFTER = opts.sleepAfter || 60;

  // ---------- renderer ----------
  const canvas = document.createElement('canvas');
  host.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.0, 10);
  camera.lookAt(0, 0.5, 0);
  let W = 1, H = 1;
  function resize() {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8f8676, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(3, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(-4, 3, -4); scene.add(rim);

  // ---------- materiales ----------
  let activeColor = opts.color || '#ff6b4a';
  const bodyColor = new THREE.Color(activeColor);
  const targetColor = bodyColor.clone();
  const mShell = new THREE.MeshPhysicalMaterial({ color: bodyColor.clone(), roughness: 0.3, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.2 });
  const mGlow = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const mBlush = new THREE.MeshBasicMaterial({ color: 0xff7d9c, transparent: true, opacity: 0, depthWrite: false });
  const mFx = new THREE.MeshBasicMaterial({ color: bodyColor.clone(), transparent: true, opacity: 0, depthWrite: false });
  const mesh = (geo, mat) => new THREE.Mesh(geo, mat);
  const eyeHex = hex => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.3 ? 0x141416 : 0xffffff; };

  // ---------- modelo ----------
  const root = new THREE.Group(); scene.add(root);
  const bot = new THREE.Group(); root.add(bot);
  const bodyGeo = new THREE.SphereGeometry(1, 64, 48);
  const body = mesh(bodyGeo, mShell); bot.add(body);

  // esfera -> gota (misma topología)
  const basePos = bodyGeo.attributes.position.array.slice();
  const dropPos = new Float32Array(basePos.length);
  for (let i = 0; i < basePos.length; i += 3) {
    const x = basePos[i], y = basePos[i + 1], z = basePos[i + 2];
    const th = Math.acos(clamp(y, -1, 1));
    const k = Math.pow(Math.sin(th / 2), 1.35) * 1.08;
    dropPos[i] = x * k; dropPos[i + 1] = y * 1.22 + 0.08; dropPos[i + 2] = z * k;
  }
  const seamGroups = (() => {
    const map = new Map();
    for (let i = 0; i < basePos.length / 3; i++) {
      const k = Array.from(basePos.slice(i * 3, i * 3 + 3), v => Math.round(v * 1e4)).join(',');
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(i);
    }
    return [...map.values()].filter(g => g.length > 1);
  })();
  let lastMorph = -1;
  function setMorph(m) {
    if (Math.abs(m - lastMorph) < 1e-4) return;
    lastMorph = m;
    const p = bodyGeo.attributes.position.array;
    for (let i = 0; i < p.length; i++) p[i] = basePos[i] + (dropPos[i] - basePos[i]) * m;
    bodyGeo.attributes.position.needsUpdate = true;
    bodyGeo.computeVertexNormals();
    const n = bodyGeo.attributes.normal.array;
    for (const g of seamGroups) {
      let x = 0, y = 0, z = 0;
      for (const i of g) { x += n[i * 3]; y += n[i * 3 + 1]; z += n[i * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      for (const i of g) { n[i * 3] = x / l; n[i * 3 + 1] = y / l; n[i * 3 + 2] = z / l; }
    }
    bodyGeo.attributes.normal.needsUpdate = true;
  }
  setMorph(0);

  // cara pegada a la superficie frontal (solo ojos y rubor)
  const face = new THREE.Group(); bot.add(face);
  function onSurface(obj, x, y, lift = 0.012) {
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    obj.position.set(x, y, z + lift - 0.004);
    obj.rotation.set(-Math.atan2(y, z), Math.atan2(x, z), 0);
    face.add(obj);
    return obj;
  }

  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.09);
  heartShape.bezierCurveTo(-0.02, -0.06, -0.115, -0.02, -0.115, 0.03);
  heartShape.bezierCurveTo(-0.115, 0.08, -0.065, 0.1, -0.035, 0.1);
  heartShape.bezierCurveTo(-0.012, 0.1, 0, 0.082, 0, 0.065);
  heartShape.bezierCurveTo(0, 0.082, 0.012, 0.1, 0.035, 0.1);
  heartShape.bezierCurveTo(0.065, 0.1, 0.115, 0.08, 0.115, 0.03);
  heartShape.bezierCurveTo(0.115, -0.02, 0.02, -0.06, 0, -0.09);
  const gPill = new THREE.CapsuleGeometry(0.105, 0.18, 8, 24);
  const gArc = new THREE.TorusGeometry(0.125, 0.04, 12, 32, Math.PI);
  const gHeart = new THREE.ExtrudeGeometry(heartShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 16 });
  gHeart.center(); gHeart.scale(1.35, 1.35, 1);
  const gBar = new THREE.CapsuleGeometry(0.032, 0.2, 6, 12);

  const eyes = {};
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? -1 : 1;
    const g = onSurface(new THREE.Group(), 0.3 * sg, 0.02);
    const inner = new THREE.Group(); g.add(inner);
    const pill = new THREE.Group(); const pm = mesh(gPill, mGlow); pm.scale.z = 0.35; pill.add(pm); inner.add(pill);
    const arc = new THREE.Group(); const am = mesh(gArc, mGlow); am.position.y = -0.04; am.scale.z = 0.5; arc.add(am); inner.add(arc);
    const heart = new THREE.Group(); heart.add(mesh(gHeart, mGlow)); inner.add(heart);
    const xg = new THREE.Group();
    const b1 = mesh(gBar, mGlow); b1.rotation.z = Math.PI / 4; b1.scale.z = 0.5;
    const b2 = mesh(gBar, mGlow); b2.rotation.z = -Math.PI / 4; b2.scale.z = 0.5;
    xg.add(b1, b2); inner.add(xg);
    eyes[side] = { inner, pill, arc, heart, x: xg, sg };
  }
  ['L', 'R'].forEach(s => onSurface(mesh(new THREE.CircleGeometry(0.075, 32), mBlush), 0.47 * (s === 'L' ? -1 : 1), -0.1, 0.008));

  // manos flotantes
  const hands = ['L', 'R'].map(() => { const h = mesh(new THREE.SphereGeometry(0.17, 32, 20), mShell); bot.add(h); return h; });

  // suelo
  const GROUND = -1.45;
  const shTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = GROUND; scene.add(shadow);
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 64), mFx);
  ripple.rotation.x = -Math.PI / 2; ripple.visible = false; scene.add(ripple);
  const splash = Array.from({ length: 7 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 10), mShell); m.visible = false; scene.add(m); return m; });

  // ---------- expresiones ----------
  const BASE = { pill: 1, sx: 1, sy: 1, tilt: 0, eyeY: 0, lookUp: 0, arc: 0, heart: 0, x: 0, winkL: 0, blush: 0 };
  const EX = {
    neutral: {},
    curious: { sx: 0.95, sy: 1.12 },
    happy: { pill: 0, arc: 1, blush: 0.5 },
    joy: { pill: 0, arc: 1, blush: 0.9, eyeY: 0.02 },
    surprised: { sx: 1.25, sy: 1.1 },
    sleepy: { sx: 1.25, sy: 0.12, eyeY: -0.04 },
    love: { pill: 0, heart: 1, blush: 1 },
    dizzy: { pill: 0, x: 1 },
    angry: { sx: 1.35, sy: 0.42, tilt: 1 },
    sad: { sx: 1.2, sy: 0.55, tilt: -1, eyeY: -0.03 },
    thinking: { sx: 0.9, sy: 0.85, lookUp: 1 },
    wink: { winkL: 1 },
    focus: { sx: 1.05, sy: 0.82 },
    worried: { sx: 1.1, sy: 0.72, tilt: -0.6, eyeY: -0.01 },
  };
  const expr = n => ({ ...BASE, ...(EX[n] || {}) });
  const cur = expr('neutral');
  let override = null, overrideUntil = 0, moodExpr = 'neutral', talking = false;
  function setExpr(name, dur = 1.4) { override = name; overrideUntil = T + dur; }

  // ---------- acciones ----------
  const ACT0 = { x: 0, y: 0, rx: 0, ry: 0, rz: 0, sy: 1, sxw: 1, hl: 0, hr: 0, hlx: 0, hrx: 0 };
  const ACTIONS = {
    split: { dur: 0.95, f: p => ({ sxw: 1 + 0.32 * bump(p, 0, 0.45) - 0.08 * bump(p, 0.45, 0.75), sy: 1 - 0.14 * bump(p, 0, 0.45) + 0.06 * bump(p, 0.45, 0.75), rz: Math.sin(p * Math.PI * 4) * 0.05 * (1 - p) }) },
    jump: { dur: 0.8, f: p => ({ y: Math.max(0, Math.sin(Math.PI * clamp((p - 0.15) / 0.7))) * 0.9, sy: 1 - 0.2 * bump(p, 0, 0.15) + 0.12 * bump(p, 0.15, 0.4) - 0.18 * bump(p, 0.85, 1), hl: 0.3 * bump(p, 0.1, 0.9), hr: 0.3 * bump(p, 0.1, 0.9) }) },
    hop: { dur: 0.5, f: p => ({ y: Math.sin(Math.PI * clamp((p - 0.1) / 0.8)) * 0.35, sy: 1 - 0.12 * bump(p, 0, 0.1) - 0.1 * bump(p, 0.9, 1) }) },
    spin: { dur: 1.0, f: p => ({ ry: ease(p) * Math.PI * 2, y: Math.sin(Math.PI * p) * 0.3, hl: 0.15 * bump(p, 0, 1), hr: 0.15 * bump(p, 0, 1) }) },
    backflip: { dur: 1.15, f: p => { const k = clamp((p - 0.15) / 0.7); return { y: Math.sin(Math.PI * k) * 1.2, rx: -ease(k) * Math.PI * 2, sy: 1 - 0.22 * bump(p, 0, 0.15) - 0.2 * bump(p, 0.85, 1) }; } },
    wave: { dur: 1.7, f: (p, t) => { const up = ease(clamp(p / 0.15)) * ease(clamp((1 - p) / 0.15)); return { hr: 0.85 * up, hrx: Math.sin(t * 14) * 0.1 * up, rz: -0.08 * up }; } },
    dance: { dur: 3.4, f: (p, t) => { const e = ease(clamp(p / 0.1)) * ease(clamp((1 - p) / 0.1)); return { y: Math.abs(Math.sin(t * Math.PI * 2.4)) * 0.28 * e, rz: Math.sin(t * Math.PI * 2.4) * 0.2 * e, ry: Math.sin(t * Math.PI * 1.2) * 0.5 * e, hl: (0.4 + 0.4 * Math.sin(t * 15)) * e, hr: (0.4 - 0.4 * Math.sin(t * 15)) * e }; } },
    nod: { dur: 0.7, f: p => ({ rx: Math.sin(p * Math.PI * 4) * 0.18 * (1 - p) }) },
    shake: { dur: 0.9, f: p => ({ ry: Math.sin(p * Math.PI * 6) * 0.35 * (1 - p), hl: 0.1, hr: 0.1 }) },
    wobble: { dur: 2.0, f: (p, t) => ({ rz: Math.sin(t * 7) * 0.2 * (1 - p), rx: Math.cos(t * 7) * 0.12 * (1 - p), x: Math.sin(t * 7) * 0.08 * (1 - p) }) },
    giggle: { dur: 0.9, f: (p, t) => ({ rz: Math.sin(t * 30) * 0.05 * (1 - p), sy: 1 + Math.sin(t * 30) * 0.03 * (1 - p), y: bump(p, 0, 1) * 0.08 }) },
    squish: { dur: 0.35, f: p => ({ sy: 1 - 0.18 * bump(p, 0, 1) }) },
    recoil: { dur: 0.9, f: p => ({ rx: -0.28 * bump(p, 0, 1), y: 0.15 * bump(p, 0, 0.5), hl: 0.35 * bump(p, 0, 1), hr: 0.35 * bump(p, 0, 1) }) },
    scratch: { dur: 1.8, f: (p, t) => { const up = ease(clamp(p / 0.2)) * ease(clamp((1 - p) / 0.2)); return { hr: 1.25 * up, hrx: (-0.55 + Math.sin(t * 18) * 0.06) * up, rz: 0.12 * up }; } },
  };
  let action = null;
  function play(name) { if (ACTIONS[name]) action = { name, t: 0, ...ACTIONS[name] }; }

  // ---------- derretirse / volver ----------
  const DROP_S = 0.34, DROP_B = 1.14;
  let side = opts.side === -1 ? -1 : 1;
  const dropX = () => 1.25 * side;
  const restY = (s, sy) => GROUND + DROP_B * s * sy;
  function dropAnim(t) {
    const o = { face: 1 - ease(clamp(t / 0.28)), morph: ease(clamp((t - 0.22) / 0.38)), x: 0, y: 0, s: 1, sy: 1, ripple: -1 };
    if (t < 0.3) o.sy = 1 - 0.16 * Math.sin(Math.PI * t / 0.3);
    if (t >= 0.3 && t < 0.62) { const k = (t - 0.3) / 0.32; o.y = 0.3 * easeOut(k); o.sy = 1 + 0.14 * Math.sin(Math.PI * k); }
    if (t >= 0.62) { const k = clamp((t - 0.62) / 0.42); o.s = lerp(1, DROP_S, easeOut(k)); o.x = dropX() * ease(k); o.sy = 1 + 0.22 * k; o.y = lerp(0.3, restY(o.s, o.sy), k * k); }
    if (t >= 1.04) { const k = clamp((t - 1.04) / 0.7); o.s = DROP_S; o.x = dropX(); o.sy = 1 - 0.42 * Math.exp(-5 * k) * Math.cos(k * 16); o.y = restY(o.s, o.sy); o.ripple = k; }
    return o;
  }
  function riseAnim(t) {
    const o = { face: ease(clamp((t - 0.6) / 0.35)), morph: 1 - ease(clamp((t - 0.38) / 0.4)), x: dropX(), y: 0, s: DROP_S, sy: 1, ripple: -1 };
    if (t < 0.22) { o.sy = 1 - 0.35 * Math.sin(Math.PI * 0.5 * t / 0.22); o.y = restY(o.s, o.sy); }
    else if (t < 0.67) { const k = (t - 0.22) / 0.45; o.s = lerp(DROP_S, 1, easeOut(k)); o.x = lerp(dropX(), 0, easeOut(k)); o.sy = lerp(0.65, 1, Math.min(1, k * 4)) + 0.25 * Math.sin(Math.PI * k); o.y = lerp(restY(DROP_S, 0.65), 0, easeOut(k)) + Math.sin(Math.PI * k) * 0.5; }
    else { const k = clamp((t - 0.67) / 0.48); o.s = 1; o.x = 0; o.sy = 1 + 0.18 * Math.exp(-5 * k) * Math.sin(k * 14); }
    return o;
  }

  // ---------- estado ----------
  let T = 0, mode = 'awake', modeT = 0;
  let hover = false, petting = false, down = null, pressTimer = null;
  let dragRY = 0, spinVel = 0, spinTotal = 0;
  let lastActive = 0, lastClick = -9, clicks = [], lastStartle = -9, lastHop = -9, lastMouseT = -9;
  let nextBlink = 2, blinkT = -1, talkUntil = 0, splashT0 = -1, nextZ = 0;
  let watchIdx = 0, nextWatch = 0, highlightId = null, hoverAgent = null, appBusy = false;
  const look = { rx: 0, ry: 0, gx: 0, gy: 0 };
  const mouse = { x: innerWidth, y: innerHeight, t: performance.now() };
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  function setMode(m) { mode = m; modeT = 0; onModeChange(m); }
  const isLive = () => mode === 'awake' || mode === 'sleep';

  // ---------- sesiones (gotas que esperan detrás) ----------
  const miniBodyGeo = new THREE.SphereGeometry(1, 48, 32);
  let activeId = opts.sessionId ?? 1;
  const minis = new Map(); // id de sesión -> gota pequeña
  const merging = [];
  const busyOf = new Map(); // id de sesión -> tiene ayudantes trabajando
  const bubbles = new Map(); // id de sesión -> globo de aviso
  let swap = null, handK = 1;

  function makeMini(hex) {
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(hex), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: eyeHex(hex), roughness: 0.25 });
    const b = new THREE.Mesh(miniBodyGeo, mat); g.add(b);
    const mEyes = [-1, 1].map(sg => {
      const e = new THREE.Mesh(gPill, eyeMat), x = 0.3 * sg, y = 0.02, z = Math.sqrt(1 - x * x - y * y);
      e.position.set(x, y, z + 0.008); e.rotation.set(-Math.atan2(y, z), Math.atan2(x, z), 0); e.scale.z = 0.35; g.add(e); return e;
    });
    scene.add(g);
    return { g, mat, eyeMat, b, eyes: mEyes, vis: 1, blinkT: -1, nextBlink: T + 1 + Math.random() * 3, jumpT: -1, anim: null, slot: SLOTS[0], color: hex, pending: false };
  }
  function setMiniColor(mv, hex) { mv.color = hex; mv.mat.color.set(hex); mv.eyeMat.color.set(eyeHex(hex)); }
  function layoutSlots() { let i = 0; for (const [id, mv] of minis) { mv.slot = SLOTS[i++] || SLOTS[SLOTS.length - 1]; mv.b.userData.sessionId = id; } }

  function addSession(id, hex) {
    if (minis.size >= SLOTS.length || swap) return false;
    if (mode === 'sleep') wake(true);
    if (mode !== 'awake') return false;
    const mv = makeMini(activeColor);
    mv.anim = { type: 'split', t: 0, from: new THREE.Color(activeColor), to: hex };
    mv.color = hex;
    minis.set(id, mv);
    layoutSlots();
    action = null; play('split'); setExpr('joy', 1.2);
    return true;
  }
  function switchTo(id) {
    const mv = minis.get(id);
    if (!mv || swap || mv.anim) return false;
    if (mode === 'sleep') wake(true);
    if (mode !== 'awake') return false;
    action = null; petting = false;
    swap = { id, mv, t: 0, slot: mv.slot };
    return true;
  }
  function finishSwap() {
    const { id, mv, slot } = swap; swap = null;
    const prevId = activeId, prevColor = activeColor, nextColor = mv.color;
    const entries = [...minis].map(([k, v]) => (k === id ? [prevId, mv] : [k, v]));
    minis.clear(); entries.forEach(([k, v]) => minis.set(k, v));
    mv.anim = null; mv.vis = 1; mv.pending = false;
    setMiniColor(mv, prevColor);
    mv.g.position.set(slot[0], slot[1], slot[2]); mv.g.scale.setScalar(slot[3]);
    activeId = id; activeColor = nextColor;
    bodyColor.set(nextColor); targetColor.set(nextColor);
    clearFlag(id);
    layoutSlots();
    play('hop');
    onSwitched(id, prevId);
  }
  function closeSession(id) {
    const mv = minis.get(id);
    if (!mv || (swap && swap.id === id)) return false;
    minis.delete(id);
    clearFlag(id);
    clearAgents(id);
    mv.anim = { type: 'merge', t: 0 };
    merging.push(mv);
    layoutSlots();
    return true;
  }
  function flagSession(id, text, kind = 'done') {
    const mv = minis.get(id);
    if (mv) { mv.pending = true; mv.jumpT = 0; }
    let el = bubbles.get(id);
    if (!el) {
      el = document.createElement('button');
      el.onclick = () => onMiniClick(id);
      host.parentElement.append(el);
      bubbles.set(id, el);
    }
    el.className = 'minib hit ' + kind;
    el.innerHTML = '<span class="dot"></span><span class="txt"></span>';
    el.querySelector('.dot').style.background = mv ? mv.color : activeColor;
    el.querySelector('.txt').textContent = text;
  }
  function clearFlag(id) {
    const el = bubbles.get(id);
    if (el) { el.remove(); bubbles.delete(id); }
    const mv = minis.get(id);
    if (mv) mv.pending = false;
  }

  // ---------- ayudantes (mini-gotas que orbitan) ----------
  const gMini = new THREE.SphereGeometry(0.13, 32, 20), gRingFx = new THREE.RingGeometry(0.9, 1, 48);
  const GRAY = new THREE.Color('#9a979f');
  const agents = [];
  function spawnAgent(id, hex, sid = activeId) {
    const base = new THREE.Color(hex);
    const mat = new THREE.MeshPhysicalMaterial({ color: base.clone(), roughness: 0.25, clearcoat: 0.8, emissive: base.clone(), emissiveIntensity: 0 });
    const m = new THREE.Mesh(gMini, mat); m.scale.setScalar(0.001); m.userData.agentId = id; scene.add(m);
    const rm = new THREE.MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(gRingFx, rm); ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
    agents.push({ id, sid, status: 'working', mat, m, ring, rm, born: T, endT: -1, vis: 0, pos: root.position.clone(), gone: false });
    busyOf.set(sid, true);
    if (sid === activeId) {
      if (mode === 'sleep') wake(true);
      if (mode === 'awake' && !action) play('squish');
    }
  }
  function finishAgent(id, ok = true) {
    const a = agents.find(x => x.id === id);
    if (!a || a.status !== 'working') return;
    a.status = ok ? 'done' : 'error'; a.endT = T;
    busyOf.set(a.sid, agents.some(x => x.sid === a.sid && x.status === 'working'));
    if (a.sid !== activeId) { removeAgent(a); return; }
    if (!ok && isLive()) { wake(true); setExpr('worried', 1.8); play('shake'); }
  }
  function removeAgent(a) { a.gone = true; scene.remove(a.m, a.ring); }
  function clearAgents(sid) {
    for (const a of agents) if (a.sid === sid && !a.gone) removeAgent(a);
    busyOf.set(sid, false);
  }

  // ---------- puntería del ratón ----------
  function setNdc(cx, cy) {
    const r = canvas.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return false;
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return true;
  }
  // Devuelve qué hay bajo el cursor: la gota, una sesión de atrás o un ayudante.
  function pickAt(cx, cy) {
    if (!setNdc(cx, cy)) return null;
    const targets = [body, ...hands];
    if (isLive() && !swap) {
      for (const mv of minis.values()) if (!mv.anim && mv.g.visible) targets.push(mv.b);
      for (const a of agents) if (!a.gone && a.m.visible) targets.push(a.m);
    }
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (hit.object.userData.sessionId !== undefined) return { type: 'mini', id: hit.object.userData.sessionId };
    if (hit.object.userData.agentId !== undefined) return { type: 'agent', id: hit.object.userData.agentId };
    return { type: 'body' };
  }
  function botScreen() { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 }; }

  function sleep() { if (mode !== 'awake') return; setMode('sleep'); action = null; override = null; }
  function wake(silent, poked) {
    lastActive = T;
    if (mode !== 'sleep') return;
    setMode('awake'); setExpr('surprised', 0.8); play(poked ? 'jump' : 'recoil');
    if (!silent) say(pick(['¡Ah! Estaba descansando los circuitos.', '¡Despierto! Bueno, casi.', '¿Eh? ¿Qué me perdí?']));
  }
  function minimize() {
    if (!isLive() || swap) return;
    action = null; override = null; petting = false; splashT0 = -1;
    setMode('minimizing');
  }
  function restore() { if (mode === 'minimized') setMode('restoring'); }

  function handleClick() {
    if (mode === 'minimized') return restore();
    if (mode === 'sleep') return wake(false, true);
    if (mode !== 'awake') return;
    const now = T; lastActive = now;
    clicks = clicks.filter(t => now - t < 2); clicks.push(now);
    if (clicks.length >= 6) { clicks = []; setExpr('angry', 2.2); play('shake'); say('¡Oye! Eso hace cosquillas.'); lastClick = now; return; }
    if (clicks.length === 4) { setExpr('dizzy', 2); play('wobble'); say('Todo da vueltas…'); lastClick = now; return; }
    if (override === 'dizzy' || override === 'angry') { play('squish'); lastClick = now; return; }
    if (now - lastClick < 0.3) { play('backflip'); setExpr('joy', 1.4); lastClick = now; return; }
    lastClick = now;
    play('hop');
    onClick();
  }
  function startPet() {
    if (mode !== 'awake' || !down || down.moved) return;
    petting = true; document.body.style.cursor = 'grabbing';
    play('giggle'); say('Mmm… qué rico.');
  }

  addEventListener('pointermove', e => {
    const now = performance.now(), dt = Math.max(1, now - mouse.t);
    const speed = Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) / dt * 1000;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = now; lastMouseT = T;
    const c = botScreen(), dist = Math.hypot(mouse.x - c.x, mouse.y - c.y);
    if (dist < 320) { if (mode === 'sleep' && dist < 160) wake(); lastActive = T; }
    if (mode === 'awake' && speed > 2600 && dist < 240 && T - lastStartle > 5 && !down) { lastStartle = T; play('recoil'); setExpr('surprised', 0.9); }
    if (down) {
      const dx = e.clientX - down.lx; down.lx = e.clientX;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 && !petting) { down.moved = true; clearTimeout(pressTimer); document.body.style.cursor = 'grabbing'; }
      if (down.moved && mode === 'awake') { dragRY += dx * 0.014; spinVel = dx * 0.014 / (dt / 1000); spinTotal += Math.abs(dx * 0.014); }
      return;
    }
    const p = pickAt(e.clientX, e.clientY);
    const h = !!p && p.type === 'body';
    if (h && !hover && mode === 'awake' && T - lastHop > 6 && !action) { lastHop = T; play('hop'); }
    hover = h;
    const ag = p && p.type === 'agent' ? p.id : null;
    if (ag !== hoverAgent) { hoverAgent = ag; highlightId = ag; onAgentHover(ag); }
    canvas.style.cursor = p ? 'pointer' : '';
  });
  canvas.addEventListener('pointerdown', e => {
    const p = pickAt(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    if (p.type === 'mini') { onMiniClick(p.id); return; }
    if (p.type === 'agent') { onAgentClick(p.id); return; }
    canvas.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, moved: false };
    spinTotal = 0; spinVel = 0;
    if (mode === 'awake') pressTimer = setTimeout(startPet, 550);
  });
  canvas.addEventListener('pointerup', () => {
    if (!down) return;
    clearTimeout(pressTimer);
    if (petting) { petting = false; setExpr('happy', 1.6); play('hop'); say('¡Gracias por los mimos!'); }
    else if (down.moved) {
      if (mode === 'awake') {
        if (spinTotal + Math.abs(spinVel) * 0.5 > Math.PI * 4) { setExpr('dizzy', 2.2); setTimeout(() => { play('wobble'); say('Uff… me mareé.'); }, 500); }
        else if (Math.abs(spinVel) > 6) { setExpr('joy', 1.2); say('¡Wiii!'); }
      }
    } else handleClick();
    down = null; document.body.style.cursor = '';
  });

  // ---------- color ----------
  function applyColors(dt) {
    bodyColor.lerp(targetColor, 1 - Math.exp(-10 * dt));
    mShell.color.copy(bodyColor);
    mFx.color.copy(bodyColor);
    const lum = 0.2126 * bodyColor.r + 0.7152 * bodyColor.g + 0.0722 * bodyColor.b;
    mGlow.color.set(lum > 0.3 ? 0x141416 : 0xffffff);
  }

  // ---------- bucle ----------
  const clock = new THREE.Clock();
  function applyFace(blink, fv) {
    face.visible = fv > 0.01; face.scale.setScalar(Math.max(0.001, fv));
    const setW = (o, w, sx = 1, sy = 1) => { o.visible = w > 0.01; o.scale.set(Math.max(0.001, w * sx), Math.max(0.001, w * sy), Math.max(0.001, w)); };
    for (const s of ['L', 'R']) {
      const e = eyes[s];
      const wk = s === 'L' ? cur.winkL : 0;
      setW(e.pill, cur.pill * (1 - wk), cur.sx, cur.sy * (1 - 0.92 * blink));
      e.pill.rotation.z = e.sg * cur.tilt * 0.42;
      setW(e.arc, Math.max(cur.arc, wk));
      setW(e.heart, cur.heart * (1 + 0.08 * Math.sin(T * 9)));
      setW(e.x, cur.x); e.x.rotation.z = T * 2.5 * e.sg;
      e.inner.position.set(look.gx * 0.04 + cur.lookUp * 0.04, -look.gy * 0.03 + cur.lookUp * 0.05 + cur.eyeY, 0);
    }
    mBlush.opacity = cur.blush * 0.7;
  }

  function miniFace(mv, dt, isBusy) {
    let b = 0;
    if (T > mv.nextBlink && mv.blinkT < 0) mv.blinkT = 0;
    if (mv.blinkT >= 0) { mv.blinkT += dt; b = bump(mv.blinkT, 0, 0.16); if (mv.blinkT > 0.16) { mv.blinkT = -1; mv.nextBlink = T + 2 + Math.random() * 4; } }
    const sy = (isBusy ? 0.72 : 1) * (1 - 0.92 * b);
    mv.eyes.forEach(e => e.scale.set(1, Math.max(0.05, sy), 0.35));
  }

  const _sp = new THREE.Vector3(), _st = new THREE.Vector3(), _sc = new THREE.Color(), _v = new THREE.Vector3();
  function updateSessions(dt, live) {
    const out = { x: 0, y: 0, z: 0, s: 1 };
    const visT = live ? 1 : mode === 'restoring' ? clamp((modeT - 0.8) / 0.3) : 0;
    if (swap) {
      swap.t += dt;
      const e = ease(clamp(swap.t / 0.65)), sl = swap.slot, arc = Math.sin(Math.PI * e) * 0.45;
      out.x = sl[0] * e; out.y = sl[1] * e + arc; out.z = sl[2] * e; out.s = lerp(1, sl[3], e);
      handK = 1 - clamp(e * 2);
      const mv = swap.mv;
      mv.g.position.set(sl[0] * (1 - e), sl[1] * (1 - e) + arc * 0.5, sl[2] * (1 - e));
      mv.g.scale.setScalar(lerp(sl[3], 1, e)); mv.g.rotation.set(0, 0, 0);
      miniFace(mv, dt, false);
      if (swap.t >= 0.65) { finishSwap(); out.x = out.y = out.z = 0; out.s = 1; }
    } else handK = lerp(handK, 1, 1 - Math.exp(-6 * dt));

    const list = [...[...minis].map(([id, mv]) => ({ id, mv })), ...merging.map(mv => ({ id: null, mv }))];
    for (const { id, mv } of list) {
      if (swap && swap.mv === mv) continue;
      mv.vis = lerp(mv.vis, visT, 1 - Math.exp(-8 * dt));
      const sl = mv.slot;
      _st.set(sl[0], sl[1] + Math.sin(T * 2 + sl[0] * 3) * 0.05, sl[2]);
      let sc = sl[3];
      const isBusy = id !== null && busyOf.get(id);
      if (mv.pending && mv.jumpT < 0 && T % 4 < dt) mv.jumpT = 0;
      if (mv.jumpT >= 0) { mv.jumpT += dt; _st.y += Math.abs(Math.sin(mv.jumpT * Math.PI / 0.45)) * 0.35; if (mv.jumpT > 0.9) mv.jumpT = -1; }
      if (mv.anim) {
        mv.anim.t += dt; const t = mv.anim.t;
        if (mv.anim.type === 'split') {
          const k = easeOut(clamp((t - 0.2) / 0.7));
          _sp.set(sl[0], sl[1], sl[2]).normalize().multiplyScalar(0.3);
          _st.lerpVectors(_sp, _st, k); sc = lerp(0.8, sl[3], k);
          mv.mat.color.copy(mv.anim.from).lerp(_sc.set(mv.anim.to), k);
          if (t > 0.9) { mv.anim = null; setMiniColor(mv, mv.color); }
        } else {
          const k = ease(clamp(t / 0.55));
          _st.lerp(_sp.set(root.position.x, root.position.y, 0.1), k); sc = lerp(sc, 0.25, k);
          if (t > 0.55) { scene.remove(mv.g); merging.splice(merging.indexOf(mv), 1); play('squish'); setExpr('happy', 0.8); continue; }
        }
        mv.g.position.copy(_st);
      } else mv.g.position.lerp(_st, 1 - Math.exp(-8 * dt));
      mv.g.scale.setScalar(Math.max(0.001, sc * mv.vis)); mv.g.visible = mv.vis > 0.01;
      mv.g.rotation.y = lerp(mv.g.rotation.y, look.ry * 0.8, 0.1);
      mv.g.rotation.x = lerp(mv.g.rotation.x, look.rx * 0.6, 0.1);
      mv.g.rotation.z = isBusy ? Math.sin(T * 5 + sl[0]) * 0.08 : lerp(mv.g.rotation.z, 0, 0.1);
      miniFace(mv, dt, isBusy);
    }

    // globos de aviso sobre las sesiones de atrás (o sobre la gota minimizada)
    const hostRect = host.getBoundingClientRect();
    let stack = 0;
    for (const [id, el] of bubbles) {
      const mv = minis.get(id);
      let p = null;
      if (mode === 'minimized' || mode === 'minimizing') p = _sp.set(dropX(), GROUND + 0.75, 0);
      else if (mv && mv.vis > 0.5 && !(swap && swap.mv === mv)) p = _sp.copy(mv.g.position).add(_st.set(0, mv.slot[3] * 1.15, 0));
      if (!p) { el.style.opacity = 0; el.style.pointerEvents = 'none'; continue; }
      p.project(camera);
      el.style.opacity = 1; el.style.pointerEvents = 'auto';
      // mantener el globo dentro de la pantalla
      const half = el.offsetWidth / 2 + 8;
      const pageX = clamp(hostRect.left + (p.x + 1) / 2 * W, half, innerWidth - half);
      const pageY = Math.max(el.offsetHeight + 8, hostRect.top + (1 - p.y) / 2 * H - (mode === 'minimized' ? stack++ * 34 : 0));
      el.style.left = (pageX - hostRect.left) + 'px';
      el.style.top = (pageY - hostRect.top) + 'px';
    }
    return out;
  }

  function updateAgents(dt, live) {
    const visT = live && !swap ? 1 : mode === 'restoring' ? clamp((modeT - 0.8) / 0.3) : 0;
    const mine = agents.filter(a => a.sid === activeId && !a.gone);
    const orbiting = mine.filter(a => a.status === 'working' || T - a.endT < (a.status === 'error' ? 1.6 : 0.3));
    const working = mine.filter(a => a.status === 'working');
    const center = root.position;
    for (const a of agents) {
      if (a.gone) continue;
      if (a.sid !== activeId) { a.m.visible = false; a.ring.visible = false; a.vis = 0; continue; }
      a.vis = lerp(a.vis, visT, 1 - Math.exp(-8 * dt));
      const idx = Math.max(0, orbiting.indexOf(a)), n = Math.max(1, orbiting.length);
      const ang = T * 1.3 + idx * Math.PI * 2 / n;
      _v.set(center.x + Math.cos(ang) * 1.5, center.y + 0.15 + Math.sin(ang) * 0.32 + Math.sin(T * 3 + a.id) * 0.05, Math.sin(ang) * 1.0);
      const e = easeOut(clamp((T - a.born) / 0.6));
      _v.lerpVectors(center, _v, e);
      let s = e;
      if (a.status === 'error') a.mat.color.lerp(GRAY, 1 - Math.exp(-6 * dt));
      if (a.status !== 'working') {
        const r = clamp((T - a.endT - (a.status === 'error' ? 1.6 : 0.3)) / 0.45);
        if (r > 0) { _v.lerpVectors(_v, center, ease(r)); s *= 1 - r; }
        if (r >= 1) { removeAgent(a); if (live && !action) play('squish'); continue; }
      }
      a.pos.lerp(_v, 1 - Math.exp(-10 * dt));
      if (e < 1 || a.status !== 'working') a.pos.copy(_v);
      const hl = highlightId === a.id ? 1.45 : 1;
      a.mat.emissiveIntensity = lerp(a.mat.emissiveIntensity, highlightId === a.id && a.status !== 'error' ? 0.45 : 0, 0.2);
      a.m.position.copy(a.pos);
      const sc = Math.max(0.001, s * a.vis * hl);
      a.m.scale.set(sc, sc * (1 + 0.07 * Math.sin(T * 8 + a.id)), sc);
      a.m.visible = sc > 0.01;
      // ondas alrededor de la gota minimizada, una por ayudante activo
      const wi = working.indexOf(a);
      if (mode === 'minimized' && a.status === 'working') {
        const ph = (T * 0.55 + wi / working.length) % 1;
        a.ring.visible = true; a.ring.position.set(dropX(), GROUND + 0.004 + wi * 0.0015, 0);
        const rs = 0.38 + ph * 0.85; a.ring.scale.set(rs, rs, 1); a.rm.opacity = (1 - ph) * 0.6;
      } else a.ring.visible = false;
    }
    for (let i = agents.length - 1; i >= 0; i--) if (agents[i].gone) agents.splice(i, 1);
    return working;
  }

  function update(dt) {
    T += dt; modeT += dt;
    applyColors(dt);

    let o;
    if (mode === 'minimizing') {
      o = dropAnim(modeT);
      if (o.ripple >= 0 && splashT0 < 0) {
        splashT0 = T;
        splash.forEach((m, i) => { const a = (i / splash.length) * Math.PI * 2 + Math.random() * 0.4; m.userData.v = new THREE.Vector3(Math.cos(a) * (1 + Math.random()), 2.2 + Math.random() * 1.6, Math.sin(a) * (0.6 + Math.random() * 0.6)); });
      }
      if (modeT > 1.74) setMode('minimized');
    } else if (mode === 'minimized') {
      const hov = hover ? 1.14 : 1;
      const hopP = (T % 5.5) / 5.5;
      const sy = 1 + 0.05 * Math.sin(T * 2.6) - 0.15 * bump(hopP, 0.9, 0.95) + 0.1 * bump(hopP, 0.95, 1);
      o = { face: 0, morph: 1, x: dropX(), s: DROP_S * hov, sy, ripple: -1 };
      o.y = restY(o.s, o.sy) + Math.max(0, Math.sin(Math.PI * clamp((hopP - 0.95) / 0.05))) * 0.25;
    } else if (mode === 'restoring') {
      o = riseAnim(modeT);
      if (modeT > 1.15) { setMode('awake'); lastActive = T; play('wave'); setExpr('happy', 1.6); say('¡Volví!'); }
    } else {
      o = { face: 1, morph: 0, x: 0, y: 0, s: 1, sy: 1, ripple: -1 };
      if (mode === 'awake' && !appBusy && !busyOf.get(activeId) && !talking && !hover && !down && T - lastActive > SLEEP_AFTER) sleep();
    }
    const awake = mode === 'awake', asleep = mode === 'sleep', live = isLive();

    let a = { ...ACT0 };
    if (action && live) {
      action.t += dt; const p = clamp(action.t / action.dur);
      a = { ...a, ...action.f(p, action.t) };
      if (p >= 1) action = null;
    }
    if (petting) { a.rz += Math.sin(T * 6) * 0.07; a.sy *= 1 - 0.06 * (0.5 + 0.5 * Math.sin(T * 6)); }

    if (!down) {
      dragRY += spinVel * dt; spinVel *= Math.exp(-3 * dt);
      if (Math.abs(spinVel) < 0.6) { const tgt = Math.round(dragRY / (Math.PI * 2)) * Math.PI * 2; dragRY = lerp(dragRY, tgt, 1 - Math.exp(-6 * dt)); }
    }

    const sw = updateSessions(dt, live);
    const working = updateAgents(dt, live);

    // mirar al cursor; si hay ayudantes trabajando y el ratón está quieto, los vigila
    const c = botScreen();
    let tx = clamp((mouse.x - c.x) / (innerWidth * 0.5), -1, 1), ty = clamp((mouse.y - c.y) / (innerHeight * 0.5), -1, 1);
    if (!awake || petting) { tx = 0; ty = asleep ? 0.6 : 0; }
    else if (moodExpr === 'thinking') { tx = 0.3 * side; ty = -0.9; }
    else if (working.length && !down && T - lastMouseT > 1.2) {
      if (T > nextWatch) { watchIdx++; nextWatch = T + 1 + Math.random() * 0.7; }
      const w = working[watchIdx % working.length];
      tx = clamp((w.pos.x - root.position.x) / 1.3, -1, 1); ty = clamp(-(w.pos.y - root.position.y) / 0.8, -1, 1) * 0.7;
    }
    const lk = 1 - Math.exp(-5 * dt);
    look.ry = lerp(look.ry, tx * 0.6, lk); look.rx = lerp(look.rx, ty * 0.35, lk);
    look.gx = lerp(look.gx, tx, lk * 1.6); look.gy = lerp(look.gy, -ty, lk * 1.6);

    if (override && T > overrideUntil) override = null;
    let base = moodExpr;
    if (base === 'neutral' && working.length) base = 'focus';
    if (base === 'neutral' && hover && awake) base = 'curious';
    const target = expr(asleep ? 'sleepy' : petting ? 'love' : override || base);
    const ek = 1 - Math.exp(-14 * dt);
    for (const k in target) cur[k] = lerp(cur[k], target[k], ek);

    let blink = 0;
    if (awake && T > nextBlink && blinkT < 0) blinkT = 0;
    if (blinkT >= 0) { blinkT += dt; blink = bump(blinkT, 0, 0.16); if (blinkT > 0.16) { blinkT = -1; nextBlink = T + 1.8 + Math.random() * 3.5; if (Math.random() < 0.2) nextBlink = T + 0.25; } }

    const bob = asleep ? Math.sin(T * 1.2) * 0.03 : Math.sin(T * 2) * 0.06;
    const breath = asleep ? 1 + Math.sin(T * 1.2) * 0.025 : 1 + Math.sin(T * 2 + 0.6) * 0.012;
    // sin boca: al hablar, rebota un poco
    const talkBob = (talking || T < talkUntil) && awake ? Math.abs(Math.sin(T * 11)) * 0.05 : 0;
    const thinkSway = awake && moodExpr === 'thinking' ? Math.sin(T * 2) * 0.06 : 0;

    setMorph(o.morph);
    root.position.set(o.x + a.x + sw.x, o.y + a.y + (bob + talkBob) * o.face + sw.y, sw.z);
    bot.rotation.set(look.rx + a.rx + (asleep ? 0.12 : 0), look.ry + a.ry + dragRY, a.rz + thinkSway + (asleep ? Math.sin(T * 0.6) * 0.05 : 0));
    const sy = o.sy * a.sy * breath, sxz = 1 / Math.sqrt(sy);
    bot.scale.set(o.s * sxz * a.sxw * sw.s, o.s * sy * sw.s, o.s * sxz * sw.s);
    applyFace(blink, o.face);

    const hw = o.face;
    hands.forEach((h, i) => {
      const sg = i ? 1 : -1;
      const up = i ? a.hr : a.hl, dx = i ? a.hrx : a.hlx;
      h.visible = hw * handK > 0.01; h.scale.setScalar(Math.max(0.001, hw * handK));
      h.position.set(lerp(0.5, 1.13, hw) * sg + dx, -0.42 + up + Math.sin(T * 2 + i * 1.3) * 0.04, 0.2);
    });
    // suelo
    const bottom = root.position.y - (o.morph > 0.5 ? DROP_B : 1) * o.s * o.sy;
    const h = Math.max(0, bottom - GROUND);
    shadow.position.x = root.position.x;
    const ss = o.s * (o.morph > 0.5 ? 0.75 : 1) * (1.05 - Math.min(0.5, h * 0.3));
    shadow.scale.set(ss, ss, 1);
    shadow.material.opacity = clamp(1 - h * 0.35, 0.25, 1);
    if (o.ripple >= 0 && o.ripple < 1) {
      ripple.visible = true; ripple.position.set(o.x, GROUND + 0.003, 0);
      const rs = 0.25 + easeOut(o.ripple) * 1.1; ripple.scale.set(rs, rs, 1); mFx.opacity = (1 - o.ripple) * 0.55;
    } else ripple.visible = false;
    if (splashT0 >= 0) {
      const st = T - splashT0, life = 0.6;
      splash.forEach(m => {
        if (st > life) { m.visible = false; return; }
        m.visible = true;
        const v = m.userData.v;
        m.position.set(dropX() + v.x * st * 0.6 * side, GROUND + 0.05 + (v.y * st - 9.8 * st * st) * 0.45, v.z * st * 0.6);
        m.scale.setScalar(Math.max(0.001, (1 - st / life) * 1.1));
      });
      if (st > life) splashT0 = -1;
    }

    // zzz
    if (asleep && T > nextZ && opts.zzzHost) {
      nextZ = T + 1.3;
      const s = document.createElement('span'); s.textContent = 'z';
      s.style.left = (55 + Math.random() * 8) + '%'; s.style.top = (22 + Math.random() * 6) + '%'; s.style.fontSize = (14 + Math.random() * 8) + 'px';
      opts.zzzHost.appendChild(s); setTimeout(() => s.remove(), 2500);
    }
  }

  (function tick() {
    update(clamp(clock.getDelta(), 1e-3, 0.05));
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  })();

  return {
    hitTest: (x, y) => !!pickAt(x, y),
    isDragging: () => !!down,
    isMinimized: () => mode === 'minimized' || mode === 'minimizing',
    isSwapping: () => !!swap,
    setColor: hex => { activeColor = hex; targetColor.set(hex); },
    setSide: s => { side = s === -1 ? -1 : 1; },
    setBusy: b => { appBusy = !!b; if (appBusy) wake(true); },
    setMood: m => { talking = m === 'talking'; moodExpr = MOOD_EXPR[m] || 'neutral'; if (m !== 'neutral') wake(true); },
    react: (name, ms = 1400) => setExpr(name, ms / 1000),
    act: play,
    talk: chars => { talkUntil = T + Math.min(2.2, 0.5 + chars * 0.035); },
    wake: () => wake(true),
    minimize,
    restore,
    // sesiones
    addSession, switchTo, closeSession, flagSession, clearFlag,
    // ayudantes
    spawnAgent, finishAgent, clearAgents,
    highlightAgent: id => { highlightId = id; },
  };
}
