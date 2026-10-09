// Actualizaciones automáticas desde las releases de GitHub (electron-updater), solo en Windows con la
// app instalada: en macOS haría falta firmar la app y en desarrollo no hay nada que actualizar.
// Descarga en segundo plano y avisa a la ventana; la persona decide cuándo reiniciar. Si no lo hace,
// electron-updater la instala al salir de Astro.
const FIRST_CHECK = 20 * 1000;
const EVERY = 6 * 60 * 60 * 1000;

function createUpdater({ updater, platform = process.platform, isPackaged, enabled = () => true, send, log = () => {},
  setTimeout: later = setTimeout, setInterval: every = setInterval }) {
  const active = platform === 'win32' && !!isPackaged;
  let manual = false, ready = null;

  async function check(byHand) {
    if (!active) return;
    if (!byHand && !enabled()) return;
    manual = !!byHand;
    try { await updater.checkForUpdates(); } catch (e) { onError(e); }
  }
  function onError(e) {
    log(`[astro] actualización: ${e && e.message}`);
    if (manual) send('astro:update', { error: (e && e.message) || 'error desconocido' });
    manual = false;
  }

  return {
    active,
    start() {
      if (!active) return;
      updater.on('update-downloaded', info => { ready = info.version; send('astro:update', { ready: true, version: info.version }); });
      updater.on('update-not-available', () => { if (manual) send('astro:update', { latest: true }); manual = false; });
      updater.on('update-available', info => log(`[astro] descargando la versión ${info.version}…`));
      updater.on('error', onError);
      later(() => check(false), FIRST_CHECK);
      every(() => check(false), EVERY);
    },
    checkNow: () => check(true),
    install() { if (ready) updater.quitAndInstall(true, true); },
  };
}

module.exports = { createUpdater };
