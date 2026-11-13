// Sugerencias de motor y modelo. Al escribir el primer mensaje de una conversación nueva, Astro mira el texto
// y propone Claude Code (trabajo pesado) u OpenCode (preguntas cortas). Solo sugiere: la persona decide con
// un clic. Reglas sencillas sobre el texto, sin llamar a ningún modelo.

// Sin tildes y en minúsculas, para que «Diseña» y «disena» valgan igual.
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Pedir que se cambie algo (verbos)… y sobre qué (código, archivos…): juntos, es trabajo pesado.
const CHANGE = /\b(edita|editar|modifica|modificar|cambia|cambiar|refactoriza|refactorizar|implementa|implementar|crea|crear|agrega|agregar|anade|anadir|arregla|arreglar|corrige|corregir|migra|migrar|renombra|renombrar|elimina|eliminar|borra|borrar|escribe|escribir|genera|generar|actualiza|actualizar|optimiza|optimizar|instala|instalar|despliega|desplegar|mueve|mover|fix|implement|refactor|create|add|update|rename|delete|remove|write|generate|migrate|deploy|install|change|edit|move)\b/;
const TARGET = /\b(archivo|archivos|funcion|funciones|componente|componentes|modulo|modulos|clase|clases|codigo|test|tests|prueba|pruebas|proyecto|repo|repositorio|endpoint|api|base de datos|script|bug|error|nombre|file|files|function|functions|component|module|class|code|project|repository|database)\b/;
// Cosas que por sí solas piden trabajo de fondo.
const STRONG = /\b(un plan|el plan para|planifica|arquitectura|disena|disenar|refactor|migracion|todos los archivos|todo el proyecto|toda la base|varios archivos|all files|whole project|architecture|design)\b/;
// Cómo empieza una pregunta corta de explicar, resumir o traducir.
const STARTER = /^(que|como|por que|cual|cuales|cuando|donde|quien|cuanto|explica|explicame|resume|resumeme|traduce|define|dime|diferencia|what|how|why|which|when|where|who|explain|summarize|translate|define|tell me)\b/;

const LONG = 500; // a partir de aquí es un encargo largo
const SHORT = 220; // una pregunta corta cabe aquí

/** 'heavy' (trabajo pesado), 'light' (pregunta corta) o 'unknown'. */
export function classify(text) {
  const raw = String(text || '');
  const n = norm(raw).trim();
  if (!n) return 'unknown';
  if (raw.length > LONG || raw.includes('```') || STRONG.test(n) || (CHANGE.test(n) && TARGET.test(n))) return 'heavy';
  if (raw.length <= SHORT && (STARTER.test(n.replace(/^[^a-z0-9]+/, '')) || n.endsWith('?'))) return 'light';
  return 'unknown';
}

/**
 * ¿Conviene otro motor para este mensaje? Devuelve { engine, model, reason } o null.
 * Solo en el primer mensaje de una conversación (cambiar de motor empieza otra), nunca si la persona eligió
 * motor o modelo a mano, ni con comandos / (dependen del motor).
 * ctx: { engine, hasHistory, pinned, hasCapture, opencodeModel, opencodeReady }
 */
export function suggestRoute(text, { engine, hasHistory, pinned, hasCapture, opencodeModel, opencodeReady } = {}) {
  if (pinned || hasHistory) return null;
  const t = String(text || '').trim();
  if (!t || t.startsWith('/')) return null;
  const kind = classify(t);
  if (engine === 'claude' && kind === 'light') {
    // con una captura adjunta no se manda a un modelo que quizá no vea imágenes
    if (hasCapture || !opencodeReady || !opencodeModel) return null;
    return { engine: 'opencode', model: opencodeModel, reason: 'Parece una pregunta corta' };
  }
  if (engine === 'opencode' && kind === 'heavy') return { engine: 'claude', model: null, reason: 'Parece trabajo pesado' };
  return null;
}
