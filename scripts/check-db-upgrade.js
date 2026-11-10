/* A database that cannot take the Super Admin tables must never take the public app down (regression: Vercel previews answered 500 on every /api route). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');

function call(backend, url, headers = {}) {
  return new Promise(resolve => {
    const req = Readable.from([]);
    Object.assign(req, { url, method: 'GET', headers, socket: { remoteAddress: 'test-client' } });
    const out = { headers: {} };
    const res = { headersSent: false, setHeader(k, v) { out.headers[k.toLowerCase()] = v; }, writeHead(status) { out.status = status; this.headersSent = true; }, end(value) { out.body = value ? JSON.parse(value) : null; resolve(out); } };
    backend.handle(req, res);
  });
}

test('the public content loads even when the Super Admin schema cannot be applied', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-upgrade-'));
  try {
    // A database where something else already owns the name `sa_audit` with another shape: the Super Admin DDL fails on it.
    const { PGlite } = require(['@electric-sql', 'pglite'].join('/'));
    const seed = new PGlite(dir);
    await seed.waitReady;
    await seed.exec('CREATE TABLE sa_audit (x INTEGER)');
    await seed.close();

    const backend = createBackend({ env: { PGLITE_DIR: dir, COOKIE_SECURE: 'false' } });
    const content = await call(backend, '/api/content');
    assert.equal(content.status, 200);
    assert.ok(Array.isArray(content.body.collections.tabs) && content.body.collections.tabs.length > 0, 'tabs come from the database');
    assert.ok(content.body.collections.tools.length > 0, 'tools come from the database');
    assert.equal((await call(backend, '/api/sync')).status, 200);
    assert.equal((await call(backend, '/api/health')).status, 200);
    // The platform switches fall back to their defaults instead of failing every request.
    assert.equal((await call(backend, '/api/platform')).body.maintenance, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
