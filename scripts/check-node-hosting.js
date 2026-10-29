/**
 * Long-running Node server (Hostinger managed Node.js, VPS, `npm run start:server`):
 *  - environment validation and readable startup failures, without leaking credentials;
 *  - PORT / platform detection;
 *  - static hosting identical to vercel.json (SPA fallback exclusions and Cache-Control), compared rule by rule;
 *  - the in-memory sync version cache;
 *  - a real `node server/start.js` process: startup message, /api/health, dist/ + SPA fallback, clean SIGTERM;
 *  - Hostinger's start-up contract: no `require.main` guard, listen() immediately, the database connects in the background
 *    (retrying while a Neon database wakes up), /api answers 503 "starting" until then, no credential in any log.
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

const stripComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

test('start.js has no require.main guard (Hostinger loads the entry file through its own wrapper)', () => {
  const code = stripComments(fs.readFileSync(path.join(root, 'server/start.js'), 'utf8'));
  assert.equal(/require\.main/.test(code), false);
  assert.match(code, /^start\(\);/m, 'start() runs whenever the file is loaded');
});

test('loading start.js with require() (not as the main module) still starts the server immediately, before the database', async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(path.join(root, 'server/start.js'))})`], { env: baseEnv({ PORT: String(port), PGLITE_DIR: ':memory:', DISABLE_DEFAULT_ADMIN: 'true' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const startedAt = Date.now();
  let stdout = '';
  child.stdout.on('data', d => { stdout += d; });
  const exited = new Promise(resolve => child.on('exit', resolve));
  try {
    let listenedAfter = null;
    while (listenedAfter === null && Date.now() - startedAt < 5000) {
      if (stdout.includes('Server ready')) listenedAfter = Date.now() - startedAt;
      else await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.notEqual(listenedAfter, null, `no "Server ready" within 5 s:\n${stdout}`);
    assert(listenedAfter < 1000, `listen() took ${listenedAfter} ms (must be well under 1 s)`);
    assert.match(stdout, /connecting in the background/);
    child.kill('SIGTERM');
    await exited;
  } finally { child.kill('SIGKILL'); }
});

/**
 * Preloaded into a real server process: replaces createDb with a wrapper whose database "sleeps" (rejects with
 * ECONNREFUSED, like a suspended Neon endpoint) until a gate file exists, then wakes up (the real in-memory PGlite).
 */
function sleepingDatabaseFixture(dir) {
  const gate = path.join(dir, 'awake');
  const preload = path.join(dir, 'sleeping-db.js');
  fs.writeFileSync(preload, `
const fs = require('node:fs');
const dbModule = require(${JSON.stringify(path.join(root, 'server/db.js'))});
const real = dbModule.createDb;
dbModule.createDb = env => {
  const db = real(env);
  const wait = () => { if (!fs.existsSync(${JSON.stringify(gate)})) throw Object.assign(new Error('connect ECONNREFUSED postgresql://neondb_owner:${SECRET}@ep-sleeping.example/neondb'), { code: 'ECONNREFUSED' }); };
  return { ...db, info: async () => { wait(); return db.info(); }, query: async (...args) => { wait(); return db.query(...args); }, tx: async (...args) => { wait(); return db.tx(...args); } };
};
`);
  return { gate, preload };
}

