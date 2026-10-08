// Archivo donde Astro, mientras está abierto, publica el puerto y el token de su servidor de avisos.
// Lo lee hooks/astro-notify.js, así el hook no necesita configuración propia.
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeDir = (env = process.env) => env.ASTRO_HOME || path.join(os.homedir(), '.astro');
const runtimeFile = (env = process.env) => path.join(runtimeDir(env), 'notify.json');

function writeRuntimeInfo(info, env = process.env) {
  fs.mkdirSync(runtimeDir(env), { recursive: true });
  fs.writeFileSync(runtimeFile(env), JSON.stringify(info), { mode: 0o600 });
}

function readRuntimeInfo(env = process.env) {
  try { return JSON.parse(fs.readFileSync(runtimeFile(env), 'utf8')); } catch { return null; }
}

// Solo borra el archivo si sigue siendo de este proceso.
function removeRuntimeInfo(pid = process.pid, env = process.env) {
  const info = readRuntimeInfo(env);
  if (info && info.pid === pid) {
    try { fs.unlinkSync(runtimeFile(env)); } catch { /* ya no está */ }
  }
}

module.exports = { runtimeFile, writeRuntimeInfo, readRuntimeInfo, removeRuntimeInfo };
