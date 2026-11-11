/* global Buffer, __dirname */
/**
 * Upgrade test: a database created by the OLD single-tenant app (schema of `main`, with real rows) is opened by the new
 * multi-tenant code. Nothing may be lost: every old row must become part of the default tenant and the default admin / content / clients
 * must keep working, and the super admin must work on top of it.
 *
 * Runs on PGlite by default; with TEST_DATABASE_URL (database name must contain "test") it runs through the real `pg` driver.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { createDb } = require('../server/db');

const LEGACY = fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-main-schema.sql'), 'utf8');
const REAL = process.env.TEST_DATABASE_URL || '';
if (REAL && !/test/i.test(decodeURIComponent(new URL(REAL).pathname.slice(1)))) throw new Error('TEST_DATABASE_URL must name a database containing "test"');
const native = { 'x-dwira-native': '1' };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, socket: { remoteAddress: 'mig' } });
    const out = { headers: {} };
    const chunks = [];
    const res = new Writable({ write(chunk, enc, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => { const text = Buffer.concat(chunks).toString(); try { out.body = text ? JSON.parse(text) : undefined; } catch { out.text = text; } resolve(out); });
    backend.handle(req, res);
  });
}

/** An empty database that already holds the OLD schema + rows. Returns the env to open it with the new code. */
async function legacyDatabase() {
  const rows = async run => {
    await run('INSERT INTO clients(id,phone,name,free_used,credits,created_at) VALUES($1,$2,$3,$4,$5,$6)', ['c1', '+212600000001', 'Old Client', 1, 7, 1000]);
    await run('INSERT INTO space(id,client_id,kind,value) VALUES($1,$2,$3,$4)', ['s1', 'c1', 'history', '{"a":1}']);
    await run('INSERT INTO requests(id,user_id,client_request_id,created_at,data) VALUES($1,$2,$3,$4,$5)', ['r1', 'c1', 'cr1', 2000, '{"tool":"old"}']);
    await run('INSERT INTO content_items(coll,id,data,updated_at) VALUES($1,$2,$3,$4)', ['tools', 'tool_old', '{"id":"tool_old","title":"Old tool"}', 3000]);
    await run('INSERT INTO content_docs(name,data,updated_at) VALUES($1,$2,$3)', ['branding', '{"name":"Old Brand"}', 3000]);
    await run('INSERT INTO settings(key,value) VALUES($1,$2)', ['content_seeded', '1']);
    await run('INSERT INTO settings(key,value) VALUES($1,$2)', ['vapid', '{"publicKey":"pub","privateKey":"priv"}']);
    await run('INSERT INTO sync_state(key,version) VALUES($1,$2)', ['content', 5]);
    await run("INSERT INTO admin_accounts(admin_id,name,email,created_at,updated_at) VALUES('admin','Old Admin','old@admin.test',1,1)", []);
    await run('INSERT INTO media(id,mime,data,created_at) VALUES($1,$2,$3,$4)', ['m1', 'image/png', 'AAAA', 1]);
  };
  if (REAL) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: REAL });
    await client.connect();
    try {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await client.query(LEGACY);
      await rows((sql, params) => client.query(sql, params));
    } finally { await client.end(); }
    return { DATABASE_URL: REAL, COOKIE_SECURE: 'false', DB_POOL_MAX: '3' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-mig-'));
  const { PGlite } = require('@electric-sql/pglite');
  const lite = new PGlite(dir);
  await lite.waitReady;
  await lite.exec(LEGACY);
  await rows((sql, params) => lite.query(sql, params));
  await lite.close();
  return { PGLITE_DIR: dir, COOKIE_SECURE: 'false', cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('old single-tenant database -> multi-tenant code: rows kept as the default tenant, logins and super admin work, second start is a no-op', async () => {
  const { cleanup, ...env } = await legacyDatabase();
  const db = createDb(env);
  const backend = createBackend({ env: { ...env, PUSH_WAIT_MS: '50' }, db, media: { storage: null, download: offline } });
  try {
    await db.query('select 1'); // runs the migration
    // Every old row now belongs to the default tenant.
    for (const table of ['clients', 'space', 'requests', 'content_items', 'content_docs', 'settings', 'sync_state', 'admin_accounts', 'media']) {
      const rows = await db.query(`SELECT tenant_id, count(*)::int AS n FROM ${table} GROUP BY tenant_id`);
      assert.deepEqual(rows.map(r => r.tenant_id), ['default'], `${table} rows are default-tenant rows`);
      assert.ok(rows[0].n >= 1, `${table} kept its rows`);
    }
    assert.equal((await db.query("SELECT value FROM settings WHERE key='vapid'"))[0].value, '{"publicKey":"pub","privateKey":"priv"}', 'push keys survive');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM saas_tenants WHERE id='default'"))[0].n, 1);

    // The old default admin still signs in, the old content is served, the old client still logs in with the same credits.
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    const content = await call(backend, '/api/content?a=1', { headers: { authorization: `Bearer ${admin.body.token}`, ...native } });
    assert.equal(content.status, 200);
    assert.ok(JSON.stringify(content.body).includes('Old tool'), 'old content item is served');
    assert.ok(JSON.stringify(content.body).includes('Old Brand'), 'old settings document is served');
    const client = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Old Client', phone: '0600000001' } });
    assert.equal(client.status, 200, JSON.stringify(client.body));
    assert.equal(client.body.user.id, 'c1', 'the old client row is reused, not duplicated');
    assert.equal(client.body.user.credits, 7, 'old client credits intact (free design already used)');

    // Super admin: factory login works on the migrated database and can see the migrated default tenant with its old clients.
    const sa = await call(backend, '/api/super-admin/login', { method: 'POST', headers: native, body: { email: 'superadmin', password: 'superadmin' } });
    assert.equal(sa.status, 200, JSON.stringify(sa.body));
    const tenants = await call(backend, '/api/super-admin/tenants', { headers: { 'x-super-token': sa.body.token } });
    assert.equal(tenants.status, 200);
    const def = tenants.body.find(t => t.id === 'default');
    assert.equal(def.counts.clients, 1, 'the old client is counted under the default tenant');
    const created = await call(backend, '/api/super-admin/tenants', { method: 'POST', headers: { 'x-super-token': sa.body.token }, body: { name: 'New Shop', slug: 'new-shop', ownerEmail: 'o@new-shop.test' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // ...and the new tenant cannot see the old default data.
    const other = await call(backend, '/new-shop/api/content');
    assert.equal(other.status, 200);
    assert.ok(!JSON.stringify(other.body).includes('Old tool'), 'a new tenant never sees the default tenant content');

    // A second start (new process, same database) must not change anything.
    await db.close();
    const again = createDb(env);
    const before = (await again.query("SELECT count(*)::int AS n FROM clients WHERE tenant_id='default'"))[0].n;
    assert.equal(before, 1);
    assert.equal((await again.query("SELECT count(*)::int AS n FROM saas_super"))[0].n, 1, 'one super admin row');
    await again.close();
  } finally { await db.close().catch(() => {}); cleanup?.(); }
});
