// Traducciones entre OpenCode y Astro que no necesitan un servidor: instrucciones de sistema, lectura
// de la respuesta, nombres de herramientas, permisos y equivalencia de carpetas.

// OpenCode 1.19 no admite el formato JSON obligatorio sin romper el historial de la sesión, así que el
// formato de Astro se pide en las instrucciones y se lee del texto (si no viene, se muestra el texto).
const OPENCODE_RULES = cwd => `Te llamas Astro. Vives en el escritorio del usuario como una gota 3D expresiva que flota en una esquina de la pantalla.

Personalidad: curioso, entusiasta y juguetón; en lo técnico, un compañero senior claro, directo y preciso. Nunca inventas resultados ni contenido de archivos; si no sabes algo, lo dices. Humor breve y cálido. Respondes en el idioma del usuario.

Tu carpeta de trabajo es ${cwd}. Si la pregunta depende del código o de archivos reales, léelos antes de responder. Para trabajos grandes que se dividen en partes independientes puedes lanzar subagentes con la herramienta task.

Cuando termines, tu ÚLTIMO mensaje debe ser SOLO un objeto JSON válido (sin texto antes ni después y sin bloque de código) con esta forma:
{"mood":"neutral|happy|thinking|surprised|worried","title":"título corto","lines":["1 o 2 frases cortas (máx. 140 caracteres) que resumen la idea, sin código"],"detail":"explicación completa en markdown simple o null","code":{"lang":"lenguaje","content":"código completo"} o null,"choice":{"prompt":"pregunta","options":["2 a 5 opciones cortas"],"multi":false} o null}
Usa "choice" solo si falta un dato que cambia la respuesta. "mood": happy al entregar, thinking al preguntar, worried ante riesgos o errores.`;

/**
 * La respuesta de Astro dentro del texto del modelo: el último objeto JSON con "lines". Devuelve los
 * datos y el texto que quedó fuera del JSON (por si el modelo explicó algo antes), o null si no hay.
 */
