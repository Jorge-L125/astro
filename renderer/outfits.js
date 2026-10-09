// Qué diseño lleva cada sesión: por carpeta de trabajo o el mismo siempre. Sin Three.js ni DOM.
export const OUTFIT_KEYS = ['none', 'santa', 'ghost', 'vampire', 'witch', 'party', 'cowboy', 'astro', 'hardhat',
  'phones', 'ninja', 'magic', 'pirate', 'detective', 'viking', 'chef', 'cat'];
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

// «ponte / vístete / disfrázate [el sombrero] [de] <traje>» y «quítate el sombrero». La frase entera tiene
// que ser eso: «usa ninja para compilar» o «ponte de acuerdo con el chef» son tareas y van a Claude.
const NAMES = {
  astronauta: 'astro', obra: 'hardhat', obrero: 'hardhat', 'audífonos': 'phones', audifonos: 'phones', ninja: 'ninja',
  mago: 'magic', pirata: 'pirate', detective: 'detective', vikingo: 'viking', chef: 'chef', cocinero: 'chef',
  navidad: 'santa', santa: 'santa', 'papá noel': 'santa', 'papa noel': 'santa', fantasma: 'ghost', vampiro: 'vampire',
  bruja: 'witch', fiesta: 'party', 'cumpleaños': 'party', vaquero: 'cowboy', cowboy: 'cowboy', gato: 'cat', gatito: 'cat', michi: 'cat',
};
const ART = '(?:(?:el|la|los|las|tu|tus|un|una)\\s+)?';
const GARMENT = '(?:sombrero|gorro|gorrito|casco|traje|disfraz|manta|capa|cascos|accesorio|audífonos|audifonos)';
const NAME = '(' + Object.keys(NAMES).sort((x, y) => y.length - x.length).join('|') + ')';
const LEAD = '^(?:astro,?\\s*)?';
const WEAR = new RegExp(LEAD + '(?:ponte|vístete|vistete|disfrázate|disfrazate)\\s+' + ART + '(?:' + GARMENT + '\\s+)?(?:de\\s+)?' + ART + NAME + '$');
const OFF = new RegExp(LEAD + '(?:quítate|quitate)\\s+' + ART + GARMENT + '(?:\\s+de\\s+' + ART + NAME + ')?$');
export function outfitRequest(text) {
  const t = String(text || '').trim().toLowerCase().replace(/^[¡¿]+/, '').replace(/[!.?]+$/, '').replace(/\s+/g, ' ');
  if (OFF.test(t)) return 'none';
  const m = WEAR.exec(t);
  return m ? NAMES[m[1]] : null;
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
