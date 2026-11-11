// Lost the super admin password? Run on the server (needs DATABASE_URL, same variables as the app):
//   node server/reset-superadmin.js
// It puts the account back to the factory login (superadmin / superadmin), ends every super admin session and writes an audit row.
// Sign in at /super-admin and change the e-mail and password in Settings straight away.
const { createDb } = require('./db');
const { createSuperAdmin } = require('./superadmin');
(async () => {
  const db = createDb(process.env);
  try {
    await createSuperAdmin({ db, env: process.env, bundles: {}, tenants: {} }).resetToDefault();
    console.log('Super admin reset: sign in at /super-admin with superadmin / superadmin, then change it in Settings.');
  } catch (error) { console.error('Reset failed:', error.message); process.exitCode = 1; }
  finally { await db.close().catch(() => {}); }
})();
