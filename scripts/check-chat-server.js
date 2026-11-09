const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createBackend } = require('../server');
const { freshDb, closeShared } = require('./test-db');
const fs = require('node:fs/promises');
const vm = require('node:vm');
const { payloadFor } = require('../server/notifications');

const key = crypto.createECDH('prime256v1');
key.generateKeys();
const device = id => ({ kind: 'web', language: 'fr', subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } } });
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
async function setup() {
  const sent = [];
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '3000' }, db: await freshDb(), senders: { web: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }); } } });
  const adminLogin = await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' }, headers: native });
  const admin = { authorization: `Bearer ${adminLogin.body.token}` };
  const user = async (name, phone) => { const r = await call(backend, '/api/user/login', { method: 'POST', body: { name, phone }, headers: native }); return { id: r.body.user.id, headers: { 'x-user-token': r.body.token } }; };
  return { backend, sent, admin, user };
}
const message = (id, text, role = 'user') => ({ id, role, text, createdAt: Date.now() });

test('each client only ever sees their own conversations, and nobody can read or edit another thread', async () => {
  const { backend, admin, user } = await setup();
  try {
    const a = await user('Amine', '0611111111'), b = await user('Bouchra', '0622222222');
    assert.deepEqual((await call(backend, '/api/user/conversations', { headers: a.headers })).body, [], 'a new user starts empty');
    const created = await call(backend, '/api/user/conversations', { method: 'POST', headers: a.headers, body: { title: 'Salon', messages: [message('m1', 'Bonjour')], updatedAt: 1 } });
    assert.equal(created.status, 200);
    const id = created.body.id;
    assert.equal((await call(backend, '/api/user/conversations', { headers: a.headers })).body.length, 1, 'the owner gets the chat back');
    assert.deepEqual((await call(backend, '/api/user/conversations', { headers: b.headers })).body, [], 'another user sees nothing');
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { headers: b.headers })).status, 404);
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: b.headers, body: { messages: [message('x', 'hijack')] } })).status, 404);
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { method: 'DELETE', headers: b.headers })).body.ok, true, 'delete is scoped to the caller...');
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { headers: a.headers })).status, 200, '...so the owner chat survives');
    assert.equal((await call(backend, '/api/user/conversations')).status, 401, 'signed out: nothing');
    assert.equal((await call(backend, '/api/admin/conversations', { headers: a.headers })).status, 401, 'a client is not an admin');
    const list = await call(backend, '/api/admin/conversations', { headers: admin });
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].clientName, 'Amine');
  } finally { backend.server.emit('close'); }
});

