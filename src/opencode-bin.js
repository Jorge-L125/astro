// Dónde está OpenCode en este equipo. Astro lo lanzaba por su nombre y dependía del PATH con el que
// se abrió: si OpenCode se instaló después de iniciar sesión (o Astro arrancó desde un acceso directo),
// ese PATH no lo tenía y salía «"opencode" no se reconoce como un comando» solo a veces.
// Se busca en el PATH de Astro, en el PATH actual del registro (Windows) y en las carpetas habituales.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Línea `Path  REG_EXPAND_SZ  valor` de `reg query`, con las variables (%USERPROFILE%…) expandidas.
function parseRegPath(text, env = process.env) {
  const m = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(String(text));
  if (!m) return '';
  return m[1].trim().replace(/%([^%]+)%/g, (all, name) => env[name] ?? env[name.toUpperCase()] ?? all);
}

/** PATH del usuario y del sistema tal como están ahora en el registro (puede ser más nuevo que el del proceso). */
function readWinPath(run = execFileSync, env = process.env) {
  const keys = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'];
  const out = [];
  for (const key of keys) {
    try { out.push(parseRegPath(run('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }), env)); } catch { /* sin registro */ }
  }
  return out.filter(Boolean).join(';');
}

const winDirs = (home, env) => [
  path.win32.join(home, '.opencode', 'bin'),
  path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'opencode', 'bin'),
  path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'npm'),
  path.win32.join(home, 'scoop', 'shims'),
  path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links'),
  path.win32.join(home, '.bun', 'bin'),
];
const posixDirs = home => [
  path.join(home, '.opencode', 'bin'), path.join(home, '.local', 'bin'),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
  path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'),
];

const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

/**
 * Cómo lanzar OpenCode: { command, shell, found }. Un .exe (o un binario en macOS/Linux) se lanza directamente;
 * un .cmd de npm necesita la consola (shell). Si no aparece por ningún lado, se devuelve el nombre sin más
 * (found: false) para que el sistema lo intente por su cuenta.
 */
function resolveOpencode(bin, { platform = process.platform, env = process.env, home = os.homedir(), freshPath = () => readWinPath(execFileSync, env) } = {}) {
  const win = platform === 'win32';
  const miss = { command: 'opencode', shell: win, found: false };
  const asResult = file => ({ command: file, shell: win && /\.(cmd|bat)$/i.test(file), found: true });

  // una ruta indicada a mano manda (si existe)
  if (bin && /[\\/]/.test(bin)) return isFile(bin) ? asResult(bin) : miss;
  const name = bin || 'opencode';

  if (!win) {
    const dirs = [...(env.PATH || '').split(path.delimiter), ...posixDirs(home)].filter(Boolean);
    for (const d of dirs) { const f = path.join(d, name); if (isFile(f)) return asResult(f); }
    return miss;
  }
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase());
  const names = path.win32.extname(name) ? [name] : exts.map(e => name + e);
  const look = dirs => {
    for (const d of dirs.filter(Boolean)) for (const n of names) { const f = path.win32.join(d, n); if (isFile(f)) return f; }
    return null;
  };
  const split = p => String(p || '').split(';');
  const found = look(split(env.PATH || env.Path))
    || look(winDirs(home, env))
    || look(split(freshPath()));
  return found ? asResult(found) : miss;
}

module.exports = { resolveOpencode, parseRegPath, readWinPath };
