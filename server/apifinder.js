/**
 * API finder (Super admin > APIs > Online APIs): finds, PROVES and ranks the best free interior-design image APIs available right now.
 *
 * Why not just a list: model catalogues lie by omission (a model can be listed and broken, "free" and out of quota, "photo capable" and
 * silently ignoring the photo). So every candidate goes through four steps, and only the third one is trusted over the others:
 *
 *   1. DISCOVER  five public sources in parallel, each isolated (one outage never blocks the rest, each reports ok / error / count / ms):
 *                Pollinations (the engine the app already speaks), Pollinations keyless, OpenRouter, Hugging Face Inference Providers, AI Horde.
 *                Paid models are counted and dropped: only free / free-tier ones are kept.
 *   2. SCORE     a transparent 0-100 score: capability for THIS app (photo-to-photo editing matters most), quality prior, price, the
 *                provider's own health figure, live proof and stability. Every point is listed as a reason on screen.
 *   3. PROVE     a real generation with a fixed interior prompt (and, for photo-capable models, a real edit of that picture), checked for
 *                what an engine can fake: real image bytes, sensible size, not a blank / flat frame, edit differs from the input. Latency is
 *                measured. A 429 / quota answer is "inconclusive" (never counted as a failure), a 401 / 402 says the key is the problem.
 *   4. FEED BACK `chain(i2i)` = the proven, fresh, not-banned models of an engine the app can call. With the Autopilot switch on, the image
 *                generator tries them BEFORE its built-in list (server/imagegen), so a model that stopped working is dropped by itself and a
 *                new good one is picked up by itself. The built-in list stays as the safety net behind them.
 *
 * Everything is stored in the platform table saas_kv (no schema change): `finder_settings`, `finder_state`, `finder_lock`. A scan holds a
 * lock so two serverless instances never run it twice. Keys are only READ here (never returned): a key held in the API manager, or the host
 * variable, is used to run the probes. `fetch` and `clock` are injectable for tests.
 */
const { Buffer } = require('node:buffer');
const { sniffMime, imageSize } = require('./imagegen/image');

const SETTINGS_KEY = 'finder_settings';
const STATE_KEY = 'finder_state';
const LOCK_KEY = 'finder_lock';
const DEFAULTS = { autoScan: true, intervalHours: 6, autopilot: false, probeMax: 4, banned: [] };
const HOUR = 3600000;
const FRESH_MS = 48 * HOUR; // a proof older than this no longer feeds the render chain
const FORGET_MS = 7 * 86400000; // a candidate no source lists any more is forgotten after this
const MAX_CANDIDATES = 160;
const PROBE_PROMPT = 'Photorealistic interior photograph of a bright modern living room, linen sofa, oak floor, large window, soft natural daylight, 35mm lens';
const EDIT_PROMPT = 'Redesign this room: change the sofa to a deep green velvet sofa, keep the room layout, walls, window and floor exactly as they are';

