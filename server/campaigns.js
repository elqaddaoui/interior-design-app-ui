/**
 * Notification campaigns: admin-authored push messages to client segments.
 *
 * Architecture (all state lives in Postgres, so every serverless instance and every device sees the same truth):
 *   campaigns           the editable definition (kind: once | recurring | trigger) + status / next_at for the scheduler
 *   campaign_deliveries ONE row per (campaign, client, occurrence). The primary key is the idempotency key: a retry, a second
 *                       instance or a repeated tick can never notify the same person twice for the same occurrence.
 *
 * tick() is the single scheduler entry point and is safe to call from anywhere, as often as you like:
 *   1. materialise    due one-time / recurring campaigns -> delivery rows (claim + insert in ONE transaction)
 *   2. automations    evaluate trigger campaigns (signup, first design, no design, inactive) -> delivery rows
 *   3. deliver        due delivery rows -> notifier.deliver() with leases, retries with backoff, quiet hours, frequency cap
 *   4. finalise       one-time campaigns with nothing pending -> `sent`
 * It is called by the sync poll (any open app), the Node timer, the daily Vercel cron and /api/push/pump (point a free external
 * pinger at it for minute-level accuracy when nobody has the app open).
 */
const crypto = require('node:crypto');
const { CAMPAIGN_URL } = require('./notifications');

const DAY = 86400000;
const MIN = 60000;
const TZ_DEFAULT = 'Africa/Casablanca';
/** A recurring run that is later than this when the scheduler finally sees it is skipped (a stale "good morning" is worse than none). */
const CATCH_UP = 12 * 3600000;
const SEGMENTS = ['all', 'new', 'existing', 'inactive', 'image_users', 'no_image'];
const EVENTS = ['signup', 'first_design', 'no_design', 'inactive'];
const LANGS = ['dar', 'ar', 'fr'];
const MAX_ATTEMPTS = 4;
const fail = (status, code) => Object.assign(new Error(code), { status });
const int = (value, min, max, fallback) => (Number.isInteger(value) && value >= min && value <= max ? value : fallback);

/* ------------------------------------------------------------------ time zones (no dependency: Intl only) */
const formatters = new Map();
function localParts(ts, tz) {
  let f = formatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' }); formatters.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(part => [part.type, part.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const offsetAt = (ts, tz) => { const p = localParts(ts, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ts / MIN) * MIN; };
/** Epoch of a wall-clock time in a zone (the second pass fixes the hour around daylight-saving / Ramadan changes). */
function zoned(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetAt(guess, tz);
  return guess - offsetAt(first, tz);
}
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };
const minutesOf = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const isTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));

/** Next run strictly after `after` for a recurring schedule, or null when it has ended. */
function nextRun(s, after) {
  const tz = s.tz || TZ_DEFAULT, [hh, mm] = s.time.split(':').map(Number);
  const start = Math.max(after, (s.startAt || 0) - 1);
  const p0 = localParts(start, tz);
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(p0.y, p0.m - 1, p0.d + i));
    const d = day.getUTCDate(), dow = day.getUTCDay();
    if (!(s.freq === 'daily' || (s.freq === 'weekly' && s.days.includes(dow)) || (s.freq === 'monthly' && d === s.dayOfMonth))) continue;
    const at = zoned(day.getUTCFullYear(), day.getUTCMonth() + 1, d, hh, mm, tz);
    if (at > after && at >= (s.startAt || 0)) return s.endAt && at > s.endAt ? null : at;
  }
  return null;
}
/** Moves a moment out of the quiet window (e.g. 22:00-08:00 local time) to the end of it. */
function afterQuiet(ts, quiet, tz = TZ_DEFAULT) {
  if (!quiet) return ts;
  const from = minutesOf(quiet.from), to = minutesOf(quiet.to), p = localParts(ts, tz), now = p.h * 60 + p.min;
  if (from === to || !(from < to ? now >= from && now < to : now >= from || now < to)) return ts;
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + (from > to && now >= from ? 1 : 0)));
  return zoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(to / 60), to % 60, tz);
}

