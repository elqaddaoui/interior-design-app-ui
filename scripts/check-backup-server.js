/**
 * Backup & restore, driven through the real request handler: every backup type x data mode x media option x storage, restored to every
 * target, plus secrets, malicious archives, permissions, destinations (Drive / Dropbox against a local fake), the super admin console.
 * Runs on PGlite by default, on a real Postgres with TEST_DATABASE_URL (the same code path Neon / Supabase use).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const yazl = require('yazl');
const h = require('./backup-harness');
const { closeShared } = require('./test-db');
const { hashPassword } = require('../server/admins');

test.after(closeShared);
const P = '/api/admin/backup';
const isDir = f => fs.existsSync(f);

async function seed(s, label = 'ORIGINAL') {
  // content + a picture (stored where this setup keeps pictures) + a client, a settings secret and a model with an API key
  const put = await h.call(s.backend, '/api/admin/content/roomTypes/room_t1', { method: 'PUT', headers: s.admin, body: { title: { fr: label, ar: 'A', dar: 'A' }, image: h.pngData(3000, 5), order: 99, visible: true } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  await h.call(s.backend, '/api/admin/content/models/model_t1', { method: 'PUT', headers: s.admin, body: { name: 'M', provider: 'x', modelName: 'm', apiKey: 'sk-model-SECRET-0123456789', engine: '', baseUrl: '', enabled: true, isDefault: false, order: 5, visible: true } });
  await h.call(s.backend, '/api/admin/ai/keys', { method: 'PATCH', headers: s.admin, body: { replicate: 'r8_ImageKeySECRET0123456789' } }).catch(() => {});
  await s.db.query("INSERT INTO clients(id,phone,name,created_at,tenant_id) VALUES('cl_t1','+212600000001','Client One',1,'default') ON CONFLICT DO NOTHING");
  return { image: put.body.image, imageId: put.body.image.match(/([a-f0-9]{32})/)[1] };
}
const titleOf = async s => (await h.call(s.backend, '/api/content')).body.collections.roomTypes.find(x => x.id === 'room_t1')?.title?.fr;
const clients = async s => (await s.db.query("SELECT id FROM clients WHERE tenant_id='default'")).map(r => r.id);

async function backup(s, options, prefix = P, headers = s.admin) {
  const r = await h.startBackup(s.backend, headers, prefix, options);
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.job.status, 'done', JSON.stringify(r.job.errors) + JSON.stringify(r.job.log.slice(-4)));
  const d = await h.download(s.backend, headers, prefix, r.job.id);
  assert.equal(d.status, 200);
  assert.equal(d.headers['content-type'], 'application/zip');
  assert.equal(h.sha(d.bytes), r.job.result.sha256, 'the streamed file is the archive that was hashed');
  return { job: r.job, zip: d.bytes, entries: await h.readZip(d.bytes) };
}
async function restoreZip(s, zip, body, prefix = P, headers = s.admin) {
  const up = await h.upload(s.backend, headers, prefix, zip);
  assert.equal(up.job.status, 'done', JSON.stringify(up.job.errors));
  const r = await h.restore(s.backend, headers, prefix, { uploadId: up.id, confirm: true, ...body });
  return { up, ...r };
}

// ------------------------------------------------------------------------------------------------ the matrix
const STORAGES = [
  { name: 'database (no R2, no app storage)', setup: { r2: false, media: true }, target: ['app'] },
  { name: 'app directory', setup: { r2: false, media: 'fs', env: { MEDIA_STORAGE: 'app' } }, target: ['app'] },
  { name: 'Cloudflare R2', setup: { r2: true }, target: ['r2', 'app'] },
];
for (const storage of STORAGES) {
  for (const type of ['db', 'app', 'both']) {
    for (const data of type === 'app' ? ['content'] : ['content', 'empty']) {
      for (const media of [false, true]) {
        const withMedia = media && type !== 'app' ? true : media;
        for (const target of media ? storage.target : [null]) {
          const name = `${type} | ${data === 'empty' ? 'schema only' : 'with content'} | media ${media ? 'included' : 'excluded'} | stored in ${storage.name}${media ? ` -> restored to ${target}` : ''}`;
          test(`cycle: ${name}`, async () => {
            const s = await h.setup(storage.setup);
            try {
              const before = await seed(s);
              const made = await backup(s, { type, data, media: withMedia });
              const names = made.entries.names;
              const m = JSON.parse((await made.entries.read('manifest.json')).toString());
              // what the archive holds
              assert.equal(names.some(n => n.startsWith('db/')), type !== 'app', 'db part');
              assert.equal(names.some(n => n.startsWith('app/')), type !== 'db', 'app part');
              assert.equal(names.some(n => n.startsWith('media/') && n.includes('/files/')), withMedia, 'media part');
              assert.equal(m.includes.media, withMedia);
              if (type !== 'app') {
                assert.equal(m.db.schemaOnly, data === 'empty');
                assert.equal(names.some(n => n.startsWith('db/data/')), data !== 'empty', 'schema-only archives carry no rows');
                assert.ok(names.includes('db/schema.sql'));
              }
              // no secret in any file of the archive
              for (const n of names) {
                const text = (await made.entries.read(n)).toString('latin1');
                for (const secret of ['sk-model-SECRET-0123456789', 'r8_ImageKeySECRET0123456789', 'SuperSecretDbPassword123', 'sk_live_ShouldNeverLeak99', 'secret-top-level-value', 'PRIVATE KEY']) assert.ok(!text.includes(secret), `${n} leaks ${secret}`);
                assert.ok(!/(^|\/)\.env(?!\.(?:example|sample)$)/.test(n) && !/\.pem$/.test(n) && !n.includes('node_modules') && !n.startsWith('app/server/data/'), n);
              }
              // change everything the backup knows about
              await h.call(s.backend, '/api/admin/content/roomTypes/room_t1', { method: 'PUT', headers: s.admin, body: { title: { fr: 'CHANGED', ar: 'A', dar: 'A' }, order: 99, visible: true } });
              await s.db.query("DELETE FROM clients WHERE id='cl_t1'");
              await s.db.query('DELETE FROM media WHERE id=$1', [before.imageId]);
              if (storage.setup.r2) s.storage.objects.clear();
              if (isDir(s.mediaDir)) fs.rmSync(s.mediaDir, { recursive: true, force: true });
              fs.writeFileSync(path.join(s.appRoot, 'server/index.js'), '// server CHANGED');
              fs.writeFileSync(path.join(s.appRoot, 'dist/index.html'), '<html>app CHANGED</html>');
              const res = await restoreZip(s, made.zip, withMedia ? { mediaTarget: target } : {});
              assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors) + JSON.stringify(res.job.log.slice(-3)));
              const restored = res.job.result.restored;
              // database
              if (type !== 'app') {
                if (data === 'empty') {
                  assert.notEqual(await titleOf(s), 'CHANGED', 'schema-only restore replaces the data');
                  assert.notEqual(await titleOf(s), 'ORIGINAL', 'schema-only restore carries no rows');
                  assert.deepEqual(await clients(s), [], 'clients are gone after a schema-only restore');
                  assert.equal((await s.db.query("SELECT COUNT(*)::int AS n FROM content_items WHERE tenant_id='default' AND id='room_t1'"))[0].n, 0);
                } else {
                  assert.equal(await titleOf(s), 'ORIGINAL');
                  assert.deepEqual(await clients(s), ['cl_t1']);
                  assert.equal(restored.db.clients, 1);
                }
              } else {
                assert.equal(restored.db, null);
                assert.equal(await titleOf(s), 'CHANGED', 'an app-only restore never touches the database');
              }
              // app files
              if (type !== 'db') {
                assert.equal(fs.readFileSync(path.join(s.appRoot, 'server/index.js'), 'utf8'), '// server v1');
                assert.equal(fs.readFileSync(path.join(s.appRoot, 'dist/index.html'), 'utf8'), '<html>app v1</html>');
                assert.equal(fs.readFileSync(path.join(s.appRoot, 'server/.env'), 'utf8').includes('SuperSecretDbPassword123'), true, 'the .env on the server is left untouched');
                assert.equal(res.job.result.restartRequired, true);
              } else assert.equal(fs.readFileSync(path.join(s.appRoot, 'server/index.js'), 'utf8'), '// server CHANGED');
              // media
              if (withMedia && type !== 'app' || (withMedia && type === 'app')) {
                assert.equal(restored.media, 1, 'one picture restored');
                const row = (await s.db.query("SELECT storage FROM media WHERE id=$1 AND tenant_id='default'", [before.imageId]))[0];
                assert.equal(row?.storage, target === 'r2' ? 'r2' : 'fs', 'row points at the chosen storage');
                if (target === 'r2') assert.ok(s.storage.objects.has(`media/${before.imageId}.png`), 'object is in R2');
                else assert.ok(fs.existsSync(path.join(s.mediaDir, 'media', `${before.imageId}.png`)), 'file is in the app directory');
                if (type !== 'app' && data !== 'empty' && target !== 'r2') {
                  const f = await h.call(s.backend, before.image);
                  assert.equal(f.status, 200); assert.ok(f.bytes.equals(h.pngBytes(3000, 5)), 'bytes identical after the cycle');
                }
              }
              // the administrator can still sign in
              assert.equal((await h.call(s.backend, '/api/admin/login', { method: 'POST', headers: h.native, body: { email: 'admin', password: 'admin' } })).status, 200);
              // a safety snapshot was taken before the database was replaced
              if (type !== 'app') assert.ok(res.job.result.safetyBackup?.name, 'safety backup');
            } finally { s.cleanup(); }
          });
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ helpers for the groups below
async function superLogin(backend) {
  const r = await h.call(backend, '/api/super-admin/login', { method: 'POST', headers: h.native, body: { email: 'superadmin', password: 'superadmin' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { 'x-super-token': r.body.token };
}
async function newShop(backend, S, slug) {
  const r = await h.call(backend, '/api/super-admin/tenants', { method: 'POST', headers: S, body: { name: `Shop ${slug}`, slug, ownerEmail: `owner@${slug}.test` } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const login = await h.call(backend, `/${slug}/api/admin/login`, { method: 'POST', headers: h.native, body: { email: `owner@${slug}.test`, password: r.body.admin.password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { tenant: r.body.tenant, headers: h.bearer(login.body.token), prefix: `/${slug}/api/admin/backup`, slug };
}

/** A zip written by hand, so the tests can build archives the real writer never would (unsafe names, symlinks, wrong hashes ...). */
function craftZip(entries) {
  const zlib = require('node:zlib');
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name), data = e.data, method = e.deflate ? 8 : 0;
    const body = e.deflate ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body); centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** A backup with a consistent manifest around the given files; `manifest` overrides fields, `list` rewrites the file list. */
