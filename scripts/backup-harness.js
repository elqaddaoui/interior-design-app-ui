/** Shared helpers of the backup tests: a request driver that streams raw bodies and collects binary answers, a fake R2, a throw-away app root. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');
const yauzl = require('yauzl');
const { createBackend } = require('../server');
const { freshDb } = require('./test-db');

function call(backend, url, { method = 'GET', body, raw, headers = {}, host = 'app.test', ip = 'bk-test' } = {}) {
  return new Promise(resolve => {
    const source = raw !== undefined ? [raw] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const req = Readable.from(source);
    Object.assign(req, { url, method, headers: { ...(raw !== undefined ? { 'content-type': 'application/octet-stream' } : { 'content-type': 'application/json' }), host, ...headers }, socket: { remoteAddress: ip } });
    const out = { headers: {} };
    const chunks = [];
    const res = new Writable({ write(chunk, enc, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => {
      out.bytes = Buffer.concat(chunks);
      try { out.body = out.bytes.length ? JSON.parse(out.bytes.toString()) : undefined; } catch { /* binary */ }
      resolve(out);
    });
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const bearer = token => ({ authorization: `Bearer ${token}`, ...native });

/** In-memory R2 with the same surface as createR2Storage (plus stream). */
function fakeR2() {
  const objects = new Map();
  return {
    objects, kind: 'r2',
    publicUrl: key => `https://media.example.com/${key}`,
    put: async (key, body, mime) => { objects.set(key, { body: Buffer.from(body), mime }); },
    head: async key => (objects.has(key) ? { size: objects.get(key).body.length, mime: objects.get(key).mime } : null),
    getRange: async (key, length) => objects.get(key).body.subarray(0, length),
    remove: async key => { objects.delete(key); },
    get: async key => { if (!objects.has(key)) throw new Error('NoSuchKey'); return Buffer.from(objects.get(key).body); },
    stream: async key => { if (!objects.has(key)) throw new Error('NoSuchKey'); return Readable.from([Buffer.from(objects.get(key).body)]); },
    presignPut: async key => `https://acct.r2.cloudflarestorage.com/bucket/${key}`,
  };
}
const pngBytes = (size, seed = 7) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, seed)]);
const pngData = (size, seed) => 'data:image/png;base64,' + pngBytes(size, seed).toString('base64');

/** A small fake application directory (what an "app" backup reads and a restore writes). */
function makeAppRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-app-'));
  const put = (rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('package.json', JSON.stringify({ name: 'fake', version: '9.9.9' }));
  put('dist/index.html', '<html>app v1</html>');
  put('dist/_expo/static/js/app.js', 'console.log("app v1")');
  put('server/index.js', '// server v1');
  put('server/lib/util.js', '// util v1');
  put('server/.env', 'DATABASE_URL=postgres://user:SuperSecretDbPassword123@host/db\nSTRIPE_KEY=sk_live_ShouldNeverLeak99\n');
  put('server/.env.local', 'X=1');
  put('server/data/pglite/file', 'db files');
  put('server/data/backups/old.zip', 'old');
  put('server/cert.pem', '-----BEGIN PRIVATE KEY-----');
  put('node_modules/dep/index.js', 'dep');
  put('.env', 'TOP=secret-top-level-value');
  put('api/index.js', '// api v1');
  put('src/app/index.tsx', '// screen v1');
  put('src/data/mock/seed.ts', '// model v1');
  put('assets/icon.png', 'png');
  put('scripts/postexport.js', '// post v1');
  put('docs/README.txt', 'docs');
  put('.gitignore', 'node_modules/\n');
  put('server/.env.example', 'DATABASE_URL=\n');
  return root;
}
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

