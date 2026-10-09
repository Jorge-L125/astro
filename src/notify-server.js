const http = require('http');
const crypto = require('crypto');

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Servidor local que recibe avisos de los hooks de Claude Code (ver hooks/astro-notify.js).
// Exige el token del arranque y JSON: una página web no puede enviar ninguna de las dos cosas sin
// una petición previa (preflight) que este servidor nunca acepta.
function startNotifyServer(port, onNotify, { token, onListening = () => {} } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/event') return res.writeHead(404).end();
    if (token && !sameToken(req.headers['x-astro-token'], token)) return res.writeHead(403).end();
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return res.writeHead(415).end();
    let body = '';
    req.setEncoding('utf8');
    req.on('data', d => {
      body += d;
      if (body.length > 256 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        onNotify({
          event: String(p.event || 'Stop'),
          project: String(p.project || '').slice(0, 60),
          // El mensaje entero (markdown incluido): la nube muestra un resumen y el panel, el texto completo.
          message: String(p.message || '').slice(0, 20000),
        });
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  server.on('error', e => console.error(`[astro] Servidor de avisos no disponible en el puerto ${port}:`, e.message));
  server.listen(port, '127.0.0.1', () => onListening(server.address().port));
  return server;
}

module.exports = { startNotifyServer };
