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
    scanPage: async ({ after = '', limit = 60, types = null } = {}) => {
      if (r2Failure.on) throw Object.assign(new Error('boom'), { name: 'AccessDenied' });
      const typeOf = k => { const e = k.slice(k.lastIndexOf('.') + 1); return /^(png|jpg|webp|gif|avif|svg)$/.test(e) ? 'image' : /^(mp4|webm|mov)$/.test(e) ? 'video' : /^(mp3|weba|m4a|wav)$/.test(e) ? 'audio' : 'other'; };
      const all = [...objects.entries()].filter(([key]) => key > after && (!types || types.includes(typeOf(key)))).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const items = all.slice(0, limit).map(([key, v]) => ({ key, size: v.body.length, modified: v.modified || 1 }));
      return { items, more: all.length > limit, cursor: items.length ? items[items.length - 1].key : after };
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

const filesOf = async (s, query = '') => { const r = await s.api(`/media/files${query}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const pageAll = async (s, query) => { let all = [], after = ''; for (let i = 0; i < 20; i++) { const page = await filesOf(s, `${query}&limit=3${after ? `&after=${encodeURIComponent(after)}` : ''}`); all = all.concat(page.items); if (!page.more) break; after = page.cursor; } return all; };

test('files manager: by type it shows EVERY hosted file whatever its path (not only media/ and not only pictures); nothing is listed until asked', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const urls = [];
    for (let i = 0; i < 3; i++) urls.push(await s.upload(a, 100 + i));
    // Things the owner put there by hand, outside media/, and things that are not pictures.
    s.r2.objects.set('my-uploads/logo.png', { body: Buffer.alloc(11, 1), mime: 'image/png' });
    s.r2.objects.set('themes/ocean/hero.webp', { body: Buffer.alloc(12, 1), mime: 'image/webp' });
    s.r2.objects.set('demo/intro.mp4', { body: Buffer.alloc(13, 1), mime: 'video/mp4' });
    s.r2.objects.set('store/voice.mp3', { body: Buffer.alloc(14, 1), mime: 'audio/mpeg' });
    s.r2.objects.set('docs/readme.txt', { body: Buffer.alloc(15, 1), mime: 'text/plain' });
    const summary = (await s.api('/media/summary')).body;
    assert.equal(summary.storage, 'r2');
    assert.equal(summary.complete, true);
    assert.deepEqual([summary.types.image.files, summary.types.video.files, summary.types.audio.files, summary.types.other.files], [5, 1, 1, 1]);
    assert.equal(summary.types.image.inMedia, 3);
    assert.equal(summary.types.image.outside, 2, 'files I uploaded by hand are counted, and marked as outside media/');
    const images = await pageAll(s, '?view=type&type=image');
    assert.equal(images.length, 5);
    assert.ok(images.some(i => i.key === 'my-uploads/logo.png' && !i.inMedia && i.folder === 'my-uploads/'));
    assert.ok(images.every(i => i.type === 'image'));
    assert.equal((await pageAll(s, '?view=type&type=video')).map(i => i.key).join(), 'demo/intro.mp4');
    assert.equal((await pageAll(s, '?view=type&type=other')).map(i => i.key).join(), 'docs/readme.txt');
    const all = await pageAll(s, '?view=type&type=all');
    assert.equal(all.length, 8);
    assert.equal(new Set(all.map(i => i.key)).size, 8, 'no repeats, nothing skipped');
    assert.ok(all.every(i => i.url.startsWith('https://media.example.com/')), 'a preview is only an address: the console loads it when asked');
    const known = all.find(i => i.id === idOf(urls[0]));
    assert.equal(known.inDatabase, true);
    assert.equal(known.stores[0], 'Shop shop-a');
    assert.equal((await s.api('/media/files?after=%00bad')).status, 400);
    assert.equal((await s.api('/media/files?type=nope')).status, 400);
    assert.equal((await call(s.backend, '/api/super-admin/media/files')).status, 401);
    assert.equal((await call(s.backend, '/api/super-admin/media/summary')).status, 401);
    // The old route that listed pictures at once is gone.
    assert.equal((await s.api('/media/browse')).status, 404);
    // A storage that cannot be listed is an error, never an empty list.
    r2Failure.on = true;
    assert.equal((await s.api('/media/files?view=type')).status === 200, false);
    r2Failure.on = false;
  } finally { s.cleanup(); }
});

test('files manager: by owner it groups stores, demos, themes and "other", and lists what one owner holds', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const demoMade = await s.api('/demos', { method: 'POST', body: { name: 'Fresh demo' } });
    const demo = demoMade.body.demo;
    const demoStore = { slug: demo.slug, tenant: { id: demo.tenantId }, headers: await s.login(demo.slug, demoMade.body.admin.id, demoMade.body.admin.password) };
    const one = await s.upload(a, 121), two = await s.upload(demoStore, 122);
    await s.upload(a, 123);
    // A row whose owner does not exist any more.
    const ghost = 'f'.repeat(32);
    await s.db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns) VALUES('t_gone',$1,'image/png','',NULL,9,'r2',1,1)", [ghost]);
    await s.db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns,lib) VALUES($1,$2,'video/mp4','',NULL,9,'r2',1,1,0)", [a.tenant.id, 'a'.repeat(32)]);
    const ownersRes = await s.api('/media/owners');
    assert.equal(ownersRes.status, 200, JSON.stringify(ownersRes.body));
    const owners = ownersRes.body;
    assert.equal(owners.groups.store.find(o => o.id === a.tenant.id).files, 3);
    assert.equal(owners.groups.demo.find(o => o.id === demo.tenantId).files, 1);
    assert.equal(owners.groups.other[0].files, 1, 'files of a store that is gone are not lost from view');
    assert.equal(owners.types.image >= 3, true);
    const mine = await filesOf(s, `?view=owner&owner=${a.tenant.id}&type=image`);
    assert.equal(mine.items.length, 2, 'two pictures (the third file of this store is a video)');
    assert.ok(mine.items.every(i => i.type === 'image' && i.inMedia));
    assert.equal((await filesOf(s, `?view=owner&owner=${a.tenant.id}&type=video`)).items.length, 1);
    assert.equal((await filesOf(s, `?view=owner&owner=${demo.tenantId}`)).items[0].id, idOf(two));
    assert.equal((await filesOf(s, '?view=owner&owner=other')).items[0].id, ghost);
    assert.equal((await s.api('/media/files?view=owner')).status, 400, 'an owner must be chosen');
    // paging
    const first = await filesOf(s, `?view=owner&owner=${a.tenant.id}&limit=2`);
    assert.equal(first.more, true);
    const rest = await filesOf(s, `?view=owner&owner=${a.tenant.id}&limit=2&after=${encodeURIComponent(first.cursor)}`);
    assert.equal(first.items.length + rest.items.length, 3);
    assert.equal(new Set([...first.items, ...rest.items].map(i => i.key)).size, 3);
    void one;
  } finally { s.cleanup(); }
});

test('files manager: the app folder is browsed the same way (any path), previews are served by the console only, and cannot leave the media folder', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const url = await s.upload(a, 111), id = idOf(url);
    assert.equal((await s.api('/media/storage', { method: 'PUT', body: { storage: 'app' } })).status, 200);
    const fsStore = require('../server/media').createFsStorage({ MEDIA_DIR: s.dir });
    await fsStore.put(`media/${id}.png`, bodyOf(s.r2, `media/${id}.png`));
    await s.db.query("UPDATE media SET storage='fs' WHERE id=$1", [id]);
    fs.mkdirSync(path.join(s.dir, 'by-hand', 'deep'), { recursive: true });
    fs.writeFileSync(path.join(s.dir, 'by-hand', 'deep', 'pic.jpg'), Buffer.alloc(7, 2));
    fs.writeFileSync(path.join(s.dir, 'notes.txt'), 'hi');
    const grid = await filesOf(s, '?view=type&type=image');
    assert.equal(grid.storage, 'app');
    assert.deepEqual(grid.items.map(i => i.key).sort(), [`by-hand/deep/pic.jpg`, `media/${id}.png`].sort());
    assert.equal(grid.items.find(i => i.key === `media/${id}.png`).url, `/api/super-admin/media/object?storage=app&key=${encodeURIComponent(`media/${id}.png`)}`);
    assert.equal((await filesOf(s, '?view=type&type=other')).items[0].key, 'notes.txt');
    const img = await s.api(`/media/object?storage=app&key=${encodeURIComponent('by-hand/deep/pic.jpg')}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/jpeg');
    assert.equal((await call(s.backend, `/api/super-admin/media/object?storage=app&key=${encodeURIComponent(`media/${id}.png`)}`)).status, 401);
    for (const bad of ['../../etc/passwd', '/etc/passwd', 'media/../../x.png', 'a//b.png', 'media/' + 'a'.repeat(32) + '.png']) {
      assert.equal((await s.api(`/media/object?storage=app&key=${encodeURIComponent(bad)}`)).status, 404, bad);
    }
    const summary = (await s.api('/media/summary')).body;
    assert.equal(summary.storage, 'app');
    assert.equal(summary.types.image.files, 2);
    assert.equal(summary.types.image.outside, 1);
  } finally { s.cleanup(); }
});

