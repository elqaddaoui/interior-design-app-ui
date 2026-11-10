/**
 * Super Admin: the platform owner. One account with its own sessions (cookie `dwira_super` / header `X-Super-Token`), completely separate from the
 * administrators: an administrator session never opens /api/superadmin and a Super Admin session is not an administrator.
 *
 * Credentials: until they are changed from the dashboard the default `superadmin` / `superadmin` opens the account (unless
 * DISABLE_DEFAULT_SUPERADMIN=true or SUPERADMIN_PASSWORD_HASH is set). From the first change the stored scrypt hash REPLACES them: the default stops
 * working at once and every other Super Admin session is signed out. 5 failed sign-ins from one address in 15 minutes lock that address for the rest of the window.
 *
 * What the Super Admin manages: administrators (create, roles, per-person permission / UI overrides, disable, reset password, sign out, delete), roles,
 * tenants (organisations that group administrators: plan, seats, suspension), the platform's clients, platform switches and an audit log of every change.
 */
const crypto = require('node:crypto');
const { hashPassword, passwordMatches, passwordProblem } = require('./admins');
const { canonicalPhone } = require('./clients');
const A = require('./access');

const fail = (status, message) => Object.assign(new Error(message), { status });
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const DAY = 86400000;
const SESSION_MS = 12 * 3600000;
const LOCK_AFTER = 5, LOCK_WINDOW = 15 * 60000;
const USERNAME = /^[A-Za-z0-9._-]{3,40}$/;
const ADMIN_ID = /^[a-z0-9][a-z0-9._@-]{2,63}$/;
const PLANS = ['free', 'starter', 'pro', 'enterprise'];
const TENANT_STATUS = ['active', 'trial', 'suspended'];
const MAX_CREDITS = 1000000;
const PLATFORM_DEFAULTS = { maintenance: false, maintenanceMessage: '', allowClientSignup: true, allowRequests: true };
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