function parseReply(text) {
  const s = String(text || '');
  // Se prueba desde la última llave que abre hacia atrás: las internas (code, choice) no traen "lines"
  // y se saltan hasta llegar al objeto de fuera.
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    const end = closingBrace(s, i);
    if (end < 0) continue;
    try {
      const data = JSON.parse(s.slice(i, end + 1));
      if (data && Array.isArray(data.lines) && data.lines.length) return { data, prose: (s.slice(0, i) + s.slice(end + 1)).trim() };
    } catch { /* no era JSON: se sigue buscando */ }
    if (i === 0) break;
  }
  return null;
}
// Posición de la llave que cierra la que abre en `start`, respetando las cadenas; -1 si no cierra.
function closingBrace(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

// Herramientas de OpenCode con su equivalente de Claude Code, que es lo que la interfaz sabe contar.
const TOOL_NAMES = {
  read: 'Read', glob: 'Glob', grep: 'Grep', list: 'Glob', bash: 'Bash', edit: 'Edit', write: 'Write',
  patch: 'Edit', multiedit: 'MultiEdit', webfetch: 'WebFetch', websearch: 'WebSearch', task: 'Agent',
  todowrite: 'TodoWrite', todoread: 'TodoWrite', skill: 'Skill',
  // OpenCode 2.x
  shell: 'Bash', subagent: 'Agent',
};
/** { name, input } al estilo de Claude Code para una herramienta de OpenCode. */
function toClaudeTool(tool, input = {}) {
  const i = input || {};
  const name = TOOL_NAMES[tool] || tool;
  const file = i.filePath || i.file_path || i.path;
  return { name, input: { ...i, file_path: file, pattern: i.pattern || (tool === 'list' ? i.path : undefined), url: i.url, command: i.command, query: i.query, description: i.description, prompt: i.prompt, subagent_type: i.subagent_type || i.agent } };
}

// Permisos de OpenCode por cada herramienta de Claude Code de la lista allowedTools de Astro.
const PERMISSION_OF = {
  Read: ['read', 'list'], Glob: ['glob', 'list'], Grep: ['grep'], WebFetch: ['webfetch'], WebSearch: ['websearch'],
  Bash: ['bash'], PowerShell: ['bash'], Edit: ['edit'], MultiEdit: ['edit'], Write: ['edit'], NotebookEdit: ['edit'],
  Agent: ['task'], Task: ['task'], Skill: ['skill'], TodoWrite: ['todowrite', 'todoread'],
};
/**
 * Reglas de permisos de una sesión de OpenCode a partir de allowedTools: lo permitido va sin preguntar
 * y el resto pregunta (Astro muestra el aviso). Los subagentes y las listas de tareas se permiten siempre.
 * Una entrada como "Bash(pnpm test:*)" permite solo ese comando.
 */
function permissionRules(allowedTools = []) {
  const rules = [{ permission: '*', pattern: '*', action: 'ask' }];
  const allow = (permission, pattern = '*') => rules.push({ permission, pattern, action: 'allow' });
  ['task', 'todowrite', 'todoread', 'skill'].forEach(p => allow(p));
  for (const entry of allowedTools) {
    const m = /^([A-Za-z]+)(?:\((.*)\))?$/.exec(String(entry || '').trim());
    if (!m) continue;
    const perms = PERMISSION_OF[m[1]];
    if (!perms) continue;
    const pattern = m[2] ? m[2].replace(/:\*$/, ' *') : '*';
    perms.forEach(p => allow(p, pattern));
  }
  return rules;
}

// Una solicitud de permiso de OpenCode contada como las denegaciones de Claude Code (herramienta + entrada).
const ASKED_TOOL = { bash: 'Bash', edit: 'Edit', write: 'Write', webfetch: 'WebFetch', websearch: 'WebSearch', read: 'Read', glob: 'Glob', grep: 'Grep', list: 'Glob', task: 'Agent', external_directory: 'Read' };
function permissionRequest(p = {}) {
  const meta = p.metadata || {};
  const patterns = Array.isArray(p.patterns) ? p.patterns : [];
  const tool = ASKED_TOOL[p.permission] || p.permission || 'Herramienta';
  const input = { command: meta.command || patterns.join(' && '), file_path: meta.filepath || meta.filePath || patterns[0], url: meta.url || patterns[0], pattern: patterns[0] };
  return { id: p.id, tool, input, patterns, always: Array.isArray(p.always) ? p.always : [] };
}

// OpenCode 2.x: la solicitud de permiso trae `action` (shell, edit, read…), `resources` (el comando o la
// ruta) y `save` (los patrones que se guardarían con «Siempre»).
const ASKED_TOOL_V2 = { shell: 'Bash', edit: 'Edit', write: 'Write', patch: 'Edit', webfetch: 'WebFetch', websearch: 'WebSearch', read: 'Read', glob: 'Glob', grep: 'Grep', list: 'Glob', subagent: 'Agent', external_directory: 'Read' };
function permissionRequestV2(p = {}) {
  const res = Array.isArray(p.resources) ? p.resources.map(String) : [];
  const tool = ASKED_TOOL_V2[p.action] || p.action || 'Herramienta';
  const input = { command: p.action === 'shell' ? res.join(' && ') : undefined, file_path: res[0], url: res[0], pattern: res[0] };
  return { id: p.id, tool, input, patterns: res, always: Array.isArray(p.save) ? p.save : [] };
}

// Lo que 2.x llama `action` según las reglas de allowedTools (que usan los nombres de 1.x).
const PERMISSION_V2 = { shell: 'bash', edit: 'edit', write: 'edit', patch: 'edit', subagent: 'task', external_directory: 'read' };
const escapeRe = s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
// `*` vale por cualquier texto; "pnpm test *" vale también para "pnpm test" a secas.
function globMatch(pattern, text) {
  if (pattern === '*') return true;
  const tail = pattern.endsWith(' *');
  const body = (tail ? pattern.slice(0, -2) : pattern).split('*').map(escapeRe).join('.*');
  return new RegExp('^' + body + (tail ? '( .*)?' : '') + '$').test(text);
}
/**
 * ¿Está ya permitido lo que 2.x pregunta? Con las mismas reglas que se dan a 1.x (la última que coincide
 * manda). Astro lo aprueba solo: el servidor de Astro pregunta por todo y aquí se decide.
 */
function allowsRequest(allowedTools = [], action, resources = []) {
  const perm = PERMISSION_V2[action] || action;
  const rules = permissionRules(allowedTools);
  if (!Array.isArray(resources) || !resources.length) return false;
  return resources.every(r => {
    let result = 'ask';
    for (const rule of rules) if ((rule.permission === '*' || rule.permission === perm) && globMatch(rule.pattern, String(r))) result = rule.action;
    return result === 'allow';
  });
}

/**
 * Equivalencia de carpetas entre este equipo y el servidor (p. ej. Docker): [{ host, server }].
 * Sin equivalencias, la ruta va tal cual (servidor en este mismo equipo).
 */
const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
function toServerPath(hostPath, map = [], caseless = process.platform === 'win32') {
  const h = norm(hostPath);
  for (const m of map) {
    const from = norm(m.host);
    if (!from) continue;
    const head = h.slice(0, from.length);
    const same = caseless ? head.toLowerCase() === from.toLowerCase() : head === from;
    if (same && (h.length === from.length || h[from.length] === '/')) return norm(m.server) + h.slice(from.length);
  }
  return map.length ? null : hostPath;
}
function toHostPath(serverPath, map = []) {
  const s = norm(serverPath);
  for (const m of map) {
    const from = norm(m.server);
    if (from && (s === from || s.startsWith(from + '/'))) {
      const rest = s.slice(from.length);
      const host = String(m.host).replace(/[\\/]+$/, '');
      return host + (host.includes('\\') ? rest.replace(/\//g, '\\') : rest);
    }
  }
  return serverPath;
}

/** Comandos / del servidor en el formato del menú de Astro. */
function commandList(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter(c => c && c.name)
    .map(c => ({ name: c.name, desc: c.description || (c.source === 'skill' ? 'Skill' : 'Comando de OpenCode'), kind: c.source === 'skill' ? 'skill' : 'task' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Uso del contexto tras una respuesta: tokens del último mensaje frente al límite del modelo. */
function contextUsage(tokens, window) {
  if (!tokens || !window) return null;
  const used = (tokens.input || 0) + (tokens.output || 0) + (tokens.reasoning || 0) + ((tokens.cache && tokens.cache.read) || 0) + ((tokens.cache && tokens.cache.write) || 0);
  return used ? { used, window } : null;
}

/** "proveedor/modelo" → { providerID, modelID }; null si no tiene esa forma. */
function splitModel(id) {
  const m = /^([^/\s]+)\/(.+)$/.exec(String(id || '').trim());
  return m ? { providerID: m[1], modelID: m[2] } : null;
}

// Texto de un mensaje de OpenCode (sus partes de texto, sin las sintéticas que añade el servidor).
const textOf = msg => (msg && Array.isArray(msg.parts) ? msg.parts : []).filter(p => p.type === 'text' && p.text && !p.synthetic).map(p => p.text).join('\n').trim();

/**
 * Una conversación de OpenCode con el formato de /historial: [{ role: 'user', text, at },
 * { role: 'bot', data, text, at }]. La respuesta de cada pregunta es el último texto del asistente.
 */
function conversationItems(messages = []) {
  const out = [];
  let bot = null;
  const flush = () => { if (bot && (bot.data || bot.text)) out.push(bot); bot = null; };
  for (const m of Array.isArray(messages) ? messages : []) {
    const info = m.info || {};
    const at = (info.time && (info.time.completed || info.time.created)) || null;
    if (info.role === 'user') {
      const text = textOf(m);
      if (!text) continue;
      flush();
      out.push({ role: 'user', text, at });
      bot = { role: 'bot', data: null, text: '', at: null };
    } else if (info.role === 'assistant' && bot) {
      const text = textOf(m);
      if (!text) continue;
      const parsed = parseReply(text);
      if (parsed) { bot.data = parsed.data; bot.text = parsed.prose; } else bot.text = text;
      bot.at = at;
    }
  }
  flush();
  return out;
}

/**
 * OpenCode 2.x: los mensajes llegan del más nuevo al más antiguo, con `text` en los del usuario
 * y `content` (texto, razonamiento, herramientas) en los del asistente.
 */
function conversationItemsV2(messages = []) {
  const list = (Array.isArray(messages) ? [...messages] : []).sort((a, b) => ((a.time && a.time.created) || 0) - ((b.time && b.time.created) || 0));
  const out = [];
  let bot = null;
  const flush = () => { if (bot && (bot.data || bot.text)) out.push(bot); bot = null; };
  for (const m of list) {
    const at = (m.time && (m.time.completed || m.time.created)) || null;
    if (m.type === 'user') {
      // Al listar, el texto va en `text`; la respuesta de enviar un mensaje lo trae en `payload.text`.
      const text = String(m.text || (m.payload && m.payload.text) || '').trim();
      if (!text) continue;
      flush();
      out.push({ role: 'user', text, at: (m.time && m.time.created) || null });
      bot = { role: 'bot', data: null, text: '', at: null };
    } else if (m.type === 'assistant' && bot) {
      const text = (Array.isArray(m.content) ? m.content : []).filter(p => p.type === 'text' && p.text).map(p => p.text).join('\n').trim();
      if (!text) continue;
      const parsed = parseReply(text);
      if (parsed) { bot.data = parsed.data; bot.text = parsed.prose; } else { bot.data = null; bot.text = text; }
      bot.at = at;
    }
  }
  flush();
  return out;
}

/** Una sesión de OpenCode como elemento de la lista de /resume. */
function listItem(session, messages = []) { return listItemFrom(session, conversationItems(messages)); }
function listItemV2(session, messages = []) { return listItemFrom(session, conversationItemsV2(messages)); }
function listItemFrom(session, items) {
  const users = items.filter(x => x.role === 'user');
  const lastBot = items.filter(x => x.role === 'bot').pop();
  const title = String(session.title || '').replace(/\s+/g, ' ').trim();
  return {
    id: session.id,
    mtime: (session.time && (session.time.updated || session.time.created)) || 0,
    title: (!title || /^(Astro|New session)/i.test(title) ? (users[0] && users[0].text) || 'Conversación de OpenCode' : title).slice(0, 160),
    last: users.length ? users[users.length - 1].text.replace(/\s+/g, ' ').slice(0, 300) : '',
    questions: users.length,
    astro: !!(lastBot && lastBot.data),
    data: lastBot && lastBot.data ? lastBot.data : null,
    lastText: lastBot && !lastBot.data ? lastBot.text.slice(0, 4000) : '',
    engine: 'opencode',
  };
}

/** Modelos de OpenCode 2.x (`GET /api/model`) en el formato del selector de Astro. */
function modelsV2(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter(m => m && m.enabled !== false && (!m.status || m.status === 'active'))
    .map(m => {
      const costs = Array.isArray(m.cost) ? m.cost : [];
      const zero = costs.length > 0 && costs.every(c => !c.input && !c.output);
      return { id: `${m.providerID}/${m.modelID || m.id}`, name: m.name || m.id, provider: m.providerID, context: (m.limit && m.limit.context) || null, free: m.providerID === 'opencode' && zero };
    });
}
/** "proveedor/modelo" → { providerID, id } (así lo pide 2.x); null si no tiene esa forma. */
function splitModelV2(id) {
  const m = splitModel(id);
  return m ? { providerID: m.providerID, id: m.modelID } : null;
}
/** Comandos / de 2.x (`GET /api/command`) en el formato del menú de Astro. */
function commandListV2(list = []) {
  return (Array.isArray(list) ? list : [])
    .filter(c => c && c.name)
    .map(c => ({ name: c.name, desc: c.description || 'Comando de OpenCode', kind: 'task' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  OPENCODE_RULES, parseReply, toClaudeTool, permissionRules, permissionRequest, toServerPath, toHostPath, commandList, contextUsage, splitModel, conversationItems, listItem,
  permissionRequestV2, allowsRequest, conversationItemsV2, listItemV2, modelsV2, splitModelV2, commandListV2,
};
