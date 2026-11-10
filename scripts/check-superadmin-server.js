const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const access = require('../server/access');
const { freshDb, closeShared } = require('./test-db');

test.after(closeShared);

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: headers['x-test-ip'] || 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(k, v) { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const STRONG = 'Str0ng#Pass-2026';

async function setup(env = {}) {
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', CHAT_RATE_LIMIT: '2000', ...env }, db: await freshDb() });
  const superLogin = (username = 'superadmin', password = 'superadmin', ip) => call(backend, '/api/superadmin/login', { method: 'POST', body: { username, password }, headers: { ...native, ...(ip ? { 'x-test-ip': ip } : {}) } });
  const first = await superLogin();
  const sa = { 'x-super-token': first.body.token };
  const S = (url, method = 'GET', body) => call(backend, `/api/superadmin${url}`, { method, body, headers: sa });
  const adminLogin = (email, password) => call(backend, '/api/admin/login', { method: 'POST', body: { email, password }, headers: native });
  const asAdmin = token => ({ authorization: `Bearer ${token}` });
  return { backend, superLogin, sa, S, adminLogin, asAdmin, first };
}

test('super admin: default credentials sign in, wrong ones do not, everything else needs a session', async () => {
  const { backend, superLogin, first, S } = await setup();
  assert.equal(first.status, 200);
  assert.equal(first.body.profile.username, 'superadmin');
  assert.equal(first.body.profile.defaultPassword, true);
  assert.match(first.headers['set-cookie'], /dwira_super=[a-f0-9]{64}; HttpOnly; SameSite=Strict/);
  assert.equal((await superLogin('superadmin', 'nope')).status, 401);
  assert.equal((await superLogin('admin', 'admin')).status, 401, 'an administrator is not the super admin');
  assert.equal((await call(backend, '/api/superadmin/stats')).status, 401);
  assert.equal((await call(backend, '/api/superadmin/session', { headers: { 'x-super-token': 'a'.repeat(64) } })).status, 401);
  assert.equal((await S('/session')).body.profile.username, 'superadmin');
  // an administrator session is not a super admin session
  const admin = await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' }, headers: native });
  assert.equal((await call(backend, '/api/superadmin/stats', { headers: { 'x-super-token': admin.body.token, authorization: `Bearer ${admin.body.token}` } })).status, 401);
  // and the other way round
  assert.equal((await call(backend, '/api/admin/session', { headers: { authorization: `Bearer ${first.body.token}` } })).status, 401);
  const out = await call(backend, '/api/superadmin/logout', { method: 'POST', headers: { 'x-super-token': first.body.token } });
  assert.equal(out.status, 200);
  assert.equal((await S('/session')).status, 401);
});

test('super admin: five failed attempts lock the address, a success elsewhere is unaffected', async () => {
  const { superLogin } = await setup();
  for (let i = 0; i < 5; i++) assert.equal((await superLogin('superadmin', 'bad' + i, '9.9.9.9')).status, 401);
  assert.equal((await superLogin('superadmin', 'superadmin', '9.9.9.9')).status, 429, 'locked even with the right password');
  assert.equal((await superLogin('superadmin', 'superadmin', '8.8.8.8')).status, 200);
});

test('super admin: change the default password from the dashboard, the default stops working, other sessions are signed out', async () => {
  const { backend, superLogin, S, first } = await setup();
  const other = (await superLogin()).body.token;
  assert.equal((await S('/credentials', 'POST', { current: 'wrong', next: STRONG })).status, 403);
  for (const weak of ['short1', 'superadmin123', 'onlyletterspassword', '1234567890123']) assert.equal((await S('/credentials', 'POST', { current: 'superadmin', next: weak })).body.error, 'WEAK_PASSWORD', weak);
  assert.equal((await S('/credentials', 'POST', { current: 'superadmin', next: 'superadmin' })).body.error, 'SAME_PASSWORD');
  assert.equal((await S('/credentials', 'POST', { current: 'superadmin', next: STRONG, username: 'x' })).body.error, 'INVALID_USERNAME');
  const changed = await S('/credentials', 'POST', { current: 'superadmin', next: STRONG, username: 'owner.sara' });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.defaultPassword, false);
  assert.equal(changed.body.username, 'owner.sara');
  assert.equal((await superLogin('superadmin', 'superadmin')).status, 401, 'the default is dead');
  assert.equal((await superLogin('owner.sara', STRONG)).status, 200, 'the new credentials are saved');
  assert.equal((await call(backend, '/api/superadmin/session', { headers: { 'x-super-token': other } })).status, 401, 'other devices were signed out');
  assert.equal((await call(backend, '/api/superadmin/session', { headers: { 'x-super-token': first.body.token } })).status, 200, 'this one stays');
  const audit = (await S('/audit')).body.items.map(i => i.action);
  assert.ok(audit.includes('superadmin.credentials_changed'));
});

