const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { createR2Storage, r2Status } = require('../server/media');
const { downloadRemote, parseRemoteUrl, isPrivateAddress, safeLookup } = require('../server/remote-media');
const { migrate } = require('./migrate-media-to-r2');
const { freshDb, closeShared } = require('./test-db');

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status, h) { output.status = status; Object.assign(output.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))); this.headersSent = true; }, end(value) { output.raw = value; try { output.body = value ? JSON.parse(value) : undefined; } catch { output.body = undefined; } resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const pngBytes = size => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, 7)]);
const bigPng = 'data:image/png;base64,' + pngBytes(9000).toString('base64');
const smallPng = 'data:image/png;base64,' + pngBytes(16).toString('base64');
const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 3)]);
const mp4Head = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(52)]);
const R2_ENV = { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'bucket', R2_PUBLIC_BASE_URL: 'https://media.example.com/' };
const MEDIA_URL = /^\/api\/media\/[a-f0-9]{32}\.(png|jpg|mp4)$/;

/** In-memory stand-in for the R2 adapter (same interface as createR2Storage). */
function fakeR2() {
  const objects = new Map();
  return {
    objects,
    kind: 'r2',
    publicUrl: key => `https://media.example.com/${key}`,
    put: async (key, body, mime) => { objects.set(key, { body: Buffer.from(body), mime }); },
    head: async key => (objects.has(key) ? { size: objects.get(key).body.length, mime: objects.get(key).mime } : null),
    getRange: async (key, length) => objects.get(key).body.subarray(0, length),
    remove: async key => { objects.delete(key); },
    get: async key => { if (!objects.has(key)) throw new Error('NoSuchKey'); return Buffer.from(objects.get(key).body); },
    presignPut: async (key, mime, size) => `https://acct.r2.cloudflarestorage.com/bucket/${key}?X-Amz-Expires=300&type=${encodeURIComponent(mime)}&size=${size}`,
  };
}
/** Stand-in for the external downloader: a table of URL -> file, everything else fails like a blocked URL. */
function fakeDownload(files, calls = []) {
  return async (url, options) => {
    calls.push(url);
    const file = files[url];
    if (!file) throw Object.assign(new Error('HTTP_404'), { code: 'HTTP_404', policy: true });
    if (file.transient) throw Object.assign(new Error('TIMEOUT'), { code: 'TIMEOUT', policy: false });
    assert.ok(options.maxBytes <= 10 * 1024 * 1024);
    return file;
  };
}
async function setup({ r2 = false, files = {}, env = {} } = {}) {
  const storage = r2 ? fakeR2() : null;
  const calls = [];
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', ...env }, db: await freshDb(), media: { storage, download: fakeDownload(files, calls) } });
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  return { backend, storage, calls, admin: { authorization: `Bearer ${login.body.token}` } };
}
const noBase64 = async db => {
  for (const sql of ['SELECT data FROM content_items', 'SELECT data FROM content_docs', 'SELECT data FROM requests', 'SELECT value AS data FROM space', 'SELECT data FROM media']) {
    for (const row of await db.query(sql)) assert.ok(!String(row.data).includes(';base64,') && !(sql.includes('media') && row.data), `no base64 stored (${sql})`);
  }
};

test('without R2 variables: uploads are stored as raw bytes in the database (no base64) and served from /api/media', async () => {
  const { backend, admin } = await setup();
  try {
    const saved = await call(backend, '/api/admin/content/roomTypes/room_upload', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, image: bigPng, icon: smallPng, order: 99, visible: true } });
    assert.equal(saved.status, 200);
    assert.match(saved.body.image, MEDIA_URL);
    assert.match(saved.body.icon, MEDIA_URL, 'even tiny images leave the JSON: no base64 in the database');
    const content = await call(backend, '/api/content');
    assert.ok(!JSON.stringify(content.body).includes(';base64,'), 'no inline copy in the public JSON');
    const file = await call(backend, saved.body.image);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.match(file.headers['cache-control'], /immutable/);
    assert.equal(Buffer.from(file.raw).toString('base64'), bigPng.split(',')[1]);
    const row = (await backend.db.query('SELECT storage,data,size FROM media'))[0];
    assert.equal(row.storage, 'db');
    assert.equal(row.data, '', 'bytes are in the BYTEA column, not base64 text');
    assert.equal((await call(backend, '/api/media/' + 'f'.repeat(32) + '.png')).status, 404);
    assert.equal((await call(backend, '/api/media/..%2F..%2Fetc%2Fpasswd')).status, 404);
    // Logo uploads (settings documents) too.
    const doc = await call(backend, '/api/admin/doc/branding', { method: 'PATCH', headers: admin, body: { logoUri: bigPng } });
    assert.match(doc.body.logoUri, MEDIA_URL);
    // A file that is not really an image is refused even with an image type.
    const fake = await call(backend, '/api/admin/media', { method: 'POST', headers: admin, body: { data: 'data:image/png;base64,' + Buffer.from('<html>nope</html>').toString('base64') } });
    assert.equal(fake.status, 400);
    // Presigned uploads need R2.
    assert.equal((await call(backend, '/api/admin/media/presign', { method: 'POST', headers: admin, body: { contentType: 'video/mp4', size: 1000 } })).status, 503);
    assert.equal((await call(backend, '/api/health')).body.media, 'database');
    await noBase64(backend.db);
  } finally { backend.server.emit('close'); }
});

