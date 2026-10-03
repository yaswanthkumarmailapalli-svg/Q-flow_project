// Zero-dependency static server: `npm run web` -> http://localhost:8000 (for quick laptop testing).
// Serves src/ directly (Leaflet from the unpkg CDN). Set QFLOW_SERVE=www to serve the built www/ instead.
// Listens on 127.0.0.1 only; set HOST=0.0.0.0 to open it to your local network (e.g. to try it on a phone).
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', process.env.QFLOW_SERVE === 'www' ? 'www' : 'src'), port = process.env.PORT || 8000;
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((q, s) => {
  let rel;
  try { rel = decodeURIComponent(q.url.split('?')[0]); } catch (e) { s.writeHead(400); return s.end('Bad request'); }
  let p = path.join(root, rel); if (q.url === '/') p = path.join(root, 'index.html');
  if (!p.startsWith(root + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end('Not found'); }
  s.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
}).listen(port, host, () => console.log('Q-FLOW running at http://' + (host === '127.0.0.1' ? 'localhost' : host) + ':' + port + ' (serving ' + path.relative(path.join(__dirname, '..'), root) + '/)'));
