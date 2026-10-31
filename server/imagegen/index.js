/**
 * AI image generation for the design wizard (text-to-image AND image-to-image).
 *
 * Engines are OpenAI-compatible (`/images/generations` for text, `/images/edits` for a photo), so a new engine is one entry in
 * ENGINES. The DEFAULT engine is Pollinations (gen.pollinations.ai): free models that accept a photo (FLUX.2 Klein, FLUX.1
 * Kontext) and free text-to-image models (Z-Image Turbo, FLUX.1 Schnell). It needs ONE free key (enter.pollinations.ai), read from
 * POLLINATIONS_API_KEY or pasted in the admin panel (stored server-side, write-only, never returned). Without any key the
 * app keeps working in demo mode (`AI_NOT_CONFIGURED`: the client shows its sample result).
 *
 * Which model runs: the model the admin resolved for the tool (an admin model with an `engine`), then a chain of free models
 * that can do the job. A model that fails (quota, outage, bad key) rests for a while and the next one takes over, so one
 * provider hitting its free limit never breaks a render. `fetch` is injectable for tests.
 */
const { buildPrompt, normalizeColors, ROOM_EN, clean } = require('./prompt');
const { sniffMime, imageSize, fitSize } = require('./image');

const KEY_RE = /^[A-Za-z0-9_.\-]{12,300}$/;
const ENGINES = {
  pollinations: { label: 'Pollinations', base: 'https://gen.pollinations.ai/v1', env: 'POLLINATIONS_API_KEY', baseEnv: 'POLLINATIONS_BASE_URL' },
  openai: { label: 'OpenAI-compatible', base: 'https://api.openai.com/v1', env: 'IMAGEGEN_API_KEY', baseEnv: 'IMAGEGEN_BASE_URL' },
};
/** Pollinations models we know: can it take a photo, how many references, is it on the free tier. */
const CATALOG = {
  'black-forest-labs/flux.2-klein-4b': { title: 'FLUX.2 Klein', i2i: true, refs: 10, free: true },
  'black-forest-labs/flux.1-kontext-pro': { title: 'FLUX.1 Kontext', i2i: true, refs: 1, free: true },
  'microsoft/mai-image-2.6-flash': { title: 'MAI Image 2.6 Flash', i2i: true, refs: 5, free: true },
  'tongyi-mai/z-image-turbo': { title: 'Z-Image Turbo', i2i: false, refs: 0, free: true },
  'black-forest-labs/flux.1-schnell': { title: 'FLUX.1 Schnell', i2i: false, refs: 0, free: true },
};
const CHAIN_I2I = ['black-forest-labs/flux.2-klein-4b', 'black-forest-labs/flux.1-kontext-pro', 'microsoft/mai-image-2.6-flash'];
const CHAIN_T2I = ['tongyi-mai/z-image-turbo', 'black-forest-labs/flux.1-schnell', 'black-forest-labs/flux.2-klein-4b'];
const MAX_IMAGE = 8 * 1024 * 1024;
const fail = (status, code) => Object.assign(new Error(code), { status });
const list = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean);
const lt = (text, lang = 'fr') => (text && (text[lang] || text.fr || text.ar || text.dar)) || '';

function capability(engine, model) {
  if (engine === 'pollinations') { const known = CATALOG[model] || CATALOG[`black-forest-labs/${model}`]; if (known) return known; }
  // Unknown model: gpt-image / flux style editors take photos; DALL-E 3, schnell/turbo style models do not.
  return { title: model, i2i: !/dall-e-3|schnell|turbo|sdxl-base/i.test(model), refs: 1, free: false };
}