test('with R2: every upload goes to R2, /api/media redirects to the public R2 URL, the database keeps metadata only', async () => {
  const { backend, admin, storage } = await setup({ r2: true });
  try {
    const up = await call(backend, '/api/admin/media', { method: 'POST', headers: admin, body: { data: bigPng } });
    assert.equal(up.status, 200);
    assert.match(up.body.url, MEDIA_URL);
    const name = up.body.url.split('/').pop();
    assert.equal(storage.objects.get(`media/${name}`).mime, 'image/png');
    assert.equal(storage.objects.get(`media/${name}`).body.toString('base64'), bigPng.split(',')[1]);
    const row = (await backend.db.query('SELECT storage,data,body FROM media'))[0];
    assert.deepEqual([row.storage, row.data, row.body], ['r2', '', null]);
    const read = await call(backend, up.body.url);
    assert.equal(read.status, 302);
    assert.equal(read.headers.location, `https://media.example.com/media/${name}`);
    // Same bytes again: no second upload.
    await call(backend, '/api/admin/content/styles/st_x', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, image: bigPng, order: 1, visible: true } });
    assert.equal(storage.objects.size, 1);
    assert.equal((await call(backend, '/api/admin/media', { method: 'POST', body: { data: bigPng } })).status, 401, 'uploads are admin-only');
  } finally { backend.server.emit('close'); }
});

test('presigned direct uploads: admin-only, server-chosen key, type and size checked, verified on completion', async () => {
  const { backend, admin, storage } = await setup({ r2: true, env: { MEDIA_MAX_VIDEO_MB: '1' } });
  try {
    const presign = body => call(backend, '/api/admin/media/presign', { method: 'POST', headers: admin, body });
    assert.equal((await call(backend, '/api/admin/media/presign', { method: 'POST', body: { contentType: 'video/mp4', size: 10 } })).status, 401);
    assert.equal((await presign({ contentType: 'application/x-msdownload', size: 10 })).status, 400);
    assert.equal((await presign({ contentType: 'image/svg+xml', size: 10 })).status, 400, 'SVG only through the checked inline path');
    assert.equal((await presign({ contentType: 'video/mp4', size: 0 })).status, 400);
    assert.equal((await presign({ contentType: 'video/mp4', size: 2 * 1024 * 1024 })).status, 413);
    const ok = await presign({ contentType: 'video/mp4', size: mp4Head.length, key: '../../evil' });
    assert.equal(ok.status, 200);
    assert.match(ok.body.url, /^\/api\/media\/[a-f0-9]{32}\.mp4$/);
    assert.equal(ok.body.expiresIn, 300);
    assert.equal(ok.body.method, 'PUT');
    const key = `media/${ok.body.url.split('/').pop()}`;
    assert.ok(ok.body.uploadUrl.includes(key) && !ok.body.uploadUrl.includes('evil'), 'the key is chosen by the server');
    // Not published before completion.
    assert.equal((await call(backend, ok.body.url)).status, 404);
    assert.equal((await call(backend, '/api/admin/media/complete', { method: 'POST', headers: admin, body: { id: ok.body.id } })).status, 409, 'nothing uploaded yet');
    await storage.put(key, mp4Head, 'video/mp4'); // the device PUTs the file to R2
    const done = await call(backend, '/api/admin/media/complete', { method: 'POST', headers: admin, body: { id: ok.body.id } });
    assert.equal(done.status, 200);
    assert.equal(done.body.url, ok.body.url);
    assert.equal((await call(backend, ok.body.url)).status, 302);
    // An object that does not match what was signed is deleted and refused.
    const bad = await presign({ contentType: 'video/mp4', size: 64 });
    const badKey = `media/${bad.body.url.split('/').pop()}`;
    await storage.put(badKey, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62)]), 'video/mp4');
    assert.equal((await call(backend, '/api/admin/media/complete', { method: 'POST', headers: admin, body: { id: bad.body.id } })).status, 400);
    assert.equal(storage.objects.has(badKey), false);
    // Videos uploaded this way are accepted in content as-is.
    const tool = await call(backend, '/api/admin/content/tools/tool_vid', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, media: { type: 'video', uri: ok.body.url }, order: 1, visible: true } });
    assert.equal(tool.body.media.uri, ok.body.url);
  } finally { backend.server.emit('close'); }
});

