/**
 * Super admin, demos, store themes, hand-off and ownership (docs/MULTI_TENANT_PLAN.md phases 4-6), driven through the real request handler.
 * The leak matrix at the bottom proves a tenant can neither reach the platform API nor read / write another tenant's data or requests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { hashPassword } = require('../server/admins');
const { freshDb, closeShared } = require('./test-db');

const SUPER = { email: 'boss@platform.test', password: 'Platform-Secret-123' };
const ENV = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '2000', STATIC_DIR: path.join(__dirname, 'no-such-dist'), SUPERADMIN_EMAIL: SUPER.email, SUPERADMIN_PASSWORD_HASH: hashPassword(SUPER.password) };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
test.after(closeShared);

function call(backend, url, { method = 'GET', body, headers = {}, host = 'app.test', ip = 'sa-test' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host, ...headers }, socket: { remoteAddress: ip } });
    const out = { headers: {} };
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => {
      const text = Buffer.concat(chunks).toString();
      try { out.body = text ? JSON.parse(text) : undefined; } catch { out.text = text; }
      resolve(out);
    });
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const bearer = token => ({ authorization: `Bearer ${token}` });

async function setup() {
  const db = await freshDb();
  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline } });
  await backend.db.query('select 1');
  // freshDb() truncates the registry: put back the row the migration creates in every real database.
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: native, body: SUPER });
  assert.equal(signin.status, 200, JSON.stringify(signin.body));
  const sa = { 'x-super-token': signin.body.token };
  const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { ...sa, ...(opts.headers || {}) } });
  return { db, backend, sa, api };
}
async function tenantLogin(backend, slug, email, password) {
  const r = await call(backend, `/${slug}/api/admin/login`, { method: 'POST', headers: native, body: { email, password } });
  assert.equal(r.status, 200, `login ${slug}: ${JSON.stringify(r.body)}`);
  return { ...bearer(r.body.token), ...native };
}
const newTenant = async (api, slug, extra = {}) => {
  const r = await api('/tenants', { method: 'POST', body: { name: `Shop ${slug}`, slug, ownerEmail: `owner@${slug}.test`, ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
};

test('super admin login: factory login superadmin / superadmin, wrong password -> 401 and locks after 5, tenant tokens never open it', async () => {
  const db = await freshDb();
  // No SUPERADMIN_* variables at all: the console still works with the factory login (it is never "not configured").
  const factory = createBackend({ env: { ...ENV, SUPERADMIN_EMAIL: '', SUPERADMIN_PASSWORD_HASH: '' }, db, media: { storage: null, download: offline } });
  await factory.db.query('select 1');
  assert.equal((await call(factory, '/api/super-admin/tenants')).status, 401, 'no session');
  const bad = await call(factory, '/api/super-admin/login', { method: 'POST', body: { email: 'superadmin', password: 'nope' } });
  assert.equal(bad.status, 401);
  const first = await call(factory, '/api/super-admin/login', { method: 'POST', headers: native, body: { email: 'SuperAdmin', password: 'superadmin' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.isDefault, true, 'flagged as factory credentials');
  const session = await call(factory, '/api/super-admin/session', { headers: { 'x-super-token': first.body.token } });
  assert.deepEqual([session.status, session.body.email, session.body.isDefault], [200, 'superadmin', true]);
  assert.equal((await call(factory, '/api/super-admin/tenants', { headers: { 'x-super-token': first.body.token } })).status, 200);
  // The row is stored in the database (so Neon keeps it across deployments).
  const row = (await db.query('SELECT email, pw_changed_at FROM saas_super'))[0];
  assert.deepEqual([row.email, row.pw_changed_at], ['superadmin', null]);

  await db.query('TRUNCATE saas_super, saas_super_sessions');
  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline } });
  await backend.db.query('select 1');
  assert.equal((await call(backend, '/api/super-admin/tenants')).status, 401, 'no session');
  // The optional environment seed replaces the factory login on first use.
  assert.equal((await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'x', body: { email: 'superadmin', password: 'superadmin' } })).status, 401, 'seed wins over the factory login');
  // The built-in admin / admin of the default tenant is NOT a super admin.
  const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  assert.equal(admin.status, 200);
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: bearer(admin.body.token) })).status, 401, 'a tenant admin session cannot open the platform API');
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: { 'x-super-token': admin.body.token } })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'attacker', body: { email: SUPER.email, password: 'wrong-password' } })).status, 401);
  assert.equal((await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'attacker', body: SUPER })).status, 429, 'locked even with the right password');
  const ok = await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'friend', body: SUPER });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isDefault, false, 'a seeded password is a real credential');
  assert.match(ok.headers['set-cookie'], /dwira_super=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/api/);
  // The super admin API is never reachable under a slug or a custom domain.
  const { api } = await setup();
  await newTenant(api, 'shopone');
  assert.equal((await call(backend, '/shopone/api/super-admin/login', { method: 'POST', body: SUPER })).status, 404);
});

test('super admin settings: change e-mail and password (stored in the database), old login stops, other sessions end, reset restores the factory login', async () => {
  const db = await freshDb();
  const env = { ...ENV, SUPERADMIN_EMAIL: '', SUPERADMIN_PASSWORD_HASH: '' };
  const backend = createBackend({ env, db, media: { storage: null, download: offline } });
  await backend.db.query('select 1');
  const signin = async (email, password, ip = 'owner') => call(backend, '/api/super-admin/login', { method: 'POST', ip, headers: native, body: { email, password } });
  const a = (await signin('superadmin', 'superadmin')).body.token, b = (await signin('superadmin', 'superadmin')).body.token;
  const as = token => ({ 'x-super-token': token });
  const patch = (token, body) => call(backend, '/api/super-admin/account', { method: 'PATCH', headers: as(token), body });
  assert.deepEqual((await call(backend, '/api/super-admin/account', { headers: as(a) })).body.isDefault, true);

  assert.equal((await patch(a, { currentPassword: 'wrong', newPassword: 'Brand-New-Pass-77' })).status, 403, 'the current password is required');
  assert.equal((await patch(a, { currentPassword: 'superadmin' })).status, 400, 'nothing to change');
  for (const weak of ['superadmin', 'short', 'password1', 'SUPERADMIN']) assert.equal((await patch(a, { currentPassword: 'superadmin', newPassword: weak })).status, 400, weak);
  assert.equal((await patch(a, { currentPassword: 'superadmin', email: 'bad login!' })).status, 400);
  assert.equal((await patch(null, { currentPassword: 'superadmin', newPassword: 'x' })).status, 401, 'needs a session');

  const changed = await patch(a, { currentPassword: 'superadmin', email: 'Owner@Example.com', newPassword: 'Brand-New-Pass-77' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual([changed.body.email, changed.body.isDefault], ['owner@example.com', false]);
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: as(a) })).status, 200, 'the session that changed it stays signed in');
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: as(b) })).status, 401, 'other sessions are signed out');
  assert.equal((await signin('superadmin', 'superadmin', 'ip2')).status, 401, 'factory login stops working');
  assert.equal((await signin('owner@example.com', 'superadmin', 'ip3')).status, 401);
  const again = await signin('owner@example.com', 'Brand-New-Pass-77', 'ip4');
  assert.equal(again.status, 200);
  assert.equal(again.body.isDefault, false);

  // A password-only change keeps the e-mail; an e-mail-only change keeps the password.
  assert.equal((await patch(again.body.token, { currentPassword: 'Brand-New-Pass-77', email: 'boss@example.com' })).status, 200);
  assert.equal((await signin('boss@example.com', 'Brand-New-Pass-77', 'ip5')).status, 200);
  // A new backend over the same database (= a new deployment on the same Neon): the stored account is still the source of truth.
  const redeployed = createBackend({ env: { ...ENV, SUPERADMIN_EMAIL: 'seed@env.test', SUPERADMIN_PASSWORD_HASH: hashPassword('Seed-Pass-99') }, db, media: { storage: null, download: offline } });
  await redeployed.db.query('select 1');
  assert.equal((await call(redeployed, '/api/super-admin/login', { method: 'POST', ip: 'ip6', body: { email: 'seed@env.test', password: 'Seed-Pass-99' } })).status, 401, 'an environment seed never overrides a saved account');
  assert.equal((await call(redeployed, '/api/super-admin/login', { method: 'POST', ip: 'ip7', body: { email: 'boss@example.com', password: 'Brand-New-Pass-77' } })).status, 200);
  // The change is audited, never with the secret.
  const audit = await call(backend, '/api/super-admin/audit', { headers: as(again.body.token) });
  assert.ok(audit.body.some(row => row.action === 'super.account.update' && row.detail === 'email+password'));
  assert.ok(!JSON.stringify(audit.body).includes('Brand-New-Pass-77'));

  // Lost password: the server-side reset goes back to superadmin / superadmin and ends every session.
  await backend.superAdmin.resetToDefault();
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: as(again.body.token) })).status, 401);
  const reset = await signin('superadmin', 'superadmin', 'ip8');
  assert.equal(reset.status, 200);
  assert.equal(reset.body.isDefault, true);
});

test('tenants: create (reserved / duplicate slugs refused), edit, suspend / unsuspend, delete needs the slug typed back', async () => {
  const { api, backend, db } = await setup();
  for (const slug of ['admin', 'api', 'super-admin', 'x', 'Bad Slug']) assert.equal((await api('/tenants', { method: 'POST', body: { name: 'Nope', slug, ownerEmail: 'a@b.co' } })).status, 400, slug);
  const created = await newTenant(api, 'acme-shop', { plan: 'pro' });
  assert.equal(created.tenant.slug, 'acme-shop');
  assert.equal(created.tenant.adminPath, '/acme-shop/admin');
  assert.ok(created.admin.password && created.admin.password.length >= 12, 'a password is generated and shown once');
  assert.equal((await api('/tenants', { method: 'POST', body: { name: 'Again', slug: 'acme-shop', ownerEmail: 'a@b.co' } })).status, 409);
  const id = created.tenant.id;

  // The new admin can sign in on their own storefront only, and sees the starter content.
  const cookie = await tenantLogin(backend, 'acme-shop', 'owner@acme-shop.test', created.admin.password);
  assert.equal((await call(backend, '/acme-shop/api/admin/session', { headers: cookie })).status, 200);
  assert.equal((await call(backend, '/api/admin/session', { headers: cookie })).status, 401, 'the same token on the default tenant is rejected');
  const content = await call(backend, '/acme-shop/api/content');
  assert.ok(content.body.collections.tools.length > 0);

  assert.equal((await api(`/tenants/${id}`, { method: 'PATCH', body: { name: 'Acme Renamed', plan: 'team' } })).body.name, 'Acme Renamed');
  assert.equal((await api(`/tenants/${id}`, { method: 'PATCH', body: { status: 'suspended' } })).status, 400, 'suspension has its own action');
  assert.equal((await api('/tenants/default', { method: 'PATCH', body: { slug: 'renamed' } })).status, 400);
  assert.equal((await api('/tenants/default/suspend', { method: 'POST', body: {} })).status, 400);

  assert.equal((await api(`/tenants/${id}/suspend`, { method: 'POST', body: {} })).body.status, 'suspended');
  const frozen = await call(backend, '/acme-shop/api/content');
  assert.equal(frozen.status, 403);
  assert.equal(frozen.body.code, 'TENANT_SUSPENDED');
  assert.equal((await call(backend, '/acme-shop/admin')).status, 503);
  assert.equal((await api(`/tenants/${id}/unsuspend`, { method: 'POST', body: {} })).body.status, 'active');
  assert.equal((await call(backend, '/acme-shop/api/content')).status, 200);

  // Slug rename keeps the old slug reserved.
  assert.equal((await api(`/tenants/${id}`, { method: 'PATCH', body: { slug: 'acme-new' } })).body.slug, 'acme-new');
  assert.equal((await call(backend, '/acme-shop/api/content')).status, 404);
  assert.equal((await api('/tenants', { method: 'POST', body: { name: 'Squatter', slug: 'acme-shop', ownerEmail: 'a@b.co' } })).status, 409, 'retired slug cannot be taken for 30 days');

  // Delete: wrong confirmation refused, right one removes every row of the tenant and nothing else.
  await call(backend, '/acme-new/api/user/login', { method: 'POST', headers: native, body: { name: 'Visitor', phone: '0661000055' } });
  assert.equal((await api(`/tenants/${id}`, { method: 'DELETE', body: { confirmSlug: 'wrong' } })).status, 400);
  assert.equal((await api(`/tenants/${id}`, { method: 'DELETE', body: { confirmSlug: 'acme-new' } })).status, 200);
  for (const table of ['clients', 'content_items', 'admin_accounts', 'sync_state', 'settings', 'content_docs']) {
    assert.equal(Number((await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id=$1`, [id]))[0].n), 0, `${table} purged`);
  }
  assert.equal((await call(backend, '/acme-new/api/content')).status, 404);
  const log = (await api('/audit')).body.map(row => row.action);
  for (const action of ['super.login', 'tenant.create', 'tenant.update', 'tenant.suspend', 'tenant.unsuspend', 'tenant.delete']) assert.ok(log.includes(action), action);
});

test('tenant administrators: add, disable (sessions end), reset password, delete', async () => {
  const { api, backend } = await setup();
  const { tenant, admin } = await newTenant(api, 'adminshop');
  const cookie = await tenantLogin(backend, 'adminshop', 'owner@adminshop.test', admin.password);
  const extra = await api(`/tenants/${tenant.id}/admins`, { method: 'POST', body: { email: 'second@adminshop.test', name: 'Second', password: 'weak' } });
  assert.equal(extra.status, 400, 'weak password refused');
  const second = await api(`/tenants/${tenant.id}/admins`, { method: 'POST', body: { email: 'second@adminshop.test', name: 'Second' } });
  assert.equal(second.status, 201);
  assert.equal((await api(`/tenants/${tenant.id}/admins`, { method: 'POST', body: { email: 'second@adminshop.test' } })).status, 409);
  assert.equal((await api(`/tenants/${tenant.id}/admins`)).body.length, 2);

  assert.equal((await api(`/tenants/${tenant.id}/admins/owner%40adminshop.test`, { method: 'PATCH', body: { disabled: true } })).body.disabled, true);
  assert.equal((await call(backend, '/adminshop/api/admin/session', { headers: cookie })).status, 401, 'a disabled administrator is signed out at once');
  assert.equal((await call(backend, '/adminshop/api/admin/login', { method: 'POST', headers: native, body: { email: 'owner@adminshop.test', password: admin.password } })).status, 401);
  await api(`/tenants/${tenant.id}/admins/owner%40adminshop.test`, { method: 'PATCH', body: { disabled: false } });
  const reset = await api(`/tenants/${tenant.id}/admins/owner%40adminshop.test/password`, { method: 'POST', body: {} });
  assert.ok(reset.body.password);
  assert.equal((await call(backend, '/adminshop/api/admin/login', { method: 'POST', headers: native, body: { email: 'owner@adminshop.test', password: admin.password } })).status, 401, 'old password dead');
  await tenantLogin(backend, 'adminshop', 'owner@adminshop.test', reset.body.password);
  assert.equal((await api(`/tenants/${tenant.id}/admins/second%40adminshop.test`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/tenants/${tenant.id}/admins`)).body.length, 1);
});

test('demos: a demo is a template tenant with sample data; assigning it creates an independent instance; instance edits never touch the demo', async () => {
  const { api, backend, db } = await setup();
  const made = await api('/demos', { method: 'POST', body: { name: 'Boutique Demo', description: 'Showroom' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const demo = made.body.demo;
  assert.equal(demo.slug, 'demo-boutique-demo');
  assert.equal(demo.status, 'draft');
  assert.match(made.body.admin.password, /./);

  // Storefront + admin dashboard + sample data exist for the template.
  assert.ok((await call(backend, `/${demo.slug}/api/content`)).body.collections.tools.length > 0);
  const demoCookie = await tenantLogin(backend, demo.slug, made.body.admin.id, made.body.admin.password);
  const sampleRequests = await call(backend, `/${demo.slug}/api/requests`, { headers: demoCookie });
  assert.equal(sampleRequests.body.length, 5);
  assert.equal((await call(backend, `/${demo.slug}/api/admin/clients`, { headers: demoCookie })).body.length, 4);
  // Demos are not listed with the real tenants.
  assert.ok(!(await api('/tenants')).body.some(t => t.id === demo.tenantId));
  assert.ok((await api('/tenants?kind=demo')).body.some(t => t.id === demo.tenantId));

  // The Super Admin customises the template (a doc + an item), then assigns it twice, to two different owners.
  assert.equal((await call(backend, `/${demo.slug}/api/admin/doc/branding`, { method: 'PATCH', headers: demoCookie, body: { appName: 'Template Brand' } })).status, 200);
  const first = await api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'client-one', owner: { email: 'one@client.test', name: 'One' } } });
  const second = await api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'client-two', owner: { email: 'two@client.test' } } });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201);
  assert.notEqual(first.body.tenant.id, second.body.tenant.id);
  assert.notEqual(first.body.tenant.id, demo.tenantId);
  assert.equal(first.body.tenant.kind, 'instance');
  assert.equal(first.body.tenant.sourceDemoId, demo.id);

  const one = await tenantLogin(backend, 'client-one', 'one@client.test', first.body.admin.password);
  const two = await tenantLogin(backend, 'client-two', 'two@client.test', second.body.admin.password);
  // The copy carries the template's content and sample data, re-keyed.
  assert.equal((await call(backend, '/client-one/api/content')).body.docs.branding.appName, 'Template Brand');
  const oneRequests = (await call(backend, '/client-one/api/requests', { headers: one })).body;
  assert.equal(oneRequests.length, 5);
  const templateRequestIds = new Set(sampleRequests.body.map(r => r.id));
  assert.ok(oneRequests.every(r => !templateRequestIds.has(r.id)), 'sample requests have NEW ids in the instance');
  const oneClientIds = new Set((await call(backend, '/client-one/api/admin/clients', { headers: one })).body.map(c => c.id));
  assert.ok(oneRequests.every(r => oneClientIds.has(r.userId)), 'instance requests point at the instance clients');
  // Credentials do not cross: the demo admin cannot open an instance, and an instance owner cannot open the demo.
  assert.equal((await call(backend, '/client-one/api/admin/session', { headers: demoCookie })).status, 401);
  assert.equal((await call(backend, `/${demo.slug}/api/admin/session`, { headers: one })).status, 401);

  // Edit instance one: content, a doc, delete a tool, add a client and a request. Nothing may change in the demo or in instance two.
  const snapshot = async slug => JSON.stringify((await call(backend, `/${slug}/api/content`)).body.collections) + JSON.stringify((await call(backend, `/${slug}/api/content`)).body.docs);
  const demoBefore = await snapshot(demo.slug), twoBefore = await snapshot('client-two');
  const tools = (await call(backend, '/client-one/api/content')).body.collections.tools;
  assert.equal((await call(backend, '/client-one/api/admin/content/tools', { method: 'DELETE', headers: one, body: { ids: [tools[0].id] } })).status, 200);
  assert.equal((await call(backend, '/client-one/api/admin/doc/branding', { method: 'PATCH', headers: one, body: { appName: 'Client One Only' } })).status, 200);
  assert.equal((await call(backend, '/client-one/api/user/login', { method: 'POST', headers: native, body: { name: 'New Lead', phone: '0661999999' } })).status, 200);
  assert.equal(await snapshot(demo.slug), demoBefore, 'the demo template is untouched');
  assert.equal(await snapshot('client-two'), twoBefore, 'the other instance is untouched');
  assert.equal((await call(backend, `/${demo.slug}/api/admin/clients`, { headers: demoCookie })).body.length, 4);
  assert.equal((await call(backend, '/client-two/api/requests', { headers: two })).body.length, 5);
  assert.equal((await call(backend, '/client-two/api/content')).body.docs.branding.appName, 'Template Brand');

  // And the other direction: editing the template afterwards does not change existing instances.
  await call(backend, `/${demo.slug}/api/admin/doc/branding`, { method: 'PATCH', headers: demoCookie, body: { appName: 'Template v2' } });
  assert.equal((await call(backend, '/client-two/api/content')).body.docs.branding.appName, 'Template Brand');

  // No foreign key or shared row: the instance has its own sync counters, and rows are disjoint by tenant_id.
  const shared = await db.query("SELECT 1 FROM content_docs a JOIN content_docs b ON a.name=b.name AND a.tenant_id<>b.tenant_id AND a.data<>b.data WHERE a.tenant_id=$1 AND b.tenant_id=$2 AND a.name='branding' LIMIT 1", [first.body.tenant.id, second.body.tenant.id]);
  assert.ok(shared.length > 0, 'the two instances really diverged (the check above is not vacuous)');

  const assignments = (await api(`/demos/${demo.id}/assignments`)).body;
  assert.deepEqual(assignments.map(a => a.slug).sort(), ['client-one', 'client-two']);
  assert.equal((await api(`/demos/${demo.id}`)).body.assignments, 2);

  // Deleting the demo does not delete its instances.
  assert.equal((await api(`/demos/${demo.id}`, { method: 'DELETE', body: { confirmSlug: 'nope' } })).status, 400);
  assert.equal((await api(`/demos/${demo.id}`, { method: 'DELETE', body: { confirmSlug: demo.slug } })).status, 200);
  assert.equal((await call(backend, `/${demo.slug}/api/content`)).status, 404);
  assert.equal((await call(backend, '/client-one/api/content')).body.docs.branding.appName, 'Client One Only');
  assert.equal((await call(backend, '/client-one/api/requests', { headers: one })).body.length, 5);
});

test('assigning to an EXISTING admin re-uses their login; AI provider keys never travel from the template into an instance', async () => {
  const { api, backend, db } = await setup();
  const owner = await newTenant(api, 'ownerhome', { ownerEmail: 'boss@ownerhome.test' });
  const { demo, admin: demoAdmin } = (await api('/demos', { method: 'POST', body: { name: 'Keys Demo' } })).body;
  const cookie = await tenantLogin(backend, demo.slug, demoAdmin.id, demoAdmin.password);
  // Put a provider key into the template: in a model entry and in the image-keys setting.
  const models = (await call(backend, `/${demo.slug}/api/admin/content/models`, { headers: cookie })).status;
  await call(backend, `/${demo.slug}/api/admin/content/models/m-secret`, { method: 'PUT', headers: cookie, body: { name: 'Secret model', provider: 'x', apiKey: 'sk-TEMPLATE-SECRET-123456' } });
  await db.query("INSERT INTO settings(tenant_id,key,value) VALUES($1,'image_keys',$2),($1,'vapid','{\"priv\":1}'),($1,'image_rotation','{}')", [demo.tenantId, JSON.stringify({ pollinations: 'sk-IMAGE-SECRET-123456' })]);
  assert.ok(models !== undefined);

  const given = await api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'for-boss', owner: { tenantId: owner.tenant.id, adminId: 'boss@ownerhome.test' } } });
  assert.equal(given.status, 201, JSON.stringify(given.body));
  assert.equal(given.body.admin.password, null, 'no new password: the existing one is re-used');
  await tenantLogin(backend, 'for-boss', 'boss@ownerhome.test', owner.admin.password);

  const copied = (await db.query("SELECT data FROM content_items WHERE tenant_id=$1 AND coll='models' AND id='m-secret'", [given.body.tenant.id]))[0];
  assert.ok(copied, 'the model entry was copied');
  assert.equal(JSON.parse(copied.data).apiKey, '', 'but not its key');
  const keys = (await db.query("SELECT key FROM settings WHERE tenant_id=$1", [given.body.tenant.id])).map(r => r.key);
  for (const secret of ['image_keys', 'vapid', 'image_rotation']) assert.ok(!keys.includes(secret), `${secret} is not copied`);
  const dump = JSON.stringify(await db.query('SELECT * FROM settings WHERE tenant_id=$1', [given.body.tenant.id])) + JSON.stringify(await db.query('SELECT data FROM content_items WHERE tenant_id=$1', [given.body.tenant.id]));
  assert.ok(!dump.includes('SECRET'), 'no secret string anywhere in the instance');
});

test('store themes: a UI-only snapshot of the SELECTED tenants; a new demo starts from it; no client data, key or admin travels', async () => {
  const { api, backend, db } = await setup();
  const a = await newTenant(api, 'theme-a'), b = await newTenant(api, 'theme-b'), c = await newTenant(api, 'theme-c');
  const ca = await tenantLogin(backend, 'theme-a', 'owner@theme-a.test', a.admin.password);
  // Store A gets its own look, a secret model key and a real client; B and C stay default.
  await call(backend, '/theme-a/api/admin/doc/theme', { method: 'PATCH', headers: ca, body: { active: 'emerald' } });
  await call(backend, '/theme-a/api/admin/doc/branding', { method: 'PATCH', headers: ca, body: { appName: 'Emerald Atelier' } });
  await call(backend, '/theme-a/api/admin/doc/settings', { method: 'PATCH', headers: ca, body: { arabicFont: 'Cairo', notifyAdmins: false, defaultFreeCredits: 9 } });
  await call(backend, '/theme-a/api/admin/content/models/mdl_secret', { method: 'PUT', headers: ca, body: { name: 'Secret', provider: 'X', modelName: 'x', apiKey: 'SUPERSECRETKEY', enabled: true } });
  await db.query("INSERT INTO clients(tenant_id,id,phone,name,credits,free_used,created_at) VALUES($1,'client-a-1','+212611111111','Real Customer',1,0,1)", [a.tenant.id]);

  assert.equal((await api('/themes', { method: 'POST', body: { tenantIds: [] } })).status, 400, 'a tenant must be selected');
  assert.equal((await api('/themes', { method: 'POST', body: { tenantIds: ['nope'] } })).status, 404);
  const made = await api('/themes', { method: 'POST', body: { tenantIds: [a.tenant.id, b.tenant.id] } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.length, 2, 'only the two selected stores; C is not a theme');
  const themeA = made.body.find(t => t.sourceTenantId === a.tenant.id);
  assert.equal(themeA.preview.appName, 'Emerald Atelier');
  assert.equal(themeA.preview.themeId, 'emerald');
  assert.equal(themeA.preview.dark, true);
  assert.equal(themeA.preview.colors.primary, '#34D399');
  assert.ok(themeA.counts.tools >= 1 && themeA.preview.tools.length >= 1);
  const stored = (await db.query('SELECT snapshot FROM saas_themes WHERE id=$1', [themeA.id]))[0].snapshot;
  for (const word of ['SUPERSECRETKEY', 'Real Customer', '+212611111111', 'owner@theme-a.test', 'pw_hash', 'notifyAdmins', 'defaultFreeCredits']) assert.ok(!stored.includes(word), `${word} must not be in a theme`);
  assert.ok(stored.includes('"arabicFont":"Cairo"'), 'font choice travels');
  assert.ok(!JSON.stringify((await api('/themes')).body).includes('SUPERSECRETKEY'));
  assert.equal((await api('/themes')).body.length, 2);

  // A demo created from the theme shows the theme's look, with its own (empty of client data) store. It has no credit limit.
  const created = await api('/demos', { method: 'POST', body: { name: 'Emerald Demo', themeId: themeA.id } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.demo.creditLimit, undefined);
  const content = (await call(backend, `/${created.body.demo.slug}/api/content`)).body;
  assert.equal(content.docs.theme.active, 'emerald');
  assert.equal(content.docs.branding.appName, 'Emerald Atelier');
  assert.equal(content.docs.settings.arabicFont, 'Cairo');
  assert.equal(content.docs.settings.defaultFreeCredits, 1, 'behaviour settings are not part of a theme');
  assert.ok(!JSON.stringify(content).includes('SUPERSECRETKEY'));
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM clients WHERE tenant_id=$1 AND phone='+212611111111'", [created.body.demo.tenantId]))[0].n, 0, 'no client of the source store');
  assert.equal((await api('/demos', { method: 'POST', body: { name: 'Bad Theme Demo', themeId: 'th_000000000000' } })).status, 404, 'unknown theme is refused before anything is created');
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM saas_demos WHERE name IN ('Bad Theme Demo')"))[0].n, 0);
  // A theme is a snapshot: later edits to the source do not move it, until it is refreshed.
  await call(backend, '/theme-a/api/admin/doc/branding', { method: 'PATCH', headers: ca, body: { appName: 'Renamed Later' } });
  assert.equal((await api(`/themes/${themeA.id}`)).body.preview.appName, 'Emerald Atelier');
  assert.equal((await api(`/themes/${themeA.id}/refresh`, { method: 'POST' })).body.preview.appName, 'Renamed Later');
  assert.equal((await api(`/themes/${themeA.id}`, { method: 'PATCH', body: { name: 'Emerald v2' } })).body.name, 'Emerald v2');
  // Deleting the theme or its source never touches demos made from it.
  assert.equal((await api(`/themes/${themeA.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await api(`/themes/${themeA.id}`)).status, 404);
  assert.equal((await call(backend, `/${created.body.demo.slug}/api/content`)).body.docs.branding.appName, 'Emerald Atelier');
  assert.ok((await api('/audit')).body.some(row => row.action === 'theme.create'));
  // A tenant admin cannot list or create themes.
  assert.ok([401, 404].includes((await call(backend, '/api/super-admin/themes', { headers: ca })).status));
});

test('hand-off: the console opens a store admin with a one-time code, no second login; the code is bound to that store and dies after one use', async () => {
  const { api, backend } = await setup();
  const a = await newTenant(api, 'hand-a'), b = await newTenant(api, 'hand-b');
  const made = await api(`/tenants/${a.tenant.id}/handoff`, { method: 'POST', body: {} });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.match(made.body.code, /^[a-f0-9]{64}$/);
  assert.ok(made.body.url.startsWith('/hand-a/admin/login?handoff='), made.body.url);
  // The wrong store refuses it, and that burns it.
  assert.equal((await call(backend, '/hand-b/api/admin/handoff', { method: 'POST', headers: native, body: { code: made.body.code } })).status, 401);
  assert.equal((await call(backend, '/hand-a/api/admin/handoff', { method: 'POST', headers: native, body: { code: made.body.code } })).status, 401, 'a code used on the wrong store is spent');
  // The right store accepts a fresh one exactly once and returns a working admin session.
  const fresh = (await api(`/tenants/${a.tenant.id}/handoff`, { method: 'POST', body: { next: '/admin/theme' } })).body;
  assert.ok(fresh.url.includes('next=%2Fadmin%2Ftheme'));
  const redeemed = await call(backend, '/hand-a/api/admin/handoff', { method: 'POST', headers: native, body: { code: fresh.code } });
  assert.equal(redeemed.status, 200, JSON.stringify(redeemed.body));
  assert.ok(redeemed.body.token);
  const session = await call(backend, '/hand-a/api/admin/session', { headers: { ...native, ...bearer(redeemed.body.token) } });
  assert.equal(session.status, 200);
  assert.equal((await call(backend, '/hand-b/api/admin/session', { headers: { ...native, ...bearer(redeemed.body.token) } })).status, 401, 'the session is the store\'s own');
  assert.equal((await call(backend, '/hand-a/api/admin/handoff', { method: 'POST', headers: native, body: { code: fresh.code } })).status, 401, 'one use only');
  // Expired / forged / malformed codes.
  assert.equal((await call(backend, '/hand-a/api/admin/handoff', { method: 'POST', headers: native, body: { code: 'f'.repeat(64) } })).status, 401);
  assert.equal((await call(backend, '/hand-a/api/admin/handoff', { method: 'POST', headers: native, body: { code: 'nope' } })).status, 401);
  assert.equal((await call(backend, '/hand-a/api/admin/handoff', { method: 'POST', headers: native, body: {} })).status, 401);
  // Next paths stay inside the admin, a suspended or admin-less store has no hand-off, and only the console can ask.
  assert.ok((await api(`/tenants/${a.tenant.id}/handoff`, { method: 'POST', body: { next: 'https://evil.test' } })).body.url.endsWith(`handoff=${(await api(`/tenants/${a.tenant.id}/handoff`, { method: 'POST', body: {} })).body.code}`) === false);
  const evil = (await api(`/tenants/${a.tenant.id}/handoff`, { method: 'POST', body: { next: '//evil.test' } })).body;
  assert.ok(!evil.url.includes('next='), 'an outside path is dropped');
  assert.equal((await api(`/tenants/${b.tenant.id}/suspend`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await api(`/tenants/${b.tenant.id}/handoff`, { method: 'POST', body: {} })).status, 409);
  assert.equal((await call(backend, `/api/super-admin/tenants/${a.tenant.id}/handoff`, { method: 'POST', body: {} })).status, 401, 'no console session, no hand-off');
  const ca = await tenantLogin(backend, 'hand-a', 'owner@hand-a.test', a.admin.password);
  assert.equal((await call(backend, `/api/super-admin/tenants/${a.tenant.id}/handoff`, { method: 'POST', headers: ca, body: {} })).status, 401, 'a tenant admin cannot mint codes');
  assert.equal((await api('/tenants/t_nope/handoff', { method: 'POST', body: {} })).status, 404);
});

test('requests are gone: no console route, no store route, no counter in stats or tenants', async () => {
  const { api, backend } = await setup();
  const a = await newTenant(api, 'gone-a');
  const ca = await tenantLogin(backend, 'gone-a', 'owner@gone-a.test', a.admin.password);
  for (const url of ['/requests', '/requests/rq_x', '/requests/rq_x/apply']) assert.equal((await api(url)).status, 404, url);
  assert.equal((await call(backend, '/gone-a/api/admin/change-requests', { headers: ca })).status, 404);
  assert.equal((await call(backend, '/gone-a/api/admin/change-requests', { method: 'POST', headers: ca, body: { title: 'abc', body: 'abc' } })).status, 404);
  assert.ok(!('openRequests' in (await api('/stats')).body));
  assert.ok(!JSON.stringify((await api('/tenants')).body).includes('openRequests'));
});

test('leak matrix: a tenant admin cannot reach the platform API, other tenants, or the default tenant, through any route family', async () => {
  const { api, backend } = await setup();
  const a = await newTenant(api, 'leak-a'), b = await newTenant(api, 'leak-b');
  const ca = await tenantLogin(backend, 'leak-a', 'owner@leak-a.test', a.admin.password);
  const cb = await tenantLogin(backend, 'leak-b', 'owner@leak-b.test', b.admin.password);
  await call(backend, '/leak-b/api/admin/doc/branding', { method: 'PATCH', headers: cb, body: { appName: 'B-ONLY-NAME' } });
  await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });

  // 1. Tenant admins hold no platform power, on any host form.
  for (const url of ['/api/super-admin/tenants', '/leak-a/api/super-admin/tenants', '/api/super-admin/stats', '/api/super-admin/themes', '/api/super-admin/audit']) {
    assert.ok([401, 404].includes((await call(backend, url, { headers: ca })).status), url);
    assert.ok([401, 404].includes((await call(backend, url, { headers: { 'x-super-token': ca.authorization.slice(7) } })).status), url);
  }
  assert.equal((await call(backend, '/api/super-admin/tenants', { method: 'POST', headers: ca, body: { name: 'Evil', slug: 'evil-co', ownerEmail: 'e@e.co' } })).status, 401);
  // 2. A custom domain of tenant A cannot reach the super admin either.
  await api(`/tenants/${a.tenant.id}/domains`, { method: 'POST', body: { domain: 'brand-a.com' } });
  await api(`/tenants/${a.tenant.id}/domains/verify`, { method: 'POST', body: { domain: 'brand-a.com', force: true } });
  assert.equal((await call(backend, '/api/super-admin/login', { method: 'POST', host: 'brand-a.com', body: SUPER })).status, 404);
  assert.equal((await call(backend, '/super-admin', { host: 'brand-a.com' })).status, 404);
  assert.equal((await call(backend, '/api/content', { host: 'brand-a.com' })).body.docs.branding.appName !== 'B-ONLY-NAME', true);
  // 3. Same token, other tenant: never.
  for (const url of ['/api/admin/session', '/api/admin/clients', '/api/requests', '/api/admin/account', '/api/admin/instance']) {
    assert.equal((await call(backend, `/leak-b${url}`, { headers: ca })).status, 401, `A's token on B ${url}`);
    assert.equal((await call(backend, url, { headers: ca })).status, 401, `A's token on default ${url}`);
  }
  // 4. Data written in B is invisible to A, and the other way round.
  const publicA = JSON.stringify((await call(backend, '/leak-a/api/content')).body);
  assert.ok(!publicA.includes('B-ONLY-NAME'));
  // 5. The platform's own rows are never exposed through a tenant's content or sync endpoints.
  const dump = JSON.stringify((await call(backend, '/leak-a/api/content?a=1', { headers: ca })).body) + JSON.stringify((await call(backend, '/leak-a/api/sync', { headers: ca })).body);
  for (const word of ['saas_', 'pw_hash', SUPER.email, 'leak-b', 'owner@leak-b.test']) assert.ok(!dump.includes(word), `${word} must not appear in a tenant payload`);
});