test('start.js listens first; /api/health is 503 "starting" and other /api routes 503 until the sleeping database wakes up, then everything works', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-sleep-'));
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  const { gate, preload } = sleepingDatabaseFixture(dir);
  const port = await freePort();
  const started = Date.now();
  const { child, out, exited } = run(baseEnv({ PORT: String(port), PGLITE_DIR: ':memory:', STATIC_DIR: dist, DISABLE_DEFAULT_ADMIN: 'true', DB_RETRY_MS: '100', NODE_OPTIONS: `--require ${preload}` }));
  const url = pathname => `http://127.0.0.1:${port}${pathname}`;
  const waitFor = async (check, label, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error(`timeout: ${label}\n${out.stdout}\n${out.stderr}`);
  };
  try {
    // 1. The port opens quickly even though the database is asleep.
    await waitFor(() => out.stdout.includes('Server ready'), 'Server ready');
    assert(Date.now() - started < 1500, `listening took ${Date.now() - started} ms`);

    // 2. During start-up: health is 503 / "starting", API routes are 503 with a clear message, static files work.
    const health = await fetch(url('/api/health'));
    assert.equal(health.status, 503);
    const starting = await health.json();
    assert.equal(starting.ok, false);
    assert.equal(starting.database, 'starting');
    assert.equal(health.headers.get('retry-after'), '5');
    for (const pathname of ['/api/sync', '/api/content', '/api/user/session', '/api/media/' + 'a'.repeat(32) + '.png']) {
      const response = await fetch(url(pathname));
      assert.equal(response.status, 503, pathname);
      assert.match((await response.json()).error, /database is starting up/i, pathname);
    }
    const login = await fetch(url('/api/user/login'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(login.status, 503);
    assert.equal((await fetch(url('/admin'))).status, 200, 'the web app is served while the database starts');
    assert.equal(out.stdout.includes('Database connected'), false);

    // 3. The database keeps being retried in the background (and the log never shows the connection string or password).
    await waitFor(() => /Database not reachable yet \(attempt 2,/.test(out.stderr), 'a retry');

    // 4. The database wakes up: ready without a restart.
    fs.writeFileSync(gate, '');
    await waitFor(() => out.stdout.includes('Database connected'), 'Database connected');
    const ready = await fetch(url('/api/health'));
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.equal(body.ok, true);
    assert.equal(body.database, 'pglite');
    assert.equal((await fetch(url('/api/sync'))).status, 200);
    assert.equal((await fetch(url('/api/content'))).status, 200);
    assert.equal((await fetch(url('/api/nope'))).status, 404);

    const logs = out.stdout + out.stderr;
    assert.equal(logs.includes(SECRET), false, 'no credential in the logs');
    assert.equal(logs.includes('neondb_owner'), false);
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
  } finally { child.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a Postgres that refuses connections keeps the server up: health stays 503 "starting", retries are logged without the URL', async () => {
  const port = await freePort();
  const dead = await freePort(); // nothing listens there: ECONNREFUSED, like an unreachable endpoint
  const url = `postgresql://neondb_owner:${SECRET}@127.0.0.1:${dead}/neondb`;
  const { child, out, exited } = run(baseEnv({ PORT: String(port), DATABASE_URL: url, DISABLE_DEFAULT_ADMIN: 'true', DB_RETRY_MS: '100' }), { untilLog: 'Server ready' });
  try {
    await new Promise(resolve => setTimeout(resolve, 0));
    const until = Date.now() + 10000;
    while (!/attempt 2,/.test(out.stderr) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(out.stderr, /Database not reachable yet \(attempt 1, ECONNREFUSED\)/);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(health.status, 503);
    assert.equal((await health.json()).database, 'starting');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/sync`)).status, 503);
    const logs = out.stdout + out.stderr;
    assert.equal(logs.includes(SECRET), false);
    assert.equal(logs.includes('neondb_owner'), false);
    child.kill('SIGTERM');
    assert.equal(await exited, 0);
  } finally { child.kill('SIGKILL'); }
});

test('warmUp retries with a growing delay, redacts what it logs and reports ready once', async () => {
  const { warmUp } = require('../server/warmup');
  const lines = [];
  const log = { log: line => lines.push(line), error: line => lines.push(line) };
  let calls = 0;
  const db = { info: async () => { if (++calls < 4) throw new Error(`password ${SECRET} rejected`); return 'pg'; } };
  let readyCalls = 0;
  const state = warmUp(db, { log, minDelayMs: 5, maxDelayMs: 20, redact: message => String(message).split(SECRET).join('***'), onReady: () => { readyCalls++; } });
  const until = Date.now() + 3000;
  while (!state.ready && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(state.ready, true);
  assert.equal(state.attempts, 4);
  assert.equal(readyCalls, 1);
  assert.match(lines.join('\n'), /attempt 1, password \*\*\* rejected/);
  assert.equal(lines.join('\n').includes(SECRET), false);
  assert.match(lines.at(-1), /Database connected \(attempt 4\)/);
  // stop() cancels pending retries
  const failing = warmUp({ info: async () => { throw new Error('x'); } }, { log, minDelayMs: 5 });
  await new Promise(resolve => setTimeout(resolve, 20));
  failing.stop();
  const attempts = failing.attempts;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(failing.attempts, attempts);
});
