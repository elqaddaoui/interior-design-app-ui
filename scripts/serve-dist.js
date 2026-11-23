#!/usr/bin/env node
/** Tiny static server for `dist/` with the same SPA fallback as vercel.json (used for local production checks). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendFile } = require('../server/compress');
const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.PORT || process.argv[2] || 4173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webp': 'image/webp', '.avif': 'image/avif', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end('Invalid URL'); }
  if (/^\/api(?:\/|$)/.test(url)) { res.writeHead(503, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'BACKEND_UNAVAILABLE' })); }
  let file = path.join(root, path.normalize(url));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (/node_modules/.test(url)) { res.writeHead(404); return res.end('blocked (mimics Vercel)'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (/^\/(?:_expo|assets)\//.test(url) || url === '/favicon.ico' || url === '/push-sw.js' || url === '/sa-sw.js') { res.writeHead(404); return res.end('Asset not found'); }
    file = path.join(root, 'index.html');
  }
  const headers = { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' };
  if (path.extname(file) === '.html') headers['Cache-Control'] = 'no-cache';
  else if (/^\/(?:_expo|assets)\//.test(url)) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else if (/^\/(?:icons\/|favicon\.ico$)/.test(url)) headers['Cache-Control'] = 'public, max-age=2592000, stale-while-revalidate=86400';
  sendFile(req, res, file, headers);
}).listen(port, '0.0.0.0', () => console.log(`dist served on http://localhost:${port}`));