test('external image URLs are downloaded once into storage; unsafe or failing new URLs are refused', async () => {
  const unsplash = 'https://images.unsplash.com/photo-1?w=600';
  const { backend, admin, storage, calls } = await setup({ r2: true, files: { [unsplash]: { body: jpegBytes, mime: 'image/jpeg' } } });
  try {
    const imported = await call(backend, '/api/admin/media/import', { method: 'POST', headers: admin, body: { url: unsplash } });
    assert.equal(imported.status, 200);
    assert.match(imported.body.url, /\.jpg$/);
    const saved = await call(backend, '/api/admin/content/inspirations/insp_x', { method: 'PUT', headers: admin, body: { image: unsplash, categoryId: 'c', order: 1, visible: true } });
    assert.equal(saved.body.image, imported.body.url, 'a pasted link is replaced by the /api/media URL on save');
    assert.equal(calls.length, 1, 'downloaded once');
    assert.equal(storage.objects.size, 1);
    const blocked = await call(backend, '/api/admin/content/inspirations/insp_y', { method: 'PUT', headers: admin, body: { image: 'https://evil.example/x.png', categoryId: 'c', order: 2, visible: true } });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /^MEDIA_URL_/);
    assert.equal((await call(backend, '/api/admin/media/import', { method: 'POST', body: { url: unsplash } })).status, 401);
    // External videos are left alone in content (videos come from direct uploads or the migration script).
    const video = await call(backend, '/api/admin/content/tools/tool_ext', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, media: { type: 'video', uri: 'https://cdn.example/v.mp4' }, order: 1, visible: true } });
    assert.equal(video.body.media.uri, 'https://cdn.example/v.mp4');
    // Unchanged external URLs already stored are not re-downloaded by unrelated edits.
    await backend.db.query("UPDATE content_items SET data=$1 WHERE coll='inspirations' AND id='insp_x'", [JSON.stringify({ id: 'insp_x', image: 'https://old.example/a.jpg', order: 1, visible: true })]);
    assert.equal((await call(backend, '/api/admin/content/inspirations/insp_x', { method: 'PUT', headers: admin, body: { image: 'https://old.example/a.jpg', order: 5, visible: true } })).status, 200);
  } finally { backend.server.emit('close'); }
});