/** Super Admin passwords are held to a higher bar than administrators': 10+ characters, a letter and a digit, never the default or the username. */
function superPasswordProblem(password, username = '') {
  const value = String(password ?? '');
  if (value.length < 10 || value.length > 128 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'WEAK_PASSWORD';
  const low = value.toLowerCase();
  if (low === 'superadmin' || low.includes('superadmin') || (username && low === String(username).toLowerCase())) return 'WEAK_PASSWORD';
  return passwordProblem(value, { username });
}

function createSuperAdmin(db, { env = process.env, sync, clients, notifier, content } = {}) {
  /* ---------------------------------------------------------------- account */
  const envUsername = () => (env.SUPERADMIN_USERNAME || 'superadmin').trim().toLowerCase();
  const envHash = () => env.SUPERADMIN_PASSWORD_HASH || '';
  const defaultAllowed = () => env.DISABLE_DEFAULT_SUPERADMIN !== 'true' && !envHash();
  async function account() {
    const now = Date.now();
    await db.query('INSERT INTO superadmin_account(id,username,created_at,updated_at) VALUES(1,$1,$2,$2) ON CONFLICT (id) DO NOTHING', [envUsername(), now]);
    return (await db.query('SELECT * FROM superadmin_account WHERE id=1'))[0];
  }
  const profileOf = row => ({
    username: row.username, name: row.name || '', defaultPassword: defaultAllowed() && !row.pw_hash,
    createdAt: Number(row.created_at), lastLoginAt: row.last_login_at == null ? 0 : Number(row.last_login_at), passwordChangedAt: row.pw_changed_at == null ? 0 : Number(row.pw_changed_at),
  });
  const profile = async () => profileOf(await account());

  async function verify(username, password) {
    const row = await account();
    const user = String(username ?? '').trim().toLowerCase();
    if (!user || user.length > 190 || typeof password !== 'string' || !password || password.length > 512) return false;
    if (row.pw_hash) return user === String(row.username).toLowerCase() && passwordMatches(password, row.pw_hash);
    if (envHash()) return user === envUsername() && passwordMatches(password, envHash());
    return defaultAllowed() && user === 'superadmin' && password === 'superadmin';
  }

  /* ---------------------------------------------------------------- audit */
  async function record(actor, action, target = '', detail = {}, ip = '') {
    try {
      await db.query('INSERT INTO sa_audit(id,at,actor,action,target,detail,ip) VALUES($1,$2,$3,$4,$5,$6,$7)', [crypto.randomUUID(), Date.now(), clean(actor, 80), clean(action, 60), clean(target, 120), JSON.stringify(detail || {}).slice(0, 2000), clean(ip, 64)]);
    } catch { /* an audit failure never blocks the action it describes */ }
  }
  async function auditList({ limit = 50, before = null, q = '' } = {}) {
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    const needle = clean(q, 60).toLowerCase();
    const rows = await db.query(`SELECT * FROM sa_audit WHERE ($1::bigint IS NULL OR at<$1) AND ($2='' OR lower(action) LIKE $3 OR lower(target) LIKE $3 OR lower(actor) LIKE $3) ORDER BY at DESC LIMIT $4`, [before ? Number(before) : null, needle, `%${needle.replace(/[%_]/g, '')}%`, n]);
    return rows.map(r => ({ id: r.id, at: Number(r.at), actor: r.actor, action: r.action, target: r.target, detail: parse(r.detail, {}), ip: r.ip }));
  }

  /* ---------------------------------------------------------------- sign-in and sessions */
  async function login(username, password, { ip = '', ua = '' } = {}) {
    const now = Date.now();
    const failed = Number((await db.query("SELECT COUNT(*)::int AS n FROM sa_audit WHERE ip=$1 AND action='superadmin.login_failed' AND at>$2", [ip, now - LOCK_WINDOW]))[0].n);
    if (failed >= LOCK_AFTER) throw fail(429, 'TOO_MANY_ATTEMPTS');
    if (!(await verify(username, password))) {
      await record('anonymous', 'superadmin.login_failed', clean(username, 60), {}, ip);
      throw fail(401, 'Invalid credentials');
    }
    const token = crypto.randomBytes(32).toString('hex');
    await db.query('DELETE FROM superadmin_sessions WHERE expires_at<=$1', [now]);
    await db.query('INSERT INTO superadmin_sessions(token_hash,expires_at,created_at,ua,ip) VALUES($1,$2,$3,$4,$5)', [digest(token), now + SESSION_MS, now, clean(ua, 300), clean(ip, 64)]);
    await db.query('UPDATE superadmin_account SET last_login_at=$1 WHERE id=1', [now]);
    // A successful sign-in clears the failed attempts of this address.
    await db.query("DELETE FROM sa_audit WHERE ip=$1 AND action='superadmin.login_failed'", [ip]);
    await record((await account()).username, 'superadmin.login', '', {}, ip);
    return { token, profile: await profile() };
  }
  async function authenticate(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = (await db.query('SELECT token_hash FROM superadmin_sessions WHERE token_hash=$1 AND expires_at>$2', [digest(token), Date.now()]))[0];
    return row ? { tokenHash: row.token_hash } : null;
  }
  const logout = token => token ? db.query('DELETE FROM superadmin_sessions WHERE token_hash=$1', [digest(token)]) : null;
  async function sessions(currentHash) {
    const rows = await db.query('SELECT token_hash,created_at,expires_at,ua,ip FROM superadmin_sessions WHERE expires_at>$1 ORDER BY created_at DESC', [Date.now()]);
    return rows.map(r => ({ id: r.token_hash.slice(0, 16), current: r.token_hash === currentHash, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at), ua: r.ua || '', ip: r.ip || '' }));
  }
  const revokeOthers = currentHash => db.query('DELETE FROM superadmin_sessions WHERE token_hash<>$1', [currentHash]);

  /** Changes the password (and optionally the username) after checking the current one; every other Super Admin session is signed out. */
  async function changeCredentials({ current, next, username } = {}, currentHash, ip = '') {
    const row = await account();
    if (typeof current !== 'string' || typeof next !== 'string' || !current || current.length > 512) throw fail(400, 'INVALID_PASSWORD');
    if (!(await verify(row.username, current))) throw fail(403, 'WRONG_PASSWORD');
    if (next === current) throw fail(400, 'SAME_PASSWORD');
    const newName = username === undefined || username === null || username === '' ? row.username : String(username).trim();
    if (!USERNAME.test(newName)) throw fail(400, 'INVALID_USERNAME');
    if (superPasswordProblem(next, newName)) throw fail(400, 'WEAK_PASSWORD');
    const now = Date.now();
    await db.query('UPDATE superadmin_account SET username=$1, pw_hash=$2, pw_changed_at=$3, updated_at=$3 WHERE id=1', [newName, hashPassword(next), now]);
    await db.query('DELETE FROM superadmin_sessions WHERE token_hash<>$1', [currentHash]);
    await record(newName, 'superadmin.credentials_changed', '', { usernameChanged: newName !== row.username }, ip);
    return profile();
  }

  /* ---------------------------------------------------------------- platform switches */
  let platformCache = null;
  async function getPlatform() {
    if (platformCache && Date.now() - platformCache.at < 3000) return platformCache.value;
    const row = (await db.query("SELECT value FROM settings WHERE key='platform'"))[0];
    const value = { ...PLATFORM_DEFAULTS, ...(row ? parse(row.value, {}) : {}) };
    platformCache = { at: Date.now(), value };
    return value;
  }
  async function platformView() {
    const settings = content ? await content.getDoc('settings') : {};
    return { ...(await getPlatform()), defaultFreeCredits: Number.isInteger(settings.defaultFreeCredits) ? settings.defaultFreeCredits : 1, notifyAdmins: settings.notifyAdmins !== false, notifyUsers: settings.notifyUsers !== false };
  }
  async function setPlatform(patch, actor, ip) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, 'INVALID_PLATFORM');
    const next = { ...(await getPlatform()) }, docPatch = {};
    for (const key of ['maintenance', 'allowClientSignup', 'allowRequests']) if (patch[key] !== undefined) { if (typeof patch[key] !== 'boolean') throw fail(400, 'INVALID_PLATFORM'); next[key] = patch[key]; }
    if (patch.maintenanceMessage !== undefined) { if (typeof patch.maintenanceMessage !== 'string') throw fail(400, 'INVALID_PLATFORM'); next.maintenanceMessage = clean(patch.maintenanceMessage, 300); }
    for (const key of ['notifyAdmins', 'notifyUsers']) if (patch[key] !== undefined) { if (typeof patch[key] !== 'boolean') throw fail(400, 'INVALID_PLATFORM'); docPatch[key] = patch[key]; }
    if (patch.defaultFreeCredits !== undefined) { if (!Number.isInteger(patch.defaultFreeCredits) || patch.defaultFreeCredits < 0 || patch.defaultFreeCredits > 1000) throw fail(400, 'INVALID_PLATFORM'); docPatch.defaultFreeCredits = patch.defaultFreeCredits; }
    await db.query("INSERT INTO settings(key,value) VALUES('platform',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(next)]);
    platformCache = null;
    if (Object.keys(docPatch).length && content) await content.patchDoc('settings', docPatch);
    await record(actor, 'platform.updated', '', { ...patch, maintenanceMessage: patch.maintenanceMessage === undefined ? undefined : '(text)' }, ip);
    return platformView();
  }

  /* ---------------------------------------------------------------- roles */
  let rolesReady;
  const ensureRoles = () => rolesReady ||= (async () => {
    if ((await db.query("SELECT 1 FROM settings WHERE key='roles_seeded'"))[0]) return;
    const now = Date.now();
    await db.tx(async q => {
      const claimed = await q("INSERT INTO settings(key,value) VALUES('roles_seeded',$1) ON CONFLICT (key) DO NOTHING RETURNING key", [String(now)]);
      if (!claimed.length) return;
      for (const r of A.SEED_ROLES) await q('INSERT INTO sa_roles(id,name,description,permissions,ui,system,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT (id) DO NOTHING', [r.id, r.name, r.description, JSON.stringify(r.permissions), JSON.stringify(r.ui), r.system ? 1 : 0, now]);
    });
  })().catch(error => { rolesReady = undefined; throw error; });

  const roleView = (row, count = 0) => ({ id: row.id, name: row.name, description: row.description, permissions: parse(row.permissions, {}), ui: parse(row.ui, []), system: !!row.system, admins: count, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
  async function listRoles() {
    await ensureRoles();
    const rows = await db.query('SELECT * FROM sa_roles ORDER BY system DESC, created_at');
    const counts = Object.fromEntries((await db.query('SELECT role_id, COUNT(*)::int AS n FROM admin_accounts WHERE role_id IS NOT NULL GROUP BY role_id')).map(r => [r.role_id, r.n]));
    return rows.map(r => roleView(r, counts[r.id] || 0));
  }
  function roleInput(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_ROLE');
    const out = {};
    if (!partial || body.name !== undefined) { out.name = clean(body.name, 60).replace(/\s+/g, ' '); if (out.name.length < 2) throw fail(400, 'INVALID_ROLE_NAME'); }
    if (body.description !== undefined) out.description = clean(body.description, 200);
    if (!partial || body.permissions !== undefined) out.permissions = A.cleanPermissions(body.permissions);
    if (!partial || body.ui !== undefined) out.ui = A.cleanUi(body.ui);
    return out;
  }
  const bumpAdmins = async ids => { if (sync && ids.length) await sync.bump(...ids.map(id => `a:${id}`)); };
  async function createRole(body, actor, ip) {
    await ensureRoles();
    const input = roleInput(body);
    if ((await db.query('SELECT 1 FROM sa_roles WHERE lower(name)=$1', [input.name.toLowerCase()]))[0]) throw fail(409, 'ROLE_NAME_TAKEN');
    const id = `r_${crypto.randomBytes(6).toString('hex')}`, now = Date.now();
    await db.query('INSERT INTO sa_roles(id,name,description,permissions,ui,system,created_at,updated_at) VALUES($1,$2,$3,$4,$5,0,$6,$6)', [id, input.name, input.description || '', JSON.stringify(input.permissions), JSON.stringify(input.ui), now]);
    await record(actor, 'role.created', input.name, { id }, ip);
    return roleView((await db.query('SELECT * FROM sa_roles WHERE id=$1', [id]))[0]);
  }
  async function updateRole(id, body, actor, ip) {
    await ensureRoles();
    const row = (await db.query('SELECT * FROM sa_roles WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    if (row.system) throw fail(400, 'ROLE_LOCKED');
    const input = roleInput(body, true);
    if (input.name && (await db.query('SELECT 1 FROM sa_roles WHERE lower(name)=$1 AND id<>$2', [input.name.toLowerCase(), id]))[0]) throw fail(409, 'ROLE_NAME_TAKEN');
    const next = { name: input.name ?? row.name, description: input.description ?? row.description, permissions: input.permissions ?? parse(row.permissions, {}), ui: input.ui ?? parse(row.ui, []) };
    await db.query('UPDATE sa_roles SET name=$1, description=$2, permissions=$3, ui=$4, updated_at=$5 WHERE id=$6', [next.name, next.description, JSON.stringify(next.permissions), JSON.stringify(next.ui), Date.now(), id]);
    await bumpAdmins((await db.query('SELECT admin_id FROM admin_accounts WHERE role_id=$1', [id])).map(r => r.admin_id));
    await record(actor, 'role.updated', next.name, { id }, ip);
    return roleView((await db.query('SELECT * FROM sa_roles WHERE id=$1', [id]))[0]);
  }
  async function deleteRole(id, actor, ip) {
    await ensureRoles();
    const row = (await db.query('SELECT * FROM sa_roles WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    if (row.system) throw fail(400, 'ROLE_LOCKED');
    if (Number((await db.query('SELECT COUNT(*)::int AS n FROM admin_accounts WHERE role_id=$1', [id]))[0].n)) throw fail(409, 'ROLE_IN_USE');
    await db.query('DELETE FROM sa_roles WHERE id=$1', [id]);
    await record(actor, 'role.deleted', row.name, { id }, ip);
  }

  /* ---------------------------------------------------------------- tenants */
  const tenantView = (row, admins = 0) => ({ id: row.id, name: row.name, plan: row.plan, status: row.status, contactEmail: row.contact_email, notes: row.notes, maxAdmins: row.max_admins == null ? null : Number(row.max_admins), admins: Number(admins), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
  async function listTenants() {
    const rows = await db.query('SELECT * FROM sa_tenants ORDER BY created_at');
    const counts = Object.fromEntries((await db.query('SELECT tenant_id, COUNT(*)::int AS n FROM admin_accounts WHERE tenant_id IS NOT NULL GROUP BY tenant_id')).map(r => [r.tenant_id, r.n]));
    return rows.map(r => tenantView(r, counts[r.id] || 0));
  }
  function tenantInput(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_TENANT');
    const out = {};
    if (!partial || body.name !== undefined) { out.name = clean(body.name, 80).replace(/\s+/g, ' '); if (out.name.length < 2) throw fail(400, 'INVALID_TENANT_NAME'); }
    if (body.plan !== undefined) { if (!PLANS.includes(body.plan)) throw fail(400, 'INVALID_TENANT'); out.plan = body.plan; }
    if (body.status !== undefined) { if (!TENANT_STATUS.includes(body.status)) throw fail(400, 'INVALID_TENANT'); out.status = body.status; }
    if (body.contactEmail !== undefined) { const email = clean(body.contactEmail, 254).toLowerCase(); if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,24}$/.test(email)) throw fail(400, 'INVALID_EMAIL'); out.contact_email = email; }
    if (body.notes !== undefined) out.notes = clean(body.notes, 500);
    if (body.maxAdmins !== undefined) { if (body.maxAdmins !== null && !(Number.isInteger(body.maxAdmins) && body.maxAdmins >= 1 && body.maxAdmins <= 10000)) throw fail(400, 'INVALID_TENANT'); out.max_admins = body.maxAdmins; }
    return out;
  }
  async function createTenant(body, actor, ip) {
    const input = tenantInput(body);
    if ((await db.query('SELECT 1 FROM sa_tenants WHERE lower(name)=$1', [input.name.toLowerCase()]))[0]) throw fail(409, 'TENANT_NAME_TAKEN');
    const id = `t_${crypto.randomBytes(6).toString('hex')}`, now = Date.now();
    await db.query('INSERT INTO sa_tenants(id,name,plan,status,contact_email,notes,max_admins,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)', [id, input.name, input.plan || 'free', input.status || 'active', input.contact_email || '', input.notes || '', input.max_admins ?? null, now]);
    await record(actor, 'tenant.created', input.name, { id }, ip);
    return tenantView((await db.query('SELECT * FROM sa_tenants WHERE id=$1', [id]))[0]);
  }
  async function updateTenant(id, body, actor, ip) {
    const row = (await db.query('SELECT * FROM sa_tenants WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    const input = tenantInput(body, true);
    if (input.name && (await db.query('SELECT 1 FROM sa_tenants WHERE lower(name)=$1 AND id<>$2', [input.name.toLowerCase(), id]))[0]) throw fail(409, 'TENANT_NAME_TAKEN');
    const used = Number((await db.query('SELECT COUNT(*)::int AS n FROM admin_accounts WHERE tenant_id=$1', [id]))[0].n);
    if (input.max_admins != null && input.max_admins < used) throw fail(409, 'TENANT_SEATS_IN_USE');
    const keys = Object.keys(input);
    if (keys.length) {
      await db.query(`UPDATE sa_tenants SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => input[k]), Date.now(), id]);
      const members = (await db.query('SELECT admin_id FROM admin_accounts WHERE tenant_id=$1', [id])).map(r => r.admin_id);
      if (input.status === 'suspended') for (const m of members) await db.query('DELETE FROM admin_sessions WHERE admin_id=$1', [m]);
      await bumpAdmins(members);
    }
    await record(actor, input.status && input.status !== row.status ? `tenant.${input.status}` : 'tenant.updated', input.name ?? row.name, { id }, ip);
    return tenantView((await db.query('SELECT * FROM sa_tenants WHERE id=$1', [id]))[0], used);
  }
  async function deleteTenant(id, actor, ip) {
    const row = (await db.query('SELECT * FROM sa_tenants WHERE id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    if (Number((await db.query('SELECT COUNT(*)::int AS n FROM admin_accounts WHERE tenant_id=$1', [id]))[0].n)) throw fail(409, 'TENANT_NOT_EMPTY');
    await db.query('DELETE FROM sa_tenants WHERE id=$1', [id]);
    await record(actor, 'tenant.deleted', row.name, { id }, ip);
  }

  /* ---------------------------------------------------------------- administrators */
  const BUILTIN = id => id === 'admin' || (!!env.ADMIN_EMAIL && id === env.ADMIN_EMAIL.toLowerCase());
  const ADMIN_SQL = `SELECT a.*, a.pw_hash IS NOT NULL AS has_pw, r.name AS role_name, r.permissions AS role_perms, r.ui AS role_ui, t.name AS tenant_name, t.status AS tenant_status,
    (SELECT COUNT(*)::int FROM admin_sessions s WHERE s.admin_id=a.admin_id AND s.expires_at>$1) AS sessions
    FROM admin_accounts a LEFT JOIN sa_roles r ON r.id=a.role_id LEFT JOIN sa_tenants t ON t.id=a.tenant_id`;
  const adminView = row => {
    const override = row.perm_override ? parse(row.perm_override, null) : null;
    return {
      id: row.admin_id, username: row.admin_id, name: row.name, email: row.email, phone: row.phone, title: row.title, avatar: row.avatar,
      credits: row.credits == null ? null : Number(row.credits), createdAt: Number(row.created_at), lastLoginAt: row.last_login_at == null ? 0 : Number(row.last_login_at),
      passwordSet: !!row.has_pw, disabled: !!row.disabled, builtIn: BUILTIN(row.admin_id), sessions: Number(row.sessions || 0),
      role: row.role_id ? { id: row.role_id, name: row.role_name || '' } : null,
      tenant: row.tenant_id ? { id: row.tenant_id, name: row.tenant_name || '', status: row.tenant_status || 'active' } : null,
      override: override ? { permissions: override.permissions ?? null, ui: override.ui ?? null } : null,
      access: A.publicAccess(A.resolveAccess(row)),
    };
  };
  async function ensureBuiltIns() {
    const now = Date.now();
    const ids = [...(env.DISABLE_DEFAULT_ADMIN === 'true' ? [] : ['admin']), ...(env.ADMIN_EMAIL ? [env.ADMIN_EMAIL.toLowerCase()] : [])];
    for (const id of ids) await db.query('INSERT INTO admin_accounts(admin_id,email,created_at,updated_at) VALUES($1,$2,$3,$3) ON CONFLICT (admin_id) DO NOTHING', [id, id.includes('@') ? id : '', now]).catch(() => {});
  }
  async function listAdmins() {
    await ensureRoles(); await ensureBuiltIns();
    return (await db.query(`${ADMIN_SQL} ORDER BY a.created_at, a.admin_id`, [Date.now()])).map(adminView);
  }
  const oneAdmin = async id => { if (BUILTIN(id)) await ensureBuiltIns(); const row = (await db.query(`${ADMIN_SQL} WHERE a.admin_id=$2`, [Date.now(), id]))[0]; if (!row) throw fail(404, 'NOT_FOUND'); return adminView(row); };
  const seatsLeft = async (tenantId, exceptAdmin = '') => {
    const t = (await db.query('SELECT max_admins FROM sa_tenants WHERE id=$1', [tenantId]))[0];
    if (!t) throw fail(400, 'INVALID_TENANT');
    if (t.max_admins == null) return;
    const used = Number((await db.query('SELECT COUNT(*)::int AS n FROM admin_accounts WHERE tenant_id=$1 AND admin_id<>$2', [tenantId, exceptAdmin]))[0].n);
    if (used >= Number(t.max_admins)) throw fail(409, 'TENANT_SEATS_FULL');
  };
  const cleanOverride = body => {
    if (body === null) return null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_PERMISSIONS');
    const out = {};
    if (body.permissions !== undefined && body.permissions !== null) out.permissions = A.cleanPermissions(body.permissions);
    if (body.ui !== undefined && body.ui !== null) out.ui = A.cleanUi(body.ui);
    return Object.keys(out).length ? out : null;
  };
  const checkRole = async roleId => { await ensureRoles(); if (!(await db.query('SELECT 1 FROM sa_roles WHERE id=$1', [roleId]))[0]) throw fail(400, 'INVALID_ROLE'); };

  async function createAdmin(body, actor, ip) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_ADMIN');
    const id = String(body.username ?? '').trim().toLowerCase();
    if (!ADMIN_ID.test(id) || id === 'superadmin') throw fail(400, 'INVALID_USERNAME');
    if (BUILTIN(id) || (await db.query('SELECT 1 FROM admin_accounts WHERE admin_id=$1', [id]))[0]) throw fail(409, 'USERNAME_TAKEN');
    const email = clean(body.email, 254).toLowerCase();
    if (typeof body.password !== 'string' || passwordProblem(body.password, { username: id, email })) throw fail(400, 'WEAK_PASSWORD');
    if (typeof body.roleId !== 'string' || !body.roleId) throw fail(400, 'INVALID_ROLE');
    await checkRole(body.roleId);
    const tenantId = body.tenantId || null;
    if (tenantId) await seatsLeft(tenantId);
    const override = body.override === undefined ? null : cleanOverride(body.override);
    const now = Date.now();
    // Profile fields go through the same validation as the administrator's own account page.
    await db.query('INSERT INTO admin_accounts(admin_id,pw_hash,pw_changed_at,role_id,perm_override,tenant_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$3,$3)', [id, hashPassword(body.password), now, body.roleId, override ? JSON.stringify(override) : null, tenantId]);
    try { await adminsApi.update(id, { name: body.name ?? '', email: body.email ?? '', phone: body.phone ?? '', title: body.title ?? '', ...(body.credits !== undefined ? { credits: body.credits } : {}) }); }
    catch (error) { await db.query('DELETE FROM admin_accounts WHERE admin_id=$1', [id]); throw error; }
    await record(actor, 'admin.created', id, { role: body.roleId, tenant: tenantId }, ip);
    return oneAdmin(id);
  }
  let adminsApi;
  async function updateAdmin(id, body, actor, ip) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'INVALID_ADMIN');
    await oneAdmin(id);
    const profile = {};
    for (const k of ['name', 'email', 'phone', 'title', 'avatar', 'credits']) if (body[k] !== undefined) profile[k] = body[k];
    if (Object.keys(profile).length) await adminsApi.update(id, profile);
    const sets = {};
    if (body.roleId !== undefined) { if (body.roleId !== null) await checkRole(body.roleId); sets.role_id = body.roleId; }
    if (body.override !== undefined) { const o = cleanOverride(body.override); sets.perm_override = o ? JSON.stringify(o) : null; }
    if (body.tenantId !== undefined) { if (body.tenantId) await seatsLeft(body.tenantId, id); sets.tenant_id = body.tenantId || null; }
    if (body.disabled !== undefined) { if (typeof body.disabled !== 'boolean') throw fail(400, 'INVALID_ADMIN'); sets.disabled = body.disabled ? 1 : 0; }
    const keys = Object.keys(sets);
    if (keys.length) {
      await db.query(`UPDATE admin_accounts SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE admin_id=$${keys.length + 2}`, [...keys.map(k => sets[k]), Date.now(), id]);
      if (sets.disabled === 1) { await db.query('DELETE FROM admin_sessions WHERE admin_id=$1', [id]); if (notifier) await notifier.removeOwner('admin', id); }
      if (sync) await sync.bump(`a:${id}`);
    }
    await record(actor, sets.disabled === 1 ? 'admin.disabled' : sets.disabled === 0 ? 'admin.enabled' : 'admin.updated', id, { fields: [...Object.keys(profile), ...(body.roleId !== undefined ? ['role'] : []), ...(body.override !== undefined ? ['override'] : []), ...(body.tenantId !== undefined ? ['tenant'] : [])] }, ip);
    return oneAdmin(id);
  }
  async function resetAdminPassword(id, password, actor, ip) {
    const view = await oneAdmin(id);
    if (typeof password !== 'string' || passwordProblem(password, { username: id, email: view.email })) throw fail(400, 'WEAK_PASSWORD');
    const now = Date.now();
    await db.query('UPDATE admin_accounts SET pw_hash=$1, pw_changed_at=$2, updated_at=$2 WHERE admin_id=$3', [hashPassword(password), now, id]);
    await db.query('DELETE FROM admin_sessions WHERE admin_id=$1', [id]);
    if (sync) await sync.bump(`a:${id}`);
    await record(actor, 'admin.password_reset', id, {}, ip);
    return oneAdmin(id);
  }
  async function signOutAdmin(id, actor, ip) {
    await oneAdmin(id);
    await db.query('DELETE FROM admin_sessions WHERE admin_id=$1', [id]);
    await record(actor, 'admin.signed_out', id, {}, ip);
  }
  async function deleteAdmin(id, actor, ip) {
    const view = await oneAdmin(id);
    if (view.builtIn) throw fail(400, 'BUILTIN_ADMIN');
    await db.query('DELETE FROM admin_sessions WHERE admin_id=$1', [id]);
    await db.query('DELETE FROM admin_prefs WHERE admin_id=$1', [id]);
    if (notifier) await notifier.removeOwner('admin', id);
    await db.query('DELETE FROM admin_accounts WHERE admin_id=$1', [id]);
    await record(actor, 'admin.deleted', id, {}, ip);
  }

  /* ---------------------------------------------------------------- clients (the platform's end users) */
  async function clientsPage({ q = '', page = 1, size = 25, status = 'all' } = {}) {
    const n = Math.max(1, Math.min(100, Number(size) || 25)), p = Math.max(1, Number(page) || 1);
    const needle = clean(q, 60).toLowerCase().replace(/[%_\\]/g, '');
    const where = `($1='' OR lower(c.name) LIKE $2 OR c.phone LIKE $2) AND ($3='all' OR ($3='blocked' AND c.blocked=1) OR ($3='active' AND c.blocked=0))`;
    const params = [needle, `%${needle}%`, ['blocked', 'active'].includes(status) ? status : 'all'];
    const total = Number((await db.query(`SELECT COUNT(*)::int AS n FROM clients c WHERE ${where}`, params))[0].n);
    const rows = await db.query(`SELECT c.id,c.phone,c.name,c.free_used,c.credits,c.created_at,c.blocked,c.last_seen,(SELECT COUNT(*)::int FROM claims k WHERE k.client_id=c.id) AS designs FROM clients c WHERE ${where} ORDER BY c.created_at DESC LIMIT $4 OFFSET $5`, [...params, n, (p - 1) * n]);
    return { total, page: p, size: n, items: rows.map(r => ({ id: r.id, name: r.name, whatsapp: r.phone, credits: r.credits + (r.free_used ? 0 : 1), blocked: !!r.blocked, createdAt: Number(r.created_at), lastSeen: r.last_seen == null ? 0 : Number(r.last_seen), designs: Number(r.designs) })) };
  }
  async function updateClient(id, body, actor, ip) {
    const updated = await clients.update(id, { credits: body?.credits, blocked: body?.blocked });
    await sync.bump('clients', `c:${id}`);
    await record(actor, body?.blocked === true ? 'client.blocked' : body?.blocked === false ? 'client.unblocked' : 'client.updated', id, { credits: body?.credits }, ip);
    return updated;
  }
  async function deleteClient(id, actor, ip) {
    await clients.remove(id);
    await notifier.removeOwner('client', id);
    await sync.bump('clients', 'requests', `c:${id}`, `c:${id}:history`, `c:${id}:conversations`, `c:${id}:requests`);
    await record(actor, 'client.deleted', id, {}, ip);
  }
  async function bulkClients(body, actor, ip) {
    const result = await clients.bulk(body);
    if (body.action === 'delete') for (const id of body.ids) await notifier.removeOwner('client', id);
    await sync.bump('clients', 'requests', ...body.ids.flatMap(id => [`c:${id}`, `c:${id}:history`, `c:${id}:requests`]));
    await record(actor, `client.bulk_${body.action}`, `${result.affected} clients`, { mode: body.mode, amount: body.amount }, ip);
    return result;
  }

  /* ---------------------------------------------------------------- analytics */
  async function stats() {
    const now = Date.now(), d7 = now - 7 * DAY, d14 = now - 14 * DAY, d30 = now - 30 * DAY, day0 = Math.floor(now / DAY) - 29;
    const n = async (sql, params = []) => Number((await db.query(sql, params))[0]?.n ?? 0);
    const series = async (table, extra = '') => {
      const rows = await db.query(`SELECT (created_at/86400000)::int AS d, COUNT(*)::int AS c FROM ${table} WHERE created_at>=$1 ${extra} GROUP BY d`, [day0 * DAY]);
      const out = Array(30).fill(0);
      for (const r of rows) { const i = Number(r.d) - day0; if (i >= 0 && i < 30) out[i] = Number(r.c); }
      return out;
    };
    const between = (table, from, to, extra = '') => n(`SELECT COUNT(*)::int AS n FROM ${table} WHERE created_at>=$1 AND created_at<$2 ${extra}`, [from, to]);
    const [clientsTotal, clientsBlocked, requestsTotal, designs, conversations, admins, adminsDisabled, roles, tenants, pushAdmin, pushClient, credits,
      active7, cNew7, cPrev7, rNew7, rPrev7, dNew7, dPrev7, cSeries, rSeries, dSeries, byStatus, topTools, tenantRows, roleRows, outbox, recent] = await Promise.all([
      n('SELECT COUNT(*)::int AS n FROM clients'), n('SELECT COUNT(*)::int AS n FROM clients WHERE blocked=1'), n('SELECT COUNT(*)::int AS n FROM requests'),
      n('SELECT COUNT(*)::int AS n FROM claims'), n("SELECT COUNT(*)::int AS n FROM space WHERE kind='conversations'"),
      n('SELECT COUNT(*)::int AS n FROM admin_accounts'), n('SELECT COUNT(*)::int AS n FROM admin_accounts WHERE disabled=1'),
      (async () => { await ensureRoles(); return n('SELECT COUNT(*)::int AS n FROM sa_roles'); })(), n('SELECT COUNT(*)::int AS n FROM sa_tenants'),
      n("SELECT COUNT(*)::int AS n FROM subscriptions WHERE owner_type='admin'"), n("SELECT COUNT(*)::int AS n FROM subscriptions WHERE owner_type='client'"),
      n('SELECT COALESCE(SUM(credits),0)::float8 AS n FROM clients'),
      n('SELECT COUNT(*)::int AS n FROM clients WHERE last_seen>=$1', [d7]),
      between('clients', d7, now + 1), between('clients', d14, d7), between('requests', d7, now + 1), between('requests', d14, d7), between('claims', d7, now + 1), between('claims', d14, d7),
      series('clients'), series('requests'), series('claims'),
      db.query("SELECT COALESCE(data::jsonb->>'status','pending') AS k, COUNT(*)::int AS c FROM requests GROUP BY k"),
      db.query("SELECT data::jsonb->'draft'->>'toolId' AS k, COUNT(*)::int AS c FROM requests WHERE created_at>=$1 GROUP BY k ORDER BY c DESC LIMIT 6", [d30]),
      db.query('SELECT status, COUNT(*)::int AS c FROM sa_tenants GROUP BY status'),
      db.query('SELECT r.id, r.name, COUNT(a.admin_id)::int AS c FROM sa_roles r LEFT JOIN admin_accounts a ON a.role_id=r.id GROUP BY r.id, r.name ORDER BY c DESC, r.name LIMIT 8'),
      n('SELECT COUNT(*)::int AS n FROM outbox'),
      auditList({ limit: 8 }),
    ]);
    const status = { pending: 0, processing: 0, delivered: 0 };
    for (const r of byStatus) if (r.k in status) status[r.k] = Number(r.c);
    const account_ = await account();
    return {
      generatedAt: now,
      totals: { clients: clientsTotal, clientsBlocked, requests: requestsTotal, designs, conversations, admins, adminsDisabled, roles, tenants, pushDevices: pushAdmin + pushClient, creditsOutstanding: credits },
      windows: { active7, clientsNew7: cNew7, clientsPrev7: cPrev7, requests7: rNew7, requestsPrev7: rPrev7, designs7: dNew7, designsPrev7: dPrev7 },
      requestsByStatus: status,
      series: { start: day0 * DAY, clients: cSeries, requests: rSeries, designs: dSeries },
      topTools: topTools.filter(r => r.k).map(r => ({ id: r.k, count: Number(r.c) })),
      tenantsByStatus: Object.fromEntries(tenantRows.map(r => [r.status, Number(r.c)])),
      rolesUsage: roleRows.map(r => ({ id: r.id, name: r.name, count: Number(r.c) })),
      queue: { pendingNotifications: outbox },
      security: { defaultSuperPassword: defaultAllowed() && !account_.pw_hash, defaultAdminPassword: env.DISABLE_DEFAULT_ADMIN !== 'true' && !(await db.query("SELECT 1 FROM admin_accounts WHERE admin_id='admin' AND pw_hash IS NOT NULL"))[0] },
      recent,
    };
  }

  const bindAdmins = admins => { adminsApi = admins; };
  return {
    bindAdmins, profile, verify, login, authenticate, logout, sessions, revokeOthers, changeCredentials, record, auditList,
    getPlatform, platformView, setPlatform, canonicalPhone,
    listRoles, createRole, updateRole, deleteRole, listTenants, createTenant, updateTenant, deleteTenant,
    listAdmins, createAdmin, updateAdmin, resetAdminPassword, signOutAdmin, deleteAdmin, ensureRoles,
    clientsPage, updateClient, deleteClient, bulkClients, stats,
  };
}

module.exports = { createSuperAdmin, superPasswordProblem, PLANS, TENANT_STATUS, PLATFORM_DEFAULTS };
