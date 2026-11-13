// Lo que Claude Code y OpenCode saben del mapa del proyecto (graphify): la sección que se añade a sus
// instrucciones y los permisos de solo lectura que Astro les da para consultarlo. Sin Electron.

// Las únicas consultas de graphify que se permiten: leen el mapa y no cambian nada.
const READ_ONLY = ['query', 'explain', 'path', 'affected', 'god-nodes'];

/** Rutas con `/`: la consola del motor (Git Bash, PowerShell, cmd) puede tragarse las barras invertidas. */
const toSlashes = p => String(p).replace(/\\/g, '/');

/** Un permiso por consulta: `Bash(<graphify> query:*)`… con la ruta absoluta de graphify. */
function mapTools(command) {
  const cmd = toSlashes(command);
  return READ_ONLY.map(verb => `Bash(${cmd} ${verb}:*)`);
}

/** Sección en español para añadir a las instrucciones de sistema cuando existe el mapa de la carpeta. */
function mapRules({ command, graph }) {
  const raw = toSlashes(command);
  const cmd = /\s/.test(raw) ? `"${raw}"` : raw;
  const g = `--graph "${toSlashes(graph)}"`;
  return [
    'MAPA DEL PROYECTO: hay un mapa del código de esta carpeta hecho con graphify (archivos, funciones y quién llama a quién). Antes de abrir archivos sueltos, consúltalo: cuesta muy pocos tokens comparado con leer el código.',
    `- ${cmd} query "<pregunta>" ${g} --budget 1500`,
    `- ${cmd} explain "<nombre>" ${g}`,
    `- ${cmd} path "<A>" "<B>" ${g}`,
    `- ${cmd} affected "<nombre>" ${g}`,
    `- ${cmd} god-nodes ${g}`,
    'Cada respuesta lista nodos con su archivo y su línea (src=<archivo> loc=L<línea>). Después, lee solo esos archivos. Si no hay resultados o el mapa no basta, busca como siempre. No uses ningún otro comando de graphify.',
  ].join('\n');
}

module.exports = { READ_ONLY, toSlashes, mapTools, mapRules };
