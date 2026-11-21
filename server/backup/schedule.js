/**
 * Daily automatic backups + retention.
 *
 * WHEN: at the quietest hour of the day. Every API request (visitors, clients, admins: the open app polls /api/sync every few seconds, so any
 * open screen counts) feeds an hourly traffic profile (a moving average per hour of the day, kept in the database so a restart does not forget it).
 * The best start is the quietest two-hour stretch; with too little data the default is 03:00 UTC. The super admin can also pick a fixed hour.
 * A run only STARTS when nobody has used the app for 10 minutes; if the app stays busy it keeps waiting, and after 6 hours it runs anyway
 * (a backup that never happens is worse than one during traffic: it reads from a consistent snapshot and does not block anybody).
 * A day without a run is made up as soon as the app is idle again. One instance at a time (database lease), so serverless / several
 * processes never start two.
 *
 * RETENTION: backups older than `retentionDays` (default 28 = 4 weeks, editable) are deleted from the vault, always keeping the newest backup of
 * every kind (see vault.prune).
 */
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
const DEFAULTS = { enabled: true, kinds: ['all'], hour: 'auto', retentionDays: 28 };
const KINDS = ['all', 'db', 'code', 'media'];
const fail = (status, message) => Object.assign(new Error(message), { status });

/** The settings the super admin may save, validated. Unknown keys are dropped. */
function cleanSettings(input = {}, base = DEFAULTS) {
  const out = { ...base };
  if (input.enabled !== undefined) out.enabled = input.enabled === true;
  if (input.kinds !== undefined) {
    if (!Array.isArray(input.kinds) || !input.kinds.length || input.kinds.some(k => !KINDS.includes(k))) throw fail(400, 'INVALID_TYPE');
    out.kinds = KINDS.filter(k => input.kinds.includes(k));
  }
  if (input.hour !== undefined) {
    if (input.hour !== 'auto' && !(Number.isInteger(input.hour) && input.hour >= 0 && input.hour <= 23)) throw fail(400, 'INVALID_HOUR');
    out.hour = input.hour;
  }
  if (input.retentionDays !== undefined) {
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 365) throw fail(400, 'INVALID_RETENTION');
    out.retentionDays = input.retentionDays;
  }
  return out;
}

/** The start hour (UTC) of the quietest two-hour stretch of the profile, or 3 when there is not enough data yet. */
function bestHour(hist) {
  const known = (hist || []).filter(v => typeof v === 'number');
  if (known.length < 12) return 3;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  const at = h => (typeof hist[h % 24] === 'number' ? hist[h % 24] : avg);
  let best = 3, low = Infinity;
  for (let h = 0; h < 24; h++) {
    const load = at(h) + at(h + 1);
    // Ties go to the hour closest to the small hours: fewest people awake.
    const tie = Math.abs(load - low) < 1e-9 && Math.min(h, 24 - h) < Math.min(best, 24 - best);
    if (load < low - 1e-9 || tie) { low = load; best = h; }
  }
  return best;
}

