// Imita `claude -p --input-format stream-json --output-format stream-json` para las pruebas.
// El contenido de cada mensaje decide qué hace:
//   "slow"   no responde nunca (para probar la cancelación)
//   "split"  parte un carácter multibyte entre dos escrituras
//   "crash"  escribe en stderr y termina con código 3
//   "error"  devuelve un resultado con is_error
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
  out({ type: 'system', subtype: 'init', session_id: sessionId });
  if (content === 'slow') return;
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
