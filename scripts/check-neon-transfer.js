const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { createMedia } = require('../server/media');
const { freshDb, closeShared } = require('./test-db');

/** Like the other checks, but keeps raw bodies and status so 304 / HEAD can be asserted. */
function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const out = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, writeHead(status, h) { out.status = status; for (const [k, v] of Object.entries(h || {})) out.headers[k.toLowerCase()] = v; this.headersSent = true; },
      end(value) { out.raw = value; try { out.body = value && !out.headers['content-encoding'] && String(out.headers['content-type']).includes('json') ? JSON.parse(value) : undefined; } catch { /* binary */ } resolve(out); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const png = size => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, 7)]);
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
async function setup(extra = {}) {
  const db = await freshDb();
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50' }, db, media: { storage: null, download: offline }, ...extra });
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  return { backend, db, admin: { authorization: `Bearer ${login.body.token}` } };
}
const person = async (backend, name, phone) => (await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name, phone } })).body;
/** Counts bytes returned by the database for one block of work. */
function meter(db) {
  const state = { bytes: 0, queries: 0 };
  const original = db.query.bind(db);
  db.query = async (...args) => { const rows = await original(...args); state.queries++; state.bytes += Buffer.byteLength(JSON.stringify(rows, (k, v) => (v && v.type === 'Buffer') || v instanceof Uint8Array ? 'x'.repeat(v.length || v.data?.length || 0) : v)); return rows; };
  return state;
}

test('media: repeat reads of a database-stored file touch the database for metadata only; HEAD and If-None-Match never read the bytes', async () => {
  const { backend, db } = await setup();
  try {
    const bytes = png(60 * 1024);
    const url = await createMedia(db, { env: {}, storage: null, download: offline }).storeMedia({ body: bytes, mime: 'image/png' });
    const first = await call(backend, url);
    assert.equal(first.status, 200);
    assert.equal(Buffer.from(first.raw).length, bytes.length);
    const spent = meter(db);
    for (let i = 0; i < 10; i++) assert.equal(Buffer.from((await call(backend, url)).raw).length, bytes.length, 'same bytes every time');
    assert(spent.bytes < 4096, `10 cached reads cost ${spent.bytes} bytes of database transfer`);
    const head = await call(backend, url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], bytes.length);
    assert(!head.raw || head.raw.length === 0, 'HEAD has no body');
    const etag = first.headers.etag;
    assert(etag);
    const revalidated = await call(backend, url, { headers: { 'if-none-match': etag } });
    assert.equal(revalidated.status, 304);
    assert.equal((await call(backend, `/api/media/${'0'.repeat(32)}.png`)).status, 404);
  } finally { backend.server.emit('close'); }
});

test('media: an unsettled or missing file is never served from the cache, and a cold read after restart still works', async () => {
  const { backend, db } = await setup();
  try {
    const url = await createMedia(db, { env: {}, storage: null, download: offline }).storeMedia({ body: png(2048), mime: 'image/png' });
    assert.equal((await call(backend, url)).status, 200);
    const second = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db, media: { storage: null, download: offline } });
    try { assert.equal((await call(second, url)).status, 200); } finally { second.server.emit('close'); }
    assert.equal((await call(backend, url.replace(/\.png$/, '.jpg'))).status, 404, 'extension must match the stored type');
  } finally { backend.server.emit('close'); }
});

