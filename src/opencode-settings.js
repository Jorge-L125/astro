// Ajustes de OpenCode: dónde corre el servidor, equivalencia de carpetas, motor y modelo por defecto y
// el proveedor compatible con OpenAI. La contraseña del servidor y la clave del proveedor van cifradas
// con el almacén del sistema (safeStorage de Electron) y nunca se devuelven a la interfaz.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  defaultEngine: 'claude', // motor de las sesiones nuevas: 'claude' | 'opencode'
  defaultModel: 'opencode/big-pickle', // proveedor/modelo de OpenCode
  mode: 'local', // 'local' (Astro arranca `opencode serve` en este equipo) | 'remote' (un servidor que ya corre, p. ej. Docker)
  url: 'http://127.0.0.1:4096',
  pathMap: [], // [{ host, server }]
  openai: { name: '', baseURL: '', models: [] }, // proveedor compatible con OpenAI
};
const SECRETS = ['password', 'openaiKey'];

const isStr = v => typeof v === 'string';
function clean(input, prev) {
  const v = { ...prev };
  if (input.defaultEngine === 'claude' || input.defaultEngine === 'opencode') v.defaultEngine = input.defaultEngine;
  if (isStr(input.defaultModel) && /^[^/\s]+\/\S+$/.test(input.defaultModel.trim())) v.defaultModel = input.defaultModel.trim();
  if (input.mode === 'local' || input.mode === 'remote') v.mode = input.mode;
  if (isStr(input.url)) v.url = input.url.trim();
  if (Array.isArray(input.pathMap)) {
    v.pathMap = input.pathMap.filter(m => m && isStr(m.host) && isStr(m.server) && m.host.trim() && m.server.trim())
      .map(m => ({ host: m.host.trim(), server: m.server.trim() })).slice(0, 8);
  }
  if (input.openai && typeof input.openai === 'object') {
    const o = input.openai;
    v.openai = {
      name: isStr(o.name) ? o.name.trim().slice(0, 60) : prev.openai.name,
      baseURL: isStr(o.baseURL) ? o.baseURL.trim() : prev.openai.baseURL,
      models: Array.isArray(o.models) ? o.models.filter(isStr).map(s => s.trim()).filter(Boolean).slice(0, 20) : prev.openai.models,
    };
  }
  return v;
}

/** crypto: { available(), encrypt(text) → base64, decrypt(base64) → text } (safeStorage en la app). */
function createOpencodeSettings(dir, crypto) {
  const file = path.join(dir, 'opencode.json');
  let values = { ...DEFAULTS };
  const secrets = {}; // cifrados en base64
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    values = clean(saved, values);
    for (const k of SECRETS) if (isStr(saved.secrets && saved.secrets[k])) secrets[k] = saved.secrets[k];
  } catch { /* primera vez: valores por defecto */ }

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ ...values, secrets }, null, 2));
    } catch (e) { console.error('[astro] No pude guardar los ajustes de OpenCode:', e.message); }
  }
  const secret = k => { try { return secrets[k] ? crypto.decrypt(secrets[k]) : ''; } catch { return ''; } };

  return {
    /** Para la interfaz: sin secretos, solo si están puestos. */
    public: () => ({ ...values, hasPassword: !!secrets.password, hasOpenaiKey: !!secrets.openaiKey, canEncrypt: crypto.available() }),
    /** Para el servidor: con la contraseña ya descifrada. */
    server: () => ({ mode: values.mode, url: values.url, pathMap: values.pathMap, password: secret('password') }),
    openai: () => ({ ...values.openai, key: secret('openaiKey') }),
    get: () => ({ ...values }),
    /** Guarda lo que venga; un secreto vacío ('') lo borra y uno ausente lo deja como estaba. */
    set(input = {}) {
      values = clean(input, values);
      for (const k of SECRETS) {
        if (!isStr(input[k])) continue;
        if (!input[k]) delete secrets[k];
        else if (crypto.available()) secrets[k] = crypto.encrypt(input[k]);
      }
      save();
      return this.public();
    },
  };
}

module.exports = { createOpencodeSettings, OPENCODE_DEFAULTS: DEFAULTS };
