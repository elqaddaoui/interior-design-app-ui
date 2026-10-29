/**
 * Static hosting of the web export (dist/) for the long-running Node server, with the same behaviour as vercel.json:
 *  - an existing file is served as is (Vercel checks the filesystem before applying rewrites);
 *  - a missing path is rewritten to /index.html (SPA fallback), EXCEPT the prefixes vercel.json excludes, which answer 404;
 *  - the same Cache-Control and security headers.
 * scripts/check-node-hosting.js compares this module with the rules compiled from vercel.json, so the two cannot drift apart.
 */
const fs = require('node:fs');
const path = require('node:path');
const { sendFile } = require('./compress');

/** vercel.json: "/((?!api/|_expo/|assets/|icons/|push-sw\\.js|manifest\\.webmanifest|favicon\\.ico).*)" -> /index.html */
const NO_FALLBACK = /^\/(?:api\/|_expo\/|assets\/|icons\/|push-sw\.js|manifest\.webmanifest|favicon\.ico)/;
const spaFallback = pathname => !NO_FALLBACK.test(pathname);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.map': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

/** Security headers that vercel.json adds to every response. */
const SECURITY = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };

/** Cache-Control per path, as in vercel.json (Vercel's default for other static files is "public, max-age=0, must-revalidate"). */
function cacheFor(pathname) {
  if (pathname === '/push-sw.js' || pathname === '/index.html') return 'public, max-age=0, must-revalidate';
  if (/^\/(?:_expo\/static|assets)\//.test(pathname)) return 'public, max-age=31536000, immutable';
  if (/^\/icons\//.test(pathname) || pathname === '/favicon.ico') return 'public, max-age=2592000, stale-while-revalidate=86400';
  if (pathname === '/manifest.webmanifest') return 'public, max-age=86400, stale-while-revalidate=604800';
  return 'public, max-age=0, must-revalidate';
}

/**
 * Decides what a GET/HEAD for `rawPathname` serves: { file, pathname } (pathname = the path whose headers apply) or { status }.
 * Exported for tests.
 */
function resolveStatic(root, rawPathname) {
  let pathname;
  try { pathname = decodeURIComponent(rawPathname); } catch { return { status: 400 }; }
  if (pathname.includes('\0')) return { status: 400 };
  const file = path.resolve(root, '.' + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) return { status: 403 };
  // Never expose dotfiles copied from public/ (.htaccess) or hidden folders; .well-known is the usual exception.
  const hidden = pathname.split('/').some(part => part.startsWith('.') && part !== '.well-known');
  if (!hidden) {
    try { if (fs.statSync(file).isFile()) return { file, pathname }; } catch { /* missing */ }
  }
  if (!spaFallback(pathname)) return { status: 404 };
  return { file: path.join(root, 'index.html'), pathname: '/index.html' };
}

function createStatic(root) {
  root = path.resolve(root);
  const index = path.join(root, 'index.html');
  return {
    root,
    available: () => fs.existsSync(index),
    /** Serves a non-API request. Returns false when the method is not GET/HEAD. */
    handle(req, res, url) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { ...SECURITY, Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
        return;
      }
      const found = resolveStatic(root, url.pathname);
      if (found.status || !fs.existsSync(found.file)) {
        const status = found.status || 503;
        const body = status === 404 ? 'Not found' : status === 503 ? 'The web app is not built yet: run "npm run build:web".' : 'Bad request';
        res.writeHead(status, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      const headers = { ...SECURITY, 'Content-Type': TYPES[path.extname(found.file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cacheFor(found.pathname) };
      if (found.pathname === '/push-sw.js') headers['Service-Worker-Allowed'] = '/';
      sendFile(req, res, found.file, headers);
    },
  };
}

module.exports = { createStatic, resolveStatic, spaFallback, cacheFor, SECURITY };
