/**
 * Free-tier monitor (server/limits.js): the rules (levels, forecast, backup reserve, who gets told and when), the Neon and Cloudflare readers
 * against fake providers, delivery failures, and the super admin routes through the real request handler.
 *   node --test scripts/check-limits-server.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { hashPassword } = require('../server/admins');
const { createLimits, cleanSettings, evaluate, decide, decideAutoBackup, noticeOf, noticeOfAutoBackup, projectExhaustion, classifyR2Action, monthWindow, DEFAULTS, PLAN_LIMITS } = require('../server/limits');
const { createNotices } = require('../server/notices');
const { freshDb, closeShared } = require('./test-db');

const DAY = 86400000, HOUR = 3600000, GB = 1e9;
const SUPER = { email: 'boss@platform.test', password: 'Platform-Secret-123' };
const ENV = { CHAT_RATE_LIMIT: '2000', PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', STATIC_DIR: path.join(__dirname, 'no-such-dist'), SUPERADMIN_EMAIL: SUPER.email, SUPERADMIN_PASSWORD_HASH: hashPassword(SUPER.password) };
test.after(closeShared);

const settings = (extra = {}) => cleanSettings(extra);
const metric = (id, used, extra = {}) => ({ id, service: id.startsWith('neon') ? 'neon' : 'cloudflare', unit: 'bytes', effect: 'writes', blocksBackup: false, used, limit: PLAN_LIMITS[id], limitSource: 'plan', status: 'ok', error: '', needs: [], source: 'measured', resetsAt: null, periodStart: null, backupCost: null, ...extra });
const NOW = Date.UTC(2026, 10, 20, 12);

// ---------------------------------------------------------------- rules

test('settings: thresholds stay in order, bad values are refused, overrides can be cleared', () => {
  assert.equal(settings().warnAt, 70);
  assert.throws(() => settings({ warnAt: 90, urgentAt: 85 }), /INVALID_LIMIT/);
  assert.throws(() => settings({ warnAt: 5 }), /INVALID_LIMIT/);
  assert.throws(() => settings({ autoBackupTo: 'ftp' }), /INVALID_LIMIT/);
  assert.equal(settings().autoBackupTo, 'auto');
  assert.equal(settings({ autoBackupTo: 'dropbox' }).autoBackupTo, 'dropbox');
  assert.equal(settings({ email: 'old@x.test' }).email, undefined, 'the e-mail setting is gone');
  assert.throws(() => settings({ limits: { 'neon.storage': -1 } }), /INVALID_LIMIT/);
  const withLimit = settings({ limits: { 'neon.storage': 5 * GB, 'unknown.metric': 3 } });
  assert.equal(withLimit.limits['neon.storage'], 5 * GB);
  assert.equal(withLimit.limits['unknown.metric'], undefined);
  assert.equal(cleanSettings({ limits: { 'neon.storage': null } }, withLimit).limits['neon.storage'], undefined);
});

test('levels follow the thresholds, and a full limit is critical', () => {
  const at = pct => evaluate(metric('neon.storage', GB * pct / 100), { settings: settings(), now: NOW });
  assert.equal(at(50).level, 'ok');
  assert.equal(at(70).level, 'warn');
  assert.equal(at(86).level, 'urgent');
  assert.equal(at(96).level, 'critical');
  const full = at(100);
  assert.equal(full.level, 'critical');
  assert.equal(full.exceeded, true);
  assert.equal(evaluate(metric('neon.storage', null, { status: 'needs_setup' }), { settings: settings(), now: NOW }).level, 'ok');
});

test('R2 operations are classified like the price list', () => {
  for (const a of ['PutObject', 'CopyObject', 'ListObjects', 'ListObjectsV2', 'CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload']) assert.equal(classifyR2Action(a), 'A', a);
  for (const a of ['GetObject', 'HeadObject', 'HeadBucket', 'UsageSummary']) assert.equal(classifyR2Action(a), 'B', a);
  for (const a of ['DeleteObject', 'AbortMultipartUpload']) assert.equal(classifyR2Action(a), 'free', a);
  assert.equal(classifyR2Action('SomethingNew'), null);
});

test('forecast: a monthly allowance warns when the pace would exhaust it before the reset, and stays quiet when the reset comes first', () => {
  const month = monthWindow(NOW); // Nov 2026, day 20: 19.5 days in
  const fast = projectExhaustion({ used: 80, limit: 100, now: NOW, periodStart: month.start, resetsAt: month.end });
  assert.ok(fast && fast.days > 3 && fast.days < 6, JSON.stringify(fast)); // 80 in 19.5 days -> 20 more in ~4.9 days
  assert.equal(projectExhaustion({ used: 30, limit: 100, now: NOW, periodStart: month.start, resetsAt: month.end }), null); // would run out in ~45 days: after the reset
  assert.equal(projectExhaustion({ used: 5, limit: 100, now: month.start + HOUR, periodStart: month.start, resetsAt: month.end }), null); // too early to tell
  const calm = settings({ warnAt: 90, urgentAt: 95, criticalAt: 98 }); // thresholds far away: only the pace can raise the level
  const e = evaluate(metric('neon.compute', 75, { limit: 100, unit: 'hours', periodStart: month.start, resetsAt: month.end }), { settings: calm, now: NOW });
  assert.equal(e.pct, 75);
  assert.equal(e.level, 'warn'); // under the thresholds but on track to hit the limit within 7 days (about 6.5)
  assert.deepEqual(e.reasons, ['forecast']);
  assert.equal(evaluate(metric('neon.compute', 75, { limit: 100, periodStart: month.start, resetsAt: month.end }), { settings: { ...calm, forecastDays: 0 }, now: NOW }).level, 'ok');
});

test('forecast: continuous storage uses the growth seen in the recorded samples', () => {
  const series = [{ t: NOW - 10 * DAY, v: 0.2 * GB }, { t: NOW - 5 * DAY, v: 0.5 * GB }];
  const p = projectExhaustion({ used: 0.8 * GB, limit: GB, now: NOW, series });
  assert.ok(p && Math.abs(p.days - 3.3) < 0.2, JSON.stringify(p)); // 0.06 GB per day, 0.2 GB left
  assert.equal(projectExhaustion({ used: 0.8 * GB, limit: GB, now: NOW, series: [{ t: NOW - 1 * HOUR, v: 0.7 * GB }] }), null); // sample too recent to extrapolate
  assert.equal(projectExhaustion({ used: 0.8 * GB, limit: GB, now: NOW, series: [{ t: NOW - 5 * DAY, v: 0.8 * GB }] }), null); // not growing
});

test('backup reserve: when what is left of the transfer would not fit a full backup, the level is urgent even at a low percentage', () => {
  const e = evaluate(metric('neon.egress', 4.5 * GB, { effect: 'suspend', blocksBackup: true, backupCost: 0.5 * GB }), { settings: settings(), now: NOW });
  assert.equal(e.pct, 90);
  assert.ok(e.reserve, 'reserve reported');
  assert.equal(e.level, 'urgent');
  const roomy = evaluate(metric('neon.egress', 3.9 * GB, { effect: 'suspend', blocksBackup: true, backupCost: 0.2 * GB }), { settings: settings(), now: NOW });
  assert.equal(roomy.reserve, null);
  assert.equal(roomy.level, 'warn');
  // A database so big that even a fresh month could not hold a backup shows the reserve problem as soon as it is within 1.5x.
  const tight = evaluate(metric('neon.egress', 2 * GB, { effect: 'suspend', blocksBackup: true, backupCost: 2.1 * GB }), { settings: settings(), now: NOW });
  assert.equal(tight.level, 'urgent');
});

test('announcements: a rise is told once, reminders only from "urgent", calming down re-arms, a failed delivery is retried', () => {
  const s = settings();
  const warn = [{ id: 'neon.storage', level: 'warn' }];
  const urgent = [{ id: 'neon.storage', level: 'urgent' }];
  let r = decide({}, warn, NOW, s);
  assert.deepEqual(r.send.map(x => `${x.id}:${x.level}:${x.why}`), ['neon.storage:warn:rise']);
  assert.equal(decide(r.next, warn, NOW + 3 * DAY, s).send.length, 0); // a plain warning is not repeated
  const up = decide(r.next, urgent, NOW + HOUR, s);
  assert.equal(up.send[0].why, 'rise');
  assert.equal(decide(up.next, urgent, NOW + 5 * HOUR, s).send.length, 0); // before the reminder interval
  assert.equal(decide(up.next, urgent, NOW + 26 * HOUR, s).send[0].why, 'reminder');
  const calm = decide(up.next, warn, NOW + 2 * HOUR, s); // fell back to warn: remembered, nothing sent
  assert.equal(calm.send.length, 0);
  assert.equal(decide(calm.next, urgent, NOW + 3 * HOUR, s).send[0].why, 'rise'); // and a new rise is told again
  assert.equal(decide(up.next, [], NOW + 2 * HOUR, s).next['neon.storage'], undefined); // back to normal: forgotten
  // if the message was not delivered the caller keeps the OLD state, so the same decision repeats
  assert.equal(decide({}, warn, NOW + HOUR, s).send.length, 1);
});

test('the notification carries numbers and a code, never a sentence or a key', () => {
  const e = evaluate(metric('neon.egress', 4.6 * GB, { effect: 'suspend', blocksBackup: true, backupCost: 0.9 * GB, resetsAt: NOW + 10 * DAY }), { settings: settings(), now: NOW });
  const n = noticeOf(e);
  assert.equal(n.code, 'limits.alert');
  assert.equal(n.severity, 'danger');
  assert.equal(n.href, '/super-admin/limits');
  assert.equal(n.params.id, 'neon.egress');
  assert.equal(n.params.pct, 92);
  assert.equal(n.params.reserveNeed, 0.9 * GB);
  assert.equal(noticeOf(evaluate(metric('neon.storage', GB * 0.75), { settings: settings(), now: NOW })).severity, 'warn');
  const good = noticeOfAutoBackup({ ok: true, ids: ['neon.storage'], name: 'x-limit.zip', destination: 'gdrive' });
  assert.deepEqual([good.code, good.severity, good.params.destination], ['backup.auto.done', 'ok', 'gdrive']);
  const bad = noticeOfAutoBackup({ ok: false, ids: ['r2.storage'], error: 'R2_OFFLINE' });
  assert.deepEqual([bad.code, bad.severity, bad.params.error], ['backup.auto.failed', 'danger', 'R2_OFFLINE']);
});

// ---------------------------------------------------------------- the service with fake providers

const neonBody = (extra = {}) => ({ project: { compute_time_seconds: 3600 * 40, data_transfer_bytes: 1 * GB, consumption_period_start: new Date(NOW - 10 * DAY).toISOString(), consumption_period_end: new Date(NOW + 20 * DAY).toISOString(), branch_logical_size_limit_bytes: GB, ...extra } });
const cfBody = (ops, storage) => ({ data: { viewer: { accounts: [{ ops, store: storage }] } } });
const ok = body => ({ ok: true, status: 200, json: async () => body });
const bad = status => ({ ok: false, status, json: async () => ({}) });

async function service({ env = {}, neon = () => ok(neonBody()), cf = () => ok(cfBody([], [])), clock = () => NOW, totals, destinations = { gdrive: false, dropbox: false } } = {}) {
  const db = await freshDb();
  const calls = [];
  const notices = createNotices(db, { clock: () => clock() });
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: (init.headers || {}).Authorization, body: init.body });
    return String(url).includes('neon') ? neon(url, init) : cf(url, init);
  };
  const limits = createLimits({
    db, env: { NEON_API_KEY: 'neon-key-123456', NEON_PROJECT_ID: 'proj-1', DATABASE_URL: 'postgres://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/db', CLOUDFLARE_API_TOKEN: 'cf-token-123456', R2_ACCOUNT_ID: 'acc1', R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b', R2_BUCKET: 'bk', R2_PUBLIC_BASE_URL: 'https://m.test', ...env },
    clock: () => clock(), fetch, notices, destinations: () => destinations,
    mediaTotals: async () => totals ?? { r2: { files: 120, bytes: 3 * GB } },
  });
  // `sent` = the notices raised so far, oldest first (what used to be the e-mails). Refreshed after every check / backup.
  const cache = [];
  const refresh = async () => { cache.splice(0, cache.length, ...(await notices.list({ limit: 200 })).notices.reverse()); return cache; };
  const check = limits.check, idle = limits.autoBackupIdle, status = limits.status;
  limits.check = async (...args) => { const r = await check(...args); await refresh(); return r; };
  limits.autoBackupIdle = async () => { await idle(); await refresh(); };
  limits.status = async (...args) => { const r = await status(...args); await refresh(); return r; };
  return { db, limits, calls, notices, refresh, sent: cache };
}

test('reads Neon and Cloudflare, applies the plan limits, and shows each number with its source', async () => {
  const ops = [{ dimensions: { actionType: 'PutObject' }, sum: { requests: 400000 } }, { dimensions: { actionType: 'GetObject' }, sum: { requests: 2000000 } }, { dimensions: { actionType: 'DeleteObject' }, sum: { requests: 9000000 } }];
  const storage = [{ dimensions: { bucketName: 'bk', datetime: 'now' }, max: { payloadSize: 4 * GB, metadataSize: 0, objectCount: 900 } }, { dimensions: { bucketName: 'bk', datetime: 'older' }, max: { payloadSize: 1 * GB, metadataSize: 0, objectCount: 10 } }];
  const s = await service({ cf: () => ok(cfBody(ops, storage)) });
  const snap = await s.limits.check({ force: true });
  const by = Object.fromEntries(snap.metrics.map(m => [m.id, m]));
  assert.equal(by['neon.compute'].used, 40); // 144000 CPU-seconds / 3600
  assert.equal(by['neon.compute'].source, 'neon');
  assert.equal(by['neon.egress'].used, 1 * GB);
  assert.equal(by['neon.storage'].limit, GB);
  assert.equal(by['neon.storage'].limitSource, 'api'); // the storage cap comes from the project itself
  assert.ok(by['neon.storage'].used > 0);
  assert.equal(by['r2.storage'].used, 4 * GB, 'newest row of the bucket, not the sum of its history');
  assert.equal(by['r2.classA'].used, 400000);
  assert.equal(by['r2.classB'].used, 2000000);
  assert.equal(by['r2.classB'].pct, 20);
  assert.equal(snap.services.neon.state, 'on');
  assert.equal(snap.level, 'ok');
  assert.equal(s.calls.find(c => c.url.includes('neon')).auth, 'Bearer neon-key-123456');
  assert.match(s.calls.find(c => c.url.includes('neon')).url, /\/projects\/proj-1$/);
  assert.equal(JSON.parse(s.calls.find(c => !c.url.includes('neon')).body).variables.accountTag, 'acc1');
  assert.equal(s.sent.length, 0, 'nothing to say while everything is low');
  assert.doesNotMatch(JSON.stringify(snap), /neon-key-123456|cf-token-123456|postgres:\/\//, 'no secret in the snapshot');
});

test('without keys the monitor says what to add instead of inventing numbers; R2 storage falls back to the app\'s own file inventory', async () => {
  const s = await service({ env: { NEON_API_KEY: '', NEON_PROJECT_ID: '', CLOUDFLARE_API_TOKEN: '', DB_PROVIDER: 'neon' } });
  const snap = await s.limits.check({ force: true });
  const by = Object.fromEntries(snap.metrics.map(m => [m.id, m]));
  assert.equal(by['neon.compute'].status, 'needs_setup');
  assert.deepEqual(by['neon.compute'].needs, ['NEON_API_KEY', 'NEON_PROJECT_ID']);
  assert.equal(by['neon.compute'].used, null);
  assert.equal(by['r2.classA'].status, 'needs_setup');
  assert.equal(by['r2.storage'].source, 'estimate');
  assert.equal(by['r2.storage'].used, 3 * GB);
  assert.ok(by['neon.storage'].used > 0, 'database size needs no key');
  assert.equal(s.calls.length, 0);
});

test('a service that is switched off or not used is not measured', async () => {
  const off = await service({ env: { NEON_API_KEY: '', NEON_PROJECT_ID: '', CLOUDFLARE_API_TOKEN: '', R2_ACCOUNT_ID: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '', R2_PUBLIC_BASE_URL: '' }, mail: { ok: true } });
  const snap = await off.limits.check({ force: true });
  assert.equal(snap.services.cloudflare.state, 'not_used');
  assert.equal(snap.services.neon.state, 'not_used'); // a local PGlite database is not Neon
  assert.equal(snap.metrics.length, 0);
  const s = await service();
  await s.limits.setSettings({ services: { cloudflare: false } });
  const snap2 = await s.limits.check({ force: true, settingsChanged: true });
  assert.equal(snap2.services.cloudflare.state, 'off');
  assert.ok(!snap2.metrics.some(m => m.id.startsWith('r2.')));
});

test('provider errors are reported per service without failing the others, and a wrong key is called AUTH', async () => {
  const s = await service({ neon: () => bad(401), cf: () => ok(cfBody([], [])) });
  const snap = await s.limits.check({ force: true });
  assert.equal(snap.services.neon.error, 'AUTH');
  assert.equal(snap.metrics.find(m => m.id === 'neon.compute').status, 'error');
  assert.equal(snap.metrics.find(m => m.id === 'neon.storage').status, 'ok', 'the database size is still measured');
  assert.equal(snap.metrics.find(m => m.id === 'r2.classA').status, 'ok');
  const net = await service({ neon: () => { throw new Error('boom'); } });
  assert.equal((await net.limits.check({ force: true })).services.neon.error, 'NETWORK');
  const gql = await service({ cf: () => ok({ errors: [{ message: 'not authorized to access this resource' }] }) });
  assert.equal((await gql.limits.check({ force: true })).services.cloudflare.error, 'AUTH');
});

test('a limit that moves up is announced once; staying there does not repeat; urgent repeats after the reminder interval', async () => {
  let now = NOW, level = 75;
  const s = await service({ clock: () => now, neon: () => ok(neonBody({ data_transfer_bytes: 5 * GB * level / 100 })) });
  await s.limits.setSettings({ forecastDays: 0 }); // the fixed 10-day period would otherwise turn 75 % into an urgent pace warning
  const run = async (step = 0) => { now += step; return s.limits.check({ force: true }); };
  await run();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].code, 'limits.alert');
  assert.equal(s.sent[0].params.id, 'neon.egress');
  assert.equal(s.sent[0].params.level, 'warn');
  assert.equal(s.sent[0].severity, 'warn');
  await run(HOUR); assert.equal(s.sent.length, 1, 'same level, no repeat');
  level = 88; await run(HOUR);
  assert.equal(s.sent.length, 2);
  assert.equal(s.sent[1].params.level, 'urgent');
  assert.equal(s.sent[1].severity, 'danger');
  await run(5 * HOUR); assert.equal(s.sent.length, 2, 'reminder not due yet');
  await run(25 * HOUR); assert.equal(s.sent.length, 3, 'reminder after 24 h');
  assert.equal(s.sent[2].params.why, 'reminder');
  level = 97;
  await run(HOUR); assert.equal(s.sent.length, 4);
  assert.equal(s.sent[3].params.level, 'critical');
  await run(HOUR); assert.equal(s.sent.length, 4, 'and then it is quiet');
  assert.equal((await s.notices.list()).unread, 4);
});

test('the monitor announces its own blindness after 12 hours, once per reminder interval', async () => {
  let now = NOW;
  const s = await service({ clock: () => now, neon: () => bad(500) });
  await s.limits.check({ force: true });
  assert.equal(s.sent.length, 0, 'a short outage is not worth a message');
  now += 13 * HOUR;
  await s.limits.check({ force: true });
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].code, 'limits.blind');
  assert.equal(s.sent[0].params.service, 'neon');
  now += 2 * HOUR;
  await s.limits.check({ force: true });
  assert.equal(s.sent.length, 1);
});

test('the last backup is the newest downloaded platform archive or the newest remote copy; a store backup does not count', async () => {
  const s = await service();
  assert.equal(await s.limits.lastBackupAt(), null);
  await s.db.query("INSERT INTO saas_audit(id,at,actor,action,tenant_id,target,detail) VALUES('a1',$1,'x','backup.download','shop-1','backup','dwira-shop-1-db-20261119.zip'),('a2',$2,'x','backup.download',NULL,'backup','dwira-platform-both-20261110.zip')", [NOW - 1 * DAY, NOW - 10 * DAY]);
  assert.equal(await s.limits.lastBackupAt(), NOW - 10 * DAY);
  await s.limits.noteBackup(NOW - 2 * DAY);
  assert.equal(await s.limits.lastBackupAt(), NOW - 2 * DAY);
});

test('only one instance measures at a time (database lease)', async () => {
  const s = await service();
  const a = s.limits.check({ force: true });
  const b = s.limits.check({ force: true });
  await Promise.all([a, b]);
  assert.equal(s.calls.filter(c => c.url.includes('neon')).length, 1);
});

test('turning the monitor off keeps it silent', async () => {
  const s = await service({ neon: () => ok(neonBody({ data_transfer_bytes: 4.9 * GB })) });
  await s.limits.setSettings({ enabled: false });
  const snap = await s.limits.check({ force: true, settingsChanged: true });
  assert.equal(snap.disabled, true);
  assert.equal(s.sent.length, 0);
  assert.equal(s.calls.length, 0);
});

// ---------------------------------------------------------------- automatic full backup at 90 %

test('auto backup settings: on by default at 90 %, the threshold is 50-100, bad values are refused', () => {
  assert.equal(settings().autoBackup, true);
  assert.equal(settings().autoBackupAt, 90);
  assert.equal(settings({ autoBackup: false }).autoBackup, false);
  assert.equal(settings({ autoBackupAt: 80 }).autoBackupAt, 80);
  assert.throws(() => settings({ autoBackupAt: 20 }), /INVALID_LIMIT/);
  assert.throws(() => settings({ autoBackupAt: 101 }), /INVALID_LIMIT/);
});

test('auto backup decision: off, below, running, waiting, cooldown, limit', () => {
  const items = pct => [metric('neon.storage', 0, { pct: 10 }), metric('r2.storage', 0, { pct })];
  const cfg = settings();
  assert.deepEqual(decideAutoBackup(null, items(89), NOW, cfg), { run: false, why: 'below', hot: [] });
  assert.equal(decideAutoBackup(null, items(95), NOW, settings({ autoBackup: false })).why, 'off');
  const first = decideAutoBackup(null, items(90), NOW, cfg);
  assert.equal(first.run, true);
  assert.deepEqual(first.hot, ['r2.storage']);
  assert.equal(decideAutoBackup({ status: 'running', at: NOW - HOUR }, items(95), NOW, cfg).why, 'running');
  assert.equal(decideAutoBackup({ status: 'running', at: NOW - 4 * HOUR }, items(95), NOW, cfg).run, true, 'a mark of a dead process is ignored');
  assert.equal(decideAutoBackup({ status: 'error', retryAt: NOW + HOUR }, items(95), NOW, cfg).why, 'waiting');
  assert.equal(decideAutoBackup({ status: 'done', lastOkAt: NOW - 2 * HOUR }, items(95), NOW, cfg).why, 'cooldown');
  assert.equal(decideAutoBackup({ status: 'done', lastOkAt: NOW - 25 * HOUR }, items(95), NOW, cfg).run, true);
  const unread = [metric('r2.storage', 0, { pct: 99, status: 'error' })];
  assert.equal(decideAutoBackup(null, unread, NOW, cfg).run, false, 'an unreadable number never triggers');
  assert.equal(decideAutoBackup(null, items(60), NOW, settings({ autoBackupAt: 60 })).run, true, 'the threshold is the owner\'s');
});

const hotCf = pct => () => ok(cfBody([], [{ dimensions: { bucketName: 'bk', datetime: 'now' }, max: { payloadSize: PLAN_LIMITS['r2.storage'] * pct / 100, metadataSize: 0, objectCount: 1 } }]));
async function autoService({ pct = 95, hook, ...rest } = {}) {
  const clockState = { now: NOW };
  const s = await service({ cf: hotCf(pct), clock: () => clockState.now, ...rest });
  const runs = [];
  if (hook !== null) s.limits.setAutoBackup(async args => { runs.push(args); return hook ? hook(args) : { status: 'done', name: 'dwira-limit.zip', destination: 'vault' }; });
  return { ...s, runs, clockState };
}
const tickAuto = async s => { const snap = await s.limits.check({ force: true }); await s.limits.autoBackupIdle(); return snap; };

test('90 %: the monitor starts ONE full backup, tells the owner, and waits a day before the next', async () => {
  const s = await autoService();
  await tickAuto(s);
  assert.equal(s.runs.length, 1);
  assert.deepEqual(s.runs[0].ids, ['r2.storage']);
  assert.equal(s.sent.filter(m => m.code === 'backup.auto.done').length, 1);
  const status = await s.limits.status();
  assert.equal(status.autoBackup.status, 'done');
  assert.equal(status.autoBackup.name, 'dwira-limit.zip');
  s.clockState.now += 2 * HOUR;
  await tickAuto(s);
  assert.equal(s.runs.length, 1, 'still the same day');
  s.clockState.now += 25 * HOUR;
  await tickAuto(s);
  assert.equal(s.runs.length, 2, 'a day later it is still full: another one');
});

test('below the threshold nothing starts; a moved threshold or the off switch is respected', async () => {
  const low = await autoService({ pct: 80 });
  await tickAuto(low);
  assert.equal(low.runs.length, 0);
  await low.limits.setSettings({ autoBackupAt: 75 });
  low.clockState.now += 10000;
  await tickAuto(low);
  assert.equal(low.runs.length, 1, 'threshold lowered to 75: 80 % is now enough');
  const off = await autoService({ pct: 99 });
  await off.limits.setSettings({ autoBackup: false });
  off.clockState.now += 10000;
  await tickAuto(off);
  assert.equal(off.runs.length, 0);
});

test('an R2 limit asks for another destination; Neon (or both) does not', async () => {
  const r2 = await autoService();
  await tickAuto(r2);
  assert.equal(r2.runs[0].avoidR2, true);
  const both = await autoService({ neon: () => ok(neonBody({ branch_logical_size_limit_bytes: 1000 })) });
  await tickAuto(both);
  if (both.runs.length) assert.equal(both.runs[0].avoidR2, !(both.runs[0].ids.some(id => id.startsWith('neon.'))));
});

test('a failed automatic backup is retried after 2 hours and the owner is told once', async () => {
  const s = await autoService({ hook: async () => ({ status: 'error', error: 'R2_OFFLINE' }) });
  await tickAuto(s);
  assert.equal(s.runs.length, 1);
  assert.equal(s.sent.filter(m => m.code === 'backup.auto.failed').length, 1);
  s.clockState.now += HOUR;
  await tickAuto(s);
  assert.equal(s.runs.length, 1, 'not before 2 hours');
  s.clockState.now += 90 * 60000;
  await tickAuto(s);
  assert.equal(s.runs.length, 2, 'retried');
  assert.equal(s.sent.filter(m => m.code === 'backup.auto.failed').length, 1, 'no second notice inside the reminder period');
  assert.equal((await s.limits.status()).autoBackup.status, 'error');
});

test('another backup already running is not a failure: silent, retried in 15 minutes; a throwing hook is INTERNAL', async () => {
  const busy = await autoService({ hook: async () => ({ status: 'error', error: 'BACKUP_BUSY' }) });
  await tickAuto(busy);
  assert.equal(busy.sent.filter(m => m.kind === 'backup').length, 0);
  const state = (await busy.limits.status()).autoBackup;
  assert.equal(state.retryAt - state.finishedAt, 15 * 60000);
  const boom = await autoService({ hook: async () => { throw new Error('secret detail'); } });
  await tickAuto(boom);
  const err = (await boom.limits.status()).autoBackup;
  assert.equal(err.error, 'INTERNAL');
  assert.doesNotMatch(JSON.stringify(err), /secret detail/);
});

test('without a backup service the monitor only warns', async () => {
  const s = await autoService({ hook: null });
  const snap = await tickAuto(s);
  assert.ok(snap.metrics.find(m => m.id === 'r2.storage').pct >= 90);
  assert.equal((await s.limits.status()).autoBackup, null);
});

// ---------------------------------------------------------------- through the real handler

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, socket: { remoteAddress: 'limits-test' } });
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

test('super admin routes: need a session, return the snapshot, save settings, refuse bad input, and never leak a key', async () => {
  const db = await freshDb();
  const backend = createBackend({ env: { ...ENV, NEON_API_KEY: 'neon-key-123456', NEON_PROJECT_ID: 'p1', GDRIVE_ACCESS_TOKEN: 'gd-token-123456' }, db, media: { storage: null, download: async () => { throw new Error('offline'); } } });
  await backend.db.query('select 1');
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  assert.equal((await call(backend, '/api/super-admin/limits')).status, 401);
  const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: SUPER });
  const S = { 'x-super-token': signin.body.token };
  const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { ...S, ...(opts.headers || {}) } });

  const first = await api('/limits');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.ok(Array.isArray(first.body.metrics));
  assert.equal(first.body.settings.warnAt, 70);
  assert.equal(first.body.planLimits['neon.storage'], GB);
  assert.equal(first.body.keys.neonApi, true);
  assert.equal(first.body.delivery, undefined, 'no e-mail delivery any more');
  assert.deepEqual(first.body.destinations, { gdrive: true, dropbox: false });
  assert.equal(first.body.settings.autoBackupTo, 'auto');
  assert.equal(first.body.backupHost, true);
  assert.doesNotMatch(JSON.stringify(first.body), /neon-key-123456|gd-token-123456/);
  assert.equal((await api('/limits/summary')).body.summary.level, first.body.level);
  assert.ok('limits' in (await api('/stats')).body);

  assert.equal((await api('/limits/settings', { method: 'PATCH', body: { warnAt: 95 } })).status, 400);
  assert.equal((await api('/limits/settings', { method: 'PATCH', body: { autoBackupTo: 'ftp' } })).status, 400);
  const saved = await api('/limits/settings', { method: 'PATCH', body: { warnAt: 60, urgentAt: 80, autoBackupTo: 'gdrive', limits: { 'r2.storage': 5 * GB } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.settings.warnAt, 60);
  assert.equal(saved.body.settings.limits['r2.storage'], 5 * GB);
  assert.ok((await api('/audit?limit=20')).body.some(r => r.action === 'limits.settings'));

  assert.equal(saved.body.settings.autoBackupTo, 'gdrive');
  assert.equal((await api('/limits/test', { method: 'POST', body: {} })).status, 404, 'the e-mail test route is gone');

  // The notification centre: test notice, list, mark as read, clear.
  assert.equal((await call(backend, '/api/super-admin/notices')).status, 401);
  assert.equal((await api('/notices/test', { method: 'POST', body: {} })).status, 200);
  const list = await api('/notices');
  assert.equal(list.status, 200);
  assert.equal(list.body.unread >= 1, true);
  assert.equal(list.body.notices.at(-1).code, 'system.test');
  assert.equal((await api('/notices/read', { method: 'POST', body: { ids: 'nope' } })).status, 400);
  assert.equal((await api('/notices/read', { method: 'POST', body: { all: true } })).body.unread, 0);
  assert.equal((await api('/notices/clear', { method: 'POST', body: {} })).status, 200);
  assert.equal((await api('/notices')).body.notices.length, 0);
});
