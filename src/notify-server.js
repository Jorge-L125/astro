const http = require('http');

// Servidor local que recibe avisos de los hooks de Claude Code (ver hooks/astro-notify.js).
function startNotifyServer(port, onNotify) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.on('data', d => {
      body += d;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const p = JSON.parse(body);
        onNotify({
          event: String(p.event || 'Stop'),
          project: String(p.project || '').slice(0, 60),
          message: String(p.message || '').slice(0, 280),
        });
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });
  server.on('error', e => console.error(`[astro] Servidor de avisos no disponible en el puerto ${port}:`, e.message));
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startNotifyServer };
