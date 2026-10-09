// Comandos / que Astro ofrece en su chat. La lista sale de lo que anuncia Claude Code al empezar
// cada conversación (comandos de serie, skills y plugins) y se guarda para el siguiente arranque.
const fs = require('fs');
const path = require('path');
const { readDescriptions } = require('./skill-descriptions');

// kind: 'local' lo resuelve Astro sin llamar a Claude; 'info' muestra un informe; 'task' hace trabajo.
const BUILTIN = {
  clear: { kind: 'local', desc: 'Empieza esta conversación de cero (pide confirmación)' },
  resume: { kind: 'local', desc: 'Retoma una conversación anterior' },
  historial: { kind: 'local', desc: 'Todo lo que le has dicho a Astro en esta sesión' },
  compact: { kind: 'task', desc: 'Resume la conversación para liberar contexto' },
  context: { kind: 'info', desc: 'Cuánto contexto lleva la conversación' },
  usage: { kind: 'info', desc: 'Uso de tu plan y cuándo se reinicia' },
  cost: { kind: 'info', desc: 'Coste de esta sesión' },
  insights: { kind: 'info', desc: 'Informe de cómo usas Claude Code' },
  recap: { kind: 'info', desc: 'Resumen de lo hecho en esta sesión' },
  model: { kind: 'task', desc: 'Cambia el modelo de esta sesión', arg: 'sonnet · opus · haiku' },
  effort: { kind: 'task', desc: 'Cambia cuánto razona Claude', arg: 'low · medium · high' },
  init: { kind: 'task', desc: 'Crea un CLAUDE.md con lo esencial del proyecto' },
  review: { kind: 'task', desc: 'Revisa un pull request', arg: 'número del PR' },
  'security-review': { kind: 'task', desc: 'Revisión de seguridad de los cambios pendientes' },
};

// Descripciones en español de skills habituales; el resto se muestra como «Skill».
const SKILL_DESC = {
  'code-review': 'Revisa los cambios buscando errores',
  simplify: 'Simplifica y limpia el código cambiado',
  debug: 'Ayuda a encontrar la causa de un error',
  verify: 'Comprueba que un cambio funciona de verdad',
  'claude-api': 'Ayuda con la API de Claude y el SDK',
  dataviz: 'Gráficos y visualizaciones de datos',
  'anthropic-skills:pdf': 'Leer o crear archivos PDF',
  'anthropic-skills:docx': 'Leer o crear documentos de Word',
  'anthropic-skills:xlsx': 'Leer o crear hojas de cálculo',
  'anthropic-skills:pptx': 'Leer o crear presentaciones',
  'anthropic-skills:deep-research': 'Investigación a fondo con varias fuentes',
};

// Ocultos: de pago (ultrareview), crean tareas recurrentes (loop, schedule), cambian el aspecto de
// la terminal o solo tienen sentido en ella.
const HIDDEN = new Set([
  'ultrareview', 'loop', 'schedule', 'heapdump', 'design-consent', 'design-revoke', 'workflow-launch-exec',
  'extra-usage', 'usage-credits', 'team-onboarding', 'fast', 'focus', 'color', 'rename', 'config',
  'output-style', 'autocompact', 'auto-mode-setup', 'reload-plugins', 'reload-skills', 'import', 'mcp',
  'agents', 'list-agents', 'advisor', 'skill-doctor', 'goal', 'exit', 'rewind', 'login', 'logout',
]);

/**
 * Lista para la interfaz: [{ name, desc, kind, arg? }], primero los de Astro, luego los de serie y
 * los skills. `descriptions` (nombre -> texto) trae la descripción real de skills y comandos propios.
 */
function buildCommandList({ slashCommands = [], skills = [], terminalCommands = [] } = {}, descriptions = new Map()) {
  const skillSet = new Set(skills);
  const terminal = new Set(terminalCommands);
  const short = n => n.slice(n.lastIndexOf(':') + 1);
  const described = n => descriptions.get(n) || descriptions.get(short(n));
  // Los que resuelve Astro están siempre, los anuncie Claude o no.
  const names = new Set([...Object.keys(BUILTIN).filter(n => BUILTIN[n].kind === 'local'), ...slashCommands]);
  const out = [];
  for (const name of names) {
    if (!name || name.startsWith('_') || HIDDEN.has(name) || terminal.has(name)) continue;
    if (BUILTIN[name]) out.push({ name, ...BUILTIN[name] });
    else if (skillSet.has(name) || described(name)) out.push({ name, kind: 'skill', desc: SKILL_DESC[name] || described(name) || 'Skill' });
    // Un comando de serie que Astro no conoce se oculta: puede que no tenga sentido fuera de la terminal.
  }
  const rank = { local: 0, info: 1, task: 2, skill: 3 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name));
}

// Hasta la primera conversación no se sabe qué hay instalado: se ofrecen los de serie más útiles.
const FALLBACK = buildCommandList({ slashCommands: Object.keys(BUILTIN).filter(n => n !== 'review' && n !== 'cost') });

function createCommandStore(dir, { home, cwd } = {}) {
  // Se leen una vez por carpeta, al recibir su primera lista: recorrer ~/.claude cuesta unos 150 ms.
  const descriptions = new Map();
  const file = path.join(dir, 'commands.json');
  let list = FALLBACK;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(saved) && saved.length) list = saved;
  } catch { /* primera vez: valores por defecto */ }
  return {
    get: () => list,
    /** Actualiza con lo que anunció Claude Code; devuelve true si la lista cambió. */
    update(announced, folder = cwd) {
      if (!descriptions.has(folder)) descriptions.set(folder, home ? readDescriptions({ home, cwd: folder }) : new Map());
      const next = buildCommandList(announced, descriptions.get(folder));
      if (!next.length || JSON.stringify(next) === JSON.stringify(list)) return false;
      list = next;
      try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(list)); } catch { /* sin caché */ }
      return true;
    },
  };
}

module.exports = { buildCommandList, createCommandStore, FALLBACK };