test('render flow: the client photo, AI result and final design are stored as media; a failing provider URL is kept', async () => {
  const aiUrl = 'https://ai-provider.example/out.png';
  const { backend, admin, storage } = await setup({ r2: true, files: { [aiUrl]: { body: pngBytes(100), mime: 'image/png' }, 'https://slow.example/x.png': { transient: true } } });
  try {
    const login = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Media Client', phone: '0661000099' } });
    const auth = { 'x-user-token': login.body.token, 'x-demand-token': 'c'.repeat(64) };
    const created = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id: 'media-claim-0001', photoUri: bigPng, draft: { toolId: 'tool_interior' } } });
    assert.equal(created.status, 201);
    assert.match(created.body.photoUri, MEDIA_URL);
    const retry = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id: 'media-claim-0001', photoUri: bigPng, draft: { toolId: 'tool_interior' } } });
    assert.equal(retry.body.photoUri, created.body.photoUri, 'retries are idempotent');
    const history = await call(backend, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: 'media-claim-0001', before: created.body.photoUri, after: aiUrl, status: 'done', draft: { toolId: 'tool_interior' } } });
    assert.equal(history.status, 200);
    assert.match(history.body.after, MEDIA_URL, 'AI image copied into R2');
    const patched = await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: auth, body: { aiResult: 'https://slow.example/x.png' } });
    assert.equal(patched.body.aiResult, 'https://slow.example/x.png', 'a design is never lost because a download failed');
    const final = await call(backend, `/api/requests/${created.body.id}`, { method: 'PATCH', headers: admin, body: { finalResult: smallPng, status: 'delivered' } });
    assert.match(final.body.finalResult, MEDIA_URL);
    const chat = await call(backend, '/api/user/conversations', { method: 'POST', headers: auth, body: { title: 'x', messages: [{ id: 'm1', role: 'user', text: 'hi', image: bigPng, createdAt: 1 }] } });
    assert.match(chat.body.messages[0].image, MEDIA_URL, 'assistant chat images too');
    assert.ok(storage.objects.size >= 3);
    await noBase64(backend.db);
  } finally { backend.server.emit('close'); }
});

test('legacy inline images in content are moved once at startup (network-free)', async () => {
  const db = await freshDb();
  const first = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db, media: { storage: null } });
  try {
    await call(first, '/api/content');
    await db.query("DELETE FROM settings WHERE key='media_migrated_v2'");
    await db.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES('roomTypes','legacy',$1,0)", [JSON.stringify({ id: 'legacy', image: bigPng, order: 50, visible: true })]);
  } finally { first.server.emit('close'); }
  const second = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db, media: { storage: null } });
  try {
    const content = await call(second, '/api/content');
    const legacy = content.body.collections.roomTypes.find(r => r.id === 'legacy');
    assert.match(legacy.image, MEDIA_URL);
    assert.equal((await call(second, legacy.image)).status, 200);
  } finally { second.server.emit('close'); }
});

test('migrate-media-to-r2: --dry-run writes nothing, a real run moves everything, a second run does nothing, DB copies are kept', async () => {
  const db = await freshDb();
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false' }, db, media: { storage: null } });
  await call(backend, '/api/content'); // seed + schema
  backend.server.emit('close');
  const legacyId = 'a'.repeat(32);
  await db.query("INSERT INTO media(id,mime,data,created_at) VALUES($1,'image/png',$2,0)", [legacyId, pngBytes(50).toString('base64')]);
  await db.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES('styles','inline',$1,0)", [JSON.stringify({ id: 'inline', image: bigPng, order: 1, visible: true })]);
  await db.query("INSERT INTO content_items(coll,id,data,updated_at) VALUES('styles','ext',$1,0)", [JSON.stringify({ id: 'ext', image: 'https://images.unsplash.com/photo-9', cover: 'https://gone.example/x.jpg', order: 2, visible: true })]);
  const storage = fakeR2();
  const files = { 'https://images.unsplash.com/photo-9': { body: jpegBytes, mime: 'image/jpeg' } };
  const log = () => {};
  const snapshot = async () => JSON.stringify([await db.query('SELECT * FROM content_items ORDER BY coll,id'), await db.query('SELECT id,storage,data FROM media ORDER BY id')]);
  const before = await snapshot();

  const dry = await migrate({ db, storage, download: fakeDownload(files), dryRun: true, external: true, log });
  assert.equal(dry.rowsMoved, 1);
  assert.ok(dry.rowsUpdated >= 2);
  assert.equal(storage.objects.size, 0, 'dry run: nothing uploaded');
  assert.equal(await snapshot(), before, 'dry run: database unchanged');

  const run = await migrate({ db, storage, download: fakeDownload(files), external: true, log });
  assert.equal(run.rowsMoved, 1);
  assert.deepEqual(run.externalFailed.filter(f => f.row === 'styles/ext').map(f => f.url), ['https://gone.example/x.jpg'], 'an unreachable URL is reported and kept');
  const legacy = (await db.query('SELECT storage,data FROM media WHERE id=$1', [legacyId]))[0];
  assert.equal(legacy.storage, 'r2');
  assert.ok(legacy.data.length > 0, 'the database copy is never deleted');
  assert.ok(storage.objects.has(`media/${legacyId}.png`), 'same name: existing /api/media URLs keep working');
  const ext = JSON.parse((await db.query("SELECT data FROM content_items WHERE coll='styles' AND id='ext'"))[0].data);
  assert.match(ext.image, MEDIA_URL);
  assert.equal(ext.cover, 'https://gone.example/x.jpg');
  const inline = JSON.parse((await db.query("SELECT data FROM content_items WHERE coll='styles' AND id='inline'"))[0].data);
  assert.match(inline.image, MEDIA_URL);

  const objects = storage.objects.size;
  const again = await migrate({ db, storage, download: fakeDownload(files), external: true, log });
  assert.equal(again.rowsMoved, 0);
  assert.equal(again.rowsUpdated, 0);
  assert.equal(storage.objects.size, objects, 'idempotent');
  await assert.rejects(migrate({ db, env: {}, log }), /R2 is not configured/);
});

