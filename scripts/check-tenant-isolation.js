/**
 * Multi-tenant data layer (docs/MULTI_TENANT_PLAN.md, phase 1 and the leak matrix of phase 6).
 * Two tenants share ONE database; nothing one of them does may be visible to, or change, the other.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('../server');
const { scopeDb, bind } = require('../server/scope');
const { ensureSchema, SCHEMA, TENANT_TABLES } = require('../server/db');
const { createMedia } = require('../server/media');
const { freshDb, closeShared } = require('./test-db');

const ENV = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '2000' };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
async function setup() {
  const db = await freshDb();
  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline } });
  await backend.db.query('select 1');
  const now = Date.now();
  for (const id of ['acme', 'globex']) await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES($1,$1,$1,'instance','active',$2,$2) ON CONFLICT (id) DO NOTHING", [id, now]);
  return { db, backend, a: backend.bundles.get('acme'), b: backend.bundles.get('globex'), d: backend.bundles.get('default') };
}
test.after(closeShared);

test('scopeDb is fail-closed: a statement that touches a tenant table without :tenant never reaches the database', async () => {
  const { db } = await setup();
  const scoped = scopeDb(db, 'acme');
  const refused = async sql => assert.rejects(() => scoped.query(sql), error => error.code === 'TENANT_SCOPE_MISSING');
  await refused('SELECT * FROM clients');
  await refused('DELETE FROM content_items');
  await refused("UPDATE settings SET value='x'");
  await refused("INSERT INTO space(id,client_id,kind,value) VALUES('a','b','c','d')");
  await refused('SELECT 1 FROM user_sessions s JOIN clients c ON c.id=s.client_id WHERE s.tenant_id=:tenant'); // two tables, one token
  await refused('select * from CLIENTS'); // case does not matter
  await assert.rejects(() => scoped.tx(async q => q('SELECT * FROM claims')), error => error.code === 'TENANT_SCOPE_MISSING');
  assert.deepEqual(await scoped.query('SELECT 1 AS ok'), [{ ok: 1 }]); // no tenant table: fine
  assert.equal((await scoped.query("SELECT id FROM saas_tenants WHERE id='acme'")).length, 1); // platform tables are not tenant tables
  assert.throws(() => scopeDb(db, "x'; DROP TABLE clients; --"), /INVALID_TENANT/);
  assert.throws(() => scopeDb(db, ''), /INVALID_TENANT/);
  // The tenant is always the LAST bind parameter and every :tenant token is rewritten to it.
  assert.deepEqual(bind('acme', 'SELECT 1 FROM clients WHERE tenant_id=:tenant AND id=$1 AND :tenant<>\'\'', ['x']), { sql: "SELECT 1 FROM clients WHERE tenant_id=$2 AND id=$1 AND $2<>''", params: ['x', 'acme'] });
  // The list the guard knows is exactly the list the schema migration tags: a new tenant table cannot be forgotten in one of the two.
  const columns = await db.query("SELECT table_name FROM information_schema.columns WHERE column_name='tenant_id' AND table_schema='public' AND table_name NOT LIKE 'saas\\_%'");
  assert.deepEqual(columns.map(row => row.table_name).sort(), [...TENANT_TABLES].sort());
});

test('migration: an existing single-tenant database becomes the default tenant with every row intact, and the migration is idempotent', async () => {
  await closeShared(); // one PGlite at a time: each instance costs ~350 MB of WASM memory (the shared one is recreated by the next test)
  const { PGlite } = require(['@electric-sql', 'pglite'].join('/'));
  const lite = new PGlite();
  await lite.waitReady;
  try {
    const legacy = { query: async (sql, params = []) => (await lite.query(sql, params)).rows, exec: sql => lite.exec(sql) };
    await lite.exec(SCHEMA); // the schema exactly as it was before multi-tenancy (no tenant_id anywhere)
    await lite.query("INSERT INTO clients(id,phone,name,created_at) VALUES('c1','+212600000001','Old Client',1)");
    await lite.query("INSERT INTO space(id,client_id,kind,value) VALUES('s1','c1','history','{}')");
    await lite.query("INSERT INTO settings(key,value) VALUES('image_keys','{\"k\":1}'),('vapid','{}')");
    await lite.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES('styles','x','{}',1)");
    await lite.query("INSERT INTO admin_accounts(admin_id,email,created_at,updated_at) VALUES('admin','boss@example.com',1,1)");
    await lite.query("INSERT INTO sync_state(key,version) VALUES('content',7)");
    await ensureSchema(legacy, '');
    for (const table of TENANT_TABLES) {
      const rows = await legacy.query(`SELECT DISTINCT tenant_id FROM ${table}`);
      assert.ok(rows.every(row => row.tenant_id === 'default'), `${table}: every legacy row is the default tenant`);
    }
    assert.equal((await legacy.query("SELECT name FROM clients WHERE tenant_id='default' AND phone='+212600000001'"))[0].name, 'Old Client');
    assert.equal((await legacy.query("SELECT version FROM sync_state WHERE tenant_id='default' AND key='content'"))[0].version, 7);
    assert.equal((await legacy.query("SELECT kind FROM saas_tenants WHERE id='default'"))[0].kind, 'default');
    // Keys are per tenant now: the same phone / content id / settings key / admin id may exist in another tenant.
    await lite.query("INSERT INTO clients(tenant_id,id,phone,name,created_at) VALUES('acme','c2','+212600000001','Acme Client',1)");
    await lite.query("INSERT INTO content_items(tenant_id,coll,id,data,updated_at) VALUES('acme','styles','x','{}',1)");
    await lite.query("INSERT INTO settings(tenant_id,key,value) VALUES('acme','image_keys','{}')");
    await lite.query("INSERT INTO admin_accounts(tenant_id,admin_id,email,created_at,updated_at) VALUES('acme','admin','boss@example.com',1,1)");
    await assert.rejects(() => lite.query("INSERT INTO clients(tenant_id,id,phone,name,created_at) VALUES('acme','c3','+212600000001','Dup',1)"), /duplicate key/); // but not twice in one tenant
    // The marker is stored with the platform: a second start does nothing, a forced re-run changes no row.
    await ensureSchema(legacy, '');
    await lite.query("DELETE FROM saas_kv WHERE key='schema_version'");
    await ensureSchema(legacy, '');
    assert.equal((await legacy.query("SELECT COUNT(*)::int AS n FROM clients"))[0].n, 2);
    assert.equal((await legacy.query("SELECT COUNT(*)::int AS n FROM saas_tenants WHERE id='default'"))[0].n, 1);
  } finally { await lite.close(); }
});

test('two tenants on one database: clients, sessions, content, settings, sync counters and credits never cross', async () => {
  const { a, b, d } = await setup();
  // The same phone number signs up in two tenants: two separate people with separate balances.
  const ua = await a.clients.login('Salma A', '0661000001', 3);
  const ub = await b.clients.login('Salma B', '0661000001', 9);
  assert.notEqual(ua.user.id, ub.user.id);
  assert.equal(ua.user.credits, 3);
  assert.equal(ub.user.credits, 9);
  assert.equal((await a.clients.users()).length, 1);
  assert.equal((await b.clients.users()).length, 1);
  assert.equal((await d.clients.users()).length, 0, 'the default tenant sees neither');
  // A session token only authenticates in the tenant that issued it.
  assert.equal((await a.clients.authenticate(ua.token)).name, 'Salma A');
  assert.equal(await b.clients.authenticate(ua.token), null);
  assert.equal(await d.clients.authenticate(ua.token), null);
  // An admin of tenant B cannot touch, grant to, or delete tenant A's client even with the exact id.
  await assert.rejects(() => b.clients.grant(ua.user.id, 99), error => error.status === 404);
  await assert.rejects(() => b.clients.remove(ua.user.id), error => error.status === 404);
  await assert.rejects(() => b.clients.update(ua.user.id, { blocked: true }), error => error.status === 404);
  assert.equal((await b.clients.bulk({ ids: [ua.user.id], action: 'delete' })).affected, 0);
  assert.equal((await a.clients.user(ua.user.id)).credits, 3);
  // Per-client space and a claim id used in both tenants stay apart.
  await a.clients.putSpace(ua.user, 'history', { status: 'done' }, 'item-1');
  await b.clients.putSpace(ub.user, 'history', { status: 'pending' }, 'item-1');
  assert.deepEqual((await a.clients.listSpace(ua.user, 'history')).map(i => i.status), ['done']);
  assert.deepEqual((await b.clients.listSpace(ub.user, 'history')).map(i => i.status), ['pending']);
  assert.equal(await b.clients.getSpaceItem(ua.user, 'history', 'item-1'), null, 'a foreign client record is invisible even by id');
  await a.clients.claim(ua.user, 'claim-12345678');
  assert.equal(await b.clients.hasClaim('claim-12345678', ua.user.id), false);
  // Content: each tenant is seeded on its own and edits stay inside it.
  const before = await b.content.snapshot(true);
  await a.content.putItem('styles', 'only-acme', { name: { fr: 'Acme' }, visible: true, order: 1 });
  await a.content.patchDoc('branding', { appName: 'Acme Design' });
  const seenByA = await a.content.snapshot(true), seenByB = await b.content.snapshot(true), seenByD = await d.content.snapshot(true);
  assert.ok(seenByA.collections.styles.some(s => s.id === 'only-acme'));
  assert.ok(!seenByB.collections.styles.some(s => s.id === 'only-acme'));
  assert.ok(!seenByD.collections.styles.some(s => s.id === 'only-acme'));
  assert.equal(seenByA.docs.branding.appName, 'Acme Design');
  assert.notEqual(seenByB.docs.branding.appName, 'Acme Design');
  assert.equal(seenByB.collections.styles.length, before.collections.styles.length);
  await b.content.deleteItems('styles', seenByB.collections.styles.map(s => s.id));
  assert.ok((await a.content.snapshot(true)).collections.styles.length > 1, 'deleting everything in B leaves A untouched');
  // Change counters and their in-memory caches are per tenant.
  assert.notEqual((await a.sync.read(['content'])).content, (await b.sync.read(['content'])).content);
  const v = (await d.sync.read(['content'])).content;
  await a.sync.bump('content');
  assert.equal((await d.sync.read(['content'])).content, v, 'a bump in A is invisible to the default tenant even through its cache');
  // Per-tenant settings rows (provider keys, assistant list) are separate.
  await a.imagegen.setKeys({ keys: {} }).catch(() => {});
  await a.db.query("INSERT INTO settings(tenant_id,key,value) VALUES(:tenant,'image_keys','{\"secret\":1}') ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value");
  assert.equal((await b.db.query("SELECT value FROM settings WHERE tenant_id=:tenant AND key='image_keys'")).length, 0);
  // The admin sign-in: built-in admin/admin and ADMIN_EMAIL exist for the default tenant only.
  assert.equal(await d.admins.verify('admin', 'admin'), 'admin');
  assert.equal(await a.admins.verify('admin', 'admin'), null);
  assert.equal(await b.admins.verify('admin', 'admin'), null);
});

test('media: the same bytes are stored once per tenant, each under its own R2 prefix; a tenant cannot read another tenant\'s file by name', async () => {
  const { db, backend } = await setup();
  const objects = new Map();
  const storage = { kind: 'r2', publicUrl: key => `https://cdn.example/${key}`, put: async (key, body) => { objects.set(key, body); }, head: async () => null };
  const mediaOf = id => createMedia(scopeDb(db, id), { env: {}, storage, download: offline });
  const body = Buffer.from('same bytes in every tenant');
  const url = await mediaOf('acme').storeMedia({ body, mime: 'image/png' });
  await mediaOf('default').storeMedia({ body, mime: 'image/png' });
  const name = url.slice('/api/media/'.length);
  assert.ok(objects.has(`t/acme/media/${name}`), 'non-default tenants live under t/<id>/');
  assert.ok(objects.has(`media/${name}`), 'the default tenant keeps the historical key');
  assert.equal((await db.query('SELECT tenant_id FROM media ORDER BY tenant_id')).map(r => r.tenant_id).join(), 'acme,default');
  assert.equal(await mediaOf('globex').readMedia(name), null, 'globex never stored it: unknown, even though the bytes exist for others');
  assert.equal((await mediaOf('acme').readMedia(name)).redirect, `https://cdn.example/t/acme/media/${name}`);
  assert.equal((await mediaOf('default').readMedia(name)).redirect, `https://cdn.example/media/${name}`);
  backend.server.emit('close');
});

test('background sweep only visits tenants with work due, never suspended ones, and always the default tenant', async () => {
  const { db, backend, a } = await setup();
  assert.deepEqual(await backend.bundles.dueTenants(), ['default']);
  await a.enqueue('lead', 'lead:1', { id: 'x', name: 'n', whatsapp: '+1' });
  assert.deepEqual((await backend.bundles.dueTenants()).sort(), ['acme', 'default']);
  await db.query("UPDATE saas_tenants SET status='suspended' WHERE id='acme'");
  assert.deepEqual(await backend.bundles.dueTenants(), ['default'], 'a suspended tenant is not served');
  // pump() of one tenant only touches that tenant's queue.
  await db.query("UPDATE saas_tenants SET status='active' WHERE id='acme'");
  await backend.bundles.get('globex').enqueue('lead', 'lead:1', { id: 'y', name: 'n', whatsapp: '+1' });
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM outbox WHERE request_id='lead:1'"))[0].n, 2, 'same job id in two tenants: two rows');
  await a.pump();
  assert.equal((await db.query("SELECT tenant_id FROM outbox WHERE request_id='lead:1'")).map(r => r.tenant_id).join(), 'globex', 'only the pumped tenant\'s job was consumed');
  backend.server.emit('close');
});
