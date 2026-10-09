const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planFileOf, readPlan } = require('../src/plans');

const tmpHome = () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'astro-plan-'));
  fs.mkdirSync(path.join(home, '.claude', 'plans'), { recursive: true });
  return home;
};

test('reconoce cuándo Claude escribe un plan en ~/.claude/plans', () => {
  const win = String.raw`C:\Users\a\.claude\plans\mi-plan.md`;
  assert.equal(planFileOf('Write', { file_path: win }), win);
  assert.equal(planFileOf('Edit', { file_path: '/home/a/.claude/plans/x.md' }), '/home/a/.claude/plans/x.md');
  assert.equal(planFileOf('Write', { file_path: '/home/a/proyecto/README.md' }), null);
  assert.equal(planFileOf('Read', { file_path: '/home/a/.claude/plans/x.md' }), null, 'leer no es escribir el plan');
  assert.equal(planFileOf('Write', { file_path: '/home/a/.claude/plans/x.txt' }), null);
  assert.equal(planFileOf('Write', {}), null);
});

test('lee el plan solo si está dentro de ~/.claude/plans', () => {
  const home = tmpHome();
  const inside = path.join(home, '.claude', 'plans', 'p.md');
  fs.writeFileSync(inside, '# Plan\n\n1. Paso uno\n');
  assert.equal(readPlan(inside, home), '# Plan\n\n1. Paso uno\n');
  const outside = path.join(home, 'secreto.md');
  fs.writeFileSync(outside, 'no');
  assert.equal(readPlan(outside, home), null, 'fuera de la carpeta de planes no se lee');
  assert.equal(readPlan(path.join(home, '.claude', 'plans', '..', '..', 'secreto.md'), home), null, 'sin escapar con ..');
  assert.equal(readPlan(path.join(home, '.claude', 'plans', 'no-existe.md'), home), null);
  assert.equal(readPlan(null, home), null);
});

test('un plan enorme se recorta en vez de cargar todo', () => {
  const home = tmpHome();
  const f = path.join(home, '.claude', 'plans', 'grande.md');
  fs.writeFileSync(f, 'x'.repeat(300 * 1024));
  assert.ok(readPlan(f, home).length <= 200 * 1024);
});
