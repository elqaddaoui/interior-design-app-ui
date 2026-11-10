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
CREATE UNIQUE INDEX IF NOT EXISTS admin_accounts_email ON admin_accounts(lower(email)) WHERE email <> '';
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ua TEXT;
`;

/**
 * Super Admin schema. Kept apart from SCHEMA on purpose: it has its own version marker and a failure here (for example a table with the same name
 * created by something else in a shared database) must never stop the public app, so it is applied best-effort and retried on the next start.
 */
const SCHEMA_SA = `
-- Super Admin (platform owner): ONE account (id 1) with its own sessions, separate from the administrators above. pw_hash is only set once the
-- default credentials were changed from the dashboard (scrypt, salt:hex).
CREATE TABLE IF NOT EXISTS superadmin_account (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', pw_hash TEXT, pw_changed_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, last_login_at BIGINT
);
CREATE TABLE IF NOT EXISTS superadmin_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL, ua TEXT, ip TEXT);
-- Roles of the administrators (permissions per area + the menu pages they may open) and tenants (the organisations the administrators belong to).
CREATE TABLE IF NOT EXISTS sa_roles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', permissions TEXT NOT NULL DEFAULT '{}', ui TEXT NOT NULL DEFAULT '[]',
  system INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sa_tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', contact_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', max_admins INTEGER, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS role_id TEXT;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS perm_override TEXT;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_accounts ADD COLUMN IF NOT EXISTS tenant_id TEXT;
-- Everything the Super Admin changes (and failed sign-in attempts, which also drive the brute-force lock).
CREATE TABLE IF NOT EXISTS sa_audit (id TEXT PRIMARY KEY, at BIGINT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', ip TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS sa_audit_at ON sa_audit(at DESC);
CREATE INDEX IF NOT EXISTS sa_audit_ip ON sa_audit(ip, action, at);
`;

const isLocal = url => /@(localhost|127\.0\.0\.1)[:/]/.test(url);
/** Pool size: 3 per serverless instance (many instances), 5 for the single long-running server; DB_POOL_MAX (1-20) overrides. */
const poolMax = env => Math.max(1, Math.min(20, Number(env.DB_POOL_MAX) || (env.VERCEL ? 3 : 5)));

async function openPg(url, env = {}) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, value => Number(value)); // BIGINT -> number (timestamps stay far below 2^53)
  const pool = new Pool({ connectionString: url, max: poolMax(env), idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, ssl: isLocal(url) ? false : { rejectUnauthorized: false } });
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
 * Marker row written after the schema was applied. Its value is a hash of SCHEMA, so editing the schema above makes the
 * next start re-apply it once, while every other cold start only pays for ONE cheap SELECT instead of ~40 DDL statements
 * (each of which takes a lock on a database that may have just woken up).
 */
const SCHEMA_VERSION = crypto.createHash('sha1').update(SCHEMA).digest('hex').slice(0, 12);
const SCHEMA_SA_VERSION = crypto.createHash('sha1').update(SCHEMA_SA).digest('hex').slice(0, 12);
const mark = (key, value) => ["INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, value]];
/**
 * `migrationUrl` (DATABASE_URL_UNPOOLED, optional): the schema DDL then runs once over a short-lived direct connection, which
 * is what Neon recommends for migrations (its pooler runs PgBouncer in transaction mode). Normal queries stay on the pooled URL.
 */
async function applySchema(db, migrationUrl, sql, key, version) {
  if (migrationUrl) {
    const { Client } = require('pg');
    const direct = new Client({ connectionString: migrationUrl, connectionTimeoutMillis: 10000, ssl: isLocal(migrationUrl) ? false : { rejectUnauthorized: false } });
    direct.on('error', () => {});
    await direct.connect();
    try {
      await direct.query(sql);
      await direct.query(...mark(key, version));
    } finally { await direct.end().catch(() => {}); }
    return;
  }
  await db.exec(sql);
  await db.query(...mark(key, version));
}
async function ensureSchema(db, migrationUrl, status = {}) {
  let markers = {};
  try {
    markers = Object.fromEntries((await db.query("SELECT key, value FROM settings WHERE key IN ('schema_version','schema_sa_version')")).map(r => [r.key, r.value]));
  } catch { /* no settings table yet: fresh database */ }
  if (markers.schema_version !== SCHEMA_VERSION) await applySchema(db, migrationUrl, SCHEMA, 'schema_version', SCHEMA_VERSION);
  // The Super Admin tables are an add-on: if they cannot be created (permissions, a clashing object in a shared database) the public app,
  // its content and the administrators' panel must still start. Only the Super Admin / roles features are unavailable until it succeeds.
  if (markers.schema_sa_version !== SCHEMA_SA_VERSION) {
    try { await applySchema(db, migrationUrl, SCHEMA_SA, 'schema_sa_version', SCHEMA_SA_VERSION); }
    catch (error) { status.superAdmin = String(error?.code || 'error'); console.warn('[dwira] Super Admin schema not applied:', status.superAdmin); }
  }
}

/** Lazily opened and schema-initialised once per process (one cold start on Vercel). */
function createDb(env = process.env) {
  const url = connectionString(env);
  let ready;
  const status = { superAdmin: 'ok' };
  const open = () => ready ||= (async () => {
    // PGlite is a dev/test dependency only. Production on Vercel must provide a real database,
    // because serverless instances have no durable disk.
    if (!url && env.VERCEL) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status: 503 });
    const db = url ? await openPg(url, env) : await openLite(env.PGLITE_DIR === ':memory:' ? undefined : env.PGLITE_DIR || (env.NODE_ENV === 'test' ? undefined : require('node:path').join(__dirname, 'data', 'pglite')));
    const migrationUrl = url && env.DATABASE_URL_UNPOOLED && env.DATABASE_URL_UNPOOLED !== url ? env.DATABASE_URL_UNPOOLED : '';
    // A failed attempt must not leave its pool (and connections) behind: the caller may retry.
    try { await ensureSchema(db, migrationUrl, status); } catch (error) { await db.close().catch(() => {}); throw error; }
    return db;
  })().catch(error => { ready = undefined; throw error; });
  return {
    configured: () => !!url || !env.VERCEL,
    query: async (sql, params) => (await open()).query(sql, params),
    tx: async work => (await open()).tx(work),
    close: async () => { if (ready) { const db = await ready.catch(() => null); ready = undefined; await db?.close(); } },
    info: async () => (await open()).kind,
    /** 'ok', or the error code when the (optional) Super Admin tables could not be created. */
    status: () => status.superAdmin,
  };
}
module.exports = { createDb, connectionString };
