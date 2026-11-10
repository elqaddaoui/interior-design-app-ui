const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { passwordProblem } = require('../server/admins');
const demo = require('../server/assistant/demo');
const { freshDb, closeShared } = require('./test-db');

test.after(closeShared);

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(k, v) { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
async function setup(env = {}) {
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', CHAT_RATE_LIMIT: '2000', ...env }, db: await freshDb() });
  const login = (email = 'admin', password = 'admin') => call(backend, '/api/admin/login', { method: 'POST', body: { email, password }, headers: native });
  const first = await login();
  const admin = { authorization: `Bearer ${first.body.token}` };
  return { backend, login, admin, as: token => ({ authorization: `Bearer ${token}` }) };
}

/* ---------------------------------------------------------------- admin account */
test('profile: read, edit, validation, e-mail unique, avatar and credits rules', async () => {
  const { backend, admin } = await setup();
  const first = await call(backend, '/api/admin/account', { headers: admin });
  assert.equal(first.status, 200);
  assert.equal(first.body.username, 'admin');
  assert.equal(first.body.defaultPassword, true, 'the built-in password is flagged');
  assert.equal(first.body.credits, null, 'unlimited by default');

  const patch = body => call(backend, '/api/admin/account', { method: 'PATCH', headers: admin, body });
  const ok = await patch({ name: '  Sara  Alami ', email: 'Sara@Dwira.APP', phone: '+212 600-11 22 33', title: 'Owner' });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.name, ok.body.email, ok.body.phone, ok.body.title], ['Sara  Alami'.replace('  ', ' ') === ok.body.name ? ok.body.name : 'Sara Alami', 'sara@dwira.app', '+212600112233', 'Owner']);
  assert.equal((await patch({ email: 'not-an-email' })).body.error, 'INVALID_EMAIL');
  assert.equal((await patch({ phone: '12' })).body.error, 'INVALID_PHONE');
  assert.equal((await patch({ credits: -3 })).body.error, 'INVALID_CREDITS');
  assert.equal((await patch({ credits: 1.5 })).body.error, 'INVALID_CREDITS');
  assert.equal((await patch({ avatar: 'javascript:alert(1)' })).body.error, 'INVALID_AVATAR');
  assert.equal((await patch({ credits: 250 })).body.credits, 250);
  assert.equal((await patch({ credits: null })).body.credits, null);
  assert.equal((await patch({ avatar: '' })).status, 200);
  assert.equal((await call(backend, '/api/admin/account', { method: 'PATCH', body: { name: 'x' } })).status, 401, 'needs a session');
});

test('password: wrong current, weak, same, then the default stops working and other devices are signed out', async () => {
  const { backend, login, admin, as } = await setup();
  const other = (await login()).body.token;
  const change = (current, next) => call(backend, '/api/admin/account/password', { method: 'POST', headers: admin, body: { current, next } });
  assert.equal((await change('nope', 'Str0ng#Pass-2026')).status, 403);
  assert.equal((await change('admin', 'admin123')).body.error, 'WEAK_PASSWORD');
  assert.equal((await change('admin', 'short')).body.error, 'WEAK_PASSWORD');
  assert.equal((await change('admin', 'admin')).body.error, 'SAME_PASSWORD');
  const done = await change('admin', 'Str0ng#Pass-2026');
  assert.equal(done.status, 200);
  assert.equal(done.body.defaultPassword, false);
  assert.equal((await login('admin', 'admin')).status, 401, 'the default password no longer opens the panel');
  assert.equal((await login('admin', 'Str0ng#Pass-2026')).status, 200);
  assert.equal((await call(backend, '/api/admin/account', { headers: as(other) })).status, 401, 'the other device was signed out');
  assert.equal((await call(backend, '/api/admin/account', { headers: admin })).status, 200, 'this device stays signed in');
  // And it can be changed again, now checked against the stored password.
  assert.equal((await change('admin', 'Another#Pass-2027')).status, 403);
  assert.equal((await change('Str0ng#Pass-2026', 'Another#Pass-2027')).status, 200);
});

test('login by e-mail after the profile has one; wrong password stays 401', async () => {
  const { backend, login, admin } = await setup();
  await call(backend, '/api/admin/account', { method: 'PATCH', headers: admin, body: { email: 'boss@dwira.app' } });
  await call(backend, '/api/admin/account/password', { method: 'POST', headers: admin, body: { current: 'admin', next: 'Str0ng#Pass-2026' } });
  assert.equal((await login('BOSS@dwira.app', 'Str0ng#Pass-2026')).status, 200);
  assert.equal((await login('boss@dwira.app', 'wrong')).status, 401);
  assert.equal((await login('', '')).status, 401);
});

test('sessions: list marks this device, revoke one, revoke the rest, never the current one', async () => {
  const { backend, login, admin, as } = await setup();
  const second = (await login()).body.token;
  const list = (await call(backend, '/api/admin/account/sessions', { headers: admin })).body.sessions;
  assert.equal(list.length, 2);
  assert.equal(list.filter(s => s.current).length, 1);
  const mine = list.find(s => s.current), theirs = list.find(s => !s.current);
  assert.equal((await call(backend, `/api/admin/account/sessions/${mine.id}`, { method: 'DELETE', headers: admin })).body.error, 'CURRENT_SESSION');
  assert.equal((await call(backend, `/api/admin/account/sessions/${theirs.id}`, { method: 'DELETE', headers: admin })).status, 200);
  assert.equal((await call(backend, '/api/admin/account', { headers: as(second) })).status, 401);
  const third = (await login()).body.token;
  assert.equal((await call(backend, '/api/admin/account/sessions', { method: 'DELETE', headers: admin })).status, 200);
  assert.equal((await call(backend, '/api/admin/account', { headers: as(third) })).status, 401);
  assert.equal((await call(backend, '/api/admin/account', { headers: admin })).status, 200);
});

