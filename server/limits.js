/**
 * Free-tier watch for the platform owner: how close are the Neon database and the Cloudflare R2 bucket to their free limits, and is
 * there still time to save every byte of data before a service is restricted?
 *
 *   What is measured, and where it comes from
 *   - Neon database size ........ this server, `pg_database_size()` (no key needed).
 *   - Neon compute hours, egress  Neon API, GET /projects/{id} (NEON_API_KEY + NEON_PROJECT_ID). Also the plan's storage cap
 *                                 (`branch_logical_size_limit_bytes`) and the day the monthly allowance resets.
 *   - R2 storage + Class A / B .. Cloudflare GraphQL Analytics (CLOUDFLARE_API_TOKEN with "Account Analytics: Read"; the account id is
 *                                 R2_ACCOUNT_ID). Without a token the storage is estimated from the files the app knows about and the
 *                                 operation counters say so ("needs setup") instead of showing a made-up number.
 *
 *   Why the warnings are early
 *   - Thresholds (default 70 % warn, 85 % "back up now", 95 % critical).
 *   - Forecast: at the pace of this month (or of the last days for storage) the limit would be reached within N days.
 *   - Backup reserve: on Neon, running out of compute or transfer SUSPENDS the database and even a dump fails, and a backup itself
 *     reads the whole database (= transfer). So "back up now" also fires when the transfer left is less than 1.5 x the database size.
 *
 *   Notification rules (see `decide`): an e-mail / webhook message whenever a limit moves UP a level, a reminder every
 *   `reminderHours` while a limit stays at "back up now" or worse, and a notice when the monitor itself has been blind for 12 hours.
 *   A failed delivery is never recorded as sent, so the next check tries again.
 *
 *   Automatic backup: when ANY measured limit reaches `autoBackupAt` (default 90 %), the monitor starts one FULL backup (database, code and
 *   files) by itself, through the backup service (`setAutoBackup`, wired in server/index.js). It runs in the background, never twice at the
 *   same time, at most once per day (a failed or refused attempt is retried later), and the owner is told by e-mail what happened. When the
 *   stressed provider is R2 and Google Drive / Dropbox is configured on the server, the copy goes there instead of into the R2 vault.
 *
 * The module never stores or returns a secret (only whether each variable is set) and never calls out while the console is idle:
 * `tick` is cheap, `check` is throttled and guarded by a database lease so several serverless instances do not send twice.
 * Limits change: every plan value below is a default that the owner can override in the console.
 */
const { detectProvider } = require('./backup/dump');
const { r2Status } = require('./media');

const MIN = 60000;
const HOUR = 3600000;
const DAY = 86400000;
const GB = 1e9; // the stricter reading of "GB": warns a little earlier than a 2^30 reading would
const LEVELS = ['ok', 'warn', 'urgent', 'critical'];
const rank = level => Math.max(0, LEVELS.indexOf(level));
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Free-plan values (Neon pricing / Cloudflare R2 pricing pages, November 2026). Every one can be overridden in the console. */
const PLAN_LIMITS = {
  'neon.storage': 1 * GB,
  'neon.compute': 100, // CU-hours per month
  'neon.egress': 5 * GB,
  'r2.storage': 10 * GB,
  'r2.classA': 1000000,
  'r2.classB': 10000000,
};
const METRICS = {
  'neon.storage': { service: 'neon', unit: 'bytes', effect: 'writes', blocksBackup: false },
  'neon.compute': { service: 'neon', unit: 'hours', effect: 'suspend', blocksBackup: true },
  'neon.egress': { service: 'neon', unit: 'bytes', effect: 'suspend', blocksBackup: true },
  'r2.storage': { service: 'cloudflare', unit: 'bytes', effect: 'billing', blocksBackup: false },
  'r2.classA': { service: 'cloudflare', unit: 'count', effect: 'billing', blocksBackup: false },
  'r2.classB': { service: 'cloudflare', unit: 'count', effect: 'billing', blocksBackup: false },
};
const LABELS = {
  'neon.storage': 'Neon database storage', 'neon.compute': 'Neon compute hours', 'neon.egress': 'Neon network transfer',
  'r2.storage': 'R2 file storage', 'r2.classA': 'R2 write operations (Class A)', 'r2.classB': 'R2 read operations (Class B)',
};
const EFFECTS = {
  writes: 'when it is full, writes fail until you free space or upgrade (reading and backups still work)',
  suspend: 'when it runs out, the database is SUSPENDED until the next period and cannot be backed up',
  billing: 'above the free amount the service keeps working and Cloudflare starts charging you',
};

