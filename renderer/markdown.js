// Markdown simple para las hojas y los ayudantes. Todo el texto se escapa antes de dar formato.
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// Tabla markdown: filas "| a | b |"; la fila de guiones separa la cabecera.
function mdTable(L) {
  const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
  const sep = L.findIndex(l => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-'));
  const head = sep > 0 ? L.slice(0, sep) : [];
  const body = sep >= 0 ? L.slice(sep + 1) : L;
  const row = (l, tag) => '<tr>' + cells(l).map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
  return '<div class="tbl"><table>' + (head.length ? '<thead>' + head.map(l => row(l, 'th')).join('') + '</thead>' : '')
    + '<tbody>' + body.map(l => row(l, 'td')).join('') + '</tbody></table></div>';
}

function mdBlock(b) {
  const L = b.split('\n');
  if (L.every(l => /^\s*\|.*\|\s*$/.test(l))) return mdTable(L);
  if (L.every(l => /^\s*[-*] /.test(l))) return '<ul>' + L.map(l => '<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>').join('') + '</ul>';
  if (L.every(l => /^\s*\d+[.)] /.test(l))) return '<ol>' + L.map(l => '<li>' + inline(l.replace(/^\s*\d+[.)] /, '')) + '</li>').join('') + '</ol>';
  if (/^#{1,4} /.test(b)) return '<h4>' + inline(b.replace(/^#+ /, '')) + '</h4>';
  return '<p>' + L.map(inline).join('<br>') + '</p>';
}

// Los títulos y las tablas forman su propio bloque aunque no haya una línea en blanco alrededor
// (la salida de comandos como /context los pone pegados).
const isRow = l => /^\s*\|.*\|\s*$/.test(l);
function separateBlocks(text) {
  const out = [];
  let prev = null;
  for (const l of text.split('\n')) {
    const kind = /^#{1,4} /.test(l) ? 'h' : isRow(l) ? 't' : 'p';
    if (prev && (kind !== prev || kind === 'h')) out.push('');
    out.push(l);
    prev = l.trim() ? kind : null;
  }
  return out.join('\n');
}

export function md(src) {
  return String(src || '').split('```').map((p, i) => {
    if (i % 2) { const nl = p.indexOf('\n'); return '<pre><code>' + esc((nl >= 0 ? p.slice(nl + 1) : p).replace(/\n$/, '')) + '</code></pre>'; }
    return separateBlocks(p).split(/\n{2,}/).map(s => s.trim()).filter(Boolean).map(mdBlock).join('');
  }).join('');
}

// Reparte "detail" en hojas de ~750 caracteres sin partir párrafos; el código va en su propia hoja.
// Bloques separados por líneas en blanco, sin partir nunca un bloque de código (```), que puede
// llevar líneas en blanco dentro.
export function mdChunks(text) {
  const chunks = [];
  let cur = [], fence = false;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    if (!fence && !line.trim()) { if (cur.length) chunks.push(cur.join('\n')); cur = []; continue; }
    cur.push(line);
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks.map(c => c.trim()).filter(Boolean);
}

// Texto corrido y sin símbolos de markdown, para el resumen de una nube. En las tablas, las celdas de
// una fila van separadas por «·» y las filas por «/».
export function previewText(text) {
  const lines = String(text || '').replace(/```[\s\S]*?(```|$)/g, '\n[código]\n').split('\n');
  let out = '', prevRow = false;
  for (const raw of lines) {
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(raw) && raw.includes('-') && raw.includes('|')) continue; // |---|---|
    const row = isRow(raw);
    const l = row
      ? raw.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean).join(' · ')
      : raw.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '').trim();
    if (!l) { prevRow = false; continue; }
    out += (out ? (row && prevRow ? ' / ' : ' ') : '') + l;
    prevRow = row;
  }
  return out
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSheets(data, maxLen = 750) {
  const sheets = [];
  const text = data.detail ? mdChunks(data.detail) : [];
  let cur = [], len = 0;
  for (const p of text) {
    if (len && len + p.length > maxLen) { sheets.push({ kind: 'text', text: cur.join('\n\n') }); cur = []; len = 0; }
    cur.push(p); len += p.length;
  }
  if (cur.length) sheets.push({ kind: 'text', text: cur.join('\n\n') });
  if (data.code && data.code.content) sheets.push({ kind: 'code', code: data.code });
  return sheets;
}