function craftBackup(files, { manifest = {}, list } = {}) {
  const listed = list || files.map(f => ({ path: f.name, size: f.data.length, sha256: h.sha(f.data) }));
  const m = { format: 'dwira-backup', version: 1, scope: 'tenant', tenantId: 'default', type: 'db', includes: { app: false, db: false, media: false }, files: listed, ...manifest };
  return craftZip([...files, { name: 'manifest.json', data: Buffer.from(JSON.stringify(m)) }]);
}

// ------------------------------------------------------------------------------------------------ secrets
test('secrets: never in the archive, kept by a restore (passwords, model keys, settings keys)', async () => {
  const s = await h.setup({ r2: false });
  try {
    await seed(s);
    await s.db.query("INSERT INTO settings(key,value,tenant_id) VALUES('image_keys','{\"replicate\":\"r8_SettingsKeySECRET\"}','default') ON CONFLICT (tenant_id,key) DO UPDATE SET value=excluded.value");
    await s.db.query("INSERT INTO settings(key,value,tenant_id) VALUES('vapid','{\"privateKey\":\"vapid-PRIVATE-SECRET\"}','default') ON CONFLICT (tenant_id,key) DO UPDATE SET value=excluded.value");
    const pw = await h.call(s.backend, '/api/admin/account/password', { method: 'POST', headers: s.admin, body: { current: 'admin', next: 'Brand-New-Pass-9981' } });
    assert.equal(pw.status, 200, JSON.stringify(pw.body));
    const hashBefore = (await s.db.query("SELECT pw_hash FROM admin_accounts WHERE tenant_id='default' AND admin_id='admin'"))[0].pw_hash;
    assert.ok(hashBefore);
    const made = await backup(s, { type: 'both', data: 'content', media: true });
    for (const n of made.entries.names) {
      const text = (await made.entries.read(n)).toString('latin1');
      for (const secret of ['r8_SettingsKeySECRET', 'vapid-PRIVATE-SECRET', 'sk-model-SECRET-0123456789', hashBefore, 'SuperSecretDbPassword123']) assert.ok(!text.includes(secret), `${n} leaks a secret`);
    }
    const settings = (await made.entries.read('db/data/settings.ndjson')).toString();
    assert.ok(!/image_keys|vapid/.test(settings), 'secret settings rows are not exported');
    assert.ok(!(await made.entries.read('db/data/admin_accounts.ndjson')).toString().includes('pw_hash'), 'password hashes are not exported');
    // change the secrets, restore: the CURRENT secrets stay (a backup can neither leak nor overwrite them)
    await s.db.query("UPDATE settings SET value='{\"replicate\":\"r8_CURRENT\"}' WHERE key='image_keys' AND tenant_id='default'");
    const pw2 = await h.call(s.backend, '/api/admin/account/password', { method: 'POST', headers: s.admin, body: { current: 'Brand-New-Pass-9981', next: 'Another-Pass-77123' } });
    assert.equal(pw2.status, 200, JSON.stringify(pw2.body));
    const login = await h.call(s.backend, '/api/admin/login', { method: 'POST', headers: h.native, body: { email: 'admin', password: 'Another-Pass-77123' } });
    const res = await restoreZip(s, made.zip, { mediaTarget: 'app' }, P, h.bearer(login.body.token));
    assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors));
    assert.equal((await s.db.query("SELECT value FROM settings WHERE key='image_keys' AND tenant_id='default'"))[0].value, '{"replicate":"r8_CURRENT"}', 'settings keys kept');
    assert.notEqual((await s.db.query("SELECT pw_hash FROM admin_accounts WHERE tenant_id='default' AND admin_id='admin'"))[0].pw_hash, hashBefore, 'the current password hash is kept');
    assert.equal((await h.call(s.backend, '/api/admin/login', { method: 'POST', headers: h.native, body: { email: 'admin', password: 'Another-Pass-77123' } })).status, 200);
    const model = (await s.db.query("SELECT data FROM content_items WHERE tenant_id='default' AND coll='models' AND id='model_t1'"))[0];
    assert.equal(JSON.parse(model.data).apiKey, 'sk-model-SECRET-0123456789', 'model API key kept');
    const jobs = fs.readdirSync(path.join(s.backupDir, 'jobs')).map(f => fs.readFileSync(path.join(s.backupDir, 'jobs', f), 'utf8')).join('\n');
    assert.ok(!jobs.includes('sk-model-SECRET') && !jobs.includes('Another-Pass'), 'job files hold no secrets');
  } finally { s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ malicious / broken archives
const MALICIOUS = [
  ['zip-slip (../ in a name)', () => craftBackup([{ name: '../evil.txt', data: Buffer.from('x') }]), ['ARCHIVE_UNSAFE_PATH', 'NOT_A_ZIP']],
  ['absolute path', () => craftBackup([{ name: '/etc/cron.d/evil', data: Buffer.from('x') }]), ['ARCHIVE_UNSAFE_PATH', 'NOT_A_ZIP']],
  ['symbolic link', () => craftBackup([{ name: 'app/dist/link', data: Buffer.from('/etc/passwd'), mode: 0o120777 }]), ['ARCHIVE_SYMLINK']],
  ['duplicate entry', () => craftBackup([{ name: 'db/schema.sql', data: Buffer.from('a') }, { name: 'db/schema.sql', data: Buffer.from('b') }]), ['ARCHIVE_DUPLICATE']],
  ['decompression bomb', () => craftBackup([{ name: 'app/dist/big.bin', data: Buffer.alloc(30 * 1024 * 1024), deflate: true }]), ['ARCHIVE_BOMB']],
  ['tampered content (hash differs)', () => craftBackup([{ name: 'db/schema.sql', data: Buffer.from('SELECT 1;') }], { list: [{ path: 'db/schema.sql', size: 9, sha256: h.sha(Buffer.from('SELECT 2;')) }] }), ['ARCHIVE_CORRUPT']],
  ['entry not listed in the manifest', () => craftBackup([{ name: 'db/schema.sql', data: Buffer.from('x') }], { list: [] }), ['ARCHIVE_UNLISTED_ENTRY']],
  ['listed entry missing', () => craftBackup([], { list: [{ path: 'db/schema.sql', size: 1, sha256: h.sha(Buffer.from('x')) }] }), ['ARCHIVE_MISSING_ENTRY']],
  ['unknown kind of entry', () => craftBackup([{ name: 'readme.txt', data: Buffer.from('x') }]), ['ARCHIVE_UNKNOWN_ENTRY']],
  ['a .env file', () => craftBackup([{ name: 'app/server/.env', data: Buffer.from('K=V') }]), ['ARCHIVE_SECRET_FILE']],
  ['a private key', () => craftBackup([{ name: 'app/server/tls.pem', data: Buffer.from('K') }]), ['ARCHIVE_SECRET_FILE']],
  ['app file outside the allow list (node_modules)', () => craftBackup([{ name: 'app/node_modules/x/index.js', data: Buffer.from('x') }]), ['ARCHIVE_UNSAFE_PATH']],
  ['not a Dwira backup (other format)', () => craftBackup([], { manifest: { format: 'something-else' } }), ['ARCHIVE_NOT_A_BACKUP']],
  ['written by a newer version', () => craftBackup([], { manifest: { version: 99 } }), ['ARCHIVE_NEWER_VERSION']],
  ['wrong scope (a platform backup into a store)', () => craftBackup([], { manifest: { scope: 'platform' } }), ['SCOPE_MISMATCH']],
  ['no manifest at all', () => craftZip([{ name: 'db/schema.sql', data: Buffer.from('x') }]), ['ARCHIVE_MISSING_ENTRY', 'ARCHIVE_INVALID_MANIFEST']],
  ['manifest is not JSON', () => craftZip([{ name: 'manifest.json', data: Buffer.from('{nope') }]), ['ARCHIVE_INVALID_MANIFEST']],
];
for (const [name, build, codes] of MALICIOUS) {
  test(`validation refuses: ${name}`, async () => {
    const s = await h.setup({ r2: false });
    try {
      await seed(s);
      const zip = build();
      const created = await h.call(s.backend, `${P}/uploads`, { method: 'POST', headers: s.admin, body: { size: zip.length } });
      assert.equal(created.status, 201);
      const id = created.body.uploadId;
      await h.call(s.backend, `${P}/uploads/${id}/chunk?offset=0`, { method: 'POST', headers: s.admin, raw: zip });
      const done = await h.call(s.backend, `${P}/uploads/${id}/complete`, { method: 'POST', headers: s.admin });
      if (done.status === 202) {
        const job = await h.finish(s.backend, s.admin, P, done.body.job.id);
        assert.equal(job.status, 'error', 'validation fails');
        assert.ok(codes.includes(job.errors[0]?.code), `got ${job.errors[0]?.code}`);
        const r = await h.restore(s.backend, s.admin, P, { uploadId: id, confirm: true });
        assert.equal(r.status, 409); assert.equal(r.body.error, 'NOT_VALIDATED');
      } else { assert.equal(done.status, 400); assert.ok(codes.includes(done.body.error), `got ${done.body.error}`); }
      assert.equal(await titleOf(s), 'ORIGINAL', 'nothing was touched');
      assert.equal(fs.readFileSync(path.join(s.appRoot, 'server/index.js'), 'utf8'), '// server v1');
    } finally { s.cleanup(); }
  });
}

// ------------------------------------------------------------------------------------------------ confirmation, chunk protocol
test('restore asks for confirmation; chunk protocol errors are explicit; uploads are private to their owner', async () => {
  const s = await h.setup({ r2: false });
  try {
    await seed(s);
    const made = await backup(s, { type: 'db', data: 'content', media: false });
    await h.call(s.backend, '/api/admin/content/roomTypes/room_t1', { method: 'PUT', headers: s.admin, body: { title: { fr: 'CHANGED', ar: 'A', dar: 'A' }, order: 99, visible: true } });
    const up = await h.upload(s.backend, s.admin, P, made.zip);
    assert.equal(up.job.status, 'done');
    assert.ok(up.job.result.plan.willReplace.content_items >= 1, 'the plan says what will be replaced');
    assert.ok(up.job.result.plan.warnings.some(w => w.code === 'PASSWORDS_NOT_IN_BACKUP'));
    for (const body of [{ uploadId: up.id }, { uploadId: up.id, confirm: 'yes' }, { uploadId: up.id, confirm: false }]) {
      const r = await h.restore(s.backend, s.admin, P, body);
      assert.equal(r.status, 409); assert.equal(r.body.error, 'CONFIRMATION_REQUIRED');
    }
    assert.equal(await titleOf(s), 'CHANGED', 'nothing was restored without confirmation');
    assert.equal((await h.restore(s.backend, s.admin, P, { uploadId: up.id, confirm: true, parts: { db: false, app: false, media: false } })).body.error, 'NOTHING_TO_RESTORE');
    assert.equal((await h.restore(s.backend, s.admin, P, { uploadId: 'ffffffffffff', confirm: true })).status, 404);
    const c = await h.call(s.backend, `${P}/uploads`, { method: 'POST', headers: s.admin, body: { size: 10 } });
    const id = c.body.uploadId;
    const chunk = (offset, raw, headers = s.admin, prefix = P) => h.call(s.backend, `${prefix}/uploads/${id}/chunk?offset=${offset}`, { method: 'POST', headers, raw });
    let r = await chunk(5, Buffer.from('abc')); assert.equal(r.status, 409); assert.equal(r.body.error, 'UPLOAD_OFFSET'); assert.equal(r.body.expected, 0);
    r = await chunk(0, Buffer.alloc(11)); assert.equal(r.status, 413); assert.equal(r.body.error, 'UPLOAD_TOO_LARGE');
    r = await chunk(0, Buffer.from('abcd')); assert.equal(r.status, 200); assert.equal(r.body.received, 4);
    r = await h.call(s.backend, `${P}/uploads/${id}/complete`, { method: 'POST', headers: s.admin }); assert.equal(r.status, 409); assert.equal(r.body.error, 'UPLOAD_INCOMPLETE');
    r = await chunk(4, Buffer.from('efghij')); assert.equal(r.status, 200); assert.equal(r.body.received, 10);
    const S = await superLogin(s.backend);
    const shop = await newShop(s.backend, S, 'otherup');
    r = await chunk(0, Buffer.from('x'), shop.headers, shop.prefix); assert.equal(r.status, 404, "another store cannot touch this upload");
    assert.equal((await h.call(s.backend, `${P}/uploads/${id}`, { method: 'DELETE', headers: s.admin })).status, 200);
    assert.equal((await chunk(10, Buffer.from('x'))).status, 404, 'a discarded upload is gone');
  } finally { s.cleanup(); }
});

test('upload limits: not a zip, empty, oversize', async () => {
  const s = await h.setup({ r2: false, env: { BACKUP_MAX_UPLOAD_MB: '1' } });
  try {
    const c = await h.call(s.backend, `${P}/uploads`, { method: 'POST', headers: s.admin, body: { size: 30 } });
    await h.call(s.backend, `${P}/uploads/${c.body.uploadId}/chunk?offset=0`, { method: 'POST', headers: s.admin, raw: Buffer.from('this is plainly not a zip file') });
    const done = await h.call(s.backend, `${P}/uploads/${c.body.uploadId}/complete`, { method: 'POST', headers: s.admin });
    assert.equal(done.status, 400); assert.equal(done.body.error, 'NOT_A_ZIP');
    assert.equal((await h.call(s.backend, `${P}/uploads`, { method: 'POST', headers: s.admin, body: { size: 0 } })).status, 400);
    const big = await h.call(s.backend, `${P}/uploads`, { method: 'POST', headers: s.admin, body: { size: 5 * 1024 * 1024 } });
    assert.equal(big.status, 413); assert.equal(big.body.error, 'UPLOAD_TOO_LARGE');
    // a truncated real archive is refused too
    const good = craftBackup([{ name: 'db/schema.sql', data: Buffer.from('x') }]).subarray(0, 120);
    const t = await h.call(s.backend, `${P}/uploads`, { method: 'POST', headers: s.admin, body: { size: good.length } });
    await h.call(s.backend, `${P}/uploads/${t.body.uploadId}/chunk?offset=0`, { method: 'POST', headers: s.admin, raw: good });
    const td = await h.call(s.backend, `${P}/uploads/${t.body.uploadId}/complete`, { method: 'POST', headers: s.admin });
    if (td.status === 202) assert.equal((await h.finish(s.backend, s.admin, P, td.body.job.id)).status, 'error'); else assert.equal(td.status, 400);
  } finally { s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ jobs
test('jobs: one at a time per store, cancel leaves no partial archive, old files are swept, bad options refused', async () => {
  const s = await h.setup({ r2: false, env: { BACKUP_KEEP_FILES: '2', BACKUP_KEEP_HOURS: '0' } });
  try {
    await seed(s);
    const first = await h.call(s.backend, `${P}/jobs`, { method: 'POST', headers: s.admin, body: { type: 'both', data: 'content', media: true } });
    assert.equal(first.status, 202);
    const second = await h.call(s.backend, `${P}/jobs`, { method: 'POST', headers: s.admin, body: { type: 'db' } });
    assert.equal(second.status, 409); assert.equal(second.body.error, 'BACKUP_BUSY');
    assert.equal((await h.call(s.backend, `${P}/jobs/${first.body.job.id}/cancel`, { method: 'POST', headers: s.admin })).status, 200);
    const job = await h.finish(s.backend, s.admin, P, first.body.job.id);
    assert.ok(['cancelled', 'done'].includes(job.status));
    if (job.status === 'cancelled') {
      assert.deepEqual(fs.readdirSync(path.join(s.backupDir, 'files')), [], 'no partial archive left');
      assert.ok([404, 409, 410].includes((await h.call(s.backend, `${P}/jobs/${job.id}/download`, { headers: s.admin })).status));
    }
    assert.equal(fs.existsSync(path.join(s.backupDir, 'work', job.id)), false, 'temporary files are removed');
    for (let i = 0; i < 3; i++) await backup(s, { type: 'db', data: 'content', media: false });
    await s.backend.backup.sweep();
    assert.ok(fs.readdirSync(path.join(s.backupDir, 'files')).filter(f => f.endsWith('.zip')).length <= 2, 'old archives are swept');
    assert.ok((await h.call(s.backend, `${P}/jobs`, { headers: s.admin })).body.jobs.length >= 3, 'the job list is kept');
    for (const bad of [{ type: 'nope' }, { type: 'db', data: 'half' }, { type: 'db', destination: 'ftp' }, { type: 'db', provider: 'oracle' }]) assert.equal((await h.call(s.backend, `${P}/jobs`, { method: 'POST', headers: s.admin, body: bad })).status, 400, JSON.stringify(bad));
    assert.equal((await h.call(s.backend, `${P}/jobs/ffffffffffffffff`, { headers: s.admin })).status, 404);
  } finally { s.cleanup(); }
});

test('unsupported host (serverless): backup refuses with a clear error unless forced', async () => {
  const s = await h.setup({ r2: false, env: { VERCEL: '1' } });
  try {
    const caps = await h.call(s.backend, `${P}/capabilities`, { headers: s.admin });
    assert.equal(caps.status, 200); assert.equal(caps.body.available, false); assert.equal(caps.body.reason, 'BACKUP_UNSUPPORTED_HOST');
    const r = await h.call(s.backend, `${P}/jobs`, { method: 'POST', headers: s.admin, body: { type: 'db' } });
    assert.equal(r.status, 501); assert.equal(r.body.error, 'BACKUP_UNSUPPORTED_HOST');
  } finally { s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ permissions, Store API, tenant isolation
test('permissions: unauthenticated -> 401, backup:false -> 403, Store API hidden behind a read-only health word', async () => {
  const s = await h.setup({ r2: false });
  try {
    await seed(s);
    for (const url of ['/api/admin/backup/capabilities', '/api/admin/backup/jobs']) assert.equal((await h.call(s.backend, url)).status, 401, url);
    assert.equal((await h.call(s.backend, '/api/admin/backup/jobs', { method: 'POST', body: { type: 'db' } })).status, 401);
    assert.equal((await h.call(s.backend, '/api/super-admin/backup/capabilities')).status, 401);
    assert.equal((await h.call(s.backend, '/api/super-admin/backup/capabilities', { headers: s.admin })).status, 401, 'a store token never opens the platform backup');
    const S = await superLogin(s.backend);
    const created = await h.call(s.backend, '/api/super-admin/tenants/default/admins', { method: 'POST', headers: S, body: { email: 'helper@shop.test', name: 'Helper' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const idOf = encodeURIComponent(created.body.id || created.body.admin?.id || 'helper@shop.test');
    const login = await h.call(s.backend, '/api/admin/login', { method: 'POST', headers: h.native, body: { email: 'helper@shop.test', password: created.body.password || created.body.admin?.password } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const helper = h.bearer(login.body.token);
    assert.equal((await h.call(s.backend, '/api/admin/backup/capabilities', { headers: helper })).status, 200, 'allowed by default');
    assert.equal((await h.call(s.backend, '/api/admin/ai/status', { headers: helper })).status, 200);
    assert.equal(JSON.stringify((await h.call(s.backend, '/api/content', { headers: helper })).body).includes('sk-model-SECRET-0123456789'), true, 'keys visible with the permission');
    const patch = await h.call(s.backend, `/api/super-admin/tenants/default/admins/${idOf}`, { method: 'PATCH', headers: S, body: { permissions: { backup: false, storeApi: false } } });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));
    assert.deepEqual(patch.body.permissions, { storeApi: false, backup: false });
    for (const url of ['/api/admin/backup/capabilities', '/api/admin/backup/jobs']) { const r = await h.call(s.backend, url, { headers: helper }); assert.equal(r.status, 403, url); assert.equal(r.body.error, 'PERMISSION_DENIED'); }
    assert.equal((await h.call(s.backend, '/api/admin/backup/jobs', { method: 'POST', headers: helper, body: { type: 'db' } })).status, 403);
    assert.equal((await h.call(s.backend, '/api/admin/backup/uploads', { method: 'POST', headers: helper, body: { size: 5 } })).status, 403);
    assert.equal((await h.call(s.backend, '/api/admin/backup/restores', { method: 'POST', headers: helper, body: { uploadId: 'ffffffffffff', confirm: true } })).status, 403);
    for (const [url, method, body] of [['/api/admin/ai/status', 'GET'], ['/api/admin/ai/keys', 'PATCH', { replicate: 'x' }], ['/api/admin/chat/status', 'GET'], ['/api/admin/chat/keys', 'PATCH', {}], ['/api/admin/chat/config', 'PUT', {}], ['/api/admin/content/models/model_t1', 'PUT', { name: 'x' }]]) {
      assert.equal((await h.call(s.backend, url, { method, headers: helper, body })).status, 403, `${method} ${url}`);
    }
    const stripped = await h.call(s.backend, '/api/content', { headers: helper });
    assert.equal(stripped.status, 200);
    assert.equal(JSON.stringify(stripped.body).includes('sk-model-SECRET-0123456789'), false, 'no provider key reaches an administrator without the Store API permission');
    const health = await h.call(s.backend, '/api/admin/api-health', { headers: helper });
    assert.equal(health.status, 200);
    assert.deepEqual(Object.keys(health.body), ['status'], 'one word, nothing else');
    assert.ok(['working', 'not_working'].includes(health.body.status));
    assert.equal((await h.call(s.backend, '/api/admin/api-health')).status, 401);
    assert.equal((await h.call(s.backend, '/api/admin/api-health', { headers: s.admin })).status, 200);
    const session = await h.call(s.backend, '/api/admin/session', { headers: helper });
    assert.deepEqual(session.body.profile.permissions, { storeApi: false, backup: false });
    assert.equal((await h.call(s.backend, '/api/admin/backup/capabilities', { headers: s.admin })).status, 200, 'the owner is unaffected');
    assert.equal((await h.call(s.backend, `/api/super-admin/tenants/default/admins/${idOf}`, { method: 'PATCH', headers: S, body: { permissions: { root: true } } })).status, 400);
    await h.call(s.backend, `/api/super-admin/tenants/default/admins/${idOf}`, { method: 'PATCH', headers: S, body: { permissions: { backup: true, storeApi: true } } });
    assert.equal((await h.call(s.backend, '/api/admin/backup/capabilities', { headers: helper })).status, 200, 're-allowed');
  } finally { s.cleanup(); }
});

test('tenant isolation: a store backs up and restores only its own data, never the app or the platform', async () => {
  const s = await h.setup({ r2: false });
  try {
    await seed(s);
    const S = await superLogin(s.backend);
    const shop = await newShop(s.backend, S, 'isoshop');
    await h.call(s.backend, `/${shop.slug}/api/admin/content/roomTypes/room_shop`, { method: 'PUT', headers: shop.headers, body: { title: { fr: 'SHOP-ONLY', ar: 'A', dar: 'A' }, order: 1, visible: true } });
    const caps = await h.call(s.backend, `${shop.prefix}/capabilities`, { headers: shop.headers });
    assert.equal(caps.status, 200); assert.equal(caps.body.canApp, false); assert.deepEqual(caps.body.types, ['app', 'db', 'both']); assert.equal(caps.body.storeSplit, true);
    // A store has no server files: "app" = its design and settings, "db" = its operational data, "both" = everything. Never a file of the app.
    const names = async type => { const m = await backup(s, { type, data: 'content', media: false }, shop.prefix, shop.headers); assert.ok(!m.entries.names.some(n => /saas_|^app\//.test(n)), `${type}: no platform table, no app files`); return m.entries.names.filter(n => n.startsWith('db/data/')).map(n => n.slice(8, -7)); };
    const designTables = await names('app'), dataTables = await names('db'), allTables = await names('both');
    assert.ok(designTables.includes('content_items') && designTables.includes('settings') && !designTables.includes('clients') && !designTables.includes('requests'), `design only: ${designTables}`);
    assert.ok(dataTables.includes('clients') && dataTables.includes('requests') && !dataTables.includes('content_items') && !dataTables.includes('settings'), `data only: ${dataTables}`);
    assert.ok(allTables.includes('clients') && allTables.includes('content_items'), 'both');
    const made = await backup(s, { type: 'both', data: 'content', media: false }, shop.prefix, shop.headers);
    assert.ok(!made.entries.names.some(n => /saas_|^app\//.test(n)), 'no platform table, no app files');
    const all = (await Promise.all(made.entries.names.map(async n => (await made.entries.read(n)).toString('latin1')))).join('\n');
    assert.ok(all.includes('SHOP-ONLY'), 'its own content');
    assert.ok(!all.includes('cl_t1') && !all.includes('Client One') && !all.includes('sk-model-SECRET'), "never another store's rows");
    const own = await backup(s, { type: 'db', data: 'content', media: false });
    const up = await h.upload(s.backend, shop.headers, shop.prefix, own.zip);
    assert.equal(up.job.status, 'done');
    assert.ok(up.job.result.plan.warnings.some(w => w.code === 'OTHER_STORE'));
    assert.equal((await h.restore(s.backend, shop.headers, shop.prefix, { uploadId: up.id, confirm: true, parts: { app: true } })).status, 400);
    assert.equal((await h.call(s.backend, `${shop.prefix}/jobs/${own.job.id}`, { headers: shop.headers })).status, 404);
    assert.equal((await h.call(s.backend, `${shop.prefix}/jobs/${own.job.id}/download`, { headers: shop.headers })).status, 404);
    const before = await titleOf(s);
    const res = await restoreZip(s, made.zip, {}, shop.prefix, shop.headers);
    assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors));
    assert.equal(await titleOf(s), before, 'the default store is untouched');
    assert.deepEqual(await clients(s), ['cl_t1']);
  } finally { s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ providers
test('database provider: Neon / Supabase labels, mismatch refused, cross-provider restore warns and works', async () => {
  const a = await h.setup({ r2: false, env: { DB_PROVIDER: 'neon' } });
  let zip;
  try {
    await seed(a);
    const capsA = (await h.call(a.backend, `${P}/capabilities`, { headers: a.admin })).body.provider;
    assert.equal(capsA.detected, 'neon');
    assert.equal(capsA.locked, true, 'a detected provider is selected for the person and cannot be changed');
    const bad = await h.call(a.backend, `${P}/jobs`, { method: 'POST', headers: a.admin, body: { type: 'db', provider: 'supabase' } });
    assert.equal(bad.status, 400); assert.equal(bad.body.error, 'PROVIDER_MISMATCH'); assert.equal(bad.body.detected, 'neon');
    assert.equal((await h.call(a.backend, `${P}/jobs`, { method: 'POST', headers: a.admin, body: { type: 'db', provider: 'oracle' } })).body.error, 'INVALID_PROVIDER');
    const made = await backup(a, { type: 'db', provider: 'neon', data: 'content', media: false });
    zip = made.zip;
    assert.equal(JSON.parse((await made.entries.read('manifest.json')).toString()).db.provider, 'neon');
  } finally { a.cleanup(); }
  const b = await h.setup({ r2: false, env: { DB_PROVIDER: 'supabase' } });
  try {
    await seed(b, 'OTHER');
    const res = await restoreZip(b, zip, {});
    assert.equal(res.up.job.result.plan.warnings.some(w => w.code === 'PROVIDER_DIFFERS' && w.from === 'neon' && w.to === 'supabase'), true);
    assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors));
    assert.equal(await titleOf(b), 'ORIGINAL', 'data moved from the "neon" backup into the "supabase" database');
    const sup = await backup(b, { type: 'db', provider: 'supabase', data: 'empty', media: false });
    assert.equal(JSON.parse((await sup.entries.read('manifest.json')).toString()).db.provider, 'supabase');
  } finally { b.cleanup(); }
  const c = await h.setup({ r2: false });
  try {
    assert.equal((await h.call(c.backend, `${P}/capabilities`, { headers: c.admin })).body.provider.locked, false, 'an undetected provider may be chosen');
    for (const provider of ['neon', 'supabase', 'auto']) {
      const m = await backup(c, { type: 'db', provider, data: 'content', media: false });
      assert.ok(['neon', 'supabase', 'pglite', 'postgres'].includes(JSON.parse((await m.entries.read('manifest.json')).toString()).db.provider));
    }
  } finally { c.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ destinations (Google Drive / Dropbox against a local fake)
/** A local stand-in for the Drive resumable endpoint and the Dropbox content API. `fault` injects failures. */
async function fakeCloud(fault = {}) {
  const state = { drive: { bytes: Buffer.alloc(0), metadata: null, puts: 0, auth: [] }, dropbox: { files: new Map(), sessions: new Map(), calls: [], auth: [] }, tokenCalls: 0 };
  const readBody = req => new Promise(resolve => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, 'http://x');
    const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (url.pathname === '/token') { state.tokenCalls++; return send(200, { access_token: 'refreshed-token' }); }
    if (url.pathname === '/drive') {
      state.drive.auth.push(req.headers.authorization);
      if (fault.auth) return send(401, { error: 'bad' });
      state.drive.metadata = JSON.parse(body.toString() || '{}');
      return send(200, {}, { location: `http://127.0.0.1:${server.address().port}/drive-session` });
    }
    if (url.pathname === '/drive-session') {
      state.drive.puts++;
      if (fault.flaky && state.drive.puts === 2) return send(503, {});
      const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(req.headers['content-range'] || '');
      assert.equal(Number(m[1]), state.drive.bytes.length, 'chunks arrive in order');
      state.drive.bytes = Buffer.concat([state.drive.bytes, body]);
      if (state.drive.bytes.length < Number(m[3])) return send(308, undefined, { range: `bytes=0-${state.drive.bytes.length - 1}` });
      return send(200, { id: 'drive-file-1', name: state.drive.metadata.name });
    }
    if (url.pathname.startsWith('/dbx/')) {
      const endpoint = url.pathname.slice(5);
      state.dropbox.auth.push(req.headers.authorization);
      if (fault.auth) return send(401, { error: 'bad' });
      if (fault.down) { req.socket.destroy(); return; }
      const arg = JSON.parse(req.headers['dropbox-api-arg'] || '{}');
      state.dropbox.calls.push(endpoint);
      if (endpoint === 'files/upload') { state.dropbox.files.set(arg.path, body); return send(200, { name: arg.path.split('/').pop(), path_display: arg.path }); }
      if (endpoint === 'files/upload_session/start') { state.dropbox.sessions.set('s1', [body]); return send(200, { session_id: 's1' }); }
      if (endpoint === 'files/upload_session/append_v2') { const parts = state.dropbox.sessions.get(arg.cursor.session_id); assert.equal(arg.cursor.offset, parts.reduce((n, p) => n + p.length, 0)); parts.push(body); return send(200, {}); }
      if (endpoint === 'files/upload_session/finish') { const parts = state.dropbox.sessions.get(arg.cursor.session_id); parts.push(body); state.dropbox.files.set(arg.commit.path, Buffer.concat(parts)); return send(200, { name: arg.commit.path.split('/').pop(), path_display: arg.commit.path }); }
    }
    send(404, {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { state, base, close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }), env: { GDRIVE_UPLOAD_URL: `${base}/drive`, DROPBOX_CONTENT_URL: `${base}/dbx`, GOOGLE_TOKEN_URL: `${base}/token`, DROPBOX_TOKEN_URL: `${base}/token` } };
}

test('destination Google Drive: uploads the archive, in order, to the chosen folder; the token is never stored or returned', async () => {
  const cloud = await fakeCloud();
  const s = await h.setup({ r2: false, env: cloud.env });
  try {
    await seed(s);
    const r = await h.startBackup(s.backend, s.admin, P, { type: 'both', data: 'content', media: true, destination: 'gdrive', auth: { accessToken: 'ya29.USER-TYPED-TOKEN', folderId: 'folder123' } });
    assert.equal(r.job.status, 'done', JSON.stringify(r.job.errors));
    assert.deepEqual(cloud.state.drive.metadata.parents, ['folder123']);
    assert.ok(cloud.state.drive.bytes.length === r.job.result.size && h.sha(cloud.state.drive.bytes) === r.job.result.sha256, 'Drive holds the identical archive');
    assert.ok(cloud.state.drive.auth.every(a => a === 'Bearer ya29.USER-TYPED-TOKEN'));
    assert.equal(r.job.result.destination.destination, 'gdrive');
    assert.ok(r.job.steps.some(st => st.key === 'upload' && st.status === 'done'));
    const entries = await h.readZip(cloud.state.drive.bytes);
    assert.ok(entries.names.includes('manifest.json'));
    const everything = JSON.stringify(r) + fs.readdirSync(path.join(s.backupDir, 'jobs')).map(f => fs.readFileSync(path.join(s.backupDir, 'jobs', f), 'utf8')).join('');
    assert.ok(!everything.includes('USER-TYPED-TOKEN'), 'the typed token is neither returned nor written to disk');
    const poll = await h.call(s.backend, `${P}/jobs/${r.job.id}`, { headers: s.admin });
    assert.ok(!JSON.stringify(poll.body).includes('USER-TYPED-TOKEN'));
  } finally { s.cleanup(); await cloud.close(); }
});

test('destination Dropbox: single upload for a small archive, upload session for a large one, refresh-token flow, folder name sanitised', async () => {
  const cloud = await fakeCloud();
  const s = await h.setup({ r2: false, env: { ...cloud.env, DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', DROPBOX_REFRESH_TOKEN: 'r', BACKUP_UPLOAD_CHUNK: String(256 * 1024), BACKUP_DROPBOX_SINGLE_BYTES: String(200 * 1024) } });
  try {
    await seed(s);
    assert.equal((await h.call(s.backend, `${P}/capabilities`, { headers: s.admin })).body.destinations.dropbox.serverConfigured, true);
    const small = await h.startBackup(s.backend, s.admin, P, { type: 'db', data: 'content', media: false, destination: 'dropbox', auth: { folder: 'My: backups' } });
    assert.equal(small.job.status, 'done', JSON.stringify(small.job.errors));
    assert.deepEqual(cloud.state.dropbox.calls, ['files/upload']);
    const [file, bytes] = [...cloud.state.dropbox.files][0];
    assert.ok(file.startsWith('/My_ backups/dwira-default-db-'), file);
    assert.equal(h.sha(bytes), small.job.result.sha256);
    assert.equal(cloud.state.tokenCalls, 1, 'the server refresh token was exchanged for an access token');
    assert.ok(cloud.state.dropbox.auth.every(a => a === 'Bearer refreshed-token'));
    // a larger archive goes through an upload session (limits lowered through the environment, same code path as 100 MB / 8 MB in production)
    cloud.state.dropbox.calls.length = 0; cloud.state.dropbox.files.clear();
    const noise = crypto.randomBytes(900 * 1024);
    await s.db.query("INSERT INTO media(id,mime,data,created_at,tenant_id,body,size,storage) VALUES($1,'image/png','',1,'default',$2,$3,'db')", ['a'.repeat(32), Buffer.concat([h.pngBytes(0), noise]), noise.length + 8]);
    const big = await h.startBackup(s.backend, s.admin, P, { type: 'db', data: 'content', media: true, destination: 'dropbox', auth: {} });
    assert.equal(big.job.status, 'done', JSON.stringify(big.job.errors));
    assert.equal(cloud.state.dropbox.calls[0], 'files/upload_session/start');
    assert.ok(cloud.state.dropbox.calls.includes('files/upload_session/append_v2'), 'several chunks');
    assert.equal(cloud.state.dropbox.calls.at(-1), 'files/upload_session/finish');
    assert.equal(h.sha([...cloud.state.dropbox.files][0][1]), big.job.result.sha256, 'reassembled archive is identical');
  } finally { s.cleanup(); await cloud.close(); }
});

test('destination errors are reported clearly, the local archive stays downloadable, transient errors are retried', async () => {
  const bad = await fakeCloud({ auth: true });
  let s = await h.setup({ r2: false, env: bad.env });
  try {
    await seed(s);
    for (const [destination, code] of [['gdrive', 'DESTINATION_AUTH'], ['dropbox', 'DESTINATION_AUTH']]) {
      const r = await h.startBackup(s.backend, s.admin, P, { type: 'db', data: 'content', media: false, destination, auth: { accessToken: 'tok-0123456789-abcdef' } });
      assert.equal(r.job.status, 'error'); assert.equal(r.job.errors[0].code, code); assert.equal(r.job.errors[0].destination, destination);
      assert.equal(r.job.canDownload, true, 'the archive was built: it can still be downloaded');
      assert.equal((await h.download(s.backend, s.admin, P, r.job.id)).status, 200);
    }
    const none = await h.call(s.backend, `${P}/jobs`, { method: 'POST', headers: s.admin, body: { type: 'db', destination: 'gdrive', auth: {} } });
    const nj = await h.finish(s.backend, s.admin, P, none.body.job.id);
    assert.equal(nj.errors[0].code, 'DESTINATION_NOT_CONFIGURED', 'no token typed and none configured on the server');
  } finally { s.cleanup(); await bad.close(); }
  const flaky = await fakeCloud({ flaky: true });
  s = await h.setup({ r2: false, env: { ...flaky.env, BACKUP_UPLOAD_CHUNK: String(256 * 1024) } });
  try {
    await seed(s);
    const r = await h.startBackup(s.backend, s.admin, P, { type: 'db', data: 'content', media: false, destination: 'gdrive', auth: { accessToken: 'tok' } });
    assert.equal(r.job.status, 'done', JSON.stringify(r.job.errors));
  } finally { s.cleanup(); await flaky.close(); }
  const down = await fakeCloud({ down: true });
  s = await h.setup({ r2: false, env: down.env });
  try {
    await seed(s);
    const r = await h.startBackup(s.backend, s.admin, P, { type: 'db', data: 'content', media: false, destination: 'dropbox', auth: { accessToken: 'tok' } });
    assert.equal(r.job.status, 'error'); assert.equal(r.job.errors[0].code, 'DESTINATION_UNREACHABLE');
  } finally { s.cleanup(); await down.close(); }
});

test('leak guard: a secret that slips into an entry stops the job with SECRET_LEAK, no archive is offered, the server keeps running', async () => {
  const s = await h.setup({ r2: false });
  try {
    await seed(s);
    // the model key is a known secret; paste it into a public text field so it would end up in db/data/content_items.ndjson
    await h.call(s.backend, '/api/admin/content/roomTypes/room_t1', { method: 'PUT', headers: s.admin, body: { title: { fr: 'sk-model-SECRET-0123456789', ar: 'A', dar: 'A' }, order: 99, visible: true } });
    const r = await h.startBackup(s.backend, s.admin, P, { type: 'db', data: 'content', media: false });
    assert.equal(r.job.status, 'error');
    assert.equal(r.job.errors[0].code, 'SECRET_LEAK');
    assert.equal(r.job.canDownload, false);
    assert.deepEqual(fs.readdirSync(path.join(s.backupDir, 'files')), [], 'no archive left behind');
    assert.equal((await h.call(s.backend, `${P}/capabilities`, { headers: s.admin })).status, 200, 'the server is still serving');
  } finally { s.cleanup(); }
});

// ------------------------------------------------------------------------------------------------ super admin
test('super admin: platform backup (all stores + platform tables) and restore, per-store backup, audit trail', async () => {
  const s = await h.setup({ r2: false });
  try {
    await seed(s);
    const S = await superLogin(s.backend);
    const SP = '/api/super-admin/backup';
    const shop = await newShop(s.backend, S, 'platshop');
    await h.call(s.backend, `/${shop.slug}/api/admin/content/roomTypes/room_shop`, { method: 'PUT', headers: shop.headers, body: { title: { fr: 'SHOP-ROW', ar: 'A', dar: 'A' }, order: 1, visible: true } });
    await s.db.query("INSERT INTO saas_apis(id,kind,provider,label,api_key,created_at,updated_at) VALUES('api_t1','image','x','Label','sk-platform-API-SECRET-999',1,1)");
    const caps = await h.call(s.backend, `${SP}/capabilities`, { headers: S });
    assert.equal(caps.status, 200); assert.equal(caps.body.scope, 'platform'); assert.deepEqual(caps.body.types, ['app', 'db', 'both', 'media']);
    // platform backup: every store, platform tables, the app
    const made = await backup(s, { type: 'both', data: 'content', media: true }, SP, S);
    const m = JSON.parse((await made.entries.read('manifest.json')).toString());
    assert.equal(m.scope, 'platform');
    assert.ok(made.entries.names.includes('db/data/saas_tenants.ndjson'));
    const all = (await Promise.all(made.entries.names.map(async n => (await made.entries.read(n)).toString('latin1')))).join('\n');
    assert.ok(all.includes('SHOP-ROW') && all.includes('ORIGINAL') && all.includes('Client One'), 'every store is in the platform backup');
    assert.ok(!all.includes('sk-platform-API-SECRET-999') && !all.includes('sk-model-SECRET'), 'platform API keys are never exported');
    assert.ok(!(await made.entries.read('db/data/saas_apis.ndjson')).toString().includes('api_key'));
    // damage everything, restore
    await h.call(s.backend, `/${shop.slug}/api/admin/content/roomTypes/room_shop`, { method: 'PUT', headers: shop.headers, body: { title: { fr: 'CHANGED-SHOP', ar: 'A', dar: 'A' }, order: 1, visible: true } });
    await s.db.query("DELETE FROM clients WHERE id='cl_t1'");
    await s.db.query("UPDATE saas_apis SET api_key='sk-platform-NEW-KEY-123456' WHERE id='api_t1'");
    fs.writeFileSync(path.join(s.appRoot, 'server/index.js'), '// CHANGED');
    const res = await restoreZip(s, made.zip, { mediaTarget: 'app' }, SP, S);
    assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors));
    assert.deepEqual(await clients(s), ['cl_t1']);
    const shopContent = await h.call(s.backend, `/${shop.slug}/api/content`);
    assert.equal(shopContent.body.collections.roomTypes.find(x => x.id === 'room_shop')?.title.fr, 'SHOP-ROW');
    assert.equal(fs.readFileSync(path.join(s.appRoot, 'server/index.js'), 'utf8'), '// server v1');
    assert.equal((await s.db.query("SELECT api_key FROM saas_apis WHERE id='api_t1'"))[0].api_key, 'sk-platform-NEW-KEY-123456', 'the current platform API key is kept');
    // the platform owner and the shop administrators can still sign in
    assert.equal((await h.call(s.backend, '/api/super-admin/login', { method: 'POST', headers: h.native, body: { email: 'superadmin', password: 'superadmin' } })).status, 200);
    assert.equal((await h.call(s.backend, `/${shop.slug}/api/admin/session`, { headers: shop.headers })).status, 200, 'sessions of the stores survive');
    // per-store backup from the console: db only, that store only
    const SS = `/api/super-admin/tenants/${shop.tenant.id}/backup`;
    const one = await backup(s, { type: 'both', data: 'content', media: false }, SS, S);
    const oneAll = (await Promise.all(one.entries.names.map(async n => (await one.entries.read(n)).toString('latin1')))).join('\n');
    assert.ok(oneAll.includes('SHOP-ROW') && !oneAll.includes('Client One'), 'only that store');
    assert.equal((await h.call(s.backend, `${SS}/jobs`, { method: 'POST', headers: S, body: { type: 'app' } })).status, 202, 'a store "app" backup is its design, never server files');
    assert.equal((await h.call(s.backend, '/api/super-admin/tenants/nope/backup/capabilities', { headers: S })).status, 404);
    // a store backup cannot be restored as a platform backup and vice versa
    const wrong = await h.upload(s.backend, S, SP, one.zip);
    assert.equal(wrong.job.status, 'error'); assert.equal(wrong.job.errors[0].code, 'SCOPE_MISMATCH');
    // audit trail, without secrets
    const audit = (await h.call(s.backend, '/api/super-admin/audit', { headers: S })).body.map(r => r.action);
    for (const a of ['backup.start', 'backup.download', 'restore.start']) assert.ok(audit.includes(a), a);
  } finally { s.cleanup(); }
});