const SOURCES = {
  pollinations: { label: 'Pollinations', keyUrl: 'https://enter.pollinations.ai/keys', docs: 'https://gen.pollinations.ai/image/models' },
  keyless: { label: 'Pollinations (no key)', keyUrl: '', docs: 'https://image.pollinations.ai/models' },
  openrouter: { label: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', docs: 'https://openrouter.ai/models?output_modalities=image' },
  huggingface: { label: 'Hugging Face', keyUrl: 'https://huggingface.co/settings/tokens', docs: 'https://huggingface.co/models?pipeline_tag=text-to-image&inference_provider=all' },
  horde: { label: 'AI Horde', keyUrl: '', docs: 'https://aihorde.net/api/v2/status/models?type=image' },
};
const POLLINATIONS_BASE = 'https://gen.pollinations.ai/v1';

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const text = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const fail = (status, message) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------------ quality prior: a lineage heuristic, NOT a benchmark (the live proof is what decides) */
const PRIORS = [
  [/gpt-image-2|nano-banana-(?:pro|2)|seedream-5|flux-3-image$|flux\.2-(?:max|pro)|qwen-image-3/i, 19],
  [/flux\.1-kontext|flux\.2-flex|flux-3-image-klein|qwen-image-2|mai-image-2\.[67]|grok-imagine|riverflow|krea/i, 16],
  [/flux\.2-klein|flux\.1\.1-pro|seedream|recraft|nano|gemini|gpt-image|hy-image|muse|mai-image/i, 14],
  [/z-image|schnell|lightning|flux/i, 12],
  [/sdxl|juggernaut|albedo|realistic|icbinp|dreamshaper|deliberate|epicrealism|stable[- ]diffusion/i, 8],
  [/sana/i, 5],
];
const qualityPrior = name => (PRIORS.find(([re]) => re.test(name)) || [null, 6])[1];

/* ------------------------------------------------------------------ 1. DISCOVER: one pure normaliser per source (tested with recorded answers) */
const base = (source, fields) => ({
  source, engine: null, tier: 'free-tier', i2i: false, refs: 0, connectable: false, needsKey: false, health: null, latencyHint: null, community: false, note: '', ...fields,
});

/** gen.pollinations.ai/image/models. Free = not paid_only. The only source the app can call today (engine "pollinations"). */
function fromPollinations(list) {
  const out = []; let paid = 0;
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.name !== 'string' || m.category !== 'image' || !(m.output_modalities || []).includes('image')) continue;
    if (m.paid_only) { paid++; continue; }
    const i2i = (m.input_modalities || []).includes('image');
    out.push(base('pollinations', {
      id: `pollinations:${m.name}`, provider: 'pollinations', engine: 'pollinations', model: m.name, title: text(m.title || m.name, 80), publisher: text(m.publisher, 40),
      i2i, refs: i2i ? clamp(Number(m.max_reference_images) || 1, 1, 10) : 0, connectable: true, needsKey: true,
      community: m.community === true || /^community\//.test(m.name),
      health: m.health && Number.isFinite(Number(m.health.success_rate)) ? { rate: Number(m.health.success_rate), requests: Number(m.health.requests) || 0, status: String(m.health.status || '') } : null,
      note: m.per_user_rpm ? `${m.per_user_rpm} requests / min` : '',
    }));
  }
  return { items: out, paid };
}

/** image.pollinations.ai/models: the legacy endpoint that answers WITHOUT any key (text-to-image only). */
function fromKeyless(list) {
  const out = [];
  for (const name of Array.isArray(list) ? list : []) {
    if (typeof name !== 'string' || !/^[a-z0-9._-]{2,40}$/i.test(name)) continue;
    out.push(base('keyless', { id: `keyless:${name}`, provider: 'pollinations-keyless', model: name, title: `${name} (no key)`, publisher: 'Pollinations', tier: 'free', note: 'Works with no account. Text-to-image only.' }));
  }
  return { items: out, paid: 0 };
}