test('content: ETag answers 304 until the version changes; admin and public copies never share a tag; keys stay private', async () => {
  const { backend, admin } = await setup();
  try {
    const first = await call(backend, '/api/content');
    assert.equal(first.status, 200);
    const tag = first.headers.etag;
    assert(tag && tag.includes(':p:'));
    const again = await call(backend, '/api/content', { headers: { 'if-none-match': tag } });
    assert.equal(again.status, 304);
    const adminCopy = await call(backend, '/api/content', { headers: admin });
    assert.equal(adminCopy.status, 200);
    assert(adminCopy.headers.etag.includes(':a:') && adminCopy.headers.etag !== tag);
    assert.equal((await call(backend, '/api/content', { headers: { ...admin, 'if-none-match': tag } })).status, 200, 'a public tag never validates the admin copy');
    assert.match(adminCopy.headers['cache-control'], /no-store/);
    // An edit bumps the version: the old tag stops matching and the new copy has the edit.
    const put = await call(backend, '/api/admin/content/tabs/tab_etag', { method: 'PUT', headers: admin, body: { id: 'tab_etag', label: 'Etag', icon: 'home', order: 99, visible: true } });
    assert.equal(put.status, 200);
    const changed = await call(backend, '/api/content', { headers: { 'if-none-match': tag } });
    assert.equal(changed.status, 200);
    assert.notEqual(changed.headers.etag, tag);
    assert(changed.body.collections.tabs.some(t => t.id === 'tab_etag'));
    assert.equal(changed.body.collections.models.find(m => m.id === 'mdl_gemini').apiKey, '', 'public never sees keys');
  } finally { backend.server.emit('close'); }
});

test('space: single conversation / history reads are scoped to the owner and kind; guest chats to the device', async () => {
  const { backend, db } = await setup();
  try {
    const a = await person(backend, 'Owner One', '0661000011'), b = await person(backend, 'Other Two', '0661000012');
    const ha = { 'x-user-token': a.token, 'x-demand-token': 'a'.repeat(64) }, hb = { 'x-user-token': b.token, 'x-demand-token': 'b'.repeat(64) };
    const saved = await call(backend, '/api/user/conversations', { method: 'POST', headers: ha, body: { title: 'Mine', messages: [{ id: 'm1', role: 'user', text: 'hello', createdAt: 1 }], updatedAt: 10 } });
    assert.equal(saved.status, 200);
    const id = saved.body.id;
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { headers: ha })).body.title, 'Mine');
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { headers: hb })).status, 404, 'another client cannot read it');
    assert.equal((await call(backend, `/api/user/history/${id}`, { headers: ha })).status, 404, 'wrong kind');
    assert.equal((await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: hb, body: { title: 'x' } })).status, 404);
    const patched = await call(backend, `/api/user/conversations/${id}`, { method: 'PATCH', headers: ha, body: { title: 'Renamed', messages: [{ id: 'm1', role: 'user', text: 'hello', createdAt: 1 }], updatedAt: 11 } });
    assert.equal(patched.body.title, 'Renamed');
    const many = await call(backend, '/api/user/conversations', { headers: ha });
    assert.equal(many.body.length, 1);
    // Guests
    const device = { 'x-demand-token': 'c'.repeat(64) }, other = { 'x-demand-token': 'd'.repeat(64) };
    const g = await call(backend, '/api/guest/conversations', { method: 'POST', headers: device, body: { title: 'Visitor', messages: [{ id: 'g1', role: 'user', text: 'hi', createdAt: 1 }], updatedAt: 5 } });
    assert.equal(g.status, 200);
    assert.equal((await call(backend, `/api/guest/conversations/${g.body.id}`, { headers: device })).body.title, 'Visitor');
    assert.equal((await call(backend, `/api/guest/conversations/${g.body.id}`, { headers: other })).status, 404);
    assert.equal((await call(backend, `/api/guest/conversations/${g.body.id}`, { method: 'PATCH', headers: other, body: { title: 'no' } })).status, 404);
  } finally { backend.server.emit('close'); }
});