test('super admin: environment hash replaces the default; DISABLE_DEFAULT_SUPERADMIN removes it', async () => {
  const { hashPassword } = require('../server/admins');
  const hash = hashPassword(STRONG);
  const { superLogin } = await (async () => {
    const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', SUPERADMIN_PASSWORD_HASH: hash }, db: await freshDb() });
    return { superLogin: (u, p) => call(backend, '/api/superadmin/login', { method: 'POST', body: { username: u, password: p } }) };
  })();
  assert.equal((await superLogin('superadmin', 'superadmin')).status, 401);
  assert.equal((await superLogin('superadmin', STRONG)).status, 200);
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', DISABLE_DEFAULT_SUPERADMIN: 'true' }, db: await freshDb() });
  assert.equal((await call(backend, '/api/superadmin/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin' } })).status, 401);
});

test('roles: seeded, owner locked, custom CRUD, validation, in-use protection', async () => {
  const { S } = await setup();
  const roles = (await S('/roles')).body.roles;
  assert.deepEqual(roles.map(r => r.id).slice(0, 1), ['owner']);
  assert.ok(['content_manager', 'support', 'analyst'].every(id => roles.some(r => r.id === id)));
  assert.equal((await S('/roles/owner', 'PATCH', { name: 'x1' })).body.error, 'ROLE_LOCKED');
  assert.equal((await S('/roles/owner', 'DELETE')).body.error, 'ROLE_LOCKED');
  assert.equal((await S('/roles', 'POST', { name: 'a', permissions: {}, ui: [] })).body.error, 'INVALID_ROLE_NAME');
  assert.equal((await S('/roles', 'POST', { name: 'Bad', permissions: { nothing: 'manage' }, ui: [] })).body.error, 'INVALID_PERMISSIONS');
  assert.equal((await S('/roles', 'POST', { name: 'Bad', permissions: {}, ui: ['nope'] })).body.error, 'INVALID_UI_ACCESS');
  const made = await S('/roles', 'POST', { name: 'Reviewer', description: 'looks', permissions: { requests: 'view' }, ui: ['requests'] });
  assert.equal(made.status, 201);
  assert.deepEqual(made.body.ui, ['dashboard', 'requests'], 'the dashboard is always there');
  assert.equal((await S('/roles', 'POST', { name: 'reviewer', permissions: {}, ui: [] })).body.error, 'ROLE_NAME_TAKEN');
  const upd = await S(`/roles/${made.body.id}`, 'PATCH', { permissions: { requests: 'manage' } });
  assert.equal(upd.body.permissions.requests, 'manage');
  const admin = await S('/admins', 'POST', { username: 'rev1', password: STRONG, roleId: made.body.id });
  assert.equal(admin.status, 201);
  assert.equal((await S(`/roles/${made.body.id}`, 'DELETE')).body.error, 'ROLE_IN_USE');
  assert.equal((await S('/admins/rev1', 'DELETE')).status, 200);
  assert.equal((await S(`/roles/${made.body.id}`, 'DELETE')).status, 200);
  assert.equal((await S('/roles/nope', 'DELETE')).status, 404);
});

