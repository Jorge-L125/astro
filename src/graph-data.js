// El grafo del mapa del proyecto, listo para el visor: solo lectura y solo del archivo que el mapa de esa carpeta
// ya construyó (nunca una ruta que venga de la ventana). Sin Electron: todo inyectable para probarlo.
const fs = require('fs');

const text = v => (v == null ? '' : String(v));

/** Del graph.json de graphify a lo que usa el visor (acepta `links` o `edges`, y `{graph:{…}}`). */
function slimGraph(json) {
  const g = json && json.graph && !json.nodes && json.graph.nodes ? json.graph : json;
  const rawN = (g && Array.isArray(g.nodes) && g.nodes) || [];
  const rawL = (g && (Array.isArray(g.links) ? g.links : Array.isArray(g.edges) ? g.edges : [])) || [];
  const nodes = rawN.map((n, i) => {
    const id = text(n.id ?? n.name ?? i);
    return {
      id,
      label: text(n.label ?? n.name ?? n.title ?? id),
      type: text(n.file_type ?? n.type ?? n.kind),
      file: text(n.source_file ?? n.file ?? n.path),
      loc: text(n.source_location ?? n.line),
      community: n.community ?? n.group ?? n.cluster,
      communityName: n.community_name ?? n.community_label ?? undefined,
      desc: text(n.description ?? n.summary ?? n.docstring),
    };
  });
  const links = rawL.map(l => ({
    source: text(l.source && l.source.id !== undefined ? l.source.id : l.source ?? l.from),
    target: text(l.target && l.target.id !== undefined ? l.target.id : l.target ?? l.to),
    relation: text(l.relation ?? l.label ?? l.type) || 'relacionado',
    confidence: text(l.confidence),
  }));
  return { nodes, links };
}

const folderTitle = f => String(f || '').split(/[\\/]/).filter(Boolean).pop() || 'Grafo';

/** { ok:true, folder, title, at, nodes, links } con el mapa listo; { ok:false, state } si no hay mapa o no se pudo leer. */
async function loadGraphFor({ graphMap, folder, readFile = fs.promises.readFile }) {
  const file = graphMap.graphPath(folder);
  if (!file) return { ok: false, folder, state: graphMap.state(folder) };
  try {
    const json = JSON.parse(await readFile(file, 'utf8'));
    return { ok: true, folder, title: folderTitle(folder), at: graphMap.state(folder).at, ...slimGraph(json) };
  } catch (e) {
    return { ok: false, folder, state: { status: 'failed', error: e.message } };
  }
}

module.exports = { slimGraph, loadGraphFor };
