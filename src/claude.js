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

function buildArgs({ systemPrompt, schema, resume, model, allowedTools, permissionMode }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'];
  if (model) args.push('--model', model);
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (resume) args.push('--resume', resume);
  if (permissionMode && permissionMode !== 'default') args.push('--permission-mode', permissionMode);
  if (allowedTools && allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  return args;
}

// Parte un flujo de texto en líneas completas; lo que queda a medias espera al siguiente trozo.
function lineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    },
    flush() { if (buf) onLine(buf); buf = ''; },
  };
}

// child.kill() no alcanza a los procesos que lance Claude (comandos de Bash, servidores MCP…).
// En Windows se cierra el árbol con taskkill; en macOS y Linux Claude arranca en su propio grupo
// de procesos (detached) y se cierra el grupo entero.
const OWN_GROUP = process.platform !== 'win32';
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      .on('error', () => child.kill());
  } else if (OWN_GROUP && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
  } else {
    child.kill();
  }
}

const fail = (code, message) => Object.assign(new Error(message), { code });

/**
 * Conversación con un proceso `claude -p --input-format stream-json` que se mantiene vivo entre
 * turnos: solo se paga el arranque del CLI una vez. Si el proceso muere (cancelación, inactividad,
 * fallo), el siguiente turno lo relanza con `--resume` y la conversación sigue donde estaba.
 *
 * send(text, onEvent) devuelve { done: Promise<{text, structured, sessionId, denials}>, cancel() }.
 */
