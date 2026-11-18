/**
 * Platform-wide media (super admin): every file of every store / demo / theme with who uses it, deleting whole files, and the storage audit
 * that compares the database with what R2 / the server folder really hold (and the safe repair). Also proves the shared hash namespace
 * behaves the same for stores and demos. Driven through the real request handler.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { createFsStorage } = require('../server/media');
const { hashPassword } = require('../server/admins');
const { freshDb, closeShared } = require('./test-db');

const SUPER = { email: 'boss@platform.test', password: 'Platform-Secret-123' };
const ENV = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', STATIC_DIR: path.join(__dirname, 'no-such-dist'), SUPERADMIN_EMAIL: SUPER.email, SUPERADMIN_PASSWORD_HASH: hashPassword(SUPER.password) };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
test.after(closeShared);

function call(backend, url, { method = 'GET', body, headers = {}, host = 'app.test', ip = 'ml-test' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host, ...headers }, socket: { remoteAddress: ip } });
    const out = { headers: {} };
    const chunks = [];
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => { const text = Buffer.concat(chunks).toString(); try { out.body = text ? JSON.parse(text) : undefined; } catch { out.text = text; } resolve(out); });
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const bearer = token => ({ authorization: `Bearer ${token}` });
const png = seed => 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, seed)]).toString('base64');

const r2Failure = { on: false };
function fakeR2() {
  const objects = new Map();
  return {
    objects, kind: 'r2',
    publicUrl: key => `https://media.example.com/${key}`,
    put: async (key, body, mime) => { objects.set(key, { body: Buffer.from(body), mime }); },
    head: async key => (objects.has(key) ? { size: objects.get(key).body.length, mime: objects.get(key).mime } : null),
    getRange: async (key, length) => objects.get(key).body.subarray(0, length),
    remove: async key => { objects.delete(key); },
    get: async key => { if (!objects.has(key)) throw new Error('NoSuchKey'); return Buffer.from(objects.get(key).body); },
    stream: async key => Readable.from([objects.get(key).body]),
    copy: async (from, to) => { if (!objects.has(from)) throw new Error('NoSuchKey'); objects.set(to, { ...objects.get(from) }); },
    list: async prefix => { if (r2Failure.on) throw Object.assign(new Error('boom'), { name: 'AccessDenied' }); return [...objects.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, v]) => ({ key, size: v.body.length, modified: v.modified || 1 })); },
    presignPut: async key => `https://r2.example/${key}`,
  };
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-media-'));
  const r2 = fakeR2();
  const fsStorage = createFsStorage({ MEDIA_DIR: dir });
  const db = await freshDb();
  const bk = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-bk-'));
  const root = require('./backup-harness').makeAppRoot();
  const backend = createBackend({ env: { ...ENV, MEDIA_DIR: dir, BACKUP_DIR: bk, BACKUP_APP_ROOT: root }, db, media: { storage: r2, fsStorage, download: offline } });
  await backend.db.query('select 1');
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: native, body: SUPER });
  assert.equal(signin.status, 200, JSON.stringify(signin.body));
  const sa = { 'x-super-token': signin.body.token };
  const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { ...sa, ...(opts.headers || {}) } });
  const login = async (slug, id, password) => {
    const r = await call(backend, `/${slug}/api/admin/login`, { method: 'POST', headers: native, body: { email: id, password } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return { ...bearer(r.body.token), ...native };
  };
  const store = async (slug, extra = {}) => {
    const r = await api('/tenants', { method: 'POST', body: { name: `Shop ${slug}`, slug, ownerEmail: `owner@${slug}.test`, ...extra } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return { tenant: r.body.tenant, headers: await login(slug, r.body.admin.id, r.body.admin.password), slug };
  };
  const upload = async (s, seed, extra = {}) => {
    const r = await call(backend, `/${s.slug}/api/admin/media`, { method: 'POST', headers: s.headers, body: { data: png(seed), ...extra } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.url;
  };
  const lib = (s, query = '') => call(backend, `/${s.slug}/api/admin/library${query}`, { headers: s.headers });
  const cleanup = () => { for (const d of [dir, bk, root]) fs.rmSync(d, { recursive: true, force: true }); };
  return { backend, db, api, r2, dir, store, upload, lib, login, cleanup };
}
const idOf = url => /([a-f0-9]{32})\./.exec(url)[1];
const own = body => body.items.filter(i => !i.linked); // files the store HOLDS (external pictures its starter content shows are listed too, read-only)
const r2Keys = r2 => [...r2.objects.keys()].filter(key => key.startsWith('media/'));
const rowsOfId = async (s, id) => (await s.db.query('SELECT tenant_id,storage,ns FROM media WHERE id=$1 ORDER BY tenant_id', [id]));

const legacyize = async (s, tenantId, url) => { // put a file back where an OLD version of the app stored it: t/<store>/media/<name>, row ns = 0
  const id = idOf(url), key = `media/${id}.png`;
  s.r2.objects.set(`t/${tenantId}/media/${id}.png`, s.r2.objects.get(key));
  s.r2.objects.delete(key);
  await s.db.query('UPDATE media SET ns=0 WHERE tenant_id=$1 AND id=$2', [tenantId, id]);
  return id;
};
const files = async (s, query = '') => { const r = await s.api(`/media/files${query}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

test('platform library: every file of every store, demo and theme once, with who shows it; unused files can be found and deleted, used ones are protected', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const shared = await s.upload(a, 21), same = await s.upload(b, 21), lonely = await s.upload(b, 22), kept = await s.upload(a, 23);
    assert.equal(shared, same);
    assert.equal((await call(s.backend, '/shop-a/api/admin/doc/branding', { method: 'PATCH', headers: a.headers, body: { logoUri: kept } })).status, 200);
    const demoMade = await s.api('/demos', { method: 'POST', body: { name: 'Showroom' } });
    const demo = demoMade.body.demo;
    const demoStore = { slug: demo.slug, tenant: { id: demo.tenantId }, headers: await s.login(demo.slug, demoMade.body.admin.id, demoMade.body.admin.password) };
    const inDemo = await s.upload(demoStore, 24);
    assert.equal((await call(s.backend, `/${demo.slug}/api/admin/doc/branding`, { method: 'PATCH', headers: demoStore.headers, body: { logoUri: inDemo } })).status, 200);

    const all = await files(s);
    assert.equal(all.total, 4, 'the file two stores share is ONE line');
    const line = id => all.items.find(i => i.id === idOf(id));
    assert.deepEqual(line(shared).owners.map(o => o.name).sort(), ['Shop shop-a', 'Shop shop-b']);
    assert.equal(line(shared).used, false, 'nobody shows it');
    assert.equal(line(kept).used, true);
    assert.equal(line(kept).usedBy[0].name, 'Shop shop-a');
    assert.equal(line(inDemo).owners[0].kind, 'demo', 'a demo owns files too');
    assert.equal(line(inDemo).used, true);
    assert.equal(all.totals.unused.files, 2, 'the shared one and the lonely one');
    assert.equal(all.totals.files, 4);
    assert.equal((await files(s, '?usage=unused')).total, 2);
    assert.equal((await files(s, '?usage=used')).total, 2);
    assert.equal((await files(s, `?owner=${demo.tenantId}`)).total, 1);
    assert.equal((await files(s, '?q=showroom')).total, 1, 'search by owner name');
    assert.equal((await files(s, '?kind=video')).total, 0);
    assert.equal((await files(s, '?limit=2')).items.length, 2);
    assert.equal((await files(s, '?limit=2')).more, true);
    // Only the console may call it.
    assert.equal((await call(s.backend, '/api/super-admin/media/files')).status, 401);
    assert.equal((await call(s.backend, '/shop-a/api/super-admin/media/files', { headers: a.headers })).status, 404);

    // A file that is shown is refused; an unused one is deleted from EVERY store and from storage.
    const refused = await s.api('/media/files/delete', { method: 'POST', body: { ids: [idOf(kept)] } });
    assert.equal(refused.status, 200);
    assert.deepEqual(refused.body.blocked, [{ id: idOf(kept), reason: 'IN_USE' }]);
    assert.equal(r2Keys(s.r2).length, 4);
    const del = await s.api('/media/files/delete', { method: 'POST', body: { ids: [idOf(shared)] } });
    assert.deepEqual(del.body.removed, [idOf(shared)]);
    assert.equal((await rowsOfId(s, idOf(shared))).length, 0, 'the rows of both stores went');
    assert.equal(r2Keys(s.r2).length, 3);
    assert.equal((await call(s.backend, `/shop-a${shared}`)).status, 404);
    assert.equal((await s.api('/media/files/delete', { method: 'POST', body: { ids: [] } })).status, 400);
    // "Delete everything unused" spares fresh files and files kept in a store library, takes the old ones.
    assert.equal((await s.api('/media/files/delete', { method: 'POST', body: { allUnused: true } })).body.removed.length, 0, 'fresh files are never swept');
    await s.db.query('UPDATE media SET created_at=1 WHERE id=$1', [idOf(lonely)]);
    assert.equal((await s.api('/media/files/delete', { method: 'POST', body: { allUnused: true } })).body.removed.length, 0, 'a file kept in a store library (uploaded there on purpose) is spared too');
    await s.db.query('UPDATE media SET lib=0 WHERE id=$1', [idOf(lonely)]);
    const swept = await s.api('/media/files/delete', { method: 'POST', body: { allUnused: true } });
    assert.deepEqual(swept.body.removed, [idOf(lonely)]);
    assert.equal(swept.body.remaining, 0);
    assert.equal(r2Keys(s.r2).length, 2, 'only the two files that are shown remain');
    // Forced deletion of a shown file works and is explicit.
    const forced = await s.api('/media/files/delete', { method: 'POST', body: { ids: [idOf(inDemo)], force: true } });
    assert.deepEqual(forced.body.removed, [idOf(inDemo)]);
    assert.ok((await s.api('/audit?limit=20')).body.some(e => e.action === 'media.files.delete'));
  } finally { s.cleanup(); }
});

test('platform library: files in render requests / personal spaces count as used by clients, and are protected from "delete unused"', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 31);
    await s.db.query('UPDATE media SET created_at=1 WHERE id=$1', [idOf(pic)]);
    await s.db.query("INSERT INTO requests(tenant_id,id,user_id,created_at,data) VALUES($1,'req-1','usr-1',1,$2)", [a.tenant.id, JSON.stringify({ aiResult: pic })]);
    const line = (await files(s)).items[0];
    assert.equal(line.used, false);
    assert.equal(line.inClientData, true);
    assert.equal((await files(s, '?usage=unused')).total, 0, 'a client\'s result is not "unused"');
    assert.equal((await s.api('/media/files/delete', { method: 'POST', body: { allUnused: true } })).body.removed.length, 0);
    assert.equal((await s.api('/media/files/delete', { method: 'POST', body: { ids: [idOf(pic)] } })).body.blocked[0].reason, 'IN_USE'.replace('IN_USE', 'IN_CLIENT_DATA'));
    assert.equal(r2Keys(s.r2).length, 1);
  } finally { s.cleanup(); }
});

test('storage audit: a healthy platform reports healthy and the repair changes nothing', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    await s.upload(a, 41); await s.upload(a, 42);
    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.healthy, true, JSON.stringify(audit));
    assert.equal(audit.storages.r2.checked, true);
    assert.equal(audit.storages.r2.objects, 2);
    assert.equal(audit.orphans.files, 0);
    const before = new Map(s.r2.objects);
    const fixed = (await s.api('/media/repair', { method: 'POST', body: { orphans: true, broken: true } })).body;
    assert.equal(fixed.migrated + fixed.copied + fixed.orphansDeleted + fixed.brokenRemoved + fixed.repointed + fixed.sizes, 0);
    assert.deepEqual([...s.r2.objects.keys()], [...before.keys()]);
  } finally { s.cleanup(); }
});

test('storage audit: legacy t/<store>/media objects join the shared namespace safely (copy -> verify -> flag), the old copy waits 24 h, other stores keep reading it', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pic = await s.upload(a, 51);
    const id = await legacyize(s, a.tenant.id, pic);
    // Another store got a row for it through an old clone (it also points at a's own prefix, which is how old clones worked).
    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.legacy.files, 1, JSON.stringify(audit));
    assert.equal(audit.healthy, false);
    assert.equal(audit.orphans.files, 0, 'the legacy object is claimed by its row, not an orphan');
    assert.equal(audit.missing.files, 0);
    assert.equal((await s.api('/media/audit', { method: 'POST' })).status, 200);
    assert.equal(s.r2.objects.has(`media/${id}.png`), false, 'audit is read-only');

    const fixed = (await s.api('/media/repair', { method: 'POST', body: {} })).body;
    assert.equal(fixed.migrated, 1, JSON.stringify(fixed));
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'copied to the shared key');
    assert.equal(s.r2.objects.has(`t/${a.tenant.id}/media/${id}.png`), true, 'the old copy is kept as a safety net');
    assert.equal((await rowsOfId(s, id))[0].ns, 1);
    assert.equal((await call(s.backend, `/shop-a${pic}`)).status, 302);
    assert.ok((await call(s.backend, `/shop-a${pic}`)).headers.location.endsWith(`/media/${id}.png`));
    // Not yet 24 h: cleanup keeps it. After 24 h and a verified shared copy it removes the old one.
    assert.equal((await s.api('/media/cleanup', { method: 'POST' })).body.removed, 0);
    await s.db.query('UPDATE saas_media_old SET moved_at=1');
    assert.equal((await s.api('/media/cleanup', { method: 'POST' })).body.removed, 1);
    assert.equal(s.r2.objects.has(`t/${a.tenant.id}/media/${id}.png`), false);
    assert.equal(s.r2.objects.has(`media/${id}.png`), true);
    assert.equal((await s.api('/media/audit', { method: 'POST' })).body.healthy, true);
    // The store that was only the owner deletes it: now it really goes.
    assert.equal((await call(s.backend, `/shop-a/api/admin/library/${id}`, { method: 'DELETE', headers: a.headers })).status, 200);
    assert.equal(r2Keys(s.r2).length, 0);
    void b;
  } finally { s.cleanup(); }
});

test('legacy clone: a demo whose files are still at its own prefix is cloned by rows, shared at the shared key, and deleting any one keeps the others working', async () => {
  const s = await setup();
  try {
    const demoMade = await s.api('/demos', { method: 'POST', body: { name: 'Old demo' } });
    const demo = demoMade.body.demo;
    const demoStore = { slug: demo.slug, tenant: { id: demo.tenantId }, headers: await s.login(demo.slug, demoMade.body.admin.id, demoMade.body.admin.password) };
    const pic = await s.upload(demoStore, 61);
    const id = await legacyize(s, demo.tenantId, pic);
    const one = await s.api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'clone-a', owner: { email: 'a@x.test' } } });
    const two = await s.api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'clone-b', owner: { email: 'b@x.test' } } });
    assert.equal(one.status, 201, JSON.stringify(one.body));
    assert.equal(two.status, 201, JSON.stringify(two.body));
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'copied ONCE to the shared key');
    assert.equal((await rowsOfId(s, id)).length, 3);
    assert.equal((await call(s.backend, `/clone-a${pic}`)).status, 302);
    assert.equal((await call(s.backend, `/clone-b${pic}`)).status, 302);
    // Delete the demo: its own-prefix copy goes with it (it is the demo's alone); the shared object stays for the clones.
    assert.equal((await s.api(`/demos/${demo.id}`, { method: 'DELETE', body: { confirmSlug: demo.slug } })).status, 200);
    assert.equal(s.r2.objects.has(`t/${demo.tenantId}/media/${id}.png`), false);
    assert.equal(s.r2.objects.has(`media/${id}.png`), true);
    assert.equal((await call(s.backend, `/clone-a${pic}`)).status, 302);
    assert.equal((await s.api(`/tenants/${one.body.tenant.id}`, { method: 'DELETE', body: { confirmSlug: 'clone-a' } })).status, 200);
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'clone-b still uses it');
    assert.equal((await s.api(`/tenants/${two.body.tenant.id}`, { method: 'DELETE', body: { confirmSlug: 'clone-b' } })).status, 200);
    assert.equal(r2Keys(s.r2).length, 0, 'the last owner is gone: nothing left in storage');
    assert.equal([...s.r2.objects.keys()].length, 0);
  } finally { s.cleanup(); }
});

test('storage audit: missing objects, strays, orphans, wrong sizes; repair is opt-in for what deletes, recent orphans and unreadable storages are never touched', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const gone = await s.upload(a, 71), sized = await s.upload(a, 72), fine = await s.upload(a, 73), unknown = await s.upload(a, 74);
    // 1 row whose object vanished
    s.r2.objects.delete(`media/${idOf(gone)}.png`);
    // 2 a wrong recorded size (the bytes are intact: their hash is the id)
    await s.db.query('UPDATE media SET size=999 WHERE id=$1', [idOf(sized)]);
    // 3 an unknown size
    await s.db.query('UPDATE media SET size=NULL WHERE id=$1', [idOf(unknown)]);
    // 4 orphans: an old one and a fresh one, plus a foreign key shape that must never be listed
    const orphan = 'media/' + 'a'.repeat(32) + '.png', fresh = 'media/' + 'b'.repeat(32) + '.png';
    s.r2.objects.set(orphan, { body: Buffer.alloc(30, 1), mime: 'image/png', modified: 1 });
    s.r2.objects.set(fresh, { body: Buffer.alloc(30, 2), mime: 'image/png', modified: Date.now() });
    s.r2.objects.set('media/not-ours.txt', { body: Buffer.alloc(5), mime: 'text/plain', modified: 1 });
    s.r2.objects.set('other-app/data.bin', { body: Buffer.alloc(5), mime: 'x', modified: 1 });
    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.missing.files, 1);
    assert.equal(audit.sizeMismatch.files, 1);
    assert.equal(audit.sizeUnknown.files, 1);
    assert.equal(audit.orphans.files, 2);
    assert.equal(audit.orphans.deletable, 1, 'the fresh upload is given an hour');
    assert.equal(audit.orphans.recent, 1);
    assert.ok(!JSON.stringify(audit).includes('not-ours'), 'keys of another shape are never listed');

    // Default repair: only the non-destructive steps.
    const safe = (await s.api('/media/repair', { method: 'POST', body: {} })).body;
    assert.equal(safe.sizes, 2);
    assert.equal(safe.orphansDeleted, 0);
    assert.equal(safe.brokenRemoved, 0);
    assert.equal((await s.db.query('SELECT size FROM media WHERE id=$1', [idOf(sized)]))[0].size, 40 + 8);
    assert.equal(s.r2.objects.has(orphan), true);
    assert.equal((await rowsOfId(s, idOf(gone))).length, 1, 'a broken row is kept until the owner agrees');

    // A storage that cannot be listed is reported as unchecked: nothing is concluded about it.
    r2Failure.on = true;
    const blind = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(blind.storages.r2.checked, false);
    assert.equal(blind.missing.files, 0, 'not "all missing": it simply was not checked');
    assert.equal(blind.orphans.files, 0);
    const blindRepair = (await s.api('/media/repair', { method: 'POST', body: { orphans: true, broken: true } })).body;
    assert.equal(blindRepair.orphansDeleted + blindRepair.brokenRemoved, 0);
    assert.equal((await rowsOfId(s, idOf(gone))).length, 1);
    r2Failure.on = false;

    const full = (await s.api('/media/repair', { method: 'POST', body: { orphans: true, broken: true } })).body;
    assert.equal(full.orphansDeleted, 1);
    assert.equal(full.brokenRemoved, 1);
    assert.equal(s.r2.objects.has(orphan), false);
    assert.equal(s.r2.objects.has(fresh), true, 'a fresh object is never removed');
    assert.equal((await rowsOfId(s, idOf(gone))).length, 0);
    assert.equal((await rowsOfId(s, idOf(fine))).length, 1);
    assert.equal(s.r2.objects.has(`media/${idOf(fine)}.png`), true);
    assert.equal(s.r2.objects.has('other-app/data.bin'), true, 'the bucket\'s other contents are untouched');
    assert.equal((await s.api('/media/repair', { method: 'POST', body: { orphans: true } })).status, 200);
  } finally { s.cleanup(); }
});

test('storage audit: a row pointing at the wrong storage is repointed; an app-folder listing works; an empty-looking bucket is not trusted', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pics = [];
    for (let i = 0; i < 8; i++) pics.push(await s.upload(a, 80 + i));
    // The object is in the app folder while the row says r2.
    const one = idOf(pics[0]);
    const fsStore = require('../server/media').createFsStorage({ MEDIA_DIR: s.dir });
    await fsStore.put(`media/${one}.png`, s.r2.objects.get(`media/${one}.png`).body);
    s.r2.objects.delete(`media/${one}.png`);
    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.wrongStorage.files, 1, JSON.stringify(audit));
    assert.equal(audit.storages.fs.checked, true);
    assert.equal(audit.storages.fs.objects, 1);
    assert.equal(audit.missing.files, 0);
    assert.equal((await s.api('/media/repair', { method: 'POST', body: {} })).body.repointed, 1);
    assert.equal((await rowsOfId(s, one))[0].storage, 'fs');
    assert.equal((await call(s.backend, `/shop-a${pics[0]}`)).status, 200, 'served from the folder now');
    // A bucket that lists as EMPTY while the database expects its files = the wrong bucket, not "everything is gone".
    s.r2.objects.clear();
    const blind = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(blind.storages.r2.checked, false);
    assert.equal(blind.storages.r2.error, 'LOOKS_EMPTY');
    assert.equal(blind.missing.files, 0);
    assert.equal((await s.api('/media/repair', { method: 'POST', body: { broken: true } })).body.brokenRemoved, 0);
    assert.equal((await s.db.query("SELECT COUNT(*) AS n FROM media WHERE storage='r2'"))[0].n > 0, true, 'no row was deleted');
  } finally { s.cleanup(); }
});

test('delete race: a store that re-adds a picture while another store deletes the last other copy never ends with a row and no object', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pic = await s.upload(a, 91);
    const id = idOf(pic);
    // b uploads the same bytes while a deletes: whichever order, b's row must point at an object that exists.
    const results = await Promise.all([
      call(s.backend, `/shop-a/api/admin/library/${id}`, { method: 'DELETE', headers: a.headers }),
      call(s.backend, '/shop-b/api/admin/media', { method: 'POST', headers: b.headers, body: { data: png(91) } }),
    ]);
    assert.equal(results[1].status, 200);
    const rows = await rowsOfId(s, id);
    assert.ok(rows.some(r => r.tenant_id === b.tenant.id), 'b has its row');
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'and the object it points at exists');
    assert.equal((await call(s.backend, `/shop-b${pic}`)).status, 302);
    assert.equal((await s.api('/media/audit', { method: 'POST' })).body.missing.files, 0);
  } finally { s.cleanup(); }
});

// ---------- Repair safety: the last copy of a file is never deleted (regression tests for the "broken rows + orphans" data-loss case) ----------
const bodyOf = (r2, key) => Buffer.from(r2.objects.get(key).body);

test('repair: the only surviving copy sits under ANOTHER store\'s old prefix -> it is recovered to the shared key, nothing is deleted, even with both delete switches on', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pic = await s.upload(a, 91);
    const id = idOf(pic);
    const strayKey = `t/${b.tenant.id}/media/${id}.png`;
    s.r2.objects.set(strayKey, s.r2.objects.get(`media/${id}.png`));
    s.r2.objects.delete(`media/${id}.png`);

    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.missing.files, 0, 'a copy exists elsewhere: the row is NOT missing');
    assert.equal(audit.recoverable.files, 1, JSON.stringify(audit));
    assert.equal(audit.orphans.deletable, 0, 'the stray object is the only copy of a file a row needs: never deletable');
    assert.equal(audit.orphans.kept, 1);
    assert.equal(audit.healthy, false);

    const fixed = (await s.api('/media/repair', { method: 'POST', body: { orphans: true, broken: true } })).body;
    assert.equal(fixed.recovered, 1, JSON.stringify(fixed));
    assert.equal(fixed.brokenRemoved, 0);
    assert.equal(fixed.orphansDeleted, 0);
    assert.equal((await rowsOfId(s, id)).length, 1, 'the row is still there');
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'the file is back at the key the row expects');
    assert.equal(s.r2.objects.has(strayKey), true, 'the other copy is kept (nothing was deleted)');
    assert.equal((await call(s.backend, `/shop-a${pic}`)).status, 302);
    assert.equal((await s.api('/media/audit', { method: 'POST' })).body.missing.files, 0);
  } finally { s.cleanup(); }
});

test('repair: a surviving copy whose bytes are NOT the file (same name, other content) is never used, never trusted, and never deleted', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pic = await s.upload(a, 92);
    const id = idOf(pic);
    const strayKey = `t/${b.tenant.id}/media/${id}.png`;
    const impostor = Buffer.alloc(s.r2.objects.get(`media/${id}.png`).body.length, 7); // same size, other bytes
    s.r2.objects.set(strayKey, { body: impostor, mime: 'image/png' });
    s.r2.objects.delete(`media/${id}.png`);
    const fixed = (await s.api('/media/repair', { method: 'POST', body: { orphans: true, broken: true } })).body;
    assert.equal(fixed.recovered, 0, 'bytes that do not hash to the id are not the file');
    assert.equal(s.r2.objects.has(`media/${id}.png`), false, 'nothing was written under the shared key');
    assert.equal(s.r2.objects.has(strayKey), true, 'and nothing was deleted');
    assert.equal(fixed.orphansDeleted, 0);
    assert.equal(fixed.brokenRemoved, 0, 'the row is kept: a copy exists, a human decides');
    assert.equal((await rowsOfId(s, id)).length, 1);
  } finally { s.cleanup(); }
});

test('repair: when the other storage cannot be read, a row that looks missing is "unverified", never deleted', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 93);
    const id = idOf(pic);
    s.r2.objects.delete(`media/${id}.png`);
    fs.rmSync(s.dir, { recursive: true, force: true }); // the app folder cannot be listed any more (unmounted disk)
    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.storages.fs.checked, false);
    assert.equal(audit.missing.files, 0, 'the file may be in the app folder: not "missing"');
    assert.equal(audit.unverified.files, 1, JSON.stringify(audit));
    assert.equal(audit.healthy, false);
    const fixed = (await s.api('/media/repair', { method: 'POST', body: { orphans: true, broken: true } })).body;
    assert.equal(fixed.brokenRemoved, 0);
    assert.equal((await rowsOfId(s, id)).length, 1);
  } finally { s.cleanup(); }
});

test('repair: a file that exists NOWHERE is still reported missing, and its row is removed only with the explicit switch', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const gone = idOf(await s.upload(a, 94));
    s.r2.objects.delete(`media/${gone}.png`);
    const audit = (await s.api('/media/audit', { method: 'POST' })).body;
    assert.equal(audit.missing.files, 1);
    assert.equal(audit.recoverable.files, 0);
    assert.equal(audit.unverified.files, 0);
    assert.equal((await s.api('/media/repair', { method: 'POST', body: {} })).body.brokenRemoved, 0);
    assert.equal((await rowsOfId(s, gone)).length, 1);
    assert.equal((await s.api('/media/repair', { method: 'POST', body: { broken: true } })).body.brokenRemoved, 1);
    assert.equal((await rowsOfId(s, gone)).length, 0);
  } finally { s.cleanup(); }
});

test('repair: an orphan object is deleted only when a copy at a row\'s own key holds EXACTLY the same bytes (same size is not enough)', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pic = await s.upload(a, 95);
    const id = idOf(pic);
    const real = bodyOf(s.r2, `media/${id}.png`);
    const impostorKey = `t/${b.tenant.id}/media/${id}.png`;
    s.r2.objects.set(impostorKey, { body: Buffer.alloc(real.length, 9), mime: 'image/png' }); // same size, different bytes
    const refused = (await s.api('/media/repair', { method: 'POST', body: { orphans: true } })).body;
    assert.equal(refused.orphansDeleted, 0, JSON.stringify(refused));
    assert.equal(s.r2.objects.has(impostorKey), true);
    // A true duplicate (same bytes) of a healthy file is safe to remove.
    s.r2.objects.set(impostorKey, { body: real, mime: 'image/png' });
    const done = (await s.api('/media/repair', { method: 'POST', body: { orphans: true } })).body;
    assert.equal(done.orphansDeleted, 1, JSON.stringify(done));
    assert.equal(s.r2.objects.has(impostorKey), false);
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'the real file is untouched');
  } finally { s.cleanup(); }
});

test('repair: migrating an old-layout file refuses to join the shared key when an object with the same size but other bytes already sits there', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 96);
    const id = await legacyize(s, a.tenant.id, pic);
    const own = `t/${a.tenant.id}/media/${id}.png`;
    s.r2.objects.set(`media/${id}.png`, { body: Buffer.alloc(s.r2.objects.get(own).body.length, 5), mime: 'image/png' });
    const fixed = (await s.api('/media/repair', { method: 'POST', body: {} })).body;
    assert.equal(fixed.migrated, 0, JSON.stringify(fixed));
    assert.equal((await rowsOfId(s, id))[0].ns, 0, 'the row stays in the old layout');
    assert.equal(s.r2.objects.has(own), true, 'the real file is untouched');
    // Same bytes at the shared key: it joins, as before.
    s.r2.objects.set(`media/${id}.png`, { body: bodyOf(s.r2, own), mime: 'image/png' });
    assert.equal((await s.api('/media/repair', { method: 'POST', body: {} })).body.migrated, 1);
  } finally { s.cleanup(); }
});

test('cleanup: an old own-prefix copy is removed only when the shared object holds exactly its bytes', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 97);
    const id = await legacyize(s, a.tenant.id, pic);
    const own = `t/${a.tenant.id}/media/${id}.png`;
    assert.equal((await s.api('/media/repair', { method: 'POST', body: {} })).body.migrated, 1);
    await s.db.query('UPDATE saas_media_old SET moved_at=1');
    const original = bodyOf(s.r2, own);
    s.r2.objects.set(`media/${id}.png`, { body: Buffer.alloc(original.length, 3), mime: 'image/png' }); // shared object got corrupted (same size)
    assert.equal((await s.api('/media/cleanup', { method: 'POST' })).body.removed, 0, 'not proven identical: the old copy stays');
    assert.equal(s.r2.objects.has(own), true);
    s.r2.objects.set(`media/${id}.png`, { body: original, mime: 'image/png' });
    assert.equal((await s.api('/media/cleanup', { method: 'POST' })).body.removed, 1);
    assert.equal(s.r2.objects.has(own), false);
  } finally { s.cleanup(); }
});
