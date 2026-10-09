const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../renderer/outfits.js');
const P = (o = {}) => ({ mode: 'folder', always: 'none', byFolder: {}, ...o });

test('folderKey normaliza barras, barra final y mayúsculas de Windows', async () => {
  const { folderKey } = await load();
  assert.equal(folderKey('C:\\Proyectos\\Astro\\'), 'c:/proyectos/astro');
  assert.equal(folderKey('c:/proyectos/astro'), 'c:/proyectos/astro');
  assert.equal(folderKey('/home/ana/Web/'), '/home/ana/Web', 'fuera de Windows respeta mayúsculas');
  assert.equal(folderKey(null), null);
  assert.equal(folderKey(''), null);
});

test('por proyecto: cada carpeta su diseño; sin carpeta, el de siempre', async () => {
  const { outfitFor, choose } = await load();
  let p = choose(P(), 'C:\\a', 'pirate');
  p = choose(p, 'C:\\b', 'chef');
  assert.equal(outfitFor(p, 'c:/a/'), 'pirate');
  assert.equal(outfitFor(p, 'C:\\b'), 'chef');
  assert.equal(outfitFor(p, 'C:\\c'), 'none');
  assert.equal(outfitFor(P({ always: 'ghost' }), null), 'ghost');
});

test('dos sesiones en la misma carpeta comparten diseño; otra carpeta no cambia', async () => {
  const { outfitFor, choose } = await load();
  const p = choose(P({ byFolder: { 'c:/otra': 'viking' } }), 'C:\\x', 'ninja');
  assert.equal(outfitFor(p, 'C:\\x'), 'ninja');
  assert.equal(outfitFor(p, 'c:/x'), 'ninja');
  assert.equal(outfitFor(p, 'C:\\otra'), 'viking');
});

test('siempre el mismo: elegir cambia el de todas; al activarlo toma el actual', async () => {
  const { outfitFor, choose, withMode } = await load();
  let p = withMode(P({ byFolder: { 'c:/a': 'chef' } }), 'always', 'chef');
  assert.equal(outfitFor(p, 'C:\\b'), 'chef');
  p = choose(p, 'C:\\b', 'santa');
  assert.equal(outfitFor(p, 'C:\\a'), 'santa');
  assert.equal(p.byFolder['c:/a'], 'chef', 'lo de cada carpeta se conserva para cuando vuelvas');
  assert.equal(outfitFor(withMode(p, 'folder', 'santa'), 'C:\\a'), 'chef');
});

test('choose ignora claves desconocidas y no muta', async () => {
  const { choose } = await load();
  const p = P();
  assert.deepEqual(choose(p, 'C:\\a', 'dragon'), p);
  choose(p, 'C:\\a', 'chef');
  assert.deepEqual(p.byFolder, {});
});

test('loadOutfitPrefs migra el accesorio antiguo y tolera datos dañados', async () => {
  const { loadOutfitPrefs, saveOutfitPrefs } = await load();
  assert.deepEqual(loadOutfitPrefs(null, 'pirate'), { prefs: P({ always: 'pirate' }), legacy: 'pirate' });
  assert.deepEqual(loadOutfitPrefs(null, null), { prefs: P(), legacy: null });
  assert.deepEqual(loadOutfitPrefs(null, 'dragon'), { prefs: P(), legacy: null });
  assert.deepEqual(loadOutfitPrefs('{roto', 'pirate'), { prefs: P(), legacy: null }, 'si hay JSON, aunque esté roto, no se migra');
  const raw = JSON.stringify({ mode: 'always', always: 'chef', byFolder: { 'c:/a': 'ninja', 'c:/b': 'dragon', 'c:/c': 7 } });
  assert.deepEqual(loadOutfitPrefs(raw, 'pirate').prefs, P({ mode: 'always', always: 'chef', byFolder: { 'c:/a': 'ninja' } }));
  assert.deepEqual(loadOutfitPrefs(JSON.stringify({ mode: 'raro' }), null).prefs, P());
  const p = P({ byFolder: { 'c:/a': 'chef' } });
  assert.deepEqual(loadOutfitPrefs(saveOutfitPrefs(p), null).prefs, p);
});

test('outfitRequest reconoce «ponte…» y no se confunde con otras frases', async () => {
  const { outfitRequest } = await load();
  for (const [q, k] of [['Ponte el sombrero de pirata', 'pirate'], ['vístete de chef', 'chef'], ['¡disfrázate de fantasma!', 'ghost'],
    ['ponte el gorro de Navidad', 'santa'], ['ponte los audífonos', 'phones'], ['quítate el sombrero', 'none'],
    ['ponte el casco de astronauta', 'astro'], ['ponte el casco de obra', 'hardhat'], ['vístete de vikingo', 'viking'],
    ['ponte de detective', 'detective'], ['disfrázate de mago', 'magic'], ['ponte el traje ninja', 'ninja'],
    ['vístete de vampiro', 'vampire'], ['ponte el sombrero de bruja', 'witch'], ['ponte el gorro de fiesta', 'party'], ['ponte el sombrero de vaquero', 'cowboy']]) {
    assert.equal(outfitRequest(q), k, q);
  }
  for (const q of ['Haz un pirata en CSS', 'el detective de la novela usa lupa', 'ponte a revisar el chef.js', 'quítate de en medio', '']) {
    assert.equal(outfitRequest(q), null, q);
  }
});

test('seasonSuggestion: fantasma del 15 al 31 de octubre, Navidad en diciembre', async () => {
  const { seasonSuggestion } = await load();
  const never = () => false;
  assert.equal(seasonSuggestion(new Date(2026, 9, 14), 'none', never), null);
  assert.equal(seasonSuggestion(new Date(2026, 9, 15), 'none', never).key, 'ghost');
  assert.equal(seasonSuggestion(new Date(2026, 9, 20), 'none', never).id, '2026-ghost');
  assert.equal(seasonSuggestion(new Date(2026, 11, 3), 'none', never).key, 'santa');
  assert.equal(seasonSuggestion(new Date(2026, 11, 3), 'chef', never), null, 'ya lleva diseño');
  assert.equal(seasonSuggestion(new Date(2026, 11, 3), 'none', id => id === '2026-santa'), null, 'rechazada este año');
  assert.equal(seasonSuggestion(new Date(2026, 6, 1), 'none', never), null);
});
