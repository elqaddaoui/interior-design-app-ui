const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const { createBackend } = require('../server');
const { freshDb, closeShared } = require('./test-db');

const memory = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' };
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(key, value) { output.headers[key.toLowerCase()] = value; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const demand = id => ({ id, photoUri: 'data:image/png;base64,iVBORw0KGgoAAAAA', draft: { toolId: 'tool_interior' } });

test('lead form flow: phone login -> free claim -> request, exactly as /lead + /render do it', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    // /lead : "amine" / "0626900460" (the values from the failing screenshot)
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'amine', phone: '0626900460' } });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.whatsapp, '+212626900460');
    assert.equal(login.body.user.freeUsed, 0);
    assert.equal(login.body.user.credits, 1);
    assert(login.headers['set-cookie'].startsWith('dwira_user='));
    const auth = { 'x-user-token': login.body.token };
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).body.user.name, 'amine');
    // /render : no image-upload/spam step any more, just the request
    const headers = { ...auth, 'x-demand-token': 'a'.repeat(64) };
    const created = await call(backend, '/api/requests', { method: 'POST', headers, body: demand('claim-lead-0001') });
    assert.equal(created.status, 201);
    assert.equal(created.body.whatsapp, '+212626900460');
    assert.equal(created.body.clientHash, undefined, 'internal fields are never exposed');
    // lost response -> retry must be idempotent
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers, body: demand('claim-lead-0001') })).body.id, created.body.id);
    assert.equal((await call(backend, '/api/user/requests', { headers: auth })).body.length, 1);
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).body.user.freeUsed, 1);
    // second free design needs Pro
    assert.equal((await call(backend, '/api/user/claim', { method: 'POST', headers: auth, body: { id: 'claim-second-0002' } })).body.error, 'PRO_REQUIRED');
  } finally { backend.server.emit('close'); }
});

test('invalid profiles are rejected and the same phone in any spelling restores the same account', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    for (const body of [{ name: 'a', phone: '0626900460' }, { name: 'amine', phone: '123' }, { name: 'amine', phone: 'abc' }, {}]) {
      assert.equal((await call(backend, '/api/user/login', { method: 'POST', body })).status, 400);
    }
    const ids = new Set();
    for (const phone of ['0626900460', '+212626900460', '00212626900460', '06 26 90 04 60']) ids.add((await call(backend, '/api/user/login', { method: 'POST', body: { name: 'amine', phone } })).body.user.id);
    assert.equal(ids.size, 1);
    // concurrent first logins for a new phone create exactly one profile
    const racing = await Promise.all([1, 2, 3, 4].map(() => call(backend, '/api/user/login', { method: 'POST', body: { name: 'racer', phone: '0611111111' } })));
    assert.equal(new Set(racing.map(row => row.body.user.id)).size, 1);
  } finally { backend.server.emit('close'); }
});

test('atomic racing claims, ownership isolation, history and credit grants', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    const first = await backend.clients.login('Client One', '+212600000001');
    const results = await Promise.allSettled([1, 2].map(n => backend.clients.claim(first.user, `racing-claim-${n}`)));
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1, 'only one free claim can win');
    assert.equal((await backend.clients.user(first.user.id)).freeUsed, 1);
    await backend.clients.grant(first.user.id, 2);
    assert.equal((await backend.clients.claim(first.user, 'paid-claim-0001')).credits, 1);

    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const auth = { 'x-user-token': first.token };
    assert.equal((await call(backend, '/api/admin/clients', { headers: auth })).status, 401, 'a client is never an admin');
    assert.equal((await call(backend, '/api/user/session', { headers: adminAuth })).status, 401, 'an admin is not a client');
    assert.equal((await call(backend, '/api/admin/clients', { headers: adminAuth })).body.length, 1);

    const history = await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'paid-claim-0001', before: 'photo', status: 'pending', draft: { toolId: 'tool_interior' } } });
    assert.equal(history.status, 200);
    assert.equal((await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'not-claimed-0001', before: 'photo', status: 'pending', draft: { toolId: 't' } } })).status, 403);
    const other = await backend.clients.login('Client Two', '+212600000002');
    assert.equal((await call(backend, `/api/user/history/${history.body.id}`, { headers: { 'x-user-token': other.token } })).status, 404);
    await call(backend, '/api/user/logout', { method: 'POST', headers: auth, body: {} });
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).status, 401);
  } finally { backend.server.emit('close'); }
});

