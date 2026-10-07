// Lanza Astro con Electron.
// - Quita ELECTRON_RUN_AS_NODE (la terminal de VS Code la define y hace que Electron actúe como Node).
// - Descarga el ejecutable de Electron si aún no está (Electron 44 ya no lo hace al instalar).
const { spawn, execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function electronPath() {
  try { return require('electron'); }
  catch {
    console.log('[astro] Descargando Electron (solo la primera vez)…');
    execFileSync(process.execPath, [require.resolve('electron/install.js')], { stdio: 'inherit' });
    delete require.cache[require.resolve('electron')];
    return require('electron');
  }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath(), ['.', ...process.argv.slice(2)], { cwd: ROOT, env, stdio: 'inherit' });
child.on('close', code => process.exit(code ?? 0));
