// Qué diseño lleva cada sesión: por carpeta de trabajo o el mismo siempre. Sin Three.js ni DOM.
export const OUTFIT_KEYS = ['none', 'santa', 'ghost', 'vampire', 'witch', 'party', 'cowboy', 'astro', 'hardhat',
  'phones', 'ninja', 'magic', 'pirate', 'detective', 'viking', 'chef'];
const isKey = k => typeof k === 'string' && OUTFIT_KEYS.includes(k);
const DEFAULTS = () => ({ mode: 'folder', always: 'none', byFolder: {} });

/** Clave estable de una carpeta: barras «/», sin barra final y, con letra de unidad, en minúsculas. */
export function folderKey(dir) {
  if (!dir) return null;
  let k = String(dir).replace(/\\/g, '/');
  if (k.length > 1) k = k.replace(/\/+$/, '');
  return /^[a-z]:/i.test(k) ? k.toLowerCase() : k;
}

export function outfitFor(prefs, dir) {
  const k = folderKey(dir);
  if (prefs.mode === 'always' || !k) return prefs.always;
  return prefs.byFolder[k] || 'none';
}

/** Elige un diseño: en «siempre el mismo» para todas; si no, para la carpeta. No muta. */
export function choose(prefs, dir, key) {
  if (!isKey(key)) return prefs;
  const k = folderKey(dir);
  if (prefs.mode === 'always' || !k) return { ...prefs, always: key };
  return { ...prefs, byFolder: { ...prefs.byFolder, [k]: key } };
}

/** Cambia de modo; al pasar a «siempre el mismo», todas toman el diseño actual. */
export function withMode(prefs, mode, current) {
  if (mode !== 'folder' && mode !== 'always') return prefs;
  return mode === 'always' ? { ...prefs, mode, always: isKey(current) ? current : prefs.always } : { ...prefs, mode };
}

/** raw: contenido de astro-outfits (o null); legacy: el antiguo astro-acc, que solo se migra la primera vez. */
export function loadOutfitPrefs(raw, legacy) {
  if (raw === null || raw === undefined) {
    const ok = isKey(legacy) && legacy !== 'none';
    return { prefs: { ...DEFAULTS(), always: ok ? legacy : 'none' }, legacy: ok ? legacy : null };
  }
  const prefs = DEFAULTS();
  try {
    const s = JSON.parse(raw);
    if (s.mode === 'folder' || s.mode === 'always') prefs.mode = s.mode;
    if (isKey(s.always)) prefs.always = s.always;
    for (const [k, v] of Object.entries(s.byFolder || {})) if (isKey(v)) prefs.byFolder[k] = v;
  } catch { /* dañado: valores por defecto */ }
  return { prefs, legacy: null };
}
export const saveOutfitPrefs = prefs => JSON.stringify(prefs);

// «ponte / vístete / disfrázate (de) … <traje>». Hace falta el verbo de vestir y nada que sugiera
// otra cosa ("ponte a revisar…").
const WEAR = /^(?:¡\s*)?(?:astro,?\s*)?(?:ponte|vístete|vistete|disfrázate|disfrazate|usa)\b/;
const OFF = /^(?:¡\s*)?(?:astro,?\s*)?(?:quítate|quitate)\s+(?:el|la|los|las)\s+(?:sombrero|gorro|casco|disfraz|traje|accesorio|audífonos|audifonos)\b/;
const WORDS = [
  ['astro', /astronauta|espacial/], ['hardhat', /casco de obra|obrero|constructor/], ['phones', /aud[ií]fonos|cascos de m[uú]sica/],
  ['ninja', /ninja/], ['magic', /mago/], ['pirate', /pirata/], ['detective', /detective/], ['viking', /vikingo/], ['chef', /chef|cocinero/],
  ['santa', /navidad|santa|pap[aá] noel/], ['ghost', /fantasma/], ['vampire', /vampiro/], ['witch', /bruja/], ['party', /fiesta|cumplea/],
  ['cowboy', /vaquero|cowboy/],
];
export function outfitRequest(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[!.?¿]+$/g, '');
  if (OFF.test(t)) return 'none';
  if (!WEAR.test(t)) return null;
  const rest = t.replace(WEAR, '').trim();
  if (/^a\s/.test(rest)) return null;
  if (rest.split(/\s+/).length > 6) return null; // una frase larga es una tarea, no un disfraz
  const hit = WORDS.find(([, re]) => re.test(rest));
  return hit ? hit[0] : null;
}

const SEASONS = [
  { key: 'ghost', month: 9, from: 15, to: 31, text: '¡Es temporada de sustos! ¿Me pongo la manta de fantasma?' },
  { key: 'santa', month: 11, from: 1, to: 31, text: 'Ya huele a Navidad. ¿Me pongo el gorro?' },
];
/** Diseño de temporada a sugerir hoy, o null. dismissed(id) dice si ya se rechazó ese año. */
export function seasonSuggestion(date, currentKey, dismissed) {
  if (currentKey !== 'none') return null;
  const m = date.getMonth(), d = date.getDate();
  const s = SEASONS.find(x => m === x.month && d >= x.from && d <= x.to);
  if (!s) return null;
  const id = `${date.getFullYear()}-${s.key}`;
  return dismissed(id) ? null : { id, key: s.key, text: s.text };
}
