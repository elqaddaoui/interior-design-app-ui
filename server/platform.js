/**
 * Platform allowances and the API manager (docs/MULTI_TENANT_PLAN.md, "Credits and API manager").
 *
 *   - Store credits: `saas_tenants.credit_limit` (NULL = unlimited) and `credits_used`. One AI image generation = one credit. The
 *     counter is moved by ONE atomic UPDATE (`consume`), so two parallel renders can never pass the limit together.
 *   - API policy per store: `api_mode` 'own' (the store's administrators keep their own keys: today's behaviour) or 'platform'
 *     (keys come from the API manager; the store's own keys, model keys and custom URLs are ignored, so a store administrator can
 *     never make the platform key travel to an address they chose).
 *   - API manager: `saas_apis` rows (image / text / other). One default per kind is shared by every platform-managed store; a store may
 *     be linked to a specific connection instead (`api_links`). Secret keys are stored, never returned by any route.
 *
 * Only the super admin console writes here (server/superadmin.js). Tenant modules receive `forTenant(id)`: a read-and-meter handle
 * bound to ONE tenant id taken from the resolved tenant, never from request data.
 */
const crypto = require('node:crypto');
const { PROVIDERS, safeUrl } = require('./chat');
const { createUsage } = require('./usage');

const fail = (status, message) => Object.assign(new Error(message), { status });
const KINDS = ['image', 'text', 'other'];
const IMAGE_PROVIDERS = ['pollinations', 'openai'];
const TEXT_PROVIDERS = [...Object.keys(PROVIDERS).filter(id => PROVIDERS[id].env), 'custom'];
const KEY_RE = /^[A-Za-z0-9_.\-]{12,300}$/;
const MAX_CREDITS = 100000000;
const clean = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const num = value => (value == null ? null : Number(value));
const newId = () => `api_${crypto.randomBytes(5).toString('hex')}`;

/** What each kind may connect to (the console builds its form from this). */
const CATALOG = {
  image: IMAGE_PROVIDERS.map(id => ({ id, label: id === 'openai' ? 'OpenAI-compatible' : 'Pollinations', needsUrl: id === 'openai', needsModel: false })),
  text: TEXT_PROVIDERS.map(id => ({ id, label: id === 'custom' ? 'OpenAI-compatible (custom)' : PROVIDERS[id].label, needsUrl: id === 'custom', needsModel: id === 'custom' })),
  other: [{ id: 'other', label: 'Other / future API', needsUrl: false, needsModel: false }],
};

/** A demo's "use API" switch slides forward while the demo is used and lapses after this much quiet time (DEMO_AI_IDLE_MIN, default 15 minutes). */
const idleMs = env => Math.max(60000, Math.min(86400000, (Number(env.DEMO_AI_IDLE_MIN) || 15) * 60000));