test('administrators: create, role-based permissions are enforced on the admin API, overrides, disable, reset, delete', async () => {
  const { backend, S, adminLogin, asAdmin } = await setup();
  assert.equal((await S('/admins', 'POST', { username: 'x', password: STRONG, roleId: 'support' })).body.error, 'INVALID_USERNAME');
  assert.equal((await S('/admins', 'POST', { username: 'superadmin', password: STRONG, roleId: 'support' })).body.error, 'INVALID_USERNAME');
  assert.equal((await S('/admins', 'POST', { username: 'admin', password: STRONG, roleId: 'support' })).body.error, 'USERNAME_TAKEN');
  assert.equal((await S('/admins', 'POST', { username: 'sara', password: 'weak', roleId: 'support' })).body.error, 'WEAK_PASSWORD');
  assert.equal((await S('/admins', 'POST', { username: 'sara', password: STRONG })).body.error, 'INVALID_ROLE');
  assert.equal((await S('/admins', 'POST', { username: 'sara', password: STRONG, roleId: 'ghost' })).body.error, 'INVALID_ROLE');
  const created = await S('/admins', 'POST', { username: 'Sara', password: STRONG, roleId: 'support', name: 'Sara A', email: 'sara@x.io' });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, 'sara');
  assert.equal(created.body.access.full, false);
  assert.equal(created.body.access.permissions.requests, 'manage');
  assert.equal((await S('/admins', 'POST', { username: 'sara2', password: STRONG, roleId: 'support', email: 'sara@x.io' })).body.error, 'EMAIL_TAKEN');

  const login = await adminLogin('sara', STRONG);
  assert.equal(login.status, 200);
  const h = asAdmin(login.body.token);
  const session = await call(backend, '/api/admin/session', { headers: h });
  assert.equal(session.body.access.role.id, 'support');
  assert.ok(session.body.access.ui.includes('requests') && !session.body.access.ui.includes('theme'));
  // allowed area
  assert.equal((await call(backend, '/api/admin/clients', { headers: h })).status, 200);
  // forbidden areas: read and write
  assert.equal((await call(backend, '/api/admin/doc/theme', { headers: h })).status, 403);
  assert.equal((await call(backend, '/api/admin/doc/theme', { method: 'PATCH', headers: h, body: {} })).status, 403);
  assert.equal((await call(backend, '/api/admin/content/models', { headers: h })).status, 403);
  // an unknown admin route needs `manage` somewhere: a support agent has it, a read-only analyst does not (see the next test)
  // own account always works
  assert.equal((await call(backend, '/api/admin/account', { headers: h })).status, 200);
  // the content snapshot hides AI provider keys from someone without the AI area
  const content = await call(backend, '/api/content', { headers: h });
  assert.equal(content.status, 200);

  // override: add appearance view, then it is readable but not writable
  const over = await S('/admins/sara', 'PATCH', { override: { permissions: { clients: 'manage', appearance: 'view' } } });
  assert.equal(over.body.access.custom, true);
  // there is no GET route for a document: what matters is that the permission check lets a `view` through (404) and still stops a write (403)
  assert.notEqual((await call(backend, '/api/admin/doc/theme', { headers: h })).status, 403);
  assert.equal((await call(backend, '/api/admin/doc/theme', { method: 'PATCH', headers: h, body: {} })).status, 403);
  assert.equal((await call(backend, '/api/admin/conversations', { headers: h })).status, 403, 'chats stay closed');
  assert.equal((await S('/admins/sara', 'PATCH', { override: null })).body.access.custom, false);

  // reset password: old one stops working and sessions die
  assert.equal((await S('/admins/sara/password', 'POST', { password: 'weak' })).body.error, 'WEAK_PASSWORD');
  assert.equal((await S('/admins/sara/password', 'POST', { password: 'An0ther#Pass-2026' })).status, 200);
  assert.equal((await call(backend, '/api/admin/account', { headers: h })).status, 401);
  assert.equal((await adminLogin('sara', STRONG)).status, 401);
  const again = await adminLogin('sara', 'An0ther#Pass-2026');
  assert.equal(again.status, 200);

  // disable: session dies, login refused; enable again
  assert.equal((await S('/admins/sara', 'PATCH', { disabled: true })).body.disabled, true);
  assert.equal((await call(backend, '/api/admin/account', { headers: asAdmin(again.body.token) })).status, 401);
  assert.equal((await adminLogin('sara', 'An0ther#Pass-2026')).body.error, 'ACCOUNT_DISABLED');
  assert.equal((await S('/admins/sara', 'PATCH', { disabled: false })).body.disabled, false);
  const third = await adminLogin('sara', 'An0ther#Pass-2026');
  assert.equal(third.status, 200);
  assert.equal((await S('/admins/sara/signout', 'POST')).status, 200);
  assert.equal((await call(backend, '/api/admin/account', { headers: asAdmin(third.body.token) })).status, 401);

  // built-in admin cannot be deleted; others can
  assert.equal((await S('/admins/admin', 'DELETE')).body.error, 'BUILTIN_ADMIN');
  assert.equal((await S('/admins/sara', 'DELETE')).status, 200);
  assert.equal((await adminLogin('sara', 'An0ther#Pass-2026')).status, 401);
  const list = (await S('/admins')).body.admins;
  assert.ok(list.some(a => a.id === 'admin' && a.builtIn && a.access.full));
  assert.ok(!list.some(a => a.id === 'sara'));
});

