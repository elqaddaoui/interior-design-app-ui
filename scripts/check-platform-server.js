/**
 * Platform allowances and the API manager, plus the simplified creation flow (optional e-mail, user-name sign-in, several
 * administrators per store), driven through the real request handler.
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

function call(backend, url, { method = 'GET', body, headers = {}, host = 'app.test', ip = 'pf-test' } = {}) {
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
const png = (w = 640, h = 480) => { const b = Buffer.alloc(64, 1); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const photoUri = `data:image/png;base64,${png().toString('base64')}`;

/** Fake image API: records the key each call carried. */
function fakeImageApi() {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, auth: (options.headers || {}).Authorization, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png(1024, 768).toString('base64') }] }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}

async function setup(imageApi = fakeImageApi()) {
  const db = await freshDb();
  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline }, imageFetch: imageApi.fetch });
  await backend.db.query('select 1');
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: native, body: SUPER });
  assert.equal(signin.status, 200, JSON.stringify(signin.body));
  const sa = { 'x-super-token': signin.body.token };
  const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { ...sa, ...(opts.headers || {}) } });
  return { db, backend, api, imageApi };
}
const login = async (backend, slug, user, password) => {
  const r = await call(backend, `/${slug}/api/admin/login`, { method: 'POST', headers: native, body: { email: user, password } });
  return r.status === 200 ? { ...bearer(r.body.token), ...native } : null;
};
/** A signed-in end client of one store with credits to spend. */
async function clientOf(backend, slug, tenantId) {
  const who = await call(backend, `/${slug}/api/user/login`, { method: 'POST', headers: native, body: { name: 'Design Client', phone: '0661000077' } });
  assert.equal(who.status, 200, JSON.stringify(who.body));
  await backend.bundles.get(tenantId).clients.grant(who.body.user.id, 50);
  return { 'x-user-token': who.body.token, 'x-demand-token': 'a'.repeat(64), ...native };
}
let claimCounter = 0;
async function render(backend, slug, auth) {
  const id = `platform-claim-${String(++claimCounter).padStart(4, '0')}`;
  const created = await call(backend, `/${slug}/api/requests`, { method: 'POST', headers: auth, body: { id, photoUri, draft: { toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', mode: 'restyle' } } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return call(backend, `/${slug}/api/ai/render`, { method: 'POST', headers: auth, body: { id } });
}

test('create a store with no e-mail at all: user name sign-in, generated password, several administrators, optional e-mail login', async () => {
  const { api, backend } = await setup();
  const made = await api('/tenants', { method: 'POST', body: { name: 'No Mail Shop', slug: 'nomail', ownerUsername: 'Boss.One' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.tenant.ownerEmail, '');
  assert.equal(made.body.admin.id, 'boss.one');
  assert.ok(made.body.admin.password.length >= 12, 'generated password is returned once');
  assert.ok(await login(backend, 'nomail', 'BOSS.ONE', made.body.admin.password), 'signs in with the user name (any case)');
  // No name given at all = the user name "admin".
  const bare = await api('/tenants', { method: 'POST', body: { name: 'Bare Shop', slug: 'bare' } });
  assert.equal(bare.status, 201, JSON.stringify(bare.body));
  assert.equal(bare.body.admin.id, 'admin');
  assert.ok(await login(backend, 'bare', 'admin', bare.body.admin.password));
  // Several administrators in the same store: one with user name + e-mail (either signs in), one with e-mail only.
  const id = made.body.tenant.id;
  const second = await api(`/tenants/${id}/admins`, { method: 'POST', body: { username: 'sara', email: 'Sara@Shop.test', name: 'Sara', password: 'Sara-Strong-123' } });
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.ok(await login(backend, 'nomail', 'sara', 'Sara-Strong-123'), 'user name');
  assert.ok(await login(backend, 'nomail', 'sara@shop.test', 'Sara-Strong-123'), 'e-mail');
  const third = await api(`/tenants/${id}/admins`, { method: 'POST', body: { email: 'third@shop.test' } });
  assert.equal(third.status, 201);
  assert.equal(third.body.admin.id, 'third@shop.test');
  assert.equal((await api(`/tenants/${id}/admins`)).body.length, 3);
  // Same name twice, bad names, bad e-mail.
  assert.equal((await api(`/tenants/${id}/admins`, { method: 'POST', body: { username: 'sara' } })).status, 409);
  assert.equal((await api(`/tenants/${id}/admins`, { method: 'POST', body: { username: 'a b' } })).status, 400);
  assert.equal((await api(`/tenants/${id}/admins`, { method: 'POST', body: { username: 'ok-name', email: 'nope' } })).status, 400);
  // The same user name in ANOTHER store is a different account.
  assert.equal((await api(`/tenants/${bare.body.tenant.id}/admins`, { method: 'POST', body: { username: 'sara' } })).status, 201);
  // Clearing an e-mail is allowed; the user name keeps working.
  const cleared = await api(`/tenants/${id}/admins/sara`, { method: 'PATCH', body: { email: '' } });
  assert.equal(cleared.body.email, '');
  assert.ok(await login(backend, 'nomail', 'sara', 'Sara-Strong-123'));
  assert.equal(await login(backend, 'nomail', 'sara@shop.test', 'Sara-Strong-123'), null);
  // A bad contact e-mail on the store itself is still refused, an empty one is not.
  assert.equal((await api('/tenants', { method: 'POST', body: { name: 'Bad', slug: 'bad-mail', ownerEmail: 'nope' } })).status, 400);
});

test('creating a demo and a store from it is fast: the starter content is written with a handful of statements', async () => {
  const { api, db } = await setup();
  let statements = 0;
  const run = db.query;
  db.query = (...args) => { statements++; return run(...args); };
  const made = await api('/demos', { method: 'POST', body: { name: 'Fast demo' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.ok(statements < 40, `demo creation used ${statements} statements`);
  statements = 0;
  const assigned = await api(`/demos/${made.body.demo.id}/assign`, { method: 'POST', body: { name: 'Fast store', slug: 'fast-store' } });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
  assert.ok(statements < 40, `assignment used ${statements} statements`);
  assert.equal(assigned.body.admin.id, 'admin', 'no e-mail or user name needed');
  assert.ok(assigned.body.admin.password);
  const clients = await db.query('SELECT COUNT(*) AS n FROM clients WHERE tenant_id=$1', [assigned.body.tenant.id]);
  assert.equal(Number(clients[0].n), 4);
  const items = await db.query('SELECT COUNT(*) AS n FROM content_items WHERE tenant_id=$1', [assigned.body.tenant.id]);
  assert.ok(Number(items[0].n) > 100);
});

test('credit limit: a store stops at its limit (402), a refused render takes nothing, the super admin can raise or reset it, stores never share a counter', async () => {
  const { api, backend, imageApi } = await setup();
  backend.bundles.get('default'); // warm
  const a = (await api('/tenants', { method: 'POST', body: { name: 'Store A', slug: 'credit-a', creditLimit: 2 } })).body;
  const b = (await api('/tenants', { method: 'POST', body: { name: 'Store B', slug: 'credit-b' } })).body;
  assert.equal(a.tenant.creditLimit, 2);
  assert.equal(b.tenant.creditLimit, null, 'no limit = unlimited');
  // Both stores run on the deployment's own key (api mode "own": nothing changes for them).
  for (const slug of ['credit-a', 'credit-b']) {
    const owner = await login(backend, slug, 'admin', slug === 'credit-a' ? a.admin.password : b.admin.password);
    assert.equal((await call(backend, `/${slug}/api/admin/ai/keys`, { method: 'PATCH', headers: owner, body: { pollinations: 'sk_store_key_123456' } })).status, 200);
  }
  const ca = await clientOf(backend, 'credit-a', a.tenant.id), cb = await clientOf(backend, 'credit-b', b.tenant.id);
  assert.equal((await render(backend, 'credit-a', ca)).status, 200);
  assert.equal((await render(backend, 'credit-a', ca)).status, 200);
  const calls = imageApi.calls.length;
  const refused = await render(backend, 'credit-a', ca);
  assert.equal(refused.status, 402);
  assert.equal(refused.body.error, 'STORE_CREDITS_EXHAUSTED');
  assert.equal(imageApi.calls.length, calls, 'no provider call once the limit is reached');
  let view = (await api(`/tenants/${a.tenant.id}`)).body;
  assert.deepEqual([view.creditLimit, view.creditsUsed], [2, 2]);
  assert.equal((await render(backend, 'credit-b', cb)).status, 200, 'another store is not affected');
  assert.equal((await api(`/tenants/${b.tenant.id}`)).body.creditsUsed, 1);
  // The store's admin sees its own allowance only.
  const owner = await login(backend, 'credit-a', 'admin', a.admin.password);
  const info = await call(backend, '/credit-a/api/admin/instance', { headers: owner });
  assert.deepEqual(info.body.credits, { limit: 2, used: 2, left: 0 });
  assert.equal(info.body.apiMode, 'own');
  // Raise the limit: rendering works again.
  assert.equal((await api(`/tenants/${a.tenant.id}`, { method: 'PATCH', body: { creditLimit: 3 } })).body.creditLimit, 3);
  assert.equal((await render(backend, 'credit-a', ca)).status, 200);
  assert.equal((await render(backend, 'credit-a', ca)).status, 402);
  assert.equal((await api(`/tenants/${a.tenant.id}`, { method: 'PATCH', body: { resetUsed: true } })).body.creditsUsed, 0);
  assert.equal((await api(`/tenants/${a.tenant.id}`, { method: 'PATCH', body: { creditLimit: null } })).body.creditLimit, null);
  for (const bad of [-1, 1.5, 'abc', 1e12]) assert.equal((await api(`/tenants/${a.tenant.id}`, { method: 'PATCH', body: { creditLimit: bad } })).status, 400, String(bad));
  // A tenant admin can never change its own limit or policy.
  const self = await call(backend, '/credit-a/api/super-admin/tenants/' + a.tenant.id, { method: 'PATCH', headers: owner, body: { creditLimit: null } });
  assert.ok([401, 404].includes(self.status), String(self.status));
});

test('a failed generation gives the credit back', async () => {
  const failing = { calls: [], fetch: async () => ({ ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }) };
  const { api, backend } = await setup(failing);
  const t = (await api('/tenants', { method: 'POST', body: { name: 'Refund', slug: 'refund-shop', creditLimit: 5 } })).body;
  const owner = await login(backend, 'refund-shop', 'admin', t.admin.password);
  await call(backend, '/refund-shop/api/admin/ai/keys', { method: 'PATCH', headers: owner, body: { pollinations: 'sk_store_key_123456' } });
  const client = await clientOf(backend, 'refund-shop', t.tenant.id);
  const out = await render(backend, 'refund-shop', client);
  assert.notEqual(out.status, 200);
  assert.equal((await api(`/tenants/${t.tenant.id}`)).body.creditsUsed, 0, 'nothing was produced, nothing is charged');
});

test('API manager: keys are write-only, one shared default or one per store, managed stores ignore (and cannot change) their own keys', async () => {
  const { api, backend, imageApi } = await setup();
  assert.equal((await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'pollinations', apiKey: 'short' } })).status, 400, 'key shape');
  assert.equal((await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'nope', apiKey: 'sk_platform_aaaaaa111111' } })).status, 400);
  assert.equal((await api('/apis', { method: 'POST', body: { kind: 'text', provider: 'custom', apiKey: 'sk_platform_aaaaaa111111', baseUrl: 'http://localhost/v1', model: 'm' } })).status, 400, 'private / non-https URL refused');
  const shared = await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'pollinations', label: 'Shared image', apiKey: 'sk_platform_aaaaaa111111' } });
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  assert.equal(shared.body.isDefault, true, 'the first connection of a kind is the default');
  assert.equal(shared.body.keyHint, '…1111');
  const own = await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'pollinations', label: 'Store B only', apiKey: 'sk_platform_bbbbbb222222' } });
  assert.equal(own.body.isDefault, false);
  const listed = JSON.stringify((await api('/apis')).body);
  assert.ok(!listed.includes('sk_platform_'), 'no route returns a key');

  const a = (await api('/tenants', { method: 'POST', body: { name: 'Store A', slug: 'mgd-a', apiMode: 'platform' } })).body;
  const b = (await api('/tenants', { method: 'POST', body: { name: 'Store B', slug: 'mgd-b', apiMode: 'platform' } })).body;
  const c = (await api('/tenants', { method: 'POST', body: { name: 'Store C', slug: 'mgd-c' } })).body; // keeps its own keys
  assert.equal((await api(`/tenants/${b.tenant.id}`, { method: 'PATCH', body: { apiLinks: { image: own.body.id } } })).body.apiLinks.image, own.body.id);
  assert.equal((await api(`/tenants/${b.tenant.id}`, { method: 'PATCH', body: { apiLinks: { image: 'api_000000000000' } } })).status, 400, 'link to a connection that does not exist');
  assert.equal((await api(`/tenants/${b.tenant.id}`, { method: 'PATCH', body: { apiLinks: { text: own.body.id } } })).status, 400, 'link of the wrong kind');
  const usage = (await api('/apis')).body.apis;
  assert.deepEqual([usage.find(x => x.id === shared.body.id).stores, usage.find(x => x.id === own.body.id).stores], [1, 1]);

  const oa = await login(backend, 'mgd-a', 'admin', a.admin.password), ob = await login(backend, 'mgd-b', 'admin', b.admin.password), oc = await login(backend, 'mgd-c', 'admin', c.admin.password);
  // The store keeps its own key by default; a managed store is locked out of the key routes.
  assert.equal((await call(backend, '/mgd-c/api/admin/ai/keys', { method: 'PATCH', headers: oc, body: { pollinations: 'sk_store_c_key_333333' } })).status, 200);
  for (const [slug, token] of [['mgd-a', oa], ['mgd-b', ob]]) {
    const locked = await call(backend, `/${slug}/api/admin/ai/keys`, { method: 'PATCH', headers: token, body: { pollinations: 'sk_store_key_999999' } });
    assert.deepEqual([locked.status, locked.body.error], [403, 'API_MANAGED_BY_PLATFORM']);
    assert.equal((await call(backend, `/${slug}/api/admin/chat/keys`, { method: 'PATCH', headers: token, body: { gemini: 'sk_store_key_9999999999' } })).status, 403);
    assert.equal((await call(backend, `/${slug}/api/admin/chat/config`, { method: 'PUT', headers: token, body: { position: 'before' } })).status, 403);
    assert.equal((await call(backend, `/${slug}/api/admin/ai/status`, { headers: token })).body.managed, true);
    assert.equal((await call(backend, `/${slug}/api/admin/instance`, { headers: token })).body.apiMode, 'platform');
  }
  assert.equal((await call(backend, '/mgd-c/api/admin/ai/status', { headers: oc })).body.managed, false);
  // Which key each store's renders actually carry.
  const clientA = await clientOf(backend, 'mgd-a', a.tenant.id), clientB = await clientOf(backend, 'mgd-b', b.tenant.id), clientC = await clientOf(backend, 'mgd-c', c.tenant.id);
  for (const [slug, client] of [['mgd-a', clientA], ['mgd-b', clientB], ['mgd-c', clientC]]) assert.equal((await render(backend, slug, client)).status, 200);
  const keys = imageApi.calls.map(call => call.auth);
  assert.deepEqual(keys, ['Bearer sk_platform_aaaaaa111111', 'Bearer sk_platform_bbbbbb222222', 'Bearer sk_store_c_key_333333']);
  // Store keys saved while the store was on "own" are ignored while managed, and used again when the platform lets go.
  await api(`/tenants/${c.tenant.id}`, { method: 'PATCH', body: { apiMode: 'platform' } });
  backend.bundles.platform.forget();
  assert.equal((await render(backend, 'mgd-c', clientC)).status, 200);
  assert.equal(imageApi.calls.at(-1).auth, 'Bearer sk_platform_aaaaaa111111');
  await api(`/tenants/${c.tenant.id}`, { method: 'PATCH', body: { apiMode: 'own' } });
  assert.equal((await render(backend, 'mgd-c', clientC)).status, 200);
  assert.equal(imageApi.calls.at(-1).auth, 'Bearer sk_store_c_key_333333');

  // Rotating the platform key reaches managed stores at once; deleting the linked connection falls back to the shared default.
  assert.equal((await api(`/apis/${shared.body.id}`, { method: 'PATCH', body: { apiKey: 'sk_platform_rotated_4444' } })).body.keyHint, '…4444');
  assert.equal((await render(backend, 'mgd-a', clientA)).status, 200);
  assert.equal(imageApi.calls.at(-1).auth, 'Bearer sk_platform_rotated_4444');
  assert.equal((await api(`/apis/${own.body.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await api(`/tenants/${b.tenant.id}`)).body.apiLinks, {});
  assert.equal((await render(backend, 'mgd-b', clientB)).status, 200);
  assert.equal(imageApi.calls.at(-1).auth, 'Bearer sk_platform_rotated_4444');
  // A managed store whose kind has no connection has no key at all (it never falls back to something it typed).
  assert.equal((await api(`/apis/${shared.body.id}`, { method: 'PATCH', body: { enabled: false } })).body.enabled, false);
  const before = imageApi.calls.length;
  const none = await render(backend, 'mgd-a', clientA);
  assert.ok([200, 503].includes(none.status));
  assert.ok(imageApi.calls.slice(before).every(call => !String(call.auth).includes('sk_store')), 'the store key is never used while managed');
  // Audit trail has no key in it.
  const log = JSON.stringify((await api('/audit')).body);
  assert.ok(log.includes('api.create') && log.includes('api.update') && log.includes('api.delete') && log.includes('tenant.policy'));
  assert.ok(!log.includes('sk_platform_'));
});

test('the API manager and policy are for the super admin only; a tenant payload never carries a platform key or another store', async () => {
  const { api, backend } = await setup();
  await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'pollinations', apiKey: 'sk_platform_aaaaaa111111' } });
  const t = (await api('/tenants', { method: 'POST', body: { name: 'Solo', slug: 'solo-shop', apiMode: 'platform', creditLimit: 9 } })).body;
  const owner = await login(backend, 'solo-shop', 'admin', t.admin.password);
  assert.equal((await call(backend, '/api/super-admin/apis')).status, 401);
  assert.equal((await call(backend, '/api/super-admin/apis', { headers: owner })).status, 401);
  assert.equal((await call(backend, '/solo-shop/api/super-admin/apis', { headers: owner })).status, 404);
  for (const url of ['/solo-shop/api/admin/instance', '/solo-shop/api/admin/ai/status', '/solo-shop/api/admin/chat/status', '/solo-shop/api/ai/status', '/solo-shop/api/content']) {
    const r = await call(backend, url, { headers: owner });
    assert.ok(!JSON.stringify(r.body ?? r.text ?? '').includes('sk_platform_'), url);
  }
  const stats = (await api('/stats')).body;
  assert.equal(stats.platformManaged, 1);
  assert.equal(stats.apis, 1);
});

test('the store admin sees its own credit limit (session + sync), kept current as credits are used; the console sets it at demo creation', async () => {
  const { api, backend, db } = await setup();
  const t = (await api('/tenants', { method: 'POST', body: { name: 'Ask', slug: 'ask-shop', creditLimit: 5 } })).body;
  const owner = await login(backend, 'ask-shop', 'admin', t.admin.password);
  const first = (await call(backend, '/ask-shop/api/admin/session', { headers: owner })).body;
  assert.deepEqual(first.instance.credits, { limit: 5, used: 0, left: 5 });
  const v1 = (await call(backend, '/ask-shop/api/sync', { headers: owner })).body.credits;
  assert.equal(typeof v1, 'number');
  // Using a credit moves the sync version, so every open admin screen re-reads the allowance.
  const platform = backend.bundles.get(t.tenant.id).platform;
  assert.equal(await platform.consume(2), true);
  const v2 = (await call(backend, '/ask-shop/api/sync', { headers: owner })).body.credits;
  assert.ok(v2 > v1, 'consume bumps the credits version');
  assert.deepEqual((await call(backend, '/ask-shop/api/admin/session', { headers: owner })).body.instance.credits, { limit: 5, used: 2, left: 3 });
  await platform.refund(1);
  assert.ok((await call(backend, '/ask-shop/api/sync', { headers: owner })).body.credits > v2, 'refund bumps it too');
  // Raising the limit in the console is visible at once, and never leaks to anonymous sync or another store.
  await api(`/tenants/${t.tenant.id}`, { method: 'PATCH', body: { creditLimit: 50 } });
  assert.equal((await call(backend, '/ask-shop/api/admin/session', { headers: owner })).body.instance.credits.limit, 50);
  assert.equal((await call(backend, '/ask-shop/api/sync')).body.credits, null, 'anonymous visitors see no credits version');
  assert.equal((await call(backend, '/api/admin/session', { headers: owner })).status, 401);
  // A demo is created with its own limit; its admin sees it.
  const demo = (await api('/demos', { method: 'POST', body: { name: 'Limit Demo', creditLimit: 12 } })).body;
  assert.equal(demo.demo.creditLimit, 12);
  const demoAdmin = await login(backend, demo.demo.slug, 'admin', demo.admin.password);
  assert.equal((await call(backend, `/${demo.demo.slug}/api/admin/session`, { headers: demoAdmin })).body.instance.credits.limit, 12);
  const unlimited = (await api('/demos', { method: 'POST', body: { name: 'Free Demo', creditLimit: '' } })).body;
  assert.equal(unlimited.demo.creditLimit, null);
  // The old request endpoints are gone.
  assert.equal((await call(backend, '/ask-shop/api/admin/change-requests', { headers: owner })).status, 404);
  void db;
});
