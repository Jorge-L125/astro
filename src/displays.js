// Pantallas: cómo se muestran en Ajustes y en cuál vive Astro.

/**
 * Lista para la interfaz, numerada de izquierda a derecha (como se ven en el escritorio):
 * [{ id, n, name, size, primary }]. El id es el de Electron, como texto.
 */
function describeDisplays(displays, primaryId) {
  return [...displays]
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d, i) => ({
      id: String(d.id),
      n: i + 1,
      name: d.label || `Pantalla ${i + 1}`,
      // Resolución real (los bounds van en píxeles lógicos, escalados por el zoom de Windows).
      size: `${Math.round(d.bounds.width * (d.scaleFactor || 1))}×${Math.round(d.bounds.height * (d.scaleFactor || 1))}`,
      primary: d.id === primaryId,
    }));
}

/**
 * La pantalla elegida en Ajustes, o null en modo automático o si esa pantalla no está conectada
 * (entonces Astro sigue al cursor hasta que vuelva).
 */
function pinnedDisplay(displays, pref) {
  if (!pref || pref === 'auto') return null;
  return displays.find(d => String(d.id) === String(pref)) || null;
}

module.exports = { describeDisplays, pinnedDisplay };