test('R2 configuration: all five variables or the database fallback; the S3 client uses region auto', async () => {
  assert.equal(r2Status({}), 'database');
  assert.equal(r2Status({ R2_BUCKET: 'x' }), 'incomplete');
  assert.equal(r2Status(R2_ENV), 'r2');
  assert.equal(createR2Storage({ R2_BUCKET: 'x' }), null);
  const sent = [];
  const storage = createR2Storage(R2_ENV, { client: { send: async command => { sent.push(command); return {}; } }, presign: async (client, command, options) => `signed:${command.input.Key}:${options.expiresIn}:${[...options.signableHeaders].join(',')}` });
  assert.equal(storage.publicUrl('media/a.png'), 'https://media.example.com/media/a.png');
  await storage.put('media/a.png', Buffer.from('x'), 'image/png');
  assert.equal(sent[0].input.Bucket, 'bucket');
  assert.equal(sent[0].input.ContentType, 'image/png');
  assert.equal(await storage.presignPut('media/b.mp4', 'video/mp4', 10), 'signed:media/b.mp4:300:content-type,content-length');
  const { S3Client } = require('@aws-sdk/client-s3');
  const real = new S3Client({ region: 'auto', endpoint: 'https://acct.r2.cloudflarestorage.com', credentials: { accessKeyId: 'a', secretAccessKey: 'b' } });
  assert.equal(await real.config.region(), 'auto');
});

test('external downloads: https only, private addresses blocked (also via DNS), type, size and timeout enforced', async () => {
  for (const url of ['http://example.com/a.png', 'ftp://example.com/a', 'https://user:pw@example.com/a.png', 'https://example.com:8443/a.png', 'https://127.0.0.1/a.png', 'https://[::1]/a.png', 'https://10.1.2.3/a.png', 'https://169.254.169.254/latest', 'https://[::ffff:127.0.0.1]/a.png', 'not a url']) {
    assert.throws(() => parseRemoteUrl(url), error => error.policy === true, url);
  }
  assert.ok(parseRemoteUrl('https://images.unsplash.com/photo-1'));
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  // DNS answers pointing inside the network are refused at connection time.
  const lookup = safeLookup((host, options, cb) => cb(null, [{ address: '10.0.0.7', family: 4 }]));
  await new Promise(resolve => lookup('internal.example', {}, error => { assert.equal(error.code, 'PRIVATE_ADDRESS'); resolve(); }));

  const reply = (status, headers, chunks = []) => async () => ({ status, headers, body: Readable.from(chunks) });
  const ok = await downloadRemote('https://cdn.example/a.jpg', { transport: reply(200, { 'content-type': 'image/jpeg' }, [jpegBytes]) });
  assert.equal(ok.mime, 'image/jpeg');
  await assert.rejects(downloadRemote('https://cdn.example/a', { transport: reply(200, { 'content-type': 'text/html' }, ['<html>']) }), { code: 'NOT_AN_IMAGE' });
  await assert.rejects(downloadRemote('https://cdn.example/a', { transport: reply(200, { 'content-type': 'image/png' }, ['<html>not png</html>']) }), { code: 'NOT_AN_IMAGE' });
  await assert.rejects(downloadRemote('https://cdn.example/a', { transport: reply(200, { 'content-type': 'image/png', 'content-length': String(11 * 1024 * 1024) }) }), { code: 'TOO_LARGE' });
  await assert.rejects(downloadRemote('https://cdn.example/a', { maxBytes: 100, transport: reply(200, { 'content-type': 'image/png' }, [pngBytes(80), pngBytes(80)]) }), { code: 'TOO_LARGE' });
  await assert.rejects(downloadRemote('https://cdn.example/a', { transport: reply(302, { location: 'http://cdn.example/b.png' }) }), { code: 'HTTPS_REQUIRED' });
  await assert.rejects(downloadRemote('https://cdn.example/a', { transport: reply(301, { location: 'https://127.0.0.1/b.png' }) }), { code: 'PRIVATE_ADDRESS' });
  const hang = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  await assert.rejects(downloadRemote('https://cdn.example/a', { timeoutMs: 50, transport: hang }), error => error.code === 'TIMEOUT' && error.policy === false);
});