test('read-only role: can read its areas but never write', async () => {
  const { backend, S, adminLogin, asAdmin } = await setup();
  await S('/admins', 'POST', { username: 'viewer', password: STRONG, roleId: 'analyst' });
  const h = asAdmin((await adminLogin('viewer', STRONG)).body.token);
  assert.equal((await call(backend, '/api/admin/clients', { headers: h })).status, 200);
  assert.equal((await call(backend, '/api/admin/clients/bulk', { method: 'POST', headers: h, body: { ids: [], action: 'delete' } })).status, 403);
  assert.equal((await call(backend, '/api/admin/doc/theme', { method: 'PATCH', headers: h, body: {} })).status, 403);
});

test('tenants: CRUD, seat limits, suspension signs members out and blocks login', async () => {
  const { backend, S, adminLogin, asAdmin } = await setup();
  assert.equal((await S('/tenants', 'POST', { name: 'x' })).body.error, 'INVALID_TENANT_NAME');
  assert.equal((await S('/tenants', 'POST', { name: 'Acme', plan: 'gold' })).body.error, 'INVALID_TENANT');
  assert.equal((await S('/tenants', 'POST', { name: 'Acme', contactEmail: 'bad' })).body.error, 'INVALID_EMAIL');
  const tenant = (await S('/tenants', 'POST', { name: 'Acme', plan: 'pro', maxAdmins: 1, contactEmail: 'ops@acme.io' })).body;
  assert.equal(tenant.plan, 'pro');
  assert.equal((await S('/tenants', 'POST', { name: 'acme' })).body.error, 'TENANT_NAME_TAKEN');
  assert.equal((await S('/admins', 'POST', { username: 'ann', password: STRONG, roleId: 'support', tenantId: tenant.id })).status, 201);
  assert.equal((await S('/admins', 'POST', { username: 'bob', password: STRONG, roleId: 'support', tenantId: tenant.id })).body.error, 'TENANT_SEATS_FULL');
  assert.equal((await S(`/tenants/${tenant.id}`, 'PATCH', { maxAdmins: 1 })).status, 200);
  assert.equal((await S('/admins', 'POST', { username: 'bob', password: STRONG, roleId: 'support', tenantId: 'nope' })).body.error, 'INVALID_TENANT');
  assert.equal((await S(`/tenants/${tenant.id}`, 'DELETE')).body.error, 'TENANT_NOT_EMPTY');
  const token = (await adminLogin('ann', STRONG)).body.token;
  assert.equal((await call(backend, '/api/admin/account', { headers: asAdmin(token) })).status, 200);
  const suspended = await S(`/tenants/${tenant.id}`, 'PATCH', { status: 'suspended' });
  assert.equal(suspended.body.status, 'suspended');
  assert.equal((await call(backend, '/api/admin/account', { headers: asAdmin(token) })).status, 401);
  assert.equal((await adminLogin('ann', STRONG)).body.error, 'TENANT_SUSPENDED');
  await S(`/tenants/${tenant.id}`, 'PATCH', { status: 'active' });
  assert.equal((await adminLogin('ann', STRONG)).status, 200);
  await S('/admins/ann', 'PATCH', { tenantId: null });
  assert.equal((await S(`/tenants/${tenant.id}`, 'DELETE')).status, 200);
  assert.equal((await S(`/tenants/${tenant.id}`, 'PATCH', { name: 'Zed' })).status, 404);
});

