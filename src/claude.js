const { spawn } = require('child_process');
const path = require('path');

// Resumen corto de lo que hace una herramienta, para mostrarlo en la nube de "pensando".
function describeTool(name, input = {}) {
  const file = input.file_path || input.path || input.notebook_path;
  const base = file ? path.basename(String(file)) : '';
  switch (name) {
    case 'Read': return base ? `Leyendo ${base}` : 'Leyendo un archivo';
    case 'Glob': return `Buscando archivos ${input.pattern || ''}`.trim();
    case 'Grep': return `Buscando "${String(input.pattern || '').slice(0, 30)}"`;
    case 'WebSearch': return `Buscando en la web: ${String(input.query || '').slice(0, 40)}`;
    case 'WebFetch': return 'Leyendo una página web';
    case 'Bash': return `Ejecutando ${String(input.command || '').split(/\s+/)[0] || 'un comando'}`;
    case 'Edit': case 'MultiEdit': case 'Write': return base ? `Editando ${base}` : 'Editando un archivo';
    case 'Task': case 'Agent': return 'Mandando a un ayudante';
    case 'TodoWrite': return 'Organizando la tarea';
    default: return `Usando ${name}`;
  }
}

/**
 * Ejecuta `claude -p` (Claude Code en modo no interactivo) y emite su progreso.
 * Devuelve { done: Promise<{text, structured, sessionId, denials}>, cancel() }.
 */
function runClaude({ bin = 'claude', prompt, systemPrompt, schema, resume, model, cwd, allowedTools, permissionMode, onEvent = () => {} }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (resume) args.push('--resume', resume);
  if (permissionMode && permissionMode !== 'default') args.push('--permission-mode', permissionMode);
  if (allowedTools && allowedTools.length) args.push('--allowedTools', allowedTools.join(','));

  let child;
  let cancelled = false;

  const done = new Promise((resolve, reject) => {
    try {
      // ASTRO_INTERNAL evita que los hooks de aviso disparen notificaciones por las llamadas del propio Astro.
      child = spawn(bin, args, { cwd, env: { ...process.env, ASTRO_INTERNAL: '1' }, windowsHide: true });
    } catch (e) {
      return reject({ code: 'not_found', message: e.message });
    }

    let buf = '';
    let stderr = '';
    let result = null;

    const handleLine = line => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'system' && ev.subtype === 'init') {
        onEvent({ type: 'start', sessionId: ev.session_id });
      } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        for (const part of ev.message.content) {
          if (part.type === 'text' && part.text) onEvent({ type: 'text', text: part.text });
          if (part.type === 'tool_use' && part.name !== 'StructuredOutput') {
            onEvent({ type: 'tool', name: part.name, label: describeTool(part.name, part.input) });
          }
        }
      } else if (ev.type === 'result') {
        result = ev;
      }
    };

    child.stdout.on('data', d => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    child.stderr.on('data', d => { stderr = (stderr + d.toString('utf8')).slice(-4000); });

    child.on('error', e => reject({ code: e.code === 'ENOENT' ? 'not_found' : 'failed', message: e.message }));
    child.on('close', code => {
      if (buf) handleLine(buf);
      if (cancelled) return reject({ code: 'cancelled', message: 'Cancelado' });
      if (!result) return reject({ code: 'failed', message: stderr.trim() || `claude terminó con código ${code}` });
      if (result.is_error) return reject({ code: 'failed', message: String(result.result || result.subtype || 'error') });
      resolve({
        text: typeof result.result === 'string' ? result.result : '',
        structured: result.structured_output || null,
        sessionId: result.session_id,
        denials: (result.permission_denials || []).map(d => d.tool_name).filter(Boolean),
      });
    });

    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });

  return {
    done,
    cancel() {
      cancelled = true;
      if (child && !child.killed) child.kill();
    },
  };
}

module.exports = { runClaude, describeTool };