function createPlatform(db, { env = process.env, clock = Date.now, mailer } = {}) {
  const usage = createUsage(db, { env, clock, mailer });
  const IDLE = idleMs(env);
  // Serverless instances keep no cache (each only sees a fraction of the writes); the long-running server keeps 5 s.
  const ttl = env.VERCEL ? 0 : 5000;
  let apisCache = { at: -Infinity, rows: [] };
  const policies = new Map(); // tenant id -> { at, mode, links }
  const forget = () => { apisCache = { at: -Infinity, rows: [] }; policies.clear(); };

  async function apiRows() {
    if (ttl && clock() - apisCache.at < ttl) return apisCache.rows;
    apisCache = { at: clock(), rows: await db.query('SELECT * FROM saas_apis ORDER BY created_at, id') };
    return apisCache.rows;
  }
  async function policyOf(tenantId) {
    const hit = policies.get(tenantId);
    if (ttl && hit && clock() - hit.at < ttl) return hit;
    const row = (await db.query('SELECT api_mode, api_links FROM saas_tenants WHERE id=$1', [tenantId]))[0];
    let links = {};
    try { links = JSON.parse(row?.api_links || '{}') || {}; } catch { /* corrupt value = no links */ }
    const value = { at: clock(), mode: row?.api_mode === 'platform' ? 'platform' : 'own', links };
    policies.set(tenantId, value);
    if (policies.size > 2000) policies.delete(policies.keys().next().value);
    return value;
  }

  /**
   * The connection a platform-managed store must use for `kind`, or null when the store manages its own keys.
   * `{ api: null }` = managed but nothing connected yet (the store then has no key at all: it never falls back to its own).
   */
  async function managed(tenantId, kind) {
    const policy = await policyOf(tenantId);
    if (policy.mode !== 'platform') return null;
    const rows = (await apiRows()).filter(row => row.kind === kind && row.enabled);
    const row = rows.find(r => r.id === policy.links[kind]) || rows.find(r => r.is_default);
    return { api: row ? { id: row.id, provider: row.provider, key: row.api_key, base: row.base_url, model: row.model, label: row.label } : null };
  }

  /** One atomic step: take `n` credits unless that would pass the store's limit. */
  async function consume(tenantId, n = 1, onChange) {
    if ((await db.query('UPDATE saas_tenants SET credits_used=credits_used+$2 WHERE id=$1 AND (credit_limit IS NULL OR credits_used+$2<=credit_limit) RETURNING credits_used', [tenantId, n])).length) { await onChange?.(); return true; }
    // Refused only when the store exists and is at its limit. No registry row (e.g. a bare single-tenant database) = nothing to meter.
    return !(await db.query('SELECT 1 FROM saas_tenants WHERE id=$1', [tenantId])).length;
  }
  /** Read-only look: could this store take `n` more credits right now? (the real, atomic check stays in `consume`). A store with no registry row is not metered. */
  async function hasRoom(tenantId, n = 1) {
    const row = (await db.query('SELECT credit_limit, credits_used FROM saas_tenants WHERE id=$1', [tenantId]))[0];
    return !row || row.credit_limit == null || Number(row.credits_used) + n <= Number(row.credit_limit);
  }
  /** `onChange` (given by the store's bundle) bumps the store's own 'credits' sync version, so its open admin screens re-read the allowance. */
  const refund = async (tenantId, n = 1, onChange) => { await db.query('UPDATE saas_tenants SET credits_used=GREATEST(0, credits_used-$2) WHERE id=$1', [tenantId, n]); await onChange?.(); };

  /** What the store has handed out to its clients: every displayed balance (credits + the unused free design). Read-only look at the tenant's own rows. */
  const allocatedTo = async tenantId => Number((await db.query('SELECT COALESCE(SUM(credits + CASE WHEN free_used=0 THEN 1 ELSE 0 END),0) AS n FROM clients WHERE tenant_id=$1', [tenantId]))[0].n);
  /** The store's shared pool: { limit, used } (limit NULL = unlimited). A store with no registry row is not metered. */
  async function budget(tenantId, q = db.query) { // `q`: the caller's transaction (a second connection would deadlock a single-connection database)
    const row = (await q('SELECT credit_limit, credits_used FROM saas_tenants WHERE id=$1', [tenantId]))[0];
    return row ? { limit: num(row.credit_limit), used: Number(row.credits_used) } : { limit: null, used: 0 };
  }

  /**
   * The AI gate, asked before ANY outgoing AI call of a store (image, chat, translation ...).
   *   - A store whose AI was paused (by the owner, or automatically by the abuse detector) is refused: AI_PAUSED.
   *   - A DEMO may only use an API while its "use API" switch is on (saas_tenants.ai_until in the future). Every allowed call pushes the
   *     deadline forward, so the switch lapses by itself after a quiet period and must be switched on again by hand.
   * Refusals are counted (as `blocked`) so repeated probing of a closed demo is visible and can raise an alert.
   */
  async function gate(tenantId, kind = 'other', op = 'call') {
    const row = (await db.query('SELECT kind, ai_until, ai_paused, api_mode FROM saas_tenants WHERE id=$1', [tenantId]))[0];
    if (!row) return;
    const now = clock();
    const code = row.ai_paused ? 'AI_PAUSED' : row.kind === 'demo' && !(row.ai_until != null && Number(row.ai_until) > now) ? 'AI_DISABLED_DEMO' : '';
    if (code) {
      await usage.record(tenantId, { kind, op, provider: 'gate', mode: row.api_mode, blocked: true });
      throw Object.assign(fail(code === 'AI_PAUSED' ? 403 : 503, code), { gate: code });
    }
    if (row.kind === 'demo' && Number(row.ai_until) - now < IDLE * 0.8) await db.query("UPDATE saas_tenants SET ai_until=$2 WHERE id=$1 AND kind='demo'", [tenantId, now + IDLE]);
  }
  const allowed = async (tenantId, kind, op) => { try { await gate(tenantId, kind, op); return true; } catch (error) { if (error.gate) return false; throw error; } };

  /** The handle tenant modules receive. The id is fixed at construction (bundle.js), so no caller can name another tenant. */
  const forTenant = (tenantId, { onChange } = {}) => ({
    managed: kind => managed(tenantId, kind),
    hasRoom: n => hasRoom(tenantId, n),
    consume: n => consume(tenantId, n, onChange),
    refund: n => refund(tenantId, n, onChange),
    budget: q => budget(tenantId, q),
    /** Throws (`error.gate`) when this store may not call an AI API right now. */
    gate: (kind, op) => gate(tenantId, kind, op),
    allowed: (kind, op) => allowed(tenantId, kind, op),
    /** Count one outgoing call: { kind: image | text | other, op, provider, units, ok }. Never throws. */
    record: async spec => { try { await usage.record(tenantId, { ...spec, mode: (await policyOf(tenantId)).mode }); } catch { /* metering never breaks the feature */ } },
  });

  /**
   * What the store's own administrators may see about their allowance and API policy (no keys, no other store).
   * Pool: the store's limit is SHARED by all its clients. `allocated` = credits handed out to clients, `available` = what can still be handed out,
   * `over` = how far the commitment (used + allocated) is past the limit (e.g. after the limit was lowered).
   */
  async function infoOf(tenantId) {
    const row = (await db.query('SELECT credit_limit, credits_used, api_mode, ai_paused FROM saas_tenants WHERE id=$1', [tenantId]))[0];
    if (!row) return { credits: { limit: null, used: 0, left: null, allocated: 0, available: null, over: 0, state: 'ok' }, apiMode: 'own', aiPaused: false };
    const limit = num(row.credit_limit), used = Number(row.credits_used);
    const allocated = await allocatedTo(tenantId);
    const committed = used + allocated;
    const over = limit == null ? 0 : Math.max(0, committed - limit);
    const state = limit == null ? 'ok' : over > 0 ? 'over' : limit > 0 && committed / limit >= 0.9 ? 'near' : 'ok';
    return {
      credits: { limit, used, left: limit == null ? null : Math.max(0, limit - used), allocated, available: limit == null ? null : Math.max(0, limit - committed), over, state },
      apiMode: row.api_mode === 'platform' ? 'platform' : 'own', aiPaused: !!row.ai_paused,
    };
  }

  // ---------- Console: AI switches ----------
  /** The "use API" switch of a demo. On = until now + the idle window; off = closed at once. Only demos have it. */
  async function setDemoAi(tenantId, enabled) {
    const until = enabled ? clock() + IDLE : null;
    const rows = await db.query("UPDATE saas_tenants SET ai_until=$2, updated_at=$3 WHERE id=$1 AND kind='demo' RETURNING id", [tenantId, until, clock()]);
    if (!rows.length) throw fail(404, 'NOT_FOUND');
    return until;
  }
  /** Pause / resume every AI call of one store. Resuming also closes that store's open alerts, so a repeat of the abuse is caught again. */
  async function setPaused(tenantId, paused, reason = '') {
    await db.query('UPDATE saas_tenants SET ai_paused=$2, ai_pause_reason=$3, updated_at=$4 WHERE id=$1', [tenantId, paused ? 1 : 0, paused ? String(reason).slice(0, 80) : '', clock()]);
    if (!paused) await db.query("UPDATE saas_alerts SET status='resolved', resolved_at=$2 WHERE tenant_id=$1 AND status='open'", [tenantId, clock()]);
  }
  /** Console view of a store's AI switches (row = a saas_tenants row). */
  const aiView = row => {
    const until = row.ai_until == null ? null : Number(row.ai_until);
    return { aiOn: row.kind === 'demo' ? until != null && until > clock() : true, aiUntil: row.kind === 'demo' ? until : null, aiPaused: !!row.ai_paused, aiPauseReason: row.ai_pause_reason || '', aiIdleMin: Math.round(IDLE / 60000) };
  };

  // ---------- Console: the allowance and policy of one store ----------
  /** Validated policy fields as SQL column values (only the fields present in `body`). */
  function policyFields(body, { forCreate = false } = {}) {
    const next = {};
    if (body?.creditLimit !== undefined) {
      if (body.creditLimit === null || body.creditLimit === '') next.credit_limit = null;
      else {
        const value = Number(body.creditLimit);
        if (!Number.isInteger(value) || value < 0 || value > MAX_CREDITS) throw fail(400, 'INVALID_CREDIT_LIMIT');
        next.credit_limit = value;
      }
    }
    if (body?.apiMode !== undefined) {
      if (!['own', 'platform'].includes(body.apiMode)) throw fail(400, 'INVALID_API_MODE');
      next.api_mode = body.apiMode;
    }
    if (body?.apiLinks !== undefined) {
      if (!body.apiLinks || typeof body.apiLinks !== 'object' || Array.isArray(body.apiLinks)) throw fail(400, 'INVALID_API_LINKS');
      next.api_links = body.apiLinks;
    }
    if (forCreate && next.api_links) throw fail(400, 'INVALID_API_LINKS'); // links need existing connections: set them after creation
    return next;
  }
  /** Checks that each link names an existing connection of that kind, then returns the JSON to store. */
  async function checkLinks(links) {
    const rows = await apiRows();
    const out = {};
    for (const [kind, id] of Object.entries(links)) {
      if (!KINDS.includes(kind)) throw fail(400, 'INVALID_API_LINKS');
      if (id === null || id === '') continue; // no link = the shared default
      if (!rows.some(row => row.id === id && row.kind === kind)) throw fail(400, 'API_NOT_FOUND');
      out[kind] = id;
    }
    return JSON.stringify(out);
  }
  async function setPolicy(tenantId, body) {
    const next = policyFields(body);
    if (next.api_links) { apisCache.at = -Infinity; next.api_links = await checkLinks(next.api_links); }
    if (body?.resetUsed === true) next.credits_used = 0;
    const keys = Object.keys(next);
    if (keys.length) await db.query(`UPDATE saas_tenants SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => next[k]), Date.now(), tenantId]);
    forget();
    return Object.keys(next);
  }

  // ---------- Console: the API manager ----------
  const apiView = (row, linked = 0) => ({
    id: row.id, kind: row.kind, provider: row.provider, label: row.label, baseUrl: row.base_url, model: row.model,
    enabled: !!row.enabled, isDefault: !!row.is_default, hasKey: !!row.api_key, keyHint: row.api_key ? `…${row.api_key.slice(-4)}` : '',
    stores: linked, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  });
  /** How many platform-managed stores use each connection (explicit link, or the default of its kind). */
  async function linkedCounts() {
    const stores = await db.query("SELECT api_mode, api_links FROM saas_tenants WHERE kind IN ('default','instance') AND api_mode='platform'");
    const rows = await apiRows();
    const count = new Map();
    for (const store of stores) {
      let links = {};
      try { links = JSON.parse(store.api_links || '{}') || {}; } catch { /* none */ }
      for (const kind of KINDS) {
        const usable = rows.filter(row => row.kind === kind && row.enabled);
        const row = usable.find(r => r.id === links[kind]) || usable.find(r => r.is_default);
        if (row) count.set(row.id, (count.get(row.id) || 0) + 1);
      }
    }
    return count;
  }
  async function list() {
    apisCache.at = -Infinity;
    const count = await linkedCounts();
    return (await apiRows()).map(row => apiView(row, count.get(row.id) || 0));
  }
  function cleanApi(body, previous) {
    const kind = previous ? previous.kind : body?.kind;
    if (!KINDS.includes(kind)) throw fail(400, 'INVALID_KIND');
    const out = {};
    const provider = body?.provider === undefined ? previous?.provider : clean(body.provider, 40).toLowerCase();
    const allowed = kind === 'image' ? IMAGE_PROVIDERS : kind === 'text' ? TEXT_PROVIDERS : null;
    if (!provider || (allowed ? !allowed.includes(provider) : !/^[a-z0-9][a-z0-9_-]{1,39}$/.test(provider))) throw fail(400, 'INVALID_PROVIDER');
    out.provider = provider;
    const needsUrl = (kind === 'image' && provider === 'openai') || (kind === 'text' && provider === 'custom') || kind === 'other';
    if (body?.baseUrl !== undefined || !previous) {
      const raw = clean(body?.baseUrl, 300);
      if (needsUrl && raw) { const safe = safeUrl(raw); if (!safe) throw fail(400, 'INVALID_URL'); out.base_url = safe.replace(/\/+$/, ''); }
      else if (needsUrl && kind === 'text') throw fail(400, 'INVALID_URL');
      else out.base_url = '';
    }
    if (body?.model !== undefined || !previous) out.model = clean(body?.model, 120);
    if (kind === 'text' && provider === 'custom' && !(out.model ?? previous?.model)) throw fail(400, 'INVALID_MODEL');
    if (body?.label !== undefined || !previous) out.label = clean(body?.label, 60) || (CATALOG[kind].find(p => p.id === provider)?.label ?? provider);
    const key = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (key) {
      if (kind === 'other' ? key.length < 4 || key.length > 500 || /[\u0000-\u001f]/.test(key) : !KEY_RE.test(key)) throw fail(400, 'INVALID_KEY');
      out.api_key = key;
    } else if (!previous) throw fail(400, 'INVALID_KEY');
    if (body?.enabled !== undefined) out.enabled = body.enabled ? 1 : 0;
    return { kind, out };
  }
  async function create(body) {
    const { kind, out } = cleanApi(body, null);
    const id = newId(), now = Date.now();
    const exists = (await db.query('SELECT COUNT(*) AS n FROM saas_apis WHERE kind=$1', [kind]))[0];
    if (Number(exists.n) >= 30) throw fail(409, 'TOO_MANY_APIS');
    const first = Number(exists.n) === 0;
    await db.tx(async q => {
      const makeDefault = body?.isDefault === true || first;
      if (makeDefault) await q('UPDATE saas_apis SET is_default=0 WHERE kind=$1', [kind]);
      await q('INSERT INTO saas_apis(id,kind,provider,label,api_key,base_url,model,enabled,is_default,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',
        [id, kind, out.provider, out.label, out.api_key, out.base_url, out.model, out.enabled ?? 1, makeDefault ? 1 : 0, now]);
    });
    forget();
    return apiView((await db.query('SELECT * FROM saas_apis WHERE id=$1', [id]))[0]);
  }
  async function update(id, body) {
    const row = (await db.query('SELECT * FROM saas_apis WHERE id=$1', [String(id)]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    const { out } = cleanApi(body || {}, row);
    await db.tx(async q => {
      if (body?.isDefault === true) { await q('UPDATE saas_apis SET is_default=0 WHERE kind=$1', [row.kind]); out.is_default = 1; }
      if (body?.isDefault === false && row.is_default) throw fail(400, 'DEFAULT_REQUIRED'); // choose another default instead
      const keys = Object.keys(out);
      if (keys.length) await q(`UPDATE saas_apis SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => out[k]), Date.now(), row.id]);
    });
    forget();
    return apiView((await db.query('SELECT * FROM saas_apis WHERE id=$1', [row.id]))[0]);
  }
  /** Removes a connection; stores linked to it fall back to the shared default of that kind. The oldest remaining one becomes the default. */
  async function remove(id) {
    const row = (await db.query('SELECT * FROM saas_apis WHERE id=$1', [String(id)]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    await db.tx(async q => {
      await q('DELETE FROM saas_apis WHERE id=$1', [row.id]);
      for (const store of await q("SELECT id, api_links FROM saas_tenants WHERE api_links LIKE $1", [`%${row.id}%`])) {
        let links = {};
        try { links = JSON.parse(store.api_links) || {}; } catch { /* reset below */ }
        for (const kind of Object.keys(links)) if (links[kind] === row.id) delete links[kind];
        await q('UPDATE saas_tenants SET api_links=$1 WHERE id=$2', [JSON.stringify(links), store.id]);
      }
      if (row.is_default) await q('UPDATE saas_apis SET is_default=1 WHERE id=(SELECT id FROM saas_apis WHERE kind=$1 ORDER BY created_at, id LIMIT 1)', [row.kind]);
    });
    forget();
    return row;
  }

  return { managed, consume, refund, forTenant, infoOf, setPolicy, policyFields, checkLinks, list, create, update, remove, forget, CATALOG, usage, gate, setDemoAi, setPaused, aiView, allocatedTo, budget };
}

module.exports = { createPlatform, KINDS };