test.after(closeShared);

function rawCall(backend, url, buffer, type, headers = {}) {
  return new Promise(resolve => {
    const req = Readable.from([buffer]);
    Object.assign(req, { url, method: 'POST', headers: { 'content-type': type, ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { output.headers[k.toLowerCase()] = v; }, writeHead(status, h) { output.status = status; this.headersSent = true; }, end(value) { try { output.body = value ? JSON.parse(value) : undefined; } catch { output.body = undefined; } resolve(output); } };
    backend.handle(req, res);
  });
}

test('without R2: a video file uploaded from the admin is stored in the database and served, and a picture-less video row reaches the public content', async () => {
  const { backend, admin } = await setup({ env: { MEDIA_MAX_DB_MB: '1' } });
  try {
    assert.equal((await rawCall(backend, '/api/admin/media/raw', mp4Head, 'video/mp4')).status, 401, 'admin only');
    assert.equal((await rawCall(backend, '/api/admin/media/raw', Buffer.from('<html>nope</html>'), 'video/mp4', admin)).status, 400, 'type is checked from the bytes');
    assert.equal((await rawCall(backend, '/api/admin/media/raw', Buffer.alloc(1.5 * 1024 * 1024, 1), 'video/mp4', admin)).status, 413, 'database mode has a lower cap');
    const up = await rawCall(backend, '/api/admin/media/raw', mp4Head, 'video/mp4', admin);
    assert.equal(up.status, 200);
    assert.match(up.body.url, /^\/api\/media\/[a-f0-9]{32}\.mp4$/);
    const saved = await call(backend, '/api/admin/content/tools/tool_raw', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, media: { type: 'video', uri: up.body.url }, order: 1, visible: true } });
    assert.equal(saved.body.media.uri, up.body.url);
    const file = await call(backend, up.body.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'video/mp4');
    assert.equal(Buffer.from(file.raw).equals(mp4Head), true);
    const content = await call(backend, '/api/content');
    assert.equal(content.body.collections.tools.find(t => t.id === 'tool_raw').media.uri, up.body.url, 'the app sees the new media');
    const row = (await backend.db.query("SELECT storage,data FROM media WHERE mime='video/mp4'"))[0];
    assert.deepEqual([row.storage, row.data], ['db', '']);
  } finally { backend.server.emit('close'); }
});

test('with R2: raw uploads go to R2 as well (one write path)', async () => {
  const { backend, admin, storage } = await setup({ r2: true });
  try {
    const up = await rawCall(backend, '/api/admin/media/raw', mp4Head, 'video/mp4', admin);
    assert.equal(up.status, 200);
    assert.equal(storage.objects.has(`media/${up.body.url.split('/').pop()}`), true);
    assert.equal((await call(backend, up.body.url)).status, 302);
  } finally { backend.server.emit('close'); }
});