/* ------------------------------------------------------------------ audience */
const parsePrefs = text => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
/** Can this person receive a push at all: has a device and has not switched notifications off. */
const reachable = c => c.devices > 0 && parsePrefs(c.prefs).notifications !== false;
function inSegment(c, segment, now, o) {
  switch (segment) {
    case 'all': return true;
    case 'new': return c.created_at >= now - o.newDays * DAY;
    case 'existing': return c.created_at < now - o.newDays * DAY;
    case 'inactive': return (c.last_seen ?? c.created_at) < now - o.inactiveDays * DAY;
    case 'image_users': return c.designs > 0;
    case 'no_image': return c.designs === 0;
    default: return false;
  }
}
/** Union of the chosen segments and the hand-picked clients; each client appears once. */
function pick(clients, audience, now) {
  const segments = audience.segments || [], ids = new Set(audience.clientIds || []);
  return clients.filter(c => ids.has(c.id) || segments.some(segment => inSegment(c, segment, now, audience)));
}

/* ------------------------------------------------------------------ validation */
const text = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/ {2,}/g, ' ').trim()).slice(0, max).join('');
function cleanLText(value, max, field) {
  const out = {};
  for (const lang of LANGS) {
    const raw = value?.[lang];
    if (raw !== undefined && typeof raw !== 'string') throw fail(400, `INVALID_${field}`);
    if (typeof raw === 'string' && Array.from(raw.trim()).length > max) throw fail(400, `${field}_TOO_LONG`);
    out[lang] = text(raw, max);
  }
  return out;
}
const hasText = value => LANGS.some(lang => value?.[lang]);

function cleanAudience(input = {}) {
  const segments = [...new Set(Array.isArray(input.segments) ? input.segments : [])];
  if (segments.some(segment => !SEGMENTS.includes(segment))) throw fail(400, 'INVALID_SEGMENT');
  const clientIds = [...new Set(Array.isArray(input.clientIds) ? input.clientIds : [])];
  if (clientIds.length > 500 || clientIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{8,64}$/.test(id))) throw fail(400, 'INVALID_CLIENTS');
  return { segments, clientIds, newDays: int(input.newDays, 1, 365, 7), inactiveDays: int(input.inactiveDays, 1, 365, 14) };
}
function cleanSchedule(input = {}) {
  const tz = input.tz == null ? TZ_DEFAULT : input.tz;
  if (typeof tz !== 'string' || !validTz(tz)) throw fail(400, 'INVALID_TIMEZONE');
  if (!['daily', 'weekly', 'monthly'].includes(input.freq)) throw fail(400, 'INVALID_FREQUENCY');
  if (!isTime(input.time)) throw fail(400, 'INVALID_TIME');
  const days = [...new Set(Array.isArray(input.days) ? input.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [])].sort();
  if (input.freq === 'weekly' && !days.length) throw fail(400, 'INVALID_DAYS');
  const dayOfMonth = int(input.dayOfMonth, 1, 28, 1);
  const bound = value => (value == null ? null : Number.isSafeInteger(value) && value > 0 ? value : (() => { throw fail(400, 'INVALID_DATE'); })());
  const startAt = bound(input.startAt), endAt = bound(input.endAt);
  if (startAt && endAt && endAt <= startAt) throw fail(400, 'INVALID_DATE');
  return { freq: input.freq, time: input.time, days: input.freq === 'weekly' ? days : [], dayOfMonth, tz, startAt, endAt };
}
function cleanTrigger(input = {}) {
  if (!EVENTS.includes(input.event)) throw fail(400, 'INVALID_EVENT');
  const quiet = input.quiet === false ? null : { from: isTime(input.quietFrom) ? input.quietFrom : '22:00', to: isTime(input.quietTo) ? input.quietTo : '08:00' };
  return {
    event: input.event,
    // signup / first_design: minutes after the event. no_design / inactive: whole days.
    delayMinutes: int(input.delayMinutes, 0, 14 * 24 * 60, input.event === 'first_design' ? 60 : 10),
    afterDays: int(input.afterDays, 1, 365, input.event === 'inactive' ? 14 : 3),
    cooldownDays: int(input.cooldownDays, 1, 365, 30),
    includeExisting: input.includeExisting === true,
    quiet: quiet ? quiet.from : null, quietTo: quiet ? quiet.to : null,
  };
}
function cleanCampaign(body, kind) {
  if (!body || typeof body !== 'object') throw fail(400, 'INVALID_CAMPAIGN');
  const name = text(body.name, 80);
  if (!name) throw fail(400, 'NAME_REQUIRED');
  const url = body.url == null || body.url === '' ? '/' : body.url;
  if (typeof url !== 'string' || !CAMPAIGN_URL.test(url)) throw fail(400, 'INVALID_URL');
  const out = { name, title: cleanLText(body.title, 60, 'TITLE'), body: cleanLText(body.body, 140, 'BODY'), url };
  if (kind === 'trigger') out.trigger = cleanTrigger(body.trigger);
  else out.audience = cleanAudience(body.audience);
  if (kind === 'once') {
    const at = body.schedule?.at;
    if (at != null && !(Number.isSafeInteger(at) && at > 0)) throw fail(400, 'INVALID_DATE');
    out.schedule = { at: at ?? null, tz: TZ_DEFAULT };
  }
  if (kind === 'recurring') out.schedule = cleanSchedule(body.schedule);
  return out;
}
/** What must be true before a campaign may go live (a draft can be saved half-written). */
function ready(data, kind) {
  if (!hasText(data.title) || !hasText(data.body)) throw fail(400, 'MESSAGE_REQUIRED');
  if (kind !== 'trigger' && !data.audience.segments.length && !data.audience.clientIds.length) throw fail(400, 'AUDIENCE_REQUIRED');
}

