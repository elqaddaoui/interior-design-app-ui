/**
 * Backup vault (R2 folder "backup/<version>/<all|db|code|media>/"), history, previews, restore from history, encryption, retention, the daily
 * schedule and restores of backups made by a different version of the app. Driven through the real request handler (PGlite).
 *   node --test scripts/check-backup-vault.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const h = require('./backup-harness');
const { closeShared } = require('./test-db');
const { createVault } = require('../server/backup/vault');
const { encryptStream, decryptStream } = require('../server/backup/crypt');
const { bestHour, cleanSettings, createSchedule } = require('../server/backup/schedule');
const { tolerate } = require('../server/backup/dump');

test.after(closeShared);
const SA = '/api/super-admin/backup';
const DAY = 86400000;

async function superAdmin(s) {
  const r = await h.call(s.backend, '/api/super-admin/login', { method: 'POST', headers: h.native, body: { email: 'superadmin', password: 'superadmin' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: String(r.headers['set-cookie'] || '').split(';')[0], ...h.native, ...(r.body.token ? h.bearer(r.body.token) : {}) };
}
async function boot({ vaultEnv = {}, corrupt = false, r2 = true } = {}) {
  const driver = h.memoryDriver({ corrupt });
  const env = { NODE_ENV: 'test', ...vaultEnv };
  const vault = createVault({ storage: driver, env: { ...env } });
  const s = await h.setup({ r2, env, vault });
  s.driver = driver; s.vault = vault;
  s.sa = await superAdmin(s);
  await h.call(s.backend, '/api/admin/content/roomTypes/room_v1', { method: 'PUT', headers: s.admin, body: { title: { fr: 'ORIGINAL', ar: 'A', dar: 'A' }, image: h.pngData(2000, 4), order: 99, visible: true } });
  return s;
}
const run = (s, kind, extra = {}) => h.startBackup(s.backend, s.sa, SA, { kind, destination: 'vault', ...extra });
const keys = s => [...s.driver.objects.keys()].sort();
const titleOf = async s => (await h.call(s.backend, '/api/content')).body.collections.roomTypes.find(x => x.id === 'room_v1')?.title?.fr;

test('encryption: round trip, many records, tamper, truncation, wrong key', async () => {
  const data = crypto.randomBytes(3 * 1024 * 1024 + 17);
  const enc = chunks => pipeline(Readable.from(chunks), encryptStream('a long secret phrase'), new (require('node:stream').Writable)({ write(c, e, cb) { (enc.out ||= []).push(c); cb(); } }));
  enc.out = [];
  await enc([data.subarray(0, 1000), data.subarray(1000)]);
  const sealed = Buffer.concat(enc.out);
  assert.equal(sealed.subarray(0, 5).toString(), 'DWBK1');
  assert.ok(!sealed.includes(data.subarray(500000, 500064)), 'no plain text in the sealed file');
  const open = async (buf, key = 'a long secret phrase') => { const out = []; await pipeline(Readable.from([buf]), decryptStream(key), new (require('node:stream').Writable)({ write(c, e, cb) { out.push(c); cb(); } })); return Buffer.concat(out); };
  assert.ok((await open(sealed)).equals(data));
  await assert.rejects(open(sealed, 'another secret phrase'), /BACKUP_DECRYPT_FAILED/);
  const flipped = Buffer.from(sealed); flipped[sealed.length - 40] ^= 1;
  await assert.rejects(open(flipped), /BACKUP_DECRYPT_FAILED/);
  await assert.rejects(open(sealed.subarray(0, sealed.length - 200)), /BACKUP_DECRYPT_FAILED/);
  await assert.rejects(open(Buffer.from('not encrypted at all, just text')), /BACKUP_NOT_ENCRYPTED/);
});

test('every kind lands in backup/<version>/<kind>/ with a sidecar and a preview; the history lists them', async () => {
  const s = await boot();
  try {
    for (const kind of ['all', 'db', 'code', 'media']) {
      const r = await run(s, kind);
      assert.equal(r.job.status, 'done', JSON.stringify(r.job.errors) + kind);
      assert.equal(r.job.result.destination.destination, 'vault');
      assert.equal(r.job.canDownload, false, 'the working copy is removed once the vault holds the backup');
    }
    const k = keys(s);
    for (const kind of ['all', 'db', 'code', 'media']) {
      assert.equal(k.filter(x => new RegExp(`^backup/v9\\.9\\.9/${kind}/dwira-${kind}-v9\\.9\\.9-\\d{8}-\\d{6}-[0-9a-f]{12}\\.(zip|json|svg)$`).test(x)).length, 3, `${kind}: zip + sidecar + preview in ${k.join(' ')}`);
    }
    assert.ok(k.every(x => x.startsWith('backup/')), 'nothing outside backup/');
    const info = await h.call(s.backend, `${SA}/vault`, { headers: s.sa });
    assert.equal(info.status, 200);
    assert.equal(info.body.items.length, 4);
    assert.deepEqual(info.body.items.map(i => i.kind).sort(), ['all', 'code', 'db', 'media']);
    assert.ok(info.body.items.every(i => i.version === '9.9.9' && /^[a-f0-9]{64}$/.test(i.sha256) && i.size > 0 && i.preview), 'version, hash, size, preview on every item');
    assert.ok(!JSON.stringify(info.body).includes('backup/v9'), 'storage keys are never sent to the browser');
    const all = info.body.items.find(i => i.kind === 'all');
    assert.ok(all.includes.db && all.includes.app && all.includes.media);
    const code = info.body.items.find(i => i.kind === 'code');
    assert.ok(code.includes.app && !code.includes.db && !code.includes.media);
    const media = info.body.items.find(i => i.kind === 'media');
    assert.ok(media.includes.media && !media.includes.db && !media.includes.app && media.mediaFiles >= 1);
    // preview
    const pv = await h.call(s.backend, `${SA}/vault/${all.id}/preview`, { headers: s.sa });
    assert.equal(pv.status, 200);
    assert.equal(pv.headers['content-type'], 'image/svg+xml');
    assert.match(pv.headers['content-security-policy'], /default-src 'none'/);
    // not available to a store administrator
    const store = await h.call(s.backend, '/api/admin/backup/vault', { headers: s.admin });
    assert.ok(store.status === 404 || store.status === 400, `store admin: ${store.status}`);
    const anon = await h.call(s.backend, `${SA}/vault`, { headers: h.native });
    assert.equal(anon.status, 401);
  } finally { s.cleanup(); }
});

test('browser screenshot becomes the preview (only real images are accepted)', async () => {
  const s = await boot();
  try {
    const bad = await h.call(s.backend, `${SA}/previews`, { method: 'POST', headers: s.sa, body: { data: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') } });
    assert.equal(bad.status, 400);
    assert.equal((await h.call(s.backend, `${SA}/previews`, { method: 'POST', headers: s.sa, body: { data: 'data:text/html;base64,AAAA' } })).status, 400);
    const ok = await h.call(s.backend, `${SA}/previews`, { method: 'POST', headers: s.sa, body: { data: h.pngData(500, 9) } });
    assert.equal(ok.status, 201);
    const r = await run(s, 'db', { previewId: ok.body.previewId });
    assert.equal(r.job.status, 'done');
    const item = (await h.call(s.backend, `${SA}/vault`, { headers: s.sa })).body.items[0];
    assert.equal(item.preview.source, 'screenshot');
    assert.equal(item.preview.type, 'image/png');
    const pv = await h.call(s.backend, `${SA}/vault/${item.id}/preview`, { headers: s.sa });
    assert.equal(pv.headers['content-type'], 'image/png');
    assert.ok(pv.bytes.equals(h.pngBytes(500, 9)));
  } finally { s.cleanup(); }
});

test('restore from the history: prepare (download + verify), confirm, the app data is back; a safety backup lands in the vault', async () => {
  const s = await boot();
  try {
    const made = await run(s, 'all');
    assert.equal(made.job.status, 'done', JSON.stringify(made.job.errors));
    await h.call(s.backend, '/api/admin/content/roomTypes/room_v1', { method: 'PUT', headers: s.admin, body: { title: { fr: 'CHANGED', ar: 'A', dar: 'A' }, order: 99, visible: true } });
    assert.equal(await titleOf(s), 'CHANGED');
    const item = (await h.call(s.backend, `${SA}/vault`, { headers: s.sa })).body.items[0];
    const prep = await h.call(s.backend, `${SA}/vault/${item.id}/prepare`, { method: 'POST', headers: s.sa, body: {} });
    assert.equal(prep.status, 202, JSON.stringify(prep.body));
    const job = await h.finish(s.backend, s.sa, SA, prep.body.job.id);
    assert.equal(job.status, 'done', JSON.stringify(job.errors));
    assert.deepEqual(job.steps.map(x => x.key), ['download', 'inspect', 'verify']);
    const uploadId = job.options.upload;
    assert.equal(job.result.plan.manifest.kind, 'all');
    const refused = await h.restore(s.backend, s.sa, SA, { uploadId });
    assert.equal(refused.status, 409, 'needs the explicit confirmation');
    const res = await h.restore(s.backend, s.sa, SA, { uploadId, confirm: true, mediaTarget: 'r2' });
    assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors));
    assert.equal(await titleOf(s), 'ORIGINAL');
    assert.ok(res.job.result.safetyBackup.vaultId, 'safety snapshot stored in the vault');
    const after = (await h.call(s.backend, `${SA}/vault`, { headers: s.sa })).body.items;
    assert.ok(after.some(i => i.createdBy === 'pre-restore' && i.kind === 'db'));
    assert.ok(res.job.log.some(l => l.code === 'step.start' && l.step === 'database'), 'the terminal log has step lines');
    assert.ok(res.job.log.every((l, i, a) => i === 0 || l.n > a[i - 1].n), 'log lines are numbered in order');
  } finally { s.cleanup(); }
});

test('encrypted vault: objects are sealed, restore and download still give the plain archive, a lost key is reported', async () => {
  const key = 'correct horse battery staple 42';
  const s = await boot({ vaultEnv: { BACKUP_ENCRYPTION_KEY: key } });
  try {
    const made = await run(s, 'db');
    assert.equal(made.job.status, 'done', JSON.stringify(made.job.errors));
    const zipKey = keys(s).find(x => x.endsWith('.zip.enc'));
    assert.ok(zipKey, 'stored as .zip.enc');
    assert.equal(s.driver.objects.get(zipKey).body.subarray(0, 5).toString(), 'DWBK1');
    const item = (await h.call(s.backend, `${SA}/vault`, { headers: s.sa })).body.items[0];
    assert.equal(item.encrypted, true);
    const dl = await h.call(s.backend, `${SA}/vault/${item.id}/download`, { headers: s.sa });
    assert.equal(dl.status, 200);
    assert.equal(dl.bytes.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004');
    assert.equal(h.sha(dl.bytes), item.sha256);
    await h.call(s.backend, '/api/admin/content/roomTypes/room_v1', { method: 'PUT', headers: s.admin, body: { title: { fr: 'CHANGED', ar: 'A', dar: 'A' }, order: 99, visible: true } });
    const prep = await h.call(s.backend, `${SA}/vault/${item.id}/prepare`, { method: 'POST', headers: s.sa, body: {} });
    const job = await h.finish(s.backend, s.sa, SA, prep.body.job.id);
    assert.equal(job.status, 'done', JSON.stringify(job.errors));
    assert.equal((await h.restore(s.backend, s.sa, SA, { uploadId: job.options.upload, confirm: true })).job.status, 'done');
    assert.equal(await titleOf(s), 'ORIGINAL');
    // the copy of an encrypted object, uploaded by hand, is decrypted with the key
    const up = await h.upload(s.backend, s.sa, SA, s.driver.objects.get(zipKey).body);
    assert.equal(up.job.status, 'done', JSON.stringify(up.job.errors));
  } finally { s.cleanup(); }
  // the same vault without the key
  const solo = createVault({ storage: s.driver, env: { NODE_ENV: 'test' } });
  const found = (await solo.items({ fresh: true }))[0];
  await assert.rejects(solo.fetchTo(found, require('node:path').join(require('node:os').tmpdir(), 'nokey.zip')), /BACKUP_KEY_MISSING/);
});

test('read-back check: a corrupted upload is refused and nothing is left in the bucket', async () => {
  const s = await boot({ corrupt: true });
  try {
    const r = await run(s, 'db');
    assert.equal(r.job.status, 'error');
    assert.equal(r.job.errors[0].code, 'VAULT_VERIFY_FAILED');
    assert.deepEqual(keys(s), [], 'no half-written backup stays');
    assert.equal((await h.call(s.backend, `${SA}/vault`, { headers: s.sa })).body.items.length, 0);
  } finally { s.cleanup(); }
});

test('a backup without its sidecar (unfinished upload) is never listed; it is swept after 6 hours; other bucket content is never touched', async () => {
  const s = await boot();
  try {
    await s.driver.putBuffer('backup/v1.0.0/db/dwira-db-v1.0.0-20200101-000000-abcdefabcdef.zip', Buffer.from('half'));
    await s.driver.putBuffer('media/' + 'a'.repeat(32) + '.png', Buffer.from('a picture'));
    assert.equal((await s.vault.items({ fresh: true })).length, 0);
    s.driver.objects.get('backup/v1.0.0/db/dwira-db-v1.0.0-20200101-000000-abcdefabcdef.zip').at = Date.now() - 7 * 3600000;
    const r = await s.vault.prune({ keepDays: 28 });
    assert.equal(r.orphans, 1);
    assert.deepEqual(keys(s), ['media/' + 'a'.repeat(32) + '.png']);
  } finally { s.cleanup(); }
});

test('retention: older than N days goes, the newest of each kind always stays; the period is editable and validated', async () => {
  const s = await boot();
  try {
    await run(s, 'db'); await run(s, 'db'); await run(s, 'code');
    const metaKeys = keys(s).filter(x => x.endsWith('.json'));
    assert.equal(metaKeys.length, 3);
    // age every backup by 40 days (sidecar createdAt is what counts)
    for (const key of metaKeys) { const o = s.driver.objects.get(key); const m = JSON.parse(o.body); m.createdAt -= 40 * DAY; o.body = Buffer.from(JSON.stringify(m)); }
    s.vault.forget();
    const dry = await h.call(s.backend, `${SA}/vault/prune`, { method: 'POST', headers: s.sa, body: { dryRun: true } });
    assert.equal(dry.body.removed, 1, 'one of the two db backups is expendable, the newest db and the only code backup stay');
    assert.equal(keys(s).filter(x => x.endsWith('.json')).length, 3, 'dry run deletes nothing');
    const real = await h.call(s.backend, `${SA}/vault/prune`, { method: 'POST', headers: s.sa, body: {} });
    assert.equal(real.body.removed, 1);
    assert.equal((await s.vault.items({ fresh: true })).length, 2);
    // a longer period keeps everything
    const wide = await s.vault.prune({ keepDays: 60 });
    assert.equal(wide.removed, 0);
    const set = await h.call(s.backend, `${SA}/vault/settings`, { method: 'PATCH', headers: s.sa, body: { retentionDays: 14, kinds: ['all', 'db'], hour: 4 } });
    assert.equal(set.status, 200);
    assert.deepEqual({ d: set.body.settings.retentionDays, k: set.body.settings.kinds, hour: set.body.settings.hour }, { d: 14, k: ['all', 'db'], hour: 4 });
    for (const bad of [{ retentionDays: 0 }, { retentionDays: 1.5 }, { retentionDays: 9999 }, { hour: 24 }, { hour: 'noon' }, { kinds: [] }, { kinds: ['everything'] }]) {
      assert.equal((await h.call(s.backend, `${SA}/vault/settings`, { method: 'PATCH', headers: s.sa, body: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await h.call(s.backend, `${SA}/vault/settings`, { headers: s.sa })).body.settings.retentionDays, 14, 'bad input changed nothing');
  } finally { s.cleanup(); }
});

test('delete from the history removes the archive, its sidecar and its preview', async () => {
  const s = await boot();
  try {
    await run(s, 'db');
    const item = (await h.call(s.backend, `${SA}/vault`, { headers: s.sa })).body.items[0];
    const del = await h.call(s.backend, `${SA}/vault/${item.id}`, { method: 'DELETE', headers: s.sa });
    assert.equal(del.status, 200);
    assert.deepEqual(keys(s), []);
    assert.equal((await h.call(s.backend, `${SA}/vault/${item.id}/prepare`, { method: 'POST', headers: s.sa, body: {} })).status, 404);
  } finally { s.cleanup(); }
});

test('schedule: quiet-hour learning, due logic, settings, and a run that waits for visitors', async () => {
  assert.equal(bestHour([]), 3, 'default 03:00 UTC without data');
  const hist = Array.from({ length: 24 }, (_, hour) => (hour === 14 || hour === 15 ? 0.1 : 50));
  assert.equal(bestHour(hist), 14, 'the quietest two-hour stretch');
  assert.deepEqual(cleanSettings({ retentionDays: 7 }).retentionDays, 7);
  let t = Date.UTC(2026, 5, 10, 3, 5);
  const calls = [];
  const rows = new Map();
  const db = { query: async (sql, params = []) => {
    if (/SELECT value FROM saas_kv/.test(sql)) return rows.has(params[0]) ? [{ value: rows.get(params[0]) }] : [];
    if (/saas_kv.*limits|backup_lock/.test(sql) && /RETURNING/.test(sql)) { const cur = rows.get('backup_lock'); if (cur && Number(cur) > params[1]) return []; rows.set('backup_lock', params[0]); return [{ key: 'backup_lock' }]; }
    if (/INSERT INTO saas_kv/.test(sql)) { rows.set(params[0], params[1]); return []; }
    return [];
  } };
  const fake = { items: [], prune: async () => ({ removed: 2 }) };
  const sched = createSchedule({
    db, now: () => t, vault: fake, supported: () => true, running: () => false, prune: fake.prune,
    startBackup: async input => { calls.push(input.kind); return { id: input.kind }; }, jobStatus: id => ({ status: 'done', errors: [], result: { destination: { name: id } } }),
  });
  await sched.setSettings({ hour: 3, kinds: ['all', 'db'] });
  sched.noteActivity(); // a visitor right now
  assert.equal((await sched.tick()).verdict, 'waiting', 'busy app: waits');
  assert.deepEqual(calls, []);
  t += 11 * 60000; // 10+ minutes of silence
  const ran = await sched.tick();
  assert.equal(ran.verdict, 'ran');
  assert.deepEqual(calls, ['all', 'db']);
  assert.equal((await sched.tick()).verdict, 'not-due', 'once a day');
  t += DAY; sched.noteActivity();
  t += 6 * 3600000 + 60000; // still "busy"? no: silence for hours, so it runs; but force the 6 h rule too
  assert.equal(sched.decide({ settings: await sched.getSettings(), state: { lastDay: '2026-06-10', lastAt: t - DAY }, hist: Array(24).fill(null), t }), 'run');
  await sched.setSettings({ enabled: false });
  assert.equal(sched.decide({ settings: await sched.getSettings(), state: {}, hist: [], t }), 'off');
  const st = await sched.status();
  assert.equal(st.settings.enabled, false);
});

test('older / different backups restore: unknown tables skipped, new required columns filled, newer format refused', async () => {
  const s = await boot();
  try {
    // build a backup by hand: an extra table this version does not have, a row missing a column the schema now requires
    const made = await h.startBackup(s.backend, s.sa, SA, { kind: 'db', destination: 'local' });
    assert.equal(made.job.status, 'done');
    const real = await h.download(s.backend, s.sa, SA, made.job.id);
    const entries = await h.readZip(real.bytes);
    const files = new Map();
    for (const n of entries.names) if (n !== 'manifest.json') files.set(n, await entries.read(n));
    const tables = JSON.parse(files.get('db/tables.json'));
    tables.tables.legacy_widgets = { columns: ['id'], rows: 1 };
    files.set('db/tables.json', Buffer.from(JSON.stringify(tables)));
    files.set('db/data/legacy_widgets.ndjson', Buffer.from('{"id":"w1"}\n'));
    const manifest = JSON.parse(await entries.read('manifest.json'));
    manifest.appVersion = '0.1.0';
    const zip = await new Promise(resolve => {
      const z = new yazl.ZipFile(); const out = [];
      const list = [];
      for (const [name, body] of files) { z.addBuffer(body, name); list.push({ path: name, size: body.length, sha256: h.sha(body) }); }
      manifest.files = list;
      z.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
      z.outputStream.on('data', c => out.push(c)).on('end', () => resolve(Buffer.concat(out)));
      z.end();
    });
    const up = await h.upload(s.backend, s.sa, SA, zip);
    assert.equal(up.job.status, 'done', JSON.stringify(up.job.errors));
    const codes = up.job.warnings.map(w => w.code);
    assert.ok(codes.includes('TABLES_SKIPPED'), codes.join());
    assert.ok(up.job.result.plan.warnings.some(w => w.code === 'VERSION_DIFFERS' && w.from === '0.1.0' && w.to === '9.9.9'));
    const res = await h.restore(s.backend, s.sa, SA, { uploadId: up.id, confirm: true });
    assert.equal(res.job.status, 'done', JSON.stringify(res.job.errors));
    // tolerate() unit: names are still validated
    assert.throws(() => tolerate({ tables: { 'bad;name': { columns: ['a'], rows: 0 } } }, false), /ARCHIVE_INVALID_DB/);
    assert.deepEqual(tolerate({ tables: { nothing_here: { columns: ['a'], rows: 0 } } }, false).skipped, ['nothing_here']);
  } finally { s.cleanup(); }
});

test('restore of code undoes itself when it fails half way', async () => {
  const appFiles = require('../server/backup/app-files');
  const fs = require('node:fs'), path = require('node:path');
  const root = h.tmp('undo-root-'), stage = h.tmp('undo-stage-'), undo = h.tmp('undo-keep-');
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server', 'index.js'), 'OLD');
  fs.mkdirSync(path.join(stage, 'server'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'server', 'index.js'), 'NEW');
  // the second file is missing from the stage: the copy fails after the first one was replaced
  await assert.rejects(appFiles.applyStage(stage, root, ['server/index.js', 'server/other.js'], undo));
  assert.equal(fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8'), 'OLD', 'the first file was put back');
  assert.ok(!fs.existsSync(path.join(root, 'server', 'other.js')));
});