const AUTO_COOLDOWN = DAY;            // after a good automatic backup, the next one waits a day
const AUTO_RETRY = 2 * HOUR;          // a failed one is retried after this
const AUTO_BUSY_RETRY = 15 * MIN;     // another backup was running: try again soon
const AUTO_STALE = 3 * HOUR;          // a "running" mark older than this belongs to a process that died
const DEFAULTS = {
  enabled: true,
  autoBackup: true, autoBackupAt: 90, // full backup by itself when any limit reaches this % (50-100)
  email: '', // empty = the address of the API warnings (usage settings, ALERT_EMAIL, first super admin)
  warnAt: 70, urgentAt: 85, criticalAt: 95,
  forecastDays: 7, // 0 = no forecast
  reminderHours: 24,
  services: { neon: true, cloudflare: true },
  limits: {}, // overrides only: { 'neon.storage': bytes, ... }
};

/** A sanitised settings object: unknown fields dropped, numbers clamped, thresholds kept in order. */
function cleanSettings(input, base = DEFAULTS) {
  const out = JSON.parse(JSON.stringify(base));
  const src = input && typeof input === 'object' ? input : {};
  if (src.enabled !== undefined) out.enabled = src.enabled === true;
  if (src.email !== undefined) {
    const email = String(src.email || '').trim().slice(0, 254);
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) throw fail(400, 'INVALID_EMAIL');
    out.email = email;
  }
  if (src.autoBackup !== undefined) out.autoBackup = src.autoBackup === true;
  const whole = (value, min, max) => { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw fail(400, 'INVALID_LIMIT'); return n; };
  for (const [key, min, max] of [['warnAt', 10, 99], ['urgentAt', 11, 99], ['criticalAt', 12, 100], ['forecastDays', 0, 60], ['reminderHours', 1, 168], ['autoBackupAt', 50, 100]]) if (src[key] !== undefined) out[key] = whole(src[key], min, max);
  if (!(out.warnAt < out.urgentAt && out.urgentAt < out.criticalAt)) throw fail(400, 'INVALID_LIMIT');
  if (src.services && typeof src.services === 'object') for (const key of ['neon', 'cloudflare']) if (src.services[key] !== undefined) out.services[key] = src.services[key] === true;
  if (src.limits && typeof src.limits === 'object') {
    for (const id of Object.keys(PLAN_LIMITS)) {
      if (!(id in src.limits)) continue;
      const raw = src.limits[id];
      if (raw === null || raw === '') { delete out.limits[id]; continue; }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0 || n > 1e15) throw fail(400, 'INVALID_LIMIT');
      out.limits[id] = n;
    }
  }
  return out;
}

// ---------------------------------------------------------------- pure helpers (unit tested)

/** Which R2 price class an operation of the analytics dataset belongs to: 'A', 'B', 'free' or null (unknown, not counted). */
function classifyR2Action(name) {
  const action = String(name || '');
  if (/^(Delete|Abort)/.test(action)) return 'free';
  if (/^(Get|Head|UsageSummary)/.test(action)) return 'B';
  if (/^(Put|Copy|Create|Complete|Upload|List|Lifecycle)/.test(action)) return 'A';
  return null;
}
/** The calendar month (UTC) that contains `now`: R2's free allowance is monthly. */
function monthWindow(now) {
  const d = new Date(now);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}
/**
 * When would `used` reach `limit` at the current pace? Monthly allowances (periodStart + resetsAt known) use the pace since the period
 * began and only count when the limit would be hit BEFORE the reset; a continuous one (storage) uses the growth seen in `series`.
 * Returns { at, days } or null (no growth, too little data, or the reset comes first).
 */