const history = async s => { const r = await s.api('/media/history'); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

test('transfer history: a restore point is saved BEFORE a consolidation moves anything, and restoring puts every file back (verified), then the move can be redone', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a'), b = await s.store('shop-b');
    const pics = [await s.upload(a, 131), await s.upload(a, 132), await s.upload(b, 133)];
    const ids = [];
    for (const [i, pic] of pics.entries()) ids.push(await legacyize(s, i < 2 ? a.tenant.id : b.tenant.id, pic));
    assert.deepEqual(await history(s), [], 'nothing recorded yet');
    // Previewing records nothing.
    await consolidation(s);
    assert.deepEqual(await history(s), []);
    const done = await consolidate(s);
    assert.equal(done.moved, 3);
    assert.match(done.history, /^mh_[a-f0-9]{12}$/);
    let list = await history(s);
    assert.equal(list.length, 1);
    const point = list[0];
    assert.equal(point.op, 'consolidate');
    assert.equal(point.files, 3);
    assert.equal(point.restorable, true);
    assert.equal(point.stats.totals.move, 3, 'the stats the preview showed are kept');
    assert.equal(point.changed, 3, 'three files are not where the point says any more');
    assert.equal(point.actor, 'boss@platform.test');
    for (const id of ids) for (const row of await rowsOfId(s, id)) assert.equal(row.ns, 1);
    // Restore: the files are back in their old folders, the rows say so, and every picture still loads.
    const back = await s.api(`/media/history/${point.id}/restore`, { method: 'POST', body: {} });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(back.body.restored, 3, JSON.stringify(back.body));
    assert.equal(back.body.done, true);
    assert.equal(back.body.left, 0);
    assert.equal(back.body.failed + back.body.conflicts, 0);
    for (const [i, id] of ids.entries()) {
      const tenant = i < 2 ? a.tenant.id : b.tenant.id;
      assert.equal(s.r2.objects.has(`t/${tenant}/media/${id}.png`), true, 'back in its old folder');
      assert.equal((await rowsOfId(s, id))[0].ns, 0);
    }
    for (const pic of pics) assert.equal((await call(s.backend, `/shop-a${pic}`)).status === 302 || (await call(s.backend, `/shop-b${pic}`)).status === 302, true);
    assert.equal((await consolidation(s)).rows.missing, 0);
    list = await history(s);
    assert.equal(list.find(e => e.id === point.id).restoredAt != null, true);
    assert.equal(list.length, 2, 'the restore itself saved a point (so it can be undone)');
    assert.equal(list[0].op, 'restore');
    assert.ok((await s.api('/audit?limit=20')).body.some(e => e.action === 'media.restore'));
    // Idempotent, and the move can be done again.
    assert.equal((await s.api(`/media/history/${point.id}/restore`, { method: 'POST', body: {} })).body.restored, 0);
    const again = await consolidate(s);
    assert.equal(again.moved + again.merged, 3);
    assert.equal((await s.api('/media/history/mh_000000000000/restore', { method: 'POST', body: {} })).status, 404);
    assert.equal((await s.api('/media/history/nope/restore', { method: 'POST', body: {} })).status, 404);
    assert.equal((await call(s.backend, '/api/super-admin/media/history')).status, 401);
  } finally { s.cleanup(); }
});

