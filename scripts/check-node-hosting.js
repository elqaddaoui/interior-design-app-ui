/**
 * Long-running Node server (Hostinger managed Node.js, VPS, `npm run start:server`):
 *  - environment validation and readable startup failures, without leaking credentials;
 *  - PORT / platform detection;
 *  - static hosting identical to vercel.json (SPA fallback exclusions and Cache-Control), compared rule by rule;
 *  - the in-memory sync version cache;
 *  - a real `node server/start.js` process: startup message, /api/health, dist/ + SPA fallback, clean SIGTERM.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const ts = require('typescript');
const { validateEnv, resolvePort, platformName, describeDatabase, redact } = require('../server/config');
const { resolveStatic, spaFallback, cacheFor } = require('../server/static');
const { createSync } = require('../server/sync');

const root = path.join(__dirname, '..');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const SECRET = 'S3cr3t-pa55word';
const NEON = `postgresql://neondb_owner:${SECRET}@ep-cool-name-a1b2c3-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`;

test('validateEnv: DATABASE_URL is required (readable message), PGLITE_DIR is the explicit local alternative', () => {
  assert.throws(() => validateEnv({}), error => error.code === 'CONFIG_INVALID' && /DATABASE_URL is not set/.test(error.message) && /pooled/.test(error.message));
  assert.deepEqual(validateEnv({ PGLITE_DIR: ':memory:', DISABLE_DEFAULT_ADMIN: 'true' }).warnings, []);
  assert.deepEqual(validateEnv({ DATABASE_URL: NEON, DISABLE_DEFAULT_ADMIN: 'true' }).warnings, []);
  // Vercel/Neon integration names still work.
  assert.doesNotThrow(() => validateEnv({ POSTGRES_URL: NEON }));
  assert.throws(() => validateEnv({ DATABASE_URL: `mysql://u:${SECRET}@h/db` }), error => /not a valid postgres/.test(error.message) && !error.message.includes(SECRET));
  assert.throws(() => validateEnv({ DATABASE_URL: NEON, DATABASE_URL_UNPOOLED: 'nope' }), /DATABASE_URL_UNPOOLED/);
  assert.throws(() => validateEnv({ DATABASE_URL: NEON, PORT: 'abc' }), /PORT must be/);
  const direct = validateEnv({ DATABASE_URL: NEON.replace('-pooler', ''), DISABLE_DEFAULT_ADMIN: 'true' }).warnings;
  assert.equal(direct.length, 1);
  assert.match(direct[0], /pooled/);
  assert.match(validateEnv({ DATABASE_URL: NEON }).warnings.join(' '), /admin \/ admin/);
});

test('describeDatabase and redact never expose the connection string or its password', () => {
  assert.deepEqual(describeDatabase(NEON), { kind: 'postgres', provider: 'neon', pooled: true });
  assert.deepEqual(describeDatabase(''), { kind: 'pglite' });
  assert.equal(JSON.stringify(describeDatabase(NEON)).includes(SECRET), false);
  const env = { DATABASE_URL: NEON };
  const text = redact(`connect failed for ${NEON} (password ${SECRET}) and postgres://x:y@other/db`, env);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes('neondb_owner'), false);
  assert.equal(text.includes('x:y@'), false);
});

test('PORT comes from the host; defaults are 3000 on Hostinger and 8080 elsewhere', () => {
  assert.equal(resolvePort({ PORT: '3456' }), 3456);
  assert.equal(resolvePort({}, '/home/u1/domains/example.com/hbuilds/20261029/nodejs/server'), 3000);
  assert.equal(resolvePort({}, '/home/user/webapp/server'), 8080);
  assert.equal(resolvePort({ DWIRA_PLATFORM: 'hostinger' }, '/srv/app/server'), 3000);
  assert.equal(platformName({}, '/home/u1/domains/example.com/hbuilds/current/nodejs/server'), 'hostinger');
  assert.equal(platformName({ VERCEL: '1' }, '/home/u1/domains/example.com/hbuilds/current/nodejs/server'), 'vercel');
  assert.equal(platformName({}, '/home/user/webapp/server'), 'node');
});

/** vercel.json source patterns (regex groups, "(.*)") -> RegExp, as Vercel compiles them. */
const toRegExp = source => new RegExp(`^${source.replace(/\.(?![*])/g, '\\.').replace(/\\\\\./g, '\\.')}$`);