function projectExhaustion({ used, limit, now, periodStart = null, resetsAt = null, series = [] }) {
  if (!(limit > 0) || !(used >= 0)) return null;
  if (used >= limit) return { at: now, days: 0 };
  let rate = 0; // units per day
  if (periodStart != null && resetsAt != null) {
    const elapsed = (now - periodStart) / DAY;
    if (elapsed < 1 || used <= 0) return null;
    rate = used / elapsed;
  } else {
    const first = series.filter(p => now - p.t <= 14 * DAY && now - p.t >= 12 * HOUR).sort((a, b) => a.t - b.t)[0];
    if (!first) return null;
    rate = (used - first.v) / ((now - first.t) / DAY);
  }
  if (!(rate > 0)) return null;
  const days = (limit - used) / rate;
  const at = now + days * DAY;
  if (resetsAt != null && at >= resetsAt) return null;
  return { at: Math.round(at), days: Math.round(days * 10) / 10 };
}
/** One measured metric -> the same metric with its percentage, level, reasons, forecast and backup reserve. */
function evaluate(metric, { settings, now, series = [] }) {
  const out = { ...metric, pct: null, level: 'ok', reasons: [], exceeded: false, projection: null, reserve: null };
  if (metric.status !== 'ok' || metric.used == null || !(metric.limit > 0)) return out;
  out.pct = Math.round((metric.used / metric.limit) * 1000) / 10;
  let level = 'ok';
  const raise = (to, reason) => { if (rank(to) > rank(level)) level = to; if (!out.reasons.includes(reason)) out.reasons.push(reason); };
  if (out.pct >= settings.criticalAt) raise('critical', 'threshold');
  else if (out.pct >= settings.urgentAt) raise('urgent', 'threshold');
  else if (out.pct >= settings.warnAt) raise('warn', 'threshold');
  if (metric.used >= metric.limit) { out.exceeded = true; raise('critical', 'threshold'); }
  out.projection = projectExhaustion({ used: metric.used, limit: metric.limit, now, periodStart: metric.periodStart, resetsAt: metric.resetsAt, series });
  if (settings.forecastDays > 0 && out.projection && !out.exceeded) {
    if (out.projection.days <= settings.forecastDays / 2) raise('urgent', 'forecast');
    else if (out.projection.days <= settings.forecastDays) raise('warn', 'forecast');
  }
  // A backup reads the whole database: if that would not fit in what is left of the transfer, the time to back up is NOW.
  if (metric.blocksBackup && metric.backupCost > 0) {
    const left = Math.max(0, metric.limit - metric.used);
    if (left < metric.backupCost * 1.5) { out.reserve = { need: metric.backupCost, left }; raise('urgent', 'reserve'); }
  }
  out.level = level;
  return out;
}
/**
 * What to tell the owner now. `state` = { [id]: { rank, at } } (what was last announced), `items` = evaluated metrics.
 * Returns { send: [{ id, level, why }], next } where `next` is the state to store once the message was really delivered.
 */
function decide(state, items, now, settings) {
  const next = {};
  const send = [];
  for (const item of items) {
    const known = state[item.id] || { rank: 0, at: 0 };
    const r = rank(item.level);
    if (r === 0) continue; // back to normal: forget, so a new rise is announced again
    if (r > known.rank) { send.push({ id: item.id, level: item.level, why: 'rise' }); next[item.id] = { rank: r, at: now }; }
    else if (r < known.rank) next[item.id] = { rank: r, at: known.at }; // calmed down a little: a new rise will be announced
    else if (r >= 2 && now - known.at >= settings.reminderHours * HOUR) { send.push({ id: item.id, level: item.level, why: 'reminder' }); next[item.id] = { rank: r, at: now }; }
    else next[item.id] = known;
  }
  return { send, next };
}
/**
 * Should the monitor start a full backup now? `state` is what the last attempt left ({ status, at, lastOkAt, retryAt }), `items` the evaluated
 * metrics. Returns { run, why, hot }: `hot` = ids of the limits at or above the threshold. Pure: the clock is a parameter.
 */
function decideAutoBackup(state, items, now, settings) {
  if (!settings.autoBackup) return { run: false, why: 'off', hot: [] };
  const hot = items.filter(m => m.status === 'ok' && m.pct != null && m.pct >= settings.autoBackupAt).map(m => m.id);
  if (!hot.length) return { run: false, why: 'below', hot };
  const known = state || {};
  if (known.status === 'running' && now - (known.at || 0) < AUTO_STALE) return { run: false, why: 'running', hot };
  if (known.retryAt && now < known.retryAt) return { run: false, why: 'waiting', hot };
  if (known.lastOkAt && now - known.lastOkAt < AUTO_COOLDOWN) return { run: false, why: 'cooldown', hot };
  return { run: true, why: 'limit', hot };
}
const fmtValue = (metric, value) => {
  if (value == null) return '?';
  if (metric.unit === 'bytes') return value >= GB ? `${(value / GB).toFixed(2)} GB` : `${(value / 1e6).toFixed(1)} MB`;
  if (metric.unit === 'hours') return `${value.toFixed(1)} CU-hours`;
  return Math.round(value).toLocaleString('en');
};
const dateText = at => new Date(at).toISOString().slice(0, 10);
/** The warning message (English: it goes to an inbox or a chat webhook, like the API warnings). */
function compose(items, { base = '', lastBackupAt = null, now = Date.now(), blind = [] } = {}) {
  const top = items.reduce((best, item) => (rank(item.level) > rank(best) ? item.level : best), 'ok');
  const head = { critical: 'ACT NOW', urgent: 'Back up now', warn: 'Heads-up', ok: 'Notice' }[top];
  const lines = [];
  for (const item of items) {
    lines.push(`${LABELS[item.id]}: ${fmtValue(item, item.used)} of ${fmtValue(item, item.limit)} (${item.pct} %)${item.exceeded ? ' - LIMIT REACHED' : ''}`);
    lines.push(`  What happens at the limit: ${EFFECTS[item.effect]}.`);
    if (item.reserve) lines.push(`  Only ${fmtValue(item, item.reserve.left)} of transfer is left and a full backup needs about ${fmtValue(item, item.reserve.need)}.`);
    if (item.projection && !item.exceeded) lines.push(`  At the current pace it runs out around ${dateText(item.projection.at)} (in about ${item.projection.days} days).`);
    if (item.resetsAt) lines.push(`  The allowance resets on ${dateText(item.resetsAt)}.`);
    lines.push('');
  }
  for (const name of blind) lines.push(`The ${name} limits could not be read for more than 12 hours: the monitor is blind. Check the key or token in the server settings.`, '');
  if (items.length) {
    lines.push(lastBackupAt ? `The last backup you saved was on ${dateText(lastBackupAt)} (${Math.max(0, Math.round((now - lastBackupAt) / DAY))} days ago).` : 'No backup has been saved yet.');
    lines.push('Back up now: Service limits > Back up all data (download the file and keep it somewhere safe, copies on the server are deleted after a day).');
  }
  if (base) lines.push('', `Open: ${base.replace(/\/+$/, '')}/super-admin/limits`);
  const first = items[0];
  const subject = first ? `[Dwira] ${head}: ${LABELS[first.id]} at ${first.pct} %${items.length > 1 ? ` (+${items.length - 1} more)` : ''}` : `[Dwira] ${head}: free-tier monitor`;
  return { subject, text: lines.join('\n').trim() };
}

