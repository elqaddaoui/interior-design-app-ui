/**
 * API consumption metering, abuse detection and the e-mail warning to the super admin.
 *
 *   - Metering: every outgoing AI call (image, text, translation, ... "other") is counted by `record`, in BOTH key modes ('own' = the
 *     store's own keys, 'platform' = keys from the API manager). Rows are rollups, one per tenant / modality / operation / provider / mode
 *     per 10-minute bucket (saas_usage), so the table grows with activity patterns, not with traffic. Nothing here ever stores a prompt, a
 *     picture, a key or a client id.
 *   - Abuse detection (`scan`, throttled per store): a burst in the last minutes, a daily cap, a spike against the store's own 7-day
 *     average, a high failure rate (leaked or dead key, scripted retries) and repeated probing of a gated demo. Each finding is ONE alert
 *     (cooldown per store + rule, default 6 h) that is e-mailed to the super admin. A critical finding on a demo or on a store that uses the
 *     platform's keys also pauses that store's AI automatically (the owner resumes it from the console); a store paying with its own keys is
 *     only warned about.
 *   - E-mail: Resend's HTTPS API (RESEND_API_KEY, ALERT_FROM) or a webhook (ALERT_WEBHOOK_URL: Slack, Discord, Teams ... any JSON endpoint).
 *     No SMTP dependency. A failed delivery is kept on the alert and retried.
 *
 * Only the platform side (server/platform.js, server/superadmin.js) uses this module: tenant modules reach it through `platform.forTenant`.
 */
const crypto = require('node:crypto');

const BUCKET = 10 * 60000;
const HOUR = 3600000;
const DAY = 86400000;
const KEEP_DAYS = 90;
const KINDS = ['image', 'text', 'other'];
const RANGES = { '24h': { span: DAY, step: HOUR }, '7d': { span: 7 * DAY, step: DAY }, '30d': { span: 30 * DAY, step: DAY } };

const DEFAULTS = {
  enabled: true,
  email: '',
  autoPause: true,
  cooldownMin: 360,
  burst: { image: 30, text: 120, other: 120 }, // calls in the last ~10 minutes (a store)
  demoBurst: 10, // the same, for a demo (it should hardly use AI at all)
  daily: { image: 300, text: 1500, other: 1500 }, // calls in the last 24 hours (a store)
  spikeFactor: 5, // last hour vs the store's own hourly average of the previous 7 days
  minSpike: 40,
  failureRate: 60, // % of calls that failed, over the last ~30 minutes with at least 20 calls
  probe: 20, // refused calls (gate closed) in the last ~10 minutes
};
const LIMITS = ['burst', 'daily'];

const fail = (status, message) => Object.assign(new Error(message), { status });
const int = (value, min, max, fallback) => { const n = Number(value); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };

/** A sanitised settings object: unknown fields dropped, every number clamped, missing fields from DEFAULTS. */
function cleanSettings(input, base = DEFAULTS) {
  const out = JSON.parse(JSON.stringify(base));
  const src = input && typeof input === 'object' ? input : {};
  if (src.enabled !== undefined) out.enabled = src.enabled === true;
  if (src.autoPause !== undefined) out.autoPause = src.autoPause === true;
  if (src.email !== undefined) {
    const email = String(src.email || '').trim().slice(0, 254);
    if (email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(email)) throw fail(400, 'INVALID_EMAIL');
    out.email = email;
  }
  for (const group of LIMITS) {
    if (src[group] && typeof src[group] === 'object') for (const kind of KINDS) if (src[group][kind] !== undefined) {
      const value = int(src[group][kind], 1, 1000000, null);
      if (value === null) throw fail(400, 'INVALID_LIMIT');
      out[group][kind] = value;
    }
  }
  for (const [key, min, max] of [['cooldownMin', 5, 10080], ['demoBurst', 1, 100000], ['spikeFactor', 2, 1000], ['minSpike', 5, 1000000], ['failureRate', 10, 100], ['probe', 3, 100000]]) {
    if (src[key] !== undefined) { const value = int(src[key], min, max, null); if (value === null) throw fail(400, 'INVALID_LIMIT'); out[key] = value; }
  }
  return out;
}

