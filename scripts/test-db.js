/* One in-memory PGlite per test file (each instance costs ~350 MB of WASM memory), wiped between tests. */
const { createDb } = require('../server/db');
const TABLES = ['admin_accounts', 'clients', 'user_sessions', 'claims', 'space', 'admin_sessions', 'requests', 'subscriptions', 'outbox', 'settings', 'content_items', 'content_docs', 'admin_prefs', 'sync_state', 'media', 'guest_chats', 'campaigns', 'campaign_deliveries', 'tenants', 'roles', 'tenant_accounts', 'super_sessions', 'audit_log'];
let shared;
async function freshDb() {
  shared ||= createDb({ PGLITE_DIR: ':memory:' });
  await shared.query('select 1');
  await shared.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  return { ...shared, close: async () => {} };
}
module.exports = { freshDb, closeShared: async () => { if (shared) await shared.close(); shared = undefined; } };
