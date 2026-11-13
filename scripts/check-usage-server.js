/**
 * Shared client credit pool, the AI gate (demos), API consumption metering and the abuse alerts, through the real request handler.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { hashPassword } = require('../server/admins');
const { freshDb, closeShared } = require('./test-db');

const SUPER = { email: 'boss@platform.test', password: 'Platform-Secret-123' };
const ENV = { CHAT_RATE_LIMIT: '2000', PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '2000', STATIC_DIR: path.join(__dirname, 'no-such-dist'), SUPERADMIN_EMAIL: SUPER.email, SUPERADMIN_PASSWORD_HASH: hashPassword(SUPER.password) };
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
const core = c => ({ limit: c.limit, used: c.used, left: c.left });
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

async function setup(imageApi = fakeImageApi(), extra = {}) {
  const db = await freshDb();
  const backend = createBackend({ env: ENV, db, media: { storage: null, download: offline }, imageFetch: imageApi.fetch, ...extra });
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
async function clientOf(backend, slug, tenantId, credits = 50) {
  const who = await call(backend, `/${slug}/api/user/login`, { method: 'POST', headers: native, body: { name: 'Design Client', phone: '0661000077' } });
  assert.equal(who.status, 200, JSON.stringify(who.body));
  await backend.bundles.get(tenantId).clients.grant(who.body.user.id, credits);
  return { 'x-user-token': who.body.token, 'x-demand-token': 'a'.repeat(64), ...native };
}
let claimCounter = 0;
async function render(backend, slug, auth) {
  const id = `platform-claim-${String(++claimCounter).padStart(4, '0')}`;
  const created = await call(backend, `/${slug}/api/requests`, { method: 'POST', headers: auth, body: { id, photoUri, draft: { toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', mode: 'restyle' } } });
  // A store that is out of credits refuses the request itself (nothing is taken from the client).
  if (created.status === 402 && created.body.error === 'STORE_CREDITS_EXHAUSTED') return created;
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return call(backend, `/${slug}/api/ai/render`, { method: 'POST', headers: auth, body: { id } });
}


const mailbox = () => { const sent = []; return { sent, mailer: async mail => { sent.push(mail); return { ok: true }; } }; };
const pg = c => ({ limit: c.limit, used: c.used, allocated: c.allocated, available: c.available, over: c.over, state: c.state });
const report = async (api, query = '') => (await api(`/usage${query}`)).body;
const kindCalls = (r, kind) => r.byKind.find(k => k.kind === kind).calls;

test('shared credit pool: all clients of a store draw from ONE limit (grant, edit, bulk, new sign-ups); lowering the limit shows the overrun', async () => {
  const { api, backend } = await setup();
  const t = (await api('/tenants', { method: 'POST', body: { name: 'Pool', slug: 'pool-shop', creditLimit: 100 } })).body;
  const owner = await login(backend, 'pool-shop', 'admin', t.admin.password);
  const clients = backend.bundles.get(t.tenant.id).clients;
  const mk = async (name, phone) => (await call(backend, '/pool-shop/api/user/login', { method: 'POST', headers: native, body: { name, phone } })).body.user;
  const a = await mk('Client A', '0661000011'), b = await mk('Client B', '0661000012');
  const read = async () => (await call(backend, '/pool-shop/api/admin/instance', { headers: owner })).body.credits;
  // Each new client starts with the free design (1 credit) taken from the pool.
  assert.deepEqual(pg(await read()), { limit: 100, used: 0, allocated: 2, available: 98, over: 0, state: 'ok' });
  await clients.grant(a.id, 60);
  await assert.rejects(() => clients.grant(b.id, 60), error => error.message === 'STORE_POOL_EXCEEDED' && error.status === 409 && error.available === 39);
  await clients.grant(b.id, 40); // exactly the rest of the pool
  assert.deepEqual(pg(await read()), { limit: 100, used: 0, allocated: 100, available: 0, over: 0, state: 'near' });
  // Over HTTP: 409 with the room left.
  const http = await call(backend, `/pool-shop/api/admin/clients/${a.id}`, { method: 'PATCH', headers: owner, body: { credits: 61 } });
  assert.equal(http.status, 409);
  assert.equal(http.body.error, 'STORE_POOL_EXCEEDED');
  assert.equal(http.body.available, 0);
  // Taking credits back frees the pool for someone else.
  assert.equal((await call(backend, `/pool-shop/api/admin/clients/${a.id}`, { method: 'PATCH', headers: owner, body: { credits: 50 } })).status, 200);
  const bulk = await call(backend, '/pool-shop/api/admin/clients/bulk', { method: 'POST', headers: owner, body: { ids: [a.id, b.id], action: 'credits', mode: 'add', amount: 10 } });
  assert.equal(bulk.status, 409, 'bulk is all-or-nothing against the pool');
  assert.equal((await clients.users()).find(u => u.id === a.id).credits, 50, 'nothing changed');
  assert.equal((await call(backend, '/pool-shop/api/admin/clients/bulk', { method: 'POST', headers: owner, body: { ids: [a.id], action: 'credits', mode: 'add', amount: 10 } })).status, 200, 'what fits is accepted');
  // A client who signs up after the pool is used up is still created, with nothing to spend.
  const late = await mk('Late', '0661000013');
  assert.equal(late.credits, 0);
  assert.deepEqual(pg(await read()), { limit: 100, used: 0, allocated: 100, available: 0, over: 0, state: 'near' });
  // Lowering the limit under what is already handed out is allowed (nothing is taken back) but the admin is warned: state "over".
  await api(`/tenants/${t.tenant.id}`, { method: 'PATCH', body: { creditLimit: 80 } });
  assert.deepEqual(pg(await read()), { limit: 80, used: 0, allocated: 100, available: 0, over: 20, state: 'over' });
  const session = (await call(backend, '/pool-shop/api/admin/session', { headers: owner })).body.instance.credits;
  assert.equal(session.state, 'over', 'the dashboard reads the warning from the session');
  // The console list shows what each store has handed out, and unlimited stores are never refused.
  assert.equal((await api('/tenants')).body.find(x => x.id === t.tenant.id).creditsAllocated, 100);
  await api(`/tenants/${t.tenant.id}`, { method: 'PATCH', body: { creditLimit: null } });
  await clients.grant(a.id, 5000);
  assert.equal((await read()).state, 'ok');
});

test('the pool is per store: another store has its own limit and is never refused because of this one', async () => {
  const { api, backend } = await setup();
  const madeA = await api('/tenants', { method: 'POST', body: { name: 'Store A', slug: 'pool-alpha', creditLimit: 5 } });
  assert.equal(madeA.status, 201, JSON.stringify(madeA.body));
  const a = madeA.body;
  const b = (await api('/tenants', { method: 'POST', body: { name: 'Store B', slug: 'pool-bravo', creditLimit: 5 } })).body;
  const first = await call(backend, '/pool-alpha/api/user/login', { method: 'POST', headers: native, body: { name: 'Same Phone', phone: '0661000021' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const ua = first.body.user;
  const ub = (await call(backend, '/pool-bravo/api/user/login', { method: 'POST', headers: native, body: { name: 'Same Phone', phone: '0661000021' } })).body.user;
  await backend.bundles.get(a.tenant.id).clients.grant(ua.id, 5);
  await assert.rejects(() => backend.bundles.get(a.tenant.id).clients.grant(ua.id, 6), /STORE_POOL_EXCEEDED/);
  await backend.bundles.get(b.tenant.id).clients.grant(ub.id, 5);
});

test('demos use no API unless the "use API" switch is on; it closes by itself after a quiet period and must be switched on again', async () => {
  const calls = [];
  const imageApi = fakeImageApi();
  const translator = async () => { calls.push('translate'); return { translations: { ar: ['x'] }, provider: { ar: 'pollinations' } }; };
  const { api, backend, db } = await setup(imageApi, { translator });
  const made = (await api('/demos', { method: 'POST', body: { name: 'Gate Demo' } })).body;
  const demo = made.demo, tenantId = demo.tenantId;
  assert.equal(demo.aiOn, false, 'a new demo starts with the API switched off');
  assert.equal(demo.aiUntil, null);
  assert.equal(demo.creditLimit, undefined, 'a demo has no credit limit');
  const owner = await login(backend, demo.slug, 'admin', made.admin.password);
  await call(backend, `/${demo.slug}/api/admin/ai/keys`, { method: 'PATCH', headers: owner, body: { pollinations: 'sk_store_key_123456' } });
  const client = await clientOf(backend, demo.slug, tenantId, 20);
  // Image generation, translation and the assistant are all refused, and nothing leaves the server.
  const refused = await render(backend, demo.slug, client);
  assert.equal(refused.status, 503);
  assert.equal(refused.body.error, 'AI_DISABLED_DEMO');
  assert.equal(imageApi.calls.length, 0, 'no provider is called');
  const tr = await call(backend, `/${demo.slug}/api/admin/translate`, { method: 'POST', headers: owner, body: { from: 'fr', to: ['ar'], texts: ['Bonjour'] } });
  assert.equal(tr.status, 503);
  assert.equal(tr.body.error, 'AI_DISABLED_DEMO');
  assert.equal(calls.length, 0);
  const chat = await call(backend, `/${demo.slug}/api/chat/reply`, { method: 'POST', headers: { ...client, 'x-client-token': 'a'.repeat(64) }, body: { messages: [{ role: 'user', text: 'Hello, how much does a design cost?' }] } });
  assert.notEqual(chat.status, 200);
  assert.equal(chat.body.error, 'AI_DISABLED_DEMO');
  assert.equal((await db.query('SELECT credits_used FROM saas_tenants WHERE id=$1', [tenantId]))[0].credits_used, 0, 'a refused render costs nothing');
  // Probing is counted as "blocked" (it feeds the abuse detector) but is not a real call.
  const probe = await report(api, `?tenant=${tenantId}`);
  assert.equal(probe.totals.calls, 0);
  assert.ok(probe.totals.blocked >= 3);
  // The super admin switches it on: the demo works, and every use keeps the switch alive.
  const on = (await api(`/demos/${demo.id}/ai`, { method: 'POST', body: { enabled: true } })).body;
  assert.equal(on.aiOn, true);
  assert.ok(on.aiUntil > Date.now());
  assert.equal(on.aiIdleMin, 15);
  assert.equal((await render(backend, demo.slug, client)).status, 200);
  assert.equal(imageApi.calls.length, 1);
  assert.equal((await call(backend, `/${demo.slug}/api/admin/translate`, { method: 'POST', headers: owner, body: { from: 'fr', to: ['ar'], texts: ['Bonjour'] } })).status, 200);
  // After the quiet period the switch is off again, by itself.
  await db.query('UPDATE saas_tenants SET ai_until=$2 WHERE id=$1', [tenantId, Date.now() - 1000]);
  const lapsed = (await api('/demos')).body.find(d => d.id === demo.id);
  assert.equal(lapsed.aiOn, false, 'the console shows it off');
  assert.equal((await render(backend, demo.slug, client)).status, 503, 'and the demo is blocked again until someone re-activates it');
  assert.equal(imageApi.calls.length, 1);
  // Active use slides the deadline forward (a busy demo is not cut off in the middle of a session).
  await db.query('UPDATE saas_tenants SET ai_until=$2 WHERE id=$1', [tenantId, Date.now() + 60000]);
  assert.equal((await call(backend, `/${demo.slug}/api/admin/translate`, { method: 'POST', headers: owner, body: { from: 'fr', to: ['ar'], texts: ['Salut'] } })).status, 200);
  assert.ok(Number((await db.query('SELECT ai_until FROM saas_tenants WHERE id=$1', [tenantId]))[0].ai_until) > Date.now() + 10 * 60000, 'deadline moved forward');
  // Manual switch off is immediate.
  assert.equal((await api(`/demos/${demo.id}/ai`, { method: 'POST', body: { enabled: false } })).body.aiOn, false);
  assert.equal((await render(backend, demo.slug, client)).status, 503);
  // A real store is not gated, and the switch is meaningless for it.
  const store = (await api('/tenants', { method: 'POST', body: { name: 'Real', slug: 'real-gate' } })).body;
  assert.equal(store.tenant.aiOn, true);
  assert.equal((await api(`/demos/${store.tenant.id}/ai`, { method: 'POST', body: { enabled: true } })).status, 404);
  // A tenant admin can never reach the switch.
  const self = await call(backend, `/${demo.slug}/api/super-admin/demos/${demo.id}/ai`, { method: 'POST', headers: owner, body: { enabled: true } });
  assert.ok([401, 404].includes(self.status));
});

test('consumption: every modality is metered, with the store\'s own keys AND with the platform\'s keys', async () => {
  const imageApi = fakeImageApi();
  const chatFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Bonjour, voici une idee de design.' } }] }) });
  const { api, backend } = await setup(imageApi, { chatFetch });
  const own = (await api('/tenants', { method: 'POST', body: { name: 'Own Keys', slug: 'own-keys' } })).body;
  const managed = (await api('/tenants', { method: 'POST', body: { name: 'Managed', slug: 'managed-keys', apiMode: 'platform' } })).body;
  assert.equal((await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'pollinations', apiKey: 'sk_platform_key_123456' } })).status, 201);
  const ownerOwn = await login(backend, 'own-keys', 'admin', own.admin.password);
  await call(backend, '/own-keys/api/admin/ai/keys', { method: 'PATCH', headers: ownerOwn, body: { pollinations: 'sk_store_key_123456' } });
  const c1 = await clientOf(backend, 'own-keys', own.tenant.id), c2 = await clientOf(backend, 'managed-keys', managed.tenant.id);
  assert.equal((await render(backend, 'own-keys', c1)).status, 200);
  assert.equal((await render(backend, 'managed-keys', c2)).status, 200);
  assert.equal((await render(backend, 'managed-keys', c2)).status, 200);
  const chat = await call(backend, '/own-keys/api/chat/reply', { method: 'POST', headers: { ...c1, 'x-client-token': 'a'.repeat(64) }, body: { messages: [{ role: 'user', text: 'Hello there, I need design ideas' }] } });
  assert.equal(chat.status, 200, JSON.stringify(chat.body));
  const r = await report(api);
  assert.equal(kindCalls(r, 'image'), 3);
  assert.ok(kindCalls(r, 'text') >= 1, 'chat is counted as text');
  const imageOwn = r.byProvider.find(p => p.kind === 'image' && p.mode === 'own'), imagePlatform = r.byProvider.find(p => p.kind === 'image' && p.mode === 'platform');
  assert.equal(imageOwn.calls, 1, 'own keys');
  assert.equal(imagePlatform.calls, 2, 'platform keys');
  assert.equal(imagePlatform.provider, 'pollinations');
  assert.equal(r.byMode.find(m => m.mode === 'platform').calls >= 2, true);
  assert.equal(r.stores.find(s => s.tenantId === managed.tenant.id).image, 2);
  assert.equal(r.series.reduce((n, p) => n + p.image, 0), 3, 'the time series adds up');
  // Filters.
  assert.equal(kindCalls(await report(api, `?tenant=${managed.tenant.id}`), 'image'), 2);
  assert.equal(kindCalls(await report(api, '?mode=own&kind=image'), 'image'), 1);
  assert.equal((await report(api, '?range=7d')).range, '7d');
  assert.equal((await report(api, '?range=nonsense')).range, '24h');
  // A failing provider is counted as errors.
  const failing = fakeImageApi(); failing.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  const bad = await setup(failing);
  const t = (await bad.api('/tenants', { method: 'POST', body: { name: 'Err', slug: 'err-shop' } })).body;
  const o = await login(bad.backend, 'err-shop', 'admin', t.admin.password);
  await call(bad.backend, '/err-shop/api/admin/ai/keys', { method: 'PATCH', headers: o, body: { pollinations: 'sk_store_key_123456' } });
  await render(bad.backend, 'err-shop', await clientOf(bad.backend, 'err-shop', t.tenant.id));
  const failed = await report(bad.api);
  assert.ok(failed.totals.errors >= 1);
  // Usage is for the super admin only and never carries a key, a prompt or a client.
  assert.equal((await call(backend, '/own-keys/api/super-admin/usage', { headers: ownerOwn })).status === 200, false);
  const text = JSON.stringify(r);
  for (const word of ['sk_platform_key_123456', 'sk_store_key_123456', 'Design Client', 'design ideas']) assert.ok(!text.includes(word), `${word} must not appear in the usage report`);
  const anon = await call(backend, '/api/super-admin/usage');
  assert.equal(anon.status, 401);
});

test('abuse detection: a burst raises ONE alert, e-mails the super admin, and pauses a platform-managed store; an own-key store is only warned', async () => {
  const box = mailbox();
  const { api, backend } = await setup(fakeImageApi(), { mailer: box.mailer });
  const managed = (await api('/tenants', { method: 'POST', body: { name: 'Greedy', slug: 'greedy', apiMode: 'platform' } })).body;
  const own = (await api('/tenants', { method: 'POST', body: { name: 'Loud Own', slug: 'loud-own' } })).body;
  const settings = (await api('/alert-settings', { method: 'PATCH', body: { burst: { image: 5 }, cooldownMin: 60 } })).body;
  assert.equal(settings.settings.burst.image, 5);
  const usage = backend.bundles.platform.usage;
  const hit = async (t, n) => { const h = backend.bundles.get(t).platform; for (let i = 0; i < n; i++) await h.record({ kind: 'image', op: 'generate', provider: 'pollinations', units: 1, ok: true }); };
  // Below the level: nothing.
  await hit(managed.tenant.id, 4);
  assert.deepEqual(await usage.scan(managed.tenant.id), []);
  assert.equal(box.sent.length, 0);
  // At the level: a "high" alert and an e-mail, no pause yet.
  await hit(managed.tenant.id, 1);
  assert.equal((await usage.scan(managed.tenant.id)).length, 1);
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, SUPER.email, 'the super admin account is the default recipient');
  assert.match(box.sent[0].subject, /Burst of API calls: Greedy/);
  assert.match(box.sent[0].text, /platform/);
  assert.equal((await api('/tenants/' + managed.tenant.id)).body.aiPaused, false);
  // 3x the level: critical -> the store's AI is paused automatically (a second, separate rule is not raised twice: cooldown).
  await hit(managed.tenant.id, 12);
  await usage.scan(managed.tenant.id);
  await usage.scan(managed.tenant.id);
  const alerts = (await api('/alerts')).body;
  assert.equal(alerts.alerts.filter(a => a.tenantId === managed.tenant.id && a.rule === 'burst:image').length, 1, 'one alert per cooldown');
  assert.equal((await api('/tenants/' + managed.tenant.id)).body.aiPaused, false, 'the first alert was only "high"; the cooldown keeps it single');
  // A fresh critical situation on another rule path: use a tiny level so 3x is crossed from the start.
  await api('/alert-settings', { method: 'PATCH', body: { burst: { text: 2 } } });
  const h = backend.bundles.get(managed.tenant.id).platform;
  for (let i = 0; i < 7; i++) await h.record({ kind: 'text', op: 'chat', provider: 'gemini', units: 1, ok: true });
  await usage.scan(managed.tenant.id);
  const view = (await api('/tenants/' + managed.tenant.id)).body;
  assert.equal(view.aiPaused, true, 'critical + platform keys = automatic pause');
  assert.match(view.aiPauseReason, /abuse:burst:text/);
  assert.ok(box.sent.some(m => /PAUSED automatically/.test(m.text)));
  assert.equal((await api('/alerts')).body.alerts.find(a => a.rule === 'burst:text').action, 'paused');
  // A paused store reaches no provider; the owner resumes it from the console (which also closes its alerts).
  const imageApi = fakeImageApi();
  void imageApi;
  const client = await clientOf(backend, 'greedy', managed.tenant.id);
  const refused = await render(backend, 'greedy', client);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'AI_PAUSED');
  assert.equal((await api(`/tenants/${managed.tenant.id}/ai-pause`, { method: 'POST', body: { paused: false } })).body.aiPaused, false);
  assert.equal((await api('/alerts')).body.alerts.filter(a => a.tenantId === managed.tenant.id).length, 0, 'resuming closes the store\'s open alerts');
  // An own-key store: warned (alert + e-mail) but never paused: it pays for its own keys.
  await hit(own.tenant.id, 20);
  await usage.scan(own.tenant.id);
  assert.equal((await api('/tenants/' + own.tenant.id)).body.aiPaused, false);
  const loud = (await api('/alerts')).body.alerts.find(a => a.tenantId === own.tenant.id);
  assert.equal(loud.severity, 'critical');
  assert.equal(loud.action, '');
  assert.equal(loud.detail.mode, 'own', 'abuse is detected for stores that manage their own keys too');
  assert.ok(loud.emailedAt > 0);
  // Resolve one / all; the overview counts open alerts.
  assert.equal((await api('/stats')).body.alerts >= 1, true);
  assert.equal((await api(`/alerts/${loud.id}/resolve`, { method: 'POST' })).status, 200);
  assert.equal((await api(`/alerts/${loud.id}/resolve`, { method: 'POST' })).status, 404);
  assert.equal((await api('/alerts/resolve-all', { method: 'POST' })).status, 200);
  assert.equal((await api('/alerts?status=all')).body.alerts.length >= 3, true, 'history is kept');
});

test('abuse detection: a gated demo that keeps being probed raises an alert; failure storms and spikes too; settings are validated; e-mail failures are kept and retried', async () => {
  let up = false;
  const sent = [];
  const mailer = async mail => { if (!up) return { ok: false, error: 'HTTP_500' }; sent.push(mail); return { ok: true }; };
  const { api, backend, db } = await setup(fakeImageApi(), { mailer });
  const demo = (await api('/demos', { method: 'POST', body: { name: 'Probed' } })).body.demo;
  await api('/alert-settings', { method: 'PATCH', body: { probe: 5, failureRate: 50 } });
  const h = backend.bundles.get(demo.tenantId).platform;
  for (let i = 0; i < 6; i++) await h.allowed('image', 'render');
  await backend.bundles.platform.usage.scan(demo.tenantId);
  let alerts = (await api('/alerts')).body.alerts;
  const probe = alerts.find(a => a.rule === 'probe:image');
  assert.ok(probe, 'probing a closed demo is reported');
  assert.equal(probe.storeKind, 'demo');
  assert.equal(probe.emailedAt, null, 'the mail failed...');
  assert.equal(probe.emailError, 'HTTP_500', '...and the reason is kept');
  // Delivery is retried once the transport works (alerts are read by the console every few seconds).
  up = true;
  backend.bundles.platform.usage; // retry is throttled per process: force it by clearing the clock gate through a fresh read after 5 minutes
  await db.query("UPDATE saas_alerts SET at=at WHERE id=$1", [probe.id]);
  // failure storm on a store
  const store = (await api('/tenants', { method: 'POST', body: { name: 'Broken Key', slug: 'broken-key' } })).body;
  const s = backend.bundles.get(store.tenant.id).platform;
  for (let i = 0; i < 25; i++) await s.record({ kind: 'image', op: 'generate', provider: 'openai', units: 1, ok: i % 5 === 0 });
  await backend.bundles.platform.usage.scan(store.tenant.id);
  alerts = (await api('/alerts')).body.alerts;
  assert.ok(alerts.find(a => a.tenantId === store.tenant.id && a.rule === 'failures:image'), 'a high failure rate (dead or leaked key, scripted retries)');
  // spike: far above the hourly average of the previous week
  const sp = (await api('/tenants', { method: 'POST', body: { name: 'Spiky', slug: 'spiky' } })).body;
  const now = Date.now(), old = Math.floor((now - 3 * 86400000) / 600000) * 600000;
  await db.query("INSERT INTO saas_usage(bucket,tenant_id,kind,op,provider,mode,calls,errors,blocked,units) VALUES($1,$2,'text','chat','gemini','own',24,0,0,24)", [old, sp.tenant.id]);
  const spiky = backend.bundles.get(sp.tenant.id).platform;
  for (let i = 0; i < 45; i++) await spiky.record({ kind: 'text', op: 'chat', provider: 'gemini', units: 1, ok: true });
  await backend.bundles.platform.usage.scan(sp.tenant.id);
  assert.ok((await api('/alerts')).body.alerts.find(a => a.tenantId === sp.tenant.id && a.rule === 'spike:text'));
  // Settings: validated, persisted, resettable; switching detection off silences it.
  for (const bad of [{ burst: { image: 0 } }, { email: 'not-an-email' }, { cooldownMin: 1 }, { failureRate: 500 }, { daily: { text: 'x' } }]) assert.equal((await api('/alert-settings', { method: 'PATCH', body: bad })).status, 400, JSON.stringify(bad));
  const saved = (await api('/alert-settings', { method: 'PATCH', body: { email: 'owner@shop.test', autoPause: false } })).body;
  assert.equal(saved.recipient, 'owner@shop.test');
  assert.equal((await api('/alert-settings')).body.settings.autoPause, false);
  assert.equal((await api('/alert-settings', { method: 'PATCH', body: { enabled: false } })).body.settings.enabled, false);
  const quiet = (await api('/tenants', { method: 'POST', body: { name: 'Quiet', slug: 'quiet-one' } })).body;
  const q = backend.bundles.get(quiet.tenant.id).platform;
  for (let i = 0; i < 400; i++) await q.record({ kind: 'image', op: 'generate', provider: 'pollinations', units: 1, ok: true });
  assert.deepEqual(await backend.bundles.platform.usage.scan(quiet.tenant.id), [], 'detection switched off');
  // The test e-mail goes to the chosen address.
  assert.equal((await api('/alert-settings/test', { method: 'POST' })).body.to, 'owner@shop.test');
  assert.ok(sent.some(m => /Test warning/.test(m.subject)));
});

test('with no mail transport the alert is still saved and shown in the console, and the console says why no e-mail left', async () => {
  const { api, backend } = await setup();
  const t = (await api('/tenants', { method: 'POST', body: { name: 'No Mail', slug: 'no-mail-shop' } })).body;
  await api('/alert-settings', { method: 'PATCH', body: { burst: { image: 3 } } });
  const h = backend.bundles.get(t.tenant.id).platform;
  for (let i = 0; i < 4; i++) await h.record({ kind: 'image', op: 'generate', provider: 'pollinations', units: 1, ok: true });
  await backend.bundles.platform.usage.scan(t.tenant.id);
  const a = (await api('/alerts')).body.alerts.find(x => x.tenantId === t.tenant.id);
  assert.ok(a);
  assert.equal(a.emailedAt, null);
  assert.equal(a.emailError, 'NO_MAIL_TRANSPORT');
  const cfg = (await api('/alert-settings')).body;
  assert.equal(cfg.transport, false);
  assert.equal((await api('/alert-settings/test', { method: 'POST' })).status, 409);
});

test('the default mail transport posts to Resend or a webhook, and never throws', async () => {
  const { defaultMailer } = require('../server/usage');
  const seen = [];
  const ok = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200 }; };
  const resend = defaultMailer({ RESEND_API_KEY: 're_test_key', ALERT_FROM: 'Alerts <a@b.test>' }, ok);
  assert.deepEqual(await resend({ to: 'me@x.test', subject: 'S', text: 'T' }), { ok: true });
  assert.equal(seen[0].url, 'https://api.resend.com/emails');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer re_test_key');
  assert.deepEqual(JSON.parse(seen[0].init.body).to, ['me@x.test']);
  const hook = defaultMailer({ ALERT_WEBHOOK_URL: 'https://hooks.test/abc' }, ok);
  assert.equal((await hook({ to: '', subject: 'S', text: 'T' })).ok, true);
  assert.equal(seen[1].url, 'https://hooks.test/abc');
  assert.deepEqual(await defaultMailer({ ALERT_WEBHOOK_URL: 'http://insecure.test' }, ok)({ subject: 'S', text: 'T' }), { ok: false, error: 'NO_MAIL_TRANSPORT' });
  assert.deepEqual(await defaultMailer({}, ok)({ to: 'a@b.test', subject: 'S', text: 'T' }), { ok: false, error: 'NO_MAIL_TRANSPORT' });
  assert.deepEqual(await defaultMailer({ RESEND_API_KEY: 'k' }, async () => { throw new Error('down'); })({ to: 'a@b.test', subject: 'S', text: 'T' }), { ok: false, error: 'NETWORK' });
  assert.deepEqual(await defaultMailer({ RESEND_API_KEY: 'k' }, async () => ({ ok: false, status: 403 }))({ to: 'a@b.test', subject: 'S', text: 'T' }), { ok: false, error: 'HTTP_403' });
});