test('transfer history: restoring never overwrites a different file, never deletes, and a consolidation with nothing to do saves no point', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pic = await s.upload(a, 141);
    const id = await legacyize(s, a.tenant.id, pic);
    const old = `t/${a.tenant.id}/media/${id}.png`;
    await consolidate(s);
    const point = (await history(s))[0];
    // After the move the old folder is cleaned, then a DIFFERENT file appears at the old place: the restore leaves it alone.
    await s.api('/media/cleanup', { method: 'POST', body: { now: true } });
    assert.equal(s.r2.objects.has(old), false);
    s.r2.objects.set(old, { body: Buffer.alloc(40, 7), mime: 'image/png' });
    const back = await s.api(`/media/history/${point.id}/restore`, { method: 'POST', body: {} });
    assert.equal(back.body.conflicts, 1, JSON.stringify(back.body));
    assert.equal(back.body.restored, 0);
    assert.deepEqual([...s.r2.objects.get(old).body], [...Buffer.alloc(40, 7)], 'the other file is untouched');
    assert.equal(s.r2.objects.has(`media/${id}.png`), true, 'and the file in media/ is not deleted');
    assert.equal((await rowsOfId(s, id))[0].ns, 1);
    assert.equal((await call(s.backend, `/shop-a${pic}`)).status, 302);
    // Nothing to move: no restore point.
    s.r2.objects.delete(old);
    const before = (await history(s)).length;
    const none = await consolidate(s);
    assert.equal(none.history, '');
    assert.equal((await history(s)).length, before);
    // A cleanup that removes nothing is not logged; one that removes something is, and is not restorable.
    const noop = await s.api('/media/cleanup', { method: 'POST', body: { now: true } });
    assert.equal(noop.body.removed, 0);
    assert.equal((await history(s)).length, before);
  } finally { s.cleanup(); }
});