/** The default transport. Returns { ok, error } and never throws. `fetchImpl` is injectable for tests. */
function defaultMailer(env, fetchImpl = globalThis.fetch) {
  return async ({ to, subject, text }) => {
    const send = async (url, init) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try { const response = await fetchImpl(url, { ...init, signal: controller.signal }); return response.ok ? { ok: true } : { ok: false, error: `HTTP_${response.status}` }; }
      catch { return { ok: false, error: 'NETWORK' }; } finally { clearTimeout(timer); }
    };
    if (env.RESEND_API_KEY) {
      if (!to) return { ok: false, error: 'NO_RECIPIENT' };
      return send('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.ALERT_FROM || 'Dwira Alerts <onboarding@resend.dev>', to: [to], subject, text }) });
    }
    if (env.ALERT_WEBHOOK_URL && /^https:\/\//.test(env.ALERT_WEBHOOK_URL)) {
      return send(env.ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `${subject}\n\n${text}`, content: `${subject}\n\n${text}`, subject, to }) });
    }
    return { ok: false, error: 'NO_MAIL_TRANSPORT' };
  };
}

function createUsage(db, { env = process.env, clock = Date.now, mailer } = {}) {
  const send = mailer || defaultMailer(env);
  const lastScan = new Map(); // tenant id -> time of its last scan (this process)
  let lastPrune = 0, lastRetry = 0;

  // ---------- settings ----------
  async function getSettings() {
    const row = (await db.query("SELECT value FROM saas_kv WHERE key='abuse_settings'"))[0];
    let stored = {};
    try { stored = row ? JSON.parse(row.value) : {}; } catch { /* defaults */ }
    try { return cleanSettings(stored); } catch { return cleanSettings({}); }
  }
  async function setSettings(body) {
    const next = cleanSettings(body, await getSettings());
    await db.query("INSERT INTO saas_kv(key,value) VALUES('abuse_settings',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(next)]);
    return next;
  }
  async function recipient(settings) {
    if (settings.email) return settings.email;
    if (env.ALERT_EMAIL) return String(env.ALERT_EMAIL).trim();
    const owner = (await db.query("SELECT email FROM saas_super WHERE disabled=0 AND email LIKE '%@%' ORDER BY created_at LIMIT 1"))[0];
    return owner?.email || '';
  }
  const transport = () => !!(mailer || env.RESEND_API_KEY || (env.ALERT_WEBHOOK_URL && /^https:\/\//.test(env.ALERT_WEBHOOK_URL)));

  // ---------- metering ----------
  /**
   * Count one call. `blocked` = refused by the AI gate (no provider was called). Never throws: metering must not break the feature it measures.
   * Returns after the (throttled) abuse scan of this store, so a serverless function does not stop before an alert is saved.
   */
  async function record(tenantId, { kind = 'other', op = 'call', provider = '', mode = 'own', units = 0, ok = true, blocked = false } = {}) {
    try {
      const now = clock();
      const bucket = Math.floor(now / BUCKET) * BUCKET;
      const k = KINDS.includes(kind) ? kind : 'other';
      const calls = blocked ? 0 : 1, errors = !blocked && !ok ? 1 : 0;
      await db.query(
        `INSERT INTO saas_usage(bucket,tenant_id,kind,op,provider,mode,calls,errors,blocked,units) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (bucket,tenant_id,kind,op,provider,mode) DO UPDATE SET calls=saas_usage.calls+EXCLUDED.calls, errors=saas_usage.errors+EXCLUDED.errors, blocked=saas_usage.blocked+EXCLUDED.blocked, units=saas_usage.units+EXCLUDED.units`,
        [bucket, tenantId, k, String(op).slice(0, 40), String(provider || 'unknown').slice(0, 40), mode === 'platform' ? 'platform' : 'own', calls, errors, blocked ? 1 : 0, Math.max(0, Math.floor(Number(units) || 0))]);
      if (now - (lastScan.get(tenantId) || 0) >= 30000) {
        lastScan.set(tenantId, now);
        if (lastScan.size > 2000) lastScan.delete(lastScan.keys().next().value);
        await scan(tenantId).catch(() => {});
      }
    } catch { console.warn('Usage metering unavailable'); }
  }

  // ---------- detection ----------
  async function scan(tenantId) {
    const settings = await getSettings();
    if (!settings.enabled) return [];
    const tenant = (await db.query('SELECT id, name, slug, kind, api_mode, ai_paused FROM saas_tenants WHERE id=$1', [tenantId]))[0];
    if (!tenant) return [];
    const now = clock();
    const floor = ms => Math.floor((now - ms) / BUCKET) * BUCKET;
    const [t10, t30, t1h, t1d, t7d] = [floor(10 * 60000), floor(30 * 60000), floor(HOUR), floor(DAY), floor(7 * DAY)];
    const rows = await db.query(
      `SELECT kind,
        COALESCE(SUM(calls) FILTER (WHERE bucket>=$2),0) AS c10, COALESCE(SUM(blocked) FILTER (WHERE bucket>=$2),0) AS b10,
        COALESCE(SUM(calls) FILTER (WHERE bucket>=$3),0) AS c30, COALESCE(SUM(errors) FILTER (WHERE bucket>=$3),0) AS e30,
        COALESCE(SUM(calls) FILTER (WHERE bucket>=$4),0) AS c1h, COALESCE(SUM(calls) FILTER (WHERE bucket>=$5),0) AS c1d,
        COALESCE(SUM(calls) FILTER (WHERE bucket<$4),0) AS cbase
       FROM saas_usage WHERE tenant_id=$1 AND bucket>=$6 GROUP BY kind`, [tenantId, t10, t30, t1h, t1d, t7d]);
    const demo = tenant.kind === 'demo';
    const found = [];
    for (const row of rows) {
      const kind = row.kind, c10 = Number(row.c10), b10 = Number(row.b10), c30 = Number(row.c30), e30 = Number(row.e30), c1h = Number(row.c1h), c1d = Number(row.c1d), base = Number(row.cbase);
      const burst = demo ? Math.min(settings.demoBurst, settings.burst[kind]) : settings.burst[kind];
      if (c10 >= burst) found.push({ rule: `burst:${kind}`, severity: c10 >= burst * 3 ? 'critical' : 'high', value: c10, limit: burst, windowMin: 10, kind });
      if (c1d >= settings.daily[kind] && !demo) found.push({ rule: `daily:${kind}`, severity: c1d >= settings.daily[kind] * 2 ? 'critical' : 'high', value: c1d, limit: settings.daily[kind], windowMin: 1440, kind });
      const average = base / 168; // calls per hour over the previous week
      if (c1h >= Math.max(settings.minSpike, settings.spikeFactor * average)) found.push({ rule: `spike:${kind}`, severity: 'medium', value: c1h, limit: Math.max(settings.minSpike, Math.ceil(settings.spikeFactor * average)), windowMin: 60, kind });
      if (c30 >= 20 && (e30 * 100) / c30 >= settings.failureRate) found.push({ rule: `failures:${kind}`, severity: 'medium', value: Math.round((e30 * 100) / c30), limit: settings.failureRate, windowMin: 30, kind });
      if (b10 >= settings.probe) found.push({ rule: `probe:${kind}`, severity: 'medium', value: b10, limit: settings.probe, windowMin: 10, kind });
    }
    // The same finding is raised once per cooldown; the daily cap and the burst of one kind are separate rules.
    const created = [];
    for (const finding of found) {
      const recent = await db.query("SELECT 1 FROM saas_alerts WHERE tenant_id=$1 AND rule=$2 AND at>$3 AND status='open' LIMIT 1", [tenantId, finding.rule, now - settings.cooldownMin * 60000]);
      if (recent.length) continue;
      const mayPause = settings.autoPause && finding.severity === 'critical' && (demo || tenant.api_mode === 'platform') && !tenant.ai_paused;
      const id = `al_${crypto.randomBytes(6).toString('hex')}`;
      const detail = { store: tenant.name, slug: tenant.slug, storeKind: tenant.kind, mode: tenant.api_mode === 'platform' ? 'platform' : 'own', kind: finding.kind, value: finding.value, limit: finding.limit, windowMin: finding.windowMin };
      await db.query('INSERT INTO saas_alerts(id,at,tenant_id,rule,severity,title,detail,action) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, now, tenantId, finding.rule, finding.severity, finding.rule.split(':')[0], JSON.stringify(detail), mayPause ? 'paused' : '']);
      if (mayPause) { await db.query("UPDATE saas_tenants SET ai_paused=1, ai_pause_reason=$2, updated_at=$3 WHERE id=$1", [tenantId, `abuse:${finding.rule}`, now]); tenant.ai_paused = 1; }
      created.push(id);
    }
    for (const id of created) await deliver(id, settings).catch(() => {});
    if (now - lastPrune > 6 * HOUR) { lastPrune = now; await db.query('DELETE FROM saas_usage WHERE bucket<$1', [now - KEEP_DAYS * DAY]).catch(() => {}); }
    return created;
  }

  // ---------- e-mail ----------
  const TITLES = { burst: 'Burst of API calls', daily: 'Daily API cap reached', spike: 'Usage spike', failures: 'Many failing API calls', probe: 'Repeated attempts while AI is switched off' };
  function compose(alert, base) {
    const d = alert.detail;
    const lines = [
      `${TITLES[alert.title] || alert.title} (${alert.severity})`,
      '',
      `Store: ${d.store} (${d.slug}) - ${d.storeKind === 'demo' ? 'demo' : 'store'}`,
      `API kind: ${d.kind}`,
      `Keys: ${d.mode === 'platform' ? 'managed by the platform (your keys)' : "the store's own keys"}`,
      d.windowMin ? `Observed: ${d.value}${alert.title === 'failures' ? ' % failed' : ' calls'} in about ${d.windowMin} minutes (alert level ${d.limit})` : '',
      alert.action === 'paused' ? 'Action taken: this store\'s AI was PAUSED automatically. Resume it from the console once you checked.' : 'No automatic action was taken.',
      '',
      base ? `Review: ${base.replace(/\/+$/, '')}/super-admin/apis` : 'Review it in the console: APIs > Alerts.',
    ].filter((line, i, all) => line !== '' || all[i - 1] !== '');
    return { subject: `[Dwira] ${TITLES[alert.title] || 'API warning'}: ${d.store}`, text: lines.join('\n') };
  }
  const alertView = row => {
    let detail = {};
    try { detail = JSON.parse(row.detail || '{}'); } catch { /* none */ }
    return { id: row.id, at: Number(row.at), tenantId: row.tenant_id, rule: row.rule, severity: row.severity, title: row.title, detail, action: row.action, status: row.status, emailedAt: row.emailed_at == null ? null : Number(row.emailed_at), emailError: row.email_error || '', resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at) };
  };
  async function deliver(id, settings) {
    const row = (await db.query('SELECT * FROM saas_alerts WHERE id=$1', [id]))[0];
    if (!row || row.emailed_at != null) return false;
    const cfg = settings || await getSettings();
    const to = await recipient(cfg);
    const { subject, text } = compose(alertView(row), env.PUBLIC_URL || env.APP_URL || '');
    const result = to || env.ALERT_WEBHOOK_URL ? await send({ to, subject, text }) : { ok: false, error: 'NO_RECIPIENT' };
    await db.query('UPDATE saas_alerts SET emailed_at=$2, email_error=$3 WHERE id=$1', [id, result.ok ? clock() : null, result.ok ? '' : String(result.error || 'FAILED').slice(0, 60)]);
    return !!result.ok;
  }
  /** Alerts of the last day whose e-mail failed for a transient reason: tried again (at most every 5 minutes per process). */
  async function retryPending() {
    if (clock() - lastRetry < 300000) return;
    lastRetry = clock();
    const rows = await db.query("SELECT id FROM saas_alerts WHERE emailed_at IS NULL AND email_error NOT IN ('NO_MAIL_TRANSPORT','NO_RECIPIENT') AND email_error<>'' AND at>$1 LIMIT 10", [clock() - DAY]);
    const settings = await getSettings();
    for (const row of rows) await deliver(row.id, settings).catch(() => {});
  }
  async function testEmail() {
    const settings = await getSettings();
    const to = await recipient(settings);
    if (!to && !env.ALERT_WEBHOOK_URL) throw fail(409, 'NO_RECIPIENT');
    if (!transport()) throw fail(409, 'NO_MAIL_TRANSPORT');
    const result = await send({ to, subject: '[Dwira] Test warning e-mail', text: 'This is a test: API abuse warnings will reach this address.' });
    if (!result.ok) throw fail(502, 'EMAIL_FAILED');
    return { ok: true, to };
  }

  // ---------- reading ----------
  async function alerts({ status = 'open', limit = 100 } = {}) {
    await retryPending().catch(() => {});
    const n = Math.max(1, Math.min(300, Number(limit) || 100));
    const rows = status === 'all' ? await db.query('SELECT * FROM saas_alerts ORDER BY at DESC LIMIT $1', [n]) : await db.query("SELECT * FROM saas_alerts WHERE status='open' ORDER BY at DESC LIMIT $1", [n]);
    const names = new Map((await db.query('SELECT id, name, slug, kind FROM saas_tenants')).map(r => [r.id, r]));
    return rows.map(row => ({ ...alertView(row), store: names.get(row.tenant_id)?.name || row.tenant_id, slug: names.get(row.tenant_id)?.slug || '', storeKind: names.get(row.tenant_id)?.kind || '' }));
  }
  async function resolve(id) {
    const rows = await db.query("UPDATE saas_alerts SET status='resolved', resolved_at=$2 WHERE id=$1 AND status='open' RETURNING id", [String(id), clock()]);
    if (!rows.length) throw fail(404, 'NOT_FOUND');
    return { ok: true };
  }
  const resolveAll = async () => ({ ok: true, count: (await db.query("UPDATE saas_alerts SET status='resolved', resolved_at=$1 WHERE status='open' RETURNING id", [clock()])).length });
  const openCount = async () => Number((await db.query("SELECT COUNT(*) AS n FROM saas_alerts WHERE status='open'"))[0].n);

  /**
   * The whole picture for the console: totals, per modality, per provider and key mode, per operation, a time series and the busiest stores.
   * `range`: 24h (hourly points) | 7d | 30d (daily points). Optional filters: tenantId, kind, mode.
   */
  async function report({ range = '24h', tenantId, kind, mode } = {}) {
    const spec = RANGES[range] || RANGES['24h'];
    const now = clock();
    const since = Math.floor((now - spec.span) / spec.step) * spec.step;
    const params = [since], where = ['u.bucket>=$1'];
    if (tenantId) { params.push(String(tenantId)); where.push(`u.tenant_id=$${params.length}`); }
    if (KINDS.includes(kind)) { params.push(kind); where.push(`u.kind=$${params.length}`); }
    if (mode === 'own' || mode === 'platform') { params.push(mode); where.push(`u.mode=$${params.length}`); }
    const W = `WHERE ${where.join(' AND ')}`;
    const sums = 'COALESCE(SUM(u.calls),0) AS calls, COALESCE(SUM(u.errors),0) AS errors, COALESCE(SUM(u.blocked),0) AS blocked, COALESCE(SUM(u.units),0) AS units';
    const shape = row => ({ calls: Number(row.calls), errors: Number(row.errors), blocked: Number(row.blocked), units: Number(row.units) });
    const totals = shape((await db.query(`SELECT ${sums} FROM saas_usage u ${W}`, params))[0]);
    const byKind = (await db.query(`SELECT u.kind, ${sums} FROM saas_usage u ${W} GROUP BY u.kind`, params)).map(r => ({ kind: r.kind, ...shape(r) }));
    for (const k of KINDS) if (!byKind.some(r => r.kind === k)) byKind.push({ kind: k, calls: 0, errors: 0, blocked: 0, units: 0 });
    byKind.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
    const byProvider = (await db.query(`SELECT u.kind, u.provider, u.mode, ${sums} FROM saas_usage u ${W} GROUP BY u.kind, u.provider, u.mode ORDER BY SUM(u.calls) DESC, u.provider LIMIT 60`, params)).map(r => ({ kind: r.kind, provider: r.provider, mode: r.mode, ...shape(r) }));
    const byMode = (await db.query(`SELECT u.mode, ${sums} FROM saas_usage u ${W} GROUP BY u.mode`, params)).map(r => ({ mode: r.mode, ...shape(r) }));
    const byOp = (await db.query(`SELECT u.kind, u.op, ${sums} FROM saas_usage u ${W} GROUP BY u.kind, u.op ORDER BY SUM(u.calls) DESC LIMIT 40`, params)).map(r => ({ kind: r.kind, op: r.op, ...shape(r) }));
    const series = new Map();
    for (let t = Math.floor(since / spec.step) * spec.step; t <= now; t += spec.step) series.set(t, { t, image: 0, text: 0, other: 0, errors: 0 });
    for (const r of await db.query(`SELECT (u.bucket/${spec.step})*${spec.step} AS t, u.kind, SUM(u.calls) AS calls, SUM(u.errors) AS errors FROM saas_usage u ${W} GROUP BY 1, 2 ORDER BY 1`, params)) {
      const point = series.get(Number(r.t));
      if (point) { point[r.kind] += Number(r.calls); point.errors += Number(r.errors); }
    }
    const perStore = new Map();
    for (const r of await db.query(`SELECT u.tenant_id, u.kind, ${sums} FROM saas_usage u ${W} GROUP BY u.tenant_id, u.kind`, params)) {
      const row = perStore.get(r.tenant_id) || { tenantId: r.tenant_id, image: 0, text: 0, other: 0, calls: 0, errors: 0, blocked: 0 };
      row[r.kind] += Number(r.calls); row.calls += Number(r.calls); row.errors += Number(r.errors); row.blocked += Number(r.blocked);
      perStore.set(r.tenant_id, row);
    }
    const names = new Map((await db.query('SELECT id, name, slug, kind, api_mode, ai_paused, ai_until FROM saas_tenants')).map(r => [r.id, r]));
    const stores = [...perStore.values()].sort((a, b) => b.calls - a.calls || b.blocked - a.blocked).slice(0, 30).map(row => {
      const t = names.get(row.tenantId);
      return { ...row, name: t?.name || row.tenantId, slug: t?.slug || '', storeKind: t?.kind || '', mode: t?.api_mode === 'platform' ? 'platform' : 'own', paused: !!t?.ai_paused };
    });
    return { range: RANGES[range] ? range : '24h', step: spec.step, since, totals, byKind, byProvider, byMode, byOp, series: [...series.values()], stores };
  }
  /** Calls and errors of the last 24 hours (the overview tiles). */
  async function today() {
    const row = (await db.query('SELECT COALESCE(SUM(calls),0) AS calls, COALESCE(SUM(errors),0) AS errors FROM saas_usage WHERE bucket>=$1', [Math.floor((clock() - DAY) / BUCKET) * BUCKET]))[0];
    return { calls: Number(row.calls), errors: Number(row.errors) };
  }

  return { record, scan, getSettings, setSettings, alerts, resolve, resolveAll, openCount, report, today, testEmail, transport, recipient: async () => recipient(await getSettings()), DEFAULTS };
}

module.exports = { createUsage, cleanSettings, defaultMailer, DEFAULTS, KINDS };
