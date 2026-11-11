/**
 * Multi-tenant routing and identity (docs/MULTI_TENANT_PLAN.md sections 2 and 4), exercised through the real request handler:
 * resolution order, slug prefix stripping, suspended / unknown tenants, custom-domain verification, per-tenant cookies and
 * sessions, and the reserved-slug list against the real route tree in src/app.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { hashPassword } = require('../server/admins');
const { slugProblem, RESERVED, ROUTES } = require('../src/lib/reservedSlugs');
const { freshDb, closeShared } = require('./test-db');

const ENV = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '2000', STATIC_DIR: path.join(__dirname, 'no-such-dist') };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
const tempDirs = [];
test.after(async () => { await closeShared(); for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });

function call(backend, url, { method = 'GET', body, headers = {}, host = 'app.test' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host, ...headers }, socket: { remoteAddress: 'routing-test' } });
    const out = { headers: {} };
    const chunks = [];
    // A real Writable: static files are streamed with pipe(), which a plain object cannot receive.
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; return res; };
    res.on('finish', () => {
      const text = Buffer.concat(chunks).toString();
      try { out.body = text ? JSON.parse(text) : undefined; } catch { out.text = text; }
      resolve(out);
    });
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const bearer = token => ({ authorization: `Bearer ${token}` });

async function setup() {
  const db = await freshDb();
  const records = {};
  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline }, dnsResolver: async name => records[name] || Promise.reject(Object.assign(new Error('NXDOMAIN'), { code: 'ENOTFOUND' })) });
  await backend.db.query('select 1');
  const now = Date.now();
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',$1,$1) ON CONFLICT (id) DO NOTHING", [now]);
  for (const id of ['acme', 'globex', 'frozen']) {
    await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES($1,$1,$1,'instance',$2,$3,$3)", [id, id === 'frozen' ? 'suspended' : 'active', now]);
    await db.query('INSERT INTO admin_accounts(tenant_id,admin_id,email,pw_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id, `owner-${id}`, `owner@${id}.test`, hashPassword(`pw-${id}-123456`), now]);
  }
  backend.tenants.invalidate();
  return { db, backend, records };
}
const login = (backend, slug, extra = {}) => call(backend, `${slug ? `/${slug}` : ''}/api/admin/login`, { method: 'POST', headers: native, body: { email: `owner@${slug}.test`, password: `pw-${slug}-123456` }, ...extra });

test('the slug prefix is stripped, every tenant has its own admin and cookie path, and sessions never cross tenants', async () => {
  const { backend } = await setup();
  const acme = await login(backend, 'acme');
  assert.equal(acme.status, 200, JSON.stringify(acme.body));
  assert.match(acme.headers['set-cookie'], /Path=\/acme\/api;/);
  const globex = await login(backend, 'globex');
  assert.match(globex.headers['set-cookie'], /Path=\/globex\/api;/);
  // The default tenant keeps today's path; a tenant admin's credentials mean nothing there, and the built-in admin means nothing in a tenant.
  const own = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  assert.equal(own.status, 200);
  assert.match(own.headers['set-cookie'], /Path=\/api;/);
  assert.equal((await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'owner@acme.test', password: 'pw-acme-123456' } })).status, 401);
  assert.equal((await call(backend, '/acme/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } })).status, 401, 'no built-in admin/admin in a tenant');
  assert.equal((await call(backend, '/acme/api/admin/login', { method: 'POST', headers: native, body: { email: 'owner@globex.test', password: 'pw-globex-123456' } })).status, 401);
  // A session token only works under the tenant that issued it.
  const check = (slug, token) => call(backend, `${slug ? `/${slug}` : ''}/api/admin/session`, { headers: bearer(token) });
  assert.equal((await check('acme', acme.body.token)).status, 200);
  assert.equal((await check('globex', acme.body.token)).status, 401);
  assert.equal((await check('', acme.body.token)).status, 401);
  assert.equal((await check('acme', globex.body.token)).status, 401);
  assert.equal((await check('acme', own.body.token)).status, 401);
  assert.equal((await check('', own.body.token)).status, 200);
  // Client (end user) sessions are per tenant too: the same phone number is two different people.
  const user = await call(backend, '/acme/api/user/login', { method: 'POST', headers: native, body: { name: 'amine', phone: '0626900460' } });
  assert.equal(user.status, 200, JSON.stringify(user.body));
  assert.match(user.headers['set-cookie'], /Path=\/acme\/api;/);
  assert.equal((await call(backend, '/acme/api/user/session', { headers: { 'x-user-token': user.body.token } })).status, 200);
  assert.equal((await call(backend, '/globex/api/user/session', { headers: { 'x-user-token': user.body.token } })).status, 401);
  assert.equal((await call(backend, '/api/user/session', { headers: { 'x-user-token': user.body.token } })).status, 401);
  const other = await call(backend, '/globex/api/user/login', { method: 'POST', headers: native, body: { name: 'amine', phone: '0626900460' } });
  assert.equal(other.status, 200);
  assert.notEqual(other.body.user.id, user.body.user.id, 'same phone, different tenant: a different client');
});

test('unknown, reserved and suspended slugs', async () => {
  const { backend } = await setup();
  const unknown = await call(backend, '/nobody/api/content');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'TENANT_NOT_FOUND');
  const page = await call(backend, '/nobody/admin');
  assert.equal(page.status, 404);
  assert.match(page.text, /Not found/);
  // Reserved words and route names are never slugs: they belong to the default tenant exactly as before.
  assert.equal((await call(backend, '/api/health')).status, 200);
  for (const route of ['/admin/login', '/lead', '/chat/abc', '/settings']) assert.notEqual((await call(backend, route)).text, 'Not found', `${route} is an app route, not a tenant`);
  // A suspended tenant is cut off everywhere and says nothing about its data.
  const api = await call(backend, '/frozen/api/content');
  assert.equal(api.status, 403);
  assert.equal(api.body.code, 'TENANT_SUSPENDED');
  assert.equal((await call(backend, '/frozen/api/admin/login', { method: 'POST', headers: native, body: { email: 'owner@frozen.test', password: 'pw-frozen-123456' } })).status, 403);
  const html = await call(backend, '/frozen/admin');
  assert.equal(html.status, 503);
  assert.match(html.text, /unavailable/);
  // Suspending an active tenant takes effect as soon as the resolver cache is dropped (the super admin does this on every write).
  const { token } = (await login(backend, 'acme')).body;
  await backend.db.query("UPDATE saas_tenants SET status='suspended' WHERE id='acme'");
  backend.tenants.invalidate();
  assert.equal((await call(backend, '/acme/api/admin/session', { headers: bearer(token) })).status, 403);
  await backend.db.query("UPDATE saas_tenants SET status='active' WHERE id='acme'");
  backend.tenants.invalidate();
  assert.equal((await call(backend, '/acme/api/admin/session', { headers: bearer(token) })).status, 200, 'the session survives a suspension: nothing was deleted');
});

test('native apps pick the tenant with X-Dwira-Tenant; the super admin lives on the platform host only', async () => {
  const { backend } = await setup();
  const viaHeader = await call(backend, '/api/admin/login', { method: 'POST', headers: { ...native, 'x-dwira-tenant': 'acme' }, body: { email: 'owner@acme.test', password: 'pw-acme-123456' } });
  assert.equal(viaHeader.status, 200, JSON.stringify(viaHeader.body));
  assert.equal((await call(backend, '/api/admin/session', { headers: { ...native, 'x-dwira-tenant': 'acme', ...bearer(viaHeader.body.token) } })).status, 200);
  assert.equal((await call(backend, '/api/admin/session', { headers: bearer(viaHeader.body.token) })).status, 401, 'without the header it is the default tenant');
  assert.equal((await call(backend, '/api/content', { headers: { ...native, 'x-dwira-tenant': 'ghost' } })).status, 404);
  assert.equal((await call(backend, '/api/content', { headers: { 'x-dwira-tenant': 'acme' } })).status, 200, 'the header is ignored unless the request says it is a native app');
  for (const target of ['/acme/api/super-admin/tenants', '/acme/super-admin', '/globex/super-admin/x']) assert.equal((await call(backend, target)).status, 404, `${target} must not exist under a tenant`);
});

test('custom domains: only a verified domain routes, ownership needs the DNS record, one tenant per domain', async () => {
  const { backend, records } = await setup();
  const { domains } = backend.tenants;
  const added = await domains.add('acme', 'Shop.Brand.com');
  assert.equal(added.domain, 'shop.brand.com');
  assert.equal(added.verified, false);
  assert.equal(added.txtName, '_dwira-verify.shop.brand.com');
  // Unverified: the host is just an unknown host on the platform, i.e. the default tenant. It must NOT serve acme.
  const before = await login(backend, '', { host: 'shop.brand.com', body: { email: 'owner@acme.test', password: 'pw-acme-123456' } });
  assert.equal(before.status, 401);
  await assert.rejects(() => domains.verify('acme', 'shop.brand.com'), error => error.status === 409 && error.message === 'DOMAIN_NOT_VERIFIED');
  records['_dwira-verify.shop.brand.com'] = [['wrong-token']];
  await assert.rejects(() => domains.verify('acme', 'shop.brand.com'), error => error.message === 'DOMAIN_NOT_VERIFIED');
  // Another tenant cannot verify somebody else's pending domain.
  records['_dwira-verify.shop.brand.com'] = [[added.txtValue]];
  await assert.rejects(() => domains.verify('globex', 'shop.brand.com'), error => error.status === 404);
  const done = await domains.verify('acme', 'shop.brand.com');
  assert.equal(done.verified, true);
  const ok = await login(backend, '', { host: 'shop.brand.com', body: { email: 'owner@acme.test', password: 'pw-acme-123456' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.headers['set-cookie'], /Path=\/api;/, 'a custom domain serves the tenant at the root: cookie path /api');
  assert.equal((await call(backend, '/api/admin/session', { host: 'shop.brand.com', headers: bearer(ok.body.token) })).status, 200);
  assert.equal((await call(backend, '/api/admin/session', { host: 'other.brand.com', headers: bearer(ok.body.token) })).status, 401);
  assert.equal((await call(backend, '/api/admin/session', { host: 'shop.brand.com:8443', headers: bearer(ok.body.token) })).status, 200, 'port ignored');
  // A verified domain cannot be taken over; suspension applies to domains too; the super admin is unreachable there.
  await assert.rejects(() => domains.add('globex', 'shop.brand.com'), error => error.message === 'DOMAIN_TAKEN');
  assert.equal((await call(backend, '/api/super-admin/tenants', { host: 'shop.brand.com' })).status, 404);
  await backend.db.query("UPDATE saas_tenants SET status='suspended' WHERE id='acme'");
  backend.tenants.invalidate();
  assert.equal((await call(backend, '/api/content', { host: 'shop.brand.com' })).status, 403);
  await backend.db.query("UPDATE saas_tenants SET status='active' WHERE id='acme'");
  // Removal takes it offline at once.
  await domains.remove('acme', 'shop.brand.com');
  assert.equal((await call(backend, '/api/admin/session', { host: 'shop.brand.com', headers: bearer(ok.body.token) })).status, 401);
  // Invalid and platform-owned names are refused; the number of domains per tenant is limited.
  for (const bad of ['', 'localhost', '10.0.0.1', 'a b.com', 'x.vercel.app', 'nodot', 'https://x.com']) await assert.rejects(() => domains.add('acme', bad), error => error.status === 400 || error.status === 409, bad);
  for (const name of ['a1.brand.com', 'a2.brand.com', 'a3.brand.com']) await domains.add('globex', name);
  await assert.rejects(() => domains.add('globex', 'a4.brand.com'), error => error.message === 'TOO_MANY_DOMAINS');
  // The super admin may force-verify (no DNS).
  assert.equal((await domains.verify('globex', 'a1.brand.com', { force: true })).verified, true);
});

test('PLATFORM_HOSTS: with a configured platform, an unknown host is refused instead of serving the default tenant', async () => {
  const db = await freshDb();
  const backend = createBackend({ env: { ...ENV, PLATFORM_HOSTS: 'app.test' }, db, media: { storage: null, download: offline } });
  await backend.db.query('select 1');
  assert.equal((await call(backend, '/api/health', { host: 'app.test' })).status, 200);
  const stranger = await call(backend, '/api/content', { host: 'stranger.example.org' });
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.code, 'TENANT_NOT_FOUND');
  await assert.rejects(() => backend.tenants.domains.add('default', 'sub.app.test'), error => error.message === 'DOMAIN_RESERVED');
});

test('reserved slugs: format, reserved words, and every top-level route of src/app', () => {
  assert.equal(slugProblem('acme'), null);
  assert.equal(slugProblem('my-shop-2'), null);
  for (const bad of ['', 'ab', 'a', '-acme', 'acme-', 'Acme', 'ac me', 'a'.repeat(41), 'x--y', 'acme/admin', '../x', null, 5]) assert.equal(slugProblem(bad), 'invalid', String(bad));
  for (const word of ['admin', 'api', 'super-admin', 'superadmin', 'default', 'login', 'lead-success', 'www', 'demos', 'assets', 'icons']) assert.equal(slugProblem(word), 'reserved', word);
  // Whatever screen exists in src/app must be reserved, otherwise a tenant slug could shadow it (or it could shadow a tenant).
  const app = path.join(__dirname, '..', 'src', 'app');
  const tops = new Set();
  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name.replace(/\.(tsx|ts|jsx|js)$/, '');
      if (name.startsWith('_') || name.startsWith('+') || name.startsWith('[')) continue;
      if (entry.isDirectory() && /^\(.*\)$/.test(name)) { walk(path.join(dir, entry.name), depth); continue; } // route group: not part of the URL
      if (depth === 0) tops.add(name === 'index' ? '' : name);
    }
  };
  walk(app, 0);
  tops.delete('');
  assert(tops.size >= 10, `found the top-level routes (${[...tops]})`);
  for (const top of tops) assert(RESERVED.has(top), `src/app/${top} is a route but is not in src/lib/reservedSlugs.js: a tenant could take that slug`);
  for (const route of ROUTES) assert(tops.has(route), `reservedSlugs lists '${route}' but src/app has no such route: remove it or fix the typo`);
});

test('pages: a tenant URL serves the SPA shell, assets stay at the root, and each tenant has its own web-app manifest', async () => {
  const os = require('node:os');
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-dist-'));
  tempDirs.push(dist); // removed after ALL tests: sendFile may still be reading when the test body returns
  fs.mkdirSync(path.join(dist, '_expo', 'static', 'js', 'web'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(dist, 'manifest.webmanifest'), '{"name":"Dwira"}');
  fs.writeFileSync(path.join(dist, '_expo', 'static', 'js', 'web', 'entry.js'), 'console.log(1)');
  {
    const db = await freshDb();
    const backend = createBackend({ env: { ...ENV, STATIC_DIR: dist }, db, media: { storage: null, download: offline } });
    await backend.db.query('select 1');
    const now = Date.now();
    await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('acme','acme','Acme Interiors','instance','active',$1,$1)", [now]);
    await db.query("INSERT INTO saas_domains(domain,tenant_id,token,verified_at,created_at) VALUES('brand.test','acme','t',$1,$1)", [now]);
    backend.tenants.invalidate();
    const shell = async (url, host) => (await call(backend, url, { host })).status;
    for (const url of ['/acme', '/acme/', '/acme/admin', '/acme/admin/settings', '/acme/lead', '/acme/chat/abc']) assert.equal(await shell(url), 200, `${url} serves the SPA shell`);
    assert.equal(await shell('/', 'brand.test'), 200);
    assert.equal(await shell('/admin', 'brand.test'), 200, 'brand.test/admin');
    assert.equal(await shell('/_expo/static/js/web/entry.js'), 200, 'the shared bundle is served from the root for every tenant');
    assert.equal(await shell('/_expo/static/js/web/entry.js', 'brand.test'), 200);
    assert.equal(await shell('/_expo/static/js/web/missing.js'), 404);
    assert.equal(await shell('/nobody/admin'), 404, 'an unknown slug is not the SPA');
    // The default tenant keeps the static manifest; any other tenant gets its own name and a scope under its prefix.
    const root = await call(backend, '/manifest.webmanifest');
    assert.equal(root.status, 200);
    assert.equal(root.body.name, 'Dwira', 'the default tenant gets the static file as is');
    assert.equal(root.body.scope, undefined);
    const slug = await call(backend, '/acme/api/manifest.webmanifest');
    assert.equal(slug.status, 200);
    assert.equal(slug.body.name, 'Acme Interiors');
    assert.equal(slug.body.scope, '/acme/');
    assert.equal(slug.body.start_url, '/acme/');
    const domain = await call(backend, '/manifest.webmanifest', { host: 'brand.test' });
    assert.equal(domain.body.name, 'Acme Interiors');
    assert.equal(domain.body.scope, '/', 'on its own domain the tenant lives at the root');
    assert.equal((await call(backend, '/api/manifest.webmanifest')).status, 404, 'the default tenant has no generated manifest');
  }
});