test('admin delivery updates the client history; clients cannot self-deliver or read other requests', async () => {
  // No network in tests: the external final-design URL "cannot be downloaded" and is kept as it is.
  const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
  const backend = createBackend({ env: { ...memory }, db: await freshDb(), media: { download: offline } });
  try {
    const login = await backend.clients.login('Test Person', '+212612345678');
    const auth = { 'x-user-token': login.token, 'x-demand-token': 'a'.repeat(64) };
    const created = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { ...demand('claim-http-00001'), name: 'Spoofed', whatsapp: '+11111111111' } });
    assert.equal(created.body.name, 'Test Person', 'identity comes from the session, not the body');
    const history = await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'claim-http-00001', before: 'photo', status: 'pending', draft: { toolId: 'tool_interior' } } });
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: auth, body: { historyId: history.body.id, status: 'delivered', name: 'x' } })).body.status, 'pending');
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: adminAuth, body: { finalResult: 'https://example.com/final.jpg', status: 'delivered' } })).body.status, 'delivered');
    assert.equal((await call(backend, '/api/user/history', { headers: auth })).body[0].status, 'done');
    const other = await backend.clients.login('Other', '+212600000002');
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { headers: { 'x-user-token': other.token } })).status, 404);
    assert.equal((await call(backend, '/api/requests', { headers: { 'x-user-token': other.token } })).status, 401);
    assert.equal((await call(backend, '/api/requests', { headers: adminAuth })).body.length, 1);
    assert.equal((await call(backend, `/api/requests/${created.body.id}`, { method: 'DELETE', headers: adminAuth })).status, 200);
    assert.equal((await call(backend, '/api/requests', { headers: adminAuth })).body.length, 0);
  } finally { backend.server.emit('close'); }
});

test('health reports the database; same-origin works without an allowlist; default and custom admin login', async () => {
  const salt = 'test-salt', password = 'a-long-test-password';
  const env = { ...memory, ADMIN_EMAIL: 'owner@example.com', ADMIN_PASSWORD_HASH: `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}` };
  const backend = createBackend({ env, db: await freshDb() });
  try {
    const health = await call(backend, '/api/health', { headers: { origin: 'https://dwira.example', host: 'dwira.example' } });
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.database, 'pglite');
    assert.equal(health.headers['access-control-allow-origin'], 'https://dwira.example');
    assert.equal((await call(backend, '/api/health', { headers: { origin: 'https://evil.example', host: 'dwira.example' } })).status, 403);
    assert.equal((await call(backend, '/api/admin/clients', { headers: { origin: 'https://dwira.example', host: 'dwira.example' } })).status, 401);
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' } })).status, 200);
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'owner@example.com', password } })).status, 200);
    assert.equal((await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'nope' } })).status, 401);
    assert.equal((await call(backend, '/api/admin/spam', { headers: {} })).status, 404, 'the spam monitor no longer exists');
    assert.equal((await call(backend, '/api/admin/returning', { headers: {} })).status, 404, 'the returning-message API no longer exists');
  } finally { backend.server.emit('close'); }
});

test('on Vercel without a database the API answers a clear 503 JSON error instead of crashing', async () => {
  const backend = createBackend({ env: { VERCEL: '1' } });
  try {
    const health = await call(backend, '/api/health');
    assert.equal(health.status, 503);
    assert.equal(health.body.database, 'missing');
    const login = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'amine', phone: '0626900460' } });
    assert.equal(login.status, 503);
    assert.equal(login.body.error, 'DATABASE_NOT_CONFIGURED');
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);

test('admin credit grant ends the paywall: a client who used the free design and was granted credits can generate again', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    const login = await backend.clients.login('Granted User', '+212600000010');
    await backend.clients.claim(login.user, 'free-claim-0001');
    const used = await backend.clients.user(login.user.id);
    assert.equal(used.freeUsed, 1);
    assert.equal(used.credits, 0, 'free design used and nothing granted: paywall');
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const granted = await call(backend, `/api/admin/clients/${login.user.id}`, { method: 'PATCH', headers: adminAuth, body: { credits: 2 } });
    assert.equal(granted.body.credits, 2);
    const session = await call(backend, '/api/user/session', { headers: { 'x-user-token': login.token } });
    assert.equal(session.body.user.credits, 2, 'the session endpoint returns the granted credits');
    assert.equal((await call(backend, '/api/user/claim', { method: 'POST', headers: { 'x-user-token': login.token }, body: { id: 'paid-claim-0010' } })).body.user.credits, 1);
    // all granted credits spent -> paywall again
    await backend.clients.claim(login.user, 'paid-claim-0011');
    assert.equal((await call(backend, '/api/user/claim', { method: 'POST', headers: { 'x-user-token': login.token }, body: { id: 'paid-claim-0012' } })).body.error, 'PRO_REQUIRED');
  } finally { backend.server.emit('close'); }
});

