/**
 * (1) The "Too many requests" fix: /api/health and the signed-in console have their own rate-limit buckets, and the visitor address is read from
 *     the proxy's headers when the peer is a local/private proxy (otherwise every visitor shares one bucket).
 * (2) Web Push for the super admin console: devices register, every notice is pushed in the language of the device, dead devices are forgotten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { hashPassword } = require('../server/admins');
const { render } = require('../server/notice-push');
const { freshDb, closeShared } = require('./test-db');

const SUPER = { email: 'boss@platform.test', password: 'Platform-Secret-123' };
const ENV = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', STATIC_DIR: path.join(__dirname, 'no-such-dist'), SUPERADMIN_EMAIL: SUPER.email, SUPERADMIN_PASSWORD_HASH: hashPassword(SUPER.password) };
test.after(closeShared);

function call(backend, url, { method = 'GET', body, headers = {}, ip = '203.0.113.9' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, socket: { remoteAddress: ip } });
    const out = { headers: {} };
    const chunks = [];
    const res = new Writable({ write(chunk, enc, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => { const text = Buffer.concat(chunks).toString(); try { out.body = text ? JSON.parse(text) : undefined; } catch { out.text = text; } resolve(out); });
    backend.handle(req, res);
  });
}
async function boot(env = {}, senders) {
  const db = await freshDb();
  const backend = createBackend({ env: { ...ENV, ...env }, db, senders, media: { storage: null } });
  await backend.db.query('select 1');
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  return backend;
}
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const device = (id, language = 'fr') => ({ language, subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } });

test('health check and console have their own buckets: the public API limit never blocks them', async () => {
  const backend = await boot();
  const ip = '198.51.100.7';
  let last;
  for (let i = 0; i < 305; i++) last = await call(backend, '/api/push/config', { ip });
  assert.equal(last.status, 429);
  assert.equal(last.body.error, 'Too many requests');
  assert.match(last.headers['retry-after'], /^\d+$/, 'tells the client when to come back');
  assert.equal((await call(backend, '/api/health', { ip })).status, 200, 'the health check still answers');
  // the console: a wrong session is 401 (not 429) even though the public bucket of this address is full
  assert.equal((await call(backend, '/api/super-admin/session', { ip })).status, 401);
});

test('behind a proxy on this machine or a private network every visitor has their own bucket; a public peer cannot forge its address', async () => {
  const backend = await boot();
  const via = (client, peer = '10.0.0.5') => call(backend, '/api/push/config', { ip: peer, headers: { 'x-forwarded-for': `1.1.1.1, ${client}` } });
  for (let i = 0; i < 305; i++) await via('198.51.100.1');
  assert.equal((await via('198.51.100.1')).status, 429, 'one noisy visitor is limited');
  assert.equal((await via('198.51.100.2')).status, 200, 'another visitor is not');
  assert.equal((await via('198.51.100.3', '127.0.0.1')).status, 200, 'loopback proxy too');
  // a public peer sending X-Forwarded-For is NOT believed: it stays in its own bucket however it labels itself
  const spoof = n => call(backend, '/api/push/config', { ip: '192.0.2.50', headers: { 'x-forwarded-for': `198.51.100.${n}` } });
  for (let i = 0; i < 305; i++) await spoof(i % 200);
  assert.equal((await spoof(250)).status, 429, 'rotating the header does not give a fresh allowance');
});

test('TRUST_PROXY=false and CLIENT_IP_HEADER', async () => {
  const off = await boot({ TRUST_PROXY: 'false' });
  const viaOff = client => call(off, '/api/push/config', { ip: '10.0.0.5', headers: { 'x-forwarded-for': client } });
  for (let i = 0; i < 305; i++) await viaOff('198.51.100.1');
  assert.equal((await viaOff('198.51.100.2')).status, 429, 'forwarding headers ignored: one shared bucket');
  const named = await boot({ CLIENT_IP_HEADER: 'CF-Connecting-IP' });
  const viaCf = client => call(named, '/api/push/config', { ip: '172.16.0.2', headers: { 'cf-connecting-ip': client, 'x-forwarded-for': '9.9.9.9' } });
  for (let i = 0; i < 305; i++) await viaCf('198.51.100.1');
  assert.equal((await viaCf('198.51.100.1')).status, 429);
  assert.equal((await viaCf('198.51.100.2')).status, 200);
});

test('console push: register, test button reaches the device in its language, notices are pushed, dead devices are forgotten', async () => {
  const sent = [];
  let gone = false;
  const web = async (sub, payload, options) => {
    if (gone && sub.endpoint.endsWith('/dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload), options });
  };
  const backend = await boot({}, { web });
  const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: SUPER });
  assert.equal(signin.status, 200);
  const h = { 'x-super-token': signin.body.token };
  const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { ...h, ...(opts.headers || {}) } });

  assert.equal((await call(backend, '/api/super-admin/push/config')).status, 401);
  assert.equal((await call(backend, '/api/super-admin/push/subscribe', { method: 'POST', body: device('x') })).status, 401);
  const config = await api('/push/config');
  assert.equal(config.status, 200);
  assert.match(config.body.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal(config.body.devices, 0);
  assert.ok(!JSON.stringify(config.body).includes('privateKey'));

  assert.equal((await api('/push/subscribe', { method: 'POST', body: { subscription: { endpoint: 'https://evil.example/x', keys: {} } } })).status, 400, 'only real push services are accepted (no SSRF)');
  assert.equal((await api('/push/subscribe', { method: 'POST', body: device('phone', 'fr') })).body.devices, 1);
  assert.equal((await api('/push/subscribe', { method: 'POST', body: device('phone', 'fr') })).body.devices, 1, 'same device = same row');
  assert.equal((await api('/push/subscribe', { method: 'POST', body: device('tablet', 'dar') })).body.devices, 2);
  assert.equal((await api('/push/subscribe', { method: 'POST', body: device('dead', 'en') })).body.devices, 3);

  const test1 = await api('/notices/test', { method: 'POST', body: {} });
  assert.equal(test1.status, 200);
  assert.deepEqual(test1.body.push, { devices: 3, sent: 3 });
  assert.equal(sent.length, 3, 'one push per device, none from the automatic hook (the test is sent once)');
  const byDevice = Object.fromEntries(sent.map(s => [s.endpoint.split('/').pop(), s]));
  assert.equal(byDevice.phone.payload.title, 'Les notifications fonctionnent');
  assert.equal(byDevice.tablet.payload.title, 'الإشعارات خدامين');
  assert.equal(byDevice.tablet.payload.dir, 'rtl');
  assert.equal(byDevice.dead.payload.title, 'Notifications are working');
  assert.equal(byDevice.phone.payload.url, '/super-admin/limits');
  assert.equal(byDevice.phone.options.urgency, 'high');
  const bell = await api('/notices');
  assert.equal(bell.status, 200, JSON.stringify(bell));
  assert.equal(bell.body.notices[0].code, 'system.test', 'the test is also in the bell');

  // a real warning (raised by the monitors) is pushed automatically
  sent.length = 0;
  gone = true;
  await backend.bundles.platform.notices.add({ kind: 'limits', severity: 'warn', code: 'limits.alert', href: '/super-admin/limits', params: { id: 'neon.storage', pct: 82, level: 'warning' } });
  assert.equal(sent.length, 2, 'the dead device failed');
  assert.equal(byDevice.phone && sent.find(s => s.endpoint.endsWith('/phone')).payload.title, 'Stockage de la base Neon à 82 %');
  assert.equal((await api('/push/config')).body.devices, 2, 'the device that answered 410 was forgotten');

  // unsubscribe
  assert.equal((await api('/push/unsubscribe', { method: 'POST', body: device('nobody') })).body.devices, 2, 'unknown endpoint: nothing changes');
  const keep = device('tablet', 'dar');
  assert.equal((await api('/push/unsubscribe', { method: 'POST', body: { subscription: { endpoint: keep.subscription.endpoint } } })).body.devices, 1);

  // a failing sender never breaks the job that raised the notice
  await api('/push/subscribe', { method: 'POST', body: device('phone', 'fr') });
  const id = await backend.bundles.platform.notices.add({ kind: 'system', severity: 'info', code: 'system.test', params: {}, href: '' });
  assert.match(id, /^nt_/);
});

test('every console sentence exists in the server translations (same text as the console)', () => {
  for (const lang of ['en', 'fr', 'ar', 'dar']) {
    for (const [code, params] of [
      ['limits.alert', { id: 'r2.classA', pct: 91, level: 'critical', days: 4, at: 1800000000000, reserveNeed: 2e9, reserveLeft: 1e9 }],
      ['limits.blind', { service: 'cloudflare' }], ['backup.auto.done', { destination: 'gdrive' }], ['backup.auto.failed', { error: 'X' }],
      ['api.alert', { rule: 'failures', store: 'acme', value: 40, limit: 30, paused: true }], ['api.alert', { rule: 'burst', store: 'acme', value: 400, limit: 300, windowMin: 10 }], ['system.test', {}],
    ]) {
      const { title, body } = render(code, params, lang);
      assert.ok(title && body, `${code}/${lang}`);
      assert.doesNotMatch(`${title} ${body}`, /\{\w+\}/, `${code}/${lang} has an unfilled placeholder`);
      if (lang !== 'en' && code === 'system.test') assert.notEqual(title, 'Notifications are working');
    }
  }
  assert.equal(JSON.stringify(require('../server/notice-texts.json')), JSON.stringify(JSON.parse(require('../scripts/sync-notice-texts').build())), 'run: node scripts/sync-notice-texts.js');
});

test('the console service worker shows pushes, ignores bad payloads and only opens console pages', async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'sa-sw.js'), 'utf8');
  const handlers = {}, shown = [], opened = [], posted = [];
  const windows = [];
  const self = {
    location: { href: 'https://app.test/sa-sw.js', origin: 'https://app.test' },
    addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve(), matchAll: async () => windows, openWindow: async url => { opened.push(url); } },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
  };
  vm.runInNewContext(code, { self, URL, Promise });
  const push = async data => { const waits = []; handlers.push({ data: { json: () => { if (data === 'bad') throw new Error('x'); return data; } }, waitUntil: p => waits.push(p) }); await Promise.all(waits); };
  await push({ id: 'nt_1', title: 'Neon at 90 %', body: 'Back up now', url: 'https://evil.example/x', lang: 'fr' });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Neon at 90 %');
  assert.equal(shown[0].options.data.url, 'https://app.test/super-admin', 'a foreign address falls back to the console');
  await push({ id: 'nt_2', title: 'A', body: 'B', url: '/super-admin/limits' });
  assert.equal(shown[1].options.data.url, 'https://app.test/super-admin/limits');
  await push({ id: 'nt_3', title: 'A', body: 'B', url: '/admin/requests' });
  assert.equal(shown[2].options.data.url, 'https://app.test/super-admin', 'tenant pages are not openable from here');
  await push('bad');
  assert.equal(shown.length, 4, 'an unreadable payload still shows a generic notification (Chrome requires one)');
  // a console window in front: no duplicate pop-up, the page is told to refresh
  windows.push({ url: 'https://app.test/super-admin/limits', visibilityState: 'visible', focused: true, postMessage: m => posted.push(m) });
  await push({ id: 'nt_4', title: 'A', body: 'B' });
  assert.equal(shown.length, 4);
  assert.equal(JSON.stringify(posted[0]), JSON.stringify({ type: 'notices' }));
  await push({ id: 'nt_5', title: 'T', body: 'B', test: true });
  assert.equal(shown.length, 5, 'the test button always shows a notification');
  // click: focuses the open console window or opens one
  let focused = 0;
  windows[0].focus = async () => { focused++; };
  const click = async url => { const waits = []; handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil: p => waits.push(p) }); await Promise.all(waits); };
  await click('https://app.test/super-admin/limits');
  assert.equal(focused, 1);
  assert.equal(JSON.stringify(posted.at(-1)), JSON.stringify({ type: 'open', url: '/super-admin/limits' }));
  windows.length = 0;
  await click('https://app.test/super-admin/limits');
  assert.deepEqual(opened, ['https://app.test/super-admin/limits']);
});
