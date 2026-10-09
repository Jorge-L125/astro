// Uso del contexto de una sesión: cuánto lleva la conversación frente al límite del modelo.

/** 950 → "950", 39038 → "39k", 1500 → "1.5k", 1000000 → "1M". */
export function fmtTokens(n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

// A partir de aquí aparece el anillo (como en Claude Code) y desde CRITICAL se pone en rojo.
export const SHOW_AT = 75;
export const CRITICAL_AT = 90;

/**
 * ¿Pregunta el usuario por el uso de esta conversación? Debe hablar de tokens o contexto Y referirse a la
 * sesión ("quedan", "llevo", "esta conversación"…): "¿cuántos tokens usa la API?" no cuenta.
 * Devuelve 'context', 'plan' (límite del plan: se resuelve con /usage) o null.
 */
export function usageQuestion(text) {
  const t = String(text || '').toLowerCase();
  if (t.length > 160) return null;
  const plan = /\b(plan|suscripci[oó]n|l[ií]mite (semanal|de uso|del plan)|5 ?horas|semanal)\b/.test(t);
  const about = /\b(tokens?|contexto|context)\b/.test(t) || plan;
  const mine = /\b(me|nos|te) qued|\bqued(a|an)\b|\bllev(o|as|amos)\b|\bhe(mos)? (usado|gastado|consumido)|\besta (sesi[oó]n|conversaci[oó]n)|\bc[oó]mo va(mos)?\b|\bcu[aá]nto contexto\b|\bmi(s)? tokens\b|\bcu[aá]nto(s)? (me|nos) qued/.test(t);
  if (!about || !mine) return null;
  return plan ? 'plan' : 'context';
}

/** Lo que Astro dice al explicar el uso del contexto (1 o 2 frases para las nubes). */
export function contextSpeech(info) {
  if (!info) return ['Aún no lo sé: lo veo cuando Claude me responde por primera vez en esta sesión.'];
  const lines = [`Llevamos ${info.used} de ${info.window} tokens de contexto (${info.pct}%): quedan ${info.left}.`];
  if (info.level === 'critical') lines.push('¡Casi lleno! Si compactamos, resumo la conversación y seguimos con espacio.');
  else if (info.level === 'high') lines.push(`Va alto${info.last ? `; el último turno sumó ${info.last}` : ''}. Puedes compactar cuando quieras.`);
  else lines.push(info.last ? `Vamos holgados: el último turno sumó ${info.last}.` : 'Vamos holgados.');
  return lines;
}

/**
 * { used, window, last } → datos para el anillo y los ajustes, o null si aún no hay datos.
 * last es lo que creció el contexto en el último turno.
 */
export function contextInfo(ctx) {
  if (!ctx || !ctx.window || !(ctx.used >= 0)) return null;
  const pct = Math.min(100, Math.round((ctx.used / ctx.window) * 100));
  const level = pct >= CRITICAL_AT ? 'critical' : pct >= SHOW_AT ? 'high' : 'ok';
  return {
    pct,
    level,
    show: pct >= SHOW_AT,
    title: level === 'critical' ? 'Uso muy alto' : level === 'high' ? 'Uso alto' : 'Uso del contexto',
    used: fmtTokens(ctx.used),
    window: fmtTokens(ctx.window),
    left: fmtTokens(ctx.window - ctx.used),
    last: ctx.last > 0 ? '+' + fmtTokens(ctx.last) : null,
  };
}