/** openrouter.ai/api/v1/models?output_modalities=image. Only models explicitly ":free" count as free (a bare 0 price often means "priced elsewhere"). */
function fromOpenRouter(json) {
  const out = []; let paid = 0;
  for (const m of Array.isArray(json?.data) ? json.data : []) {
    if (!m || typeof m.id !== 'string' || !(m.architecture?.output_modalities || []).includes('image') || /^openrouter\//.test(m.id)) continue;
    if (!/:free$/.test(m.id)) { paid++; continue; }
    const i2i = (m.architecture?.input_modalities || []).includes('image');
    out.push(base('openrouter', { id: `openrouter:${m.id}`, provider: 'openrouter', model: m.id, title: text(m.name || m.id, 80), publisher: m.id.split('/')[0], i2i, refs: i2i ? 1 : 0, needsKey: true, note: 'Chat-style image API (not an images/generations endpoint).' }));
  }
  return { items: out, paid };
}

const HF_NARROW = /lora|adapter|game[-_ ]?asset|caricature|upscale|restoration|multiple[-_ ]?angles|consistency|tiles|pixel|anime|sticker|icon|logo|portrait|face|try[-_ ]?on|lego/i;
/** Hugging Face model lists (text-to-image + image-to-image) with their Inference Providers. A model counts only if a provider reports it live. */
function fromHuggingFace(t2i, i2i) {
  const edits = new Set((Array.isArray(i2i) ? i2i : []).map(m => m?.id));
  const out = new Map();
  for (const m of [...(Array.isArray(i2i) ? i2i : []), ...(Array.isArray(t2i) ? t2i : [])]) {
    if (!m || typeof m.id !== 'string' || out.has(m.id)) continue;
    const live = (Array.isArray(m.inferenceProviderMapping) ? m.inferenceProviderMapping : []).filter(p => p && p.status === 'live');
    if (!live.length) continue;
    // Adapters and narrow fine-tunes (LoRA, "game assets", caricature...) are not general interior-design generators.
    if (HF_NARROW.test(m.id) || (Array.isArray(m.tags) && m.tags.some(t => /^(lora|adapter)$/i.test(String(t))))) continue;
    const latencies = live.map(p => Number(p.performance?.requestLatencyMs)).filter(n => n > 0);
    const hasEdit = edits.has(m.id);
    out.set(m.id, base('huggingface', {
      id: `huggingface:${m.id}`, provider: 'huggingface', model: m.id, title: m.id.split('/').pop(), publisher: m.id.split('/')[0], i2i: hasEdit, refs: hasEdit ? 1 : 0, needsKey: true,
      latencyHint: latencies.length ? Math.min(...latencies) : null, note: `Live on ${[...new Set(live.map(p => p.provider))].slice(0, 3).join(', ')}. Free monthly credits with an account.`,
    }));
  }
  return { items: [...out.values()].slice(0, 16), paid: 0 };
}

/** aihorde.net crowd-sourced workers, anonymous key. Queue based (seconds to minutes): listed from its status, never used for live renders. */
const HORDE_GOOD = /flux|sdxl|juggernaut|albedo|realistic|icbinp|dreamshaper|deliberate|stable diffusion|epicrealism|cyberrealistic|absolutereality/i;
const HORDE_BAD = /nsfw|furry|anime|pixel|hentai|waifu|comic|cartoon|illustrious|pony|lora|inpaint/i;
function fromHorde(models) {
  const picked = (Array.isArray(models) ? models : []).filter(m => m && typeof m.name === 'string' && m.type !== 'text' && Number(m.count) >= 2 && HORDE_GOOD.test(m.name) && !HORDE_BAD.test(m.name))
    .sort((a, b) => Number(b.count) - Number(a.count) || Number(a.eta) - Number(b.eta)).slice(0, 3);
  return {
    items: picked.map(m => base('horde', {
      id: `horde:${m.name}`, provider: 'horde', model: text(m.name, 80), title: text(m.name, 80), publisher: 'AI Horde', tier: 'free', i2i: true, refs: 1,
      latencyHint: Number.isFinite(Number(m.eta)) ? Number(m.eta) * 1000 : null, note: `${m.count} volunteer workers. Queue based: slow, not suited to live renders.`,
    })), paid: 0,
  };
}

/* ------------------------------------------------------------------ 2. SCORE */
const proofOf = c => c.proof || {};
const okRecord = r => !!r && r.ok === true;
const speedPoints = ms => 8 * clamp((40000 - ms) / (40000 - 8000), 0, 1);

/** 0-100 and the reasons behind every point. Pure: same candidate + clock = same answer. */
function evaluate(c, now = Date.now()) {
  const reasons = [];
  const proof = proofOf(c);
  const t2i = proof.t2i, i2i = proof.i2i;
  // The overall verdict follows the text-to-image step (does this model work at all?). A broken EDIT only removes the photo capability.
  const decisiveT2i = t2i && !t2i.inconclusive ? t2i : null;
  const decisiveI2i = i2i && !i2i.inconclusive ? i2i : null;
  const last = decisiveT2i || (!okRecord(t2i) ? decisiveI2i : null);
  const editBroken = !!c.i2i && !!decisiveI2i && !decisiveI2i.ok;
  let points = 0;
  // capability (25): this app edits a client's PHOTO, so photo-to-photo is what counts (an edit that was tested and failed is worth nothing)
  const photo = c.i2i && !editBroken;
  const cap = photo ? 20 + Math.min(5, c.refs || 0) : 6;
  points += cap; reasons.push({ code: photo ? 'photo' : editBroken ? 'editFailed' : 'textOnly', points: cap, ...(editBroken ? { error: decisiveI2i.error } : {}) });
  // quality prior (20)
  const prior = Math.round(qualityPrior(c.model) * (20 / 19) - (c.community ? 3 : 0));
  points += Math.max(0, prior); reasons.push({ code: 'quality', points: Math.max(0, prior) });
  // price (10)
  const price = c.tier === 'free' ? 10 : c.tier === 'free-tier' ? 8 : 0;
  points += price; reasons.push({ code: c.tier === 'free' ? 'free' : 'freeTier', points: price });
  // provider health (8): the figure the provider itself publishes; neutral when unknown
  const health = c.health ? Math.round(8 * clamp(c.health.rate / 100, 0, 1)) : 4;
  points += health; reasons.push({ code: c.health ? 'health' : 'healthUnknown', points: health, value: c.health ? Math.round(c.health.rate * 10) / 10 : null });
  // live proof (30)
  let proven = false;
  if (okRecord(t2i)) {
    const speed = Math.round(speedPoints(t2i.ms));
    points += 12 + speed; proven = true;
    reasons.push({ code: 'proof', points: 12 + speed, ms: t2i.ms });
  }
  if (c.i2i && okRecord(i2i)) { points += 10; reasons.push({ code: 'editProof', points: 10, ms: i2i.ms }); }
  // stability (7): moving average of the decisive probes, neutral until two are known
  const attempts = c.attempts || 0;
  const stability = attempts >= 2 ? Math.round(7 * clamp(c.ema ?? 0, 0, 1)) : 3;
  points += stability; reasons.push({ code: attempts >= 2 ? 'stability' : 'stabilityNew', points: stability, value: attempts >= 2 ? Math.round((c.ema ?? 0) * 100) : null });

  let status;
  if (c.needsKey && !c.keyOk) status = 'needs_key';
  else if (last && !last.ok) status = 'failing';
  else if (proven) status = 'verified';
  else status = 'unverified';
  // An unproven model can never outrank a proven one; a failing one sinks to the bottom.
  if (status === 'unverified' || status === 'needs_key') points = Math.min(points, 60);
  if (status === 'failing') { points = Math.min(points, 20); reasons.push({ code: 'failing', points: 0, error: last.error || 'error' }); }
  const stale = proven && now - Math.max(t2i?.at || 0, i2i?.at || 0) > FRESH_MS;
  if (stale) reasons.push({ code: 'stale', points: 0 });
  return { score: clamp(Math.round(points), 0, 100), status, reasons, stale, i2iProven: c.i2i ? (i2i ? (okRecord(i2i) ? true : i2i.inconclusive ? null : false) : null) : false };
}

/* ------------------------------------------------------------------ 3. PROVE */
function checkPicture(bytes, { notSameAs } = {}) {
  if (!bytes || !bytes.length) return { ok: false, error: 'empty' };
  const mime = sniffMime(bytes);
  if (!mime) return { ok: false, error: 'not_an_image' };
  const size = imageSize(bytes);
  if (!size || size.width < 256 || size.height < 192) return { ok: false, error: 'too_small' };
  // A blank / flat / black frame compresses to almost nothing: real photographs never go under this.
  if (bytes.length / (size.width * size.height) < 0.02) return { ok: false, error: 'blank' };
  if (notSameAs && Buffer.compare(bytes, notSameAs) === 0) return { ok: false, error: 'unchanged' };
  return { ok: true, mime, width: size.width, height: size.height, bytes: bytes.length };
}
/** HTTP status -> what it says about the MODEL (counts against it) or only about the moment / the key (does not). */
const classify = status => (status === 429 ? { error: 'rate_limited', inconclusive: true } : status === 401 || status === 403 ? { error: 'key_rejected', inconclusive: true }
  : status === 402 ? { error: 'no_credit', inconclusive: true } : status === 404 || status === 422 || status === 400 ? { error: 'unsupported' } : { error: status >= 500 ? 'server_error' : 'error' });

function createFinder({ db, env = process.env, clock = Date.now, fetch: fetchImpl = globalThis.fetch, keyFor = async () => null } = {}) {
  const ttl = env.VERCEL ? 0 : 15000;
  let cache = { at: -Infinity, settings: null, state: null };
  const forget = () => { cache = { at: -Infinity, settings: null, state: null }; };

  async function timed(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
  }
  const getJson = async (url, ms = 12000) => {
    const response = await timed(url, { headers: { Accept: 'application/json', 'User-Agent': 'dwira-api-finder/1' } }, ms);
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    return response.json();
  };

  /* ------------------------------------------------------------ storage */
  const kvGet = async key => (await db.query('SELECT value FROM saas_kv WHERE key=$1', [key]))[0]?.value ?? null;
  const kvSet = (key, value) => db.query('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [key, String(value)]);
  const parse = (raw, fallback) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : fallback; } catch { return fallback; } };

  function cleanSettings(input, previous = DEFAULTS) {
    const s = { ...DEFAULTS, ...previous };
    if (input && typeof input === 'object') {
      if (input.autoScan !== undefined) s.autoScan = input.autoScan === true;
      if (input.autopilot !== undefined) s.autopilot = input.autopilot === true;
      if (input.intervalHours !== undefined) { const n = Number(input.intervalHours); if (!Number.isInteger(n) || n < 1 || n > 168) throw fail(400, 'INVALID_LIMIT'); s.intervalHours = n; }
      if (input.probeMax !== undefined) { const n = Number(input.probeMax); if (!Number.isInteger(n) || n < 0 || n > 8) throw fail(400, 'INVALID_LIMIT'); s.probeMax = n; }
      if (input.banned !== undefined) {
        if (!Array.isArray(input.banned)) throw fail(400, 'INVALID_LIMIT');
        s.banned = [...new Set(input.banned.filter(x => typeof x === 'string' && x.length <= 200 && /^[a-z]+:/.test(x)))].slice(0, 200);
      }
    }
    return s;
  }
  async function loadSettings() {
    if (cache.settings && clock() - cache.at < ttl) return cache.settings;
    const settings = cleanSettings(parse(await kvGet(SETTINGS_KEY), {}), DEFAULTS);
    cache = { ...cache, at: clock(), settings };
    return settings;
  }
  async function setSettings(input) {
    const settings = cleanSettings(input, await loadSettings());
    await kvSet(SETTINGS_KEY, JSON.stringify(settings));
    forget();
    return settings;
  }
  const emptyState = () => ({ at: 0, scans: 0, sources: {}, candidates: {} });
  async function loadState() {
    if (cache.state && clock() - cache.at < ttl) return cache.state;
    const raw = parse(await kvGet(STATE_KEY), null);
    const state = raw && typeof raw.candidates === 'object' ? { ...emptyState(), ...raw } : emptyState();
    cache = { ...cache, at: clock(), state };
    return state;
  }
  async function saveState(state) { await kvSet(STATE_KEY, JSON.stringify(state)); forget(); }

  /** Cross-instance lock: true = taken (until `ms` from now), false = somebody else holds it. */
  async function lock(ms) {
    const now = clock();
    const rows = await db.query('INSERT INTO saas_kv(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value WHERE CAST(saas_kv.value AS BIGINT) < $3::bigint RETURNING key', [LOCK_KEY, String(now + ms), String(now)]);
    return rows.length > 0;
  }
  const unlock = () => kvSet(LOCK_KEY, '0').catch(() => {});
  const locked = async () => Number(await kvGet(LOCK_KEY)) > clock();

  /* ------------------------------------------------------------ keys: read only, never returned */
  async function keyState() {
    const k = await keyFor('image', 'pollinations').catch(() => null);
    return { pollinations: !!k?.key };
  }

  /* ------------------------------------------------------------ discover */
  async function discover() {
    const jobs = {
      pollinations: () => getJson('https://gen.pollinations.ai/image/models').then(fromPollinations),
      keyless: () => getJson('https://image.pollinations.ai/models').then(fromKeyless),
      openrouter: () => getJson('https://openrouter.ai/api/v1/models?output_modalities=image').then(fromOpenRouter),
      huggingface: async () => {
        const q = tag => `https://huggingface.co/api/models?pipeline_tag=${tag}&inference_provider=all&sort=trendingScore&limit=25&expand[]=inferenceProviderMapping`;
        const [a, b] = await Promise.all([getJson(q('text-to-image')), getJson(q('image-to-image')).catch(() => [])]);
        return fromHuggingFace(a, b);
      },
      horde: () => getJson('https://aihorde.net/api/v2/status/models?type=image&min_count=1', 15000).then(fromHorde),
    };
    const names = Object.keys(jobs);
    const settled = await Promise.all(names.map(async name => {
      const t0 = clock();
      try { const r = await jobs[name](); return { name, ok: true, items: r.items, paid: r.paid, ms: clock() - t0 }; }
      catch (error) { return { name, ok: false, items: [], paid: 0, ms: clock() - t0, error: error?.name === 'AbortError' ? 'timeout' : error?.status ? `http_${error.status}` : 'unreachable' }; }
    }));
    return settled;
  }

  /** Folds a discovery round into the state: new candidates appear, known ones keep their proof, vanished ones age out. */
  function merge(state, round, now) {
    const seen = new Set();
    for (const r of round) {
      state.sources[r.name] = { ok: r.ok, count: r.items.length, paid: r.paid, ms: r.ms, error: r.error || '', at: now };
      for (const item of r.items) {
        seen.add(item.id);
        const old = state.candidates[item.id];
        state.candidates[item.id] = { ...item, proof: old?.proof || {}, ema: old?.ema, attempts: old?.attempts || 0, firstSeen: old?.firstSeen || now, lastSeen: now };
      }
    }
    for (const [id, c] of Object.entries(state.candidates)) {
      const source = state.sources[c.source];
      // A source that failed this round keeps its candidates as they were (an outage is not a removal).
      if (!seen.has(id) && source?.ok && now - c.lastSeen > FORGET_MS) delete state.candidates[id];
    }
    const ids = Object.keys(state.candidates);
    if (ids.length > MAX_CANDIDATES) for (const id of ids.sort((a, b) => state.candidates[a].lastSeen - state.candidates[b].lastSeen).slice(0, ids.length - MAX_CANDIDATES)) delete state.candidates[id];
  }

  /* ------------------------------------------------------------ prove */
  async function decode(response) {
    const data = await response.json();
    const item = data?.data?.[0];
    if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
    if (typeof item?.url === 'string' && /^https:\/\//.test(item.url)) { const r = await timed(item.url, { redirect: 'follow' }, 20000); if (r.ok) return Buffer.from(await r.arrayBuffer()); }
    return null;
  }
  /** One call to an OpenAI-style images endpoint. Returns { ok, ms, bytes } or { ok:false, error, inconclusive }. */
  async function callImages(url, key, body, ms) {
    const t0 = clock();
    try {
      const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
      let response = await timed(url, { method: 'POST', headers, body: JSON.stringify(body) }, ms);
      if (response.status === 400 && body.size) { const { size, ...without } = body; response = await timed(url, { method: 'POST', headers, body: JSON.stringify(without) }, ms); }
      if (!response.ok) return { ms: clock() - t0, ...classify(response.status) };
      const bytes = await decode(response);
      return { ok: true, ms: clock() - t0, buffer: bytes };
    } catch (error) { return { ms: clock() - t0, error: error?.name === 'AbortError' ? 'timeout' : 'unreachable' }; }
  }
  const record = (ms, check, extra = {}) => ({ at: clock(), ok: check.ok, ms, ...(check.ok ? { bytes: check.bytes, width: check.width, height: check.height } : { error: check.error }), ...extra });

  /** Proof for one candidate. `deadline` (epoch ms) stops the second step when the host's time budget is nearly gone. */
  async function proveOne(c, { deadline = Infinity } = {}) {
    const proof = {};
    const left = () => Math.max(0, deadline - clock());
    if (c.source === 'keyless') {
      const t0 = clock();
      try {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(PROBE_PROMPT)}?width=512&height=384&nologo=true&model=${encodeURIComponent(c.model)}&seed=${Math.floor(clock() % 100000)}`;
        const response = await timed(url, { redirect: 'follow' }, Math.min(25000, Math.max(3000, left())));
        if (!response.ok) proof.t2i = { at: clock(), ok: false, ms: clock() - t0, ...classify(response.status) };
        else proof.t2i = record(clock() - t0, checkPicture(Buffer.from(await response.arrayBuffer())));
      } catch (error) { proof.t2i = { at: clock(), ok: false, ms: clock() - t0, error: error?.name === 'AbortError' ? 'timeout' : 'unreachable' }; }
      return proof;
    }
    if (c.engine !== 'pollinations') return null; // nothing the finder can call yet
    const k = await keyFor('image', 'pollinations').catch(() => null);
    if (!k?.key) return null;
    const root = String(k.base || env.POLLINATIONS_BASE_URL || POLLINATIONS_BASE).replace(/\/+$/, '');
    const generated = await callImages(`${root}/images/generations`, k.key, { model: c.model, prompt: PROBE_PROMPT, n: 1, size: '512x384', response_format: 'b64_json' }, Math.min(30000, Math.max(3000, left())));
    let picture = null;
    if (generated.ok) { const check = checkPicture(generated.buffer); proof.t2i = record(generated.ms, check); if (check.ok) picture = generated.buffer; }
    else proof.t2i = { at: clock(), ok: false, ms: generated.ms, error: generated.error, ...(generated.inconclusive ? { inconclusive: true } : {}) };
    // The step the app really depends on: edit a picture. The picture the model just drew is the test photo.
    if (c.i2i && picture && left() > 6000) {
      const uri = `data:${sniffMime(picture)};base64,${picture.toString('base64')}`;
      const edited = await callImages(`${root}/images/edits`, k.key, { model: c.model, prompt: EDIT_PROMPT, image: [{ image_url: uri }], n: 1, size: '512x384', response_format: 'b64_json' }, Math.min(30000, left()));
      if (edited.ok) proof.i2i = record(edited.ms, checkPicture(edited.buffer, { notSameAs: picture }));
      else proof.i2i = { at: clock(), ok: false, ms: edited.ms, error: edited.error, ...(edited.inconclusive ? { inconclusive: true } : {}) };
    }
    return proof;
  }
  /** Writes a proof into the candidate and moves its stability average. Inconclusive answers change nothing but the record. */
  function apply(c, proof) {
    c.proof = { ...c.proof, ...proof };
    for (const step of ['t2i', 'i2i']) {
      const r = proof[step];
      if (!r || r.inconclusive) continue;
      c.attempts = (c.attempts || 0) + 1;
      c.ema = c.ema == null ? (r.ok ? 1 : 0) : Math.round((0.6 * c.ema + 0.4 * (r.ok ? 1 : 0)) * 1000) / 1000;
    }
    // A model whose text step now fails cannot keep an old successful edit proof.
    if (proof.t2i && !proof.t2i.ok && !proof.t2i.inconclusive && c.proof.i2i) delete c.proof.i2i;
  }

  /** Candidates worth a probe now: never proven or stale first, photo-capable first, best preliminary score first. */
  async function chooseProbes(state, settings, now) {
    const keys = await keyState();
    const due = Object.values(state.candidates).filter(c => {
      if (settings.banned.includes(c.id)) return false;
      if (c.source === 'keyless') return true;
      if (c.engine !== 'pollinations' || !keys.pollinations) return false;
      const t = Math.max(c.proof?.t2i?.at || 0, c.proof?.i2i?.at || 0);
      return !t || now - t > settings.intervalHours * HOUR;
    });
    const withKeyOk = c => ({ ...c, keyOk: c.source === 'keyless' || (c.engine === 'pollinations' && keys.pollinations) });
    const ranked = due.map(c => ({ c, never: !(c.proof?.t2i?.at), s: evaluate(withKeyOk(c), now).score }))
      .sort((a, b) => (b.never - a.never) || (Number(b.c.i2i) - Number(a.c.i2i)) || b.s - a.s);
    const keyless = ranked.filter(x => x.c.source === 'keyless').map(x => x.c);
    const keyed = ranked.filter(x => x.c.source !== 'keyless').map(x => x.c).slice(0, settings.probeMax);
    return [...keyed, ...keyless];
  }

  /** Runs `tasks` with at most `n` at a time. */
  async function pool(items, n, work) {
    const queue = [...items];
    await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await work(queue.shift()); }));
  }

  /* ------------------------------------------------------------ the scan */
  const budgetMs = () => Number(env.FINDER_BUDGET_MS) || (env.VERCEL ? 22000 : 80000);
  async function scan({ probe = true, reason = 'manual' } = {}) {
    const budget = budgetMs();
    if (!(await lock(budget + 10000))) return { skipped: 'busy', ...(await view()) };
    try {
      const started = clock();
      const settings = await loadSettings();
      forget();
      const state = await loadState();
      const round = await discover();
      merge(state, round, clock());
      state.at = clock(); state.scans = (state.scans || 0) + 1; state.reason = reason;
      // Discovery is saved first: a probe that overruns the host's time limit never loses what was found.
      await saveState(state);
      if (probe && settings.probeMax >= 0) {
        const deadline = started + budget;
        const targets = await chooseProbes(state, settings, clock());
        await pool(targets, 3, async c => {
          if (deadline - clock() < 4000) return;
          const proof = await proveOne(c, { deadline }).catch(() => null);
          if (proof) apply(c, proof);
        });
        state.probedAt = clock();
        await saveState(state);
      }
    } finally { await unlock(); }
    return view();
  }

  /** Manual re-test of one candidate (the "Test now" button). */
  async function probe(id) {
    if (typeof id !== 'string' || !id) throw fail(404, 'NOT_FOUND');
    if (await locked()) throw fail(409, 'SCAN_RUNNING');
    if (!(await lock(60000))) throw fail(409, 'SCAN_RUNNING');
    try {
      forget();
      const state = await loadState();
      const c = state.candidates[id];
      if (!c) throw fail(404, 'NOT_FOUND');
      const proof = await proveOne(c, { deadline: clock() + budgetMs() });
      if (!proof) throw fail(409, c.engine === 'pollinations' ? 'KEY_MISSING' : 'NOT_TESTABLE');
      apply(c, proof);
      state.probedAt = clock();
      await saveState(state);
    } finally { await unlock(); }
    return view();
  }

  /** Background decision (timer / daily cron): scan when automatic scanning is on and the last one is older than the interval. */
  async function tick({ force = false } = {}) {
    const settings = await loadSettings();
    if (!force && !settings.autoScan) return { skipped: 'off' };
    forget();
    const state = await loadState();
    if (!force && clock() - state.at < settings.intervalHours * HOUR) return { skipped: 'not-due' };
    return scan({ reason: 'auto' });
  }

  /* ------------------------------------------------------------ what the console and the image generator read */
  const SORT = { verified: 0, unverified: 1, needs_key: 1, failing: 3 }; // unproven models mix by score; a failing one is last
  async function view() {
    forget();
    const [settings, state, keys] = await Promise.all([loadSettings(), loadState(), keyState()]);
    const now = clock();
    const items = Object.values(state.candidates).map(c => {
      const keyOk = c.source === 'keyless' || c.source === 'horde' || (c.engine === 'pollinations' && keys.pollinations) || (!c.needsKey && c.source !== 'pollinations');
      const e = evaluate({ ...c, keyOk }, now);
      const latest = [c.proof?.t2i, c.proof?.i2i].filter(Boolean).sort((a, b) => b.at - a.at)[0];
      const banned = settings.banned.includes(c.id);
      const src = SOURCES[c.source] || {};
      return {
        id: c.id, source: c.source, sourceLabel: src.label || c.source, provider: c.provider, model: c.model, title: c.title, publisher: c.publisher, tier: c.tier,
        i2i: c.i2i, i2iProven: e.i2iProven, connectable: !!c.connectable, needsKey: !!c.needsKey && !keyOk, keyUrl: src.keyUrl || '', docs: src.docs || '', community: !!c.community, note: c.note,
        status: e.status, score: e.score, reasons: e.reasons, stale: e.stale, banned, testable: c.source === 'keyless' || (c.engine === 'pollinations' && keys.pollinations),
        latencyMs: c.proof?.t2i?.ok ? c.proof.t2i.ms : null, editMs: c.proof?.i2i?.ok ? c.proof.i2i.ms : null, probedAt: latest?.at || null, lastError: latest && !latest.ok ? latest.error : '',
        firstSeen: c.firstSeen,
      };
    }).sort((a, b) => (Number(a.banned) - Number(b.banned)) || (SORT[a.status] - SORT[b.status]) || b.score - a.score);
    // "Best now": the best proven model the app can actually call; failing that, the best proven one of any kind.
    const usable = items.filter(x => !x.banned && x.status === 'verified');
    const best = usable.find(x => x.connectable && x.i2iProven) || usable.find(x => x.connectable) || usable[0] || null;
    return {
      at: state.at || null, scans: state.scans || 0, probedAt: state.probedAt || null, scanning: await locked(), settings, keys, nextScanAt: settings.autoScan && state.at ? state.at + settings.intervalHours * HOUR : null,
      sources: Object.entries(SOURCES).map(([id, s]) => ({ id, label: s.label, docs: s.docs, keyUrl: s.keyUrl, ...(state.sources[id] || { ok: null, count: 0, paid: 0, ms: 0, error: '', at: null }) })),
      candidates: items, best: best ? best.id : '', bestUsable: !!best && best.connectable,
      // The best model the app can call as soon as a free key is added (shown when nothing callable has proven itself yet).
      suggested: (items.find(x => !x.banned && x.connectable && x.status !== 'failing' && x.i2i) || {}).id || '',
      totals: { found: items.length, verified: items.filter(x => x.status === 'verified').length, editing: items.filter(x => x.i2iProven === true).length, needKey: items.filter(x => x.status === 'needs_key').length },
    };
  }

  /**
   * The chain the image generator should try first: proven, fresh, callable, not banned. Only with the Autopilot switch on.
   * `i2i` true = models that PROVED a photo edit; false = models that proved a text-to-image.
   */
  async function chain(i2i) {
    const settings = await loadSettings();
    if (!settings.autopilot) return [];
    const state = await loadState();
    const now = clock();
    const out = [];
    for (const c of Object.values(state.candidates)) {
      if (c.engine !== 'pollinations' || !c.connectable || settings.banned.includes(c.id)) continue;
      const step = i2i ? c.proof?.i2i : c.proof?.t2i;
      if (!okRecord(step) || now - step.at > FRESH_MS) continue;
      const e = evaluate({ ...c, keyOk: true }, now);
      if (e.status !== 'verified') continue;
      out.push({ model: c.model, label: c.title, refs: c.refs || 1, score: e.score, ms: step.ms });
    }
    return out.sort((a, b) => b.score - a.score || a.ms - b.ms).slice(0, 5);
  }

  return { scan, probe, tick, view, chain, setSettings, getSettings: loadSettings, forget, DEFAULTS };
}

module.exports = { createFinder, fromPollinations, fromKeyless, fromOpenRouter, fromHuggingFace, fromHorde, evaluate, checkPicture, qualityPrior, classify, PROBE_PROMPT, SOURCES };
