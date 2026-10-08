// Localiza la carpeta donde el sistema guarda las capturas de pantalla.
// - Windows: es una "carpeta conocida" que puede estar movida (OneDrive, otra unidad…): se lee del registro.
// - macOS: Cmd+Shift+3/4/5 guardan en el Escritorio salvo que se cambie en la app Captura de pantalla
//   (preferencia com.apple.screencapture location).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SHELL_FOLDERS = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';
const SCREENSHOTS_GUID = '{B7BEDE81-DF94-4682-A7D8-57A52620B86F}';

const run = (cmd, args) => new Promise(resolve => {
  execFile(cmd, args, { windowsHide: true, timeout: 8000, encoding: 'utf8' }, (err, out) => resolve(err ? null : String(out).trim() || null));
});

function registryScreenshots() {
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; `
    + `$v=(Get-ItemProperty -LiteralPath '${SHELL_FOLDERS}' -ErrorAction SilentlyContinue).'${SCREENSHOTS_GUID}'; `
    + `if ($v) { [Environment]::ExpandEnvironmentVariables($v) }`;
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
}

async function macScreenshotLocation(home = os.homedir()) {
  const dir = await run('defaults', ['read', 'com.apple.screencapture', 'location']);
  return dir ? dir.replace(/^~(?=$|\/)/, home) : null;
}

const defaultQuery = platform =>
  platform === 'win32' ? registryScreenshots : platform === 'darwin' ? macScreenshotLocation : async () => null;

async function findScreenshotDir({ platform = process.platform, home, pictures, query = defaultQuery(platform), exists = fs.existsSync } = {}) {
  const candidates = [await query(home)];
  if (platform === 'darwin' && home) candidates.push(path.join(home, 'Desktop'));
  if (pictures) candidates.push(path.join(pictures, 'Screenshots'));
  if (home) candidates.push(path.join(home, 'Pictures', 'Screenshots'), path.join(home, 'Imágenes', 'Screenshots'));
  return candidates.find(d => d && exists(d)) || null;
}

// Nombres que pone macOS a las capturas según el idioma del sistema.
const MAC_NAMES = /^(screenshot|screen shot|captura de pantalla|bildschirmfoto|capture d.écran|schermata|schermafbeelding|captura de ecrã|スクリーンショット|截屏|屏幕快照|스크린샷)/i;

/**
 * ¿Este archivo es una captura? Los temporales ocultos nunca lo son. En macOS la carpeta suele ser
 * el Escritorio, donde caen muchos PNG que no son capturas: se mira el nombre.
 */
function isScreenshotName(name, platform = process.platform) {
  if (!name || name.startsWith('.')) return false;
  return platform === 'darwin' ? MAC_NAMES.test(name) : true;
}

module.exports = { findScreenshotDir, registryScreenshots, macScreenshotLocation, isScreenshotName };
