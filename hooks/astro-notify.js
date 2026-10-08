#!/usr/bin/env node
// Hook de Claude Code: avisa a Astro cuando una sesión termina (Stop) o necesita atención (Notification).
// Se registra en ~/.claude/settings.json; ver README.md. El puerto y el token los publica Astro al
// arrancar (ver src/runtime-info.js); si Astro no está abierto, el hook no hace nada.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { readRuntimeInfo } = require('../src/runtime-info');

// Las llamadas que hace el propio Astro no deben avisarle a sí mismo.
if (process.env.ASTRO_INTERNAL) process.exit(0);

function lastAssistantText(transcriptPath) {
  try {
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 200; i--) {
      const entry = JSON.parse(lines[i]);
      const content = entry.type === 'assistant' && entry.message && entry.message.content;
      if (!Array.isArray(content)) continue;
      const text = content.filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
      if (text) return text;
    }
  } catch { /* sin resumen */ }
  return '';
}

const info = readRuntimeInfo();
if (!info || !info.port) process.exit(0);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let hook = {};
  try { hook = JSON.parse(input); } catch { process.exit(0); }
  const event = hook.hook_event_name || 'Stop';
  const message = event === 'Notification'
    ? hook.message || 'Necesita tu atención'
    : hook.last_assistant_message || lastAssistantText(hook.transcript_path);
  const body = JSON.stringify({
    event,
    project: hook.cwd ? path.basename(hook.cwd) : '',
    message: String(message).replace(/\s+/g, ' ').slice(0, 280),
  });
  const req = http.request({
    host: '127.0.0.1',
    port: info.port,
    path: '/event',
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-astro-token': info.token || '' },
    timeout: 1500,
  });
  req.on('response', res => { res.resume(); res.on('end', () => process.exit(0)); });
  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });
  req.end(body);
});