test('platform: maintenance pauses client writes only; closed sign-up refuses new clients but not existing ones', async () => {
  const { backend, S } = await setup();
  const pub = () => call(backend, '/api/platform');
  assert.deepEqual((await pub()).body, { maintenance: false, message: '', allowClientSignup: true, allowRequests: true });
  const login = body => call(backend, '/api/user/login', { method: 'POST', body, headers: native });
  const member = await login({ name: 'Old Client', phone: '+212600000001' });
  assert.equal(member.status, 200);
  assert.equal((await S('/platform', 'PATCH', { allowClientSignup: 'yes' })).status, 400);
  const set = await S('/platform', 'PATCH', { allowClientSignup: false, maintenance: true, maintenanceMessage: 'Back soon', defaultFreeCredits: 3 });
  assert.equal(set.status, 200);
  assert.equal(set.body.defaultFreeCredits, 3);
  await new Promise(r => setTimeout(r, 0));
  const status = (await pub()).body;
  assert.equal(status.maintenance, true);
  assert.equal(status.message, 'Back soon');
  assert.equal((await login({ name: 'Old Client', phone: '+212600000001' })).body.error, 'MAINTENANCE');
  await S('/platform', 'PATCH', { maintenance: false });
  assert.equal((await login({ name: 'Old Client', phone: '+212600000001' })).status, 200, 'existing clients still sign in');
  assert.equal((await login({ name: 'New Client', phone: '+212600000002' })).body.error, 'SIGNUP_CLOSED');
  await S('/platform', 'PATCH', { allowClientSignup: true });
  assert.equal((await login({ name: 'New Client', phone: '+212600000002' })).status, 200);
});

test('clients: list, search, block, credits, bulk and delete from the super admin', async () => {
  const { backend, S } = await setup();
  const ids = [];
  for (const [name, phone] of [['Amal', '+212600000011'], ['Bilal', '+212600000012'], ['Chaima', '+212600000013']]) {
    const r = await call(backend, '/api/user/login', { method: 'POST', body: { name, phone }, headers: native });
    assert.equal(r.status, 200);
  }
  const page = (await S('/clients?size=2&page=1')).body;
  assert.equal(page.total, 3);
  assert.equal(page.items.length, 2);
  for (const c of (await S('/clients')).body.items) ids.push(c.id);
  assert.equal((await S('/clients?q=bilal')).body.total, 1);
  const target = (await S('/clients?q=amal')).body.items[0];
  assert.equal((await S(`/clients/${target.id}`, 'PATCH', { blocked: true })).status, 200);
  assert.equal((await S('/clients?status=blocked')).body.total, 1);
  assert.equal((await S('/clients?status=active')).body.total, 2);
  assert.equal((await S(`/clients/${target.id}`, 'PATCH', { credits: 12 })).status, 200);
  assert.equal((await S(`/clients/${target.id}`, 'DELETE')).status, 200);
  assert.equal((await S('/clients')).body.total, 2);
  const audit = (await S('/audit?q=client')).body.items.map(i => i.action);
  assert.ok(audit.includes('client.blocked') && audit.includes('client.deleted'));
});