function createClaudeSession({ launcher, cwd, idleMs = 10 * 60 * 1000, resume = null, ...argOpts }) {
  let proc = null; // { child, stderr, resumed, gotResult }
  let turn = null; // { resolve, reject, onEvent }
  let sessionId = resume;
  let closed = false;
  let idleTimer = null;

  function clearIdle() { clearTimeout(idleTimer); idleTimer = null; }
  function armIdle() {
    clearIdle();
    if (!idleMs || !proc) return;
    idleTimer = setTimeout(() => { if (!turn) stop(); }, idleMs);
    idleTimer.unref?.();
  }
  function stop() {
    const p = proc;
    proc = null;
    if (p) killTree(p.child);
  }

  function handleLine(p, line) {
    if (p !== proc || !turn || !line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'system' && ev.subtype === 'init') {
      turn.onEvent({
        type: 'start',
        sessionId: ev.session_id,
        // Comandos / disponibles: los de serie, los de skills y los de plugins.
        slashCommands: ev.slash_commands || [],
        skills: ev.skills || [],
        terminalCommands: ev.terminal_slash_commands || [],
      });
    } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const part of ev.message.content) {
        if (part.type === 'text' && part.text) turn.onEvent({ type: 'text', text: part.text });
        if (part.type === 'tool_use' && part.name !== 'StructuredOutput') {
          turn.onEvent({ type: 'tool', name: part.name, label: describeTool(part.name, part.input) });
        }
      }
    } else if (ev.type === 'result') {
      const t = turn;
      turn = null;
      p.gotResult = true;
      if (ev.session_id) sessionId = ev.session_id;
      armIdle();
      if (ev.is_error) return t.reject(fail('failed', String(ev.result || ev.subtype || 'error')));
      // `/model x` cambia el modelo solo en este proceso: se recuerda para cuando haya que relanzarlo.
      if (t.model) argOpts.model = t.model;
      t.resolve({
        text: typeof ev.result === 'string' ? ev.result : '',
        structured: ev.structured_output || null,
        sessionId,
        denials: (ev.permission_denials || []).map(d => d.tool_name).filter(Boolean),
      });
    }
  }

  function onExit(p, code, error) {
    if (p.exited) return;
    p.exited = true;
    if (p !== proc) return; // ya se descartó (cancelado o inactivo)
    proc = null;
    clearIdle();
    // Si no se pudo reanudar la conversación guardada, el siguiente intento empieza de cero.
    if (p.resumed && !p.gotResult && /no conversation found/i.test(p.stderr)) sessionId = null;
    if (!turn) return;
    const t = turn;
    turn = null;
    if (error && error.code === 'ENOENT') t.reject(fail('not_found', error.message));
    else t.reject(fail('failed', p.stderr.trim() || (error && error.message) || `claude terminó con código ${code}`));
  }

  function spawnProc() {
    const args = [...launcher.args, ...buildArgs({ ...argOpts, resume: sessionId })];
    // ASTRO_INTERNAL evita que los hooks de aviso disparen notificaciones por las llamadas del propio Astro.
    const env = { ...process.env, ...launcher.env, ASTRO_INTERNAL: '1' };
    const child = spawn(launcher.command, args, { cwd, env, windowsHide: true, detached: OWN_GROUP });
    const p = { child, stderr: '', resumed: !!sessionId, gotResult: false, exited: false };
    const lines = lineSplitter(line => handleLine(p, line));
    // setEncoding usa un decodificador con estado: un carácter multibyte partido entre dos trozos no se rompe.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => lines.push(d));
    child.stderr.on('data', d => { p.stderr = (p.stderr + d).slice(-4000); });
    child.stdin.on('error', () => {});
    child.on('error', e => onExit(p, null, e));
    child.on('close', code => { lines.flush(); onExit(p, code); });
    return p;
  }

  const rejected = err => {
    const done = Promise.reject(err);
    done.catch(() => {});
    return { done, cancel() {} };
  };

  return {
    get sessionId() { return sessionId; },
    get busy() { return !!turn; },
    get alive() { return !!proc; },
    get pid() { return proc ? proc.child.pid : null; },
    get model() { return argOpts.model; },

    /** Cambia cuánto espera sin uso antes de cerrar el proceso (cada uno ocupa ~400 MB). */
    setIdle(ms) { idleMs = ms; if (proc && !turn) armIdle(); return this; },

    /** Arranca el proceso sin enviarle nada, para que el primer turno no espere al CLI. */
    warm() {
      if (!closed && !proc) {
        try { proc = spawnProc(); armIdle(); } catch { /* send() volverá a intentarlo y avisará del error */ }
      }
      return this;
    },

    send(text, onEvent = () => {}) {
      if (closed) return rejected(fail('cancelled', 'Conversación cerrada'));
      if (turn) return rejected(fail('busy', 'Ya hay una pregunta en curso'));
      clearIdle();
      try { if (!proc) proc = spawnProc(); } catch (e) { return rejected(fail('not_found', e.message)); }
      let t;
      const done = new Promise((resolve, reject) => { t = { resolve, reject, onEvent }; });
      const switchTo = typeof text === 'string' && /^\/model\s+(\S+)/.exec(text.trim());
      if (switchTo) t.model = switchTo[1];
      turn = t;
      // Texto o bloques de contenido de la API (p. ej. una imagen seguida de la pregunta).
      const content = Array.isArray(text) ? text : String(text);
      proc.child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
      return {
        done,
        cancel() {
          if (turn !== t) return;
          turn = null;
          stop();
          t.reject(fail('cancelled', 'Cancelado'));
        },
      };
    },

    close() {
      closed = true;
      clearIdle();
      if (turn) { const t = turn; turn = null; t.reject(fail('cancelled', 'Conversación cerrada')); }
      stop();
    },
  };
}

/** Procesos ya arrancados y a la espera, para que una conversación nueva no pague el arranque. */
function createPool(factory) {
  const ready = [];
  return {
    get size() { return ready.length; },
    take() { return (ready.shift() || factory()).warm(); },
    fill(n = 1) { while (ready.length < n) ready.push(factory().warm()); },
    closeAll() { ready.splice(0).forEach(s => s.close()); },
  };
}

module.exports = { createClaudeSession, createPool, describeTool, buildArgs, lineSplitter };
