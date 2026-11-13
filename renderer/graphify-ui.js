// Textos del mapa del proyecto (graphify) en Ajustes y en las nubes de permiso. Puro: sin DOM, para probarlo en Node.

const ago = ms => {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
};

/**
 * Una línea con el estado del mapa de la carpeta activa.
 * info: lo que devuelve `graphify:status` ({ state, bin }); now: reloj inyectable para las pruebas.
 */
export function statusLine({ state, bin } = {}, now = Date.now()) {
  const st = state || { status: 'off' };
  let text;
  switch (st.status) {
    case 'off': text = 'Apagado'; break;
    case 'missing': text = 'graphify no está instalado'; break;
    case 'unmappable': text = 'Esta carpeta no se mapea (es la de usuario o una raíz)'; break;
    case 'unasked': text = 'Pendiente de tu permiso para esta carpeta'; break;
    case 'declined': text = 'No se mapea esta carpeta'; break;
    case 'idle': text = 'Sin mapa todavía'; break;
    case 'building': text = st.at ? 'Actualizando el mapa…' : 'Construyendo el mapa…'; break;
    case 'failed': text = `Falló: ${st.error || 'error desconocido'}`; break;
    case 'ready': {
      text = `${st.nodes} piezas · actualizado ${ago(now - st.at)}`;
      // El ahorro es una cota máxima: se compara con leer todo el código, que Claude no suele hacer.
      if (st.reduction) text += ` · ≈${Math.round(st.reduction)}× menos tokens por consulta que leer todo el código (estimación: Claude no lo lee todo, así que el ahorro real es menor)`;
      if (st.error) text += ` · el último intento falló: ${st.error}`;
      break;
    }
    default: text = '';
  }
  if (bin && bin.found && !bin.tested) text += ' · Astro está probado con graphify 0.9: esta versión puede fallar';
  return text;
}

/** La pregunta de la nube que pide permiso para hacer el mapa de una carpeta. */
export const consentText = folderName => `¿Hago el mapa de «${folderName}»? Tarda unos segundos y se queda en tu equipo.`;