function createSchedule({ db, now = Date.now, startBackup, jobStatus, running, vault, prune, supported, onLog = () => {} }) {
  const kvGet = async key => (await db.query('SELECT value FROM saas_kv WHERE key=$1', [key]))[0]?.value ?? null;
  const kvSet = (key, value) => db.query('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value)]);
  const kvJson = async (key, fallback) => { try { const raw = await kvGet(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
  let lastActivity = 0, cur = null, rolled = [], busy = false;

  /** Called for every API request: cheap (two assignments). */
  function noteActivity() {
    const t = now(); lastActivity = t;
    const k = Math.floor(t / HOUR);
    if (!cur || cur.k !== k) { if (cur) rolled.push(cur); cur = { k, n: 0 }; }
    cur.n++;
  }
  async function foldActivity() {
    if (cur && cur.k < Math.floor(now() / HOUR)) { rolled.push(cur); cur = null; }
    if (!rolled.length) return null;
    const hist = (await kvJson('backup_activity', null)) || Array(24).fill(null);
    for (const { k, n } of rolled) { const h = k % 24; hist[h] = typeof hist[h] === 'number' ? hist[h] * 0.85 + n * 0.15 : n; }
    rolled = [];
    await kvSet('backup_activity', JSON.stringify(hist.map(v => (typeof v === 'number' ? Math.round(v * 10) / 10 : null))));
    return hist;
  }
  const getSettings = async () => ({ ...DEFAULTS, ...(await kvJson('backup_settings', {})) });
  async function setSettings(input) { const next = cleanSettings(input, await getSettings()); await kvSet('backup_settings', JSON.stringify(next)); return next; }

  /** One instance at a time: a lease in the shared database (same pattern as the limits monitor). */
  async function lease(ms) {
    try {
      const rows = await db.query("INSERT INTO saas_kv(key,value) VALUES('backup_lock',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value WHERE saas_kv.value ~ '^[0-9]+$' AND CAST(saas_kv.value AS BIGINT) < $2 RETURNING key", [String(now() + ms), now()]);
      return rows.length > 0;
    } catch { return false; }
  }
  const release = () => kvSet('backup_lock', '0').catch(() => {});

  async function status() {
    const settings = await getSettings();
    const hist = (await kvJson('backup_activity', null)) || Array(24).fill(null);
    const state = await kvJson('backup_schedule_state', {});
    const hour = settings.hour === 'auto' ? bestHour(hist) : settings.hour;
    const t = now(), d = new Date(t);
    let next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
    if (state.lastDay === d.toISOString().slice(0, 10) || next + 6 * HOUR < t) next += DAY;
    return { settings, hour, auto: settings.hour === 'auto', learned: hist.filter(v => typeof v === 'number').length, profile: hist, next, last: state.last || null, busy: !!running(), available: !!vault && supported() };
  }

  /** The decision, separated from the work so it can be tested: 'run' | 'idle' | 'waiting' | 'not-due' | 'off'. */
  function decide({ settings, state, hist, t }) {
    if (!settings.enabled) return 'off';
    const hour = settings.hour === 'auto' ? bestHour(hist) : settings.hour;
    const d = new Date(t), day = d.toISOString().slice(0, 10);
    const scheduled = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour);
    const overdue = state.lastAt && t - state.lastAt > 36 * HOUR;
    if (!((state.lastDay !== day && t >= scheduled) || overdue)) return 'not-due';
    const quiet = t - lastActivity >= 10 * MIN;
    if (quiet || t - scheduled >= 6 * HOUR || overdue && t - lastActivity >= 10 * MIN) return 'run';
    return 'waiting';
  }

  /** Cheap, called every few minutes by the server. Retention first (cheap), then the backups when due. */
  async function tick() {
    if (!vault || !supported() || busy) return { skipped: 'unavailable' };
    busy = true;
    try {
      const hist = (await foldActivity()) || (await kvJson('backup_activity', null)) || Array(24).fill(null);
      const settings = await getSettings();
      const state = await kvJson('backup_schedule_state', {});
      const t = now();
      if (t - (state.prunedAt || 0) > 12 * HOUR) {
        if (await lease(5 * MIN)) {
          try { const r = await prune({ keepDays: settings.retentionDays }); await kvSet('backup_schedule_state', JSON.stringify({ ...(await kvJson('backup_schedule_state', {})), prunedAt: t, pruned: r.removed })); onLog('retention', r); } finally { await release(); }
        }
      }
      const verdict = decide({ settings, state: await kvJson('backup_schedule_state', {}), hist, t });
      if (verdict !== 'run') return { verdict };
      if (running()) return { verdict: 'waiting' };
      if (!(await lease(2 * HOUR))) return { verdict: 'other-instance' };
      const results = [];
      try {
        for (const kind of settings.kinds) {
          let outcome;
          try {
            const job = await startBackup({ kind, destination: 'vault', createdBy: 'schedule', data: 'content' });
            outcome = await waitFor(job.id);
          } catch (error) { outcome = { status: 'error', error: error.status ? error.message : 'INTERNAL' }; }
          results.push({ kind, status: outcome.status, ...(outcome.error ? { error: outcome.error } : {}), ...(outcome.name ? { name: outcome.name } : {}) });
        }
        const done = new Date(now());
        const ok = results.every(r => r.status === 'done');
        const prior = await kvJson('backup_schedule_state', {});
        // A failed run is retried at the next tick (an hour later at most), a successful one is not repeated that day.
        await kvSet('backup_schedule_state', JSON.stringify({ ...prior, ...(ok ? { lastDay: done.toISOString().slice(0, 10), lastAt: now() } : { retryAt: now() + HOUR }), last: { at: now(), ok, results } }));
        if (ok) { const r = await prune({ keepDays: settings.retentionDays }); await kvSet('backup_schedule_state', JSON.stringify({ ...(await kvJson('backup_schedule_state', {})), prunedAt: now(), pruned: r.removed })); }
      } finally { await release(); }
      return { verdict: 'ran', results };
    } finally { busy = false; }
  }
  async function waitFor(id) {
    for (;;) {
      const job = jobStatus(id);
      if (job && !['queued', 'running'].includes(job.status)) return { status: job.status, error: job.errors?.[0]?.code, name: job.result?.destination?.name };
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return { getSettings, setSettings, status, tick, noteActivity, decide, foldActivity, lastActivity: () => lastActivity };
}

module.exports = { createSchedule, cleanSettings, bestHour, DEFAULTS };
