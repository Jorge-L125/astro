const fs = require('fs');
const os = require('os');
const path = require('path');

// Busca un ejecutable en el PATH como lo haría Windows (probando cada extensión de PATHEXT).
function whichWin(name, env) {
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const dirs = (env.PATH || env.Path || '').split(path.win32.delimiter).filter(Boolean);
  const candidates = path.win32.extname(name) ? [name] : exts.map(e => name + e.toLowerCase());
  for (const dir of dirs) {
    for (const c of candidates) {
      const full = path.win32.join(dir, c);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

// Dónde suele instalarse Claude Code en macOS y Linux. Una app abierta desde el Finder no hereda
// el PATH de la terminal, así que no basta con buscar en el PATH.
const posixDirs = home => [
  path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
  path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'),
];
function whichPosix(name, env, home) {
  const dirs = [...(env.PATH || '').split(path.delimiter).filter(Boolean), ...posixDirs(home)];
  for (const dir of dirs) {
    const full = path.join(dir, name);
    try { if (fs.statSync(full).isFile()) return full; } catch { /* no está aquí */ }
  }
  return null;
}

// Los shims .cmd de npm terminan llamando a `node "%dp0%\...\cli.js"`; extrae esa ruta.
function scriptFromShim(shimPath) {
  let text;
  try { text = fs.readFileSync(shimPath, 'utf8'); } catch { return null; }
  const m = /"%~?dp0%?\\?([^"%]+?\.(?:c|m)?js)"/i.exec(text);
  if (!m) return null;
  const script = path.win32.join(path.win32.dirname(shimPath), m[1]);
  return fs.existsSync(script) ? script : null;
}

/**
 * Decide cómo lanzar Claude Code sin pasar por una shell (así los argumentos llegan intactos).
 * Devuelve { command, args, env }; en Windows un `claude.cmd` de npm se ejecuta con el Node
 * de Electron (ELECTRON_RUN_AS_NODE), porque Node ya no permite lanzar .cmd sin shell.
 */
function resolveClaude(bin = 'claude', { platform = process.platform, env = process.env, nodePath = process.execPath, home = os.homedir() } = {}) {
  const viaNode = script => ({ command: nodePath, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } });
  if (/\.(c|m)?js$/i.test(bin)) return viaNode(bin);
  if (platform !== 'win32') {
    const found = bin.includes('/') ? (fs.existsSync(bin) ? bin : null) : whichPosix(bin, env, home);
    if (!found) return { command: bin, args: [], env: {} };
    // npm instala `claude` como enlace a un cli.js con "#!/usr/bin/env node", y una app gráfica
    // puede no tener `node` en el PATH: entonces se ejecuta con el Node de Electron.
    let real = found;
    try { real = fs.realpathSync(found); } catch { /* se usa tal cual */ }
    return /\.(c|m)?js$/i.test(real) ? viaNode(real) : { command: found, args: [], env: {} };
  }
  const found = /[\\/]/.test(bin) ? (fs.existsSync(bin) ? bin : null) : whichWin(bin, env);
  if (!found) return { command: bin, args: [], env: {} };
  if (!/\.(cmd|bat)$/i.test(found)) return { command: found, args: [], env: {} };
  const script = scriptFromShim(found);
  if (!script) {
    const e = new Error(`No sé ejecutar ${found} sin una shell. Indica en "claudePath" la ruta a claude.exe o a su cli.js.`);
    e.code = 'not_found';
    throw e;
  }
  return viaNode(script);
}

module.exports = { resolveClaude, scriptFromShim, whichWin, whichPosix };