/* ------------------------------------------------------------------ service */
function createCampaigns(db, notifier, { sync, settings = async () => ({}), clock = Date.now } = {}) {
  const toCampaign = row => ({ ...JSON.parse(row.data), id: row.id, kind: row.kind, status: row.status, nextAt: row.next_at ?? null, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) });
  const bump = () => sync.bump('campaigns').catch(() => {});

  async function loadClients(tenantId) {
    const rows = await db.query(`SELECT c.id, c.name, c.created_at, c.last_seen, c.prefs,
      (SELECT COUNT(*) FROM claims k WHERE k.client_id=c.id)::int AS designs,
      (SELECT MIN(k.created_at) FROM claims k WHERE k.client_id=c.id) AS first_design,
      (SELECT COUNT(*) FROM subscriptions s WHERE s.owner_type='client' AND s.owner_id=c.id)::int AS devices
      FROM clients c WHERE c.blocked=0 ${tenantId === undefined ? '' : 'AND c.tenant_id=$1'}`, tenantId === undefined ? [] : [tenantId]);
    return rows.map(row => ({ ...row, created_at: Number(row.created_at), last_seen: row.last_seen == null ? null : Number(row.last_seen), first_design: row.first_design == null ? null : Number(row.first_design), designs: Number(row.designs), devices: Number(row.devices) }));
  }
  async function statsFor(ids) {
    const out = new Map(ids.map(id => [id, { total: 0, sent: 0, pending: 0, skipped: 0, failed: 0, devices: 0 }]));
    if (!ids.length) return out;
    for (const row of await db.query('SELECT campaign_id, status, COUNT(*)::int AS n, COALESCE(SUM(devices),0)::int AS devices FROM campaign_deliveries WHERE campaign_id = ANY($1) GROUP BY campaign_id, status', [ids])) {
      const stat = out.get(row.campaign_id);
      if (!stat || !(row.status in stat)) continue;
      stat[row.status] = Number(row.n); stat.total += Number(row.n); stat.devices += Number(row.devices);
    }
    return out;
  }
  async function insertDeliveries(q, campaignId, items, occurrence, nextAt, now) {
    let inserted = 0;
    for (let i = 0; i < items.length; i += 200) {
      const chunk = items.slice(i, i + 200), values = [], params = [];
      chunk.forEach((item, j) => {
        const b = j * 6;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},'pending',0,$${b + 5},$${b + 6})`);
        params.push(`${campaignId}:${item.client.id}:${item.occurrence ?? occurrence}`, campaignId, item.client.id, item.occurrence ?? occurrence, item.at ?? nextAt, now);
      });
      inserted += (await q(`INSERT INTO campaign_deliveries(id,campaign_id,client_id,occurrence,status,attempts,next_at,created_at) VALUES ${values.join(',')} ON CONFLICT (id) DO NOTHING RETURNING id`, params)).length;
    }
    return inserted;
  }
  const getRow = async id => (await db.query('SELECT * FROM campaigns WHERE id=$1', [id]))[0];
  /** `tenantId` (admin calls): a campaign of another tenant is simply not found. Omitted = the scheduler / internal use. */
  const mustGet = async (id, tenantId) => { const row = await getRow(id); if (!row || (tenantId !== undefined && row.tenant_id !== tenantId)) throw fail(404, 'NOT_FOUND'); return row; };
  const save = (row, data, patch = {}) => db.query('UPDATE campaigns SET data=$1, status=$2, next_at=$3, updated_at=$4 WHERE id=$5', [JSON.stringify(data), patch.status ?? row.status, patch.nextAt === undefined ? row.next_at : patch.nextAt, clock(), row.id]);

  /* ---------------- admin operations */
  async function list(tenantId) {
    const rows = tenantId === undefined ? await db.query('SELECT * FROM campaigns ORDER BY updated_at DESC LIMIT 300') : await db.query('SELECT * FROM campaigns WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 300', [tenantId]);
    const stats = await statsFor(rows.map(row => row.id));
    return rows.map(row => ({ ...toCampaign(row), stats: stats.get(row.id) }));
  }
  async function get(id, tenantId) {
    const row = await mustGet(id, tenantId);
    const recent = await db.query(`SELECT d.status, d.devices, d.sent_at, d.reason, d.occurrence, c.name FROM campaign_deliveries d JOIN clients c ON c.id=d.client_id WHERE d.campaign_id=$1 ORDER BY COALESCE(d.sent_at, d.created_at) DESC LIMIT 30`, [id]);
    return { ...toCampaign(row), stats: (await statsFor([id])).get(id), recent: recent.map(r => ({ status: r.status, devices: Number(r.devices), sentAt: r.sent_at == null ? null : Number(r.sent_at), reason: r.reason, name: r.name })) };
  }
  async function create(body, tenantId = 'default') {
    const kind = body?.kind;
    if (!['once', 'recurring', 'trigger'].includes(kind)) throw fail(400, 'INVALID_KIND');
    const data = cleanCampaign(body, kind), id = crypto.randomUUID(), now = clock();
    await db.query('INSERT INTO campaigns(id,kind,data,status,next_at,created_at,updated_at,tenant_id) VALUES($1,$2,$3,$4,NULL,$5,$5,$6)', [id, kind, JSON.stringify(data), 'draft', now, tenantId]);
    await bump();
    return body.live === true ? activate(id, tenantId) : get(id, tenantId);
  }
  async function update(id, body, tenantId) {
    const row = await mustGet(id, tenantId);
    if (row.kind === 'once' && ['sending', 'sent'].includes(row.status)) throw fail(409, 'CAMPAIGN_LOCKED');
    const old = JSON.parse(row.data), data = { ...old, ...cleanCampaign(body, row.kind) };
    const live = ['scheduled', 'active'].includes(row.status);
    if (live) ready(data, row.kind);
    let nextAt = row.next_at;
    if (live && row.kind === 'once') nextAt = data.schedule.at ?? clock();
    if (live && row.kind === 'recurring') { nextAt = nextRun(data.schedule, clock()); if (!nextAt) throw fail(400, 'SCHEDULE_ENDED'); }
    await save(row, data, { nextAt });
    await bump();
    return get(id);
  }
  async function activate(id, tenantId) {
    const row = await mustGet(id, tenantId), data = JSON.parse(row.data), now = clock();
    if (['scheduled', 'active', 'sending'].includes(row.status)) return get(id);
    if (row.status === 'sent') throw fail(409, 'CAMPAIGN_LOCKED');
    ready(data, row.kind);
    let status = 'active', nextAt = null;
    if (row.kind === 'once') { status = 'scheduled'; nextAt = data.schedule.at ?? now; if (nextAt < now - 5 * MIN) throw fail(400, 'DATE_IN_PAST'); }
    if (row.kind === 'recurring') { nextAt = nextRun(data.schedule, now); if (!nextAt) throw fail(400, 'SCHEDULE_ENDED'); }
    await save(row, { ...data, activatedAt: now }, { status, nextAt });
    await bump();
    return get(id);
  }
  async function pause(id, tenantId) {
    const row = await mustGet(id, tenantId), now = clock();
    if (row.status === 'sent' || row.status === 'draft' || row.status === 'paused' || row.status === 'ended') return get(id);
    // Anything not yet delivered is cancelled: resuming never fires a backlog of stale messages.
    await db.query("UPDATE campaign_deliveries SET status='skipped', reason='cancelled' WHERE campaign_id=$1 AND status='pending'", [id]);
    const next = row.kind === 'once' ? (row.status === 'sending' ? 'sent' : 'draft') : 'paused';
    await db.query('UPDATE campaigns SET status=$1, next_at=NULL, updated_at=$2 WHERE id=$3', [next, now, id]);
    await bump();
    return get(id);
  }
  async function remove(id, tenantId) {
    const rows = tenantId === undefined ? await db.query('DELETE FROM campaigns WHERE id=$1 RETURNING id', [id]) : await db.query('DELETE FROM campaigns WHERE id=$1 AND tenant_id=$2 RETURNING id', [id, tenantId]);
    if (!rows.length) throw fail(404, 'NOT_FOUND');
    await bump();
  }
  async function duplicate(id, tenantId) {
    const row = await mustGet(id, tenantId), data = JSON.parse(row.data), now = clock(), copy = crypto.randomUUID();
    const { activatedAt, lastRunAt, lastRunCount, ...rest } = data;
    await db.query('INSERT INTO campaigns(id,kind,data,status,next_at,created_at,updated_at,tenant_id) VALUES($1,$2,$3,$4,NULL,$5,$5,$6)', [copy, row.kind, JSON.stringify({ ...rest, name: text(`${data.name} (copy)`, 80), ...(row.kind === 'once' ? { schedule: { at: null, tz: TZ_DEFAULT } } : {}) }), 'draft', now, row.tenant_id]);
    await bump();
    return get(copy, tenantId);
  }
  /** Audience size for the composer: how many match, how many of those can actually receive a push. */
  async function preview(input, tenantId) {
    const audience = cleanAudience(input), clients = await loadClients(tenantId), now = clock();
    const matched = pick(clients, audience, now);
    return { matched: matched.length, reachable: matched.filter(reachable).length, total: clients.length, reachableTotal: clients.filter(reachable).length };
  }
  async function segments(input = {}, tenantId) {
    const o = cleanAudience({ segments: [], newDays: input.newDays, inactiveDays: input.inactiveDays }), clients = await loadClients(tenantId), now = clock();
    const out = {};
    for (const segment of SEGMENTS) { const members = clients.filter(c => inSegment(c, segment, now, o)); out[segment] = { matched: members.length, reachable: members.filter(reachable).length }; }
    return out;
  }
  /** Clients (name, phone, reachability) for the hand-picked audience. */
  const people = async tenantId => (await (tenantId === undefined ? db.query('SELECT id,name,phone FROM clients WHERE blocked=0 ORDER BY name LIMIT 500') : db.query('SELECT id,name,phone FROM clients WHERE blocked=0 AND tenant_id=$1 ORDER BY name LIMIT 500', [tenantId]))).map(row => ({ id: row.id, name: row.name, whatsapp: row.phone }));

  /* ---------------- scheduler */
  /** One-time and recurring campaigns whose moment has come: claim + create the delivery rows atomically. */
  async function materialise(now) {
    const due = await db.query("SELECT * FROM campaigns WHERE status IN ('scheduled','active') AND kind <> 'trigger' AND next_at IS NOT NULL AND next_at<=$1 ORDER BY next_at LIMIT 20", [now]);
    let changed = false;
    for (const row of due) {
      const c = toCampaign(row), occurrence = row.kind === 'once' ? 'once' : `r${row.next_at}`;
      const recurring = row.kind === 'recurring', next = recurring ? nextRun(c.schedule, now) : null;
      const skipped = recurring && now - row.next_at > CATCH_UP;
      const audience = skipped ? [] : pick(await loadClients(row.tenant_id), c.audience, now).filter(reachable);
      const data = { ...JSON.parse(row.data), lastRunAt: now, lastRunCount: audience.length, ...(skipped ? { lastRunSkipped: true } : { lastRunSkipped: false }) };
      const status = recurring ? (next ? 'active' : 'ended') : 'sending';
      const claimed = await db.tx(async q => {
        const won = await q("UPDATE campaigns SET status=$1, next_at=$2, data=$3, updated_at=$4 WHERE id=$5 AND next_at=$6 AND updated_at=$7 AND status IN ('scheduled','active') RETURNING id", [status, next, JSON.stringify(data), now, row.id, row.next_at, row.updated_at]);
        if (!won.length) return false;
        await insertDeliveries(q, row.id, audience.map(client => ({ client })), occurrence, now, now);
        return true;
      });
      changed = changed || claimed;
    }
    return changed;
  }
  /** Automations: who has just become eligible for each active trigger campaign. */
  async function automations(now) {
    const rows = await db.query("SELECT * FROM campaigns WHERE kind='trigger' AND status='active'");
    if (!rows.length) return false;
    const byTenant = new Map(); // an automation only ever reaches the clients of its own tenant
    const tenantClients = async id => { if (!byTenant.has(id)) byTenant.set(id, (await loadClients(id)).filter(reachable)); return byTenant.get(id); };
    let changed = false;
    for (const row of rows) {
      const clients = await tenantClients(row.tenant_id);
      const c = toCampaign(row), t = c.trigger, since = Math.max(c.activatedAt || 0, now - 7 * DAY), items = [];
      const recent = t.event === 'inactive' ? new Map((await db.query('SELECT client_id, MAX(created_at) AS at FROM campaign_deliveries WHERE campaign_id=$1 GROUP BY client_id', [row.id])).map(r => [r.client_id, Number(r.at)])) : null;
      for (const client of clients) {
        const lastActive = client.last_seen ?? client.created_at;
        if (t.event === 'signup' && client.created_at >= since && client.created_at + t.delayMinutes * MIN <= now) items.push({ client, occurrence: 'once' });
        else if (t.event === 'first_design' && client.first_design && client.first_design >= since && client.first_design + t.delayMinutes * MIN <= now) items.push({ client, occurrence: 'once' });
        else if (t.event === 'no_design' && client.designs === 0 && client.created_at + t.afterDays * DAY <= now && (t.includeExisting || client.created_at + t.afterDays * DAY >= (c.activatedAt || 0))) items.push({ client, occurrence: 'once' });
        else if (t.event === 'inactive' && lastActive + t.afterDays * DAY <= now && (t.includeExisting || lastActive + t.afterDays * DAY >= (c.activatedAt || 0)) && !(recent.get(client.id) > now - t.cooldownDays * DAY)) items.push({ client, occurrence: `ls${lastActive}` });
      }
      if (!items.length) continue;
      const quiet = t.quiet ? { from: t.quiet, to: t.quietTo } : null;
      const inserted = await db.tx(q => insertDeliveries(q, row.id, items.map(item => ({ ...item, at: afterQuiet(now, quiet) })), 'once', now, now));
      changed = changed || inserted > 0;
    }
    return changed;
  }
  /** Sends due delivery rows. Bounded by `deadline`; returns how many rows were settled. */
  async function deliverDue(now, deadline) {
    const paused = !(await notifier.enabled('client'));
    const cap = Number((await settings().catch(() => ({}))).campaignCapHours ?? 24) * 3600000;
    const due = await db.query("SELECT d.*, c.name AS client_name FROM campaign_deliveries d JOIN clients c ON c.id=d.client_id WHERE d.status='pending' AND d.next_at<=$1 ORDER BY d.next_at LIMIT 200", [now]);
    const cache = new Map();
    const campaign = async id => { if (!cache.has(id)) { const row = await getRow(id); cache.set(id, row ? toCampaign(row) : null); } return cache.get(id); };
    let settled = 0;
    const settle = (d, status, patch = {}) => db.query('UPDATE campaign_deliveries SET status=$1, attempts=$2, next_at=$3, devices=$4, reason=$5, sent_at=$6, completed=$7 WHERE id=$8', [status, patch.attempts ?? d.attempts, patch.nextAt ?? d.next_at, patch.devices ?? d.devices, patch.reason ?? null, patch.sentAt ?? null, patch.completed ?? d.completed, d.id]);
    async function one(d) {
      const leased = await db.query("UPDATE campaign_deliveries SET next_at=$1 WHERE id=$2 AND next_at=$3 AND status='pending' RETURNING id", [now + 2 * MIN, d.id, d.next_at]);
      if (!leased.length) return;
      const c = await campaign(d.campaign_id);
      if (!c) return void (settled++, await settle(d, 'skipped', { reason: 'cancelled' }));
      if (paused) return void (settled++, await settle(d, 'skipped', { reason: 'paused' }));
      // Automations respect a frequency cap across all campaigns: postpone (up to 3 days after creation), never drop silently within that window.
      if (c.kind === 'trigger' && cap > 0) {
        const last = (await db.query("SELECT MAX(sent_at) AS at FROM campaign_deliveries WHERE client_id=$1 AND status='sent'", [d.client_id]))[0]?.at;
        if (last && Number(last) + cap > now) {
          const wait = Number(last) + cap;
          if (wait > Number(d.created_at) + 3 * DAY) { settled++; return void await settle(d, 'skipped', { reason: 'capped' }); }
          return void await db.query('UPDATE campaign_deliveries SET next_at=$1 WHERE id=$2', [wait, d.id]);
        }
      }
      let result;
      try { result = await notifier.deliver({ id: c.id, name: d.client_name, title: c.title, body: c.body, url: c.url }, JSON.parse(d.completed || '[]'), { event: 'campaign', audience: { type: 'client', id: d.client_id } }); }
      catch { result = { retry: true, completed: JSON.parse(d.completed || '[]'), sent: 0 }; }
      const devices = Number(d.devices) + result.sent, completed = JSON.stringify(result.completed), attempts = Number(d.attempts) + 1;
      if (result.retry && attempts < MAX_ATTEMPTS) return void await settle(d, 'pending', { attempts, devices, completed, nextAt: clock() + 60000 * 2 ** attempts });
      settled++;
      if (devices > 0) await settle(d, 'sent', { attempts, devices, completed, sentAt: clock() });
      else await settle(d, result.retry ? 'failed' : 'skipped', { attempts, completed, reason: result.retry ? 'delivery_failed' : 'no_device' });
    }
    for (let i = 0; i < due.length && clock() < deadline; i += 8) await Promise.all(due.slice(i, i + 8).map(one));
    return settled;
  }
  async function finalise(now) {
    const done = await db.query("UPDATE campaigns SET status='sent', updated_at=$1 WHERE status='sending' AND NOT EXISTS (SELECT 1 FROM campaign_deliveries d WHERE d.campaign_id=campaigns.id AND d.status='pending') RETURNING id", [now]);
    return done.length > 0;
  }

  let localAt = 0, running = null;
  /** Cross-instance throttle: at most one instance runs a tick every 10 s (a poll from any open app triggers it). */
  async function claimTick(now) {
    await db.query("INSERT INTO settings(key,value) VALUES('campaign_tick','0') ON CONFLICT (key) DO NOTHING");
    return (await db.query("UPDATE settings SET value=$1 WHERE key='campaign_tick' AND CAST(value AS BIGINT) <= $2 RETURNING key", [String(now), now - 10000])).length > 0;
  }
  async function tick({ force = false, budgetMs = 8000 } = {}) {
    const now = clock();
    if (running) return running;
    if (!force && now - localAt < 10000) return { skipped: true };
    localAt = now;
    running = (async () => {
      try {
        if (!force && !(await claimTick(now))) return { skipped: true };
        const deadline = now + budgetMs;
        let changed = await materialise(now);
        changed = await automations(now) || changed;
        const settled = await deliverDue(now, deadline);
        changed = await finalise(now) || settled > 0 || changed;
        if (changed) await bump();
        return { ok: true, settled };
      } catch (error) { console.warn('Campaign tick failed', error.code || error.message); return { ok: false }; }
      finally { running = null; }
    })();
    return running;
  }
  return { list, get, create, update, activate, pause, remove, duplicate, preview, segments, people, tick };
}

module.exports = { createCampaigns, nextRun, afterQuiet, localParts, zoned, pick, inSegment, reachable, cleanCampaign, SEGMENTS, EVENTS, TZ_DEFAULT };
