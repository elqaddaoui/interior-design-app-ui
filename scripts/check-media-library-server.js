/**
 * Media & storage: ONE shared namespace by file hash (clone / restore copy rows, never bytes; an object is deleted only with its last row),
 * WordPress-like library listing every file of a store, move between R2 and the server folder, gated cleanup, isolation between stores.
 * Driven through the real request handler.
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

test('library: lists EVERY file of the store (uploads, renders, photos in content), only that store\'s, editable; a file in use cannot be deleted', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const urlA = await s.upload(a, 1, { title: 'Hero' });
    await s.upload(b, 2);
    // A picture that did not come through the library (a data URL inside content) is a file of the store as well.
    const saved = await call(s.backend, '/shop-a/api/admin/doc/branding', { method: 'PATCH', headers: a.headers, body: { loaderCustomUri: png(5) } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const listA = await s.lib(a);
    assert.equal(listA.status, 200, JSON.stringify(listA.body));
    assert.equal(own(listA.body).length, 2, 'upload + picture saved inside content');
    assert.ok(listA.body.items.some(i => i.url === urlA && i.title === 'Hero'));
    assert.equal(own(listA.body).filter(i => i.used).length, 1, 'the picture used by content is flagged in use');
    assert.equal(own((await s.lib(b)).body).length, 1, 'a store lists only its own files');
    const id = idOf(urlA);
    assert.equal((await call(s.backend, `/shop-b/api/admin/library/${id}`, { headers: b.headers })).status, 404);
    assert.equal((await call(s.backend, `/shop-b/api/admin/library/${id}`, { method: 'DELETE', headers: b.headers })).status, 404);
    const patched = await call(s.backend, `/shop-a/api/admin/library/${id}`, { method: 'PATCH', headers: a.headers, body: { title: 'Banner', alt: 'A banner' } });
    assert.equal(patched.body.title, 'Banner');
    assert.equal((await s.lib(a, '?q=banner')).body.total, 1);
    assert.equal(own((await s.lib(a, '?kind=video')).body).length, 0);
    assert.equal((await call(s.backend, '/shop-a/api/admin/doc/branding', { method: 'PATCH', headers: a.headers, body: { logoUri: urlA } })).status, 200);
    const detail = await call(s.backend, `/shop-a/api/admin/library/${id}`, { headers: a.headers });
    assert.deepEqual(detail.body.usedIn, [{ type: 'doc', name: 'branding' }]);
    const blocked = await call(s.backend, `/shop-a/api/admin/library/${id}`, { method: 'DELETE', headers: a.headers });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'IN_USE');
    const spare = await s.upload(a, 3);
    const before = r2Keys(s.r2).length;
    const gone = await call(s.backend, `/shop-a/api/admin/library/${idOf(spare)}`, { method: 'DELETE', headers: a.headers });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal(r2Keys(s.r2).length, before - 1, 'the only owner deleted it: the object is gone from storage too');
    assert.equal((await call(s.backend, `/shop-a${spare}`)).status, 404);
    assert.equal((await call(s.backend, '/shop-a/api/admin/library')).status, 401);
    // There is no per-store policy any more: the session never reports one, the library is always there.
    assert.equal((await call(s.backend, '/shop-a/api/admin/session', { headers: a.headers })).body.instance.mediaOwn, undefined);
  } finally { s.cleanup(); }
});

test('shared namespace: two stores uploading the same picture store ONE object; each deletes only its own row; the last owner removes the object', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const urlA = await s.upload(a, 11), urlB = await s.upload(b, 11, { title: 'Mine' });
    assert.equal(urlA, urlB, 'same hash, same URL');
    const id = idOf(urlA);
    assert.equal(r2Keys(s.r2).length, 1, 'one stored object');
    assert.deepEqual((await rowsOfId(s, id)).map(r => r.tenant_id).sort(), [a.tenant.id, b.tenant.id].sort(), 'one row per store');
    assert.equal(own((await s.lib(b)).body)[0].title, 'Mine', 'each store has its own title');
    // A deletes: B keeps the file (object untouched).
    assert.equal((await call(s.backend, `/shop-a/api/admin/library/${id}`, { method: 'DELETE', headers: a.headers })).status, 200);
    assert.equal(r2Keys(s.r2).length, 1, 'still stored: another store uses it');
    assert.equal((await call(s.backend, `/shop-a${urlA}`)).status, 404, 'A lost it');
    assert.equal((await call(s.backend, `/shop-b${urlA}`)).status, 302, 'B still serves it');
    // B was the last owner: now the object goes too.
    assert.equal((await call(s.backend, `/shop-b/api/admin/library/${id}`, { method: 'DELETE', headers: b.headers })).status, 200);
    assert.equal(r2Keys(s.r2).length, 0, 'last owner: deleted from where it is hosted');
  } finally { s.cleanup(); }
});

test('clone from a demo copies ROWS only (no new object); deleting in the clone keeps the demo\'s file; deleting the demo keeps the clone\'s', async () => {
  const s = await setup();
  try {
    const demoMade = await s.api('/demos', { method: 'POST', body: { name: 'Showroom' } });
    assert.equal(demoMade.status, 201, JSON.stringify(demoMade.body));
    const demo = demoMade.body.demo;
    const demoStore = { slug: demo.slug, tenant: { id: demo.tenantId }, headers: await s.login(demo.slug, demoMade.body.admin.id, demoMade.body.admin.password) };
    const pic = await s.upload(demoStore, 7, { title: 'Logo' });
    assert.equal((await call(s.backend, `/${demo.slug}/api/admin/doc/branding`, { method: 'PATCH', headers: demoStore.headers, body: { logoUri: pic } })).status, 200);
    const objects = r2Keys(s.r2).length;

    const one = await s.api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'clone-1', owner: { email: 'o@x.test' } } });
    assert.equal(one.status, 201, JSON.stringify(one.body));
    const two = await s.api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'clone-2', owner: { email: 't@x.test' } } });
    assert.equal(two.status, 201, JSON.stringify(two.body));
    assert.equal(r2Keys(s.r2).length, objects, 'cloning wrote no object');
    assert.equal(one.body.tenant.mediaOwn, undefined);
    const id = idOf(pic);
    assert.equal((await rowsOfId(s, id)).length, 3, 'a row in the demo and in each clone');
    for (const slug of ['clone-1', 'clone-2']) {
      const res = await call(s.backend, `/${slug}${pic}`);
      assert.equal(res.status, 302);
      assert.ok(res.headers.location.endsWith(`/media/${id}.png`), 'every store serves the shared object');
    }
    const shop = { headers: await s.login('clone-1', one.body.admin.id, one.body.admin.password) };
    const listed = await call(s.backend, '/clone-1/api/admin/library', { headers: shop.headers });
    assert.equal(own(listed.body).length, 1, 'the clone sees the demo\'s file in its own library');
    assert.equal(own(listed.body)[0].title, 'Logo');
    // The clone removes it from its own library (after dropping it from its content): the demo still has it.
    await call(s.backend, '/clone-1/api/admin/doc/branding', { method: 'PATCH', headers: shop.headers, body: { logoUri: '' } });
    assert.equal((await call(s.backend, `/clone-1/api/admin/library/${id}`, { method: 'DELETE', headers: shop.headers })).status, 200);
    assert.equal(r2Keys(s.r2).length, objects, 'the object stays: the demo and clone-2 use it');
    assert.equal((await call(s.backend, `/${demo.slug}${pic}`)).status, 302);
    // Deleting the demo deletes its rows only; clone-2 keeps working.
    const deleted = await s.api(`/demos/${demo.id}`, { method: 'DELETE', body: { confirmSlug: demo.slug } });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(r2Keys(s.r2).length, objects, 'still used by clone-2');
    assert.equal((await call(s.backend, `/clone-2${pic}`)).status, 302);
    // Deleting the last store that holds it removes the object from storage.
    const last = await s.api(`/tenants/${two.body.tenant.id}`, { method: 'DELETE', body: { confirmSlug: 'clone-2' } });
    assert.equal(last.status, 200, JSON.stringify(last.body));
    assert.equal(r2Keys(s.r2).length, 0, 'nobody uses it any more');
    assert.equal((await rowsOfId(s, id)).length, 0);
  } finally { s.cleanup(); }
});

test('theme: a store made from a theme shares the theme\'s files; deleting the theme keeps them', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 21);
    assert.equal((await call(s.backend, '/shop-a/api/admin/doc/branding', { method: 'PATCH', headers: a.headers, body: { logoUri: pic } })).status, 200);
    const made = await s.api('/themes', { method: 'POST', body: { tenantIds: [a.tenant.id] } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const objects = r2Keys(s.r2).length;
    const demo = await s.api('/demos', { method: 'POST', body: { name: 'From theme', themeId: made.body[0].id } });
    assert.equal(demo.status, 201, JSON.stringify(demo.body));
    assert.equal(r2Keys(s.r2).length, objects, 'no object written for the theme or the demo');
    assert.equal((await s.api(`/themes/${made.body[0].id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await call(s.backend, `/${demo.body.demo.slug}${pic}`)).status, 302, 'the demo still shows the picture');
    assert.equal((await call(s.backend, `/shop-a${pic}`)).status, 302);
  } finally { s.cleanup(); }
});

test('move all media R2 -> server folder -> R2: shared objects move once, verified, resumable, old copies kept 24 h then cleaned', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const urls = [await s.upload(a, 1), await s.upload(a, 2), await s.upload(b, 3), await s.upload(b, 1)]; // b's 4th = same bytes as a's first
    const overview = await s.api('/media');
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.equal(overview.body.storage.current, 'r2');
    assert.equal(overview.body.totals.r2.files, 3, 'three stored objects (a shared one counts once)');
    const perStore = Object.fromEntries(overview.body.stores.map(x => [x.slug, x]));
    assert.equal(perStore['shop-a'].files, 2);
    assert.equal(perStore['shop-b'].files, 2);
    assert.ok(perStore['shop-a'].bytes > 0);
    assert.equal(overview.body.defaultOwn, undefined);
    assert.equal(overview.body.stores[0].mediaOwn, undefined);

    const started = await s.api('/media/storage', { method: 'PUT', body: { storage: 'app', move: true } });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.move.status, 'running');
    assert.equal(started.body.move.total, 3);
    assert.equal((await s.api('/media/storage', { method: 'PUT', body: { storage: 'r2', move: true } })).status, 409, 'one move at a time');
    let status;
    for (let i = 0; i < 20; i++) { status = (await s.api('/media/move/step', { method: 'POST' })).body; if (status.status !== 'running') break; }
    assert.equal(status.status, 'done', JSON.stringify(status));
    assert.equal(status.done, 3, 'the shared object moved once');
    assert.equal(status.failed, 0);
    const rows = await s.db.query('SELECT storage FROM media WHERE storage IN (\'r2\',\'fs\',\'db\')');
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.storage === 'fs'), 'every row (also the other store\'s row of a shared file) points at the server folder');
    const served = await call(s.backend, `/shop-a${urls[0]}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers['content-type'], 'image/png');
    assert.equal((await call(s.backend, `/shop-b${urls[3]}`)).status, 200);
    const fresh = await s.upload(a, 4);
    assert.equal((await s.db.query('SELECT storage FROM media WHERE id=$1', [idOf(fresh)]))[0].storage, 'fs');
    assert.equal(r2Keys(s.r2).length, 3);
    let state = await s.api('/media');
    assert.equal(state.body.oldCopies.files, 3);
    assert.equal(state.body.oldCopies.cleanable, false);
    assert.equal((await s.api('/media/cleanup', { method: 'POST' })).body.removed, 0);
    assert.equal(r2Keys(s.r2).length, 3);
    await s.db.query('UPDATE saas_media_old SET moved_at=$1', [Date.now() - 25 * 3600 * 1000]);
    const late = await s.api('/media/cleanup', { method: 'POST' });
    assert.equal(late.body.removed, 3, JSON.stringify(late.body));
    assert.equal(s.r2.objects.size, 0);
    assert.equal((await call(s.backend, `/shop-b${urls[2]}`)).status, 200, 'still served from disk');

    const back = await s.api('/media/storage', { method: 'PUT', body: { storage: 'r2', move: true } });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    for (let i = 0; i < 20; i++) { status = (await s.api('/media/move/step', { method: 'POST' })).body; if (status.status !== 'running') break; }
    assert.equal(status.status, 'done');
    assert.equal(status.done, 4);
    assert.equal(r2Keys(s.r2).length, 4);
    assert.equal((await call(s.backend, `/shop-a${urls[0]}`)).status, 302);
  } finally { s.cleanup(); }
});

test('move: a file whose source is missing is counted as failed and skipped; an unavailable target is refused; the old policy routes are gone', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const url = await s.upload(a, 1);
    await s.upload(a, 2);
    s.r2.objects.delete(`media/${idOf(url)}.png`);
    assert.equal((await s.api('/media/storage', { method: 'PUT', body: { storage: 'app', move: true } })).status, 200);
    let status;
    for (let i = 0; i < 20; i++) { status = (await s.api('/media/move/step', { method: 'POST' })).body; if (status.status !== 'running') break; }
    assert.equal(status.status, 'done');
    assert.equal(status.done, 1);
    assert.equal(status.failed, 1);
    assert.equal((await s.db.query('SELECT storage FROM media WHERE id=$1', [idOf(url)]))[0].storage, 'r2', 'the failed row was not repointed');
    assert.equal((await s.api('/media/storage', { method: 'PUT', body: { storage: 'nowhere' } })).status, 400);
    assert.equal((await s.api('/media/default', { method: 'PUT', body: { own: true } })).status, 404);
    assert.equal((await s.api(`/tenants/${a.tenant.id}/media`, { method: 'PATCH', body: { own: true } })).status, 404);
    assert.equal((await call(s.backend, '/api/super-admin/media', { headers: a.headers })).status, 401, 'a store admin never reaches the console');
  } finally { s.cleanup(); }
});

test('backup / restore: a restored picture joins the shared namespace (no new object when it exists), or is stored once when it does not', async () => {
  const s = await setup();
  const h = require('./backup-harness');
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const url = await s.upload(a, 1);
    await s.upload(a, 2);
    const id = idOf(url);
    const P = '/shop-a/api/admin/backup';
    const made = await h.startBackup(s.backend, a.headers, P, { type: 'db', data: 'content', media: true });
    assert.equal(made.status, 202, JSON.stringify(made.body));
    assert.equal(made.job.status, 'done', JSON.stringify(made.job.errors));
    const zip = (await h.download(s.backend, a.headers, P, made.job.id)).bytes;

    // 1) Restore into the same store while the objects exist: nothing is written, the rows stay.
    const objects = r2Keys(s.r2).length;
    const again = await h.upload(s.backend, a.headers, P, zip);
    assert.equal(again.job.result.plan.restorable.media, true);
    assert.ok(!again.job.result.plan.warnings.some(w => w.code === 'MEDIA_NOT_ALLOWED'));
    const restored = await h.restore(s.backend, a.headers, P, { uploadId: again.id, confirm: true, parts: { media: true } });
    assert.equal(restored.status, 202, JSON.stringify(restored.body));
    assert.equal(restored.job.status, 'done', JSON.stringify(restored.job.errors));
    assert.equal(r2Keys(s.r2).length, objects, 'no duplicate object');
    assert.equal(own((await s.lib(a)).body).length, 2);

    // 2) Restore into ANOTHER store: it gets rows pointing at the same objects.
    const other = await h.upload(s.backend, b.headers, '/shop-b/api/admin/backup', zip);
    const into = await h.restore(s.backend, b.headers, '/shop-b/api/admin/backup', { uploadId: other.id, confirm: true, parts: { media: true } });
    assert.equal(into.status, 202, JSON.stringify(into.body));
    assert.equal(into.job.status, 'done', JSON.stringify(into.job.errors));
    assert.equal(r2Keys(s.r2).length, objects, 'still the same two objects');
    assert.equal(own((await s.lib(b)).body).length, 2, 'shop-b now has both files');
    assert.equal((await call(s.backend, `/shop-b${url}`)).status, 302);

    // 3) Both stores delete the picture: the object disappears with the last row. Restoring the backup then stores it again (once).
    for (const [slug, who] of [['shop-a', a], ['shop-b', b]]) assert.equal((await call(s.backend, `/${slug}/api/admin/library/${id}`, { method: 'DELETE', headers: who.headers })).status, 200);
    assert.equal(r2Keys(s.r2).length, objects - 1);
    const third = await h.upload(s.backend, a.headers, P, zip);
    const back = await h.restore(s.backend, a.headers, P, { uploadId: third.id, confirm: true, parts: { media: true } });
    assert.equal(back.job.status, 'done', JSON.stringify(back.job.errors));
    assert.equal(r2Keys(s.r2).length, objects, 'the object is back, exactly once');
    assert.equal((await call(s.backend, `/shop-a${url}`)).status, 302);
  } finally { s.cleanup(); }
});

test('database storage: a shared picture keeps its bytes when the store that held them deletes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-dbmedia-'));
  const db = await freshDb();
  const backend = createBackend({ env: { ...ENV, MEDIA_DIR: dir }, db, media: { storage: null, download: offline } });
  try {
    await backend.db.query('select 1');
    await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
    backend.tenants.invalidate();
    const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: native, body: SUPER });
    const sa = { 'x-super-token': signin.body.token };
    const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { ...sa, ...(opts.headers || {}) } });
    const mk = async slug => {
      const r = await api('/tenants', { method: 'POST', body: { name: `Shop ${slug}`, slug, ownerEmail: `o@${slug}.test` } });
      const l = await call(backend, `/${slug}/api/admin/login`, { method: 'POST', headers: native, body: { email: r.body.admin.id, password: r.body.admin.password } });
      return { slug, headers: { ...bearer(l.body.token), ...native } };
    };
    const a = await mk('shop-a'), b = await mk('shop-b');
    const up = async who => (await call(backend, `/${who.slug}/api/admin/media`, { method: 'POST', headers: who.headers, body: { data: png(9) } })).body.url;
    const url = await up(a); await up(b);
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM media WHERE body IS NOT NULL"))[0].n, 1, 'the bytes are stored once');
    const id = idOf(url);
    assert.equal((await call(backend, `/shop-a/api/admin/library/${id}`, { method: 'DELETE', headers: a.headers })).status, 200);
    const res = await call(backend, `/shop-b${url}`);
    assert.equal(res.status, 200, 'the other store still serves the bytes');
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM media WHERE body IS NOT NULL"))[0].n, 1, 'handed over to the remaining row');
    assert.equal((await call(backend, `/shop-b/api/admin/library/${id}`, { method: 'DELETE', headers: b.headers })).status, 200);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM media'))[0].n, 0);
  } finally { backend.server.emit('close'); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('library: pictures a store shows from an external address are listed as read-only "linked" entries', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    await s.upload(a, 1);
    // `remote: 'report'` style writes keep an external URL; patch it straight into a content document the way starter content has it.
    await s.db.query("INSERT INTO content_docs(tenant_id,name,data,updated_at) VALUES($1,'extra',$2,$3) ON CONFLICT (tenant_id,name) DO UPDATE SET data=EXCLUDED.data", [a.tenant.id, JSON.stringify({ cover: 'https://images.example.com/hero.jpg', clip: { type: 'video', uri: 'https://videos.example.com/a.mp4' } }), Date.now()]);
    const all = await s.lib(a);
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.equal(own(all.body).length, 1, 'one stored file');
    const linked = (await s.lib(a, '?q=example.com')).body.items;
    assert.deepEqual(linked.map(i => i.kind).sort(), ['image', 'video'], 'the two addresses (searched by address)');
    assert.ok(linked.every(i => i.linked && i.used && i.storage === 'external'));
    assert.ok(all.body.total > 3, 'the starter content\'s pictures are listed as well');
    assert.equal((await s.lib(a, '?kind=video&q=videos.example.com')).body.items.length, 1);
    // They are not files of the store: no detail, no delete.
    assert.equal((await call(s.backend, `/shop-a/api/admin/library/${linked[0].id}`, { method: 'DELETE', headers: a.headers })).status, 404);
  } finally { s.cleanup(); }
});
