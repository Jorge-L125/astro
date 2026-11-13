// Dónde está graphify en este equipo y cómo instalarlo si falta. Sin Electron: todo inyectable para probarlo.
// uv y pipx dejan sus programas en ~/.local/bin; con `pip install --user` caen en el Scripts de Python.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { findBin } = require('./find-bin');

const PACKAGE = 'graphifyy'; // con doble «y», es el nombre en PyPI
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

// Los Scripts de cada Python instalado para el usuario (%APPDATA%\Python\Python3xx\Scripts).
function pythonScripts(home, env) {
  const base = path.win32.join(env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'), 'Python');
  try { return fs.readdirSync(base).map(d => path.win32.join(base, d, 'Scripts')); } catch { return []; }
}
const winDirs = (home, env) => [path.win32.join(home, '.local', 'bin'), path.win32.join(home, '.cargo', 'bin'), ...pythonScripts(home, env)];
const posixDirs = home => [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(home, '.cargo', 'bin')];
const dirs = { winDirs, posixDirs };

/** Cómo lanzar graphify: { command, shell, found } (ver `findBin`). */
function resolveGraphify(bin, opts = {}) {
  return findBin('graphify', bin, { ...opts, ...dirs });
}

/** Ruta absoluta de uv y de pipx (null si no están). */
function detectInstallers(opts = {}) {
  const look = name => { const r = findBin(name, undefined, { ...opts, ...dirs }); return r.found ? r.command : null; };
  return { uv: look('uv'), pipx: look('pipx') };
}

/**
 * Qué se ofrece para instalar: uv, si no pipx; si no hay ninguno, solo el comando para copiar.
 * `text` es siempre el comando para copiar; `canRun` dice si Astro puede ejecutarlo.
 */
function installPlan({ uv, pipx } = {}) {
  if (uv) return { kind: 'uv', command: uv, args: ['tool', 'install', PACKAGE], text: `uv tool install ${PACKAGE}`, canRun: true };
  if (pipx) return { kind: 'pipx', command: pipx, args: ['install', PACKAGE], text: `pipx install ${PACKAGE}`, canRun: true };
  return { kind: 'pip', command: 'pip', args: ['install', PACKAGE], text: `pip install ${PACKAGE}`, canRun: false };
}

/** '0.9.105' a partir de «graphify 0.9.105». */
function parseVersion(text) {
  const m = /graphify\s+(\d+\.\d+\.\d+)/i.exec(String(text || ''));
  return m ? m[1] : null;
}
/** Versión con la que Astro lo probó (0.9.x). */
const isTestedVersion = v => /^0\.9\./.test(String(v || ''));

/**
 * Ejecuta el plan de instalación (solo con un clic del usuario). Nunca por una consola. Devuelve
 * { ok, code, tail } con el final de la salida; si se pasa de tiempo, cierra el árbol de procesos.
 */
function installGraphify({ plan, spawnImpl = spawn, killTree = c => c.kill(), timeoutMs = INSTALL_TIMEOUT_MS }) {
  if (!plan || !plan.canRun) return Promise.reject(new Error('Astro no puede instalar graphify aquí: copia el comando y ejecútalo tú.'));
  return new Promise(resolve => {
    let out = '', done = false, timer = null;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); resolve({ ...r, tail: (r.tail !== undefined ? r.tail : out).slice(-400) }); };
    let child;
    try { child = spawnImpl(plan.command, plan.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return finish({ ok: false, code: null, tail: e.message }); }
    const take = d => { out += d; };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('error', e => finish({ ok: false, code: null, tail: e.message }));
    child.on('close', code => finish({ ok: code === 0, code }));
    timer = setTimeout(() => { try { killTree(child); } catch { /* ya cerrado */ } finish({ ok: false, code: null, tail: 'tiempo agotado' }); }, timeoutMs);
    if (timer.unref) timer.unref();
  });
}

module.exports = { resolveGraphify, detectInstallers, installPlan, parseVersion, isTestedVersion, installGraphify };
