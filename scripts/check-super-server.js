const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const access = require('../server/access');
const { freshDb } = require('./test-db');

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? (() => { try { return JSON.parse(value.toString()); } catch { return value.toString(); } })() : null; resolve(output); }, write() {} };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const bearer = token => ({ authorization: `Bearer ${token}` });

async function setup(env = {}) {
  const sent = [];
  const backend = createBackend({
    env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '4000', ...env }, db: await freshDb(),
    senders: { web: async (sub, body) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(body) }); } },
    media: { download: async () => { throw new Error('offline'); } },
  });
  const login = await call(backend, '/api/super/login', { method: 'POST', headers: native, body: { username: 'superadmin', password: 'superadmin' } });
  const sup = bearer(login.body.token);
  const api = (path, options = {}) => call(backend, '/api/super' + path, { ...options, headers: { ...sup, ...(options.headers || {}) } });
  return { backend, sent, sup, api, login };
}
async function adminLogin(backend, username, password) {
  const r = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: username, password } });
  return { ...r, auth: r.body?.token ? bearer(r.body.token) : {} };
}
async function newTenant(api, name, planId = 'pro', owner = true) {
  const r = await api('/tenants', { method: 'POST', body: { name, planId, ...(owner ? { owner: { username: name.toLowerCase().replace(/\W/g, '') + '.owner', password: 'password-123', name: name + ' Owner' } } : {}) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test('access model: effective level is the lower of plan and role; requirement/check close what is not described', () => {
  const plan = access.DEFAULT_PLANS.find(p => p.id === 'starter');
  const tenant = access.tenantLevels(plan, {});
  assert.equal(tenant.models, 'none');
  const owner = access.effectiveLevels(tenant, access.allLevels('edit'), {});
  assert.equal(owner.users, 'edit');
  assert.equal(owner.models, 'none', 'an owner cannot exceed what the plan includes');
  const analyst = access.effectiveLevels(tenant, access.SYSTEM_ROLES.find(r => r.id === 'role_analyst').permissions, {});
  assert.equal(analyst.users, 'view');
  assert.equal(access.check(analyst, access.requirement('PATCH', '/api/admin/clients/abc')).code, 'FEATURE_READONLY');
  assert.equal(access.check(analyst, access.requirement('GET', '/api/admin/clients')).ok, true);
  assert.equal(access.check(analyst, access.requirement('PUT', '/api/admin/content/tools/x')).code, 'FEATURE_FORBIDDEN');
  assert.equal(access.check(owner, { any: ['models'], need: 'view' }).code, 'FEATURE_FORBIDDEN');
  assert.equal(access.featureForPath('/admin'), 'dashboard');
  assert.equal(access.featureForPath('/admin/prompt-cards'), 'promptCards');
  assert.equal(access.featureForPath('/admin/settings'), 'settingsMap');
  assert.equal(access.featureForPath('/admin/users/'), 'users');
  assert.equal(access.featureForPath('/admin/nope'), null);
  assert.throws(() => access.cleanLevels({ users: 'god' }, { strict: true }), /INVALID_PERMISSIONS/);
  assert.deepEqual(access.cleanLevels({ users: 'god', nope: 'edit', chats: 'view' }), { chats: 'view' });
  assert.equal(access.settingsPatchAllowed({ interface: 'edit', credits: 'none' }, { homeStyle: 1 }), true);
  assert.equal(access.settingsPatchAllowed({ interface: 'edit', credits: 'none' }, { defaultFreeCredits: 3 }), false);
});

test('super admin login: default credentials, wrong password, cookie flags, session, logout; the tenant admin session is not a super session', async () => {
  const { backend, api, login } = await setup();
  try {
    assert.equal(login.status, 200);
    assert.equal(login.body.defaultCredentials, true, 'the panel warns while the default password is in use');
    assert.match(login.headers['set-cookie'], /^dwira_super=[a-f0-9]{64}; HttpOnly; SameSite=Strict; Path=\/api;/);
    assert.equal((await call(backend, '/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'nope' } })).status, 401);
    assert.equal((await call(backend, '/api/super/login', { method: 'POST', body: { username: 'admin', password: 'admin' } })).status, 401, 'the legacy admin is not a super admin');
    assert.equal((await call(backend, '/api/super/overview')).status, 401);
    assert.equal((await call(backend, '/api/super/overview', { headers: bearer('a'.repeat(64)) })).status, 401);
    const legacy = await adminLogin(backend, 'admin', 'admin');
    assert.equal((await call(backend, '/api/super/overview', { headers: legacy.auth })).status, 401, 'an admin token never opens the super API');
    assert.equal((await api('/session')).body.user.username, 'superadmin');
    const cookieToken = login.headers['set-cookie'].match(/dwira_super=([a-f0-9]{64})/)[1];
    assert.equal((await call(backend, '/api/super/session', { headers: { cookie: `dwira_super=${cookieToken}` } })).status, 200);
    assert.equal((await api('/logout', { method: 'POST' })).status, 200);
    assert.equal((await api('/session')).status, 401);
  } finally { backend.server.emit('close'); }
});

test('super admin credentials: DISABLE_DEFAULT_SUPERADMIN, env hash, and changing the password from the panel', async () => {
  const off = await createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', DISABLE_DEFAULT_SUPERADMIN: 'true' }, db: await freshDb() });
  try { assert.equal((await call(off, '/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin' } })).status, 401); } finally { off.server.emit('close'); }
  const { hashPassword } = require('../server/platform');
  const hashed = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', SUPER_ADMIN_USER: 'Owner', SUPER_ADMIN_PASSWORD_HASH: hashPassword('a-long-secret-1') }, db: await freshDb() });
  try {
    assert.equal((await call(hashed, '/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin' } })).status, 401, 'an env hash replaces the default');
    const ok = await call(hashed, '/api/super/login', { method: 'POST', headers: native, body: { username: 'owner', password: 'a-long-secret-1' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.defaultCredentials, false);
  } finally { hashed.server.emit('close'); }
  const { backend, api, login } = await setup();
  try {
    assert.equal((await api('/password', { method: 'POST', body: { current: 'wrong', next: 'a-brand-new-password' } })).status, 403);
    assert.equal((await api('/password', { method: 'POST', body: { current: 'superadmin', next: 'short' } })).status, 400);
    const other = await call(backend, '/api/super/login', { method: 'POST', headers: native, body: { username: 'superadmin', password: 'superadmin' } });
    assert.equal((await api('/password', { method: 'POST', body: { current: 'superadmin', next: 'a-brand-new-password' } })).status, 200);
    assert.equal((await call(backend, '/api/super/session', { headers: bearer(other.body.token) })).status, 401, 'other sessions are signed out');
    assert.equal((await api('/session')).body.defaultCredentials, false);
    assert.equal((await call(backend, '/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'superadmin' } })).status, 401, 'the old password stops working');
    assert.equal((await call(backend, '/api/super/login', { method: 'POST', body: { username: 'superadmin', password: 'a-brand-new-password' } })).status, 200);
    assert.ok(login.body.token);
  } finally { backend.server.emit('close'); }
});

test('tenants, plans and accounts: create, validate, limits, duplicate guards, suspension and deletion', async () => {
  const { backend, api } = await setup();
  try {
    const list = (await api('/tenants')).body;
    assert.equal(list[0].id, 'default', 'the legacy workspace is always there');
    assert.equal((await api('/tenants/default', { method: 'DELETE', body: { confirm: 'default' } })).status, 400);
    assert.equal((await api('/tenants/default', { method: 'PATCH', body: { status: 'suspended' } })).status, 400);
    const acme = await newTenant(api, 'Acme');
    assert.equal(acme.slug, 'acme');
    assert.equal(acme.usage.accounts, 1);
    assert.equal((await api('/tenants', { method: 'POST', body: { name: 'Acme again', slug: 'acme' } })).status, 409);
    assert.equal((await api('/tenants', { method: 'POST', body: { name: 'X', slug: 'Bad Slug!' } })).status, 400);
    assert.equal((await api('/tenants', { method: 'POST', body: { name: 'X', slug: 'api' } })).status, 400, 'reserved slugs');
    assert.equal((await api('/tenants', { method: 'POST', body: { name: 'X', planId: 'nope' } })).status, 400);
    assert.equal((await api('/tenants', { method: 'POST', body: { name: '' } })).status, 400);
    // The tenant is rolled back when its first admin is invalid.
    const before = (await api('/tenants')).body.length;
    assert.equal((await api('/tenants', { method: 'POST', body: { name: 'Rollback', owner: { username: 'x', password: 'password-123', name: 'N' } } })).status, 400);
    assert.equal((await api('/tenants')).body.length, before);
    // Accounts
    const mk = body => api('/accounts', { method: 'POST', body: { tenantId: acme.id, password: 'password-123', name: 'N', roleId: 'role_support', ...body } });
    assert.equal((await mk({ username: 'acme.owner' })).status, 409, 'usernames are unique platform-wide');
    assert.equal((await mk({ username: 'admin' })).status, 400, 'reserved login names');
    assert.equal((await mk({ username: 'Bad Name' })).status, 400);
    assert.equal((await mk({ username: 'agent.one', password: 'short' })).status, 400);
    assert.equal((await mk({ username: 'agent.one', roleId: 'role_nope' })).status, 400);
    assert.equal((await mk({ username: 'agent.one', overrides: { users: 'god' } })).status, 400);
    assert.equal((await mk({ username: 'agent.one' })).status, 201);
    // The Pro plan allows 10 admins: fill it, then the next is refused with a clear code.
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { limits: { maxAdmins: 2 } } });
    const over = await mk({ username: 'agent.two' });
    assert.equal(over.status, 409);
    assert.equal(over.body.error, 'ADMIN_LIMIT');
    // Plans
    const plans = (await api('/plans')).body;
    assert.deepEqual(plans.map(p => p.id), ['starter', 'pro', 'enterprise']);
    assert.equal((await api('/plans', { method: 'PUT', body: plans.filter(p => p.id !== 'pro') })).status, 409, 'a plan in use cannot be removed');
    assert.equal((await api('/plans', { method: 'PUT', body: [{ id: 'x', name: 'X', features: { users: 'nope' } }] })).status, 400);
    const edited = plans.map(p => p.id === 'starter' ? { ...p, name: 'Free', limits: { ...p.limits, maxClients: 5 } } : p);
    assert.equal((await api('/plans', { method: 'PUT', body: edited })).body[0].name, 'Free');
    // Suspension, then deletion needs the slug typed back
    assert.equal((await api('/tenants/' + acme.id, { method: 'PATCH', body: { status: 'suspended' } })).body.status, 'suspended');
    assert.equal((await api('/tenants/' + acme.id, { method: 'DELETE', body: { confirm: 'wrong' } })).status, 400);
    assert.equal((await api('/tenants/' + acme.id, { method: 'DELETE', body: { confirm: 'acme' } })).status, 200);
    assert.equal((await api('/tenants/' + acme.id)).status, 404);
    assert.equal((await api('/accounts')).body.some(a => a.tenantId === acme.id), false, 'accounts go with the tenant');
    assert.equal((await api('/tenants/bad id!')).status, 404);
  } finally { backend.server.emit('close'); }
});

test('tenant admin login and enforcement: view/edit/none per page, plan ceiling, suspended account and tenant', async () => {
  const { backend, api } = await setup();
  try {
    const acme = await newTenant(api, 'Acme');
    const make = async (username, roleId, extra = {}) => (await api('/accounts', { method: 'POST', body: { tenantId: acme.id, username, password: 'password-123', name: username, roleId, ...extra } })).body;
    const analyst = await make('acme.analyst', 'role_analyst'), editor = await make('acme.editor', 'role_editor');
    // The legacy admin still works and is owner of the default workspace.
    const legacy = await adminLogin(backend, 'admin', 'admin');
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.access.tenant.id, 'default');
    assert.equal(legacy.body.access.levels.models, 'edit');
    const owner = await adminLogin(backend, 'acme.owner', 'password-123');
    assert.equal(owner.status, 200, JSON.stringify(owner.body));
    assert.equal(owner.body.access.tenant.slug, 'acme');
    assert.equal(owner.body.access.levels.users, 'edit');
    assert.equal(owner.body.access.levels.models, 'none', 'Pro plan: no shared AI models page');
    assert.equal((await adminLogin(backend, 'acme.owner', 'bad')).status, 401);
    assert.equal((await adminLogin(backend, 'ghost', 'password-123')).status, 401);
    const ana = await adminLogin(backend, 'acme.analyst', 'password-123');
    assert.equal((await call(backend, '/api/admin/clients', { headers: ana.auth })).status, 200);
    const denied = await call(backend, '/api/admin/clients/bulk', { method: 'POST', headers: ana.auth, body: { ids: ['aaaaaaaa'], action: 'block' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'FEATURE_READONLY', 'view-only is told apart from no access');
    const forbidden = await call(backend, '/api/admin/content/tools/x', { method: 'PUT', headers: ana.auth, body: {} });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error, 'FEATURE_FORBIDDEN');
    assert.equal((await call(backend, '/api/admin/ai/keys', { method: 'PATCH', headers: owner.auth, body: {} })).status, 403, 'plan ceiling beats the owner role');
    assert.equal((await call(backend, '/api/admin/doc/settings', { method: 'PATCH', headers: owner.auth, body: { defaultFreeCredits: 9 } })).status, 403, 'a tenant cannot change global settings');
    assert.equal((await call(backend, '/api/admin/doc/settings', { method: 'PATCH', headers: ana.auth, body: { homeStyle: 'x' } })).status, 403);
    assert.equal((await call(backend, '/api/admin/nothing-described', { headers: owner.auth })).status, 403, 'undescribed admin endpoints are closed');
    assert.equal((await call(backend, '/api/admin/session', { headers: ana.auth })).body.access.levels.users, 'view');
    // Provider keys never reach a session without the models page.
    await call(backend, '/api/admin/content/models/mdl_x', { method: 'PUT', headers: legacy.auth, body: { name: 'X', provider: 'P', modelName: 'm', apiKey: 'sk-secret', enabled: true, isDefault: false, order: 9, visible: true } });
    assert.equal((await call(backend, '/api/content', { headers: owner.auth })).body.collections.models.find(m => m.id === 'mdl_x').apiKey, '');
    assert.equal((await call(backend, '/api/content', { headers: legacy.auth })).body.collections.models.find(m => m.id === 'mdl_x').apiKey, 'sk-secret');
    // A per-account override raises (within the plan) or lowers a page.
    await api('/accounts/' + analyst.id, { method: 'PATCH', body: { overrides: { users: 'edit' } } });
    await new Promise(resolve => setTimeout(resolve, 3100)); // access context cache (3 s) is also dropped by writes, but a second instance would wait
    assert.equal((await call(backend, '/api/admin/clients/bulk', { method: 'POST', headers: ana.auth, body: { ids: ['aaaaaaaa'], action: 'block' } })).status, 200);
    // Suspending the account signs it out at once.
    assert.equal((await api('/accounts/' + editor.id, { method: 'PATCH', body: { status: 'suspended' } })).body.status, 'suspended');
    assert.equal((await adminLogin(backend, 'acme.editor', 'password-123')).status, 403);
    // Suspending the tenant signs out every admin and refuses new logins.
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { status: 'suspended' } });
    assert.equal((await call(backend, '/api/admin/clients', { headers: owner.auth })).status, 401);
    const blocked = await adminLogin(backend, 'acme.owner', 'password-123');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'TENANT_SUSPENDED');
    assert.equal((await adminLogin(backend, 'admin', 'admin')).status, 200, 'the default workspace is unaffected');
    // Password reset signs the account out and the new password works.
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { status: 'active' } });
    const again = await adminLogin(backend, 'acme.owner', 'password-123');
    assert.equal((await api('/accounts/' + (await api('/accounts?tenantId=' + acme.id)).body.find(a => a.username === 'acme.owner').id + '/password', { method: 'POST', body: { password: 'new-password-456' } })).status, 200);
    assert.equal((await call(backend, '/api/admin/clients', { headers: again.auth })).status, 401);
    assert.equal((await adminLogin(backend, 'acme.owner', 'new-password-456')).status, 200);
  } finally { backend.server.emit('close'); }
});

test('tenant isolation: clients, requests, chats, campaigns and push devices never cross tenants', async () => {
  const { backend, sent, api } = await setup();
  try {
    const acme = await newTenant(api, 'Acme'), beta = await newTenant(api, 'Beta');
    const acmeAdmin = await adminLogin(backend, 'acme.owner', 'password-123'), betaAdmin = await adminLogin(backend, 'beta.owner', 'password-123');
    const legacy = await adminLogin(backend, 'admin', 'admin');
    const sub = id => ({ kind: 'web', language: 'fr', subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: require('node:crypto').createECDH('prime256v1').generateKeys().toString('base64url'), auth: require('node:crypto').randomBytes(16).toString('base64url') } } });
    // Same phone number can be a client of two businesses.
    const signup = (tenant, name, phone) => call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name, phone, ...(tenant ? { tenant } : {}) } });
    const a1 = await signup('acme', 'Alice Acme', '0661000001'), b1 = await signup('beta', 'Alice Beta', '0661000001'), d1 = await signup(null, 'Dora Default', '0661000002');
    assert.equal(a1.status, 200); assert.equal(b1.status, 200);
    assert.notEqual(a1.body.user.id, b1.body.user.id);
    assert.equal(a1.body.user.tenantId ?? 'acme', 'acme'.length ? a1.body.user.tenantId ?? 'acme' : '');
    assert.equal((await signup('nowhere', 'Zed Zed', '0661000003')).status, 404);
    assert.equal((await call(backend, '/api/admin/clients', { headers: acmeAdmin.auth })).body.map(c => c.name).join(), 'Alice Acme');
    assert.equal((await call(backend, '/api/admin/clients', { headers: betaAdmin.auth })).body.map(c => c.name).join(), 'Alice Beta');
    assert.deepEqual((await call(backend, '/api/admin/clients', { headers: legacy.auth })).body.map(c => c.name), ['Dora Default']);
    // Acme cannot touch Beta's client by id.
    const betaClient = b1.body.user.id;
    assert.equal((await call(backend, `/api/admin/clients/${betaClient}`, { method: 'PATCH', headers: acmeAdmin.auth, body: { blocked: true } })).status, 404);
    assert.equal((await call(backend, `/api/admin/clients/${betaClient}`, { method: 'DELETE', headers: acmeAdmin.auth })).status, 404);
    const bulk = await call(backend, '/api/admin/clients/bulk', { method: 'POST', headers: acmeAdmin.auth, body: { ids: [betaClient], action: 'delete' } });
    assert.equal(bulk.body.affected, 0, 'bulk skips clients of other tenants');
    assert.equal((await call(backend, '/api/admin/clients', { headers: betaAdmin.auth })).body.length, 1);
    // Requests
    const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const demand = (token, id) => call(backend, '/api/requests', { method: 'POST', headers: { 'x-user-token': token, 'x-demand-token': 'c'.repeat(64) }, body: { id, photoUri: photo, draft: { toolId: 'tool_x' } } });
    assert.equal((await demand(a1.body.token, 'req-acme-0001')).status, 201);
    assert.equal((await demand(b1.body.token, 'req-beta-0001')).status, 201);
    const reqs = async auth => (await call(backend, '/api/requests', { headers: auth })).body;
    assert.deepEqual((await reqs(acmeAdmin.auth)).map(r => r.name), ['Alice Acme']);
    assert.deepEqual((await reqs(betaAdmin.auth)).map(r => r.name), ['Alice Beta']);
    assert.equal((await reqs(legacy.auth)).length, 0);
    const acmeReq = (await reqs(acmeAdmin.auth))[0];
    assert.equal((await call(backend, `/api/requests/${acmeReq.id}`, { headers: betaAdmin.auth })).status, 404);
    assert.equal((await call(backend, `/api/requests/${acmeReq.id}`, { method: 'PATCH', headers: betaAdmin.auth, body: { status: 'delivered' } })).status, 404);
    assert.equal((await call(backend, `/api/requests/${acmeReq.id}`, { method: 'DELETE', headers: betaAdmin.auth })).status, 404);
    assert.equal((await call(backend, `/api/requests/${acmeReq.id}`, { headers: acmeAdmin.auth })).status, 200);
    // Push devices: a new request only notifies the admins of its own tenant.
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: acmeAdmin.auth, body: sub('acme-phone') })).status, 200);
    assert.equal((await call(backend, '/api/push/subscriptions', { method: 'POST', headers: betaAdmin.auth, body: sub('beta-phone') })).status, 200);
    sent.length = 0;
    // The first request used the client's free design: give it credits (also proves an admin can only do this inside its own tenant).
    assert.equal((await call(backend, `/api/admin/clients/${a1.body.user.id}`, { method: 'PATCH', headers: acmeAdmin.auth, body: { credits: 5 } })).status, 200);
    assert.equal((await demand(a1.body.token, 'req-acme-0002')).status, 201);
    assert.deepEqual([...new Set(sent.map(p => p.endpoint.split('/').pop()))], ['acme-phone']);
    sent.length = 0;
    await signup('beta', 'Bob Beta', '0661000009');
    assert.deepEqual([...new Set(sent.map(p => p.endpoint.split('/').pop()))], ['beta-phone'], 'new-lead alerts stay inside the tenant');
    // Chats: a conversation of Acme's client is invisible to Beta.
    const conv = await call(backend, '/api/user/conversations', { method: 'POST', headers: { 'x-user-token': a1.body.token }, body: { title: 'Hi', messages: [{ id: 'm1', role: 'user', text: 'hello', createdAt: Date.now() }], updatedAt: Date.now() } });
    assert.equal(conv.status, 200, JSON.stringify(conv.body));
    assert.equal((await call(backend, '/api/admin/conversations', { headers: acmeAdmin.auth })).body.length, 1);
    assert.equal((await call(backend, '/api/admin/conversations', { headers: betaAdmin.auth })).body.length, 0);
    assert.equal((await call(backend, `/api/admin/conversations/${conv.body.id}`, { method: 'POST', headers: betaAdmin.auth, body: { text: 'hi' } })).status, 404);
    assert.equal((await call(backend, `/api/admin/conversations/${conv.body.id}`, { method: 'POST', headers: acmeAdmin.auth, body: { text: 'hi' } })).status, 200);
    // Campaigns
    const camp = await call(backend, '/api/admin/campaigns', { method: 'POST', headers: acmeAdmin.auth, body: { kind: 'once', name: 'Promo', title: 'T', body: 'B', audience: { segments: ['all'] } } });
    assert.equal(camp.status, 201, JSON.stringify(camp.body));
    assert.equal((await call(backend, '/api/admin/campaigns', { headers: betaAdmin.auth })).body.length, 0);
    assert.equal((await call(backend, `/api/admin/campaigns/${camp.body.id}`, { headers: betaAdmin.auth })).status, 404);
    assert.equal((await call(backend, `/api/admin/campaigns/${camp.body.id}`, { method: 'DELETE', headers: betaAdmin.auth })).status, 404);
    assert.equal((await call(backend, '/api/admin/campaigns/people', { headers: betaAdmin.auth })).body.every(p => p.name.includes('Beta')), true);
    // Deleting a tenant removes its clients and requests and nothing else.
    await api('/tenants/' + beta.id, { method: 'DELETE', body: { confirm: 'beta' } });
    assert.equal((await api('/clients')).body.items.some(c => c.name.includes('Beta')), false);
    assert.equal((await api('/clients')).body.items.some(c => c.name === 'Alice Acme'), true);
    assert.equal(d1.status, 200);
  } finally { backend.server.emit('close'); }
});

