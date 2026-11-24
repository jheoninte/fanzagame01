// node serve.js  → http://localhost:8765 (静的ファイル配信のみ)
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : __dirname, port = Number(process.env.PORT) || 8765;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(port, () => console.log('http://localhost:' + port));
