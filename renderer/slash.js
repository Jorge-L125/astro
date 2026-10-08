// Comandos / en el chat de Astro: reconocerlos, sugerirlos mientras se escriben y convertir su
// respuesta (texto libre de Claude Code) en nubes y hojas de Astro.

/** "/model haiku" → { name: 'model', args: 'haiku' }; cualquier otra cosa → null. */
export function parseSlash(text) {
  const m = /^\/([\w:.-]+)(?:\s+([\s\S]*))?$/.exec(String(text).trim());
  return m ? { name: m[1], args: (m[2] || '').trim() } : null;
}

/** Sugerencias mientras se escribe el nombre del comando (antes del primer espacio). */
export function suggest(list, text, max = 8) {
  const m = /^\/([\w:.-]*)$/.exec(text);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const starts = list.filter(c => c.name.toLowerCase().startsWith(q));
  // Para skills con prefijo ("anthropic-skills:pdf"), también vale lo que va tras los dos puntos.
  const inside = list.filter(c => !starts.includes(c) && c.name.toLowerCase().split(':').pop().startsWith(q));
  const contains = q ? list.filter(c => !starts.includes(c) && !inside.includes(c) && c.name.toLowerCase().includes(q)) : [];
  return [...starts, ...inside, ...contains].slice(0, max);
}

// Primera frase legible de un texto en markdown, para la nube.
function firstLine(text) {
  const line = String(text).split('\n')
    .map(l => l.replace(/^[#>\-*\d.)\s|]+/, '').replace(/[*`_|]/g, '').trim())
    .find(l => l.length > 2) || '';
  return line.length > 140 ? line.slice(0, 137) + '…' : line;
}

const DONE = {
  compact: 'Compacté la conversación: ahora ocupa menos contexto.',
  model: 'Modelo cambiado para esta sesión.',
  effort: 'Nivel de razonamiento cambiado.',
};

/** Respuesta de Astro para un comando cuya salida es texto libre (o vacía). */
export function commandReply(name, text) {
  const body = String(text || '').trim();
  const lines = [DONE[name] || firstLine(body) || `Listo: /${name}.`];
  // El texto completo va a las hojas si aporta algo más que la nube.
  const detail = body && body.replace(/\s+/g, ' ') !== lines[0] ? body : null;
  return { mood: 'happy', title: `/${name}`, lines, detail };
}
