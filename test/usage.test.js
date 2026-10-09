const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contextUsage } = require('../src/claude');

const load = () => import('../renderer/usage.js');

// Resultado real de Claude Code 2.1 (segundo turno de una conversación con haiku), recortado.
const RESULT = {
  type: 'result',
  usage: {
    input_tokens: 2, cache_creation_input_tokens: 1988, cache_read_input_tokens: 36632, output_tokens: 416,
    iterations: [{ input_tokens: 2, output_tokens: 416, cache_read_input_tokens: 36632, cache_creation_input_tokens: 1988, type: 'message' }],
  },
  modelUsage: {
    'claude-haiku-5-5': { inputTokens: 1176, outputTokens: 436, cacheReadInputTokens: 36632, cacheCreationInputTokens: 38620, contextWindow: 1000000 },
    'claude-mini': { inputTokens: 300, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, contextWindow: 200000 },
  },
};

test('contextUsage: tamaño tras el turno frente al límite del modelo principal', () => {
  assert.deepEqual(contextUsage(RESULT), { used: 2 + 1988 + 36632 + 416, window: 1000000 });
  assert.equal(contextUsage({ type: 'result' }), null, 'sin datos de uso');
  assert.equal(contextUsage({ type: 'result', usage: RESULT.usage }), null, 'sin límite del modelo');
});

test('contextUsage usa la última llamada del turno, no la suma de todas', () => {
  const ev = { ...RESULT, usage: { iterations: [
    { input_tokens: 5, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 50 },
    { input_tokens: 5, cache_read_input_tokens: 1100, cache_creation_input_tokens: 0, output_tokens: 80 },
  ] } };
  assert.equal(contextUsage(ev).used, 1185);
});

test('fmtTokens abrevia como Claude Code', async () => {
  const { fmtTokens } = await load();
  assert.deepEqual([950, 1500, 39038, 160000, 1000000, 1500000].map(fmtTokens), ['950', '1.5k', '39k', '160k', '1M', '1.5M']);
});

test('contextInfo: el anillo aparece desde el 75% y se pone rojo desde el 90%', async () => {
  const { contextInfo } = await load();
  assert.equal(contextInfo(null), null);
  const ok = contextInfo({ used: 39038, window: 1000000, last: 2400 });
  assert.deepEqual([ok.pct, ok.level, ok.show, ok.left, ok.last], [4, 'ok', false, '961k', '+2.4k']);
  const high = contextInfo({ used: 160000, window: 200000, last: 40000 });
  assert.deepEqual([high.pct, high.level, high.show, high.title, high.used, high.window, high.left, high.last],
    [80, 'high', true, 'Uso alto', '160k', '200k', '40k', '+40k']);
  assert.equal(contextInfo({ used: 190000, window: 200000 }).level, 'critical');
  assert.equal(contextInfo({ used: 150000, window: 200000, last: 0 }).last, null);
});

test('reconoce preguntas sobre el uso de esta conversación, y no otras sobre tokens', async () => {
  const { usageQuestion } = await load();
  for (const q of ['¿Cuántos tokens quedan?', 'cuantos tokens me quedan', '¿Cómo va el contexto?',
    '¿cuánto contexto llevamos?', '¿Cuántos tokens hemos usado en esta conversación?']) {
    assert.equal(usageQuestion(q), 'context', q);
  }
  assert.equal(usageQuestion('¿Cuánto me queda del límite semanal del plan?'), 'plan');
  for (const q of ['¿Cuántos tokens usa la API de Claude por imagen?', 'Explícame qué es un token',
    'Refactoriza el contexto de React en este archivo', '']) {
    assert.equal(usageQuestion(q), null, q);
  }
});

test('contextSpeech explica el uso con el tono de cada nivel', async () => {
  const { contextInfo, contextSpeech } = await load();
  assert.match(contextSpeech(null)[0], /Aún no lo sé/);
  const [a, b] = contextSpeech(contextInfo({ used: 160000, window: 200000, last: 40000 }));
  assert.equal(a, 'Llevamos 160k de 200k tokens de contexto (80%): quedan 40k.');
  assert.match(b, /el último turno sumó \+40k/);
  assert.match(contextSpeech(contextInfo({ used: 195000, window: 200000 }))[1], /Casi lleno/);
});
