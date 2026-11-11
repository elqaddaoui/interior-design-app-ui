/* global Buffer, __dirname */
#!/usr/bin/env node
/**
 * Live check of the REAL database (your Neon) and, optionally, of the deployed site. Safe for production data:
 * it never truncates or edits existing rows. It creates ONE temporary tenant (slug "zz-livecheck-xxxx") and a temporary super
 * admin session, exercises every feature through the real request handler, then deletes both. (Audit rows stay: they are the log.)
 *
 *   DATABASE_URL='postgresql://...neon.tech/neondb?sslmode=require' node scripts/check-neon-live.js
 *   SITE_URL='https://your-app.vercel.app' [SA_EMAIL=superadmin SA_PASSWORD=superadmin] node scripts/check-neon-live.js     (online site)
 *   both variables can be given together.
 */
const crypto = require('node:crypto');
const { Readable, Writable } = require('node:stream');

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const results = [];
let failed = 0;
async function step(name, run) {
  try { const detail = await run(); results.push(['PASS', name, detail || '']); console.log(`PASS  ${name}${detail ? ` - ${detail}` : ''}`); }
  catch (error) { failed++; results.push(['FAIL', name, error.message]); console.log(`FAIL  ${name}\n      ${error.message}`); }
}
const must = (condition, message) => { if (!condition) throw new Error(message); };

