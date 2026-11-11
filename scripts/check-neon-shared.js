/* global __dirname */
/**
 * The failure that broke the first Vercel preview of the super-admin work, as a regression test. Needs a REAL Postgres:
 *   TEST_DATABASE_URL=postgresql://user@host/dwira_test node scripts/check-neon-shared.js      (skipped when unset; db name must contain "test")
 *
 * Every Vercel preview and production share ONE Neon database, and earlier unmerged previews had already changed it
 * (scripts/fixtures/pr53-pr54-leftovers.sql). Facts pinned here:
 *   1. the multi-tenant migration succeeds on such a database (it failed with 23502: nullable admin_accounts.tenant_id);
 *   2. a PREVIEW does not migrate the tables in `public` (production's old code needs their old primary keys: ON CONFLICT -> 42P10 otherwise),
 *      it works on its own copy, and that copy survives a restart and new commits of the branch;
 *   3. once `public` itself is migrated (the release is live) previews use it again;
 *   4. production never isolates.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDb } = require('../server/db');

const URL_ = process.env.TEST_DATABASE_URL || '';
const skip = !URL_ && 'set TEST_DATABASE_URL (a real Postgres whose database name contains "test")';
if (URL_ && !/test/i.test(decodeURIComponent(new URL(URL_).pathname.slice(1)))) throw new Error('TEST_DATABASE_URL must name a database containing "test"');
const read = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

async function sql(work) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: URL_ });
  await client.connect();
  try { return await work(client); } finally { await client.end(); }
}
/** The shared Neon as it really was: legacy schema + rows, then the PR #53 / #54 leftovers. */
async function sharedNeon() {
  await sql(async c => {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    for (const s of (await c.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'preview\\_%' OR schema_name='forced_x'")).rows) await c.query(`DROP SCHEMA "${s.schema_name}" CASCADE`);
    await c.query(read('legacy-main-schema.sql'));
    await c.query("INSERT INTO clients(id,phone,name,free_used,credits,created_at) VALUES ('c1','+212600000001','Old Client',1,7,1000)");
    await c.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES ('tools','t_old','{\"id\":\"t_old\"}',1)");
    await c.query("INSERT INTO settings(key,value) VALUES ('content_seeded','1')");
    await c.query("INSERT INTO admin_accounts(admin_id,name,email,created_at,updated_at) VALUES ('admin','Old Admin','old@admin.test',1,1)");
    await c.query("INSERT INTO admin_sessions(token_hash,expires_at) VALUES ('s1',99999999999999)");
    await c.query(read('pr53-pr54-leftovers.sql'));
  });
}
const pk = (c, schema, table) => c.query(
  "SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) JOIN pg_class k ON k.oid=i.indrelid JOIN pg_namespace n ON n.oid=k.relnamespace WHERE n.nspname=$1 AND k.relname=$2 AND i.indisprimary ORDER BY a.attname", [schema, table]).then(r => r.rows.map(x => x.attname));
const env = extra => ({ DATABASE_URL: URL_, DATABASE_URL_UNPOOLED: URL_, DB_POOL_MAX: '2', ...extra });
const PREVIEW = { VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'genspark_ai_developer' };

test('the multi-tenant migration succeeds on a database touched by PR #53 and #54 (was 23502)', { skip }, async () => {
  await sharedNeon();
  const db = createDb(env());
  try {
    assert.deepEqual((await db.query('SELECT admin_id, tenant_id FROM admin_accounts')).map(r => [r.admin_id, r.tenant_id]), [['admin', 'default']], 'the NULL tenant became default');
    await sql(async c => {
      assert.deepEqual(await pk(c, 'public', 'admin_accounts'), ['admin_id', 'tenant_id']);
      assert.equal((await c.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='admin_accounts' AND column_name='tenant_id'")).rows[0].is_nullable, 'NO');
    });
    assert.equal(db.schema(), '', 'production-style start uses public');
  } finally { await db.close(); }
  // idempotent: dropping the marker and starting again changes nothing
  await sql(c => c.query("DELETE FROM saas_kv WHERE key='schema_version'"));
  const again = createDb(env());
  try { assert.equal((await again.query("SELECT count(*)::int AS n FROM admin_accounts"))[0].n, 1); } finally { await again.close(); }
});

test('a preview leaves `public` (production tables) untouched and works on its own copy', { skip }, async () => {
  await sharedNeon();
  const before = await sql(async c => ({ settings: await pk(c, 'public', 'settings'), clients: await pk(c, 'public', 'clients'), admin: await pk(c, 'public', 'admin_accounts'), kv: (await c.query("SELECT to_regclass('public.saas_kv') AS t")).rows[0].t }));
  assert.deepEqual(before.settings, ['key']);
  assert.equal(before.kv, null);

  const db = createDb(env(PREVIEW));
  let name;
  try {
    assert.equal((await db.query('SELECT 1 AS ok'))[0].ok, 1);
    name = db.schema();
    assert.match(name, /^preview_genspark_ai_developer_[0-9a-f]{8}$/);
    // data was copied, migrated and works in the copy
    assert.equal((await db.query("SELECT count(*)::int AS n FROM content_items WHERE tenant_id='default'"))[0].n, 1);
    assert.equal((await db.query("SELECT credits FROM clients WHERE id='c1'"))[0].credits, 7);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_sessions"))[0].n, 0, 'sessions are not copied');
    assert.deepEqual((await db.query("SELECT admin_id, tenant_id FROM admin_accounts")).map(r => [r.admin_id, r.tenant_id]), [['admin', 'default']]);
    await db.query("INSERT INTO settings(tenant_id,key,value) VALUES ('default','only_in_preview','1')");
  } finally { await db.close(); }

  // public: same keys, no multi-tenant tables, no preview data -> the OLD code's statements still work there
  await sql(async c => {
    assert.deepEqual(await pk(c, 'public', 'settings'), ['key']);
    assert.deepEqual(await pk(c, 'public', 'clients'), ['id']);
    assert.deepEqual(await pk(c, 'public', 'admin_accounts'), ['admin_id']);
    assert.equal((await c.query("SELECT to_regclass('public.saas_kv') AS t")).rows[0].t, null);
    assert.equal((await c.query("SELECT count(*)::int AS n FROM public.settings WHERE key='only_in_preview'")).rows[0].n, 0);
    // exactly the statements production's (old) code runs; each was a 42P10 on a migrated public schema
    await c.query("INSERT INTO settings(key,value) VALUES ('k','v') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
    await c.query("INSERT INTO admin_accounts(admin_id,name,created_at,updated_at) VALUES ('admin','x',1,1) ON CONFLICT (admin_id) DO UPDATE SET name=EXCLUDED.name");
    // (clients(phone) is NOT checked: the PR #53 leftover already dropped clients_phone_key from `public`, before this release existed.)
    await c.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES ('tools','t_old','{}',1) ON CONFLICT (coll,id) DO UPDATE SET data=EXCLUDED.data");
  });

  // a restart / the next commit of the same branch keeps the preview's own data and does not copy again
  const next = createDb(env(PREVIEW));
  try {
    await next.query('SELECT 1');
    assert.equal(next.schema(), name);
    assert.equal((await next.query("SELECT count(*)::int AS n FROM settings WHERE key='only_in_preview'"))[0].n, 1);
  } finally { await next.close(); }

  // a different branch gets a different schema
  const other = createDb(env({ ...PREVIEW, VERCEL_GIT_COMMIT_REF: 'feature/other' }));
  try { await other.query('SELECT 1'); assert.notEqual(other.schema(), name); assert.match(other.schema(), /^preview_feature_other_/); } finally { await other.close(); }
});

test('concurrent cold starts of one preview create the schema once', { skip }, async () => {
  await sharedNeon();
  const dbs = Array.from({ length: 5 }, () => createDb(env(PREVIEW)));
  try {
    const out = await Promise.all(dbs.map(d => d.query('SELECT count(*)::int AS n FROM clients').then(r => r[0].n)));
    assert.deepEqual(out, [1, 1, 1, 1, 1]);
  } finally { await Promise.all(dbs.map(d => d.close())); }
});

test('once public is migrated (release live) previews use public again; production never isolates; DB_SCHEMA forces', { skip }, async () => {
  await sharedNeon();
  const prod = createDb(env({ VERCEL: '1', VERCEL_ENV: 'production' }));
  try { await prod.query('SELECT 1'); assert.equal(prod.schema(), ''); } finally { await prod.close(); }
  const preview = createDb(env(PREVIEW));
  try { await preview.query('SELECT 1'); assert.equal(preview.schema(), '', 'public is migrated: shared like before'); } finally { await preview.close(); }
  const shared = createDb(env({ ...PREVIEW, DB_SHARED_PREVIEW: '1' }));
  try { await shared.query('SELECT 1'); assert.equal(shared.schema(), ''); } finally { await shared.close(); }
  const forced = createDb(env({ DB_SCHEMA: 'forced_x' }));
  try { await forced.query('SELECT 1'); assert.equal(forced.schema(), 'forced_x'); } finally { await forced.close(); }
  const bad = createDb(env({ DB_SCHEMA: 'public' }));
  await assert.rejects(() => bad.query('SELECT 1'), /DB_SCHEMA must be/);
});
