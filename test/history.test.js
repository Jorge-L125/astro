const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encodeCwd, projectDirsFor, listConversations } = require('../src/history');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-hist-'));
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
const user = text => ({ type: 'user', message: { role: 'user', content: text } });
const structured = data => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: data }] } });

function setup() {
  const claudeHome = tmp();
  const cwd = 'C:\\Users\\ana.perez';
  const dir = path.join(claudeHome, 'projects', encodeCwd(cwd).toLowerCase()); // la unidad puede venir en minúscula
  fs.mkdirSync(dir, { recursive: true });
  return { claudeHome, cwd, dir };
}

test('codifica la carpeta como Claude Code', () => {
  assert.equal(encodeCwd('C:\\Users\\jorge.largacha'), 'C--Users-jorge-largacha');
  assert.equal(encodeCwd('/home/ana/proyecto'), '-home-ana-proyecto');
});

test('encuentra la carpeta sin importar mayúsculas en la unidad', () => {
  const { claudeHome, cwd, dir } = setup();
  assert.deepEqual(projectDirsFor(claudeHome, cwd), [dir]);
});

test('resume conversaciones de Astro y de la terminal, de la más reciente a la más antigua', () => {
  const { claudeHome, cwd, dir } = setup();
  const data = { mood: 'happy', title: 'Lineamientos Go', lines: ['Aquí van'], detail: 'Todo el detalle' };
  fs.writeFileSync(path.join(dir, 'aaa-astro.jsonl'), jsonl([
    user('Dame lineamientos para golang'),
    structured({ mood: 'thinking', title: 'x', lines: ['¿Para qué tipo de proyecto?'] }),
    user('Una API'),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'nada' }] } },
    user('Resultados de tus ayudantes:\n\n### Tester'),
    structured(data),
  ]));
  fs.writeFileSync(path.join(dir, 'bbb-term.jsonl'), jsonl([
    user('<command-name>/cost</command-name>'),
    user('arregla el login'),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Listo, lo arreglé.' }] } },
  ]));
  fs.writeFileSync(path.join(dir, 'ccc-helper.jsonl'), jsonl([user('Eres "Tester", un ayudante especialista que trabaja para Astro, bla')]));
  fs.writeFileSync(path.join(dir, 'ddd-empty.jsonl'), jsonl([{ type: 'summary', summary: 'vacía' }]));
  const now = Date.now() / 1000;
  fs.utimesSync(path.join(dir, 'aaa-astro.jsonl'), now - 100, now - 100);
  fs.utimesSync(path.join(dir, 'bbb-term.jsonl'), now, now);

  const list = listConversations({ claudeHome, cwd });
  assert.deepEqual(list.map(c => c.id), ['bbb-term', 'aaa-astro']);
  const [term, astro] = list;
  assert.equal(astro.title, 'Dame lineamientos para golang');
  assert.equal(astro.last, 'Una API'); // ni resultados de herramientas ni los de los ayudantes
  assert.equal(astro.questions, 2);
  assert.equal(astro.astro, true);
  assert.deepEqual(astro.data, data);
  assert.equal(term.title, '/cost');
  assert.equal(term.last, 'arregla el login');
  assert.equal(term.astro, false);
  assert.equal(term.lastText, 'Listo, lo arreglé.');
});

test('sin carpeta de proyecto devuelve una lista vacía', () => {
  assert.deepEqual(listConversations({ claudeHome: tmp(), cwd: 'D:\\nada' }), []);
});

test('lee la conversación entera: cada pregunta con su respuesta, en orden', () => {
  const { readConversation } = require('../src/history');
  const { claudeHome, cwd, dir } = setup();
  const q1 = { ...user('Dame lineamientos para golang'), timestamp: '2026-10-09T10:00:00.000Z' };
  const a1 = { ...structured({ mood: 'thinking', title: 'x', lines: ['¿Qué proyecto?'] }), timestamp: '2026-10-09T10:00:05.000Z' };
  const q2 = { ...user('Una API'), timestamp: '2026-10-09T10:01:00.000Z' };
  const data = { mood: 'happy', title: 'Lineamientos Go', lines: ['Aquí van'], detail: 'Todo el detalle' };
  fs.writeFileSync(path.join(dir, 'aaa-astro.jsonl'), jsonl([
    q1, a1, q2,
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'nada' }] } },
    { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'ruido de un ayudante' }] } },
    user('Resultados de tus ayudantes:\n\n### Tester'),
    structured(data),
    user('gracias'),
    { type: 'assistant', message: { content: [{ type: 'text', text: 'De nada' }] } },
  ]));
  const m = readConversation({ claudeHome, cwd, id: 'aaa-astro' });
  assert.deepEqual(m.map(x => x.role), ['user', 'bot', 'user', 'bot', 'user', 'bot']);
  assert.equal(m[0].text, 'Dame lineamientos para golang');
  assert.equal(m[0].at, Date.parse('2026-10-09T10:00:00.000Z'));
  assert.equal(m[1].data.lines[0], '¿Qué proyecto?');
  assert.equal(m[2].text, 'Una API');
  assert.deepEqual(m[3].data, data, 'la respuesta tras los ayudantes es la última de esa pregunta');
  assert.equal(m[5].text, 'De nada');
  assert.equal(m[5].data, null);
});

test('leer una conversación no sale de la carpeta del proyecto ni falla si no existe', () => {
  const { readConversation } = require('../src/history');
  const { claudeHome, cwd } = setup();
  assert.deepEqual(readConversation({ claudeHome, cwd, id: 'no-existe' }), []);
  assert.deepEqual(readConversation({ claudeHome, cwd, id: '../../../etc/passwd' }), []);
  assert.deepEqual(readConversation({ claudeHome, cwd, id: null }), []);
});
