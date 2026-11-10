/**
 * Platform service (Super Admin): tenants, plans, roles, admin accounts, platform settings, audit log and analytics.
 * Pure data layer on top of `db` (no HTTP): routes live in server/super.js, enforcement in server/index.js.
 *
 * Tenant 'default' is the original workspace: the legacy `admin` login and every client created before the platform layer existed.
 */
const crypto = require('node:crypto');
const access = require('./access');

const DAY = 86400000;
const fail = (status, message) => Object.assign(new Error(message), { status });
const num = value => Number(value) || 0;
const text = (value, max, { required = false, code = 'INVALID_INPUT' } = {}) => {
  if (value == null) { if (required) throw fail(400, code); return ''; }
  if (typeof value !== 'string') throw fail(400, code);
  const out = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (out.length > max || (required && !out)) throw fail(400, code);
  return out;
};
const parse = (value, fallback = {}) => { try { return JSON.parse(value || ''); } catch { return fallback; } };

/** Salted scrypt, the same `salt:hex` format as server/password.js (ADMIN_PASSWORD_HASH). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(String(password), salt, 64).toString('hex')}`;
}
function verifyPassword(password, encoded) {
  const [salt, digest] = String(encoded || '').split(':');
  if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(password), salt, 64), Buffer.from(digest, 'hex'));
}
const DUMMY_HASH = hashPassword('not-a-real-password'); // equalises the timing of "unknown user" and "wrong password"

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(['api', 'admin', 'super', 'static', 'assets', 'lead']);
const USERNAME = /^[a-z0-9][a-z0-9._@+-]{2,63}$/;
const LIMIT_KEYS = ['maxClients', 'maxAdmins', 'monthlyDesigns', 'startCredits'];
const CONFIG_DEFAULTS = {
  maintenance: { enabled: false, message: '' },
  announcement: { enabled: false, text: '', level: 'info' },
  signupOpen: true,
  defaultPlan: 'starter',
  supportEmail: '',
};

function createPlatform(db, { sync, env = process.env } = {}) {
  let ready = null;
  const cache = new Map();
  const invalidate = () => cache.clear();
  const changed = async (...keys) => { invalidate(); if (sync) await sync.bump('platform', ...keys); };

  /* ---------------- settings: platform config and plans ---------------- */
  const readSetting = async key => parse((await db.query('SELECT value FROM settings WHERE key=$1', [key]))[0]?.value, null);
  const writeSetting = (key, value, q = db.query) => q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, JSON.stringify(value)]);

  async function getPlans() {
    const stored = await readSetting('platform_plans');
    return Array.isArray(stored) && stored.length ? stored : access.DEFAULT_PLANS;
  }
  const cleanLimit = value => {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 1e9) throw fail(400, 'INVALID_LIMITS');
    return value;
  };
  const cleanLimits = (input, { partial = false } = {}) => {
    if (input == null) return partial ? {} : { maxClients: null, maxAdmins: null, monthlyDesigns: null };
    if (typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'INVALID_LIMITS');
    const out = {};
    for (const key of LIMIT_KEYS) if (Object.hasOwn(input, key)) out[key] = cleanLimit(input[key]);
    return out;
  };
  async function setPlans(input) {
    if (!Array.isArray(input) || !input.length || input.length > 12) throw fail(400, 'INVALID_PLANS');
    const seen = new Set();
    const plans = input.map(plan => {
      const id = text(plan?.id, 30, { required: true, code: 'INVALID_PLANS' });
      if (!/^[a-z0-9_-]{2,30}$/.test(id) || seen.has(id)) throw fail(400, 'INVALID_PLANS');
      seen.add(id);
      const price = plan.price == null ? 0 : plan.price;
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1e6) throw fail(400, 'INVALID_PLANS');
      return {
        id, name: text(plan.name, 60, { required: true, code: 'INVALID_PLANS' }), price,
        limits: cleanLimits(plan.limits), features: { ...access.allLevels('none'), ...access.cleanLevels(plan.features, { strict: true, fail: m => fail(400, m) }) },
      };
    });
    const used = await db.query('SELECT DISTINCT plan_id FROM tenants');
    for (const row of used) if (!seen.has(row.plan_id)) throw fail(409, 'PLAN_IN_USE');
    await writeSetting('platform_plans', plans);
    await changed();
    return plans;
  }

  async function getConfig() {
    const stored = (await readSetting('platform_config')) || {};
    return {
      ...CONFIG_DEFAULTS, ...stored,
      maintenance: { ...CONFIG_DEFAULTS.maintenance, ...(stored.maintenance || {}) },
      announcement: { ...CONFIG_DEFAULTS.announcement, ...(stored.announcement || {}) },
    };
  }
  async function setConfig(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, 'INVALID_CONFIG');
    const current = await getConfig(), next = { ...current };
    if (patch.maintenance !== undefined) {
      if (typeof patch.maintenance !== 'object' || patch.maintenance === null) throw fail(400, 'INVALID_CONFIG');
      next.maintenance = { enabled: patch.maintenance.enabled === undefined ? current.maintenance.enabled : patch.maintenance.enabled === true, message: patch.maintenance.message === undefined ? current.maintenance.message : text(patch.maintenance.message, 300) };
    }
    if (patch.announcement !== undefined) {
      const a = patch.announcement;
      if (typeof a !== 'object' || a === null) throw fail(400, 'INVALID_CONFIG');
      const level = a.level === undefined ? current.announcement.level : a.level;
      if (!['info', 'warning', 'success'].includes(level)) throw fail(400, 'INVALID_CONFIG');
      next.announcement = { enabled: a.enabled === undefined ? current.announcement.enabled : a.enabled === true, text: a.text === undefined ? current.announcement.text : text(a.text, 400), level };
    }
    if (patch.signupOpen !== undefined) { if (typeof patch.signupOpen !== 'boolean') throw fail(400, 'INVALID_CONFIG'); next.signupOpen = patch.signupOpen; }
    if (patch.supportEmail !== undefined) next.supportEmail = text(patch.supportEmail, 200);
    if (patch.defaultPlan !== undefined) {
      if (!(await getPlans()).some(plan => plan.id === patch.defaultPlan)) throw fail(400, 'INVALID_PLAN');
      next.defaultPlan = patch.defaultPlan;
    }
    await writeSetting('platform_config', next);
    await changed();
    return next;
  }
  /** Config / tenant info are read on hot paths (every client login, every request): kept for a few seconds, dropped by every write here. */
  const cached = async (key, load) => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 3000) return hit.value;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  };
  const configCached = () => cached('config', getConfig);
  /** { status, planId, limits } of a tenant, or null when it does not exist. Never throws for an unknown id. */
  const tenantInfo = id => cached('tenant:' + id, async () => {
    const row = await tenantRow(id);
    if (!row) return null;
    const tenant = tenantOut(row), plan = await planOf(tenant.planId);
    return { id: tenant.id, slug: tenant.slug, name: tenant.name, status: tenant.status, planId: tenant.planId, limits: access.effectiveLimits(plan, tenant.limits) };
  });
  async function designsThisMonth(tenantId) {
    return num((await db.query("SELECT COUNT(*) AS n FROM requests r LEFT JOIN clients c ON c.id=r.user_id WHERE COALESCE(c.tenant_id,'default')=$1 AND r.created_at>=$2", [tenantId, monthStart()]))[0].n);
  }
  /** The part of the config every signed-in tenant admin (and the apps) may read. */
  const publicConfig = config => ({ maintenance: config.maintenance.enabled ? { enabled: true, message: config.maintenance.message } : { enabled: false, message: '' }, announcement: config.announcement.enabled && config.announcement.text ? config.announcement : { enabled: false, text: '', level: 'info' }, signupOpen: config.signupOpen, supportEmail: config.supportEmail });

  /* ---------------- audit ---------------- */
  async function log(actor, action, target = {}, detail = {}) {
    try {
      await db.query('INSERT INTO audit_log(id,at,actor,action,target_type,target_id,tenant_id,detail) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [crypto.randomUUID(), Date.now(), String(actor).slice(0, 80), action, target.type || '', String(target.id || '').slice(0, 80), target.tenantId || null, JSON.stringify(detail || {}).slice(0, 4000)]);
    } catch { console.warn('Audit log unavailable'); }
  }
  async function auditList({ tenantId, action, q, before, limit = 100 } = {}) {
    const where = [], params = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace('?', '$' + params.length)); };
    const like = value => '%' + String(value).replace(/[%_\\]/g, '\\$&') + '%';
    if (tenantId) add('tenant_id=?', String(tenantId));
    if (action) add('action LIKE ?', String(action).replace(/[%_\\]/g, '\\$&') + '%');
    if (q) { params.push(like(String(q).slice(0, 100))); const n = '$' + params.length; where.push(`(actor ILIKE ${n} OR target_id ILIKE ${n} OR action ILIKE ${n} OR detail ILIKE ${n})`); }
    if (before) add('at<?', Number(before) || Date.now());
    params.push(Math.max(1, Math.min(500, Number(limit) || 100)));
    const rows = await db.query(`SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC LIMIT $${params.length}`, params);
    return rows.map(row => ({ id: row.id, at: num(row.at), actor: row.actor, action: row.action, targetType: row.target_type, targetId: row.target_id, tenantId: row.tenant_id, detail: parse(row.detail) }));
  }

  /* ---------------- tenants ---------------- */
  const tenantOut = row => row && ({ id: row.id, slug: row.slug, name: row.name, planId: row.plan_id, status: row.status, createdAt: num(row.created_at), updatedAt: num(row.updated_at), ...normaliseData(parse(row.data)) });
  const normaliseData = data => ({ contact: { name: data.contact?.name || '', email: data.contact?.email || '', phone: data.contact?.phone || '' }, notes: data.notes || '', overrides: access.cleanLevels(data.overrides), limits: data.limits && typeof data.limits === 'object' ? data.limits : {} });

  async function ensureReady() {
    ready ||= (async () => {
      const now = Date.now();
      await db.query("INSERT INTO tenants(id,slug,name,plan_id,status,data,created_at,updated_at) VALUES('default','default','Default workspace','enterprise','active','{}',$1,$1) ON CONFLICT (id) DO NOTHING", [now]);
      // The default workspace keeps the original behaviour: every feature, no limits. The plan must exist for it to be resolvable.
      const stored = await readSetting('platform_plans');
      if (!Array.isArray(stored) || !stored.length) await writeSetting('platform_plans', access.DEFAULT_PLANS);
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  const planOf = async id => (await getPlans()).find(plan => plan.id === id) || null;

  async function tenantRow(id) {
    await ensureReady();
    return (await db.query('SELECT * FROM tenants WHERE id=$1', [id]))[0] || null;
  }
  async function tenantBySlug(slug) {
    await ensureReady();
    if (typeof slug !== 'string' || !SLUG.test(slug)) return null;
    return tenantOut((await db.query('SELECT * FROM tenants WHERE slug=$1', [slug]))[0]);
  }
  const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

  /** Counters per tenant in four grouped queries (never one query per tenant). */
  async function counters() {
    const [clients, accounts, requests, month, lastSeen] = await Promise.all([
      db.query('SELECT tenant_id, COUNT(*) AS n FROM clients GROUP BY tenant_id'),
      db.query("SELECT tenant_id, COUNT(*) AS n, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM tenant_accounts GROUP BY tenant_id"),
      db.query("SELECT COALESCE(c.tenant_id,'default') AS tenant_id, COUNT(*) AS n FROM requests r LEFT JOIN clients c ON c.id=r.user_id GROUP BY 1"),
      db.query("SELECT COALESCE(c.tenant_id,'default') AS tenant_id, COUNT(*) AS n FROM requests r LEFT JOIN clients c ON c.id=r.user_id WHERE r.created_at>=$1 GROUP BY 1", [monthStart()]),
      db.query("SELECT COALESCE(c.tenant_id,'default') AS tenant_id, MAX(r.created_at) AS at FROM requests r LEFT JOIN clients c ON c.id=r.user_id GROUP BY 1"),
    ]);
    const by = (rows, field = 'n') => Object.fromEntries(rows.map(row => [row.tenant_id, num(row[field])]));
    return { clients: by(clients), accounts: by(accounts), activeAccounts: by(accounts, 'active'), requests: by(requests), month: by(month), lastRequest: by(lastSeen, 'at') };
  }

  async function listTenants() {
    await ensureReady();
    const [rows, plans, c] = await Promise.all([db.query('SELECT * FROM tenants ORDER BY (id=\'default\') DESC, created_at ASC'), getPlans(), counters()]);
    return rows.map(row => {
      const tenant = tenantOut(row), plan = plans.find(p => p.id === tenant.planId);
      return { ...tenant, planName: plan?.name || tenant.planId, ownLimits: tenant.limits, limits: access.effectiveLimits(plan, tenant.limits), usage: { clients: c.clients[tenant.id] || 0, accounts: c.accounts[tenant.id] || 0, activeAccounts: c.activeAccounts[tenant.id] || 0, requests: c.requests[tenant.id] || 0, designsThisMonth: c.month[tenant.id] || 0, lastRequestAt: c.lastRequest[tenant.id] || null } };
    });
  }
  async function getTenant(id) {
    const tenant = (await listTenants()).find(item => item.id === id);
    if (!tenant) throw fail(404, 'NOT_FOUND');
    const plan = await planOf(tenant.planId);
    return { ...tenant, levels: access.tenantLevels(plan, tenant.overrides) };
  }
  function cleanContact(contact) {
    if (contact == null) return undefined;
    if (typeof contact !== 'object' || Array.isArray(contact)) throw fail(400, 'INVALID_TENANT');
    const email = text(contact.email, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'INVALID_EMAIL');
    return { name: text(contact.name, 120), email, phone: text(contact.phone, 40) };
  }
  async function createTenant(input) {
    await ensureReady();
    const name = text(input?.name, 100, { required: true, code: 'INVALID_TENANT' });
    const slug = text(input?.slug || name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), 40);
    if (!SLUG.test(slug) || RESERVED_SLUGS.has(slug) || slug === 'default') throw fail(400, 'INVALID_SLUG');
    const planId = input.planId || (await getConfig()).defaultPlan;
    if (!(await planOf(planId))) throw fail(400, 'INVALID_PLAN');
    const data = { contact: cleanContact(input.contact) || { name: '', email: '', phone: '' }, notes: text(input.notes, 2000), overrides: access.cleanLevels(input.overrides, { strict: true, fail: m => fail(400, m) }), limits: cleanLimits(input.limits, { partial: true }) };
    const id = 't_' + crypto.randomBytes(6).toString('hex'), now = Date.now();
    try { await db.query('INSERT INTO tenants(id,slug,name,plan_id,status,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)', [id, slug, name, planId, 'active', JSON.stringify(data), now]); }
    catch (error) { if (/unique|duplicate/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
    await changed();
    return id;
  }
  async function updateTenant(id, patch) {
    const row = await tenantRow(id);
    if (!row) throw fail(404, 'NOT_FOUND');
    if (!patch || typeof patch !== 'object') throw fail(400, 'INVALID_TENANT');
    const data = normaliseData(parse(row.data)), next = { name: row.name, slug: row.slug, plan_id: row.plan_id, status: row.status };
    if (patch.name !== undefined) next.name = text(patch.name, 100, { required: true, code: 'INVALID_TENANT' });
    if (patch.slug !== undefined && patch.slug !== row.slug) {
      if (id === 'default') throw fail(400, 'INVALID_SLUG');
      if (typeof patch.slug !== 'string' || !SLUG.test(patch.slug) || RESERVED_SLUGS.has(patch.slug) || patch.slug === 'default') throw fail(400, 'INVALID_SLUG');
      next.slug = patch.slug;
    }
    if (patch.planId !== undefined) { if (!(await planOf(patch.planId))) throw fail(400, 'INVALID_PLAN'); next.plan_id = patch.planId; }
    if (patch.status !== undefined) {
      if (!['active', 'suspended'].includes(patch.status)) throw fail(400, 'INVALID_STATUS');
      if (id === 'default' && patch.status !== 'active') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
      next.status = patch.status;
    }
    if (patch.contact !== undefined) data.contact = cleanContact(patch.contact);
    if (patch.notes !== undefined) data.notes = text(patch.notes, 2000);
    if (patch.overrides !== undefined) data.overrides = access.cleanLevels(patch.overrides, { strict: true, fail: m => fail(400, m) });
    if (patch.limits !== undefined) data.limits = cleanLimits(patch.limits, { partial: true });
    try { await db.query('UPDATE tenants SET name=$1, slug=$2, plan_id=$3, status=$4, data=$5, updated_at=$6 WHERE id=$7', [next.name, next.slug, next.plan_id, next.status, JSON.stringify(data), Date.now(), id]); }
    catch (error) { if (/unique|duplicate/i.test(String(error.message))) throw fail(409, 'SLUG_TAKEN'); throw error; }
    await changed();
    return { before: { status: row.status, planId: row.plan_id, name: row.name }, after: { status: next.status, planId: next.plan_id, name: next.name } };
  }
  /** Deletes the tenant and everything it owns. Returns the ids of the removed accounts and clients (push devices, sessions follow). */
  async function removeTenant(id) {
    if (id === 'default') throw fail(400, 'DEFAULT_TENANT_PROTECTED');
    const row = await tenantRow(id);
    if (!row) throw fail(404, 'NOT_FOUND');
    const removed = await db.tx(async q => {
      const accounts = (await q('SELECT id FROM tenant_accounts WHERE tenant_id=$1', [id])).map(r => r.id);
      const clientIds = (await q('SELECT id FROM clients WHERE tenant_id=$1', [id])).map(r => r.id);
      if (clientIds.length) {
        await q('DELETE FROM requests WHERE user_id = ANY($1)', [clientIds]);
        await q("DELETE FROM subscriptions WHERE owner_type='client' AND owner_id = ANY($1)", [clientIds]);
      }
      if (accounts.length) await q("DELETE FROM subscriptions WHERE owner_type='admin' AND owner_id = ANY($1)", [accounts]);
      await q('DELETE FROM admin_sessions WHERE tenant_id=$1', [id]);
      await q('DELETE FROM clients WHERE tenant_id=$1', [id]);
      await q('DELETE FROM campaigns WHERE tenant_id=$1', [id]);
      await q('DELETE FROM roles WHERE tenant_id=$1', [id]);
      await q('DELETE FROM tenants WHERE id=$1', [id]);
      return { accounts: accounts.length, clients: clientIds.length };
    });
    await changed('clients', 'requests');
    return { name: row.name, slug: row.slug, ...removed };
  }

  /* ---------------- roles ---------------- */
  const roleOut = (row, tenantsUsing = 0) => ({ id: row.id, name: row.name, system: false, tenantId: row.tenant_id, description: parse(row.data).description || '', permissions: { ...access.allLevels('none'), ...access.cleanLevels(parse(row.data).permissions) }, createdAt: num(row.created_at), updatedAt: num(row.updated_at), accounts: tenantsUsing });
  const systemRole = role => ({ id: role.id, name: role.name, system: true, tenantId: null, description: role.description, permissions: { ...access.allLevels('none'), ...role.permissions }, createdAt: 0, updatedAt: 0 });

  async function listRoles({ tenantId } = {}) {
    const rows = await db.query(tenantId ? 'SELECT * FROM roles WHERE tenant_id IS NULL OR tenant_id=$1 ORDER BY created_at' : 'SELECT * FROM roles ORDER BY created_at', tenantId ? [tenantId] : []);
    const usage = Object.fromEntries((await db.query('SELECT role_id, COUNT(*) AS n FROM tenant_accounts GROUP BY role_id')).map(r => [r.role_id, num(r.n)]));
    return [...access.SYSTEM_ROLES.map(role => ({ ...systemRole(role), accounts: usage[role.id] || 0 })), ...rows.map(row => roleOut(row, usage[row.id] || 0))];
  }
  async function resolveRole(roleId, tenantId) {
    const builtin = access.SYSTEM_ROLES.find(role => role.id === roleId);
    if (builtin) return systemRole(builtin);
    const row = (await db.query('SELECT * FROM roles WHERE id=$1 AND (tenant_id IS NULL OR tenant_id=$2)', [roleId, tenantId]))[0];
    return row ? roleOut(row) : null;
  }
  async function saveRole(id, input, { tenantId = null } = {}) {
    const name = text(input?.name, 60, { required: true, code: 'INVALID_ROLE' });
    const data = { description: text(input.description, 240), permissions: access.cleanLevels(input.permissions, { strict: true, fail: m => fail(400, m) }) };
    if (tenantId) { if (!(await tenantRow(tenantId))) throw fail(400, 'INVALID_TENANT'); }
    const now = Date.now();
    if (!id) {
      id = 'role_' + crypto.randomBytes(6).toString('hex');
      await db.query('INSERT INTO roles(id,tenant_id,name,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)', [id, tenantId, name, JSON.stringify(data), now]);
    } else {
      if (access.SYSTEM_ROLES.some(role => role.id === id)) throw fail(400, 'SYSTEM_ROLE_READONLY');
      const rows = await db.query('UPDATE roles SET name=$1, data=$2, updated_at=$3 WHERE id=$4 RETURNING id', [name, JSON.stringify(data), now, id]);
      if (!rows.length) throw fail(404, 'NOT_FOUND');
    }
    await changed();
    return id;
  }
  async function removeRole(id) {
    if (access.SYSTEM_ROLES.some(role => role.id === id)) throw fail(400, 'SYSTEM_ROLE_READONLY');
    if (num((await db.query('SELECT COUNT(*) AS n FROM tenant_accounts WHERE role_id=$1', [id]))[0].n)) throw fail(409, 'ROLE_IN_USE');
    const rows = await db.query('DELETE FROM roles WHERE id=$1 RETURNING id', [id]);
    if (!rows.length) throw fail(404, 'NOT_FOUND');
    await changed();
  }

  /* ---------------- admin accounts ---------------- */
  const accountOut = (row, roles = [], tenants = []) => {
    const data = parse(row.data), role = roles.find(r => r.id === row.role_id), tenant = tenants.find(t => t.id === row.tenant_id);
    return { id: row.id, tenantId: row.tenant_id, tenantName: tenant?.name || '', username: row.username, name: row.name, email: row.email, roleId: row.role_id, roleName: role?.name || row.role_id, status: row.status, overrides: access.cleanLevels(data.overrides), lastLogin: row.last_login == null ? null : num(row.last_login), createdAt: num(row.created_at) };
  };
  async function listAccounts({ tenantId } = {}) {
    await ensureReady();
    const [rows, roles, tenants] = await Promise.all([db.query(tenantId ? 'SELECT * FROM tenant_accounts WHERE tenant_id=$1 ORDER BY created_at' : 'SELECT * FROM tenant_accounts ORDER BY created_at', tenantId ? [tenantId] : []), listRoles(), db.query('SELECT id,name FROM tenants')]);
    return rows.map(row => accountOut(row, roles, tenants));
  }
  const reservedUsernames = () => new Set(['admin', 'administrator', 'root', 'superadmin', String(env.ADMIN_EMAIL || '').toLowerCase(), String(env.SUPER_ADMIN_USER || '').toLowerCase()].filter(Boolean));
  const checkPassword = password => { if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw fail(400, 'WEAK_PASSWORD'); };

  async function createAccount(input) {
    await ensureReady();
    const tenant = await tenantRow(input?.tenantId);
    if (!tenant) throw fail(400, 'INVALID_TENANT');
    const username = text(input.username, 64, { required: true, code: 'INVALID_USERNAME' }).toLowerCase();
    if (!USERNAME.test(username) || reservedUsernames().has(username)) throw fail(400, 'INVALID_USERNAME');
    checkPassword(input.password);
    const role = await resolveRole(input.roleId, tenant.id);
    if (!role) throw fail(400, 'INVALID_ROLE');
    const email = text(input.email, 200);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'INVALID_EMAIL');
    const plan = await planOf(tenant.plan_id), limits = access.effectiveLimits(plan, normaliseData(parse(tenant.data)).limits);
    if (limits.maxAdmins != null && num((await db.query('SELECT COUNT(*) AS n FROM tenant_accounts WHERE tenant_id=$1', [tenant.id]))[0].n) >= limits.maxAdmins) throw fail(409, 'ADMIN_LIMIT');
    const data = { overrides: access.cleanLevels(input.overrides, { strict: true, fail: m => fail(400, m) }) };
    const id = 'acc_' + crypto.randomBytes(6).toString('hex'), now = Date.now();
    try { await db.query('INSERT INTO tenant_accounts(id,tenant_id,username,name,email,password_hash,role_id,status,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [id, tenant.id, username, text(input.name, 100, { required: true, code: 'INVALID_NAME' }), email, hashPassword(input.password), role.id, 'active', JSON.stringify(data), now]); }
    catch (error) { if (/unique|duplicate/i.test(String(error.message))) throw fail(409, 'USERNAME_TAKEN'); throw error; }
    await changed();
    return id;
  }
  async function updateAccount(id, patch) {
    const row = (await db.query('SELECT * FROM tenant_accounts WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    if (!patch || typeof patch !== 'object') throw fail(400, 'INVALID_INPUT');
    const data = parse(row.data), next = { name: row.name, email: row.email, role_id: row.role_id, status: row.status, tenant_id: row.tenant_id };
    if (patch.name !== undefined) next.name = text(patch.name, 100, { required: true, code: 'INVALID_NAME' });
    if (patch.email !== undefined) { next.email = text(patch.email, 200); if (next.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email)) throw fail(400, 'INVALID_EMAIL'); }
    if (patch.tenantId !== undefined && patch.tenantId !== row.tenant_id) {
      if (!(await tenantRow(patch.tenantId))) throw fail(400, 'INVALID_TENANT');
      next.tenant_id = patch.tenantId;
    }
    if (patch.roleId !== undefined || next.tenant_id !== row.tenant_id) {
      const role = await resolveRole(patch.roleId ?? row.role_id, next.tenant_id);
      if (!role) throw fail(400, 'INVALID_ROLE');
      next.role_id = role.id;
    }
    if (patch.status !== undefined) { if (!['active', 'suspended'].includes(patch.status)) throw fail(400, 'INVALID_STATUS'); next.status = patch.status; }
    if (patch.overrides !== undefined) data.overrides = access.cleanLevels(patch.overrides, { strict: true, fail: m => fail(400, m) });
    await db.query('UPDATE tenant_accounts SET name=$1,email=$2,role_id=$3,status=$4,tenant_id=$5,data=$6,updated_at=$7 WHERE id=$8', [next.name, next.email, next.role_id, next.status, next.tenant_id, JSON.stringify(data), Date.now(), id]);
    // A suspended, moved or re-roled account must not keep working on a session issued before.
    if (next.status !== 'active' || next.tenant_id !== row.tenant_id) await db.query('DELETE FROM admin_sessions WHERE account_id=$1', [id]);
    await changed();
    return { tenantId: next.tenant_id, before: { status: row.status, roleId: row.role_id }, after: { status: next.status, roleId: next.role_id } };
  }
  async function setAccountPassword(id, password) {
    checkPassword(password);
    const rows = await db.query('UPDATE tenant_accounts SET password_hash=$1, updated_at=$2 WHERE id=$3 RETURNING tenant_id', [hashPassword(password), Date.now(), id]);
    if (!rows.length) throw fail(404, 'NOT_FOUND');
    await db.query('DELETE FROM admin_sessions WHERE account_id=$1', [id]);
    await changed();
    return rows[0].tenant_id;
  }
  async function removeAccount(id) {
    const rows = await db.query('DELETE FROM tenant_accounts WHERE id=$1 RETURNING tenant_id,username', [id]);
    if (!rows.length) throw fail(404, 'NOT_FOUND');
    await db.query('DELETE FROM admin_sessions WHERE account_id=$1', [id]);
    await db.query("DELETE FROM subscriptions WHERE owner_type='admin' AND owner_id=$1", [id]);
    await db.query('DELETE FROM admin_prefs WHERE admin_id=$1', [id]);
    await changed();
    return { tenantId: rows[0].tenant_id, username: rows[0].username };
  }
  /** Tenant account login. Returns the account row or null (unknown user, wrong password and suspended all look the same to the caller except `blocked`). */
  async function authenticateAccount(username, password) {
    await ensureReady();
    const row = (await db.query('SELECT * FROM tenant_accounts WHERE username=$1', [String(username).trim().toLowerCase()]))[0];
    const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !ok) return null;
    return row;
  }
  const touchLogin = id => db.query('UPDATE tenant_accounts SET last_login=$1 WHERE id=$2', [Date.now(), id]);

  /* ---------------- access context of an admin session ---------------- */
  /**
   * What may this admin session do right now? `session` is an admin_sessions row ({ account_id, tenant_id }).
   * A session without an account is the legacy admin (ADMIN_EMAIL / admin): owner of the default workspace.
   * Result: { ok, reason?, tenantId, tenant, account, role, levels, limits, plan } (cached for a few seconds, invalidated by every write here).
   */
  async function context(session) {
    const key = session.account_id || 'legacy:' + (session.tenant_id || 'default');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 3000) return hit.value;
    await ensureReady();
    let account = null, role, tenantId = session.tenant_id || 'default';
    if (session.account_id) {
      account = (await db.query('SELECT * FROM tenant_accounts WHERE id=$1', [session.account_id]))[0];
      if (!account || account.status !== 'active') return remember(key, { ok: false, reason: 'ACCOUNT_DISABLED' });
      tenantId = account.tenant_id;
    }
    const tenantRaw = await tenantRow(tenantId);
    if (!tenantRaw) return remember(key, { ok: false, reason: 'ACCOUNT_DISABLED' });
    if (tenantRaw.status !== 'active') return remember(key, { ok: false, reason: 'TENANT_SUSPENDED' });
    const tenant = tenantOut(tenantRaw), plan = await planOf(tenant.planId);
    role = account ? await resolveRole(account.role_id, tenantId) : systemRole(access.SYSTEM_ROLES[0]);
    if (!role) return remember(key, { ok: false, reason: 'ACCOUNT_DISABLED' });
    const levels = access.effectiveLevels(access.tenantLevels(plan, tenant.overrides), role.permissions, account ? access.cleanLevels(parse(account.data).overrides) : {});
    return remember(key, { ok: true, tenantId, tenant, account: account && accountOut(account, [role], [tenantRaw]), legacy: !account, role: { id: role.id, name: role.name }, levels, limits: access.effectiveLimits(plan, tenant.limits), plan: plan && { id: plan.id, name: plan.name } });
  }
  const remember = (key, value) => { cache.set(key, { at: Date.now(), value }); return value; };

  /* ---------------- analytics ---------------- */
  async function overview(days = 30) {
    await ensureReady();
    days = [7, 30, 90].includes(days) ? days : 30;
    const now = Date.now(), today = Math.floor(now / DAY), since = (today - days + 1) * DAY, prevSince = since - days * DAY;
    const [tenants, accounts, clients, requests, statuses, creditRows, newClients, newRequests, newTenants, prevClients, prevRequests, tenantList, devices, sessions] = await Promise.all([
      db.query('SELECT status, COUNT(*) AS n FROM tenants GROUP BY status'),
      db.query('SELECT status, COUNT(*) AS n FROM tenant_accounts GROUP BY status'),
      db.query('SELECT COUNT(*) AS n, SUM(CASE WHEN blocked=1 THEN 1 ELSE 0 END) AS blocked, SUM(CASE WHEN last_seen>=$1 THEN 1 ELSE 0 END) AS active FROM clients', [now - 7 * DAY]),
      db.query('SELECT COUNT(*) AS n FROM requests'),
      db.query("SELECT data::jsonb->>'status' AS s, COUNT(*) AS n FROM requests GROUP BY 1"),
      db.query('SELECT COALESCE(SUM(credits),0) AS n FROM clients'),
      db.query('SELECT created_at/$2 AS d, COUNT(*) AS n FROM clients WHERE created_at>=$1 GROUP BY 1', [since, DAY]),
      db.query('SELECT created_at/$2 AS d, COUNT(*) AS n FROM requests WHERE created_at>=$1 GROUP BY 1', [since, DAY]),
      db.query("SELECT created_at/$2 AS d, COUNT(*) AS n FROM tenants WHERE created_at>=$1 AND id<>'default' GROUP BY 1", [since, DAY]),
      db.query('SELECT COUNT(*) AS n FROM clients WHERE created_at>=$1 AND created_at<$2', [prevSince, since]),
      db.query('SELECT COUNT(*) AS n FROM requests WHERE created_at>=$1 AND created_at<$2', [prevSince, since]),
      listTenants(),
      db.query("SELECT COUNT(*) AS n FROM subscriptions"),
      db.query('SELECT COUNT(*) AS n FROM admin_sessions WHERE expires_at>$1', [now]),
    ]);
    const series = rows => { const map = Object.fromEntries(rows.map(r => [num(r.d), num(r.n)])); return Array.from({ length: days }, (_, i) => map[today - days + 1 + i] || 0); };
    const total = list => list.reduce((sum, v) => sum + v, 0);
    const byStatus = Object.fromEntries(statuses.map(r => [r.s || 'pending', num(r.n)]));
    const plans = await getPlans();
    const planMix = plans.map(plan => ({ id: plan.id, name: plan.name, price: plan.price, tenants: tenantList.filter(t => t.planId === plan.id).length }));
    // The default workspace is the platform owner's own: it is not a paying tenant.
    const mrr = tenantList.filter(t => t.id !== 'default' && t.status === 'active').reduce((sum, t) => sum + (plans.find(p => p.id === t.planId)?.price || 0), 0);
    const insights = [];
    for (const t of tenantList) {
      if (t.status === 'suspended') insights.push({ kind: 'info', code: 'suspended', tenantId: t.id, tenantName: t.name });
      if (t.limits.maxClients != null && t.usage.clients >= t.limits.maxClients * 0.8) insights.push({ kind: t.usage.clients >= t.limits.maxClients ? 'danger' : 'warning', code: 'clients_near_limit', tenantId: t.id, tenantName: t.name, value: t.usage.clients, limit: t.limits.maxClients });
      if (t.limits.monthlyDesigns != null && t.usage.designsThisMonth >= t.limits.monthlyDesigns * 0.8) insights.push({ kind: t.usage.designsThisMonth >= t.limits.monthlyDesigns ? 'danger' : 'warning', code: 'designs_near_limit', tenantId: t.id, tenantName: t.name, value: t.usage.designsThisMonth, limit: t.limits.monthlyDesigns });
      if (t.id !== 'default' && t.status === 'active' && !t.usage.activeAccounts) insights.push({ kind: 'warning', code: 'no_admin', tenantId: t.id, tenantName: t.name });
      if (t.id !== 'default' && t.status === 'active' && t.usage.clients > 0 && !t.usage.lastRequestAt) insights.push({ kind: 'info', code: 'no_activity', tenantId: t.id, tenantName: t.name });
    }
    const neverLoggedIn = Number((await db.query("SELECT COUNT(*) AS n FROM tenant_accounts WHERE last_login IS NULL AND status='active'"))[0].n);
    if (neverLoggedIn) insights.push({ kind: 'info', code: 'never_logged_in', value: neverLoggedIn });
    const config = await getConfig();
    if (config.maintenance.enabled) insights.push({ kind: 'warning', code: 'maintenance_on' });
    if (!config.signupOpen) insights.push({ kind: 'info', code: 'signup_closed' });
    const sevenDays = { clients: series(newClients), requests: series(newRequests), tenants: series(newTenants) };
    return {
      days, generatedAt: now,
      labels: Array.from({ length: days }, (_, i) => new Date((today - days + 1 + i) * DAY).toISOString().slice(0, 10)),
      totals: {
        tenants: total(tenants.map(r => num(r.n))), activeTenants: num(tenants.find(r => r.status === 'active')?.n), suspendedTenants: num(tenants.find(r => r.status === 'suspended')?.n),
        accounts: total(accounts.map(r => num(r.n))), activeAccounts: num(accounts.find(r => r.status === 'active')?.n),
        clients: num(clients[0].n), blockedClients: num(clients[0].blocked), activeClients: num(clients[0].active), requests: num(requests[0].n), credits: num(creditRows[0].n),
        devices: num(devices[0].n), sessions: num(sessions[0].n), mrr,
      },
      period: { clients: total(sevenDays.clients), requests: total(sevenDays.requests), tenants: total(sevenDays.tenants), prevClients: num(prevClients[0].n), prevRequests: num(prevRequests[0].n) },
      series: sevenDays,
      requestStatus: { pending: byStatus.pending || 0, processing: byStatus.processing || 0, delivered: byStatus.delivered || 0 },
      planMix,
      topTenants: [...tenantList].sort((a, b) => b.usage.designsThisMonth - a.usage.designsThisMonth || b.usage.clients - a.usage.clients).slice(0, 8).map(t => ({ id: t.id, name: t.name, slug: t.slug, planName: t.planName, status: t.status, clients: t.usage.clients, designs: t.usage.designsThisMonth, accounts: t.usage.accounts })),
      insights,
    };
  }

  return {
    ensureReady, invalidate, hashPassword, verifyPassword,
    getPlans, setPlans, getConfig, setConfig, publicConfig, configCached, tenantInfo, designsThisMonth,
    log, auditList,
    listTenants, getTenant, createTenant, updateTenant, removeTenant, tenantBySlug, tenantRow,
    listRoles, resolveRole, saveRole, removeRole,
    listAccounts, createAccount, updateAccount, setAccountPassword, removeAccount, authenticateAccount, touchLogin,
    context, overview,
  };
}
module.exports = { createPlatform, hashPassword, verifyPassword };