test('one folder: files whose bytes sit in the database go to media/ too; a restore brings the bytes back; nothing is cleared unless media/ holds the same bytes', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const bodyOfSeed = seed => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, seed)]);
    const rows = [];
    for (const seed of [151, 152]) {
      const body = bodyOfSeed(seed);
      const id = require('node:crypto').createHash('sha256').update(body.toString('base64')).digest('hex').slice(0, 32);
      await s.db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns) VALUES($1,$2,'image/png','',$3,$4,'db',1,0)", [a.tenant.id, id, body, body.length]);
      rows.push({ id, body });
    }
    const preview = await consolidation(s);
    assert.equal(preview.database.files, 2);
    assert.equal(preview.database.target, 'r2');
    assert.equal(preview.clean, false, 'bytes kept in the database are "outside media/"');
    assert.ok(preview.files.some(f => f.storage === 'db' && f.to === `media/${rows[0].id}.png`));
    assert.equal(r2Keys(s.r2).length, 0, 'previewing writes nothing');
    const done = await consolidate(s);
    assert.equal(done.dbMoved, 2, JSON.stringify(done));
    assert.equal(done.dbFailed, 0);
    for (const { id, body } of rows) {
      assert.deepEqual([...bodyOf(s.r2, `media/${id}.png`)], [...body], 'same bytes in media/');
      const row = (await rowsOfId(s, id))[0];
      assert.deepEqual([row.storage, row.ns], ['r2', 1]);
    }
    assert.equal((await call(s.backend, `/shop-a/api/media/${rows[0].id}.png`)).status, 302);
    assert.equal((await consolidation(s)).clean, true);
    const point = (await history(s))[0];
    assert.equal(point.files, 2);
    // The bytes still sit in the row: cleanup clears them only when media/ holds exactly them. Corrupt one copy.
    s.r2.objects.set(`media/${rows[1].id}.png`, { body: Buffer.alloc(rows[1].body.length, 1), mime: 'image/png' });
    const cleaned = await s.api('/media/cleanup', { method: 'POST', body: { now: true } });
    assert.equal(cleaned.body.removed, 1, JSON.stringify(cleaned.body));
    const left = await s.db.query('SELECT id,body FROM media WHERE tenant_id=$1 ORDER BY id', [a.tenant.id]);
    assert.equal(left.filter(r => r.body && r.body.length).length, 1, 'the unverified one keeps its bytes');
    assert.equal(left.find(r => r.id === rows[1].id).body.length > 0, true);
    // Restore: the file goes back to the database (bytes verified), and media/ keeps its copy for the cleanup to decide.
    const back = await s.api(`/media/history/${point.id}/restore`, { method: 'POST', body: {} });
    assert.equal(back.body.failed, 0, JSON.stringify(back.body));
    const restored = (await rowsOfId(s, rows[0].id))[0];
    assert.deepEqual([restored.storage, restored.ns], ['db', 0]);
    const served = await call(s.backend, `/shop-a/api/media/${rows[0].id}.png`);
    assert.equal(served.status, 200);
    const restoredBodies = await s.db.query('SELECT id,body FROM media WHERE tenant_id=$1', [a.tenant.id]);
    for (const { id, body } of rows) assert.deepEqual(Buffer.from(restoredBodies.find(row => row.id === id).body), body, 'restore keeps original bytes, including the retained DB copy');
  } finally { s.cleanup(); }
});

