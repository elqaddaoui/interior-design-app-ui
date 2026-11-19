/**
 * Platform-wide media (super admin): ONE `media/` folder. The preview + move of everything stored outside it (old `t/<store>/media/...`) into it,
 * the Files grid that lists the pictures of the storage in use, deleting whole files, and the shared hash namespace for stores and demos.
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
    listPage: async (prefix, { after = '', limit = 60 } = {}) => {
      if (r2Failure.on) throw Object.assign(new Error('boom'), { name: 'AccessDenied' });
      const all = [...objects.entries()].filter(([key]) => key.startsWith(prefix) && key > after && /^(?:media|t\/[a-z0-9][a-z0-9_-]*\/media)\/[a-f0-9]{32}\.(png|jpg|webp|gif|avif|svg)$/.test(key)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return { items: all.slice(0, limit).map(([key, v]) => ({ key, size: v.body.length, modified: v.modified || 1 })), more: all.length > limit };
    },
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


const consolidation = async s => { const r = await s.api('/media/consolidation'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const consolidate = async (s, body = {}) => { const r = await s.api('/media/consolidate', { method: 'POST', body }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const bodyOf = (r2, key) => Buffer.from(r2.objects.get(key).body);
const strays = r2 => [...r2.objects.keys()].filter(key => key.startsWith('t/'));
const browse = async (s, query = '') => { const r = await s.api(`/media/browse${query}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

test('one folder: the preview lists every file outside media/ with where it goes and changes nothing; a clean platform has nothing to move', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const one = await s.upload(a, 41), two = await s.upload(b, 42);
    let preview = await consolidation(s);
    assert.equal(preview.totals.files, 0);
    assert.equal(preview.clean, true, JSON.stringify(preview));
    assert.equal(preview.storages.r2.media.files, 2);
    assert.equal(preview.rows.missing, 0);
    const id1 = await legacyize(s, a.tenant.id, one), id2 = await legacyize(s, b.tenant.id, two);
    const before = new Map(s.r2.objects);
    preview = await consolidation(s);
    assert.equal(preview.clean, false);
    assert.equal(preview.totals.files, 2);
    assert.equal(preview.totals.move, 2);
    assert.equal(preview.folders.length, 2, 'grouped by old folder');
    assert.deepEqual(preview.folders.map(f => f.path).sort(), [`t/${a.tenant.id}/media/`, `t/${b.tenant.id}/media/`].sort());
    assert.equal(preview.folders.find(f => f.path === `t/${a.tenant.id}/media/`).store, 'Shop shop-a');
    const line = preview.files.find(f => f.from === `t/${a.tenant.id}/media/${id1}.png`);
    assert.deepEqual([line.to, line.action, line.storage], [`media/${id1}.png`, 'move', 'r2']);
    assert.equal(preview.rows.missing, 0, 'rows still point at their old folder, where the objects are');
    assert.deepEqual([...s.r2.objects.keys()].sort(), [...before.keys()].sort(), 'previewing writes and deletes nothing');
    void id2;
    assert.equal((await call(s.backend, '/api/super-admin/media/consolidation')).status, 401);
    assert.equal((await call(s.backend, '/shop-a/api/super-admin/media/consolidation', { headers: a.headers })).status, 404);
  } finally { s.cleanup(); }
});

test('one folder: consolidating copies, verifies, repoints the rows and every picture keeps loading; the old copies wait, then go with their folders', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pics = [await s.upload(a, 51), await s.upload(a, 52), await s.upload(b, 53)];
    const same = await s.upload(b, 51); // the same bytes as a's first picture: one object, two rows
    assert.equal(same, pics[0]);
    const ids = [];
    for (const [i, pic] of pics.entries()) ids.push(await legacyize(s, i < 2 ? a.tenant.id : b.tenant.id, pic));
    // a's first picture is used by b too: b's row must follow (it pointed at the same old object through a)
    assert.equal(strays(s.r2).length, 3);
    const done = await consolidate(s);
    assert.equal(done.moved, 3, JSON.stringify(done));
    assert.equal(done.failed + done.conflicts + done.remaining, 0);
    for (const id of ids) {
      assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'now in media/');
      for (const row of await rowsOfId(s, id)) assert.equal(row.ns, 1, 'every row points at media/');
    }
    for (const pic of pics) {
      const r = await call(s.backend, `/shop-a${pic}`);
      const rb = await call(s.backend, `/shop-b${pic}`);
      assert.equal(r.status === 302 || rb.status === 302, true);
      if (r.status === 302) assert.ok(r.headers.location.endsWith(`/media/${pic.split('/').pop()}`) && !r.headers.location.includes('/t/'));
    }
    // The old objects are still there (24 h safety net): consolidating never deletes anything.
    assert.equal(strays(s.r2).length, 3, 'nothing deleted yet');
    const again = await consolidate(s);
    assert.equal(again.moved, 0, 'idempotent: the second run copies nothing');
    assert.equal(again.waiting, 3);
    assert.equal(again.failed, 0);
    const kept = await consolidation(s);
    assert.equal(kept.totals.files, 3, 'the preview still shows the old copies until they are removed');
    assert.equal(kept.totals.merge, 3, 'and says they are already in media/');
    assert.equal(kept.rows.missing, 0);
    // "Remove old copies now": each one is verified against media/ first, then removed; the old folders vanish.
    const cleaned = await s.api('/media/cleanup', { method: 'POST', body: { now: true } });
    assert.equal(cleaned.body.removed, 3, JSON.stringify(cleaned.body));
    assert.equal(strays(s.r2).length, 0, 'no t/ object is left: the old directory is gone');
    assert.deepEqual([...s.r2.objects.keys()].filter(k => !k.startsWith('media/')), []);
    assert.equal(r2Keys(s.r2).length, 3);
    const final = await consolidation(s);
    assert.equal(final.clean, true, JSON.stringify(final));
    assert.equal((await call(s.backend, `/shop-b${pics[2]}`)).status, 302);
    assert.ok((await s.api('/audit?limit=20')).body.some(e => e.action === 'media.consolidate'));
  } finally { s.cleanup(); }
});

test('one folder: the old copy is never deleted unless media/ holds exactly its bytes; a different file at the target name is a conflict that nothing touches', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 61), other = await s.upload(a, 62);
    const id = await legacyize(s, a.tenant.id, pic), id2 = await legacyize(s, a.tenant.id, other);
    const own = `t/${a.tenant.id}/media/${id}.png`;
    // same size, other bytes already sitting at media/<name>
    s.r2.objects.set(`media/${id}.png`, { body: Buffer.alloc(bodyOf(s.r2, own).length, 9), mime: 'image/png' });
    const preview = await consolidation(s);
    assert.equal(preview.files.find(f => f.from === own).action, 'merge', 'same size looks identical in a listing...');
    const done = await consolidate(s);
    assert.equal(done.conflicts, 1, '...but the bytes are compared, and they differ');
    assert.equal(done.moved, 1, 'the other file is moved normally');
    assert.equal(s.r2.objects.has(own), true, 'the real file is untouched');
    assert.deepEqual([...bodyOf(s.r2, `media/${id}.png`)], [...Buffer.alloc(bodyOf(s.r2, own).length, 9)], 'and the impostor was not overwritten');
    assert.equal((await rowsOfId(s, id))[0].ns, 0, 'the row stays where its file is');
    assert.equal((await call(s.backend, `/shop-a${pic}`)).status, 302);
    assert.ok((await call(s.backend, `/shop-a${pic}`)).headers.location.includes(`/t/${a.tenant.id}/media/`), 'it keeps serving the real file');
    // Cleanup after the other one: only the verified copy goes.
    const cleaned = await s.api('/media/cleanup', { method: 'POST', body: { now: true } });
    assert.equal(cleaned.body.removed, 1);
    assert.equal(s.r2.objects.has(own), true);
    assert.equal(s.r2.objects.has(`t/${a.tenant.id}/media/${id2}.png`), false);
    // The copy at media/ gets corrupted after the move: its old copy is not removed.
    const third = await s.upload(a, 63);
    const id3 = await legacyize(s, a.tenant.id, third);
    await consolidate(s);
    const original = bodyOf(s.r2, `t/${a.tenant.id}/media/${id3}.png`);
    s.r2.objects.set(`media/${id3}.png`, { body: Buffer.alloc(original.length, 3), mime: 'image/png' });
    assert.equal((await s.api('/media/cleanup', { method: 'POST', body: { now: true } })).body.removed, 0);
    assert.equal(s.r2.objects.has(`t/${a.tenant.id}/media/${id3}.png`), true);
  } finally { s.cleanup(); }
});

test('one folder: a storage that cannot be read, or looks empty, is never concluded about; the app-folder move works and removes the empty directories', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pics = [];
    for (let i = 0; i < 6; i++) pics.push(await s.upload(a, 70 + i));
    for (const pic of pics) await legacyize(s, a.tenant.id, pic);
    r2Failure.on = true;
    const blind = await consolidation(s);
    assert.equal(blind.storages.r2.checked, false);
    assert.equal(blind.totals.files, 0, 'unreadable is not "nothing to move" either');
    assert.equal(blind.clean, false, 'and it is never reported as finished');
    const none = await consolidate(s);
    assert.deepEqual(none.unreadable, ['r2']);
    assert.equal(none.moved, 0);
    r2Failure.on = false;
    assert.equal(strays(s.r2).length, 6);
    // An empty-looking bucket (wrong bucket) is not trusted: the rows would all look "missing".
    const saved = new Map(s.r2.objects);
    s.r2.objects.clear();
    const empty = await consolidation(s);
    assert.equal(empty.storages.r2.checked, false);
    assert.equal(empty.storages.r2.error, 'LOOKS_EMPTY');
    assert.equal(empty.rows.missing, 0, 'no verdict about rows of an unreadable storage');
    for (const [k, v] of saved) s.r2.objects.set(k, v);
    // The app folder: the same move, with real directories.
    const dir = s.dir, one = await s.upload(a, 90);
    const id = idOf(one);
    const fsStore = require('../server/media').createFsStorage({ MEDIA_DIR: dir });
    await fsStore.put(`t/${a.tenant.id}/media/${id}.png`, bodyOf(s.r2, `media/${id}.png`));
    await s.db.query("UPDATE media SET storage='fs', ns=0 WHERE tenant_id=$1 AND id=$2", [a.tenant.id, id]);
    s.r2.objects.delete(`media/${id}.png`);
    const fsPreview = await consolidation(s);
    assert.equal(fsPreview.storages.fs.outside, 1, JSON.stringify(fsPreview.storages));
    const moved = await consolidate(s);
    assert.equal(moved.moved >= 1, true);
    assert.ok(fs.existsSync(path.join(dir, 'media', `${id}.png`)));
    assert.equal((await call(s.backend, `/shop-a${one}`)).status, 200, 'served from media/ in the folder');
    await s.api('/media/cleanup', { method: 'POST', body: { now: true } });
    assert.equal(fs.existsSync(path.join(dir, 't')), false, 'the old directories are gone with their last file');
  } finally { s.cleanup(); }
});

test('one folder: new files, copies for demos and the migration helper all land in media/ and never create another folder', async () => {
  const s = await setup();
  try {
    const demoMade = await s.api('/demos', { method: 'POST', body: { name: 'Fresh demo' } });
    const demo = demoMade.body.demo;
    const demoStore = { slug: demo.slug, tenant: { id: demo.tenantId }, headers: await s.login(demo.slug, demoMade.body.admin.id, demoMade.body.admin.password) };
    await s.upload(demoStore, 81);
    const a = await s.store('shop-a');
    await s.upload(a, 82);
    const clone = await s.api(`/demos/${demo.id}/assign`, { method: 'POST', body: { slug: 'clone-x', owner: { email: 'x@x.test' } } });
    assert.equal(clone.status, 201, JSON.stringify(clone.body));
    assert.deepEqual([...s.r2.objects.keys()].filter(k => !k.startsWith('media/')), [], 'nothing outside media/');
    // A legacy database row moved to R2 by the migration helper goes to media/ too (and joins the shared namespace).
    const { createMedia } = require('../server/media');
    const { scopeDb } = require('../server/scope');
    const body = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 99)]);
    const id = require('node:crypto').createHash('sha256').update(body.toString('base64')).digest('hex').slice(0, 32);
    await s.db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns) VALUES($1,$2,'image/png','',$3,$4,'db',1,0)", [a.tenant.id, id, body, body.length]);
    const m = createMedia(scopeDb(s.db, a.tenant.id), { env: {}, storage: s.r2, download: offline });
    assert.equal(await m.moveRowToR2({ id, mime: 'image/png', body, data: '' }), true);
    assert.equal(s.r2.objects.has(`media/${id}.png`), true);
    assert.equal(strays(s.r2).length, 0);
    assert.equal((await rowsOfId(s, id))[0].ns, 1);
    assert.equal((await consolidation(s)).clean, true);
  } finally { s.cleanup(); }
});

test('files grid: lists the pictures of the storage in use straight from the storage, with paging, previews and what the database knows', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const urls = [];
    for (let i = 0; i < 5; i++) urls.push(await s.upload(i % 2 ? b : a, 100 + i));
    await call(s.backend, '/shop-a/api/admin/media', { method: 'POST', headers: a.headers, body: { data: png(100), title: 'Hero picture' } }); // same bytes as the first: titled
    const orphan = 'media/' + 'e'.repeat(32) + '.png';
    s.r2.objects.set(orphan, { body: Buffer.alloc(30, 5), mime: 'image/png', modified: 1 });
    s.r2.objects.set('media/not-ours.txt', { body: Buffer.alloc(5), mime: 'text/plain' });
    s.r2.objects.set('other-app/logo.png', { body: Buffer.alloc(5), mime: 'image/png' });
    s.r2.objects.set('media/' + 'f'.repeat(32) + '.mp4', { body: Buffer.alloc(9), mime: 'video/mp4' });
    const first = await browse(s, '?limit=4');
    assert.equal(first.storage, 'r2');
    assert.equal(first.items.length, 4);
    assert.equal(first.more, true);
    const second = await browse(s, `?limit=4&after=${encodeURIComponent(first.cursor)}`);
    assert.equal(second.items.length, 2);
    assert.equal(second.more, false);
    const all = [...first.items, ...second.items];
    assert.equal(new Set(all.map(i => i.key)).size, 6, 'no repeats, nothing skipped');
    assert.ok(all.every(i => /^media\/[a-f0-9]{32}\.png$/.test(i.key)), 'only pictures of ours: no video, no other file, nothing outside the folder');
    assert.ok(all.every(i => i.url.startsWith('https://media.example.com/media/')), 'previews are the public R2 address');
    const titled = all.find(i => i.id === idOf(urls[0]));
    assert.equal(titled.title, 'Hero picture');
    assert.equal(titled.inDatabase, true);
    assert.equal(all.find(i => i.key === orphan).inDatabase, false, 'a file the database does not know is still shown, and marked');
    assert.equal(all.find(i => i.key === orphan).stray, false);
    assert.equal((await s.api('/media/browse?after=../../etc')).status, 400);
    assert.equal((await call(s.backend, '/api/super-admin/media/browse')).status, 401);
    // Old folders follow media/ in the same grid, marked.
    await legacyize(s, a.tenant.id, urls[2]);
    const withOld = await browse(s, '?limit=50');
    assert.equal(withOld.items.filter(i => i.stray).length, 1);
    assert.equal(withOld.items.filter(i => i.stray)[0].folder, `t/${a.tenant.id}/media/`);
    assert.equal(withOld.items.indexOf(withOld.items.find(i => i.stray)), withOld.items.length - 1, 'after everything in media/');
    // A storage that cannot be listed is an error, never an empty grid.
    r2Failure.on = true;
    assert.equal((await s.api('/media/browse')).status === 200, false);
    r2Failure.on = false;
  } finally { s.cleanup(); }
});

test('files grid: the app folder is browsed the same way, and its previews are served by the console only', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const url = await s.upload(a, 111), id = idOf(url);
    assert.equal((await s.api('/media/storage', { method: 'PUT', body: { storage: 'app' } })).status, 200);
    const fsStore = require('../server/media').createFsStorage({ MEDIA_DIR: s.dir });
    await fsStore.put(`media/${id}.png`, bodyOf(s.r2, `media/${id}.png`));
    await s.db.query("UPDATE media SET storage='fs' WHERE id=$1", [id]);
    const grid = await browse(s);
    assert.equal(grid.storage, 'app');
    assert.equal(grid.items.length, 1);
    assert.equal(grid.items[0].url, `/api/super-admin/media/object?key=${encodeURIComponent(`media/${id}.png`)}`);
    const img = await s.api(`/media/object?key=${encodeURIComponent(`media/${id}.png`)}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal((await call(s.backend, `/api/super-admin/media/object?key=${encodeURIComponent(`media/${id}.png`)}`)).status, 401);
    assert.equal((await s.api(`/media/object?key=${encodeURIComponent('../../etc/passwd')}`)).status, 404);
    assert.equal((await s.api(`/media/object?key=${encodeURIComponent(`media/${'a'.repeat(32)}.png`)}`)).status, 404);
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
    assert.equal((await consolidation(s)).rows.missing, 0);
  } finally { s.cleanup(); }
});