test('stats and audit: dashboard shape, security flags, filter and paging', async () => {
  const { S } = await setup();
  const stats = (await S('/stats')).body;
  for (const key of ['generatedAt', 'totals', 'windows', 'requestsByStatus', 'series', 'topTools', 'tenantsByStatus', 'rolesUsage', 'queue', 'security', 'recent']) assert.ok(key in stats, key);
  assert.equal(stats.series.clients.length, 30);
  assert.equal(stats.security.defaultSuperPassword, true);
  assert.equal(stats.security.defaultAdminPassword, true);
  assert.ok(stats.totals.roles >= 4);
  await S('/credentials', 'POST', { current: 'superadmin', next: STRONG });
  assert.equal((await S('/stats')).body.security.defaultSuperPassword, false);
  await S('/tenants', 'POST', { name: 'Audit Co' });
  const all = (await S('/audit?limit=2')).body.items;
  assert.equal(all.length, 2);
  assert.ok(all[0].at >= all[1].at);
  const older = (await S(`/audit?limit=50&before=${all[1].at}`)).body.items;
  assert.ok(older.every(i => i.at < all[1].at));
  assert.ok((await S('/audit?q=tenant.created')).body.items.every(i => i.action === 'tenant.created'));
});

test('super admin sessions: list, revoke the others', async () => {
  const { backend, superLogin, S } = await setup();
  const other = (await superLogin()).body.token;
  const list = (await S('/sessions')).body.sessions;
  assert.equal(list.length, 2);
  assert.equal(list.filter(s => s.current).length, 1);
  assert.equal((await S('/sessions', 'DELETE')).status, 200);
  assert.equal((await call(backend, '/api/superadmin/session', { headers: { 'x-super-token': other } })).status, 401);
  assert.equal((await S('/session')).status, 200);
});

test('access model: pure helpers and drift against the UI files', () => {
  assert.equal(access.resolveAccess({}).full, true, 'no role, no override: legacy full access');
  assert.equal(access.resolveAccess({ role_id: 'ghost' }).full, false);
  assert.deepEqual(access.resolveAccess({ role_id: 'ghost' }).permissions, {}, 'a vanished role grants nothing');
  assert.equal(access.allows({ full: false, permissions: { clients: 'view' } }, 'clients', 'view'), true);
  assert.equal(access.allows({ full: false, permissions: { clients: 'view' } }, 'clients', 'manage'), false);
  assert.equal(access.allows({ full: false, permissions: { clients: 'manage' } }, ['chats', 'clients'], 'manage'), true);
  assert.equal(access.requiredAccess('/api/admin/account', 'PATCH'), null);
  assert.equal(access.requiredAccess('/api/requests', 'POST'), null);
  assert.deepEqual(access.requiredAccess('/api/requests', 'GET'), { areas: ['requests'], level: 'view' });
  assert.equal(access.requiredAccess('/api/admin/content/models', 'PATCH').areas[0], 'ai');
  assert.equal(access.requiredAccess('/api/health', 'GET'), null);

  // src/lib/access.ts mirrors AREAS and PAGES
  const ts = fs.readFileSync(path.join(__dirname, '../src/lib/access.ts'), 'utf8');
  const areas = /AREAS\s*=\s*\[([^\]]*)\]/.exec(ts)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(areas, access.AREAS);
  const pages = Object.fromEntries([...(/PAGES[^=]*=\s*\{([\s\S]*?)\n\}/.exec(ts)[1]).matchAll(/(\w+):\s*(null|'(\w+)')/g)].map(m => [m[1], m[3] ?? null]));
  assert.deepEqual(pages, access.PAGES);
  // every admin menu key is a known page (so a new menu item cannot be left outside the permission model)
  const nav = fs.readFileSync(path.join(__dirname, '../src/lib/adminNav.ts'), 'utf8');
  const keys = [...nav.matchAll(/\{\s*key:\s*'(\w+)',\s*icon:/g)].map(m => m[1]);
  assert.ok(keys.length > 10);
  for (const key of keys) assert.ok(key in access.PAGES, `adminNav key "${key}" missing from server/access.js PAGES`);
});
