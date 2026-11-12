/**
 * Platform back office (docs/MULTI_TENANT_PLAN.md sections 5 and 6): the ONLY code that reads and writes the `saas_*` tables and the
 * only tenant-aware code that uses the raw database on purpose (it manages tenants; it is never reachable from a tenant's own routes).
 *
 *   - Super admin identity: separate table, cookie and header from every tenant admin. The account lives in the database (saas_super):
 *     factory login superadmin / superadmin (or the optional SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD_HASH seed), changed in the console.
 *   - Tenants: create / edit / suspend / delete, their administrators and custom domains. Everything is audited.
 *   - Demos: a demo is a TEMPLATE tenant (kind 'demo') with sample data. Assigning it makes an independent tenant instance by VALUE
 *     (one transaction, no shared row, no reference back). Later edits of either side never reach the other.
 *   - Store themes: a UI-only snapshot (colours, fonts, branding, home / tools / explore content, never client data, keys or admins)
 *     taken from the tenants the super admin selects. A new demo starts from one; its pictures are held under the theme's own id.
 *   - Hand-off: a one-time, 60 second code that opens a tenant's admin dashboard without a separate login (Customize / Admin icons).
 *
 * Nothing here stores or reads a style: the Super Admin's look is hard-coded in src/superadmin/tokens.ts.
 */
const crypto = require('node:crypto');
const { passwordMatches, hashPassword, passwordProblem } = require('./admins');
const { slugProblem } = require('../src/lib/reservedSlugs');
const { TENANT_TABLES } = require('./db');
const { keyFor, EXT } = require('./media');
const { TENANT_ID } = require('./scope');
const THEME_ID = /^th_[a-f0-9]{12}$/;

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,24}$/;
const newId = prefix => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const SESSION_MS = 12 * 3600 * 1000;
const RETIRE_MS = 30 * 86400000; // a released slug stays reserved for 30 days (Q6)
const HANDOFF_MS = 60000;
// What a store theme carries. Everything else (clients, requests, chats, admins, settings with secrets, AI models and their keys) never leaves the tenant.
const UI_COLLS = ['tabs', 'tools', 'roomTypes', 'styles', 'palettes', 'sections', 'categories', 'inspirations', 'plans'];
const UI_DOCS = ['branding', 'theme'];
const UI_SETTINGS = ['toolCards', 'homeTabsVisible', 'homeShowAll', 'userNavStyle', 'layouts', 'adminMenuDesign', 'adminMenuAnim', 'arabicFont', 'frenchFont', 'galleryLayout',
  'loaderEnabled', 'loaderStyle', 'loaderColor', 'loaderCustomUri', 'loaderCustomAnim', 'loaderDelayMs', 'modeChoice', 'waChat'];
const MEDIA_REF = /\/api\/media\/([a-f0-9]{32})\.([a-z0-9]+)/g;
const MAX_SNAPSHOT = 6 * 1024 * 1024;
const placeholders = (rows, width) => rows.map((_, n) => `(${Array.from({ length: width }, (__, k) => `$${n * width + k + 1}`).join(',')})`).join(',');
let PRESET_COLORS = {};
try { PRESET_COLORS = require('./theme-presets.json'); } catch { /* the preview then uses neutral colours */ }
const DEMO_STATUS = ['draft', 'published'];
const TENANT_STATUS = ['active', 'trial'];
// Settings keys a new instance inherits from its demo. Everything else (AI provider keys, VAPID, rotation cursor, counters, notification
// switches that point at a person) is deliberately NOT here: an instance starts with its own secrets and counters.
const COPIED_SETTINGS = ['content_seeded', 'media_migrated_v2', 'assistant_automations', 'prompt_rules'];
// Children before parents (foreign keys), then anything a future release adds to TENANT_TABLES.
const DELETE_ORDER = ['campaign_deliveries', 'campaigns', 'space', 'claims', 'user_sessions', 'guest_chats', 'requests', 'outbox', 'subscriptions', 'clients',
  'admin_sessions', 'admin_prefs', 'admin_accounts', 'content_items', 'content_docs', 'settings', 'sync_state', 'media'];
const num = value => (value == null ? null : Number(value));
const randomPassword = () => crypto.randomBytes(12).toString('base64url');

const SUPER_ID = 'super';
const DEFAULT_LOGIN = 'superadmin'; // factory e-mail AND password of the platform owner, to be changed in /super-admin/settings
// A login id is an e-mail address or a plain user name (the factory one is "superadmin").
const LOGIN_ID = /^[a-z0-9][a-z0-9._@+-]{2,189}$/;
// A store administrator's user name (no @: it can never be mistaken for an e-mail address).
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,39}$/;