test('environment admin (ADMIN_EMAIL) still signs in, default disabled', async () => {
  const { hashPassword } = require('../server/admins');
  const env = { DISABLE_DEFAULT_ADMIN: 'true', ADMIN_EMAIL: 'Owner@Dwira.app', ADMIN_PASSWORD_HASH: hashPassword('Env#Password-2026') };
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', ...env }, db: await freshDb() });
  const login = (email, password) => call(backend, '/api/admin/login', { method: 'POST', body: { email, password }, headers: native });
  assert.equal((await login('admin', 'admin')).status, 401);
  const ok = await login('owner@dwira.app', 'Env#Password-2026');
  assert.equal(ok.status, 200);
  const account = await call(backend, '/api/admin/account', { headers: { authorization: `Bearer ${ok.body.token}` } });
  assert.equal(account.body.email, 'owner@dwira.app', 'the account starts filled in with the login e-mail');
  assert.equal(account.body.defaultPassword, false);
});

test('password rules are pure and strict', () => {
  assert.equal(passwordProblem('Str0ng#Pass'), '');
  for (const bad of ['', 'short', 'password', '11111111', 'aaaaaaaa', 'admin123']) assert.equal(passwordProblem(bad), 'WEAK_PASSWORD', bad);
  assert.equal(passwordProblem('sara@dwira.app', { email: 'sara@dwira.app' }), 'WEAK_PASSWORD');
});

/* ---------------------------------------------------------------- demo messages */
const item = (id, extra = {}) => ({ id, enabled: true, icon: 'sofa-outline', label: { dar: id, ar: id, fr: id }, mode: 'click', reply: { type: 'text', text: { dar: 'a', ar: 'a', fr: 'a' } }, followUps: [], cta: 'none', ...extra });

test('demo config is sanitised on save: bounds, follow-ups only to existing others, bad shapes refused', async () => {
  const { backend, admin } = await setup();
  const save = demoConfig => call(backend, '/api/admin/doc/assistant', { method: 'PATCH', headers: admin, body: { demo: demoConfig } });
  const ok = await save({ enabled: true, title: { fr: 'Titre' }, items: [item('a', { followUps: ['b', 'a', 'b', 'ghost'], icon: 'Bad Icon!', cta: 'hack', mode: 'weird' }), item('b')] });
  assert.equal(ok.status, 200);
  const [a] = ok.body.demo.items;
  assert.deepEqual(a.followUps, ['b'], 'no self, no duplicate, no unknown id');
  assert.equal(a.icon, 'message-text-outline');
  assert.equal(a.cta, 'none');
  assert.equal(a.mode, 'click');
  assert.equal(ok.body.demo.title.fr, 'Titre');
  assert.equal((await save({ enabled: true, items: [item('a'), item('a')] })).status, 400, 'duplicate id');
  assert.equal((await save({ enabled: true, items: [item('x y')] })).status, 400, 'invalid id');
  assert.equal((await save({ enabled: true, items: [item('a', { label: { dar: '', ar: '', fr: '' } })] })).status, 400, 'a label is required');
  assert.equal((await save({ enabled: true, items: Array.from({ length: 31 }, (_, i) => item(`i${i}`)) })).status, 400, 'at most 30');
  assert.equal((await save('nope')).status, 400);
});

test('demo: public click counter, admin stats; tampering is refused', async () => {
  const { backend, admin } = await setup();
  const u = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Amine Alaoui', phone: '0611111111' }, headers: native });
  const client = { 'x-user-token': u.body.token };
  assert.equal((await call(backend, '/api/chat/demo-click', { method: 'POST', body: { id: 'prices' } })).status, 400, 'needs a client token');
  for (let i = 0; i < 3; i++) assert.equal((await call(backend, '/api/chat/demo-click', { method: 'POST', headers: client, body: { id: 'prices' } })).status, 200);
  assert.equal((await call(backend, '/api/chat/demo-click', { method: 'POST', headers: client, body: { id: "x'; DROP TABLE settings;--" } })).status, 400);
  const stats = await call(backend, '/api/admin/assistant/demo', { headers: admin });
  assert.equal(stats.body.stats.prices.used, 3);
  assert.ok(stats.body.stats.prices.last > 0);
  assert.equal((await call(backend, '/api/admin/assistant/demo')).status, 401);
});

test('popular questions: grouped by meaning, greetings skipped, only customer text, ranked by distinct chats', () => {
  const chat = (...texts) => ({ messages: texts.map((text, i) => ({ role: 'user', text, createdAt: 1000 + i })).concat([{ role: 'assistant', text: 'chhal taman secret reply', createdAt: 9 }]) });
  const list = demo.popular([
    chat('Salam', 'chhal taman dyal pro?'), chat('combien ça coûte ?'), chat('how much is it'), chat('bghit nbda design ديال salon'),
    chat('bghit nbda design ديال salon'), chat('bonjour'), chat('ok'), chat('kifach nsayb design dial salon'),
  ]);
  assert.equal(list[0].intent, 'pricing', 'three different wordings, one meaning');
  assert.equal(list[0].chats, 3);
  assert.ok(!list.some(x => /salam|bonjour/i.test(x.text)), 'greetings are not questions');
  assert.ok(!list.some(x => /secret/.test(x.text)), 'assistant text is never read');
  assert.ok(list.every(x => x.text.length >= 4), 'too-short messages ("ok") are dropped');
  assert.deepEqual(demo.popular(null), []);
  assert.deepEqual(demo.popular([{ messages: 'bad' }, null]), []);
});