async function setup({ r2 = false, env = {}, fetch, media = true, vault } = {}) {
  const appRoot = makeAppRoot();
  const backupDir = tmp('bk-dir-');
  const mediaDir = tmp('bk-media-');
  const storage = r2 ? fakeR2() : undefined;
  const full = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', NODE_ENV: 'test', BACKUP_DIR: backupDir, BACKUP_APP_ROOT: appRoot, MEDIA_DIR: mediaDir, ...env };
  const db = await freshDb();
  const mediaOptions = r2 ? { storage, download: async () => { throw new Error('offline'); } } : { storage: media === 'fs' ? undefined : null, download: async () => { throw new Error('offline'); } };
  if (vault !== undefined) mediaOptions.vault = vault;
  const backend = createBackend({ env: full, db, media: mediaOptions, ...(fetch ? {} : {}) });
  await backend.db.query('select 1');
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const admin = bearer(login.body.token);
  return { backend, db, storage, appRoot, backupDir, mediaDir, admin, env: full, cleanup() { for (const d of [appRoot, backupDir, mediaDir]) fs.rmSync(d, { recursive: true, force: true }); } };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
/** Polls a job until it stops running. */
async function finish(backend, headers, prefix, id, { timeout = 60000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const r = await call(backend, `${prefix}/jobs/${id}`, { headers });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    if (!['queued', 'running'].includes(r.body.job.status)) return r.body.job;
    assert.ok(Date.now() - t0 < timeout, 'job timed out');
    await wait(25);
  }
}
async function startBackup(backend, headers, prefix, options) {
  const r = await call(backend, `${prefix}/jobs`, { method: 'POST', headers, body: options });
  if (r.status !== 202) return r;
  return { status: 202, job: await finish(backend, headers, prefix, r.body.job.id) };
}
async function download(backend, headers, prefix, id) {
  const r = await call(backend, `${prefix}/jobs/${id}/download`, { headers });
  return r;
}
/** Uploads a zip through the chunk API and waits for the validation job. */
async function upload(backend, headers, prefix, zip, { chunk = 100 * 1024 } = {}) {
  const created = await call(backend, `${prefix}/uploads`, { method: 'POST', headers, body: { size: zip.length } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.uploadId;
  for (let offset = 0; offset < zip.length; offset += chunk) {
    const r = await call(backend, `${prefix}/uploads/${id}/chunk?offset=${offset}`, { method: 'POST', headers, raw: zip.subarray(offset, Math.min(zip.length, offset + chunk)) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const done = await call(backend, `${prefix}/uploads/${id}/complete`, { method: 'POST', headers });
  assert.equal(done.status, 202, JSON.stringify(done.body));
  const job = await finish(backend, headers, prefix, done.body.job.id);
  return { id, job };
}
async function restore(backend, headers, prefix, body) {
  const r = await call(backend, `${prefix}/restores`, { method: 'POST', headers, body });
  if (r.status !== 202) return r;
  return { status: 202, job: await finish(backend, headers, prefix, r.body.job.id) };
}
/** Lists a zip: { names, read(name) }. */
function readZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = new Map();
      zip.on('entry', entry => { entries.set(entry.fileName, entry); zip.readEntry(); });
      zip.on('end', () => resolve({
        names: [...entries.keys()],
        read: name => new Promise((res, rej) => zip.openReadStream(entries.get(name), (e, s) => { if (e) return rej(e); const c = []; s.on('data', d => c.push(d)); s.on('end', () => res(Buffer.concat(c))); s.on('error', rej); })),
      }));
      zip.readEntry();
    });
  });
}
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
/** In-memory vault driver (same interface as the R2 / disk drivers). `corrupt` flips a byte of every stored archive (to test the read-back check). */
function memoryDriver({ corrupt = false } = {}) {
  const objects = new Map();
  return {
    kind: 'r2', objects,
    list: async prefix => [...objects].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.body.length, modified: o.at })),
    putBuffer: async (key, body) => { objects.set(key, { body: Buffer.from(body), at: Date.now() }); },
    putFile: async (key, file, { onBytes } = {}) => { const body = Buffer.from(fs.readFileSync(file)); if (corrupt && key.includes('.zip')) body[Math.floor(body.length / 2)] ^= 0xff; objects.set(key, { body, at: Date.now() }); onBytes?.(body.length); },
    getBuffer: async key => { if (!objects.has(key)) throw new Error('NoSuchKey'); return Buffer.from(objects.get(key).body); },
    stream: async key => { if (!objects.has(key)) throw new Error('NoSuchKey'); return Readable.from([Buffer.from(objects.get(key).body)]); },
    head: async key => (objects.has(key) ? { size: objects.get(key).body.length } : null),
    remove: async key => { objects.delete(key); },
  };
}
module.exports = { memoryDriver, call, native, bearer, fakeR2, pngBytes, pngData, makeAppRoot, setup, wait, finish, startBackup, download, upload, restore, readZip, sha, tmp };