test('a client message notifies admins with a link to that conversation; the admin reply reaches only that client', async () => {
  const { backend, sent, admin, user } = await setup();
  try {
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: admin, body: device('admin-1') });
    const a = await user('Amine', '0611111111'), b = await user('Bouchra', '0622222222');
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: { ...a.headers }, body: { ...device('client-a'), owner: 'client' } });
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: { ...b.headers }, body: { ...device('client-b'), owner: 'client' } });
    sent.length = 0;
    const created = await call(backend, '/api/user/conversations', { method: 'POST', headers: a.headers, body: { title: 'Salon', messages: [message('m1', 'Je veux refaire mon salon')], updatedAt: 1 } });
    const id = created.body.id;
    const chat = sent.filter(p => p.title === 'Nouveau message');
    assert.equal(chat.length, 1);
    assert.equal(chat[0].endpoint.endsWith('admin-1'), true, 'only admin devices');
    assert.equal(chat[0].body, 'Amine: Je veux refaire mon salon');
    assert.equal(chat[0].url, `/admin/chats?target=${id}&open=${id}`);
    // Saving the same thread again (assistant reply) does not notify twice; a new user message does.
    sent.length = 0;
    await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: a.headers, body: { messages: [message('m1', 'Je veux refaire mon salon'), message('m2', 'demo', 'assistant')] } });
    assert.equal(sent.length, 0);
    const again = await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: a.headers, body: { messages: [message('m1', 'Je veux refaire mon salon'), message('m2', 'demo', 'assistant'), message('m3', 'Merci')] } });
    assert.equal(again.status, 200);
    assert.equal(sent.filter(p => p.title === 'Nouveau message').length, 1);

    // Admin reply
    sent.length = 0;
    assert.equal((await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', body: { text: 'x' } })).status, 401);
    assert.equal((await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: '  ' } })).status, 400);
    assert.equal((await call(backend, '/api/admin/conversations/missing', { method: 'POST', headers: admin, body: { text: 'hi' } })).status, 404);
    const replied = await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: 'Bonjour Amine, envoyez une photo' } });
    assert.equal(replied.status, 200);
    assert.equal(replied.body.messages.at(-1).role, 'admin');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint.endsWith('client-a'), true, 'only the owner is notified');
    assert.equal(sent[0].url, `/chat/${id}`);
    assert.equal(sent[0].body, 'Bonjour Amine, envoyez une photo');
    const mine = (await call(backend, `/api/user/conversations/${id}`, { headers: a.headers })).body;
    assert.equal(mine.messages.at(-1).text, 'Bonjour Amine, envoyez une photo');
    // A stale client copy never erases the admin reply, and a client cannot forge one.
    const stale = await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: a.headers, body: { messages: [message('m1', 'Je veux refaire mon salon'), message('forged', 'I am admin', 'admin')] } });
    assert.equal(stale.body.messages.some(m => m.id === 'forged'), false);
    assert.equal(stale.body.messages.some(m => m.role === 'admin' && m.text.startsWith('Bonjour Amine')), true);
    assert.deepEqual((await call(backend, '/api/user/conversations', { headers: b.headers })).body, []);
    // Admin voice note: stored as media, notifies the owner with a mic preview; fake audio or an empty reply is refused.
    sent.length = 0;
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 7)]);
    const voiceNote = await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: '', audio: { uri: `data:audio/webm;codecs=opus;base64,${webm.toString('base64')}`, durationMs: 3210.4 } } });
    assert.equal(voiceNote.status, 200, JSON.stringify(voiceNote.body));
    const note = voiceNote.body.messages.at(-1);
    assert.equal(note.role, 'admin');
    assert.match(note.audio.uri, /^\/api\/media\/[a-f0-9]{32}\.weba$/);
    assert.equal(note.audio.durationMs, 3210);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body, '🎤');
    assert.equal((await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: '', audio: { uri: `data:audio/webm;base64,${Buffer.from('<html>no</html>').toString('base64')}` } } })).status, 400);
    assert.equal((await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: '', audio: { uri: 'https://evil.example/x.mp3' } } })).status, 400);
    assert.equal((await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: '', audio: null } })).status, 400);
    // sync: admins see a `chats` version, clients their own counter.
    const sync = await call(backend, '/api/sync', { headers: admin });
    assert(Number.isInteger(sync.body.chats));
    assert.equal((await call(backend, '/api/sync')).body.chats, null);
  } finally { backend.server.emit('close'); }
});

test('the two master switches gate every delivery path, independently, and the subscriber list shows the state', async () => {
  const { backend, sent, admin, user } = await setup();
  try {
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: admin, body: device('admin-1') });
    const a = await user('Amine', '0611111111');
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: a.headers, body: { ...device('client-a'), owner: 'client' } });
    const off = await user('Silent', '0633333333');
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: off.headers, body: { ...device('client-off'), owner: 'client' } });
    await call(backend, '/api/prefs', { method: 'PATCH', headers: off.headers, body: { notifications: false } });
    const patch = body => call(backend, '/api/admin/doc/settings', { method: 'PATCH', headers: admin, body });
    const list = () => call(backend, '/api/admin/notification-subscribers', { headers: admin });
    const talk = async (n, text) => (await call(backend, '/api/user/conversations', { method: 'POST', headers: a.headers, body: { title: 'T', messages: [message(`m${n}`, text)], updatedAt: 1 } })).body.id;

    let users = (await list()).body;
    assert.equal(users.adminsEnabled, true);
    assert.deepEqual(users.users.map(u => [u.name, u.status, u.devices]), [['Amine', 'on', 1], ['Silent', 'off', 1]]);
    assert.equal((await call(backend, '/api/admin/notification-subscribers')).status, 401);

    // Admin notifications off: chat, lead, request and the test button are all silent; clients still hear about replies.
    assert.equal((await patch({ notifyAdmins: false })).status, 200);
    sent.length = 0;
    const id = await talk(1, 'hello');
    await user('Fresh Lead', '0644444444');
    assert.equal(sent.length, 0, 'no chat or lead push to admins');
    assert.equal((await call(backend, '/api/push/test', { method: 'POST', headers: admin, body: {} })).body.error, 'NOTIFICATIONS_OFF');
    assert.equal(sent.length, 0, 'the test push honours the switch as well');
    await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: 'reply while admins are off' } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].endpoint.endsWith('client-a'), true);

    // User notifications off: replies are silent, admins are notified again once switched on.
    await patch({ notifyAdmins: true, notifyUsers: false });
    sent.length = 0;
    await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: 'second' } });
    assert.equal(sent.length, 0, 'user switch off: no reply push');
    assert.equal((await list()).body.users.every(u => u.status === 'paused'), true);
    await talk(2, 'still there?');
    assert.equal(sent.filter(p => p.title === 'Nouveau message').length, 1, 'admin switch is independent');

    // Back on: per-person preferences still apply (Silent stays off).
    await patch({ notifyUsers: true });
    sent.length = 0;
    await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: 'third' } });
    assert.equal(sent.length, 1);
    users = (await list()).body;
    assert.equal(users.usersEnabled, true);
    assert.deepEqual(users.users.map(u => u.status), ['on', 'off']);
  } finally { backend.server.emit('close'); }
});

