/*
 * Test database. By default one in-memory PGlite per test file (each instance costs ~350 MB of WASM memory), wiped between tests.
 *
 * TEST_DATABASE_URL=postgresql://... runs the same tests through the real `pg` driver against a real Postgres (the code path Neon uses).
 * Safety: the tests TRUNCATE every table, so the database name must contain "test" and the URL must not be the app's DATABASE_URL.
 * Never point it at production / your Neon database; use `scripts/check-neon-live.js` for that (it only touches rows it created).
 */
const { createDb } = require('../server/db');
const TABLES = ['admin_accounts', 'clients', 'user_sessions', 'claims', 'space', 'admin_sessions', 'requests', 'subscriptions', 'outbox', 'settings', 'content_items', 'content_docs', 'admin_prefs', 'sync_state', 'media', 'guest_chats', 'campaigns', 'campaign_deliveries', 'saas_tenants', 'saas_domains', 'saas_super', 'saas_super_sessions', 'saas_demos', 'saas_assignments', 'saas_themes', 'saas_audit', 'saas_apis', 'saas_kv'];
const REAL_URL = process.env.TEST_DATABASE_URL || '';
if (REAL_URL) {
  const name = (() => { try { return decodeURIComponent(new URL(REAL_URL).pathname.slice(1)); } catch { return ''; } })();
  if (!/test/i.test(name) || (process.env.DATABASE_URL && process.env.DATABASE_URL === REAL_URL)) {
    throw new Error(`Refusing to run destructive tests on "${name}": TEST_DATABASE_URL must point to a database whose name contains "test" and differs from DATABASE_URL.`);
  }
}
let shared;
async function freshDb() {
  shared ||= createDb(REAL_URL ? { DATABASE_URL: REAL_URL, DB_POOL_MAX: '4' } : { PGLITE_DIR: ':memory:' });
  await shared.query('select 1');
  const existing = new Set((await shared.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).map(row => row.tablename));
  await shared.query(`TRUNCATE ${TABLES.filter(table => existing.has(table)).join(', ')} RESTART IDENTITY CASCADE`);
  return { ...shared, close: async () => {} };
}
module.exports = { freshDb, closeShared: async () => { if (shared) await shared.close(); shared = undefined; } };