test('real R2 adapter: presigned PUT URLs carry no SDK checksum for an empty body (it made R2 reject every direct video upload)', async () => {
  const { r2ClientOptions } = require('../server/media');
  const options = r2ClientOptions(R2_ENV);
  assert.equal(options.requestChecksumCalculation, 'WHEN_REQUIRED');
  assert.equal(options.responseChecksumValidation, 'WHEN_REQUIRED');
  assert.equal(options.endpoint, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(options.forcePathStyle, false);
  assert.equal(r2ClientOptions({ ...R2_ENV, R2_ENDPOINT: 'https://acct.eu.r2.cloudflarestorage.com/' }).endpoint, 'https://acct.eu.r2.cloudflarestorage.com');
  // Real SDK + real presigner (signing only, no network).
  const url = new URL(await createR2Storage(R2_ENV).presignPut('media/v.mp4', 'video/mp4', 1234));
  // Same URL style as before (virtual-hosted bucket, supported by R2); only the checksum parameters are gone.
  assert.equal(url.host, 'bucket.acct.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/media/v.mp4');
  for (const key of url.searchParams.keys()) assert.ok(!/checksum/i.test(key), `unexpected ${key} in the presigned URL`);
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
});

/**
 * Optional end-to-end check with the REAL S3 SDK against an S3-compatible server (R2 itself, MinIO, moto):
 *   R2_TEST_ENDPOINT=http://127.0.0.1:5055 R2_TEST_BUCKET=dwira-media node --test scripts/check-media-server.js
 * Admin image upload -> R2 object, presign -> browser-style PUT -> complete -> saved in content -> public content -> 302 -> bytes.
 */
test('card-video renderer: pictures are readable through the admin-only /admin/media/fetch (no bucket CORS needed)', async () => {
  const outside = 'https://images.example.org/pic.png';
  const { backend, admin } = await setup({ r2: true, files: { [outside]: { body: pngBytes(40), mime: 'image/png' } } });
  try {
    const up = await call(backend, '/api/admin/media', { method: 'POST', headers: admin, body: { data: bigPng } });
    assert.equal(up.status, 200);
    const q = u => `/api/admin/media/fetch?url=${encodeURIComponent(u)}`;
    // anonymous: refused
    assert.equal((await call(backend, q(up.body.url))).status, 401);
    // our own file stored in R2 (the public /api/media URL only redirects): the bytes come back
    const mine = await call(backend, q(up.body.url), { headers: admin });
    assert.equal(mine.status, 200); assert.equal(mine.headers['content-type'], 'image/png');
    assert.equal(Buffer.from(mine.raw).toString('base64'), bigPng.split(',')[1]);
    assert.match(mine.headers['cache-control'], /no-store/);
    // the absolute form native clients use
    assert.equal((await call(backend, q(`https://app.example.com${up.body.url}`), { headers: admin })).status, 200);
    // an external picture goes through the SSRF-safe downloader
    const ext = await call(backend, q(outside), { headers: admin });
    assert.equal(ext.status, 200); assert.equal(ext.headers['content-type'], 'image/png');
    // unknown local file, blocked external URL, missing / oversized parameter
    assert.equal((await call(backend, q('/api/media/' + '0'.repeat(32) + '.png'), { headers: admin })).status, 404);
    assert.equal((await call(backend, q('https://unknown.example.org/x.png'), { headers: admin })).status, 400);
    assert.equal((await call(backend, '/api/admin/media/fetch', { headers: admin })).status, 400);
    assert.equal((await call(backend, q('x'.repeat(3000)), { headers: admin })).status, 400);
  } finally { backend.server.emit('close'); }
});

test('end to end with a real S3-compatible endpoint (skipped unless R2_TEST_ENDPOINT is set)', { skip: !process.env.R2_TEST_ENDPOINT }, async () => {
  const env = { ...R2_ENV, R2_ENDPOINT: process.env.R2_TEST_ENDPOINT, R2_BUCKET: process.env.R2_TEST_BUCKET || 'dwira-media', R2_PUBLIC_BASE_URL: `${process.env.R2_TEST_ENDPOINT}/${process.env.R2_TEST_BUCKET || 'dwira-media'}`, R2_ACCESS_KEY_ID: process.env.R2_TEST_KEY || 'test', R2_SECRET_ACCESS_KEY: process.env.R2_TEST_SECRET || 'test' };
  const storage = createR2Storage(env);
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', ...env }, db: await freshDb(), media: { storage } });
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  const admin = { authorization: `Bearer ${login.body.token}` };
  try {
    assert.equal((await call(backend, '/api/health')).body.media, 'r2');
    // 1. Image picked in the admin (ImageField -> POST /api/admin/media).
    const image = await call(backend, '/api/admin/media', { method: 'POST', headers: admin, body: { data: bigPng } });
    assert.equal(image.status, 200, JSON.stringify(image.body));
    // 2. Video: presign, PUT exactly like the browser does (fetch with the returned headers), complete.
    const video = Buffer.concat([mp4Head, Buffer.alloc(4096, 5)]);
    const presign = await call(backend, '/api/admin/media/presign', { method: 'POST', headers: admin, body: { contentType: 'video/mp4', size: video.length } });
    assert.equal(presign.status, 200, JSON.stringify(presign.body));
    const put = await fetch(presign.body.uploadUrl, { method: presign.body.method, headers: presign.body.headers, body: video });
    assert.equal(put.status, 200, `direct PUT refused: ${await put.text()}`);
    const done = await call(backend, '/api/admin/media/complete', { method: 'POST', headers: admin, body: { id: presign.body.id } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    // 3. Saved on a tool, visible in the public content.
    const saved = await call(backend, '/api/admin/content/tools/tool_e2e', { method: 'PUT', headers: admin, body: { title: { fr: 'x', ar: 'x', dar: 'x' }, image: image.body.url, media: { type: 'video', uri: done.body.url, poster: image.body.url }, order: 1, visible: true } });
    assert.equal(saved.status, 200);
    const tool = (await call(backend, '/api/content')).body.collections.tools.find(t => t.id === 'tool_e2e');
    assert.deepEqual([tool.image, tool.media.uri], [image.body.url, done.body.url]);
    // 4. Display: /api/media redirects to the public object, which returns the exact bytes.
    for (const [url, bytes, mime] of [[tool.image, Buffer.from(bigPng.split(',')[1], 'base64'), 'image/png'], [tool.media.uri, video, 'video/mp4']]) {
      const read = await call(backend, url);
      assert.equal(read.status, 302);
      const file = await fetch(read.headers.location);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get('content-type'), mime);
      assert.ok(Buffer.from(await file.arrayBuffer()).equals(bytes), `${url} bytes match`);
    }
    // 5. Client render flow: the photo goes to R2 too.
    const user = await call(backend, '/api/user/login', { method: 'POST', headers: { ...native, 'x-demand-token': 'a'.repeat(64) }, body: { name: 'Salma', phone: '+212600000001' } });
    const request = await call(backend, '/api/requests', { method: 'POST', headers: { 'x-demand-token': 'a'.repeat(64), 'x-user-token': user.body.token }, body: { id: 'req_e2e_0001', photoUri: 'data:image/jpeg;base64,' + jpegBytes.toString('base64'), draft: { toolId: 'tool_e2e' } } });
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const photo = await call(backend, request.body.photoUri);
    assert.equal(photo.status, 302);
    assert.equal((await fetch(photo.headers.location)).status, 200);
  } finally { backend.server.emit('close'); }
});

test('voice notes: a chat audio data URL is verified from its bytes, stored as media, served with Range support; fake audio is refused', async () => {
  const { backend } = await setup();
  try {
    const who = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Voice Client', phone: '0661000088' } });
    const headers = { 'x-user-token': who.body.token };
    const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(3000, 5)]);
    const send = (id, audio) => call(backend, '/api/user/conversations', { method: 'POST', headers, body: { title: 'Voice', updatedAt: 1, messages: [{ id, role: 'user', text: '', audio, createdAt: 1 }] } });
    // MediaRecorder reports `;codecs=opus` in its type: it must still be accepted.
    const ok = await send('v1', { uri: `data:audio/webm;codecs=opus;base64,${webm.toString('base64')}`, durationMs: 4321.7 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const audio = ok.body.messages[0].audio;
    assert.match(audio.uri, /^\/api\/media\/[a-f0-9]{32}\.weba$/);
    assert.equal(audio.durationMs, 4322);
    const file = await call(backend, audio.uri);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'audio/webm');
    assert.equal(file.headers['accept-ranges'], 'bytes');
    const part = await call(backend, audio.uri, { headers: { range: 'bytes=0-9' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 0-9/${webm.length}`);
    assert.equal(Buffer.from(part.raw).length, 10);
    assert.equal((await call(backend, audio.uri, { headers: { range: 'bytes=99999-' } })).status, 416);
    // Not audio at all, or audio bytes declared as another type: refused.
    assert.equal((await send('v2', { uri: `data:audio/webm;base64,${Buffer.from('<html>nope</html>').toString('base64')}` })).status, 400);
    assert.equal((await send('v3', { uri: `data:audio/mpeg;base64,${webm.toString('base64')}` })).status, 400);
    // An audio field that is not a media URL is dropped, not stored.
    const bad = await send('v4', { uri: 'javascript:alert(1)', durationMs: 5 });
    assert.equal(bad.body.messages[0].audio, undefined);
  } finally { backend.server.emit('close'); }
});