test('chat payloads are localised, bounded and safe', () => {
  const p = payloadFor({ id: 'c/1', name: 'N'.repeat(200), whatsapp: '+212611111111', text: 'x'.repeat(500) }, 'ar', 'chat');
  assert.equal(p.title, 'رسالة جديدة');
  assert.equal(p.dir, 'rtl');
  assert(p.body.length < 180);
  assert.equal(p.url, '/admin/chats?target=c%2F1&open=c%2F1');
  assert.equal(payloadFor({ id: 'c1', text: '' }, 'fr', 'reply').body, 'Ouvrez la conversation pour la lire.');
});
test('the service worker opens the right conversation, for admins and clients, and nothing else', async () => {
  const handlers = {}, displayed = [], opened = [];
  const self = { location: { origin: 'https://dwira.example' }, addEventListener: (name, callback) => { handlers[name] = callback; }, skipWaiting: async () => {},
    registration: { showNotification: async (title, options) => displayed.push({ title, ...options }) },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async url => { opened.push(url); return {}; } } };
  vm.runInNewContext(await fs.readFile('public/push-sw.js', 'utf8'), { self, URL });
  const show = async payload => { let pending; handlers.push({ data: { json: () => payload }, waitUntil: value => { pending = value; } }); await pending; return displayed.at(-1); };
  const click = async shown => { let pending; handlers.notificationclick({ action: 'open', notification: { data: shown.data, close() {} }, waitUntil: value => { pending = value; } }); await pending; return opened.at(-1); };
  const admin = await show(payloadFor({ id: 'abc-1', name: 'Amine', whatsapp: '+212611111111', text: 'Salut' }, 'fr', 'chat'));
  assert.equal(admin.title, 'Nouveau message');
  assert.equal(await click(admin), 'https://dwira.example/admin/chats?target=abc-1&open=abc-1');
  const client = await show(payloadFor({ id: 'abc-1', text: 'Bonjour' }, 'fr', 'reply'));
  assert.equal(await click(client), 'https://dwira.example/chat/abc-1');
  const evil = await show({ title: 't', body: 'b', requestId: 'x', url: 'https://evil.example/chat/abc-1' });
  assert.equal(await click(evil), 'https://dwira.example/admin/requests');
  const traversal = await show({ title: 't', body: 'b', requestId: 'x', url: '/chat/../admin/users' });
  assert.notEqual(await click(traversal), 'https://dwira.example/chat/../admin/users');
});
const deviceToken = () => crypto.randomBytes(32).toString('hex');
test('a visitor chats without an account; the messages are stored, admins see them, and signing in moves every one of them to the account', async () => {
  const { backend, sent, admin } = await setup();
  try {
    await call(backend, '/api/push/subscriptions', { method: 'POST', headers: admin, body: device('admin-guest') });
    sent.length = 0;
    const d1 = { 'x-demand-token': deviceToken() }, d2 = { 'x-demand-token': deviceToken() };
    assert.equal((await call(backend, '/api/guest/conversations')).status, 400, 'a device token is required');
    assert.deepEqual((await call(backend, '/api/guest/conversations', { headers: d1 })).body, []);
    const first = await call(backend, '/api/guest/conversations', { method: 'POST', headers: d1, body: { title: 'Salon', messages: [message('g1', 'Bonjour, je cherche une idée')], updatedAt: Date.now() } });
    assert.equal(first.status, 200);
    assert.equal(first.body.userId, 'guest');
    const id = first.body.id;
    // Another device can neither read nor change it.
    assert.deepEqual((await call(backend, '/api/guest/conversations', { headers: d2 })).body, []);
    assert.equal((await call(backend, `/api/guest/conversations/${id}`, { method: 'PATCH', headers: d2, body: { messages: [message('x', 'hijack')] } })).status, 404);
    // The thread keeps growing; the assistant answer is stored, a new user message notifies the admins (as "Visiteur", no personal data).
    const grown = await call(backend, `/api/guest/conversations/${id}`, { method: 'PATCH', headers: d1, body: { messages: [message('g1', 'Bonjour, je cherche une idée'), message('g2', 'demo', 'assistant'), message('g3', 'Et pour la cuisine ?')] } });
    assert.equal(grown.body.messages.length, 3);
    const pushes = sent.filter(p => p.title === 'Nouveau message');
    assert.equal(pushes.length, 2);
    assert.equal(pushes.at(-1).body, 'Visiteur: Et pour la cuisine ?');
    assert.equal(pushes.at(-1).url, `/admin/chats?target=${id}&open=${id}`);
    assert.equal(pushes.at(-1).phone, '');
    // Admin inbox lists it as a guest conversation and can answer; the visitor's thread keeps the answer.
    const inbox = (await call(backend, '/api/admin/conversations', { headers: admin })).body;
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].guest, true);
    assert.equal(inbox[0].clientName, '');
    const answered = await call(backend, `/api/admin/conversations/${id}`, { method: 'POST', headers: admin, body: { text: 'Avec plaisir !' } });
    assert.equal(answered.status, 200);
    const stored = (await call(backend, `/api/guest/conversations/${id}`, { headers: d1 })).body;
    assert.equal(stored.messages.at(-1).role, 'admin');
    // A stale copy from the visitor cannot erase the admin answer.
    const stale = await call(backend, `/api/guest/conversations/${id}`, { method: 'PATCH', headers: d1, body: { messages: grown.body.messages } });
    assert.equal(stale.body.messages.at(-1).role, 'admin');
    // Sync: the visitor's device sees its own counter move.
    const sync0 = (await call(backend, '/api/sync', { headers: d1 })).body.guest;
    await call(backend, `/api/guest/conversations/${id}`, { method: 'PATCH', headers: d1, body: { messages: stale.body.messages } });
    assert.ok((await call(backend, '/api/sync', { headers: d1 })).body.guest > sync0);
    // A second visitor thread, then sign in from d1: BOTH threads (and the admin answer) now belong to the client.
    const second = await call(backend, '/api/guest/conversations', { method: 'POST', headers: d1, body: { title: 'Chambre', messages: [message('g9', 'Salut')], updatedAt: Date.now() } });
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: { ...native, ...d1 }, body: { name: 'Salma', phone: '0633333333' } });
    assert.equal(login.status, 200);
    const mine = { 'x-user-token': login.body.token };
    const owned = (await call(backend, '/api/user/conversations', { headers: mine })).body;
    assert.deepEqual(owned.map(c => c.id).sort(), [id, second.body.id].sort());
    assert.ok(owned.every(c => c.userId === login.body.user.id), 'every thread is stamped with the account');
    assert.equal(owned.find(c => c.id === id).messages.length, 4, 'existing messages (incl. the admin answer) came along');
    assert.deepEqual((await call(backend, '/api/guest/conversations', { headers: d1 })).body, [], 'nothing is left as a guest chat');
    assert.equal((await call(backend, '/api/guest/conversations', { headers: { ...d1, ...mine } })).status, 409, 'a signed-in session uses its own space');
    // Later messages go to the account and the admin inbox shows the client by name, once.
    const later = await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: mine, body: { messages: [...owned.find(c => c.id === id).messages, message('g10', 'Merci')] } });
    assert.equal(later.body.messages.length, 5);
    const named = (await call(backend, '/api/admin/conversations', { headers: admin })).body;
    assert.equal(named.length, 2);
    assert.ok(named.every(c => c.clientName === 'Salma' && !c.guest));
    // A device cannot adopt someone else's guest chats by signing in from another device.
    const other = await call(backend, '/api/user/login', { method: 'POST', headers: { ...native, ...d2 }, body: { name: 'Omar', phone: '0644444444' } });
    assert.deepEqual((await call(backend, '/api/user/conversations', { headers: { 'x-user-token': other.body.token } })).body, []);
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);