function createSuperAdmin({ db, env = process.env, bundles, tenants, storage = bundles.storage }) {
  const platform = bundles.platform; // allowances + API manager (server/platform.js)
  const attempts = new Map(); // address -> { count, until }: 5 failed sign-ins lock that address for 15 minutes
  const cookieFlags = `HttpOnly; SameSite=Strict; Path=/api${env.COOKIE_SECURE === 'false' ? '' : '; Secure'}`;
  /** The console is always available: the account lives in the database (saas_super), it is never "not configured". */
  const configured = () => true;

  // ---------- Identity ----------
  /**
   * The single platform owner account. Created on first use, in this order of preference:
   *   1. SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD_HASH (optional deployment seed, same scrypt format as ADMIN_PASSWORD_HASH),
   *   2. the factory login superadmin / superadmin (flagged `isDefault` until the password is changed in the console).
   * After that the database row is the only source of truth: changing the e-mail / password in the console is permanent and the
   * environment seed is never applied again.
   */
  async function account() {
    const found = (await db.query('SELECT * FROM saas_super ORDER BY created_at, id LIMIT 1'))[0];
    if (found) {
      // A row written by the earlier environment-only version already holds real credentials: it is not the factory login.
      if (found.pw_changed_at == null && found.email !== DEFAULT_LOGIN) { found.pw_changed_at = Number(found.created_at) || 1; await db.query('UPDATE saas_super SET pw_changed_at=$1 WHERE id=$2 AND pw_changed_at IS NULL', [found.pw_changed_at, found.id]); }
      return found;
    }
    const seeded = !!(env.SUPERADMIN_EMAIL && env.SUPERADMIN_PASSWORD_HASH);
    const email = (seeded ? clean(env.SUPERADMIN_EMAIL, 190) : DEFAULT_LOGIN).toLowerCase();
    const hash = seeded ? env.SUPERADMIN_PASSWORD_HASH : hashPassword(DEFAULT_LOGIN);
    const now = Date.now();
    await db.query('INSERT INTO saas_super(id,email,name,pw_hash,created_at,pw_changed_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [SUPER_ID, email, 'Super admin', hash, now, seeded ? now : null]);
    return (await db.query('SELECT * FROM saas_super ORDER BY created_at, id LIMIT 1'))[0];
  }
  const accountView = row => ({ email: row.email, isDefault: row.pw_changed_at == null, passwordChangedAt: num(row.pw_changed_at), lastLoginAt: num(row.last_login_at) });

  async function login(ip, ua, body) {
    const now = Date.now();
    const lock = attempts.get(ip);
    if (lock && lock.until > now && lock.count >= 5) throw fail(429, 'Too many attempts');
    const row = await account();
    const email = clean(body?.email, 190).toLowerCase();
    const password = typeof body?.password === 'string' && body.password.length <= 512 ? body.password : '';
    // The hash is always computed (same cost whatever the e-mail) so timing does not tell which part was wrong.
    const passwordOk = passwordMatches(password, row.pw_hash);
    if (!(passwordOk && email === row.email)) {
      const entry = lock && lock.until > now ? lock : { count: 0, until: now + 15 * 60000 };
      entry.count++; attempts.set(ip, entry);
      if (attempts.size > 5000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
      throw fail(401, 'Invalid credentials');
    }
    if (row.disabled) throw fail(403, 'ACCOUNT_DISABLED');
    attempts.delete(ip);
    await db.query('UPDATE saas_super SET last_login_at=$1 WHERE id=$2', [now, row.id]);
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM saas_super_sessions WHERE expires_at<=$1', [now]);
    await db.query('INSERT INTO saas_super_sessions(token_hash,super_id,expires_at,created_at,ua) VALUES($1,$2,$3,$4,$5)', [sha(token), row.id, now + SESSION_MS, now, String(ua || '').slice(0, 300)]);
    await audit(row.email, 'super.login', null, '', row.pw_changed_at == null ? 'default credentials' : '');
    return { token, email: row.email, isDefault: row.pw_changed_at == null, cookie: `dwira_super=${token}; ${cookieFlags}; Max-Age=${SESSION_MS / 1000}` };
  }
  const clearCookie = () => `dwira_super=; ${cookieFlags}; Max-Age=0`;
  const tokenOf = req => {
    const header = req.headers['x-super-token'];
    if (typeof header === 'string' && /^[a-f0-9]{64}$/.test(header)) return header;
    const raw = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_super='))?.slice(12);
    return raw && /^[a-f0-9]{64}$/.test(raw) ? raw : '';
  };
  /** The signed-in super admin or null. */
  async function authenticate(req) {
    const token = tokenOf(req);
    if (!token) return null;
    const row = (await db.query('SELECT s.super_id, u.email, u.pw_changed_at FROM saas_super_sessions s JOIN saas_super u ON u.id=s.super_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.disabled=0', [sha(token), Date.now()]))[0];
    return row ? { id: row.super_id, email: row.email, isDefault: row.pw_changed_at == null, token } : null;
  }
  /**
   * Settings > Account: change the sign-in e-mail and / or the password. The current password is always required (a stolen session
   * alone cannot take the account over). Every OTHER session is signed out; the current one stays.
   */
  async function updateAccount(me, body) {
    const row = await account();
    if (!passwordMatches(typeof body?.currentPassword === 'string' ? body.currentPassword.slice(0, 512) : '', row.pw_hash)) throw fail(403, 'WRONG_CURRENT_PASSWORD');
    const wantsEmail = body?.email !== undefined && body.email !== null && String(body.email).trim() !== '';
    const wantsPassword = body?.newPassword !== undefined && body.newPassword !== null && String(body.newPassword) !== '';
    if (!wantsEmail && !wantsPassword) throw fail(400, 'NOTHING_TO_CHANGE');
    const email = wantsEmail ? clean(body.email, 190).toLowerCase() : row.email;
    if (!LOGIN_ID.test(email)) throw fail(400, 'INVALID_LOGIN');
    let hash = row.pw_hash, changedAt = row.pw_changed_at;
    if (wantsPassword) {
      const next = String(body.newPassword);
      if (next.toLowerCase() === DEFAULT_LOGIN || passwordProblem(next, { username: email, email })) throw fail(400, 'WEAK_PASSWORD');
      if (next === body.currentPassword) throw fail(400, 'SAME_PASSWORD');
      hash = hashPassword(next); changedAt = Date.now();
    } else if (changedAt == null && email === DEFAULT_LOGIN) {
      throw fail(400, 'NOTHING_TO_CHANGE');
    }
    // Changing only the e-mail still ends the "factory credentials" state only if the password is also changed.
    await db.tx(async q => {
      await q('UPDATE saas_super SET email=$1, pw_hash=$2, pw_changed_at=$3 WHERE id=$4', [email, hash, changedAt, row.id]);
      await q('DELETE FROM saas_super_sessions WHERE super_id=$1 AND token_hash<>$2', [row.id, sha(me.token)]);
    });
    attempts.clear();
    await audit(email, 'super.account.update', null, '', [wantsEmail && email !== row.email ? 'email' : '', wantsPassword ? 'password' : ''].filter(Boolean).join('+'));
    return accountView((await db.query('SELECT * FROM saas_super WHERE id=$1', [row.id]))[0]);
  }
  /** Used by `node server/reset-superadmin.js` when the password was lost: back to superadmin / superadmin, every session ended. */
  async function resetToDefault() {
    const row = await account();
    await db.tx(async q => {
      await q('UPDATE saas_super SET email=$1, pw_hash=$2, pw_changed_at=NULL, disabled=0 WHERE id=$3', [DEFAULT_LOGIN, hashPassword(DEFAULT_LOGIN), row.id]);
      await q('DELETE FROM saas_super_sessions WHERE super_id=$1', [row.id]);
    });
    await audit(DEFAULT_LOGIN, 'super.account.reset', null, '', 'reset to factory login from the server');
  }

  // ---------- Audit ----------
  async function audit(actor, action, tenantId, target, detail) {
    await db.query('INSERT INTO saas_audit(id,at,actor,action,tenant_id,target,detail) VALUES($1,$2,$3,$4,$5,$6,$7)', [newId('au'), Date.now(), actor, action, tenantId || null, String(target || '').slice(0, 200), typeof detail === 'string' ? detail.slice(0, 1000) : JSON.stringify(detail || '').slice(0, 1000)]);
  }

  // ---------- Slugs ----------
  async function checkSlug(raw, { except } = {}) {
    const slug = clean(raw, 40).toLowerCase();
    const problem = slugProblem(slug);
    if (problem) throw fail(400, problem === 'reserved' ? 'SLUG_RESERVED' : 'INVALID_SLUG');
    const taken = (await db.query('SELECT id FROM saas_tenants WHERE slug=$1', [slug]))[0];
    if (taken && taken.id !== except) throw fail(409, 'SLUG_TAKEN');
    const retired = (await db.query('SELECT value FROM saas_kv WHERE key=$1', [`retired_slug:${slug}`]))[0];
    if (retired && Number(retired.value) > Date.now() && !except) throw fail(409, 'SLUG_RETIRED');
    return slug;
  }
  const retireSlug = (q, slug) => q('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`retired_slug:${slug}`, String(Date.now() + RETIRE_MS)]);

  // ---------- Tenants ----------
  const urls = row => ({ path: row.kind === 'default' ? '/' : `/${row.slug}`, adminPath: row.kind === 'default' ? '/admin' : `/${row.slug}/admin` });
  const linksOf = row => { try { return JSON.parse(row.api_links || '{}') || {}; } catch { return {}; } };
  const tenantView = row => ({
    id: row.id, slug: row.slug, name: row.name, kind: row.kind, status: row.status, plan: row.plan, ownerEmail: row.owner_email,
    sourceDemoId: row.source_demo_id, sourceDemoVersion: num(row.source_demo_version), notes: row.notes,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), suspendedAt: num(row.suspended_at), ...urls(row),
    creditLimit: num(row.credit_limit), creditsUsed: Number(row.credits_used || 0), apiMode: row.api_mode === 'platform' ? 'platform' : 'own', apiLinks: linksOf(row),
    ...(row.clients !== undefined ? { counts: { clients: row.clients, requests: row.requests, admins: row.admins, domains: row.domains } } : {}),
  });
  const getTenantRow = async id => {
    if (!TENANT_ID.test(String(id))) throw fail(404, 'NOT_FOUND');
    const row = (await db.query('SELECT * FROM saas_tenants WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };
  async function listTenants(kinds) {
    const rows = await db.query(`SELECT t.*,
      (SELECT COUNT(*) FROM clients c WHERE c.tenant_id=t.id)::int AS clients, (SELECT COUNT(*) FROM requests r WHERE r.tenant_id=t.id)::int AS requests,
      (SELECT COUNT(*) FROM admin_accounts a WHERE a.tenant_id=t.id)::int AS admins, (SELECT COUNT(*) FROM saas_domains d WHERE d.tenant_id=t.id)::int AS domains
      FROM saas_tenants t WHERE t.kind = ANY($1) ORDER BY t.created_at, t.id`, [kinds]);
    return rows.map(tenantView);
  }

  /**
   * Adds an administrator to a tenant. The sign-in name is a user name OR an e-mail address, and the e-mail is optional:
   *   { username }          -> signs in with the user name
   *   { email }             -> signs in with the e-mail (it is also the id)
   *   { username, email }   -> signs in with either
   *   neither               -> the user name "admin" (unique per store)
   * Returns the generated password when none was given (shown once, never stored in clear).
   */
  async function addAdmin(q, tenantId, { username, email, name, password, phone = '', title = '', pwHash }) {
    const address = clean(email, 254).toLowerCase();
    if (address && !EMAIL.test(address)) throw fail(400, 'INVALID_EMAIL');
    let id = clean(username, 40).toLowerCase();
    if (id && !USERNAME.test(id)) throw fail(400, 'INVALID_USERNAME');
    if (!id) id = address || 'admin';
    let generated = null, stored = pwHash;
    if (!stored) {
      let value = typeof password === 'string' && password ? password : '';
      if (value) { const problem = passwordProblem(value, { username: id, email: address }); if (problem) throw fail(400, problem); } else value = generated = randomPassword();
      stored = hashPassword(value);
    }
    const now = Date.now();
    try {
      await q('INSERT INTO admin_accounts(tenant_id,admin_id,name,email,phone,title,pw_hash,pw_changed_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)', [tenantId, id, clean(name, 80), address, phone, title, stored, now]);
    } catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'ADMIN_EXISTS'); throw error; }
    return { id, username: id, email: address, password: generated };
  }

  async function createTenant(body, actor, { kind = 'instance' } = {}) {
    const name = clean(body?.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    const slug = await checkSlug(body?.slug);
    const status = body?.status === undefined ? 'active' : body.status;
    if (!TENANT_STATUS.includes(status)) throw fail(400, 'INVALID_STATUS');
    // The store's contact e-mail is optional. The first administrator signs in with a user name or an e-mail (see addAdmin).
    const ownerEmail = clean(body?.ownerEmail, 254).toLowerCase();
    if (ownerEmail && !EMAIL.test(ownerEmail)) throw fail(400, 'INVALID_EMAIL');
    const policy = platform.policyFields(body, { forCreate: true });
    const id = newId('t'), now = Date.now();
    let admin;
    await db.tx(async q => {
      try {
        await q('INSERT INTO saas_tenants(id,slug,name,kind,status,plan,owner_email,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)', [id, slug, name, kind, status, clean(body?.plan, 40), ownerEmail, clean(body?.notes, 1000), now]);
      } catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
      admin = await addAdmin(q, id, { username: body?.ownerUsername, email: body?.ownerLogin || ownerEmail, name: body?.ownerName, password: body?.password });
    });
    if (Object.keys(policy).length) await platform.setPolicy(id, body);
    await bundles.get(id).content.ensureSeed(); // starter content now, so the tenant is complete from its first visit
    tenants.invalidate();
    await audit(actor, `tenant.create`, id, slug, { kind, owner: admin.id });
    return { tenant: tenantView(await getTenantRow(id)), admin };
  }

  async function updateTenant(id, body, actor) {
    const row = await getTenantRow(id);
    const next = {};
    if (body.name !== undefined) { next.name = clean(body.name, 80); if (next.name.length < 2) throw fail(400, 'INVALID_NAME'); }
    if (body.plan !== undefined) next.plan = clean(body.plan, 40);
    if (body.notes !== undefined) next.notes = clean(body.notes, 1000);
    if (body.ownerEmail !== undefined) { next.owner_email = clean(body.ownerEmail, 254).toLowerCase(); if (next.owner_email && !EMAIL.test(next.owner_email)) throw fail(400, 'INVALID_EMAIL'); }
    if (body.status !== undefined) {
      if (!TENANT_STATUS.includes(body.status)) throw fail(400, 'INVALID_STATUS');
      if (row.status === 'suspended') throw fail(409, 'USE_UNSUSPEND');
      next.status = body.status;
    }
    if (body.slug !== undefined && body.slug !== row.slug) {
      if (row.kind === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
      next.slug = await checkSlug(body.slug, { except: id });
    }
    const policy = platform.policyFields(body);
    if (body.resetUsed === true) policy.credits_used = 0;
    const keys = Object.keys(next);
    if (Object.keys(policy).length) {
      await platform.setPolicy(id, body);
      await bundles.get(id).sync.bump('credits'); // the store's open admin screens show the new allowance at once
      await audit(actor, 'tenant.policy', id, row.slug, Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, k === 'api_links' ? '(links)' : v])));
    }
    if (!keys.length) return tenantView(await getTenantRow(id));
    await db.tx(async q => {
      if (next.slug) await retireSlug(q, row.slug);
      try { await q(`UPDATE saas_tenants SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), id]); }
      catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
    });
    tenants.invalidate();
    await audit(actor, 'tenant.update', id, row.slug, Object.fromEntries(keys.map(k => [k, k === 'notes' ? '(edited)' : next[k]])));
    return tenantView(await getTenantRow(id));
  }

  async function setSuspended(id, suspended, actor) {
    const row = await getTenantRow(id);
    if (row.kind === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
    const now = Date.now();
    await db.query(suspended ? "UPDATE saas_tenants SET status='suspended', suspended_at=$1, updated_at=$1 WHERE id=$2" : "UPDATE saas_tenants SET status='active', suspended_at=NULL, updated_at=$1 WHERE id=$2", suspended ? [now, id] : [now, id]);
    tenants.invalidate();
    await audit(actor, suspended ? 'tenant.suspend' : 'tenant.unsuspend', id, row.slug, '');
    return tenantView(await getTenantRow(id));
  }

  /** Deletes one tenant and everything it owns. Files in object storage are removed best-effort. Returns what was purged. */
  async function deleteTenantData(row) {
    let purged = 0;
    if (storage && row.kind !== 'default') {
      const key = keyFor(row.id);
      for (const media of await db.query("SELECT id,mime FROM media WHERE tenant_id=$1 AND storage='r2'", [row.id])) {
        try { await storage.remove(key(`${media.id}.${EXT[media.mime]}`)); purged++; } catch { /* kept: a later purge can remove the prefix */ }
      }
    }
    await db.tx(async q => {
      for (const table of [...DELETE_ORDER, ...TENANT_TABLES.filter(t => !DELETE_ORDER.includes(t))]) await q(`DELETE FROM ${table} WHERE tenant_id=$1`, [row.id]);
      await q('DELETE FROM saas_domains WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_assignments WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_demos WHERE tenant_id=$1', [row.id]);
      await q('DELETE FROM saas_kv WHERE key=$1', [`demo_sample:${row.id}`]);
      await q('DELETE FROM saas_tenants WHERE id=$1', [row.id]);
      await retireSlug(q, row.slug);
    });
    bundles.drop(row.id);
    tenants.invalidate();
    return { purgedFiles: purged };
  }
  async function deleteTenant(id, body, actor) {
    const row = await getTenantRow(id);
    if (row.kind === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
    if (row.kind === 'demo') throw fail(409, 'USE_DEMO_DELETE');
    if (body?.confirmSlug !== row.slug) throw fail(400, 'CONFIRM_SLUG');
    const result = await deleteTenantData(row);
    await audit(actor, 'tenant.delete', id, row.slug, result);
    return { ok: true, ...result };
  }

  // ---------- Tenant administrators ----------
  const adminView = row => ({ id: row.admin_id, username: row.admin_id.includes('@') ? '' : row.admin_id, name: row.name, email: row.email, phone: row.phone, title: row.title, disabled: !!row.disabled, hasPassword: !!row.pw_hash, lastLoginAt: num(row.last_login_at), createdAt: Number(row.created_at) });
  const getAdminRow = async (tenantId, adminId) => {
    const row = (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=$1 AND admin_id=$2', [tenantId, String(adminId).toLowerCase()]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };
  const dropAdminSessions = (q, tenantId, adminId) => q('DELETE FROM admin_sessions WHERE tenant_id=$1 AND admin_id=$2', [tenantId, adminId]);
  const adminOps = {
    async list(tenantId) { await getTenantRow(tenantId); return (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=$1 ORDER BY created_at, admin_id', [tenantId])).map(adminView); },
    async create(tenantId, body, actor) {
      await getTenantRow(tenantId);
      const created = await addAdmin(db.query, tenantId, body || {});
      await audit(actor, 'admin.create', tenantId, created.email, '');
      return { admin: adminView(await getAdminRow(tenantId, created.id)), password: created.password };
    },
    async update(tenantId, adminId, body, actor) {
      await getTenantRow(tenantId);
      const row = await getAdminRow(tenantId, adminId);
      const next = {};
      if (body.name !== undefined) next.name = clean(body.name, 80);
      if (body.email !== undefined) {
        const email = clean(body.email, 254).toLowerCase();
        if (email && !EMAIL.test(email)) throw fail(400, 'INVALID_EMAIL'); // an empty e-mail is allowed: the user name still signs in
        next.email = email;
      }
      if (body.disabled !== undefined) next.disabled = body.disabled ? 1 : 0;
      const keys = Object.keys(next);
      if (keys.length) {
        try { await db.query(`UPDATE admin_accounts SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE tenant_id=$${keys.length + 2} AND admin_id=$${keys.length + 3}`, [...keys.map(k => next[k]), Date.now(), tenantId, row.admin_id]); }
        catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'EMAIL_TAKEN'); throw error; }
        if (next.disabled) await dropAdminSessions(db.query, tenantId, row.admin_id);
        await audit(actor, 'admin.update', tenantId, row.admin_id, Object.keys(next).join(','));
      }
      return adminView(await getAdminRow(tenantId, row.admin_id));
    },
    async resetPassword(tenantId, adminId, body, actor) {
      await getTenantRow(tenantId);
      const row = await getAdminRow(tenantId, adminId);
      let value = typeof body?.password === 'string' && body.password ? body.password : '', generated = null;
      if (value) { const problem = passwordProblem(value, { username: row.admin_id, email: row.email }); if (problem) throw fail(400, problem); } else value = generated = randomPassword();
      await db.query('UPDATE admin_accounts SET pw_hash=$1, pw_changed_at=$2, updated_at=$2 WHERE tenant_id=$3 AND admin_id=$4', [hashPassword(value), Date.now(), tenantId, row.admin_id]);
      await dropAdminSessions(db.query, tenantId, row.admin_id); // every device is signed out
      await audit(actor, 'admin.password_reset', tenantId, row.admin_id, '');
      return { ok: true, password: generated };
    },
    async remove(tenantId, adminId, actor) {
      await getTenantRow(tenantId);
      const row = await getAdminRow(tenantId, adminId);
      await db.tx(async q => {
        await dropAdminSessions(q, tenantId, row.admin_id);
        await q('DELETE FROM admin_prefs WHERE tenant_id=$1 AND admin_id=$2', [tenantId, row.admin_id]);
        await q("DELETE FROM subscriptions WHERE tenant_id=$1 AND owner_type='admin' AND owner_id=$2", [tenantId, row.admin_id]);
        await q('DELETE FROM admin_accounts WHERE tenant_id=$1 AND admin_id=$2', [tenantId, row.admin_id]);
      });
      await audit(actor, 'admin.delete', tenantId, row.admin_id, '');
      return { ok: true };
    },
  };

  // ---------- Demos (template tenants) ----------
  const slugify = text => String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const contentVersion = async tenantId => Number((await db.query("SELECT version FROM sync_state WHERE tenant_id=$1 AND key='content'", [tenantId]))[0]?.version ?? 0);
  const demoView = async row => ({
    id: row.id, name: row.name, description: row.description, status: row.status, tenantId: row.tenant_id, slug: row.slug,
    version: await contentVersion(row.tenant_id), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    assignments: row.assignments ?? 0, path: `/${row.slug}`, adminPath: `/${row.slug}/admin`, creditLimit: num(row.credit_limit), creditsUsed: Number(row.credits_used || 0),
  });
  const DEMO_SQL = 'SELECT d.*, t.slug, t.credit_limit, t.credits_used, (SELECT COUNT(*) FROM saas_assignments a WHERE a.demo_id=d.id)::int AS assignments FROM saas_demos d JOIN saas_tenants t ON t.id=d.tenant_id';
  const getDemoRow = async id => {
    const row = (await db.query(`${DEMO_SQL} WHERE d.id=$1`, [String(id)]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };

  /** A handful of clients and requests so the demo's dashboard is not empty. Their ids are recorded: ONLY these are copied to instances. */
  async function seedSample(tenantId) {
    const tools = (await db.query("SELECT id FROM content_items WHERE tenant_id=$1 AND coll='tools' ORDER BY id LIMIT 4", [tenantId])).map(row => row.id);
    const now = Date.now();
    const people = [['Salma Benali', '+212600000101', 3], ['Youssef Amrani', '+212600000102', 1], ['Nadia El Idrissi', '+212600000103', 5], ['Karim Tazi', '+212600000104', 0]];
    const clientIds = [], requestIds = [];
    const prompts = ['Warm Moroccan living room with zellige tiles', 'Minimal bedroom, natural light, linen', 'Bright kitchen with open shelves', 'Modern salon, green and gold accents', 'Small balcony turned into a reading nook'];
    const clientRows = people.map(([name, phone, credits], index) => { const id = crypto.randomUUID(); clientIds.push(id); return [tenantId, id, phone, name, credits, index % 2, now - (index + 1) * 86400000]; });
    const requestRows = prompts.map((prompt, index) => {
      const owner = clientIds[index % clientIds.length], person = people[index % people.length];
      const request = { id: crypto.randomUUID(), userId: owner, name: person[0], whatsapp: person[1], status: ['pending', 'processing', 'delivered'][index % 3], createdAt: now - (index + 1) * 3600000 * 5, photoUri: '', draft: { ...(tools.length ? { toolId: tools[index % tools.length] } : { toolId: 'sample' }), source: 'text', prompt } };
      requestIds.push(request.id);
      return [tenantId, request.id, owner, request.createdAt, JSON.stringify(request)];
    });
    const values = (rows, width) => rows.map((_, n) => `(${Array.from({ length: width }, (__, k) => `$${n * width + k + 1}`).join(',')})`).join(',');
    // One transaction, three statements (rows are inserted together, not one by one).
    await db.tx(async q => {
      await q(`INSERT INTO clients(tenant_id,id,phone,name,credits,free_used,created_at) VALUES ${values(clientRows, 7)}`, clientRows.flat());
      await q(`INSERT INTO requests(tenant_id,id,user_id,client_request_id,created_at,data) SELECT v.t, v.i, v.u, NULL, v.c, v.d FROM (VALUES ${requestRows.map((_, n) => `($${n * 5 + 1}::text,$${n * 5 + 2}::text,$${n * 5 + 3}::text,$${n * 5 + 4}::bigint,$${n * 5 + 5}::text)`).join(',')}) AS v(t,i,u,c,d)`, requestRows.flat());
      await q('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [`demo_sample:${tenantId}`, JSON.stringify({ clients: clientIds, requests: requestIds })]);
    });
    await bundles.get(tenantId).sync.bump('clients', 'requests');
  }

  async function createDemo(body, actor) {
    const name = clean(body?.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    const theme = body?.themeId ? await getThemeRow(body.themeId) : null; // validated before anything is created
    const base = slugify(body?.slug || `demo-${name}`);
    let slug = base;
    // A demo name is free text, so a taken slug is not an error: add a short suffix until one is available.
    for (let tries = 0; ; tries++) {
      try { slug = await checkSlug(slug); break; } catch (error) { if (tries > 5 || !['SLUG_TAKEN', 'SLUG_RETIRED'].includes(error.message) || body?.slug) throw error; slug = `${base.slice(0, 34)}-${crypto.randomBytes(2).toString('hex')}`; }
    }
    // The credit limit (empty = unlimited) is the store's own allowance: it is what the store's administrator sees in the menu.
    const created = await createTenant({ name, slug, ownerName: `${name} demo admin`, creditLimit: body?.creditLimit }, actor, { kind: 'demo' }); // no e-mail needed: the user name is "admin"
    const id = newId('d'), now = Date.now();
    await db.query('INSERT INTO saas_demos(id,name,description,tenant_id,status,version,created_at,updated_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)', [id, name, clean(body?.description, 500), created.tenant.id, 'draft', now]);
    if (theme) await applyTheme(created.tenant.id, theme);
    await seedSample(created.tenant.id);
    await audit(actor, 'demo.create', created.tenant.id, id, theme ? `${name} (theme ${theme.name})` : name);
    return { demo: await demoView(await getDemoRow(id)), admin: created.admin };
  }
  async function updateDemo(id, body, actor) {
    const row = await getDemoRow(id);
    const next = {};
    if (body.name !== undefined) { next.name = clean(body.name, 80); if (next.name.length < 2) throw fail(400, 'INVALID_NAME'); }
    if (body.description !== undefined) next.description = clean(body.description, 500);
    if (body.status !== undefined) { if (!DEMO_STATUS.includes(body.status)) throw fail(400, 'INVALID_STATUS'); next.status = body.status; }
    const keys = Object.keys(next);
    if (keys.length) {
      await db.query(`UPDATE saas_demos SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), row.id]);
      await audit(actor, 'demo.update', row.tenant_id, row.id, keys.join(','));
    }
    return demoView(await getDemoRow(row.id));
  }
  async function deleteDemo(id, body, actor) {
    const row = await getDemoRow(id);
    if (body?.confirmSlug !== row.slug) throw fail(400, 'CONFIRM_SLUG');
    // Only the template goes. Instances are independent tenants: the assignment rows keep `demo_id` as history.
    const result = await deleteTenantData(await getTenantRow(row.tenant_id));
    await audit(actor, 'demo.delete', row.tenant_id, row.id, row.name);
    return { ok: true, ...result };
  }

  /**
   * Assigns a demo: creates a NEW tenant whose data is a by-value copy of the template, in one transaction. After this the two share
   * nothing (no key, reference or row), so an instance edit can only touch its own tenant_id and the template is never modified.
   * owner: { email, name?, password? } (a new administrator) or { tenantId, adminId } (re-use an existing administrator's profile + password).
   */
  async function assignDemo(demoId, body, actor) {
    const demo = await getDemoRow(demoId);
    const template = await getTenantRow(demo.tenant_id);
    const name = clean(body?.name || demo.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    const slug = await checkSlug(body?.slug);
    // The owner: validated before anything is created.
    let owner;
    if (body?.owner?.tenantId) {
      const source = await getAdminRow((await getTenantRow(body.owner.tenantId)).id, body.owner.adminId);
      owner = { username: source.admin_id.includes('@') ? '' : source.admin_id, email: source.email, name: source.name, phone: source.phone, title: source.title, pwHash: source.pw_hash || undefined };
    } else {
      // User name and e-mail are both optional (no name at all = the user name "admin" with a generated password).
      owner = { username: body?.owner?.username, email: body?.owner?.email, name: body?.owner?.name, password: body?.owner?.password };
      const given = clean(owner.email, 254).toLowerCase();
      if (given && !EMAIL.test(given)) throw fail(400, 'INVALID_EMAIL');
    }
    const policy = platform.policyFields(body, { forCreate: true });
    const tenantId = newId('t'), now = Date.now();
    const version = await contentVersion(template.id);
    // Files: R2 keys carry the tenant id, so each instance gets its own copy of the template's objects (content-addressed, copied once).
    const mediaRows = await db.query("SELECT id,mime,storage FROM media WHERE tenant_id=$1 AND storage IN ('r2','db')", [template.id]);
    if (storage) {
      const from = keyFor(template.id), to = keyFor(tenantId);
      for (const row of mediaRows.filter(row => row.storage === 'r2')) {
        const file = `${row.id}.${EXT[row.mime]}`;
        await storage.put(to(file), await storage.get(from(file)), row.mime);
      }
    }
    const sample = JSON.parse((await db.query('SELECT value FROM saas_kv WHERE key=$1', [`demo_sample:${template.id}`]))[0]?.value || '{"clients":[],"requests":[]}');
    let admin;
    await db.tx(async q => {
      await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // one consistent picture of the template, even while it is being edited
      try {
        await q('INSERT INTO saas_tenants(id,slug,name,kind,status,plan,owner_email,source_demo_id,source_demo_version,notes,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)',
          [tenantId, slug, name, 'instance', 'active', clean(body?.plan, 40), clean(body?.ownerEmail || owner.email, 254).toLowerCase(), demo.id, version, clean(body?.notes, 1000), now]);
      } catch (error) { if (/duplicate key|unique/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
      const ids = mediaRows.map(row => row.id);
      await q("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at) SELECT $2,id,mime,data,body,size,storage,created_at FROM media WHERE tenant_id=$1 AND id=ANY($3) AND storage IN ('r2','db')", [template.id, tenantId, ids]);
      await q("INSERT INTO content_items(tenant_id,coll,id,data,updated_at) SELECT $2,coll,id,data,updated_at FROM content_items WHERE tenant_id=$1 AND coll<>'models'", [template.id, tenantId]);
      // AI model entries hold provider API keys: the copy keeps the entry and drops the key.
      for (const row of await q("SELECT coll,id,data,updated_at FROM content_items WHERE tenant_id=$1 AND coll='models'", [template.id])) {
        const item = JSON.parse(row.data);
        if ('apiKey' in item) item.apiKey = '';
        await q('INSERT INTO content_items(tenant_id,coll,id,data,updated_at) VALUES($1,$2,$3,$4,$5)', [tenantId, row.coll, row.id, JSON.stringify(item), row.updated_at]);
      }
      await q('INSERT INTO content_docs(tenant_id,name,data,updated_at) SELECT $2,name,data,updated_at FROM content_docs WHERE tenant_id=$1', [template.id, tenantId]);
      await q('INSERT INTO settings(tenant_id,key,value) SELECT $2,key,value FROM settings WHERE tenant_id=$1 AND key=ANY($3)', [template.id, tenantId, COPIED_SETTINGS]);
      // Sample clients / requests get NEW ids; requests are re-pointed to the new client ids and lose every device or idempotency link.
      const map = new Map();
      for (const row of await q('SELECT * FROM clients WHERE tenant_id=$1 AND id=ANY($2)', [template.id, sample.clients])) {
        const id = crypto.randomUUID();
        map.set(row.id, id);
        await q('INSERT INTO clients(tenant_id,id,phone,name,free_used,credits,created_at,blocked,prefs) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8)', [tenantId, id, row.phone, row.name, row.free_used, row.credits, row.created_at, '{}']);
      }
      for (const row of await q('SELECT * FROM requests WHERE tenant_id=$1 AND id=ANY($2)', [template.id, sample.requests])) {
        const data = JSON.parse(row.data), id = crypto.randomUUID(), userId = map.get(row.user_id);
        if (!userId) continue;
        delete data.clientHash; delete data.clientRequestId;
        await q('INSERT INTO requests(tenant_id,id,user_id,client_request_id,created_at,data) VALUES($1,$2,$3,NULL,$4,$5)', [tenantId, id, userId, row.created_at, JSON.stringify({ ...data, id, userId })]);
      }
      admin = await addAdmin(q, tenantId, owner);
      await q('INSERT INTO saas_assignments(id,demo_id,tenant_id,owner_email,demo_version,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [newId('as'), demo.id, tenantId, admin.email || admin.id, version, now, actor]);
    });
    if (Object.keys(policy).length) await platform.setPolicy(tenantId, body);
    await bundles.get(tenantId).sync.bump('content', 'clients', 'requests');
    tenants.invalidate();
    await audit(actor, 'demo.assign', tenantId, demo.id, { slug, owner: admin.id, version });
    return { tenant: tenantView(await getTenantRow(tenantId)), admin, demoId: demo.id };
  }
  async function listAssignments(demoId) {
    const demo = await getDemoRow(demoId);
    return (await db.query('SELECT a.id, a.tenant_id, a.owner_email, a.demo_version, a.created_at, a.created_by, t.slug, t.name, t.status FROM saas_assignments a LEFT JOIN saas_tenants t ON t.id=a.tenant_id WHERE a.demo_id=$1 ORDER BY a.created_at DESC', [demo.id]))
      .map(row => ({ id: row.id, tenantId: row.tenant_id, slug: row.slug, name: row.name, status: row.status, ownerEmail: row.owner_email, demoVersion: Number(row.demo_version), createdAt: Number(row.created_at), createdBy: row.created_by, path: `/${row.slug}`, adminPath: `/${row.slug}/admin` }));
  }

  // ---------- Store themes (UI-only snapshots of selected stores) ----------
  const hexMix = (a, b, t) => { const x = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), y = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16)); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase()}`; };
  const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  /** Colours of a store's theme document, for the preview card only (the store itself derives its tokens in the app). */
  function themeColors(doc) {
    const active = doc?.active;
    if (active && active !== 'custom' && PRESET_COLORS[active]) return PRESET_COLORS[active];
    const base = PRESET_COLORS.light || { primary: '#FBDD2D', bg: '#FFFFFF', surface: '#FFFFFF', fg: '#111111', ink: '#111111' };
    const pick = key => (HEX.test(doc?.custom?.[key]) ? doc.custom[key] : base[key]);
    const c = { primary: pick('primary'), bg: pick('bg'), surface: pick('surface'), fg: pick('fg'), ink: pick('ink') };
    const dark = lum(c.bg) < 0.18;
    return { ...c, dark, surface2: hexMix(c.bg, c.fg, dark ? 0.1 : 0.06), muted: hexMix(c.fg, c.bg, 0.4), line: hexMix(c.bg, c.fg, dark ? 0.18 : 0.13), soft: hexMix(c.bg, c.primary, dark ? 0.22 : 0.2),
      onprimary: lum(c.primary) > 0.4 ? '#111111' : '#FFFFFF', onink: lum(c.ink) > 0.4 ? '#111111' : '#FFFFFF' };
  }
  const textOf = value => (value && typeof value === 'object' ? { dar: String(value.dar || ''), ar: String(value.ar || ''), fr: String(value.fr || '') } : { dar: String(value || ''), ar: String(value || ''), fr: String(value || '') });
  const ordered = list => [...list].filter(item => item.visible !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  /** What the console draws for a theme: the colours, the brand, and a few of the home cards. No client data is in here. */
  function previewOf(snap) {
    const branding = snap.docs.branding || {};
    const colors = themeColors(snap.docs.theme);
    return {
      appName: String(branding.appName || ''), logoUri: String(branding.logoUri || ''), logoFont: String(branding.logoFont || ''), themeId: String(snap.docs.theme?.active || 'light'),
      colors, dark: !!colors.dark, fonts: { arabic: snap.settings.arabicFont || '', french: snap.settings.frenchFont || '' },
      tabs: ordered(snap.collections.tabs).slice(0, 4).map(tab => textOf(tab.title)),
      tools: ordered(snap.collections.tools).slice(0, 4).map(tool => ({ title: textOf(tool.title), image: tool.media?.type === 'image' ? String(tool.media.uri || '') : '' })),
    };
  }
  const countsOf = snap => Object.fromEntries(['tabs', 'tools', 'sections', 'inspirations', 'styles', 'plans'].map(name => [name, snap.collections[name].length]));
  const mediaIds = snap => [...new Set([...JSON.stringify(snap).matchAll(MEDIA_REF)].map(hit => hit[1]))];
  const THEME_SQL = 'SELECT h.*, t.name AS source_name, t.slug AS source_slug FROM saas_themes h LEFT JOIN saas_tenants t ON t.id=h.source_tenant_id';
  const themeView = row => {
    const snap = JSON.parse(row.snapshot);
    return { id: row.id, name: row.name, sourceTenantId: row.source_tenant_id, sourceName: row.source_name ?? null, sourceSlug: row.source_slug ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), counts: countsOf(snap), preview: previewOf(snap) };
  };
  const getThemeRow = async id => {
    const row = THEME_ID.test(String(id)) ? (await db.query(`${THEME_SQL} WHERE h.id=$1`, [String(id)]))[0] : null;
    if (!row) throw fail(404, 'NOT_FOUND');
    return row;
  };
  /** The UI of one store and nothing else: look, branding, home / tools / explore content, a few layout switches. Never clients, requests, chats, admins or keys. */
  async function snapshotOf(tenantId) {
    await bundles.get(tenantId).content.ensureSeed();
    const collections = Object.fromEntries(UI_COLLS.map(name => [name, []]));
    for (const row of await db.query('SELECT coll,data FROM content_items WHERE tenant_id=$1 AND coll=ANY($2) ORDER BY coll,id', [tenantId, UI_COLLS])) collections[row.coll].push(JSON.parse(row.data));
    const docs = {};
    let settings = {};
    for (const row of await db.query('SELECT name,data FROM content_docs WHERE tenant_id=$1 AND name=ANY($2)', [tenantId, [...UI_DOCS, 'settings']])) {
      const doc = JSON.parse(row.data);
      if (row.name === 'settings') settings = Object.fromEntries(UI_SETTINGS.filter(key => key in doc).map(key => [key, doc[key]]));
      else docs[row.name] = doc;
    }
    const snap = { collections, docs, settings };
    if (JSON.stringify(snap).length > MAX_SNAPSHOT) throw fail(413, 'THEME_TOO_LARGE');
    return snap;
  }
  /** Files a snapshot points at, copied from one namespace (a store or a theme) to another. Content-addressed, so copying twice is harmless. */
  async function copyMedia(from, to, ids) {
    if (!ids.length) return;
    const rows = await db.query("SELECT id,mime,storage FROM media WHERE tenant_id=$1 AND id=ANY($2) AND storage IN ('r2','db')", [from, ids]);
    if (storage) {
      const source = keyFor(from), target = keyFor(to);
      for (const row of rows.filter(r => r.storage === 'r2')) {
        const file = `${row.id}.${EXT[row.mime]}`;
        try { await storage.put(target(file), await storage.get(source(file)), row.mime); } catch { /* a missing object: the picture simply stays unavailable */ }
      }
    }
    await db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at) SELECT $2,id,mime,data,body,size,storage,created_at FROM media WHERE tenant_id=$1 AND id=ANY($3) AND storage IN ('r2','db') ON CONFLICT DO NOTHING", [from, to, rows.map(r => r.id)]);
  }
  async function createThemes(body, actor) {
    const ids = Array.isArray(body?.tenantIds) ? [...new Set(body.tenantIds.map(String))] : [];
    if (!ids.length) throw fail(400, 'SELECT_TENANTS');
    if (ids.length > 12) throw fail(400, 'TOO_MANY_TENANTS');
    const rows = [];
    for (const id of ids) rows.push(await getTenantRow(id));
    const made = [];
    for (const tenant of rows) {
      const name = clean(ids.length === 1 && body?.name ? body.name : tenant.name, 80) || tenant.name;
      const snap = await snapshotOf(tenant.id);
      const id = newId('th'), now = Date.now();
      await db.query('INSERT INTO saas_themes(id,name,source_tenant_id,snapshot,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id, name, tenant.id, JSON.stringify(snap), now]);
      await copyMedia(tenant.id, id, mediaIds(snap));
      await audit(actor, 'theme.create', tenant.id, id, name);
      made.push(themeView(await getThemeRow(id)));
    }
    return made;
  }
  async function refreshTheme(id, actor) {
    const row = await getThemeRow(id);
    if (!row.source_name) throw fail(409, 'SOURCE_GONE');
    const snap = await snapshotOf(row.source_tenant_id);
    await db.query('UPDATE saas_themes SET snapshot=$1, updated_at=$2 WHERE id=$3', [JSON.stringify(snap), Date.now(), row.id]);
    await copyMedia(row.source_tenant_id, row.id, mediaIds(snap));
    await audit(actor, 'theme.refresh', row.source_tenant_id, row.id, row.name);
    return themeView(await getThemeRow(row.id));
  }
  async function renameTheme(id, body, actor) {
    const row = await getThemeRow(id);
    const name = clean(body?.name, 80);
    if (name.length < 2) throw fail(400, 'INVALID_NAME');
    await db.query('UPDATE saas_themes SET name=$1, updated_at=$2 WHERE id=$3', [name, Date.now(), row.id]);
    await audit(actor, 'theme.rename', row.source_tenant_id, row.id, name);
    return themeView(await getThemeRow(row.id));
  }
  async function deleteTheme(id, actor) {
    const row = await getThemeRow(id);
    if (storage) {
      const key = keyFor(row.id);
      for (const file of await db.query("SELECT id,mime FROM media WHERE tenant_id=$1 AND storage='r2'", [row.id])) { try { await storage.remove(key(`${file.id}.${EXT[file.mime]}`)); } catch { /* best effort */ } }
    }
    await db.tx(async q => { await q('DELETE FROM media WHERE tenant_id=$1', [row.id]); await q('DELETE FROM saas_themes WHERE id=$1', [row.id]); });
    await audit(actor, 'theme.delete', row.source_tenant_id, row.id, row.name);
    return { ok: true };
  }
  /** Replaces the look of a (new) store with a theme: collections, branding, theme and the layout switches. Its clients, admins, keys and counters stay its own. */
  async function applyTheme(tenantId, row) {
    const snap = JSON.parse(row.snapshot);
    await copyMedia(row.id, tenantId, mediaIds(snap));
    const now = Date.now();
    await db.tx(async q => {
      await q('DELETE FROM content_items WHERE tenant_id=$1 AND coll=ANY($2)', [tenantId, UI_COLLS]);
      const items = UI_COLLS.flatMap(coll => snap.collections[coll].map(item => [tenantId, coll, String(item.id), JSON.stringify(item), now]));
      for (let i = 0; i < items.length; i += 200) { const part = items.slice(i, i + 200); await q(`INSERT INTO content_items(tenant_id,coll,id,data,updated_at) VALUES ${placeholders(part, 5)}`, part.flat()); }
      const upsert = 'INSERT INTO content_docs(tenant_id,name,data,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (tenant_id,name) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at';
      for (const [name, doc] of Object.entries(snap.docs)) await q(upsert, [tenantId, name, JSON.stringify(doc), now]);
      const current = (await q("SELECT data FROM content_docs WHERE tenant_id=$1 AND name='settings'", [tenantId]))[0];
      await q(upsert, [tenantId, 'settings', JSON.stringify({ ...(current ? JSON.parse(current.data) : {}), ...snap.settings }), now]);
    });
    await bundles.get(tenantId).sync.bump('content');
  }

  // ---------- Hand-off: open a store's admin dashboard from the console, without a second login ----------
  /**
   * A one-time code (256 bits, 60 s) bound to ONE tenant and ONE of its administrators. The console opens `<store>/admin/login?handoff=<code>`;
   * the store redeems it on its own API (redeemHandoff) and receives a normal admin session. Only a hash of the code is stored.
   */
  async function createHandoff(tenantId, body, actor) {
    const tenant = await getTenantRow(tenantId);
    if (tenant.status === 'suspended') throw fail(409, 'TENANT_SUSPENDED');
    const wanted = body?.adminId ? String(body.adminId).toLowerCase() : '';
    const admin = wanted
      ? (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=$1 AND admin_id=$2', [tenant.id, wanted]))[0]
      : (await db.query('SELECT * FROM admin_accounts WHERE tenant_id=$1 AND disabled=0 ORDER BY created_at, admin_id LIMIT 1', [tenant.id]))[0];
    if (!admin || admin.disabled) throw fail(409, 'NO_ADMIN');
    const next = typeof body?.next === 'string' && /^\/admin(\/[A-Za-z0-9_-]{1,40}){0,3}$/.test(body.next) ? body.next : '/admin';
    const now = Date.now(), code = crypto.randomBytes(32).toString('hex');
    for (const stale of await db.query("SELECT key,value FROM saas_kv WHERE key LIKE 'handoff:%'")) if (Number(String(stale.value).split('|')[0]) < now) await db.query('DELETE FROM saas_kv WHERE key=$1', [stale.key]);
    await db.query('INSERT INTO saas_kv(key,value) VALUES($1,$2)', [`handoff:${sha(code)}`, `${now + HANDOFF_MS}|${tenant.id}|${admin.admin_id}`]);
    await audit(actor, 'tenant.handoff', tenant.id, admin.admin_id, next);
    const base = urls(tenant).adminPath;
    return { code, expiresAt: now + HANDOFF_MS, admin: admin.admin_id, url: `${base}/login?handoff=${code}${next === '/admin' ? '' : `&next=${encodeURIComponent(next)}`}` };
  }
  /** Called by a store's own API with ITS tenant id: the administrator id when the code is valid for that tenant (consumed either way), else null. */
  async function redeemHandoff(tenantId, code) {
    if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) return null;
    const row = (await db.query('DELETE FROM saas_kv WHERE key=$1 RETURNING value', [`handoff:${sha(code)}`]))[0];
    if (!row) return null;
    const [expires, owner, ...rest] = String(row.value).split('|');
    const adminId = rest.join('|');
    if (Number(expires) < Date.now() || owner !== tenantId) return null;
    const found = (await db.query('SELECT admin_id FROM admin_accounts WHERE tenant_id=$1 AND admin_id=$2 AND disabled=0', [tenantId, adminId]))[0];
    if (!found) return null;
    await audit('super-admin', 'tenant.handoff.open', tenantId, found.admin_id, '');
    return found.admin_id;
  }

  // ---------- Reports ----------
  async function stats() {
    const count = async (sql, params) => Number((await db.query(sql, params))[0].n);
    return {
      tenants: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE kind IN ('default','instance')"),
      active: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE kind IN ('default','instance') AND status<>'suspended'"),
      suspended: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE status='suspended'"),
      demos: await count('SELECT COUNT(*) AS n FROM saas_demos'),
      assignments: await count('SELECT COUNT(*) AS n FROM saas_assignments'),
      themes: await count('SELECT COUNT(*) AS n FROM saas_themes'),
      clients: await count('SELECT COUNT(*) AS n FROM clients'),
      apis: await count('SELECT COUNT(*) AS n FROM saas_apis'),
      creditsUsed: await count("SELECT COALESCE(SUM(credits_used),0) AS n FROM saas_tenants WHERE kind IN ('default','instance')"),
      platformManaged: await count("SELECT COUNT(*) AS n FROM saas_tenants WHERE kind IN ('default','instance') AND api_mode='platform'"),
    };
  }
  async function auditLog({ tenantId, limit }) {
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = tenantId ? await db.query('SELECT * FROM saas_audit WHERE tenant_id=$1 ORDER BY at DESC LIMIT $2', [tenantId, n]) : await db.query('SELECT * FROM saas_audit ORDER BY at DESC LIMIT $1', [n]);
    return rows.map(row => ({ id: row.id, at: Number(row.at), actor: row.actor, action: row.action, tenantId: row.tenant_id, target: row.target, detail: row.detail }));
  }

  // ---------- HTTP ----------
  /**
   * `{ status, data, headers? }` for a request under /api/super-admin. Every route except login needs a super admin session; a tenant
   * admin or client token never matches (different table, cookie and header).
   */
  async function handle({ req, url, readBody, ip }) {
    const method = req.method, path = url.pathname.slice('/api/super-admin'.length) || '/';
    const ok = (data, status = 200, headers) => ({ status, data, headers });
    if (path === '/login' && method === 'POST') {
      const result = await login(ip, req.headers['user-agent'], await readBody(req));
      return ok({ ok: true, email: result.email, isDefault: result.isDefault, ...(req.headers['x-dwira-native'] === '1' ? { token: result.token } : {}) }, 200, { 'Set-Cookie': result.cookie });
    }
    const me = await authenticate(req);
    if (!me) throw fail(401, 'Super admin login required');
    const actor = me.email;
    if (path === '/logout' && method === 'POST') { await db.query('DELETE FROM saas_super_sessions WHERE token_hash=$1', [sha(me.token)]); return ok({ ok: true }, 200, { 'Set-Cookie': clearCookie() }); }
    if (path === '/session' && method === 'GET') return ok({ ok: true, email: me.email, isDefault: me.isDefault });
    if (path === '/account' && method === 'GET') return ok(accountView(await account()));
    if (path === '/account' && method === 'PATCH') return ok(await updateAccount(me, await readBody(req)));
    if (path === '/stats' && method === 'GET') return ok(await stats());
    if (path === '/audit' && method === 'GET') return ok(await auditLog({ tenantId: url.searchParams.get('tenant') || undefined, limit: url.searchParams.get('limit') }));

    let m;
    if (path === '/tenants') {
      if (method === 'GET') {
        const kinds = (url.searchParams.get('kind') || 'default,instance').split(',').filter(k => ['default', 'instance', 'demo'].includes(k));
        return ok(await listTenants(kinds.length ? kinds : ['default', 'instance']));
      }
      if (method === 'POST') return ok(await createTenant(await readBody(req), actor), 201);
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)$/.exec(path))) {
      if (method === 'GET') return ok(tenantView(await getTenantRow(m[1])));
      if (method === 'PATCH') return ok(await updateTenant(m[1], await readBody(req), actor));
      if (method === 'DELETE') return ok(await deleteTenant(m[1], await readBody(req), actor));
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/(suspend|unsuspend)$/.exec(path)) && method === 'POST') return ok(await setSuspended(m[1], m[2] === 'suspend', actor));
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/admins$/.exec(path))) {
      if (method === 'GET') return ok(await adminOps.list(m[1]));
      if (method === 'POST') return ok(await adminOps.create(m[1], await readBody(req), actor), 201);
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/admins\/([^/]{3,254})$/.exec(path))) {
      const adminId = decodeURIComponent(m[2]);
      if (method === 'PATCH') return ok(await adminOps.update(m[1], adminId, await readBody(req), actor));
      if (method === 'DELETE') return ok(await adminOps.remove(m[1], adminId, actor));
    }
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/admins\/([^/]{3,254})\/password$/.exec(path)) && method === 'POST') return ok(await adminOps.resetPassword(m[1], decodeURIComponent(m[2]), await readBody(req), actor));
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/domains(?:\/(verify|remove))?$/.exec(path))) {
      const row = await getTenantRow(m[1]);
      if (!m[2] && method === 'GET') return ok(await tenants.domains.list(row.id));
      if (!m[2] && method === 'POST') { const view = await tenants.domains.add(row.id, (await readBody(req)).domain); await audit(actor, 'domain.add', row.id, view.domain, ''); return ok(view, 201); }
      if (m[2] === 'verify' && method === 'POST') { const body = await readBody(req); const view = await tenants.domains.verify(row.id, body.domain, { force: body.force === true }); await audit(actor, 'domain.verify', row.id, view.domain, body.force === true ? 'forced' : 'dns'); return ok(view); }
      if (m[2] === 'remove' && method === 'POST') { const body = await readBody(req); await tenants.domains.remove(row.id, body.domain); await audit(actor, 'domain.remove', row.id, String(body.domain), ''); return ok({ ok: true }); }
    }
    if (path === '/demos') {
      if (method === 'GET') return ok(await Promise.all((await db.query(`${DEMO_SQL} ORDER BY d.created_at DESC`)).map(demoView)));
      if (method === 'POST') return ok(await createDemo(await readBody(req), actor), 201);
    }
    if ((m = /^\/demos\/([a-z0-9_-]+)$/.exec(path))) {
      if (method === 'GET') return ok(await demoView(await getDemoRow(m[1])));
      if (method === 'PATCH') return ok(await updateDemo(m[1], await readBody(req), actor));
      if (method === 'DELETE') return ok(await deleteDemo(m[1], await readBody(req), actor));
    }
    if ((m = /^\/demos\/([a-z0-9_-]+)\/assign$/.exec(path)) && method === 'POST') return ok(await assignDemo(m[1], await readBody(req), actor), 201);
    if ((m = /^\/demos\/([a-z0-9_-]+)\/assignments$/.exec(path)) && method === 'GET') return ok(await listAssignments(m[1]));
    // API manager: provider connections shared by (or linked to) platform-managed stores. Keys are write-only: no route returns one.
    if (path === '/apis') {
      if (method === 'GET') return ok({ apis: await platform.list(), catalog: platform.CATALOG });
      if (method === 'POST') { const view = await platform.create(await readBody(req)); await audit(actor, 'api.create', null, view.id, `${view.kind}/${view.provider}`); return ok(view, 201); }
    }
    if ((m = /^\/apis\/(api_[a-f0-9]{10})$/.exec(path))) {
      if (method === 'PATCH') { const body = await readBody(req); const view = await platform.update(m[1], body); await audit(actor, 'api.update', null, m[1], Object.keys(body || {}).map(k => (k === 'apiKey' ? 'key' : k)).join(',')); return ok(view); }
      if (method === 'DELETE') { const row = await platform.remove(m[1]); await audit(actor, 'api.delete', null, m[1], `${row.kind}/${row.provider}`); return ok({ ok: true }); }
    }
    if (path === '/themes') {
      if (method === 'GET') return ok((await db.query(`${THEME_SQL} ORDER BY h.created_at DESC`)).map(themeView));
      if (method === 'POST') return ok(await createThemes(await readBody(req), actor), 201);
    }
    if ((m = /^\/themes\/(th_[a-f0-9]{12})$/.exec(path))) {
      if (method === 'GET') return ok(themeView(await getThemeRow(m[1])));
      if (method === 'PATCH') return ok(await renameTheme(m[1], await readBody(req), actor));
      if (method === 'DELETE') return ok(await deleteTheme(m[1], actor));
    }
    if ((m = /^\/themes\/(th_[a-f0-9]{12})\/refresh$/.exec(path)) && method === 'POST') return ok(await refreshTheme(m[1], actor));
    if ((m = /^\/tenants\/([a-z0-9_-]+)\/handoff$/.exec(path)) && method === 'POST') return ok(await createHandoff(m[1], await readBody(req), actor));
    throw fail(404, 'API route not found');
  }

  return { handle, authenticate, configured, account, resetToDefault, redeemHandoff, createTenant, assignDemo, createDemo, deleteTenant, setSuspended, listTenants, stats, audit, platformInfo: tenantId => platform.infoOf(tenantId) };
}

module.exports = { createSuperAdmin, COPIED_SETTINGS };
