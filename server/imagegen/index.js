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
const { buildBrief, normalizeColors, ROOM_EN, STYLE_NOTES, clean, unknownPlaceholders } = require('./prompt');
const { cleanRules, resolveRules, defaultRules } = require('./rules');
const { BLOCKS, DEFAULT_ORDER, PLACEHOLDERS, DEFAULT_OFF } = require('./blocks');
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

function createImageGen(db, { env = process.env, fetch: fetchImpl = globalThis.fetch, clock = Date.now, media, content, sync, platform } = {}) {
  const cooling = new Map(); // "engine|model" -> until
  const inflight = new Map(); // request id -> promise (one generation per request at a time)
  const perClient = new Map(); // client id -> running count
  let keysCache = { at: 0, value: {} };

  async function storedKeys() {
    if (clock() - keysCache.at < 15000) return keysCache.value;
    let value = {};
    try { const row = (await db.query("SELECT value FROM settings WHERE tenant_id=:tenant AND key='image_keys'"))[0]; if (row) value = JSON.parse(row.value); } catch { /* none stored */ }
    keysCache = { at: clock(), value };
    return value;
  }
  /**
   * Platform-managed store (super admin > APIs): the key comes from the API manager. The store's own stored key and every model key are
   * ignored (a store cannot make the platform key travel anywhere), the environment key of the deployment stays a valid fallback.
   */
  const managedOf = () => (platform ? platform.managed('image') : null);
  async function keyOf(engine, modelKey) {
    const managed = await managedOf();
    if (managed) {
      if (managed.api && managed.api.provider === engine) return { key: managed.api.key, source: 'platform' };
      return env[ENGINES[engine].env] ? { key: env[ENGINES[engine].env], source: 'env' } : { key: '', source: 'none' };
    }
    if (typeof modelKey === 'string' && modelKey.trim() && KEY_RE.test(modelKey.trim())) return { key: modelKey.trim(), source: 'model' };
    if (env[ENGINES[engine].env]) return { key: env[ENGINES[engine].env], source: 'env' };
    const key = (await storedKeys())[engine];
    return { key: typeof key === 'string' ? key : '', source: key ? 'db' : 'none' };
  }
  async function baseFor(engine, model) {
    const managed = await managedOf();
    // Managed: only the address set in the API manager (or the engine default) is ever used, never a store-typed URL.
    if (managed) return String((managed.api?.provider === engine && managed.api.base) || env[ENGINES[engine].baseEnv] || ENGINES[engine].base).replace(/\/+$/, '');
    return String((model?.baseUrl && /^https:\/\//.test(model.baseUrl) ? model.baseUrl : env[ENGINES[engine].baseEnv]) || ENGINES[engine].base).replace(/\/+$/, '');
  }

  /** Engine availability. Never returns a key. */
  async function status() {
    const engines = {};
    for (const name of Object.keys(ENGINES)) { const { source } = await keyOf(name); engines[name] = { label: ENGINES[name].label, configured: source !== 'none', source }; }
    return { managed: !!(await managedOf()), engines, live: Object.values(engines).some(engine => engine.configured), chainI2I: chainOf(true), chainT2I: chainOf(false), rotation: await rotationInfo() };
  }
  /** Write-only: a string stores/replaces a key, an empty string removes it, undefined leaves it alone. */
  async function setKeys(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'INVALID_KEYS');
    if (await managedOf()) throw fail(403, 'API_MANAGED_BY_PLATFORM');
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
    await db.query("INSERT INTO settings(tenant_id,key,value) VALUES(:tenant,'image_keys',$1) ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(current)]);
    keysCache = { at: clock(), value: current };
    return status();
  }
  const chainOf = i2i => (list(env[i2i ? 'IMAGEGEN_MODELS_I2I' : 'IMAGEGEN_MODELS_T2I']).concat(i2i ? CHAIN_I2I : CHAIN_T2I)).filter((m, i, all) => all.indexOf(m) === i);

  /** Models to try, in order: the admin's model for the tool first, then the free chain. */
  async function candidates(rows, needImage) {
    const out = [];
    const add = async (engine, model, extra = {}) => {
      if (!ENGINES[engine] || !model || out.some(c => c.engine === engine && c.model === model)) return;
      const cap = capability(engine, model);
      if (needImage && !cap.i2i) return;
      const { key } = await keyOf(engine, extra.key);
      if (!key) return;
      if ((cooling.get(`${engine}|${model}`) || 0) > clock()) return;
      out.push({ engine, model, key, base: await baseFor(engine, extra.row), label: extra.label || cap.title, cap, requested: !!extra.row, rowId: extra.row?.id });
    };
    // `rows`: the admin's model for the tool, or (rotation) the pool starting at the model whose turn it is; the others are fallbacks.
    for (const row of [].concat(rows || [])) if (row?.engine && ENGINES[row.engine] && row.enabled !== false) await add(row.engine, String(row.modelName || '').trim(), { key: row.apiKey, row, label: row.name });
    for (const model of chainOf(needImage)) await add('pollinations', model);
    return out;
  }

  /* ------------------------------------------------------------ rotation (Admin > AI models): each new creation uses the next selected model */
  const ROTATION_KEY = 'image_rotation';
  const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
  /** The saved switch + the chosen model ids (Settings.aiRotation), sanitised. */
  const rotationSetting = settings => {
    const raw = settings?.aiRotation;
    const ids = Array.isArray(raw?.ids) ? raw.ids.filter(id => typeof id === 'string' && ID_RE.test(id)).slice(0, 50) : [];
    return { on: raw?.on === true, ids: ids.filter((id, i) => ids.indexOf(id) === i) };
  };
  const rotationLast = async () => { try { const row = (await db.query('SELECT value FROM settings WHERE tenant_id=:tenant AND key=$1', [ROTATION_KEY]))[0]; return row ? String(JSON.parse(row.value).last || '') : ''; } catch { return ''; } };
  /** The selected models that exist, are switched on, have an engine, and (with a photo) can take one. In the admin's list order. */
  function rotationPool(collections, setting, needImage) {
    const chosen = new Set(setting.ids);
    return (collections.models || []).filter(m => chosen.has(m.id) && m.enabled !== false && m.visible !== false && m.engine && ENGINES[m.engine] && String(m.modelName || '').trim())
      .filter(m => !needImage || capability(m.engine, String(m.modelName).trim()).i2i)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  /** The pool as it is right now: usable models only (key present, not resting), rotated so the model whose turn it is comes first. */
  async function rotationOrder(collections, setting, needImage, last) {
    const usable = [];
    for (const m of rotationPool(collections, setting, needImage)) {
      const model = String(m.modelName).trim();
      if (!(await keyOf(m.engine, m.apiKey)).key || (cooling.get(`${m.engine}|${model}`) || 0) > clock()) continue;
      usable.push(m);
    }
    const at = usable.findIndex(m => m.id === last);
    return at < 0 ? usable : [...usable.slice(at + 1), ...usable.slice(0, at + 1)];
  }
  /** Takes the turn: the next usable model in the pool is reserved (so two renders at once never start on the same one). Null = rotation is off / nothing to rotate. */
  async function takeTurn(collections, settings, needImage) {
    const setting = rotationSetting(settings);
    if (!setting.on) return null;
    const pick = await db.tx(async q => {
      const stored = (await q('SELECT value FROM settings WHERE tenant_id=:tenant AND key=$1 FOR UPDATE', [ROTATION_KEY]))[0];
      const order = await rotationOrder(collections, setting, needImage, stored ? String(JSON.parse(stored.value).last || '') : '');
      if (!order.length) return null;
      await q('INSERT INTO settings(tenant_id,key,value) VALUES(:tenant,$1,$2) ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value', [ROTATION_KEY, JSON.stringify({ last: order[0].id, at: clock() })]);
      return order;
    });
    return pick ? { order: pick, size: rotationPool(collections, setting, needImage).length } : null;
  }
  /** A fallback model answered instead of the one whose turn it was: the next turn continues after the one that really ran. */
  const rotationUsed = (id, setting) => id && setting.ids.includes(id)
    ? db.query('INSERT INTO settings(tenant_id,key,value) VALUES(:tenant,$1,$2) ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value', [ROTATION_KEY, JSON.stringify({ last: id, at: clock() })]).catch(() => {})
    : Promise.resolve();
  /** What the admin screen shows: the switch, the pool in order, and which model is next (read only: nothing is taken). */
  async function rotationInfo() {
    const snapshot = await content.snapshot(true), c = snapshot.collections, setting = rotationSetting(snapshot.docs?.settings);
    const pool = rotationPool(c, setting, false);
    const order = await rotationOrder(c, setting, false, await rotationLast());
    return { on: setting.on, ids: setting.ids, pool: pool.map(m => ({ id: m.id, name: m.name, engine: m.engine, modelName: m.modelName })), next: order[0]?.id || '', active: setting.on && order.length > 0 };
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

  async function callEngine(candidate, { prompt, photo, references = [], size, signal }) {
    const headers = { Authorization: `Bearer ${candidate.key}`, 'Content-Type': 'application/json' };
    const withImage = !!photo;
    let body;
    if (withImage) {
      const images = [{ image_url: dataUri(photo) }];
      for (const extra of references) images.push({ image_url: dataUri(extra) });
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
   * The client's own words in English. Image models follow English far better than Darija / Arabic, so a brief written in Arabic
   * script is translated once (free keyless text model) and BOTH versions go into the prompt. On any failure the original is used.
   */
  async function toEnglish(text) {
    if (!text || !/[\u0600-\u06FF]/.test(text)) return '';
    try {
      const response = await timed('https://text.pollinations.ai/openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai-fast', temperature: 0.1, messages: [
        { role: 'system', content: 'You translate interior-design requests written in Moroccan Darija, Arabic or French into plain, precise English for an image generator. Keep every detail (objects, colours, materials, positions, numbers). Reply with ONLY the English text, no quotes, no comments.' },
        { role: 'user', content: text },
      ] }) }, 7000);
      void platform?.record?.({ kind: 'text', op: 'prompt-translate', provider: 'pollinations', units: 1, ok: response.ok });
      if (!response.ok) return '';
      const out = clean((await response.json())?.choices?.[0]?.message?.content, 700);
      return out && !/[\u0600-\u06FF]/.test(out) ? out : '';
    } catch { void platform?.record?.({ kind: 'text', op: 'prompt-translate', provider: 'pollinations', units: 1, ok: false }); return ''; }
  }

  /* ------------------------------------------------------------ the admin's prompt rules (Admin > Prompt cards) */
  let rulesCache = { at: 0, value: null };
  async function loadRules() {
    if (rulesCache.value && clock() - rulesCache.at < 15000) return rulesCache.value;
    let value = defaultRules();
    try { const row = (await db.query("SELECT value FROM settings WHERE tenant_id=:tenant AND key='prompt_rules'"))[0]; if (row) value = cleanRules(JSON.parse(row.value)); } catch { /* none stored: the defaults */ }
    rulesCache = { at: clock(), value };
    return value;
  }
  async function setRules(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'INVALID_RULES');
    const value = cleanRules(input);
    await db.query("INSERT INTO settings(tenant_id,key,value) VALUES(:tenant,'prompt_rules',$1) ON CONFLICT (tenant_id,key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(value)]);
    rulesCache = { at: clock(), value };
    return rulesInfo();
  }
  /** What the admin screen needs: the saved rules, the default wording of every block and what each {placeholder} means. */
  async function rulesInfo() {
    const blocks = Object.fromEntries(Object.entries(BLOCKS).map(([id, def]) => [id, def.variants]));
    return { rules: await loadRules(), catalog: { order: DEFAULT_ORDER, blocks, off: DEFAULT_OFF, placeholders: PLACEHOLDERS, vocab: { styles: STYLE_NOTES, rooms: ROOM_EN } } };
  }

  /* ------------------------------------------------------------ plan (what a generation is made of) and compose (what one model receives) */
  /**
   * Everything a generation is made of, resolved from the stored choices: content (tool, room, style, palette, inspiration), the admin's
   * rules for that tool, and the extra pictures the rules allow (each loaded once). `photo` is the client's photo, or a placeholder
   * { size } in a preview. Nothing here calls an image engine.
   */
  async function plan({ draft, photo, rules, translate = true, loadPictures = true }) {
    const snapshot = await content.snapshot(true), c = snapshot.collections;
    const style = c.styles?.find(x => x.id === draft.styleId), room = c.roomTypes?.find(x => x.id === draft.roomTypeId), palette = c.palettes?.find(x => x.id === draft.paletteId);
    const tool = c.tools?.find(x => x.id === draft.toolId);
    const row = c.models?.find(x => x.id === draft.modelId) || undefined;
    const inspiration = draft.inspirationId ? c.inspirations?.find(x => x.id === draft.inspirationId) : null;
    // A custom palette typed by the person wins over the preset one; "Surprise me" lets the model choose.
    const custom = normalizeColors(draft.colors);
    const preset = palette && !palette.isSurprise ? normalizeColors(palette.colors) : [];
    const colors = custom.length ? custom : preset;
    const colorSource = custom.length ? 'custom' : preset.length ? 'preset' : 'none';
    // Admin > Interface: with the Relooking / Renovation choice switched off, every generation (even an old draft) is a Relooking.
    const modeChoice = snapshot.docs?.settings?.modeChoice !== false;
    const english = translate ? await toEnglish(clean(draft.prompt, 500)) : '';
    // The admin's rules for this tool. They always apply; only the Explore-specific text needs an Explore picture (see resolveRules).
    const stored = rules || await loadRules();
    const explore = !!draft.inspirationId;
    const limited = false;
    const active = resolveRules(limited ? defaultRules() : stored, draft.toolId, explore);
    // The extra pictures the rules ask for. Order = priority when a model takes fewer pictures than asked.
    const wanted = [];
    if (photo) {
      // The Explorer picture is always sent when the client generates from Explore (it is not a setting).
      wanted.push({ role: 'inspiration', uri: inspiration?.image || '', missing: inspiration ? 'noPicture' : 'noChoice' });
      if (active.images.style !== 'text') wanted.push({ role: 'style', uri: style?.image || '', missing: style ? 'noPicture' : 'noChoice' });
      if (active.images.room !== 'text') wanted.push({ role: 'room', uri: room?.image || '', missing: room ? 'noPicture' : 'noChoice' });
    }
    const extras = [];
    for (const item of wanted) {
      const entry = { role: item.role, uri: item.uri || '', image: null, why: '' };
      if (!item.uri) entry.why = item.missing;
      else if (loadPictures) { entry.image = await loadImage(item.uri, { trustedHttps: true }).catch(() => null); if (!entry.image) entry.why = 'unreadable'; }
      extras.push(entry);
    }
    // Why a requested picture is not part of the generation although the admin asked for it (text-only generation).
    const off = [];
    if (!photo) for (const role of ['style', 'room']) if (active.images[role] !== 'text') off.push({ role, uri: (role === 'style' ? style : room)?.image || '', why: 'textOnly' });
    const base = {
      photo: !!photo, toolId: draft.toolId, toolTitle: lt(tool?.title, 'fr') + ' ' + lt(tool?.title, 'ar'), roomGroup: tool?.roomGroup || room?.group,
      roomTypeId: draft.roomTypeId, roomTitle: ROOM_EN[draft.roomTypeId] || clean(lt(room?.title), 60), styleId: draft.styleId, styleTitle: lt(style?.title),
      mode: modeChoice ? draft.mode : 'restyle', colors, colorSource, paletteName: lt(palette?.title), surprise: !colors.length && !!palette?.isSurprise, prompt: draft.prompt, promptEnglish: english, rules: active,
    };
    return { c, settings: snapshot.docs?.settings || {}, tool, room, style, palette, inspiration, row, base, english, active, extras, off, explore, limited, stored, size: fitSize(photo?.size, active.output.maxSide || Number(env.IMAGEGEN_MAX_SIDE) || 1024) };
  }
  /** What one model really receives: it takes `cap.refs - 1` extra pictures at most, and the prompt only speaks of the pictures that are sent. */
  function compose(planned, cap) {
    const room = Math.max(0, (cap?.refs || 1) - 1);
    const usable = planned.extras.filter(x => x.image || planned.preview);
    const sent = usable.slice(0, room);
    const images = [
      ...planned.extras.map(x => ({ role: x.role, uri: x.uri, mode: x.role === 'inspiration' ? 'image' : planned.active.images[x.role], sent: sent.includes(x), why: sent.includes(x) ? '' : x.why || (usable.includes(x) ? 'model' : 'unreadable') })),
      ...planned.off.map(x => ({ role: x.role, uri: x.uri, mode: planned.active.images[x.role], sent: false, why: x.why })),
    ];
    const brief = buildBrief({ ...planned.base, imageRoles: sent.map(x => x.role) });
    return { brief, images, references: sent.map(x => x.image).filter(Boolean) };
  }
  const recordImages = images => images.map(({ role, uri, mode, sent, why }) => ({ role, mode, sent, ...(why ? { why } : {}), ...(uri ? { uri } : {}) }));

  /**
   * Builds the prompt from the stored request (authoritative: nothing the client says at render time is trusted) and runs the chain.
   * The prompt is rebuilt for EVERY model that is tried, because what a model can take decides what the prompt may claim (a model that
   * accepts one picture never receives the style reference, so its prompt never mentions one).
   * Returns { imageUri, engine, model, label, cached, run } where `run` is the full record of the generation (stored on the request).
   */
  async function generate({ request, userId }) {
    const draft = request.draft || {};
    if (request.aiResult && /^\/api\/media\//.test(request.aiResult) && request.aiModel) return { imageUri: request.aiResult, ...request.aiModel, cached: true };
    const started = clock();
    const photo = request.photoUri ? await loadImage(request.photoUri) : null;
    if (request.photoUri && !photo) throw fail(422, 'PHOTO_UNREADABLE');
    const planned = await plan({ draft, photo });
    const { tool, room, style, palette, inspiration, row, english, size } = planned;
    // Rotation (Admin > AI models): this creation takes the next selected model; the tool's own model and the free chain stay as fallbacks.
    const turn = await takeTurn(planned.c, planned.settings, !!photo);
    const list = await candidates(turn ? [...turn.order, row] : row, !!photo);
    if (!list.length) throw fail(503, (await status()).live ? 'NO_PROVIDER' : 'AI_NOT_CONFIGURED');
    // The inputs as the admin will see them: titles are stored as they were at generation time, so a later rename or deletion changes nothing.
    const run = {
      at: started, size: `${size.width}x${size.height}`, photo: photo ? { width: photo.size?.width || 0, height: photo.size?.height || 0, bytes: photo.body.length } : null,
      english: english || undefined, tried: [],
      rotation: turn ? { turn: turn.order[0].id, pool: turn.size } : undefined,
      rules: { explore: planned.explore, appliesTo: planned.stored.appliesTo, applied: !planned.limited, scope: planned.active.scope },
      inputs: {
        tool: tool ? { id: tool.id, title: tool.title } : { id: draft.toolId }, room: room ? { id: room.id, title: room.title } : draft.roomTypeId ? { id: draft.roomTypeId } : null,
        style: style ? { id: style.id, title: style.title } : draft.styleId ? { id: draft.styleId } : null, palette: palette ? { id: palette.id, title: palette.title, colors: palette.colors, isSurprise: !!palette.isSurprise } : null,
        inspiration: inspiration ? { id: inspiration.id, image: inspiration.image } : null,
        requestedModel: row ? { id: row.id, name: row.name, engine: row.engine || '', modelName: row.modelName || '' } : null,
      },
    };
    // Vercel kills a function after 30 s (vercel.json): stay inside it there; long-running hosts get a generous budget.
    const deadline = clock() + (Number(env.IMAGEGEN_BUDGET_MS) || (env.VERCEL ? 25000 : 54000));
    let lastStatus = 0;
    for (const candidate of list) {
      const left = deadline - clock();
      if (left < (env.VERCEL ? 4000 : 6000)) break;
      // What this model really receives: the photo, and the extra pictures the rules ask for as far as it can take them.
      const { brief, images, references } = compose(planned, candidate.cap);
      run.prompt = brief.prompt; run.applied = brief.applied; run.images = recordImages(images);
      const step = { engine: candidate.engine, model: candidate.model, label: candidate.label, requested: !!candidate.requested, referenceSent: references.length > 0, imagesSent: references.length, ok: false };
      const t0 = clock();
      try {
        const out = await callEngine(candidate, { prompt: brief.prompt, photo, references: photo ? references : [], size, signal: Math.min(left, Number(env.IMAGEGEN_ATTEMPT_MS) || (env.VERCEL ? 24000 : 40000)) });
        void platform?.record?.({ kind: 'image', op: photo ? 'edit' : 'generate', provider: candidate.engine, units: 1, ok: true });
        const imageUri = await media.storeMedia({ body: out.bytes, mime: out.mime });
        cooling.delete(`${candidate.engine}|${candidate.model}`);
        // Another pool model answered (the one whose turn it was rested): the next creation continues after it.
        if (turn && candidate.rowId && candidate.rowId !== turn.order[0].id) await rotationUsed(candidate.rowId, rotationSetting(planned.settings));
        step.ok = true; step.ms = clock() - t0; run.tried.push(step);
        run.used = { engine: candidate.engine, model: candidate.model, label: candidate.label, referenceSent: references.length > 0, imagesSent: references.length };
        run.durationMs = clock() - started;
        return { imageUri, engine: candidate.engine, model: candidate.model, label: candidate.label, cached: false, run };
      } catch (error) {
        lastStatus = error.statusCode || lastStatus;
        const code = error.statusCode;
        void platform?.record?.({ kind: 'image', op: photo ? 'edit' : 'generate', provider: candidate.engine, units: 1, ok: false });
        step.ms = clock() - t0; step.status = code || 0; run.tried.push(step);
        // 404 / 422: this model does not exist here or cannot do this job -> next model. Everything else rests it briefly.
        if (code === 404 || code === 422 || code === 400) { cooling.set(`${candidate.engine}|${candidate.model}`, clock() + 600000); continue; }
        cooling.set(`${candidate.engine}|${candidate.model}`, clock() + (code === 429 ? 60000 : code === 401 || code === 403 || code === 402 ? 300000 : 20000));
      }
    }
    run.durationMs = clock() - started; run.failed = true;
    throw Object.assign(fail(503, 'NO_PROVIDER'), { lastStatus, run });
  }

  /**
   * Admin > Prompt cards: a FAKE generation. It runs exactly the steps of a real one (content lookup, rules of the tool, pictures,
   * prompt, model choice, size) and stops before the image engine, so the admin sees the final prompt and the pictures that would be
   * sent. `body.rules` previews unsaved edits. Draft fields follow the wizard; `body.explore` fills style and room the way the Explore
   * picture does ("Use this style").
   */
  async function previewPrompt(body) {
    const id = value => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : undefined);
    const input = body && typeof body === 'object' ? body : {};
    const snapshot = await content.snapshot(true), c = snapshot.collections;
    const inspiration = id(input.inspirationId) ? c.inspirations?.find(x => x.id === input.inspirationId) : null;
    const category = inspiration ? c.categories?.find(x => x.id === inspiration.categoryId) : null;
    const draft = {
      toolId: id(input.toolId), roomTypeId: id(input.roomTypeId) || (inspiration ? category?.roomTypeId : undefined), styleId: id(input.styleId) || (inspiration ? inspiration.styleId : undefined),
      mode: input.mode === 'renovation' ? 'renovation' : 'restyle', paletteId: id(input.paletteId), modelId: id(input.modelId),
      prompt: clean(input.prompt, 500) || undefined, colors: normalizeColors(input.colors), inspirationId: inspiration ? inspiration.id : undefined,
    };
    if (!draft.toolId || !c.tools?.some(x => x.id === draft.toolId)) throw fail(404, 'TOOL_NOT_FOUND');
    const withPhoto = input.source !== 'text';
    const planned = await plan({ draft, photo: withPhoto ? { size: { width: 1280, height: 960 } } : null, rules: input.rules ? cleanRules(input.rules) : undefined, loadPictures: false });
    planned.preview = true;
    // The model that would run first, with or without a key (a preview works before any engine is configured).
    const setting = rotationSetting(planned.settings);
    const upcoming = setting.on ? await rotationOrder(planned.c, setting, withPhoto, await rotationLast()) : [];
    const list = await candidates(setting.on ? [...upcoming, planned.row] : planned.row, withPhoto);
    const first = list[0];
    const fallback = chainOf(withPhoto)[0];
    const model = first ? { label: first.label, model: first.model, engine: first.engine, refs: first.cap.refs, live: true, rotating: setting.on && !!first.rowId && upcoming.some(m => m.id === first.rowId) } : { label: capability('pollinations', fallback).title, model: fallback, engine: 'pollinations', refs: capability('pollinations', fallback).refs, live: false };
    const { brief, images } = compose(planned, { refs: model.refs });
    const templates = Object.values(planned.active.blocks.items).flatMap(item => Object.values(item.texts || {}));
    const unknown = [...new Set(templates.flatMap(unknownPlaceholders))];
    const warnings = [];
    if (unknown.length) warnings.push({ code: 'unknownPlaceholder', items: unknown });
    if (images.some(x => x.why === 'model')) warnings.push({ code: 'modelImages', items: [model.label] });
    if (brief.prompt.length > 4000) warnings.push({ code: 'long', items: [String(brief.prompt.length)] });
    return {
      prompt: brief.prompt, blocks: brief.blocks, applied: brief.applied, images, model, size: `${planned.size.width}x${planned.size.height}`, chars: brief.prompt.length,
      source: withPhoto ? 'photo' : 'text', explore: planned.explore, appliesTo: planned.stored.appliesTo, ruled: !planned.limited, scope: planned.active.scope, warnings,
      draft: { toolId: draft.toolId, roomTypeId: draft.roomTypeId || '', styleId: draft.styleId || '', inspirationId: draft.inspirationId || '' },
    };
  }

  /** Idempotent per request: a second call returns the stored result (or joins the one in flight) and never generates twice. */
  async function renderRequest(client, claimId) {
    if (typeof claimId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(claimId)) throw fail(400, 'INVALID_CLAIM');
    const found = (await db.query('SELECT id,data FROM requests WHERE tenant_id=:tenant AND user_id=$1 AND client_request_id=$2', [client.id, claimId]))[0];
    if (!found) throw fail(404, 'NOT_FOUND');
    const key = found.id;
    if (inflight.has(key)) return inflight.get(key);
    if ((perClient.get(client.id) || 0) >= 2) throw fail(429, 'TOO_MANY_RENDERS');
    perClient.set(client.id, (perClient.get(client.id) || 0) + 1);
    const job = (async () => {
      const request = JSON.parse(found.data);
      let result;
      // Store allowance: one credit per new generation, taken atomically BEFORE the engine is called and given back if nothing was produced.
      const metered = !!platform && !(request.aiResult && /^\/api\/media\//.test(request.aiResult) && request.aiModel);
      // The AI gate (demo switch / paused store) comes first: a refused call costs no credit and reaches no provider.
      if (metered && platform.gate) await platform.gate('image', 'render');
      if (metered && !(await platform.consume(1))) throw fail(402, 'STORE_CREDITS_EXHAUSTED');
      try { result = await generate({ request, userId: client.id }); }
      catch (error) {
        if (metered) await platform.refund(1).catch(() => {});
        // Keep what was asked and which models failed: the admin sees it on the request (no result is stored, the client can retry).
        if (error.run) await db.query('UPDATE requests SET data=$1 WHERE tenant_id=:tenant AND id=$2', [JSON.stringify({ ...request, aiRun: error.run }), key]).catch(() => {});
        throw error;
      }
      if (!result.cached) {
        await db.tx(async q => {
          const row = (await q('SELECT data FROM requests WHERE tenant_id=:tenant AND id=$1 FOR UPDATE', [key]))[0];
          if (!row) return;
          const next = { ...JSON.parse(row.data), aiResult: result.imageUri, aiModel: { engine: result.engine, model: result.model, label: result.label }, aiRun: result.run };
          await q('UPDATE requests SET data=$1 WHERE tenant_id=:tenant AND id=$2', [JSON.stringify(next), key]);
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
    return { live, models, rotation: (await rotationInfo()).active, chain: { image: chainOf(true).map(m => capability('pollinations', m).title), text: chainOf(false).map(m => capability('pollinations', m).title) } };
  }
  return { renderRequest, status, setKeys, publicStatus, rulesInfo, setRules, previewPrompt, buildPrompt: input => buildBrief(input).prompt, buildBrief };
}
module.exports = { createImageGen, ENGINES, CATALOG, capability };