/** The message about an automatic backup (English, like the warnings: it goes to an inbox or a chat webhook). */
function composeAutoBackup({ ok, ids, name, destination, error, base = '' }) {
  const what = ids.map(id => LABELS[id] || id).join(', ');
  const lines = ok
    ? [`A free limit is close to its end (${what}), so a full backup of the app (database, code and files) was started by itself and finished.`, `Saved to: ${destination === 'vault' ? 'your backup vault' : destination}${name ? ` (${name})` : ''}.`, 'Nothing else to do: you can restore it from Backup & restore.']
    : [`A free limit is close to its end (${what}) and the automatic full backup FAILED (${error || 'unknown error'}).`, 'It is tried again later. If this keeps happening, open Backup & restore and make a backup by hand, then download it.'];
  if (base) lines.push('', `Open: ${base.replace(/\/+$/, '')}/super-admin/backup`);
  return { subject: ok ? `[Dwira] Automatic backup made (${what})` : `[Dwira] Automatic backup FAILED (${what})`, text: lines.join('\n') };
}

// ---------------------------------------------------------------- the service

function createLimits({ db, env = process.env, clock = Date.now, fetch: doFetch = globalThis.fetch, notify, transport = () => false, recipient = async () => '', mediaTotals = async () => null } = {}) {
  const kvGet = async key => (await db.query('SELECT value FROM saas_kv WHERE key=$1', [key]))[0]?.value ?? null;
  const kvSet = (key, value) => db.query('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value)]);
  const kvJson = async (key, fallback) => { try { const raw = await kvGet(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  const MIN_AGE = Math.max(MIN, Number(env.LIMITS_MIN_AGE_MS) || 10 * MIN); // a non-forced check reuses a result this young
  const ACTIVE_EVERY = Math.max(MIN, Number(env.LIMITS_ACTIVE_EVERY_MS) || 30 * MIN);
  const IDLE_EVERY = Math.max(ACTIVE_EVERY, Number(env.LIMITS_IDLE_EVERY_MS) || 12 * HOUR);
  const memory = { snapshot: null, at: -Infinity };
  let lastRunAt = 0;
  let autoHook = null, autoPending = null;

  // ---------- settings
  async function getSettings() { try { return cleanSettings(await kvJson('limits_settings', {})); } catch { return cleanSettings({}); } }
  async function setSettings(body) {
    const next = cleanSettings(body, await getSettings());
    await kvSet('limits_settings', JSON.stringify(next));
    return next;
  }

  // ---------- external reads (each returns a plain object or throws an Error whose message is a short code)
  async function getJson(url, init, { timeout = 9000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try { response = await doFetch(url, { ...init, signal: controller.signal, redirect: 'manual' }); }
    catch { throw new Error('NETWORK'); }
    finally { clearTimeout(timer); }
    if (response.status === 401 || response.status === 403) throw new Error('AUTH');
    if (response.status === 404) throw new Error('NOT_FOUND');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    try { return await response.json(); } catch { throw new Error('BAD_RESPONSE'); }
  }
  const num = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

  async function readNeon() {
    const base = String(env.NEON_API_URL || 'https://console.neon.tech/api/v2').replace(/\/+$/, '');
    const body = await getJson(`${base}/projects/${encodeURIComponent(env.NEON_PROJECT_ID)}`, { headers: { Authorization: `Bearer ${env.NEON_API_KEY}`, Accept: 'application/json' } });
    const project = body?.project;
    if (!project || typeof project !== 'object') throw new Error('BAD_RESPONSE');
    const seconds = num(project.compute_time_seconds);
    const start = Date.parse(project.consumption_period_start), end = Date.parse(project.consumption_period_end);
    return {
      computeHours: seconds == null ? null : seconds / 3600, // 1 CU = 1 vCPU, so CPU-seconds / 3600 = CU-hours
      transferBytes: num(project.data_transfer_bytes),
      periodStart: Number.isFinite(start) ? start : null, periodEnd: Number.isFinite(end) ? end : null,
      sizeLimit: num(project.branch_logical_size_limit_bytes),
    };
  }
  const R2_QUERY = `query R2Limits($accountTag: string!, $from: Time, $to: Time, $since: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    ops: r2OperationsAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }) { sum { requests } dimensions { actionType } }
    store: r2StorageAdaptiveGroups(limit: 1000, filter: { datetime_geq: $since, datetime_leq: $to }, orderBy: [datetime_DESC]) { max { payloadSize metadataSize objectCount } dimensions { bucketName datetime } }
  } }
}`;
  async function readCloudflare(now) {
    const account = env.CLOUDFLARE_ACCOUNT_ID || env.R2_ACCOUNT_ID;
    const month = monthWindow(now);
    const body = await getJson(env.CLOUDFLARE_GRAPHQL_URL || 'https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: R2_QUERY, variables: { accountTag: String(account).trim(), from: new Date(month.start).toISOString(), to: new Date(now).toISOString(), since: new Date(now - 3 * DAY).toISOString() } }),
    });
    if (Array.isArray(body?.errors) && body.errors.length) throw new Error(/authori|permission|token|auth/i.test(JSON.stringify(body.errors)) ? 'AUTH' : 'GRAPHQL');
    const account0 = body?.data?.viewer?.accounts?.[0];
    if (!account0) throw new Error('NOT_FOUND');
    let classA = 0, classB = 0;
    for (const group of account0.ops || []) {
      const kind = classifyR2Action(group?.dimensions?.actionType), n = Number(group?.sum?.requests) || 0;
      if (kind === 'A') classA += n; else if (kind === 'B') classB += n;
    }
    const seen = new Set();
    let storageBytes = 0, objects = 0;
    for (const row of account0.store || []) { // newest first: the first row of a bucket is its current size
      const bucket = row?.dimensions?.bucketName;
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      storageBytes += (Number(row?.max?.payloadSize) || 0) + (Number(row?.max?.metadataSize) || 0);
      objects += Number(row?.max?.objectCount) || 0;
    }
    return { classA, classB, storageBytes, objects, resetsAt: month.end, periodStart: month.start };
  }

  // ---------- gathering
  const base = (id, extra) => ({ id, ...METRICS[id], used: null, limit: PLAN_LIMITS[id], limitSource: 'plan', status: 'ok', error: '', needs: [], source: 'measured', resetsAt: null, periodStart: null, backupCost: null, ...extra });
  /** Applies the owner's override, then (for the storage cap) what the provider reported, then the plan default. */
  const withLimit = (metric, settings, reported) => {
    const custom = settings.limits[metric.id];
    if (custom > 0) return { ...metric, limit: custom, limitSource: 'custom' };
    if (reported > 0) return { ...metric, limit: reported, limitSource: 'api' };
    return metric;
  };
  async function gather(settings, now) {
    const metrics = [];
    const services = {};
    let engine = '';
    try { engine = await db.info(); } catch { /* unknown engine: treated as not Neon */ }
    const provider = detectProvider(env, engine);
    const monthEnd = monthWindow(now).end;
    let dbBytes = null;
    try { dbBytes = num((await db.query('SELECT pg_database_size(current_database()) AS bytes'))[0]?.bytes); } catch { /* reported on the metric */ }

    // --- Neon
    const neonKeys = !!(env.NEON_API_KEY && env.NEON_PROJECT_ID);
    const neonOn = settings.services.neon && (provider === 'neon' || neonKeys);
    services.neon = { state: !settings.services.neon ? 'off' : neonOn ? 'on' : 'not_used', provider, api: neonKeys, dbBytes };
    if (neonOn) {
      let neon = null, neonError = '';
      if (neonKeys) { try { neon = await readNeon(); } catch (error) { neonError = error.message || 'FAILED'; } }
      services.neon.error = neonError;
      const storage = base('neon.storage', dbBytes == null ? { status: 'error', error: 'DB_SIZE' } : { used: dbBytes });
      metrics.push(withLimit(storage, settings, neon?.sizeLimit));
      const need = (id, value, extra) => {
        if (!neonKeys) return withLimit(base(id, { status: 'needs_setup', needs: ['NEON_API_KEY', 'NEON_PROJECT_ID'] }), settings);
        if (neonError) return withLimit(base(id, { status: 'error', error: neonError }), settings);
        return withLimit(base(id, { used: value, source: 'neon', resetsAt: neon.periodEnd || monthEnd, periodStart: neon.periodStart, ...extra }), settings);
      };
      metrics.push(need('neon.compute', neon?.computeHours ?? null));
      metrics.push(need('neon.egress', neon?.transferBytes ?? null, { backupCost: dbBytes || null }));
    }

    // --- Cloudflare R2
    const r2Ready = r2Status(env) === 'r2';
    const cfToken = !!(env.CLOUDFLARE_API_TOKEN && (env.CLOUDFLARE_ACCOUNT_ID || env.R2_ACCOUNT_ID));
    const cfOn = settings.services.cloudflare && (r2Ready || cfToken);
    services.cloudflare = { state: !settings.services.cloudflare ? 'off' : cfOn ? 'on' : 'not_used', r2: r2Ready, api: cfToken };
    if (cfOn) {
      let cf = null, cfError = '';
      if (cfToken) { try { cf = await readCloudflare(now); } catch (error) { cfError = error.message || 'FAILED'; } }
      services.cloudflare.error = cfError;
      let known = null;
      try { known = await mediaTotals(); } catch { /* estimate unavailable */ }
      if (cf) metrics.push(withLimit(base('r2.storage', { used: cf.storageBytes, source: 'cloudflare' }), settings));
      else if (known?.r2) metrics.push(withLimit(base('r2.storage', { used: Number(known.r2.bytes) || 0, source: 'estimate' }), settings));
      else metrics.push(withLimit(base('r2.storage', { status: cfError ? 'error' : 'needs_setup', error: cfError, needs: cfError ? [] : ['CLOUDFLARE_API_TOKEN'] }), settings));
      for (const [id, key] of [['r2.classA', 'classA'], ['r2.classB', 'classB']]) {
        if (cf) metrics.push(withLimit(base(id, { used: cf[key], source: 'cloudflare', resetsAt: cf.resetsAt, periodStart: cf.periodStart, backupCost: id === 'r2.classB' ? Number(known?.r2?.files) || null : null }), settings));
        else metrics.push(withLimit(base(id, cfError ? { status: 'error', error: cfError } : { status: 'needs_setup', needs: ['CLOUDFLARE_API_TOKEN'] }), settings));
      }
    }
    return { metrics, services, dbBytes };
  }

  // ---------- lease: only one instance measures and mails at a time
  async function lease(now, ms = 2 * MIN) {
    try {
      const rows = await db.query("INSERT INTO saas_kv(key,value) VALUES('limits_lock',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value WHERE saas_kv.value ~ '^[0-9]+$' AND CAST(saas_kv.value AS BIGINT) < $2 RETURNING key", [String(now + ms), now]);
      return rows.length > 0;
    } catch { return false; }
  }
  const release = () => kvSet('limits_lock', '0').catch(() => {});

  // ---------- backups the owner really saved: a download of a platform archive that holds the database, or a finished upload to Drive / Dropbox.
  // (A copy that only sits on the server's disk is NOT counted: those are deleted after a day.)
  async function lastBackupAt() {
    let best = null;
    try {
      const row = (await db.query("SELECT MAX(at) AS at FROM saas_audit WHERE action='backup.download' AND tenant_id IS NULL AND detail LIKE 'dwira-platform-%'"))[0];
      if (row?.at != null) best = Number(row.at);
    } catch { /* no audit table yet */ }
    const remote = num(await kvGet('limits_remote_backup').catch(() => null));
    if (remote && (!best || remote > best)) best = remote;
    return best;
  }
  /** Called when a platform backup that holds the database reached Google Drive or Dropbox. */
  const noteBackup = (at = clock()) => kvSet('limits_remote_backup', String(Math.floor(at)));

  // ---------- automatic full backup
  /** The backup service, given by the server once it exists: ({ ids, avoidR2 }) => Promise<{ status, error?, name?, destination? }>. */
  const setAutoBackup = hook => { autoHook = typeof hook === 'function' ? hook : null; };
  const autoState = () => kvJson('limits_autobackup', null);
  async function runAuto(ids, startedAt) {
    let outcome;
    try { outcome = await autoHook({ ids, avoidR2: ids.some(id => id.startsWith('r2.')) && !ids.some(id => id.startsWith('neon.')) }); }
    catch (error) { outcome = { status: 'error', error: error?.status ? error.message : 'INTERNAL', notStarted: true }; }
    const t = clock();
    const prior = (await autoState().catch(() => null)) || {};
    const ok = outcome.status === 'done';
    const busy = outcome.error === 'BACKUP_BUSY' || outcome.error === 'BACKUP_SERVER_BUSY';
    const next = ok
      ? { status: 'done', at: startedAt, finishedAt: t, ids, destination: outcome.destination || 'vault', name: outcome.name || '', lastOkAt: t, mailedAt: prior.mailedAt || 0 }
      : { status: 'error', at: startedAt, finishedAt: t, ids, error: String(outcome.error || 'FAILED'), retryAt: t + (busy ? AUTO_BUSY_RETRY : AUTO_RETRY), ...(prior.lastOkAt ? { lastOkAt: prior.lastOkAt } : {}), mailedAt: prior.mailedAt || 0 };
    // Tell the owner: always about a good one; about a failure once per reminder period (and never about "another backup was running").
    const settings = await getSettings().catch(() => DEFAULTS);
    const tell = ok || (!busy && t - (prior.mailedAt || 0) >= settings.reminderHours * HOUR);
    if (tell && notify) {
      try {
        const result = await notify({ ...composeAutoBackup({ ok, ids, name: next.name, destination: next.destination, error: next.error, base: env.PUBLIC_URL || env.APP_URL || '' }), to: settings.email || undefined });
        if (result?.ok) next.mailedAt = t;
      } catch { /* informational */ }
    }
    await kvSet('limits_autobackup', JSON.stringify(next)).catch(() => {});
    return next;
  }
  /** Called inside a check with the fresh numbers. Starts the backup in the background (the check must stay short) and returns the decision. */
  async function considerAutoBackup(items, now, settings) {
    const state = await autoState().catch(() => null);
    const decision = decideAutoBackup(state, items, now, settings);
    if (!decision.run || !autoHook) return { ...decision, run: false, ...(decision.run ? { why: 'unavailable' } : {}) };
    await kvSet('limits_autobackup', JSON.stringify({ ...(state || {}), status: 'running', at: now, ids: decision.hot, error: '' }));
    autoPending = runAuto(decision.hot, now).catch(() => null).finally(() => { autoPending = null; });
    return decision;
  }

  // ---------- the check
  async function readSnapshot({ fresh = false } = {}) {
    if (!fresh && memory.snapshot && clock() - memory.at < 15000) return memory.snapshot;
    const snapshot = await kvJson('limits_snapshot', null);
    memory.snapshot = snapshot; memory.at = clock();
    return snapshot;
  }
  const worstOf = metrics => metrics.filter(m => m.pct != null).sort((a, b) => rank(b.level) - rank(a.level) || b.pct - a.pct)[0] || null;
  const summaryOf = snapshot => {
    if (!snapshot) return null;
    const worst = worstOf(snapshot.metrics);
    return { at: snapshot.at, level: snapshot.level, worst: worst ? { id: worst.id, pct: worst.pct, level: worst.level } : null };
  };

  /**
   * Measures, evaluates, announces (if something rose) and stores the snapshot. `force` skips the reuse of a recent result.
   * Never throws for an unreadable service (that is part of the snapshot); a database error is thrown to the caller.
   */
  async function check({ force = false, settingsChanged = false } = {}) {
    const now = clock();
    const settings = await getSettings();
    const cached = await readSnapshot();
    if (!settings.enabled) return cached ? { ...cached, level: 'ok', disabled: true } : { at: now, level: 'ok', metrics: [], services: {}, disabled: true };
    if (cached && !settingsChanged && now - cached.at < (force ? 3000 : MIN_AGE)) return cached;
    if (!(await lease(now))) return cached || { at: now, level: 'ok', metrics: [], services: {}, busy: true };
    try {
      lastRunAt = now;
      const { metrics: raw, services } = await gather(settings, now);
      const history = await kvJson('limits_history', []);
      const evaluated = raw.map(metric => evaluate(metric, { settings, now, series: history.map(p => ({ t: p.t, v: p.v?.[metric.id] })).filter(p => p.v != null) }));
      const level = evaluated.reduce((best, m) => (rank(m.level) > rank(best) ? m.level : best), 'ok');

      // The monitor must not fail silently: a service that could not be read for 12 hours is announced too.
      const blindState = (await kvJson('limits_blind', {})) || {};
      const blindNext = {};
      const blindNames = [];
      for (const [name, label] of [['neon', 'Neon'], ['cloudflare', 'Cloudflare']]) {
        const failing = services[name]?.state === 'on' && services[name].error;
        if (!failing) continue;
        const since = blindState[name]?.since || now;
        blindNext[name] = { since, notifiedAt: blindState[name]?.notifiedAt || 0 };
        if (now - since >= 12 * HOUR && now - blindNext[name].notifiedAt >= settings.reminderHours * HOUR) blindNames.push({ key: name, label });
      }

      const state = (await kvJson('limits_state', {})) || {};
      const { send, next } = decide(state, evaluated.filter(m => m.level !== 'ok'), now, settings);
      let mail = (cached && cached.mail) || null;
      if (send.length || blindNames.length) {
        const items = send.map(s => evaluated.find(m => m.id === s.id)).filter(Boolean).sort((a, b) => rank(b.level) - rank(a.level));
        const message = compose(items, { base: env.PUBLIC_URL || env.APP_URL || '', lastBackupAt: await lastBackupAt(), now, blind: blindNames.map(b => b.label) });
        let result;
        try { result = notify ? await notify({ ...message, to: settings.email || undefined }) : { ok: false, error: 'NO_MAIL_TRANSPORT' }; } catch { result = { ok: false, error: 'FAILED' }; }
        mail = { at: now, ok: !!result.ok, error: result.ok ? '' : String(result.error || 'FAILED'), count: items.length + blindNames.length };
        if (result.ok) { // only a delivered message counts as announced; otherwise the next check tries again
          await kvSet('limits_state', JSON.stringify(next));
          for (const b of blindNames) blindNext[b.key].notifiedAt = now;
        }
      } else await kvSet('limits_state', JSON.stringify(next));
      await kvSet('limits_blind', JSON.stringify(blindNext));
      await considerAutoBackup(evaluated, now, settings).catch(() => null);

      // One sample per ~6 hours feeds the growth forecast of the storage (30 days kept).
      const last = history[history.length - 1];
      if (!last || now - last.t >= 6 * HOUR) {
        history.push({ t: now, v: Object.fromEntries(evaluated.filter(m => m.used != null).map(m => [m.id, m.used])) });
        await kvSet('limits_history', JSON.stringify(history.slice(-120)));
      }
      const snapshot = { at: now, level, metrics: evaluated, services, mail };
      await kvSet('limits_snapshot', JSON.stringify(snapshot));
      memory.snapshot = snapshot; memory.at = clock();
      return snapshot;
    } finally { await release(); }
  }

  /** Called every minute by the long-running server. Cheap: nothing is read from the database unless a check is due. */
  async function tick({ active }) {
    const now = clock();
    if (now - lastRunAt < (active ? ACTIVE_EVERY : IDLE_EVERY)) return null;
    lastRunAt = now; // even a failing check waits for its turn: the database may be asleep
    return check();
  }

  /** What the console shows: the (possibly refreshed) snapshot with its settings and what the server is able to do. */
  async function status({ refresh = false } = {}) {
    let snapshot = await readSnapshot();
    if (!snapshot || refresh || clock() - snapshot.at >= MIN_AGE) snapshot = await check({ force: refresh });
    const settings = await getSettings();
    return {
      ...snapshot, settings, defaults: DEFAULTS, planLimits: PLAN_LIMITS,
      delivery: { transport: !!transport(), recipient: settings.email || await recipient().catch(() => '') },
      keys: { neonApi: !!(env.NEON_API_KEY && env.NEON_PROJECT_ID), cloudflareApi: !!(env.CLOUDFLARE_API_TOKEN && (env.CLOUDFLARE_ACCOUNT_ID || env.R2_ACCOUNT_ID)) },
      lastBackupAt: await lastBackupAt(),
      autoBackup: await autoState().catch(() => null),
      backupHost: !env.VERCEL || env.BACKUP_FORCE === '1',
    };
  }
  /** Cached summary for the banner and the overview tile: reads the stored snapshot only, never calls a provider. */
  async function summary() { return summaryOf(await readSnapshot()); }
  async function testAlert() {
    const settings = await getSettings();
    if (!transport()) throw fail(409, 'NO_MAIL_TRANSPORT');
    const to = settings.email || await recipient();
    if (!to && !env.ALERT_WEBHOOK_URL) throw fail(409, 'NO_RECIPIENT');
    const result = await notify({ subject: '[Dwira] Test: free-tier limit warning', text: 'This is a test. When Neon or Cloudflare R2 gets close to a free limit, the warning will reach this address, with time left to back up all your data.', to: settings.email || undefined });
    if (!result.ok) throw fail(502, 'EMAIL_FAILED');
    return { ok: true, to: result.to || to };
  }

  return { check, tick, status, summary, getSettings, setSettings, testAlert, lastBackupAt, noteBackup, setAutoBackup, autoBackupIdle: () => autoPending || Promise.resolve(), DEFAULTS, PLAN_LIMITS };
}

module.exports = { createLimits, cleanSettings, evaluate, decide, decideAutoBackup, composeAutoBackup, projectExhaustion, classifyR2Action, monthWindow, compose, PLAN_LIMITS, DEFAULTS, METRICS, LEVELS };
