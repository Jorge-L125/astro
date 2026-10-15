// Diseños que se pueden dibujar dentro de Astro: un código HTML o SVG de una respuesta, o una imagen o
// página que Claude creó. Sin DOM: solo decide qué es y cómo se muestra.

/** 'svg' | 'html' | null según el código de una respuesta ({ lang, content }). */
export function designKind(code) {
  if (!code || typeof code.content !== 'string') return null;
  const lang = String(code.lang || '').toLowerCase();
  const head = code.content.trimStart().slice(0, 200).toLowerCase();
  if (lang === 'svg' || head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (lang === 'html' || lang === 'htm' || head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
  return null;
}

/** Imágenes y páginas que Claude crea o edita y que se pueden ver en Astro. */
export const isViewableFile = f => typeof f === 'string' && /\.(html?|svg|png|jpe?g|gif|webp)$/i.test(f);

/** Un SVG como dirección data: para una <img> (así sus scripts nunca se ejecutan). */
export function svgSrc(content) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content);
}

/**
 * HTML para el marco de vista previa: se dibuja sin scripts (el marco va aislado) y con un fondo
 * blanco por defecto, como en un navegador.
 */
export function htmlDoc(content) {
  const base = '<meta charset="utf-8"><style>html{background:#fff;color:#111}</style>';
  return /<head[^>]*>/i.test(content) ? content.replace(/<head[^>]*>/i, m => m + base) : base + content;
}