test('admin deletes several render requests in one call: admin only, only the listed ones, history of other clients untouched', async () => {
  const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
  const backend = createBackend({ env: { ...memory }, db: await freshDb(), media: { download: offline } });
  try {
    const a = await backend.clients.login('Alpha', '+212611111111');
    const b = await backend.clients.login('Bravo', '+212622222222');
    const c = await backend.clients.login('Charlie', '+212633333333');
    const make = async (who, id) => (await call(backend, '/api/requests', { method: 'POST', headers: { 'x-user-token': who.token, 'x-demand-token': 'a'.repeat(64) }, body: demand(id) })).body;
    const r1 = await make(a, 'bulk-req-a-0001'), r2 = await make(c, 'bulk-req-c-0001'), r3 = await make(b, 'bulk-req-b-0001');
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const bulk = (body, headers = adminAuth) => call(backend, '/api/admin/requests/bulk', { method: 'POST', headers, body });
    // admin only: no token and a client token are both refused, nothing is deleted
    assert.equal((await bulk({ action: 'delete', ids: [r1.id] }, {})).status, 401);
    assert.notEqual((await bulk({ action: 'delete', ids: [r1.id] }, { 'x-user-token': a.token })).status, 200);
    assert.equal((await call(backend, '/api/requests', { headers: adminAuth })).body.length, 3);
    // malformed bodies are refused
    assert.equal((await bulk({ action: 'nuke', ids: [r1.id] })).status, 400);
    assert.equal((await bulk({ action: 'delete', ids: 'x' })).status, 400);
    assert.equal((await bulk({ action: 'delete', ids: [] })).body.removed, 0);
    // two of three, plus an unknown id and a duplicate: only the real, listed ones go
    const done = await bulk({ action: 'delete', ids: [r1.id, r1.id, r3.id, 'does-not-exist', 42, '../x'] });
    assert.equal(done.status, 200);
    assert.equal(done.body.removed, 2);
    const left = (await call(backend, '/api/requests', { headers: adminAuth })).body;
    assert.deepEqual(left.map(r => r.id), [r2.id]);
    // the owners' own lists shrink too (sync), the untouched client keeps theirs, and a second identical call removes nothing
    assert.equal((await call(backend, '/api/user/requests', { headers: { 'x-user-token': a.token } })).body.length, 0);
    assert.equal((await call(backend, '/api/user/requests', { headers: { 'x-user-token': b.token } })).body.length, 0);
    assert.equal((await call(backend, '/api/user/requests', { headers: { 'x-user-token': c.token } })).body.length, 1);
    assert.equal((await bulk({ action: 'delete', ids: [r1.id, r3.id] })).body.removed, 0);
  } finally { backend.server.emit('close'); }
});

test('admin can edit credits, block, unblock and delete one client; blocked clients are locked out', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    const login = await backend.clients.login('Blockable', '+212600000020');
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const auth = { 'x-user-token': login.token };
    const id = login.user.id;
    for (const bad of [{ credits: -1 }, { credits: 1.5 }, { credits: '5' }, { credits: 1e9 }, { blocked: 'yes' }]) {
      assert.equal((await call(backend, `/api/admin/clients/${id}`, { method: 'PATCH', headers: adminAuth, body: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await call(backend, `/api/admin/clients/${id}`, { method: 'PATCH', headers: auth, body: { credits: 9 } })).status, 401, 'a client cannot edit credits');
    const blocked = await call(backend, `/api/admin/clients/${id}`, { method: 'PATCH', headers: adminAuth, body: { blocked: true } });
    assert.equal(blocked.body.blocked, true);
    assert.equal(blocked.body.credits, 1, 'blocking never changes credits');
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).body.error, 'ACCOUNT_BLOCKED');
    assert.equal((await call(backend, '/api/user/claim', { method: 'POST', headers: auth, body: { id: 'claim-blocked-01' } })).status, 403);
    assert.equal((await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Blockable', phone: '+212600000020' } })).body.error, 'ACCOUNT_BLOCKED');
    const back = await call(backend, `/api/admin/clients/${id}`, { method: 'PATCH', headers: adminAuth, body: { blocked: false, credits: 7 } });
    assert.equal(back.body.blocked, false);
    assert.equal(back.body.credits, 7);
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).status, 200);
    assert.equal((await call(backend, `/api/admin/clients/${id}`, { method: 'DELETE', headers: auth })).status, 401);
    assert.equal((await call(backend, `/api/admin/clients/${id}`, { method: 'DELETE', headers: adminAuth })).status, 200);
    assert.equal((await call(backend, `/api/admin/clients/${id}`, { method: 'DELETE', headers: adminAuth })).status, 404);
    assert.equal((await call(backend, '/api/user/session', { headers: auth })).status, 401, 'deleted client sessions die with the account');
  } finally { backend.server.emit('close'); }
});