test('platform controls: client limit, start credits, monthly design limit, signup switch, maintenance, suspended tenant clients, announcement', async () => {
  const { backend, api } = await setup();
  try {
    const acme = await newTenant(api, 'Acme', 'starter');
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { limits: { maxClients: 2, monthlyDesigns: 1, startCredits: 4 } } });
    const signup = (name, phone) => call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name, phone, tenant: 'acme' } });
    const c1 = await signup('Client One', '0661100001');
    assert.equal(c1.body.user.credits, 4, 'start credits come from the tenant, not the global setting');
    assert.equal((await signup('Client Two', '0661100002')).status, 200);
    const limited = await signup('Client Three', '0661100003');
    assert.equal(limited.status, 403);
    assert.equal(limited.body.error, 'CLIENT_LIMIT');
    assert.equal((await signup('Client One', '0661100001')).status, 200, 'an existing client can still sign in at the limit');
    // Monthly designs
    const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const demand = id => call(backend, '/api/requests', { method: 'POST', headers: { 'x-user-token': c1.body.token, 'x-demand-token': 'd'.repeat(64) }, body: { id, photoUri: photo, draft: { toolId: 'tool_x' } } });
    assert.equal((await demand('design-one-0001')).status, 201);
    assert.equal((await demand('design-one-0001')).status, 201, 'a retry of the same request is not counted twice');
    const over = await demand('design-one-0002');
    assert.equal(over.status, 403);
    assert.equal(over.body.error, 'DESIGN_LIMIT');
    // Signup switch
    await api('/config', { method: 'PATCH', body: { signupOpen: false } });
    await new Promise(resolve => setTimeout(resolve, 3100));
    const closed = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'New Person', phone: '0661100077' } });
    assert.equal(closed.body.error, 'SIGNUP_CLOSED');
    assert.equal((await signup('Client One', '0661100001')).status, 200, 'existing clients are not locked out by closed signup');
    await api('/config', { method: 'PATCH', body: { signupOpen: true } });
    // Maintenance: tenant admins get 503, the default workspace admin too, the super admin is not affected.
    const owner = await adminLogin(backend, 'acme.owner', 'password-123');
    await api('/config', { method: 'PATCH', body: { maintenance: { enabled: true, message: 'Back at 10:00' }, announcement: { enabled: true, text: 'Scheduled upgrade', level: 'warning' } } });
    await new Promise(resolve => setTimeout(resolve, 3100));
    assert.equal((await call(backend, '/api/admin/clients', { headers: owner.auth })).status, 503);
    assert.equal((await call(backend, '/api/requests', { headers: owner.auth })).status, 503);
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: { 'x-user-token': c1.body.token, 'x-demand-token': 'd'.repeat(64) }, body: { id: 'design-one-0003', photoUri: photo, draft: { toolId: 't' } } })).status, 503);
    const session = await call(backend, '/api/admin/session', { headers: owner.auth });
    assert.equal(session.body.access.platform.maintenance.enabled, true);
    assert.equal(session.body.access.platform.announcement.text, 'Scheduled upgrade');
    assert.equal((await api('/overview')).status, 200);
    await api('/config', { method: 'PATCH', body: { maintenance: { enabled: false } } });
    await new Promise(resolve => setTimeout(resolve, 3100));
    assert.equal((await call(backend, '/api/admin/clients', { headers: owner.auth })).status, 200);
    // Suspended tenant: its clients are treated as blocked and cannot sign in.
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { status: 'suspended' } });
    await new Promise(resolve => setTimeout(resolve, 3100));
    assert.equal((await call(backend, '/api/user/session', { headers: { 'x-user-token': c1.body.token } })).status, 403);
    assert.equal((await signup('Client One', '0661100001')).body.error, 'TENANT_SUSPENDED');
    assert.equal((await call(backend, '/api/sync', { headers: { 'x-user-token': c1.body.token } })).body.user.blocked, true);
  } finally { backend.server.emit('close'); }
});