test('one folder: mixed R2 and Hostinger-style disk consolidation preserves untracked files and restores both layouts after cleanup', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const r2Id = await legacyize(s, a.tenant.id, await s.upload(a, 170));
    const fsId = idOf(await s.upload(a, 171));
    const disk = createFsStorage({ MEDIA_DIR: s.dir });
    const legacy = id => `t/${a.tenant.id}/media/${id}.png`;
    const shared = id => `media/${id}.png`;
    const originals = [bodyOf(s.r2, legacy(r2Id)), bodyOf(s.r2, shared(fsId))];
    await disk.put(legacy(fsId), originals[1]);
    await s.r2.remove(shared(fsId));
    await s.db.query("UPDATE media SET storage='fs', ns=0 WHERE id=$1", [fsId]);
    // Even an app-shaped path (or an id used on the OTHER backend) is not proof of ownership.
    await disk.put(legacy(r2Id), Buffer.from('manual disk file'));
    await s.r2.put(legacy(fsId), Buffer.from('manual R2 file'), 'image/png');
    assert.equal((await consolidation(s)).totals.files, 2);
    const done = await consolidate(s);
    assert.equal(done.moved, 2);
    assert.equal(done.conflicts + done.failed + done.remaining, 0);
    assert.deepEqual(bodyOf(s.r2, shared(r2Id)), originals[0]);
    assert.deepEqual(await disk.get(shared(fsId)), originals[1]);
    const point = (await history(s)).find(item => item.id === done.history);
    assert.equal(point.stats.folders.length, 2);
    assert.equal((await s.api('/media/cleanup', { method: 'POST', body: { now: true } })).body.removed, 2);
    assert.equal(await s.r2.head(legacy(r2Id)), null);
    assert.equal(await disk.head(legacy(fsId)), null);
    assert.deepEqual(await disk.get(legacy(r2Id)), Buffer.from('manual disk file'));
    assert.deepEqual(await s.r2.get(legacy(fsId)), Buffer.from('manual R2 file'));
    for (const [storage, movedId, manualId] of [['r2', r2Id, fsId], ['app', fsId, r2Id]]) {
      const summary = await s.api(`/media/summary?storage=${storage}`);
      assert.equal(summary.status, 200);
      assert.equal(summary.body.storage, storage);
      assert.deepEqual([summary.body.types.image.inMedia, summary.body.types.image.outside], [1, 1]);
      const files = await s.api(`/media/files?view=type&type=image&storage=${storage}`);
      assert.equal(files.status, 200);
      assert.deepEqual(files.body.items.map(item => item.key).sort(), [shared(movedId), legacy(manualId)].sort());
      assert.equal(files.body.items.find(item => item.key === shared(movedId)).inDatabase, true);
      const manual = files.body.items.find(item => item.key === legacy(manualId));
      assert.equal(manual.inDatabase, false, 'a matching basename does not give a manual file app ownership');
      assert.equal(manual.stray, false);
    }
    assert.equal(await s.r2.head(shared(fsId)), null);
    assert.equal(await disk.head(shared(r2Id)), null);
    assert.equal((await consolidation(s)).clean, true);
    const back = await s.api(`/media/history/${point.id}/restore`, { method: 'POST', body: {} });
    assert.equal(back.body.restored, 2, JSON.stringify(back.body));
    assert.equal(back.body.left, 0);
    assert.deepEqual(await s.r2.get(legacy(r2Id)), originals[0]);
    assert.deepEqual(await disk.get(legacy(fsId)), originals[1]);
  } finally { s.cleanup(); }
});

