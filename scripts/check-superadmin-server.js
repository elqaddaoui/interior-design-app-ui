/**
 * Super admin, demos, ownership and change requests (docs/MULTI_TENANT_PLAN.md phases 4-6), driven through the real request handler.
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

test('super admin login: not configured -> 503, wrong password -> 401 and locks after 5, tenant tokens never open it', async () => {
  const db = await freshDb();
  const unconfigured = createBackend({ env: { ...ENV, SUPERADMIN_EMAIL: '', SUPERADMIN_PASSWORD_HASH: '' }, db, media: { storage: null, download: offline } });
  await unconfigured.db.query('select 1');
  assert.equal((await call(unconfigured, '/api/super-admin/login', { method: 'POST', body: SUPER })).status, 503);
  assert.equal((await call(unconfigured, '/api/super-admin/tenants')).status, 503);

  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline } });
  await backend.db.query('select 1');
  assert.equal((await call(backend, '/api/super-admin/tenants')).status, 401, 'no session');
  // The built-in admin / admin of the default tenant is NOT a super admin.
  const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  assert.equal(admin.status, 200);
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: bearer(admin.body.token) })).status, 401, 'a tenant admin session cannot open the platform API');
  assert.equal((await call(backend, '/api/super-admin/tenants', { headers: { 'x-super-token': admin.body.token } })).status, 401);
  for (let i = 0; i < 5; i++) assert.equal((await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'attacker', body: { email: SUPER.email, password: 'wrong-password' } })).status, 401);
  assert.equal((await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'attacker', body: SUPER })).status, 429, 'locked even with the right password');
  const ok = await call(backend, '/api/super-admin/login', { method: 'POST', ip: 'friend', body: SUPER });
  assert.equal(ok.status, 200);
  assert.match(ok.headers['set-cookie'], /dwira_super=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/api/);
  // The super admin API is never reachable under a slug or a custom domain.
  const { api } = await setup();
  await newTenant(api, 'shopone');
  assert.equal((await call(backend, '/shopone/api/super-admin/login', { method: 'POST', body: SUPER })).status, 404);
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
  const demoCookie = await tenantLogin(backend, demo.slug, made.body.admin.email, made.body.admin.password);
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
  const cookie = await tenantLogin(backend, demo.slug, demoAdmin.email, demoAdmin.password);
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

test('change requests: an admin files them for THEIR instance only; the super admin lists, answers, and applies to that tenant only', async () => {
  const { api, backend, db } = await setup();
  const { demo, admin: demoAdmin } = (await api('/demos', { method: 'POST', body: { name: 'Req Demo' } })).body;
  const a = (await api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'req-a', owner: { email: 'a@req.test' } } })).body;
  const b = (await api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'req-b', owner: { email: 'b@req.test' } } })).body;
  const ca = await tenantLogin(backend, 'req-a', 'a@req.test', a.admin.password);
  const cb = await tenantLogin(backend, 'req-b', 'b@req.test', b.admin.password);
  const cd = await tenantLogin(backend, demo.slug, demoAdmin.email, demoAdmin.password);

  assert.equal((await call(backend, '/req-a/api/admin/change-requests')).status, 401, 'needs an admin session');
  assert.equal((await call(backend, '/req-a/api/admin/change-requests', { method: 'POST', headers: ca, body: { title: 'x', body: 'y' } })).status, 400);
  const filed = await call(backend, '/req-a/api/admin/change-requests', { method: 'POST', headers: ca, body: { kind: 'customize', title: 'Change the logo', body: 'Please use our blue logo', tenantId: b.tenant.id, tenant_id: b.tenant.id } });
  assert.equal(filed.status, 201, JSON.stringify(filed.body));
  assert.equal(filed.body.tenantId, a.tenant.id, 'the tenant comes from the session, never from the body');
  assert.equal((await call(backend, '/req-a/api/admin/change-requests', { method: 'POST', headers: ca, body: { kind: 'hack', title: 'abc', body: 'abc' } })).status, 400);
  await call(backend, '/req-b/api/admin/change-requests', { method: 'POST', headers: cb, body: { kind: 'support', title: 'B question', body: 'How do I add a tool?' } });
  assert.equal((await call(backend, '/req-demo-nope/api/admin/change-requests')).status, 404);
  assert.equal((await call(backend, `/${demo.slug}/api/admin/change-requests`, { method: 'POST', headers: cd, body: { title: 'Demo asks', body: 'Demo asks' } })).status, 403, 'a demo template cannot file requests');

  // Each tenant sees only its own.
  const seenA = (await call(backend, '/req-a/api/admin/change-requests', { headers: ca })).body;
  const seenB = (await call(backend, '/req-b/api/admin/change-requests', { headers: cb })).body;
  assert.deepEqual(seenA.map(r => r.title), ['Change the logo']);
  assert.deepEqual(seenB.map(r => r.title), ['B question']);
  // One tenant's admin token cannot be used on the other's endpoint.
  assert.equal((await call(backend, '/req-b/api/admin/change-requests', { headers: ca })).status, 401);

  // The super admin sees both, answers, and applies A's request.
  const all = (await api('/requests')).body;
  assert.equal(all.length, 2);
  assert.ok(all.every(r => r.tenantSlug));
  assert.equal((await api(`/requests/${filed.body.id}`, { method: 'PATCH', body: { status: 'in_progress', response: 'On it' } })).body.status, 'in_progress');
  assert.equal((await call(backend, '/req-a/api/admin/change-requests', { headers: ca })).body[0].response, 'On it');
  const beforeB = JSON.stringify((await call(backend, '/req-b/api/content')).body.docs);
  const beforeDemo = JSON.stringify((await call(backend, `/${demo.slug}/api/content`)).body.docs);
  const applied = await api(`/requests/${filed.body.id}/apply`, { method: 'POST', body: { docs: { branding: { appName: 'Blue Logo Co' } }, markDone: true, tenantId: b.tenant.id } });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.tenantId, a.tenant.id, 'applied to the request owner, whatever the payload says');
  assert.equal((await call(backend, '/req-a/api/content')).body.docs.branding.appName, 'Blue Logo Co');
  assert.equal(JSON.stringify((await call(backend, '/req-b/api/content')).body.docs), beforeB, 'tenant B untouched');
  assert.equal(JSON.stringify((await call(backend, `/${demo.slug}/api/content`)).body.docs), beforeDemo, 'the original demo untouched');
  assert.equal((await call(backend, '/req-a/api/admin/change-requests', { headers: ca })).body[0].status, 'done');
  assert.equal((await api(`/requests/${filed.body.id}/apply`, { method: 'POST', body: {} })).status, 400, 'nothing to apply');

  // A request that somehow belongs to a demo template can never be applied.
  const now = Date.now();
  await db.query("INSERT INTO saas_requests(id,tenant_id,admin_id,kind,title,body,status,response,created_at,updated_at) VALUES('rq_demo',$1,'x','customize','t','b','open','',$2,$2)", [demo.tenantId, now]);
  assert.equal((await api('/requests/rq_demo/apply', { method: 'POST', body: { docs: { branding: { appName: 'Hijack' } } } })).status, 409);
  assert.notEqual((await call(backend, `/${demo.slug}/api/content`)).body.docs.branding.appName, 'Hijack');
  assert.ok((await api('/audit')).body.some(row => row.action === 'request.apply' && row.tenantId === a.tenant.id));
});

test('leak matrix: a tenant admin cannot reach the platform API, other tenants, or the default tenant, through any route family', async () => {
  const { api, backend } = await setup();
  const a = await newTenant(api, 'leak-a'), b = await newTenant(api, 'leak-b');
  const ca = await tenantLogin(backend, 'leak-a', 'owner@leak-a.test', a.admin.password);
  const cb = await tenantLogin(backend, 'leak-b', 'owner@leak-b.test', b.admin.password);
  await call(backend, '/leak-b/api/admin/doc/branding', { method: 'PATCH', headers: cb, body: { appName: 'B-ONLY-NAME' } });
  await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });

  // 1. Tenant admins hold no platform power, on any host form.
  for (const url of ['/api/super-admin/tenants', '/leak-a/api/super-admin/tenants', '/api/super-admin/stats', '/api/super-admin/requests', '/api/super-admin/audit']) {
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
  for (const url of ['/api/admin/session', '/api/admin/clients', '/api/requests', '/api/admin/account', '/api/admin/change-requests']) {
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
