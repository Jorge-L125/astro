const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Lado máximo que se manda a Claude: más grande no mejora la lectura y solo gasta tokens.
const MAX_EDGE = 1568;
// Límite de la API por imagen (5 MB en base64); por encima se usa JPEG.
const MAX_BYTES = 3.5 * 1024 * 1024;
// Cada cuánto se vuelve a leer una imagen que sigue en el portapapeles (se espacia si no cambia).
const FULL_READ_MIN = 2000, FULL_READ_MAX = 16000;

/**
 * Huella de una imagen: tamaño + miniatura de 16 px con los colores redondeados y sin alfa.
 * La misma captura llega igual por el archivo y por el portapapeles aunque cambie el canal alfa.
 */
function fingerprint(img) {
  const { width, height } = img.getSize();
  const bmp = img.resize({ width: 16, height: 16 }).toBitmap();
  const q = Buffer.alloc((bmp.length / 4) * 3);
  for (let i = 0, j = 0; i < bmp.length; i += 4) { q[j++] = bmp[i] >> 4; q[j++] = bmp[i + 1] >> 4; q[j++] = bmp[i + 2] >> 4; }
  return `${width}x${height}:` + crypto.createHash('sha1').update(q).digest('hex');
}

function fitEdge(img, max) {
  const { width, height } = img.getSize();
  const k = max / Math.max(width, height);
  return k >= 1 ? img : img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'best' });
}

// Bloque de imagen para la API a partir de una NativeImage.
function toImageBlock(img) {
  const fit = fitEdge(img, MAX_EDGE);
  let data = fit.toPNG(), media = 'image/png';
  if (data.length > MAX_BYTES) { data = fit.toJPEG(85); media = 'image/jpeg'; }
  return { type: 'image', source: { type: 'base64', media_type: media, data: data.toString('base64') } };
}

/**
 * Detecta capturas de pantalla nuevas por dos vías:
 * - la carpeta donde el sistema guarda las capturas (Win+Shift+S, Impr Pant, Cmd+Shift+3/4/5):
 *   avisa al instante y gratis;
 * - el portapapeles: se pregunta cada segundo si hay una imagen (barato) y solo se lee entera
 *   cuando aparece o, si sigue ahí, cada vez con menos frecuencia.
 * Las capturas viven solo en memoria: se mandan a Claude si el usuario pregunta sobre ellas y si no,
 * se descartan (a mano o al caducar).
 *
 * Fuentes inyectadas (así se prueba sin Electron):
 *   hasClipboardImage(): Promise<boolean>, readClipboardImage(): Promise<img|null>,
 *   loadImage(file): img|null, folder: carpeta de capturas o null,
 *   acceptName(nombre): si un archivo nuevo de la carpeta cuenta como captura.
 */
function createCaptureStore({
  hasClipboardImage, readClipboardImage, loadImage, folder = null, acceptName = n => !n.startsWith('.'), onCapture,
  intervalMs = 1000, ttlMs = 5 * 60 * 1000, max = 3, now = Date.now, watch = fs.watch,
}) {
  const items = new Map(); // id -> { img, at }
  const recent = []; // huellas ya vistas (ofrecidas o presentes al empezar)
  let lastOffer = { size: '', at: -Infinity };
  let timer = null, watcher = null, seq = 0, polling = false, generation = 0;
  let hadImage = false, nextFull = 0, backoff = FULL_READ_MIN;
  const pending = new Map(); // archivo -> temporizador (los archivos llegan en varias escrituras)

  const prune = () => {
    for (const [id, it] of items) if (now() - it.at > ttlMs) items.delete(id);
    while (items.size > max) items.delete(items.keys().next().value);
  };
  const remember = fp => { recent.push(fp); if (recent.length > 12) recent.shift(); };

  // Devuelve true si la imagen era nueva y se ofreció.
  function consider(img) {
    if (!img || img.isEmpty()) return false;
    const fp = fingerprint(img);
    if (recent.includes(fp)) return false;
    remember(fp);
    const { width, height } = img.getSize();
    // La misma captura puede llegar por las dos vías con píxeles casi iguales: mismo tamaño y casi a la vez = duplicada.
    const size = `${width}x${height}`;
    if (size === lastOffer.size && now() - lastOffer.at < 4000) return false;
    lastOffer = { size, at: now() };
    const id = `cap${++seq}`;
    items.set(id, { img, at: now() });
    prune();
    onCapture({ id, width, height, thumb: fitEdge(img, 360).toDataURL() });
    return true;
  }

  async function pollClipboard() {
    if (polling) return;
    polling = true;
    const gen = generation;
    try {
      if (!(await hasClipboardImage())) { hadImage = false; return; }
      if (hadImage && now() < nextFull) return;
      const t0 = now();
      const img = await readClipboardImage();
      if (gen !== generation) return; // se detuvo mientras leía
      const cost = now() - t0;
      const appeared = !hadImage;
      const fresh = consider(img);
      hadImage = true;
      backoff = fresh || appeared ? FULL_READ_MIN : Math.min(FULL_READ_MAX, backoff * 2);
      // Nunca más del ~2 % del tiempo leyendo el portapapeles.
      nextFull = now() + Math.max(backoff, cost * 50);
    } catch { /* portapapeles ocupado por otra app: se reintenta en el siguiente ciclo */ } finally {
      polling = false;
    }
  }

  function addFile(file) {
    if (!/\.(png|jpe?g)$/i.test(file) || !acceptName(path.basename(file))) return;
    clearTimeout(pending.get(file));
    pending.set(file, setTimeout(() => {
      pending.delete(file);
      try {
        // Solo archivos recién creados: mover o renombrar capturas viejas no cuenta.
        if (now() - fs.statSync(file).mtimeMs > 15000) return;
        consider(loadImage(file));
      } catch { /* el archivo desapareció o aún se estaba escribiendo */ }
    }, 400));
  }

  function watchFolder() {
    if (watcher) { watcher.close(); watcher = null; }
    if (!folder || !timer) return;
    try {
      watcher = watch(folder, (_ev, name) => name && addFile(path.join(folder, String(name))));
      watcher.on?.('error', () => { watcher = null; });
    } catch { watcher = null; }
  }

  return {
    get running() { return !!timer; },
    get size() { prune(); return items.size; },
    get folder() { return folder; },
    pollClipboard,
    addFile,
    /** Cambia la carpeta vigilada (se conoce tarde: hay que preguntarle al sistema). */
    setFolder(dir) { folder = dir || null; watchFolder(); },
    /** Empieza a vigilar; lo que ya esté en el portapapeles no cuenta como captura nueva. */
    async start() {
      if (timer) return;
      const gen = ++generation;
      timer = setInterval(pollClipboard, intervalMs);
      timer.unref?.();
      watchFolder();
      try {
        if (await hasClipboardImage()) {
          const img = await readClipboardImage();
          if (gen === generation && img && !img.isEmpty()) { remember(fingerprint(img)); hadImage = true; nextFull = now() + FULL_READ_MIN; }
        }
      } catch { /* sin portapapeles: no pasa nada */ }
    },
    stop() {
      generation++;
      clearInterval(timer); timer = null;
      if (watcher) { watcher.close(); watcher = null; }
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      items.clear();
      hadImage = false;
    },
    discard(id) { items.delete(id); },
    /** Saca la captura del almacén y devuelve su bloque de imagen, o null si ya no está. */
    take(id) {
      prune();
      const it = items.get(id);
      if (!it) return null;
      items.delete(id);
      return toImageBlock(it.img);
    },
  };
}

module.exports = { createCaptureStore, toImageBlock, fingerprint, MAX_EDGE };