function createImageGen(db, { env = process.env, fetch: fetchImpl = globalThis.fetch, clock = Date.now, media, content, sync } = {}) {
  const cooling = new Map(); // "engine|model" -> until
  const inflight = new Map(); // request id -> promise (one generation per request at a time)
  const perClient = new Map(); // client id -> running count
  let keysCache = { at: 0, value: {} };

  async function storedKeys() {
    if (clock() - keysCache.at < 15000) return keysCache.value;
    let value = {};
    try { const row = (await db.query("SELECT value FROM settings WHERE key='image_keys'"))[0]; if (row) value = JSON.parse(row.value); } catch { /* none stored */ }
    keysCache = { at: clock(), value };
    return value;
  }
  async function keyOf(engine, modelKey) {
    if (typeof modelKey === 'string' && modelKey.trim() && KEY_RE.test(modelKey.trim())) return { key: modelKey.trim(), source: 'model' };
    if (env[ENGINES[engine].env]) return { key: env[ENGINES[engine].env], source: 'env' };
    const key = (await storedKeys())[engine];
    return { key: typeof key === 'string' ? key : '', source: key ? 'db' : 'none' };
  }
  const baseOf = (engine, model) => String((model?.baseUrl && /^https:\/\//.test(model.baseUrl) ? model.baseUrl : env[ENGINES[engine].baseEnv]) || ENGINES[engine].base).replace(/\/+$/, '');

  /** Engine availability. Never returns a key. */
  async function status() {
    const engines = {};
    for (const name of Object.keys(ENGINES)) { const { source } = await keyOf(name); engines[name] = { label: ENGINES[name].label, configured: source !== 'none', source }; }
    return { engines, live: Object.values(engines).some(engine => engine.configured), chainI2I: chainOf(true), chainT2I: chainOf(false) };
  }
  /** Write-only: a string stores/replaces a key, an empty string removes it, undefined leaves it alone. */
  async function setKeys(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'INVALID_KEYS');
    const current = { ...(await storedKeys()) };
    for (const name of Object.keys(ENGINES)) {
      const value = input[name];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw fail(400, 'INVALID_KEY');
      const trimmed = value.trim();
      if (!trimmed) delete current[name];
      else if (!KEY_RE.test(trimmed)) throw fail(400, 'INVALID_KEY');
      else current[name] = trimmed;
      for (const key of [...cooling.keys()]) if (key.startsWith(`${name}|`)) cooling.delete(key);
    }
    await db.query("INSERT INTO settings(key,value) VALUES('image_keys',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(current)]);
    keysCache = { at: clock(), value: current };
    return status();
  }
  const chainOf = i2i => (list(env[i2i ? 'IMAGEGEN_MODELS_I2I' : 'IMAGEGEN_MODELS_T2I']).concat(i2i ? CHAIN_I2I : CHAIN_T2I)).filter((m, i, all) => all.indexOf(m) === i);

  /** Models to try, in order: the admin's model for the tool first, then the free chain. */
  async function candidates(row, needImage) {
    const out = [];
    const add = async (engine, model, extra = {}) => {
      if (!ENGINES[engine] || !model || out.some(c => c.engine === engine && c.model === model)) return;
      const cap = capability(engine, model);
      if (needImage && !cap.i2i) return;
      const { key } = await keyOf(engine, extra.key);
      if (!key) return;
      if ((cooling.get(`${engine}|${model}`) || 0) > clock()) return;
      out.push({ engine, model, key, base: baseOf(engine, extra.row), label: extra.label || cap.title, cap, requested: !!extra.row });
    };
    if (row?.engine && ENGINES[row.engine] && row.enabled !== false) await add(row.engine, String(row.modelName || '').trim(), { key: row.apiKey, row, label: row.name });
    for (const model of chainOf(needImage)) await add('pollinations', model);
    return out;
  }

  /* ------------------------------------------------------------ pictures in and out */
  async function timed(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fetchImpl(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timer); }
  }
  async function download(url, ms = 20000) {
    const response = await timed(url, { redirect: 'follow' }, ms);
    if (!response.ok) throw Object.assign(new Error('download'), { statusCode: response.status });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_IMAGE) throw new Error('too large');
    return body;
  }
  /** Bytes of one of OUR pictures (/api/media/..), or of an admin-managed https picture (inspirations). Never an arbitrary user URL. */
  async function loadImage(uri, { trustedHttps = false } = {}) {
    if (typeof uri !== 'string' || !uri) return null;
    let body;
    const mediaUrl = /^(?:https?:\/\/[^/]+)?(\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+)$/.exec(uri);
    if (mediaUrl) {
      const file = await media.readMedia(mediaUrl[1].slice('/api/media/'.length));
      if (!file) return null;
      body = file.redirect ? await download(file.redirect) : file.body;
    } else if (/^data:image\/(png|jpeg|webp);base64,/.test(uri)) body = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
    else if (trustedHttps && /^https:\/\//.test(uri)) body = await download(uri);
    else return null;
    const mime = sniffMime(body);
    return mime && body.length <= MAX_IMAGE ? { body, mime, size: imageSize(body) } : null;
  }
  const dataUri = image => `data:${image.mime};base64,${image.body.toString('base64')}`;

  async function callEngine(candidate, { prompt, photo, reference, size, signal }) {
    const headers = { Authorization: `Bearer ${candidate.key}`, 'Content-Type': 'application/json' };
    const withImage = !!photo;
    let body;
    if (withImage) {
      const images = [{ image_url: dataUri(photo) }];
      if (reference && candidate.cap.refs > 1) images.push({ image_url: dataUri(reference) });
      body = { model: candidate.model, prompt, image: images, n: 1, size: `${size.width}x${size.height}`, response_format: 'b64_json' };
    } else body = { model: candidate.model, prompt, n: 1, size: `${size.width}x${size.height}`, response_format: 'b64_json' };
    const url = `${candidate.base}/images/${withImage ? 'edits' : 'generations'}`;
    let response = await timed(url, { method: 'POST', headers, body: JSON.stringify(body) }, signal);
    // A model that rejects the size (fixed resolutions) gets one more try with its own default.
    if (response.status === 400) { delete body.size; response = await timed(url, { method: 'POST', headers, body: JSON.stringify(body) }, signal); }
    if (!response.ok) throw Object.assign(new Error(`${candidate.engine} ${response.status}`), { statusCode: response.status });
    const data = await response.json();
    const item = data?.data?.[0];
    let bytes;
    if (item?.b64_json) bytes = Buffer.from(item.b64_json, 'base64');
    else if (typeof item?.url === 'string' && /^https:\/\//.test(item.url)) bytes = await download(item.url, 25000);
    if (!bytes || !bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('empty');
    const mime = sniffMime(bytes);
    if (!mime) throw new Error('not an image');
    return { bytes, mime };
  }

  /**
   * Builds the prompt from the stored request (authoritative: nothing the client says at render time is trusted) and runs the chain.
   * Returns { imageUri, engine, model, label, cached }.
   */
  async function generate({ request, userId }) {
    const draft = request.draft || {};
    if (request.aiResult && /^\/api\/media\//.test(request.aiResult) && request.aiModel) return { imageUri: request.aiResult, ...request.aiModel, cached: true };
    const snapshot = await content.snapshot(true), c = snapshot.collections;
    const style = c.styles?.find(x => x.id === draft.styleId), room = c.roomTypes?.find(x => x.id === draft.roomTypeId), palette = c.palettes?.find(x => x.id === draft.paletteId);
    const tool = c.tools?.find(x => x.id === draft.toolId);
    const row = c.models?.find(x => x.id === draft.modelId) || undefined;
    const inspiration = draft.inspirationId ? c.inspirations?.find(x => x.id === draft.inspirationId) : null;
    const photo = request.photoUri ? await loadImage(request.photoUri) : null;
    if (request.photoUri && !photo) throw fail(422, 'PHOTO_UNREADABLE');
    const reference = inspiration?.image ? await loadImage(inspiration.image, { trustedHttps: true }).catch(() => null) : null;
    // A custom palette typed by the person wins over the preset one; "Surprise me" lets the model choose.
    const colors = normalizeColors(draft.colors?.length ? draft.colors : palette && !palette.isSurprise ? palette.colors : []);
    const prompt = buildPrompt({
      photo: !!photo, hasReference: !!reference, toolId: draft.toolId, roomTitle: ROOM_EN[draft.roomTypeId] || clean(lt(room?.title), 60), styleId: draft.styleId, styleTitle: lt(style?.title),
      mode: draft.mode, colors, surprise: !colors.length && !!palette?.isSurprise, prompt: draft.prompt,
    });
    const size = fitSize(photo?.size, Number(env.IMAGEGEN_MAX_SIDE) || 1024);
    const list = await candidates(row, !!photo);
    if (!list.length) throw fail(503, (await status()).live ? 'NO_PROVIDER' : 'AI_NOT_CONFIGURED');
    // Vercel kills a function after 30 s (vercel.json): stay inside it there; long-running hosts get a generous budget.
    const deadline = clock() + (Number(env.IMAGEGEN_BUDGET_MS) || (env.VERCEL ? 25000 : 54000));
    let lastStatus = 0;
    for (const candidate of list) {
      const left = deadline - clock();
      if (left < (env.VERCEL ? 4000 : 6000)) break;
      try {
        const out = await callEngine(candidate, { prompt, photo, reference, size, signal: Math.min(left, Number(env.IMAGEGEN_ATTEMPT_MS) || (env.VERCEL ? 24000 : 40000)) });
        const imageUri = await media.storeMedia({ body: out.bytes, mime: out.mime });
        cooling.delete(`${candidate.engine}|${candidate.model}`);
        return { imageUri, engine: candidate.engine, model: candidate.model, label: candidate.label, cached: false, prompt: undefined };
      } catch (error) {
        lastStatus = error.statusCode || lastStatus;
        const code = error.statusCode;
        // 404 / 422: this model does not exist here or cannot do this job -> next model. Everything else rests it briefly.
        if (code === 404 || code === 422 || code === 400) { cooling.set(`${candidate.engine}|${candidate.model}`, clock() + 600000); continue; }
        cooling.set(`${candidate.engine}|${candidate.model}`, clock() + (code === 429 ? 60000 : code === 401 || code === 403 || code === 402 ? 300000 : 20000));
      }
    }
    throw Object.assign(fail(503, 'NO_PROVIDER'), { lastStatus });
  }

  /** Idempotent per request: a second call returns the stored result (or joins the one in flight) and never generates twice. */
  async function renderRequest(client, claimId) {
    if (typeof claimId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(claimId)) throw fail(400, 'INVALID_CLAIM');
    const found = (await db.query('SELECT id,data FROM requests WHERE user_id=$1 AND client_request_id=$2', [client.id, claimId]))[0];
    if (!found) throw fail(404, 'NOT_FOUND');
    const key = found.id;
    if (inflight.has(key)) return inflight.get(key);
    if ((perClient.get(client.id) || 0) >= 2) throw fail(429, 'TOO_MANY_RENDERS');
    perClient.set(client.id, (perClient.get(client.id) || 0) + 1);
    const job = (async () => {
      const request = JSON.parse(found.data);
      const result = await generate({ request, userId: client.id });
      if (!result.cached) {
        await db.tx(async q => {
          const row = (await q('SELECT data FROM requests WHERE id=$1 FOR UPDATE', [key]))[0];
          if (!row) return;
          const next = { ...JSON.parse(row.data), aiResult: result.imageUri, aiModel: { engine: result.engine, model: result.model, label: result.label } };
          await q('UPDATE requests SET data=$1 WHERE id=$2', [JSON.stringify(next), key]);
        });
        if (sync) await sync.bump('requests', `c:${client.id}`, `c:${client.id}:requests`).catch(() => {});
      }
      return { imageUri: result.imageUri, engine: result.engine, model: result.model, label: result.label };
    })().finally(() => { inflight.delete(key); const n = (perClient.get(client.id) || 1) - 1; if (n > 0) perClient.set(client.id, n); else perClient.delete(client.id); });
    inflight.set(key, job);
    return job;
  }

  /** What the app may show: which admin models exist, can they take a photo, and is a live engine configured. No keys. */
  async function publicStatus() {
    const live = (await status()).live;
    const models = ((await content.snapshot(false)).collections.models || []).filter(m => m.enabled && m.visible !== false).map(m => {
      const engine = m.engine && ENGINES[m.engine] ? m.engine : '';
      const cap = engine ? capability(engine, m.modelName) : null;
      return { id: m.id, name: m.name, engine: engine || 'auto', modelName: engine ? m.modelName : '', i2i: cap ? cap.i2i : true, free: cap ? cap.free : true };
    });
    return { live, models, chain: { image: chainOf(true).map(m => capability('pollinations', m).title), text: chainOf(false).map(m => capability('pollinations', m).title) } };
  }
  return { renderRequest, status, setKeys, publicStatus, buildPrompt };
}
module.exports = { createImageGen, ENGINES, CATALOG, capability };