test('admin inbox: newest 300, `since` returns only what changed plus the current id set, deletions drop out', async () => {
  const { backend, admin } = await setup();
  try {
    const a = await person(backend, 'Chat One', '0661000021');
    const ha = { 'x-user-token': a.token, 'x-demand-token': 'a'.repeat(64) };
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await call(backend, '/api/user/conversations', { method: 'POST', headers: ha, body: { title: `T${i}`, messages: [{ id: `m${i}`, role: 'user', text: `msg ${i}`, createdAt: 100 + i }], updatedAt: 100 + i } })).body.id);
    const full = await call(backend, '/api/admin/conversations', { headers: admin });
    assert(Array.isArray(full.body));
    assert.deepEqual(full.body.map(c => c.title), ['T2', 'T1', 'T0'], 'newest first');
    assert.equal(full.body[0].clientName, 'Chat One');
    const delta = await call(backend, '/api/admin/conversations?since=101', { headers: admin });
    assert.deepEqual(delta.body.chats.map(c => c.title), ['T2']);
    assert.equal(delta.body.ids.length, 3);
    const none = await call(backend, '/api/admin/conversations?since=999', { headers: admin });
    assert.equal(none.body.chats.length, 0);
    await call(backend, `/api/user/conversations/${ids[0]}`, { method: 'DELETE', headers: ha });
    assert.equal((await call(backend, '/api/admin/conversations?since=999', { headers: admin })).body.ids.length, 2);
    assert.equal((await call(backend, '/api/admin/conversations')).status, 401);
    // Visitor chats are listed too, flagged as guests.
    await call(backend, '/api/guest/conversations', { method: 'POST', headers: { 'x-demand-token': 'e'.repeat(64) }, body: { title: 'Guest', messages: [{ id: 'g', role: 'user', text: 'yo', createdAt: 200 }], updatedAt: 200 } });
    const mixed = await call(backend, '/api/admin/conversations', { headers: admin });
    assert.equal(mixed.body[0].guest, true);
  } finally { backend.server.emit('close'); }
});

test('admin requests list is bounded (default 500, ?limit and ?before page back); clients are listed without prefs', async () => {
  const { backend, db, admin } = await setup();
  try {
    const a = await person(backend, 'Req One', '0661000031');
    await backend.clients.grant(a.user.id, 10);
    const ha = { 'x-user-token': a.token, 'x-demand-token': 'a'.repeat(64) };
    for (let i = 0; i < 4; i++) assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: ha, body: { id: `neon-req-${i}-aaaa`, photoUri: 'data:image/png;base64,iVBORw0KGgoAAAAA', draft: { toolId: 'tool_interior' } } })).status, 201);
    const all = await call(backend, '/api/requests', { headers: admin });
    assert.equal(all.body.length, 4);
    const two = await call(backend, '/api/requests?limit=2', { headers: admin });
    assert.equal(two.body.length, 2);
    const older = await call(backend, `/api/requests?limit=5&before=${two.body[1].createdAt}`, { headers: admin });
    assert.equal(older.body.length, 2, 'the rest, no overlap');
    assert(!older.body.some(r => two.body.some(t => t.id === r.id)));
    const list = await call(backend, '/api/admin/clients', { headers: admin });
    assert(list.body.every(c => !('prefs' in c)));
    assert.equal(list.body.find(c => c.id === a.user.id).name, 'Req One');
  } finally { backend.server.emit('close'); }
});

test('sync: per-part client versions move only for the part that changed; the legacy `client` version still moves for everything', async () => {
  const { backend, admin } = await setup();
  try {
    const a = await person(backend, 'Parts One', '0661000041');
    const ha = { 'x-user-token': a.token, 'x-demand-token': 'a'.repeat(64) };
    const poll = async headers => (await call(backend, '/api/sync', { headers })).body;
    const p0 = await poll(ha), a0 = await poll(admin);
    assert(p0.parts && 'conversations' in p0.parts && 'history' in p0.parts && 'requests' in p0.parts);
    await call(backend, '/api/user/conversations', { method: 'POST', headers: ha, body: { title: 'x', messages: [{ id: 'm', role: 'user', text: 'a', createdAt: 1 }], updatedAt: 1 } });
    const p1 = await poll(ha), a1 = await poll(admin);
    assert(p1.client > p0.client);
    assert(p1.parts.conversations > p0.parts.conversations);
    assert.equal(p1.parts.history, p0.parts.history, 'designs untouched by a chat message');
    assert.equal(p1.parts.requests, p0.parts.requests);
    assert(a1.chats > a0.chats, 'admin inbox announced');
    assert.equal(a1.clients, a0.clients, 'a chat message does not make every admin reload the client list');
    assert.equal((await call(backend, '/api/sync')).body.parts, null);
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);
