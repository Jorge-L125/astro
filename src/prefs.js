// Preferencias que se cambian desde la app (ajustes o bandeja) y se recuerdan entre arranques.
const fs = require('fs');
const path = require('path');

// display: 'auto' (aparece en la pantalla del cursor) o el id de una pantalla concreta.
const PREF_DEFAULTS = { alwaysOnTop: true, watchCaptures: true, display: 'auto' };

function createPrefs(dir) {
  const file = path.join(dir, 'prefs.json');
  let values = { ...PREF_DEFAULTS };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of Object.keys(PREF_DEFAULTS)) if (typeof saved[k] === typeof PREF_DEFAULTS[k]) values[k] = saved[k];
  } catch { /* primera vez o archivo dañado: valores por defecto */ }

  return {
    get: () => ({ ...values }),
    /** Cambia una preferencia conocida; devuelve false si la clave o el tipo no valen. */
    set(key, value) {
      if (!(key in PREF_DEFAULTS) || typeof value !== typeof PREF_DEFAULTS[key]) return false;
      values = { ...values, [key]: value };
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(values, null, 2));
      } catch (e) {
        console.error('[astro] No pude guardar las preferencias:', e.message);
      }
      return true;
    },
  };
}

module.exports = { createPrefs, PREF_DEFAULTS };