test('roles: custom roles with a permission matrix, system roles are read-only, roles in use cannot be deleted', async () => {
  const { backend, api } = await setup();
  try {
    const roles = (await api('/roles')).body;
    assert.deepEqual(roles.filter(r => r.system).map(r => r.id), access.SYSTEM_ROLES.map(r => r.id));
    assert.equal((await api('/roles/role_owner', { method: 'PATCH', body: { name: 'Hacked', permissions: {} } })).status, 400);
    assert.equal((await api('/roles/role_owner', { method: 'DELETE' })).status, 400);
    assert.equal((await api('/roles', { method: 'POST', body: { name: 'Bad', permissions: { users: 'root' } } })).status, 400);
    const role = (await api('/roles', { method: 'POST', body: { name: 'Billing', description: 'Credits only', permissions: { credits: 'edit', dashboard: 'view' } } })).body;
    assert.equal(role.permissions.credits, 'edit');
    assert.equal(role.permissions.users, 'none');
    const acme = await newTenant(api, 'Acme');
    const acc = (await api('/accounts', { method: 'POST', body: { tenantId: acme.id, username: 'billing.user', password: 'password-123', name: 'Bill', roleId: role.id } })).body;
    const bill = await adminLogin(backend, 'billing.user', 'password-123');
    assert.equal(bill.body.access.levels.credits, 'edit');
    assert.equal(bill.body.access.levels.users, 'none');
    assert.equal((await call(backend, '/api/admin/clients', { headers: bill.auth })).status, 200, 'the clients list is readable from the credits/dashboard pages');
    assert.equal((await call(backend, '/api/admin/conversations', { headers: bill.auth })).status, 403);
    assert.equal((await api('/roles/' + role.id, { method: 'DELETE' })).status, 409);
    // Editing the role takes effect for existing accounts.
    await api('/roles/' + role.id, { method: 'PATCH', body: { name: 'Billing', permissions: { credits: 'view' } } });
    await new Promise(resolve => setTimeout(resolve, 3100));
    assert.equal((await call(backend, '/api/admin/clients/bulk', { method: 'POST', headers: bill.auth, body: { ids: ['aaaaaaaa'], action: 'block' } })).body.error, 'FEATURE_READONLY');
    await api('/accounts/' + acc.id, { method: 'DELETE' });
    assert.equal((await api('/roles/' + role.id, { method: 'DELETE' })).status, 200);
    assert.equal((await call(backend, '/api/admin/clients', { headers: bill.auth })).status, 401, 'deleting an account ends its sessions');
  } finally { backend.server.emit('close'); }
});

