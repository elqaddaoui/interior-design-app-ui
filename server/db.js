/**
 * One tiny async Postgres interface for every runtime:
 *  - production / Vercel: `pg` against DATABASE_URL (Neon, Vercel Postgres, Supabase, any Postgres)
 *  - local development and automated tests: PGlite (real Postgres compiled to WASM, no install, in-process)
 * Both speak the same SQL, so tests exercise the exact queries production runs.
 */
const crypto = require('node:crypto');
const connectionString = env => env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL_NON_POOLING || '';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  free_used INTEGER NOT NULL DEFAULT 0, credits INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (token_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, free INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS space (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE, kind TEXT NOT NULL, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS space_client ON space(client_id, kind);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS blocked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_request_id TEXT, created_at BIGINT NOT NULL, data TEXT NOT NULL,
  UNIQUE (user_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS requests_created ON requests(created_at DESC);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (request_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL, completed TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS prefs TEXT NOT NULL DEFAULT '{}';
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS admin_id TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS owner_id TEXT NOT NULL DEFAULT 'admin';
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'request';
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS payload TEXT;
CREATE TABLE IF NOT EXISTS content_items (coll TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (coll, id));
CREATE TABLE IF NOT EXISTS content_docs (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_prefs (admin_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, version BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, created_at BIGINT NOT NULL);
-- Media metadata. storage: 'r2' (bytes in Cloudflare R2), 'db' (fallback without R2: raw bytes in body; legacy rows: base64 in data,
-- read-only), 'pending' (presigned direct upload not confirmed yet). New rows never put base64 in data.
ALTER TABLE media ADD COLUMN IF NOT EXISTS body BYTEA;
ALTER TABLE media ADD COLUMN IF NOT EXISTS size BIGINT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS storage TEXT NOT NULL DEFAULT 'db';
-- Assistant conversations of visitors who have not signed in yet, keyed by the secret device token (hashed). They move into the
-- client's own space (table space) the moment that person signs in from the same device.
CREATE TABLE IF NOT EXISTS guest_chats (id TEXT PRIMARY KEY, device_hash TEXT NOT NULL, value TEXT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS guest_chats_device ON guest_chats(device_hash, updated_at);
-- Activity used by notification segments: last time the client's app was open (written at most every 5 minutes) and when each
-- design was started (claims = one per generation).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_seen BIGINT;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS created_at BIGINT;
-- Notification campaigns. The data column holds the editable definition; status / next_at are columns so the scheduler can query them.
-- kind: once | recurring | trigger. status: draft | scheduled | sending | sent (once), active | paused | ended (recurring / trigger). One delivery row per (campaign, client, occurrence): the primary key
-- is the idempotency key, so a retry, a second server instance or a repeated tick can never notify the same person twice.
CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, next_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS campaigns_status ON campaigns(status, next_at);
CREATE TABLE IF NOT EXISTS campaign_deliveries (
  id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  occurrence TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at BIGINT NOT NULL, created_at BIGINT NOT NULL,
  sent_at BIGINT, devices INTEGER NOT NULL DEFAULT 0, reason TEXT, completed TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS campaign_deliveries_due ON campaign_deliveries(status, next_at);
CREATE INDEX IF NOT EXISTS campaign_deliveries_campaign ON campaign_deliveries(campaign_id, status);
CREATE INDEX IF NOT EXISTS campaign_deliveries_client ON campaign_deliveries(client_id, sent_at);
-- Admin accounts: the profile of each administrator (id = the stable admin identity used by sessions and preferences). pw_hash is only set once the
-- password was changed in the panel (scrypt, salt:hex); until then the built-in / environment credentials apply. credits NULL = unlimited.
CREATE TABLE IF NOT EXISTS admin_accounts (
  admin_id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '', pw_hash TEXT, pw_changed_at BIGINT, credits INTEGER, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, last_login_at BIGINT
);
-- (the e-mail uniqueness of admin accounts is per tenant, see SCHEMA_MT)
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ua TEXT;
`;

/**
 * Multi-tenant layer (docs/MULTI_TENANT_PLAN.md). Runs right after SCHEMA and is idempotent.
 *  - Every tenant-owned table gets `tenant_id TEXT NOT NULL DEFAULT 'default'`: existing rows therefore ARE the default tenant, no data copy.
 *    (The DEFAULT is the "expand" half of expand/contract: it keeps a previous release, still running during a rolling deploy, writing valid
 *    rows. Tenant code always writes tenant_id explicitly through scopeDb; the DEFAULT is dropped in a later release.)
 *  - Keys that were global become per tenant (a phone number, a content id or a settings key may exist in two tenants).
 *  - `saas_*` tables are the platform's own (tenants, domains, super admin, demos, requests, audit) and are never read by tenant code.
 */
const TENANT_TABLES = ['clients', 'user_sessions', 'claims', 'space', 'admin_sessions', 'requests', 'subscriptions', 'outbox', 'settings', 'content_items', 'content_docs', 'admin_prefs', 'sync_state', 'media', 'guest_chats', 'campaigns', 'campaign_deliveries', 'admin_accounts'];
/** Tables whose primary key becomes tenant-scoped. (Tables keyed by a server-generated UUID keep their key: ids stay globally unique.) */
const TENANT_KEYS = { claims: 'tenant_id,id', space: 'tenant_id,id', guest_chats: 'tenant_id,id', content_items: 'tenant_id,coll,id', content_docs: 'tenant_id,name', settings: 'tenant_id,key', sync_state: 'tenant_id,key', admin_accounts: 'tenant_id,admin_id', admin_prefs: 'tenant_id,admin_id', subscriptions: 'tenant_id,id', media: 'tenant_id,id', outbox: 'tenant_id,request_id' };
const rekey = (table, cols) => `DO $mt$ DECLARE c text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid='${table}'::regclass AND i.indisprimary AND a.attname='tenant_id') THEN
    SELECT conname INTO c FROM pg_constraint WHERE conrelid='${table}'::regclass AND contype='p';
    EXECUTE format('ALTER TABLE ${table} DROP CONSTRAINT %I', c);
    ALTER TABLE ${table} ADD PRIMARY KEY (${cols});
  END IF;
END $mt$;`;
// `ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT` is a silent no-op when the column already exists, so a column that an EARLIER, never merged
// preview left behind as nullable / without default (e.g. admin_accounts.tenant_id of the "super admin accounts" experiment, which every
// Vercel preview and production share through ONE Neon database) stayed nullable and the primary-key rebuild below then failed with
// 23502 "column tenant_id contains null values": every request answered 500. So the column is normalised explicitly: existing rows ARE the
// default tenant, whatever state the column was in.
const tenantColumn = t => `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
UPDATE ${t} SET tenant_id = 'default' WHERE tenant_id IS NULL;
ALTER TABLE ${t} ALTER COLUMN tenant_id SET DEFAULT 'default';
ALTER TABLE ${t} ALTER COLUMN tenant_id SET NOT NULL;`;
const SCHEMA_MT = `
${TENANT_TABLES.map(tenantColumn).join('\n')}
${Object.entries(TENANT_KEYS).map(([t, cols]) => rekey(t, cols)).join('\n')}
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_phone ON clients(tenant_id, phone);
DROP INDEX IF EXISTS admin_accounts_email;
CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_tenant_email ON admin_accounts(tenant_id, lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS requests_tenant_created ON requests(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clients_tenant_created ON clients(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_tenant_status ON campaigns(tenant_id, status, next_at);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox(next_at);
CREATE INDEX IF NOT EXISTS user_sessions_tenant ON user_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS admin_sessions_tenant ON admin_sessions(tenant_id, admin_id);
-- A disabled administrator (set by the super admin) cannot sign in; existing sessions are deleted at the same time.
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS disabled INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS saas_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS saas_tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'instance', status TEXT NOT NULL DEFAULT 'active',
  plan TEXT NOT NULL DEFAULT '', owner_email TEXT NOT NULL DEFAULT '', source_demo_id TEXT, source_demo_version BIGINT, notes TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, suspended_at BIGINT
);
CREATE TABLE IF NOT EXISTS saas_domains (domain TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, token TEXT NOT NULL, verified_at BIGINT, created_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS saas_domains_tenant ON saas_domains(tenant_id);
CREATE TABLE IF NOT EXISTS saas_super (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', pw_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, last_login_at BIGINT);
ALTER TABLE saas_super ADD COLUMN IF NOT EXISTS pw_changed_at BIGINT;
CREATE TABLE IF NOT EXISTS saas_super_sessions (token_hash TEXT PRIMARY KEY, super_id TEXT NOT NULL, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL, ua TEXT);
CREATE TABLE IF NOT EXISTS saas_demos (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', tenant_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'draft', version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS saas_assignments (id TEXT PRIMARY KEY, demo_id TEXT NOT NULL, tenant_id TEXT NOT NULL UNIQUE, owner_email TEXT NOT NULL DEFAULT '', demo_version BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, created_by TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS saas_assignments_demo ON saas_assignments(demo_id);
CREATE TABLE IF NOT EXISTS saas_requests (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, admin_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'customize', title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', response TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS saas_requests_tenant ON saas_requests(tenant_id, created_at DESC);
CREATE TABLE IF NOT EXISTS saas_audit (id TEXT PRIMARY KEY, at BIGINT NOT NULL, actor TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, tenant_id TEXT, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS saas_audit_at ON saas_audit(at DESC);
INSERT INTO saas_tenants(id, slug, name, kind, status, created_at, updated_at) VALUES ('default', 'default', 'Default', 'default', 'active', 0, 0) ON CONFLICT (id) DO NOTHING;
`;
const PLATFORM_TABLES = ['saas_tenants', 'saas_domains', 'saas_super', 'saas_super_sessions', 'saas_demos', 'saas_assignments', 'saas_requests', 'saas_audit'];

const isLocal = url => /@(localhost|127\.0\.0\.1)[:/]/.test(url);
/** Pool size: 3 per serverless instance (many instances), 5 for the single long-running server; DB_POOL_MAX (1-20) overrides. */
const poolMax = env => Math.max(1, Math.min(20, Number(env.DB_POOL_MAX) || (env.VERCEL ? 3 : 5)));

async function openPg(url, env = {}, schema = '') {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, value => Number(value)); // BIGINT -> number (timestamps stay far below 2^53)
  // Isolated preview schema (see previewSchema): the search_path is a connection STARTUP parameter, so no query can ever run before it applies.
  // Only valid on a direct connection: Neon's pooler (PgBouncer, transaction mode) does not keep session settings. `schema` is validated (SCHEMA_NAME).
  const pool = new Pool({ connectionString: url, max: poolMax(env), idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, ssl: isLocal(url) ? false : { rejectUnauthorized: false }, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
  pool.on('error', () => {}); // idle client errors must never crash the function
  return {
    kind: 'pg',
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    tx: async work => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(async (sql, params = []) => (await client.query(sql, params)).rows);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    },
    exec: sql => pool.query(sql),
    close: () => pool.end(),
  };
}
async function openLite(dataDir) {
  // Built indirectly so Vercel's file tracer does not bundle the (dev-only) PGlite WASM into the function.
  const { PGlite } = require(['@electric-sql', 'pglite'].join('/'));
  if (dataDir) require('node:fs').mkdirSync(require('node:path').dirname(dataDir), { recursive: true, mode: 0o700 });
  const lite = new PGlite(dataDir || undefined);
  await lite.waitReady;
  return {
    kind: 'pglite',
    query: async (sql, params = []) => (await lite.query(sql, params)).rows,
    tx: work => lite.transaction(tx => work(async (sql, params = []) => (await tx.query(sql, params)).rows)),
    exec: sql => lite.exec(sql),
    close: () => lite.close(),
  };
}

/**
 * Marker row (platform table saas_kv, so it belongs to no tenant) written after the schema was applied. Its value is a hash of SCHEMA + SCHEMA_MT, so editing the schema above makes the
 * next start re-apply it once, while every other cold start only pays for ONE cheap SELECT instead of ~40 DDL statements
 * (each of which takes a lock on a database that may have just woken up).
 */
const SCHEMA_VERSION = crypto.createHash('sha1').update(SCHEMA + SCHEMA_MT).digest('hex').slice(0, 12);
/**
 * `migrationUrl` (DATABASE_URL_UNPOOLED, optional): the schema DDL then runs once over a short-lived direct connection, which
 * is what Neon recommends for migrations (its pooler runs PgBouncer in transaction mode). Normal queries stay on the pooled URL.
 */
async function ensureSchema(db, migrationUrl) {
  // to_regclass first: a failing SELECT would abort the surrounding transaction (25P02) on a database that has no saas_kv yet.
  const current = async query => (await query("SELECT to_regclass('saas_kv') IS NOT NULL AS there"))[0]?.there
    && (await query("SELECT value FROM saas_kv WHERE key='schema_version'"))[0]?.value === SCHEMA_VERSION;
  if (await current((sql, params) => db.query(sql, params))) return;
  const apply = async query => {
    // ONE transaction under an advisory lock: concurrent cold starts (Vercel scales out) queue up instead of deadlocking each other on DDL locks
    // (observed: 40P01), the first one migrates, the others find the marker and do nothing, and a failure leaves the database exactly as it was.
    await query("SELECT pg_advisory_xact_lock(hashtext('dwira-schema'))");
    if (await current(query)) return;
    await query(SCHEMA);
    await query(SCHEMA_MT);
    await query("INSERT INTO saas_kv(key,value) VALUES('schema_version',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [SCHEMA_VERSION]);
  };
  if (migrationUrl) {
    const { Client } = require('pg');
    const direct = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 10000, ssl: isLocal(migrationUrl) ? false : { rejectUnauthorized: false } });
    direct.on('error', () => {});
    await direct.connect();
    try {
      await direct.query('BEGIN');
      try { await apply(async (sql, params) => (await direct.query(sql, params)).rows); await direct.query('COMMIT'); }
      catch (error) { await direct.query('ROLLBACK').catch(() => {}); throw error; }
    } finally { await direct.end().catch(() => {}); }
    return;
  }
  if (db.kind !== 'pg' || !db.tx) { // PGlite (single process: no concurrent starters) or a minimal {query, exec} handle
    await db.exec(SCHEMA);
    await db.exec(SCHEMA_MT);
    await db.query("INSERT INTO saas_kv(key,value) VALUES('schema_version',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [SCHEMA_VERSION]);
    return;
  }
  await db.tx(apply);
}

/**
 * PREVIEW ISOLATION. Every Vercel preview and production share ONE Neon database. The multi-tenant migration changes primary keys
 * (`settings(key)` -> `(tenant_id,key)`, ...), and the previous release (still serving production) writes with `ON CONFLICT (key)` / `(admin_id)` /
 * `(phone)` ...: on a migrated database those statements fail with 42P10 and production answers 500 to every admin login, content edit and
 * visitor sign-up. So a preview must never migrate the tables in `public` while production still runs the old code.
 *
 * Rule (Vercel previews only, VERCEL_ENV=preview):
 *   1. the branch's own schema already exists            -> keep using it (its data survives new commits of the same branch);
 *   2. `public` was already migrated (production runs the multi-tenant code) -> use `public`, shared exactly like before;
 *   3. otherwise                                          -> create the branch schema, copy the data once, and run the migration THERE.
 * Production, local development and every other host never isolate. DB_SCHEMA=name forces a schema, DB_SHARED_PREVIEW=1 turns the rule off.
 */
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,48}$/;
function previewSchema(env) {
  if (env.DB_SCHEMA) {
    if (!SCHEMA_NAME.test(env.DB_SCHEMA) || env.DB_SCHEMA === 'public') throw new Error('DB_SCHEMA must be lower-case letters, digits and _ (not "public")');
    return { name: env.DB_SCHEMA, forced: true };
  }
  if (env.VERCEL_ENV !== 'preview' || env.DB_SHARED_PREVIEW === '1') return null;
  const ref = String(env.VERCEL_GIT_COMMIT_REF || 'preview');
  const slug = ref.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'preview';
  return { name: `preview_${slug}_${crypto.createHash('sha1').update(ref).digest('hex').slice(0, 8)}`, forced: false };
}
/** Direct (unpooled) connection string: the Neon-provided one, else the pooled host without `-pooler`. */
const directUrl = (env, url) => env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || url.replace('-pooler.', '.');
/** Tables copied into a new preview schema. Sessions, push subscriptions, the outbox and campaigns are NOT copied: a preview must never notify real people. Parents first (foreign keys). */
const PREVIEW_COPY = ['clients', 'claims', 'space', 'requests', 'settings', 'content_items', 'content_docs', 'admin_prefs', 'sync_state', 'media', 'guest_chats', 'admin_accounts'];

async function withClient(url, work) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10000, ssl: isLocal(url) ? false : { rejectUnauthorized: false } });
  client.on('error', () => {});
  await client.connect();
  try { return await work(client); } finally { await client.end().catch(() => {}); }
}
/** Which schema this process must use: the preview schema's name, or '' for `public`. Read-only. */
async function pickSchema(url, wanted) {
  if (wanted.forced) return wanted.name;
  return withClient(url, async client => {
    if ((await client.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [wanted.name])).rows.length) return wanted.name;
    const migrated = await client.query("SELECT 1 FROM public.saas_kv WHERE key='schema_version'").then(r => r.rows.length > 0, () => false);
    return migrated ? '' : wanted.name;
  });
}
/** Creates the schema with the previous-release tables and a copy of the data, atomically (all or nothing) and once even if several instances start together. */
async function prepareSchema(url, schema) {
  await withClient(url, async client => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['dwira-schema:' + schema]);
      const exists = (await client.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1', [schema])).rows.length > 0;
      if (!exists) {
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET LOCAL search_path TO "${schema}"`);
        await client.query(SCHEMA);
        for (const table of PREVIEW_COPY) {
          const cols = (await client.query(
            "SELECT a.column_name FROM information_schema.columns a JOIN information_schema.columns b ON b.column_name=a.column_name AND b.table_schema=$1 AND b.table_name=$2 WHERE a.table_schema='public' AND a.table_name=$2 ORDER BY a.ordinal_position", [schema, table])).rows.map(r => `"${r.column_name}"`).join(',');
          if (cols) await client.query(`INSERT INTO "${schema}"."${table}" (${cols}) SELECT ${cols} FROM public."${table}" ON CONFLICT DO NOTHING`);
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
}

/** Lazily opened and schema-initialised once per process (one cold start on Vercel). */
function createDb(env = process.env) {
  const url = connectionString(env);
  let ready;
  let schema = '';
  const open = () => ready ||= (async () => {
    // PGlite is a dev/test dependency only. Production on Vercel must provide a real database,
    // because serverless instances have no durable disk.
    if (!url && env.VERCEL) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
    const wanted = url ? previewSchema(env) : null;
    schema = wanted ? await pickSchema(url, wanted) : '';
    if (schema) await prepareSchema(directUrl(env, url), schema);
    const db = url ? await openPg(schema ? directUrl(env, url) : url, env, schema) : await openLite(env.PGLITE_DIR === ':memory:' ? undefined : env.PGLITE_DIR || (env.NODE_ENV === 'test' ? undefined : require('node:path').join(__dirname, 'data', 'pglite')));
    const migrationUrl = url && !schema && env.DATABASE_URL_UNPOOLED && env.DATABASE_URL_UNPOOLED !== url ? env.DATABASE_URL_UNPOOLED : '';
    // A failed attempt must not leave its pool (and connections) behind: the caller may retry.
    try { await ensureSchema(db, migrationUrl); } catch (error) { await db.close().catch(() => {}); throw error; }
    return db;
  })().catch(error => { ready = undefined; throw error; });
  return {
    /** Name of the isolated preview schema in use ('' = the normal `public` schema). Valid after the first query. */
    schema: () => schema,
    configured: () => !!url || !env.VERCEL,
    query: async (sql, params) => (await open()).query(sql, params),
    tx: async work => (await open()).tx(work),
    close: async () => { if (ready) { const db = await ready.catch(() => null); ready = undefined; await db?.close(); } },
    info: async () => (await open()).kind,
  };
}
module.exports = { createDb, connectionString, ensureSchema, SCHEMA, SCHEMA_MT, TENANT_TABLES, PLATFORM_TABLES };