test('static hosting applies the same SPA fallback as vercel.json', () => {
  const fallback = vercel.rewrites.find(rule => rule.destination === '/index.html');
  const vercelFallback = pathname => new RegExp(`^${fallback.source}$`).test(pathname);
  const paths = ['/', '/lead', '/admin/settings', '/pro', '/render/abc', '/api/user/login', '/api/', '/_expo/static/js/web/x.js', '/assets/vendor/font.ttf', '/icons/i.png', '/push-sw.js', '/manifest.webmanifest', '/favicon.ico', '/robots.txt', '/apix', '/assetsx', '/some.page.html'];
  for (const pathname of paths) assert.equal(spaFallback(pathname), vercelFallback(pathname), `${pathname}: server and vercel.json disagree`);
});

test('static hosting sends the same Cache-Control as vercel.json', () => {
  const cacheRules = vercel.headers.filter(rule => rule.headers.some(h => h.key === 'Cache-Control'));
  const expected = pathname => {
    let value = 'public, max-age=0, must-revalidate'; // Vercel's default for static files
    for (const rule of cacheRules) if (toRegExp(rule.source).test(pathname)) value = rule.headers.find(h => h.key === 'Cache-Control').value; // last match wins
    return value;
  };
  for (const pathname of ['/index.html', '/push-sw.js', '/_expo/static/js/web/entry-abc.js', '/assets/vendor/font.ttf', '/icons/icon-192.png', '/favicon.ico', '/manifest.webmanifest', '/metadata.json']) {
    assert.equal(cacheFor(pathname), expected(pathname), pathname);
  }
  const security = vercel.headers.find(rule => rule.source === '/(.*)').headers;
  const { SECURITY } = require('../server/static');
  for (const { key, value } of security) assert.equal(SECURITY[key], value, key);
});

