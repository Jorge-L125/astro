const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOpencodeSettings } = require('../src/opencode-settings');

// Cifrado de juguete: invierte el texto (en la app es safeStorage del sistema).
const toy = { available: () => true, encrypt: s => Buffer.from([...s].reverse().join('')).toString('base64'), decrypt: b => [...Buffer.from(b, 'base64').toString()].reverse().join('') };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'astro-oc-'));

test('guarda los ajustes y los recupera al volver a abrir', () => {
  const dir = tmp();
  const a = createOpencodeSettings(dir, toy);
  a.set({ defaultEngine: 'opencode', defaultModel: 'github-copilot/gpt-4.1', mode: 'remote', url: 'http://127.0.0.1:4096', pathMap: [{ host: 'C:/x', server: '/work' }, { host: '', server: '/y' }] });
  const b = createOpencodeSettings(dir, toy).get();
  assert.equal(b.defaultEngine, 'opencode');
  assert.equal(b.defaultModel, 'github-copilot/gpt-4.1');
  assert.deepEqual(b.pathMap, [{ host: 'C:/x', server: '/work' }], 'las equivalencias incompletas se descartan');
});

test('los secretos van cifrados y nunca salen hacia la interfaz', () => {
  const dir = tmp();
  const s = createOpencodeSettings(dir, toy);
  const pub = s.set({ password: 'p4ss', openaiKey: 'sk-123', openai: { name: 'Mi proveedor', baseURL: 'https://api.ejemplo/v1', models: ['m1', ' ', 'm2'] } });
  assert.equal(pub.hasPassword, true);
  assert.equal(pub.hasOpenaiKey, true);
  assert.ok(!JSON.stringify(pub).includes('p4ss') && !JSON.stringify(pub).includes('sk-123'));
  const raw = fs.readFileSync(path.join(dir, 'opencode.json'), 'utf8');
  assert.ok(!raw.includes('p4ss') && !raw.includes('sk-123'), 'en disco no quedan en claro');
  assert.equal(s.server().password, 'p4ss');
  assert.deepEqual(s.openai(), { name: 'Mi proveedor', baseURL: 'https://api.ejemplo/v1', models: ['m1', 'm2'], key: 'sk-123' });
  s.set({ password: '' });
  assert.equal(s.public().hasPassword, false, 'un secreto vacío lo borra');
  assert.equal(s.public().hasOpenaiKey, true, 'uno ausente lo deja');
});

test('sin cifrado disponible no guarda secretos en claro', () => {
  const s = createOpencodeSettings(tmp(), { ...toy, available: () => false });
  s.set({ password: 'p4ss' });
  assert.equal(s.public().hasPassword, false);
  assert.equal(s.public().canEncrypt, false);
});

test('valores raros no cambian nada', () => {
  const s = createOpencodeSettings(tmp(), toy);
  s.set({ defaultEngine: 'otro', defaultModel: 'sin-barra', mode: 'nube' });
  assert.deepEqual([s.get().defaultEngine, s.get().defaultModel, s.get().mode], ['claude', 'opencode/big-pickle', 'local']);
});
