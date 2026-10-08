// Imita `claude -p --input-format stream-json --output-format stream-json` para las pruebas.
// El contenido de cada mensaje decide qué hace:
//   "slow"   no responde nunca (para probar la cancelación)
//   "split"  parte un carácter multibyte entre dos escrituras
//   "crash"  escribe en stderr y termina con código 3
//   "error"  devuelve un resultado con is_error
//   "agents" lanza un subagente en segundo plano: responde a medias y, cuando termina, otra vez
//   otro     responde con { echo, pid, resume, turn }
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const resume = flag('--resume');

if (resume === 'missing') {
  process.stderr.write('No conversation found with session ID: missing\n');
  process.exit(1);
}

const sessionId = resume || `sid-${process.pid}`;
const out = obj => process.stdout.write(JSON.stringify(obj) + '\n');
let turn = 0;

function reply(content) {
  turn++;
  out({
    type: 'system', subtype: 'init', session_id: sessionId,
    slash_commands: ['clear', 'context', 'code-review', 'ultrareview', 'vim'],
    skills: ['code-review'],
    terminal_slash_commands: ['vim'],
  });
  if (content === 'slow') return;
  if (content === 'agents') return agents();
  if (content === 'crash') { process.stderr.write('boom'); process.exit(3); }
  out({ type: 'assistant', message: { content: [
    { type: 'tool_use', name: 'Read', input: { file_path: '/proyecto/src/main.js' } },
    { type: 'text', text: 'mirando' },
  ] } });
  if (content === 'error') return out({ type: 'result', is_error: true, result: 'algo salió mal', session_id: sessionId });
  const result = {
    type: 'result',
    session_id: sessionId,
    result: 'ok',
    structured_output: { echo: content === 'split' ? 'adiós ñandú' : content, pid: process.pid, resume, turn, args },
    permission_denials: [{ tool_name: 'Bash' }],
  };
  if (content !== 'split') return out(result);
  const bytes = Buffer.from(JSON.stringify(result) + '\n', 'utf8');
  const cut = bytes.indexOf(Buffer.from('ñ', 'utf8')) + 1; // entre los dos bytes de la ñ
  process.stdout.write(bytes.subarray(0, cut));
  setTimeout(() => process.stdout.write(bytes.subarray(cut)), 30);
}

// Secuencia real de Claude Code 2.1 con un subagente en segundo plano.
function agents() {
  const A = 'toolu_agentA';
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id: A, name: 'Agent', input: { description: 'Contar archivos', subagent_type: 'general-purpose', prompt: 'Cuenta los .js de src/' } }] } });
  out({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't1' }] });
  out({ type: 'system', subtype: 'task_started', task_id: 't1', tool_use_id: A });
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: A, content: [{ type: 'text', text: 'Async agent launched successfully.' }] }] } });
  out({ type: 'assistant', parent_tool_use_id: A, message: { content: [{ type: 'tool_use', name: 'Glob', input: { pattern: 'src/**/*.js' } }] } });
  out({ type: 'system', subtype: 'task_progress', task_id: 't1', tool_use_id: A, description: 'Finding src/**/*.js' });
  out({ type: 'result', session_id: sessionId, result: 'Lancé un subagente.', structured_output: { lines: ['Lancé un subagente.'] } });
  setTimeout(() => {
    out({ type: 'assistant', parent_tool_use_id: A, message: { content: [{ type: 'text', text: '13 archivos' }] } });
    out({ type: 'system', subtype: 'task_notification', task_id: 't1', tool_use_id: A, status: 'completed', summary: '13 archivos' });
    out({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
    out({ type: 'system', subtype: 'init', session_id: sessionId });
    out({ type: 'result', session_id: sessionId, result: 'Hay 13 archivos.', structured_output: { lines: ['Hay 13 archivos.'] } });
  }, 80);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    const msg = JSON.parse(line);
    reply(msg.message.content);
  }
});
process.stdin.on('end', () => process.exit(0));