test('bulk admin actions: add / subtract / set credits, block, unblock, delete on several clients, all-or-nothing', async () => {
  const backend = createBackend({ env: { ...memory }, db: await freshDb() });
  try {
    const admin = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
    const adminAuth = { authorization: `Bearer ${admin.body.token}` };
    const a = (await backend.clients.login('Alpha', '+212600000031')).user;
    const b = (await backend.clients.login('Bravo', '+212600000032')).user;
    const c = (await backend.clients.login('Charlie', '+212600000033')).user;
    await backend.clients.claim(b, 'bulk-claim-b-001'); // Bravo used the free design -> 0 shown
    const bulk = (body, headers = adminAuth) => call(backend, '/api/admin/clients/bulk', { method: 'POST', headers, body });
    const shown = async () => Object.fromEntries((await backend.clients.users()).map(u => [u.name, u.credits]));
    assert.deepEqual(await shown(), { Alpha: 1, Bravo: 0, Charlie: 1 });

    assert.equal((await bulk({ ids: [a.id], action: 'credits', mode: 'set', amount: 1 }, {})).status, 401);
    assert.deepEqual((await bulk({ ids: [a.id, b.id, c.id], action: 'credits', mode: 'add', amount: 5 })).body.users.map(u => u.credits).sort(), [5, 6, 6]);
    assert.deepEqual(await shown(), { Alpha: 6, Bravo: 5, Charlie: 6 });
    await bulk({ ids: [a.id, b.id, c.id], action: 'credits', mode: 'subtract', amount: 100 });
    assert.deepEqual(await shown(), { Alpha: 0, Bravo: 0, Charlie: 0 }, 'never below zero');
    await bulk({ ids: [a.id, b.id], action: 'credits', mode: 'set', amount: 4 });
    assert.deepEqual(await shown(), { Alpha: 4, Bravo: 4, Charlie: 0 });
    // Bravo now truly has paid credits and can generate
    assert.equal((await backend.clients.claim(b, 'bulk-claim-b-002')).credits, 3);

    const blocked = await bulk({ ids: [a.id, b.id], action: 'block' });
    assert.equal(blocked.body.affected, 2);
    assert(blocked.body.users.every(u => u.blocked));
    assert.equal((await backend.clients.users()).find(u => u.name === 'Charlie').blocked, false);
    await bulk({ ids: [a.id, b.id], action: 'unblock' });
    assert((await backend.clients.users()).every(u => !u.blocked));

    // invalid input changes nothing
    for (const bad of [{ ids: [], action: 'block' }, { ids: ['x'], action: 'block' }, { ids: [a.id], action: 'explode' }, { ids: [a.id], action: 'credits', mode: 'set', amount: -1 }, { ids: [a.id], action: 'credits', mode: 'mul', amount: 1 }, { ids: 'all', action: 'delete' }]) {
      assert.equal((await bulk(bad)).status, 400, JSON.stringify(bad));
    }
    assert.deepEqual(await shown(), { Alpha: 4, Bravo: 3, Charlie: 0 });

    // unknown ids are skipped, known ones deleted in one transaction (sessions/claims cascade)
    const gone = await bulk({ ids: [a.id, b.id, '00000000-0000-0000-0000-000000000000'], action: 'delete' });
    assert.equal(gone.body.affected, 2);
    assert.deepEqual(await shown(), { Charlie: 0 });
  } finally { backend.server.emit('close'); }
});