test('resolveStatic: files first, SPA fallback for app routes, 404 for missing assets, no traversal or dotfiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-dist-'));
  try {
    fs.mkdirSync(path.join(dir, '_expo/static/js/web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), '<html>shell</html>');
    fs.writeFileSync(path.join(dir, '_expo/static/js/web/app.js'), 'x');
    fs.writeFileSync(path.join(dir, '.htaccess'), 'secret');
    fs.writeFileSync(path.join(dir, 'push-sw.js'), 'sw');
    assert.equal(resolveStatic(dir, '/_expo/static/js/web/app.js').file, path.join(dir, '_expo/static/js/web/app.js'));
    assert.equal(resolveStatic(dir, '/push-sw.js').pathname, '/push-sw.js');
    assert.equal(resolveStatic(dir, '/admin/settings').file, path.join(dir, 'index.html'));
    assert.equal(resolveStatic(dir, '/').file, path.join(dir, 'index.html'));
    assert.equal(resolveStatic(dir, '/_expo/static/js/web/missing.js').status, 404);
    assert.equal(resolveStatic(dir, '/favicon.ico').status, 404);
    assert.equal(resolveStatic(dir, '/.htaccess').pathname, '/index.html', 'dotfiles are never served');
    assert.notEqual(resolveStatic(dir, '/%2e%2e/%2e%2e/etc/passwd').file, '/etc/passwd');
    assert.equal(resolveStatic(dir, '/%E0%A4%A').status, 400);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sync cache: repeated polls reuse the versions, a local bump is visible immediately', async () => {
  const versions = new Map();
  let reads = 0;
  const db = {
    query: async (sql, params) => {
      if (sql.startsWith('INSERT')) { versions.set(params[0], (versions.get(params[0]) || 0) + 1); return []; }
      reads++;
      return params[0].filter(key => versions.has(key)).map(key => ({ key, version: versions.get(key) }));
    },
  };
  const cached = createSync(db, { cacheMs: 60000 });
  assert.deepEqual(await cached.read(['content', 'c:1']), { content: 0, 'c:1': 0 });
  await cached.read(['content', 'c:1']);
  await cached.read(['content']);
  assert.equal(reads, 1, 'answered from memory');
  await cached.bump('content');
  assert.deepEqual(await cached.read(['content', 'c:1']), { content: 1, 'c:1': 0 });
  assert.equal(reads, 2, 'only the bumped key is read again');
  reads = 0;
  const uncached = createSync(db);
  await uncached.read(['content']); await uncached.read(['content']);
  assert.equal(reads, 2, 'Vercel (cacheMs 0) always reads');
});

test('web polling slows down only for an untouched page', () => {
  const source = fs.readFileSync(path.join(root, 'src/lib/sync.ts'), 'utf8');
  const fn = source.match(/export function webPollDelay[\s\S]*?\n}\n/)[0];
  const js = ts.transpileModule(`const POLL_MS = ${source.match(/const POLL_MS = (\d+)/)[1]};\n${fn.replace('export ', '')}\nmodule.exports = webPollDelay;`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('module', js)(module);
  const delay = module.exports;
  assert.equal(delay(0), 4000);
  assert.equal(delay(119000), 4000);
  assert.equal(delay(5 * 60000), 15000);
  assert.equal(delay(60 * 60000), 30000);
});

const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
/** Clean environment: nothing from the developer's shell (a real DATABASE_URL must never leak into this test). */
const baseEnv = extra => ({ PATH: process.env.PATH, HOME: os.tmpdir(), ...extra });
function run(env, { untilLog, timeout = 60000 } = {}) {
  const child = spawn(process.execPath, [path.join(root, 'server/start.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', d => { out.stdout += d; });
  child.stderr.on('data', d => { out.stderr += d; });
  const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
  const ready = untilLog ? new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${untilLog}" within ${timeout} ms:\n${out.stdout}\n${out.stderr}`)), timeout);
    const check = () => { if (out.stdout.includes(untilLog)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', check);
    exited.then(code => { clearTimeout(timer); reject(new Error(`exited ${code} before ready:\n${out.stdout}\n${out.stderr}`)); });
  }) : null;
  return { child, out, exited, ready };
}

test('start.js refuses to start without DATABASE_URL, with a readable error and exit code 1', async () => {
  const { out, exited } = run(baseEnv({ PORT: String(await freePort()) }));
  assert.equal(await exited, 1);
  assert.match(out.stderr, /Cannot start: configuration is incomplete/);
  assert.match(out.stderr, /DATABASE_URL is not set/);
  assert.match(out.stderr, /docs\/HOSTINGER\.md/);
});

test('start.js never prints the password of an invalid DATABASE_URL', async () => {
  const { out, exited } = run(baseEnv({ PORT: String(await freePort()), DATABASE_URL: `mysql://admin:${SECRET}@db.example.com/x` }));
  assert.equal(await exited, 1);
  assert.match(out.stderr, /not a valid postgres/);
  assert.equal((out.stdout + out.stderr).includes(SECRET), false);
});

test('start.js: one process serves /api/health and dist/ with the SPA fallback on PORT, then stops cleanly', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  const port = await freePort();
  const { child, out, exited, ready } = run(baseEnv({ PORT: String(port), PGLITE_DIR: ':memory:', STATIC_DIR: dist, DISABLE_DEFAULT_ADMIN: 'true' }), { untilLog: 'Database connected' });
  try {
    await ready;
    assert.match(out.stdout, new RegExp(`Server ready on http://0\\.0\\.0\\.0:${port}`));
    assert.match(out.stdout, /database: pglite/);
    assert.match(out.stdout, /threads: libuv 2/);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.ok, true);
    assert.equal(body.database, 'pglite');
    assert.equal(body.runtime, 'node');
    assert.equal(body.platform, 'node');
    const page = await fetch(`http://127.0.0.1:${port}/admin/settings`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /shell/);
    assert.equal(page.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal((await fetch(`http://127.0.0.1:${port}/assets/missing.png`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/nope`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/sync`)).status, 200);
    const status = fs.readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/Threads:\s+(\d+)/);
    if (status) assert(Number(status[1]) <= 12, `thread count stays low (got ${status[1]})`);
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
    assert.match(out.stdout, /SIGTERM received/);
  } finally { child.kill('SIGKILL'); fs.rmSync(dist, { recursive: true, force: true }); }
});
