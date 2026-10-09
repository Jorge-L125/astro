const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ASTRO_RULES } = require('../src/prompts');

test('si piden un plan, las instrucciones exigen el plan completo en "detail"', () => {
  const rules = ASTRO_RULES('/x');
  assert.match(rules, /plan/i);
  assert.match(rules, /entero en "detail"/);
});
