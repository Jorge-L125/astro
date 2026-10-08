// Markdown simple para las hojas y los ayudantes. Todo el texto se escapa antes de dar formato.
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

function mdBlock(b) {
  const L = b.split('\n');
  if (L.every(l => /^\s*[-*] /.test(l))) return '<ul>' + L.map(l => '<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>').join('') + '</ul>';
  if (L.every(l => /^\s*\d+[.)] /.test(l))) return '<ol>' + L.map(l => '<li>' + inline(l.replace(/^\s*\d+[.)] /, '')) + '</li>').join('') + '</ol>';
  if (/^#{1,4} /.test(b)) return '<h4>' + inline(b.replace(/^#+ /, '')) + '</h4>';
  return '<p>' + L.map(inline).join('<br>') + '</p>';
}

export function md(src) {
  return String(src || '').split('```').map((p, i) => {
    if (i % 2) { const nl = p.indexOf('\n'); return '<pre><code>' + esc((nl >= 0 ? p.slice(nl + 1) : p).replace(/\n$/, '')) + '</code></pre>'; }
    return p.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).map(mdBlock).join('');
  }).join('');
}

// Reparte "detail" en hojas de ~750 caracteres sin partir párrafos; el código va en su propia hoja.
export function buildSheets(data, maxLen = 750) {
  const sheets = [];
  const text = data.detail ? String(data.detail).split(/\n{2,}/) : [];
  let cur = [], len = 0;
  for (const p of text.map(s => s.trim()).filter(Boolean)) {
    if (len && len + p.length > maxLen) { sheets.push({ kind: 'text', text: cur.join('\n\n') }); cur = []; len = 0; }
    cur.push(p); len += p.length;
  }
  if (cur.length) sheets.push({ kind: 'text', text: cur.join('\n\n') });
  if (data.code && data.code.content) sheets.push({ kind: 'code', code: data.code });
  return sheets;
}
