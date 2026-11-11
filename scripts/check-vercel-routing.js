/**
 * Regression test for Vercel API routing: every /api/* path, including nested ones
 * such as /api/user/login, must reach the single function api/index.js.
 *
 * vercel.json is compiled with @vercel/routing-utils (the library the Vercel CLI uses)
 * when it is installed; otherwise a minimal equivalent compiler is used.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function compileRewrites() {
  try {
    const { getTransformedRoutes } = require('@vercel/routing-utils');
    const { routes, error } = getTransformedRoutes({ rewrites: config.rewrites });
    if (error) throw new Error(error.message);
    return routes.filter(route => route.src && route.dest);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    // Fallback: supports the two forms used in vercel.json (regex groups and a trailing :name*).
    return config.rewrites.map(({ source, destination }) => {
      const named = source.match(/^(.*)\/:(\w+)\*$/);
      if (!named) return { src: `^${source}$`, dest: destination };
      return { src: `^${named[1]}(?:/(.*))?$`, dest: destination.replace(`:${named[2]}*`, '$1') };
    });
  }
}

/** Resolve a request path the way the Vercel edge does for rewrites (first match wins). */
function resolve(requestPath) {
  for (const route of compileRewrites()) {
    const match = new RegExp(route.src).exec(requestPath);
    if (!match) continue;
    const dest = route.dest.replace(/\$(\d+)/g, (_, i) => encodeURIComponent(match[i] ?? '').replace(/%2F/gi, '/'));
    return dest;
  }
  return requestPath;
}

/** Map a destination pathname to a file in api/ (Vercel maps /api and /api/index to api/index.js). */
function functionFor(dest) {
  const { pathname } = new URL(dest, 'http://localhost');
  const candidates = pathname === '/api' || pathname === '/api/' ? ['api/index.js'] : [`${pathname.slice(1)}.js`, `${pathname.slice(1)}/index.js`];
  return candidates.find(file => fs.existsSync(path.join(root, file)));
}

const nested = ['/api/health', '/api/user/login', '/api/user/session', '/api/user/history/abc', '/api/admin/clients/1234-abcd', '/api/push/pump', '/api/requests/r_1'];

test('vercel.json routes every /api/* path (nested included) to api/index.js', () => {
  assert.deepEqual(Object.keys(config.functions), ['api/index.js']);
  assert(fs.existsSync(path.join(root, 'api/index.js')));
  assert.deepEqual(fs.readdirSync(path.join(root, 'api')), ['index.js'], 'only one function file: no filesystem catch-all');
  for (const requestPath of nested) {
    const dest = resolve(requestPath);
    assert.equal(functionFor(dest), 'api/index.js', `${requestPath} -> ${dest} must hit api/index.js`);
  }
});

test('SPA fallback still serves index.html for app routes but never for /api', () => {
  assert.equal(resolve('/lead'), '/index.html');
  assert.equal(resolve('/admin/settings'), '/index.html');
  assert.notEqual(resolve('/api/user/login'), '/index.html');
  assert.equal(resolve('/_expo/static/js/web/app.js'), '/_expo/static/js/web/app.js');
});

test('api/index.js restores the original URL for both rewritten and original req.url forms', () => {
  const { originalUrl } = require('../api');
  assert.equal(originalUrl('/api?__path=user/login'), '/api/user/login');
  assert.equal(originalUrl('/api?__path=user%2Flogin'), '/api/user/login');
  assert.equal(originalUrl('/api/index?__path=requests/r_1&token=x'), '/api/requests/r_1?token=x');
  assert.equal(originalUrl('/api/user/login?__path=user/login'), '/api/user/login');
  assert.equal(originalUrl('/api/user/login'), '/api/user/login');
  assert.equal(originalUrl('/api/push/pump?__path=push/pump&x=1'), '/api/push/pump?x=1');
});

function call(handler, url, { method = 'GET', body } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host: 'dwira.vercel.app', 'x-dwira-native': '1' }, socket: { remoteAddress: 'routing-test' } });
    const out = { headers: {} };
    const res = { headersSent: false, setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, writeHead(status) { out.status = status; this.headersSent = true; }, end(value) { out.body = value ? JSON.parse(value) : undefined; resolve(out); } };
    handler(req, res);
  });
}

test('simulated Vercel requests: POST /api/user/login reaches the backend through the rewrite', async t => {
  try { require.resolve('@electric-sql/pglite'); } catch { return t.skip('@electric-sql/pglite not installed'); }
  Object.assign(process.env, { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' });
  const handler = require('../api');
  const health = await call(handler, resolve('/api/health'));
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  const login = await call(handler, resolve('/api/user/login'), { method: 'POST', body: { name: 'amine', phone: '0626900460' } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(login.body.user.whatsapp, '+212626900460');
  const session = await call(handler, resolve('/api/user/session'));
  assert.notEqual(session.status, 404);
  const missing = await call(handler, resolve('/api/does/not/exist'));
  assert.equal(missing.status, 404);
  assert.equal(typeof missing.body, 'object', 'unknown API routes answer JSON from the backend, not a Vercel NOT_FOUND');
});

test('a tenant served under a slug reaches the function with its slug restored (multi-tenant routing)', () => {
  const { originalUrl } = require('../api');
  const dest = resolve('/acme/api/user/login');
  assert.equal(functionFor(dest), 'api/index.js');
  assert.equal(originalUrl(dest), '/acme/api/user/login');
  assert.equal(originalUrl(`${resolve('/acme/api/media/abc.png')}&x=1`), '/acme/api/media/abc.png?x=1'); // Vercel appends the original query string
  assert.equal(originalUrl(resolve('/api/user/login')), '/api/user/login');
  // Pages of a tenant are the SPA; its storefront and admin are static files behind the same fallback.
  assert.equal(resolve('/acme'), '/index.html');
  assert.equal(resolve('/acme/admin/settings'), '/index.html');
  // A forged __slug on a plain /api URL is ignored.
  assert.equal(originalUrl('/api/user/login?__slug=acme'), '/api/user/login');
});
