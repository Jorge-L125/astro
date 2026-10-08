const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseDescription, readDescriptions } = require('../src/skill-descriptions');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-skills-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('lee la descripción del encabezado', () => {
  assert.equal(parseDescription('---\nname: x\ndescription: "Hace cosas: muchas"\n---\ncuerpo'), 'Hace cosas: muchas');
  assert.equal(parseDescription('---\r\ndescription: simple\r\n---'), 'simple');
  assert.equal(parseDescription('---\ndescription: >-\n  En bloque\n  segunda\n---'), 'En bloque');
  assert.equal(parseDescription('sin encabezado'), '');
});

test('busca skills y comandos del usuario, del proyecto y de los plugins', () => {
  const home = tmp(), cwd = tmp();
  write(path.join(home, '.claude/skills/graphify/SKILL.md'), '---\ndescription: Grafo del código\n---');
  write(path.join(home, '.claude/skills/synced/abc/pdf/SKILL.md'), '---\ndescription: PDFs\n---');
  write(path.join(home, '.claude/commands/commit.md'), '---\ndescription: Hace un commit\n---');
  write(path.join(cwd, '.claude/commands/commit.md'), '---\ndescription: Commit del proyecto\n---');
  write(path.join(home, '.claude/plugins/cache/x/superpowers/1.0/skills/brainstorming/SKILL.md'), '---\ndescription: Lluvia de ideas\n---');
  const d = readDescriptions({ home, cwd });
  assert.equal(d.get('graphify'), 'Grafo del código');
  assert.equal(d.get('pdf'), 'PDFs', 'skills anidadas un par de niveles');
  assert.equal(d.get('commit'), 'Commit del proyecto', 'el del proyecto manda');
  assert.equal(d.get('brainstorming'), 'Lluvia de ideas');
});