test('database transfer never overwrites a different same-size object on either configured backend', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const bytes = Buffer.from(png(172).split(',')[1], 'base64');
    const id = require('node:crypto').createHash('sha256').update(bytes.toString('base64')).digest('hex').slice(0, 32);
    const key = `media/${id}.png`;
    const different = Buffer.alloc(bytes.length, 17);
    const disk = createFsStorage({ MEDIA_DIR: s.dir });
    await s.db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns) VALUES($1,$2,'image/png','',$3,$4,'db',1,0)", [a.tenant.id, id, bytes, bytes.length]);
    await s.r2.put(key, different, 'image/png');
    await disk.put(key, different);
    for (const [storage, adapter] of [['r2', s.r2], ['app', disk]]) {
      const setting = await s.api('/media/storage', { method: 'PUT', body: { storage } });
      assert.equal(setting.status, 200);
      const result = await consolidate(s);
      assert.equal(result.dbMoved, 0);
      assert.equal(result.conflicts, 1);
      assert.deepEqual(await adapter.get(key), different);
      assert.equal((await rowsOfId(s, id))[0].storage, 'db');
      assert.deepEqual(Buffer.from((await s.db.query('SELECT body FROM media WHERE id=$1', [id]))[0].body), bytes);
    }
    // An identical target can be adopted without replacing it.
    await disk.put(key, bytes);
    assert.equal((await consolidate(s)).dbMoved, 1);
    assert.equal((await rowsOfId(s, id))[0].storage, 'fs');
    assert.deepEqual(await disk.get(key), bytes);
  } finally { s.cleanup(); }
});

test('transfer history: "move all media" saves a restore point first; the restore returns every file to the storage it came from', async () => {
  const s = await setup();
  try {
    const a = await s.store('shop-a');
    const pics = [await s.upload(a, 161), await s.upload(a, 162)];
    assert.equal((await s.api('/media/storage', { method: 'PUT', body: { storage: 'app', move: true } })).status, 200);
    const point = (await history(s))[0];
    assert.equal(point.op, 'move');
    assert.equal(point.label, 'app');
    assert.equal(point.files, 2);
    assert.equal(point.stats.todo.files, 2);
    for (let i = 0; i < 10; i++) { const r = await s.api('/media/move/step', { method: 'POST' }); if (r.body.status !== 'running') break; }
    for (const pic of pics) assert.equal((await rowsOfId(s, idOf(pic)))[0].storage, 'fs');
    // A restore is refused while a move runs; once it is over it brings the files back to R2.
    const back = await s.api(`/media/history/${point.id}/restore`, { method: 'POST', body: {} });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(back.body.restored, 2);
    for (const pic of pics) {
      assert.equal((await rowsOfId(s, idOf(pic)))[0].storage, 'r2');
      assert.equal(s.r2.objects.has(`media/${idOf(pic)}.png`), true);
    }
    assert.equal((await call(s.backend, `/shop-a${pics[0]}`)).status, 302);
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