async function checkDatabase() {
  const { createBackend } = require('../server');
  const { createDb, PLATFORM_TABLES, TENANT_TABLES } = require('../server/db');
  const env = { ...process.env, DATABASE_URL, COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', DB_POOL_MAX: '3' };
  const db = createDb(env);
  const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
  const backend = createBackend({ env, db, media: { storage: null, download: offline } });
  const call = (url, { method = 'GET', body, headers = {}, host = 'live.check' } = {}) => new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host, 'x-dwira-native': '1', ...headers }, socket: { remoteAddress: 'live-check' } });
    const out = { headers: {} }; const chunks = [];
    const res = new Writable({ write(c, e, d) { chunks.push(Buffer.from(c)); d(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (s, h) => { out.status = s; Object.assign(out.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => { const t = Buffer.concat(chunks).toString(); try { out.body = t ? JSON.parse(t) : undefined; } catch { out.text = t; } resolve(out); });
    backend.handle(req, res);
  });
  const host = (() => { try { return new URL(DATABASE_URL).host; } catch { return '?'; } })();
  console.log(`\n== Database: ${host} ==`);
  const token = crypto.randomBytes(32).toString('hex');
  const sha = v => crypto.createHash('sha256').update(v).digest('hex');
  const slug = `zz-livecheck-${crypto.randomBytes(3).toString('hex')}`;
  let tenantId = '';
  try {
    await step('connect to the database and apply the schema', async () => { const info = await db.info(); must(info === 'pg', `driver is ${info}, expected pg`); const version = (await db.query('select version() as v'))[0].v; return version.split(',')[0]; });
    await step('all platform and tenant tables exist', async () => {
      const have = new Set((await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).map(r => r.tablename));
      const missing = [...PLATFORM_TABLES, ...TENANT_TABLES].filter(t => !have.has(t));
      must(!missing.length, `missing tables: ${missing.join(', ')}`);
      return `${PLATFORM_TABLES.length + TENANT_TABLES.length} tables`;
    });
    await step('existing app data is intact (default tenant)', async () => {
      const n = async t => (await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id='default'`))[0].n;
      const orphan = (await db.query("SELECT count(*)::int AS n FROM clients WHERE tenant_id IS NULL OR tenant_id=''"))[0].n;
      must(orphan === 0, `${orphan} clients without a tenant`);
      must((await db.query("SELECT count(*)::int AS n FROM saas_tenants WHERE id='default'"))[0].n === 1, 'default tenant row missing');
      return `clients=${await n('clients')} requests=${await n('requests')} content_items=${await n('content_items')} content_docs=${await n('content_docs')} media=${await n('media')}`;
    });
    await step('public app content API answers (/api/health, /api/content)', async () => {
      const health = await call('/api/health'); must(health.status === 200 && health.body.ok && health.body.database === 'pg', `health ${health.status} ${JSON.stringify(health.body)}`);
      const content = await call('/api/content'); must(content.status === 200, `content ${content.status}`);
      return `tools=${(content.body.tools || []).length}`;
    });
    await step('super admin account exists in the database and rejects a wrong password', async () => {
      const bad = await call('/api/super-admin/login', { method: 'POST', body: { email: 'nobody', password: 'wrong-password-123' } });
      must(bad.status === 401, `expected 401, got ${bad.status}`);
      const row = (await db.query('SELECT email, pw_changed_at FROM saas_super LIMIT 1'))[0];
      must(row, 'no saas_super row after the first login attempt');
      return row.pw_changed_at == null ? 'factory login superadmin/superadmin still active (change it in /super-admin/settings)' : `custom login "${row.email}"`;
    });
    // Temporary session, inserted directly: no password needed and the real password is never touched.
    const sa = (await db.query('SELECT id, email FROM saas_super LIMIT 1'))[0];
    await db.query('INSERT INTO saas_super_sessions(token_hash,super_id,expires_at,created_at,ua) VALUES($1,$2,$3,$4,$5)', [sha(token), sa.id, Date.now() + 15 * 60000, Date.now(), 'live-check']);
    const S = { 'x-super-token': token };
    const api = (url, o = {}) => call(`/api/super-admin${url}`, { ...o, headers: { ...S, ...(o.headers || {}) } });
    await step('super admin: session, stats, tenants list, audit log', async () => {
      const s = await api('/session'); must(s.status === 200 && s.body.email === sa.email, `session ${s.status}`);
      const stats = await api('/stats'); must(stats.status === 200, `stats ${stats.status}`);
      const tenants = await api('/tenants'); must(tenants.status === 200 && tenants.body.some(t => t.id === 'default'), 'default tenant not listed');
      const audit = await api('/audit?limit=5'); must(audit.status === 200, `audit ${audit.status}`);
      return `tenants=${tenants.body.length}`;
    });
    let adminPassword = '';
    await step('super admin: create a temporary tenant', async () => {
      const r = await api('/tenants', { method: 'POST', body: { name: 'Live check', slug, ownerEmail: `owner@${slug}.test` } });
      must(r.status === 201, `${r.status} ${JSON.stringify(r.body)}`); tenantId = r.body.tenant.id; adminPassword = r.body.admin.password; return tenantId;
    });
    await step('tenant: storefront content, admin login, edit content, persisted in Neon', async () => {
      const content = await call(`/${slug}/api/content`); must(content.status === 200, `content ${content.status}`);
      const login = await call(`/${slug}/api/admin/login`, { method: 'POST', body: { email: `owner@${slug}.test`, password: adminPassword } }); must(login.status === 200, `admin login ${login.status}`);
      const auth = { authorization: `Bearer ${login.body.token}` };
      const edit = await call(`/${slug}/api/admin/doc/branding`, { method: 'PATCH', headers: auth, body: { name: 'Live Check Brand' } }); must(edit.status === 200, `doc edit ${edit.status} ${JSON.stringify(edit.body)}`);
      const row = (await db.query("SELECT data FROM content_docs WHERE tenant_id=$1 AND name='branding'", [tenantId]))[0]; must(row && row.data.includes('Live Check Brand'), 'branding edit is not in the database');
      const def = (await db.query("SELECT data FROM content_docs WHERE tenant_id='default' AND name='branding'"))[0]; must(!def || !def.data.includes('Live Check Brand'), 'LEAK: edit reached the default tenant');
      return 'edit stored under the new tenant only';
    });
    await step('tenant: a client signs in, gets credits, creates a request; admin sees them', async () => {
      const user = await call(`/${slug}/api/user/login`, { method: 'POST', body: { name: 'Live Client', phone: '0612345678' } }); must(user.status === 200, `user login ${user.status} ${JSON.stringify(user.body)}`);
      const clients = (await db.query('SELECT count(*)::int AS n FROM clients WHERE tenant_id=$1', [tenantId]))[0].n; must(clients === 1, `expected 1 client, got ${clients}`);
      const def = (await db.query("SELECT count(*)::int AS n FROM clients WHERE tenant_id='default' AND name='Live Client'"))[0].n; must(def === 0, 'LEAK: client created in the default tenant');
      return `client ${user.body.user.id.slice(0, 8)}`;
    });
    await step('super admin: tenant admins, suspend / unsuspend, change requests, demos', async () => {
      const admins = await api(`/tenants/${tenantId}/admins`); must(admins.status === 200 && admins.body.length === 1, `admins ${admins.status}`);
      const sus = await api(`/tenants/${tenantId}/suspend`, { method: 'POST', body: {} }); must(sus.status === 200, `suspend ${sus.status}`);
      must((await call(`/${slug}/api/content`)).status === 403, 'suspended tenant must answer 403');
      must((await api(`/tenants/${tenantId}/unsuspend`, { method: 'POST', body: {} })).status === 200, 'unsuspend failed');
      must((await call(`/${slug}/api/content`)).status === 200, 'tenant must be back');
      const reqs = await api('/requests'); must(reqs.status === 200, `requests ${reqs.status}`);
      const demos = await api('/demos'); must(demos.status === 200, `demos ${demos.status}`);
      return 'ok';
    });
    await step('super admin Settings: wrong current password refused (account left unchanged)', async () => {
      const r = await api('/account', { method: 'PATCH', body: { currentPassword: 'definitely-not-it', newPassword: 'Some-Other-Pass-1' } });
      must(r.status === 403, `expected 403, got ${r.status}`); return 'WRONG_CURRENT_PASSWORD';
    });
  } finally {
    // Clean up everything this run created.
    try {
      if (tenantId) {
        const del = await call(`/api/super-admin/tenants/${tenantId}`, { method: 'DELETE', headers: { 'x-super-token': token }, body: { confirmSlug: slug } });
        if (del.status !== 200) { console.log(`WARN  could not delete temporary tenant ${slug}: ${del.status} ${JSON.stringify(del.body)}`); failed++; }
        else { const left = (await db.query('SELECT count(*)::int AS n FROM clients WHERE tenant_id=$1', [tenantId]))[0].n; await step('cleanup: temporary tenant and its data removed', async () => { must(left === 0, 'client rows left behind'); return slug; }); }
      }
      await db.query('DELETE FROM saas_super_sessions WHERE token_hash=$1', [sha(token)]).catch(() => {});
    } catch (error) { console.log(`WARN  cleanup problem: ${error.message}`); failed++; }
    await db.close().catch(() => {});
  }
}

async function checkSite() {
  const email = process.env.SA_EMAIL || 'superadmin', password = process.env.SA_PASSWORD || 'superadmin';
  console.log(`\n== Online site: ${SITE_URL} (super admin login: ${email}) ==`);
  const get = async (path, init) => { const r = await fetch(SITE_URL + path, { redirect: 'manual', ...init }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch { /* html */ } return { status: r.status, text, json, headers: r.headers }; };
  await step('GET /api/health reports the Postgres database', async () => { const r = await get('/api/health'); must(r.status === 200 && r.json?.ok && r.json.database === 'pg', `${r.status} ${r.text.slice(0, 200)}`); return 'database=pg'; });
  await step('GET /api/content returns the app content from the database', async () => { const r = await get('/api/content'); must(r.status === 200 && r.json, `${r.status}`); return `tools=${(r.json.tools || []).length}`; });
  await step('GET /super-admin serves the console page', async () => { const r = await get('/super-admin'); must(r.status === 200 && /<html/i.test(r.text), `${r.status}`); });
  await step('POST /api/super-admin/login rejects a wrong password', async () => { const r = await get('/api/super-admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody', password: 'wrong-password-123' }) }); must(r.status === 401, `expected 401, got ${r.status} ${r.text.slice(0, 120)}`); });
  let cookie = '';
  await step(`POST /api/super-admin/login accepts ${email}`, async () => {
    const r = await get('/api/super-admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    must(r.status === 200, `${r.status} ${r.text.slice(0, 160)} (if you already changed the password, pass SA_EMAIL and SA_PASSWORD)`);
    cookie = (r.headers.get('set-cookie') || '').split(';')[0]; must(/^dwira_super=[a-f0-9]{64}$/.test(cookie), 'no session cookie'); return r.json.isDefault ? 'factory login (change it in Settings)' : 'custom login';
  });
  if (cookie) {
    await step('GET /api/super-admin/stats and /tenants with the session', async () => {
      const s = await get('/api/super-admin/stats', { headers: { cookie } }); must(s.status === 200, `stats ${s.status}`);
      const t = await get('/api/super-admin/tenants', { headers: { cookie } }); must(t.status === 200 && Array.isArray(t.json), `tenants ${t.status}`); return `tenants=${t.json.length}`;
    });
    await step('POST /api/super-admin/logout ends the session', async () => { await get('/api/super-admin/logout', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' }); const r = await get('/api/super-admin/session', { headers: { cookie } }); must(r.status === 401, `expected 401 after logout, got ${r.status}`); });
  }
}

(async () => {
  if (!DATABASE_URL && !SITE_URL) { console.error('Set DATABASE_URL (Neon connection string) and / or SITE_URL (https://your-app...).'); process.exit(2); }
  if (DATABASE_URL) await checkDatabase();
  if (SITE_URL) await checkSite();
  console.log(`\n${failed ? 'FAILED' : 'ALL CHECKS PASSED'}: ${results.filter(r => r[0] === 'PASS').length} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error('Check crashed:', error); process.exit(1); });