test('audit log, analytics overview, impersonation and cross-tenant client management', async () => {
  const { backend, api } = await setup();
  try {
    const acme = await newTenant(api, 'Acme');
    await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Client One', phone: '0661200001', tenant: 'acme' } });
    await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Client Two', phone: '0661200002' } });
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { name: 'Acme Studio' } });
    const audit = (await api('/audit')).body;
    for (const action of ['super.login', 'tenant.create', 'account.create', 'tenant.update']) assert.ok(audit.some(e => e.action === action), action);
    assert.ok(audit.every(e => e.actor), 'every entry names its actor');
    assert.equal(audit[0].action, 'tenant.update', 'newest first');
    assert.ok((await api('/audit?tenantId=' + acme.id)).body.every(e => e.tenantId === acme.id));
    assert.ok((await api('/audit?action=account.')).body.every(e => e.action.startsWith('account.')));
    assert.ok((await api('/audit?q=acme.owner')).body.length >= 1);
    assert.equal((await api('/audit?q=' + encodeURIComponent("'; DROP TABLE audit_log; --"))).status, 200);
    // Failed super logins are recorded too, without the password.
    await call(backend, '/api/super/login', { method: 'POST', body: { username: 'root', password: 'secret-attempt' } });
    const failed = (await api('/audit?action=super.login_failed')).body;
    assert.equal(failed.length, 1);
    assert.equal(JSON.stringify(failed).includes('secret-attempt'), false);
    // Overview
    const o = (await api('/overview?days=7')).body;
    assert.equal(o.days, 7);
    assert.equal(o.labels.length, 7);
    assert.equal(o.series.clients.length, 7);
    assert.equal(o.totals.tenants, 2);
    assert.equal(o.totals.clients, 2);
    assert.equal(o.totals.mrr, 49);
    assert.equal(o.planMix.find(p => p.id === 'pro').tenants, 1);
    assert.ok(o.topTenants.length >= 1);
    assert.equal((await api('/overview?days=999')).body.days, 30, 'an unknown range falls back to 30 days');
    // Cross-tenant clients
    const all = (await api('/clients')).body;
    assert.equal(all.total, 2);
    assert.equal((await api('/clients?tenantId=' + acme.id)).body.items.map(c => c.name).join(), 'Client One');
    assert.equal((await api('/clients?q=Two')).body.items.length, 1);
    const one = all.items.find(c => c.name === 'Client One');
    assert.equal((await api('/clients/' + one.id, { method: 'PATCH', body: { credits: 7, blocked: true } })).body.blocked, true);
    assert.equal((await api('/clients/' + one.id, { method: 'DELETE' })).status, 200);
    assert.equal((await api('/clients/' + one.id, { method: 'DELETE' })).status, 404);
    assert.ok((await api('/audit?action=client.')).body.length >= 2);
    // Impersonation: a tenant panel session for the tenant, recorded in the audit log.
    const imp = await api('/tenants/' + acme.id + '/impersonate', { method: 'POST', headers: native });
    assert.equal(imp.status, 200);
    const asTenant = bearer(imp.body.token);
    const sess = await call(backend, '/api/admin/session', { headers: asTenant });
    assert.equal(sess.body.access.tenant.slug, 'acme');
    assert.equal(sess.body.impersonated, true);
    assert.equal((await api('/audit?action=tenant.impersonate')).body.length, 1);
    await api('/tenants/' + acme.id, { method: 'PATCH', body: { status: 'suspended' } });
    assert.equal((await call(backend, '/api/admin/session', { headers: asTenant })).status, 401, 'suspending signs the impersonated session out');
    assert.equal((await api('/tenants/' + acme.id + '/impersonate', { method: 'POST' })).status, 409);
    assert.equal((await api('/catalog')).body.features.length, access.FEATURES.length);
    assert.equal((await api('/nope')).status, 404);
  } finally { backend.server.emit('close'); }
});
