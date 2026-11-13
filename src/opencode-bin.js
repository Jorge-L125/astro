// Dónde está OpenCode en este equipo (ver src/find-bin.js). Astro lo lanzaba por su nombre y dependía del PATH
// con el que se abrió: si OpenCode se instaló después de iniciar sesión, salía «"opencode" no se reconoce como
// un comando» solo a veces. Se busca en el PATH, en el PATH actual del registro y en las carpetas habituales.
const path = require('path');
const { findBin, parseRegPath, readWinPath } = require('./find-bin');

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

/** Cómo lanzar OpenCode: { command, shell, found } (ver `findBin`). */
function resolveOpencode(bin, opts = {}) {
  return findBin('opencode', bin, { ...opts, winDirs, posixDirs });
}

module.exports = { resolveOpencode, parseRegPath, readWinPath };
