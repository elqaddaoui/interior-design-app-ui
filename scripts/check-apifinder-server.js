/**
 * API finder (server/apifinder.js): discovery of every source, scoring, the real-generation proof, the scan lock, the Autopilot hook into
 * the image generator and the super-admin routes. The network is a fake: every source answers with the shape the real one returns today.
 * Run: node --test scripts/check-apifinder-server.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { createBackend } = require('../server');
const { hashPassword } = require('../server/admins');
const finderLib = require('../server/apifinder');
const { createFinder, fromPollinations, fromKeyless, fromOpenRouter, fromHuggingFace, fromHorde, evaluate, checkPicture } = finderLib;
const { freshDb, closeShared } = require('./test-db');

const SUPER = { email: 'boss@finder.test', password: 'Platform-Secret-123' };
const ENV = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '2000', STATIC_DIR: path.join(__dirname, 'no-such-dist'), SUPERADMIN_EMAIL: SUPER.email, SUPERADMIN_PASSWORD_HASH: hashPassword(SUPER.password) };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
test.after(closeShared);

/** A PNG header with the right size, padded with noise: looks like a real picture to the finder's checks. */
const picture = (w = 512, h = 384, seed = 7) => {
  const b = Buffer.alloc(Math.round(w * h * 0.1));
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + seed * 17) & 255;
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const flat = (w = 512, h = 384) => { const b = Buffer.alloc(300); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

/* ---- what each source answers today (trimmed copies of the real answers) ---- */
const POLL = [
  { name: 'tongyi-mai/z-image-turbo', title: 'Z-Image Turbo', category: 'image', publisher: 'Alibaba', community: false, paid_only: false, input_modalities: ['text'], output_modalities: ['image'], health: { status: 'healthy', success_rate: 99.9, requests: 11491 }, per_user_rpm: 60 },
  { name: 'black-forest-labs/flux.2-klein-4b', title: 'FLUX.2 Klein 4B', category: 'image', publisher: 'Black Forest Labs', paid_only: false, input_modalities: ['text', 'image'], output_modalities: ['image'], max_reference_images: 10, health: { status: 'healthy', success_rate: 97, requests: 900 } },
  { name: 'black-forest-labs/flux.1-kontext-pro', title: 'FLUX.1 Kontext Pro', category: 'image', paid_only: false, input_modalities: ['text', 'image'], output_modalities: ['image'], max_reference_images: 1 },
  { name: 'community/someone/odd-model', title: 'Odd', category: 'image', community: true, paid_only: false, input_modalities: ['text'], output_modalities: ['image'] },
  { name: 'openai/gpt-image-2', title: 'GPT Image 2', category: 'image', paid_only: true, input_modalities: ['text', 'image'], output_modalities: ['image'] },
  { name: 'kwaivgi/kling-v4.0-flash', title: 'Kling', category: 'video', paid_only: false, input_modalities: ['text'], output_modalities: ['video'] },
];
const OPENROUTER = { data: [
  { id: 'recraft/recraft-v4.1-flash-v2:free', name: 'Recraft free', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
  { id: 'openai/gpt-image-2', name: 'GPT Image 2', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] } },
  { id: 'openrouter/auto', name: 'Auto', architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] } },
] };
const HF_T2I = [
  { id: 'black-forest-labs/FLUX.1-schnell', inferenceProviderMapping: [{ provider: 'fal-ai', status: 'live', performance: { requestLatencyMs: 2421 } }, { provider: 'deepinfra', status: 'error' }] },
  { id: 'dead/Model', inferenceProviderMapping: [{ provider: 'x', status: 'error' }] },
];
const HF_I2I = [
  { id: 'black-forest-labs/FLUX.1-Kontext-dev', inferenceProviderMapping: [{ provider: 'fal-ai', status: 'live', performance: { requestLatencyMs: 9000 } }] },
  // what the real Hub returns next to them: add-ons that are no general interior-design generator
  { id: 'fal/3D-Game-Assets-Kontext-Dev-LoRA', inferenceProviderMapping: [{ provider: 'fal-ai', status: 'live' }] },
  { id: 'drbaph/Qwen-Image-Edit-2509-Caricature-LoRA', inferenceProviderMapping: [{ provider: 'fal-ai', status: 'live' }] },
  { id: 'someone/plain-name', tags: ['lora', 'diffusers'], inferenceProviderMapping: [{ provider: 'fal-ai', status: 'live' }] },
];
const HORDE = [
  { name: 'Deliberate', count: 5, eta: 12, queued: 3, type: 'image' }, { name: 'WAI-NSFW-illustrious-SDXL', count: 9, eta: 10, type: 'image' },
  { name: 'AbsoluteReality', count: 4, eta: 15, type: 'image' }, { name: 'Anything v5', count: 4, eta: 9, type: 'image' }, { name: 'Lonely', count: 1, eta: 3, type: 'image' },
];
const KEYLESS = ['sana'];

/** Programmable network: every URL pattern answers with JSON, bytes or a status. `calls` records everything. */
function fakeNet(overrides = {}) {
  const calls = [];
  const routes = {
    models: () => json(POLL), keyless: () => json(KEYLESS), openrouter: () => json(OPENROUTER),
    hf: url => json(/image-to-image/.test(url) ? HF_I2I : HF_T2I), horde: () => json(HORDE),
    gen: (url, body) => (body?.image ? bytes(picture(512, 384, 99)) : bytes(picture())), edits: null, keylessPic: () => bytes(picture(512, 384, 3)), ...overrides,
  };
  const json = data => ({ ok: true, status: 200, json: async () => data, arrayBuffer: async () => new ArrayBuffer(0) });
  const bytes = buf => ({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: buf.toString('base64') }] }), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });
  const status = code => ({ ok: false, status: code, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body, auth: (options.headers || {}).Authorization });
    let handler;
    if (/gen\.pollinations\.ai\/image\/models/.test(url)) handler = routes.models;
    else if (/image\.pollinations\.ai\/models/.test(url)) handler = routes.keyless;
    else if (/openrouter\.ai/.test(url)) handler = routes.openrouter;
    else if (/huggingface\.co\/api\/models/.test(url)) handler = routes.hf;
    else if (/aihorde\.net/.test(url)) handler = routes.horde;
    else if (/image\.pollinations\.ai\/prompt/.test(url)) handler = routes.keylessPic;
    else if (/\/images\/edits/.test(url)) handler = routes.edits || routes.gen;
    else if (/\/images\/generations/.test(url)) handler = routes.gen;
    if (!handler) throw new Error(`unexpected request ${url}`);
    const r = await handler(url, body);
    return typeof r === 'number' ? status(r) : r;
  };
  return { fetch, calls, status, json, bytes };
}

const FAKE_KEY = { key: 'test-pollinations-key-0001', base: 'https://gen.pollinations.ai/v1' };
async function finderFor(net, { key = FAKE_KEY, env = {}, clock } = {}) {
  const db = await freshDb();
  return { db, finder: createFinder({ db, env: { PGLITE_DIR: ':memory:', ...env }, fetch: net.fetch, ...(clock ? { clock } : {}), keyFor: async () => key }) };
}

/* ======================================================================= discovery */
test('every source is normalised: only FREE image models are kept, paid and non-image ones are counted and dropped', () => {
  const poll = fromPollinations(POLL);
  assert.deepEqual(poll.items.map(x => x.model), ['tongyi-mai/z-image-turbo', 'black-forest-labs/flux.2-klein-4b', 'black-forest-labs/flux.1-kontext-pro', 'community/someone/odd-model']);
  assert.equal(poll.paid, 1, 'the paid model is counted, not listed');
  const klein = poll.items.find(x => /klein/.test(x.model));
  assert.equal(klein.i2i, true); assert.equal(klein.refs, 10); assert.equal(klein.connectable, true); assert.equal(klein.health.rate, 97);
  assert.equal(poll.items.find(x => /z-image/.test(x.model)).i2i, false);
  assert.equal(poll.items.find(x => /odd/.test(x.model)).community, true);

  assert.deepEqual(fromKeyless(KEYLESS).items.map(x => x.id), ['keyless:sana']);
  assert.equal(fromKeyless(['bad name!', 42, 'ok']).items.length, 1, 'junk is ignored');

  const router = fromOpenRouter(OPENROUTER);
  assert.deepEqual(router.items.map(x => x.model), ['recraft/recraft-v4.1-flash-v2:free'], 'only explicit :free ids, never the router pseudo models');
  assert.equal(router.paid, 1);

  const hf = fromHuggingFace(HF_T2I, HF_I2I);
  assert.deepEqual(hf.items.map(x => x.model).sort(), ['black-forest-labs/FLUX.1-Kontext-dev', 'black-forest-labs/FLUX.1-schnell']);
  assert.equal(hf.items.find(x => /Kontext/.test(x.model)).i2i, true, 'edit-capable per the image-to-image list');
  assert.equal(hf.items.some(x => /LoRA|plain-name|Game-Assets/i.test(x.model)), false, 'adapters and narrow fine-tunes are not candidates');
  assert.equal(hf.items.find(x => /schnell/.test(x.model)).latencyHint, 2421);

  const horde = fromHorde(HORDE);
  assert.deepEqual(horde.items.map(x => x.model).sort(), ['AbsoluteReality', 'Deliberate'], 'realistic, staffed, not NSFW / anime / single-worker models');

  for (const garbage of [null, undefined, 'x', 42, {}, [null, 1, 'a'], { data: 'no' }]) {
    for (const fn of [fromPollinations, fromKeyless, fromOpenRouter, fromHuggingFace, fromHorde]) assert.ok(Array.isArray(fn(garbage, garbage).items), 'garbage in, empty list out, no throw');
  }
});

/* ======================================================================= scoring */
test('score: a proven photo editor beats a proven text-only model, which beats anything unproven; failing sinks; reasons add up', () => {
  const now = Date.now();
  const ok = (ms, at = now) => ({ ok: true, ms, at, bytes: 90000, width: 512, height: 384 });
  const klein = { model: 'black-forest-labs/flux.2-klein-4b', i2i: true, refs: 10, tier: 'free-tier', keyOk: true, needsKey: true, health: { rate: 97 }, proof: { t2i: ok(6000), i2i: ok(9000) }, attempts: 4, ema: 1 };
  const turbo = { model: 'tongyi-mai/z-image-turbo', i2i: false, refs: 0, tier: 'free-tier', keyOk: true, needsKey: true, health: { rate: 99.9 }, proof: { t2i: ok(3000) }, attempts: 4, ema: 1 };
  const fresh = { ...klein, proof: {}, attempts: 0, ema: undefined };
  const dead = { ...klein, proof: { t2i: { ok: false, ms: 1000, at: now, error: 'server_error' } }, attempts: 3, ema: 0.2 };
  const a = evaluate(klein, now), b = evaluate(turbo, now), c = evaluate(fresh, now), d = evaluate(dead, now);
  assert.equal(a.status, 'verified'); assert.equal(a.i2iProven, true);
  assert.equal(b.status, 'verified'); assert.equal(b.i2iProven, false);
  assert.equal(c.status, 'unverified'); assert.ok(c.score <= 60, 'unproven is capped');
  assert.equal(d.status, 'failing'); assert.ok(d.score <= 20);
  assert.ok(a.score > b.score && b.score > c.score && c.score > d.score, `${a.score} > ${b.score} > ${c.score} > ${d.score}`);
  assert.ok(a.score <= 100 && d.score >= 0);
  assert.equal(a.reasons.reduce((n, r) => n + r.points, 0) >= a.score - 1, true, 'the listed reasons explain the score');
  // a quota answer is not a failure
  const limited = evaluate({ ...klein, proof: { t2i: { ok: false, ms: 200, at: now, error: 'rate_limited', inconclusive: true } }, attempts: 0, ema: undefined }, now);
  assert.notEqual(limited.status, 'failing');
  // no key: needs_key, never verified
  assert.equal(evaluate({ ...klein, keyOk: false, proof: {} }, now).status, 'needs_key');
  // an old proof is flagged stale
  assert.equal(evaluate({ ...klein, proof: { t2i: ok(6000, now - 60 * 3600000) } }, now).stale, true);
});

test('ranking: untested models that need a free key are not buried under untested ones that need none; failing is always last', async () => {
  const { finder } = await finderFor(fakeNet(), { key: null });
  const view = await finder.scan({ probe: false });
  const order = view.candidates.map(c => c.status);
  assert.equal(order.at(-1) === 'failing' || !order.includes('failing'), true);
  const firstHorde = view.candidates.findIndex(c => c.source === 'horde');
  const klein = view.candidates.findIndex(c => /klein/.test(c.model) && c.source === 'pollinations');
  assert.ok(klein < firstHorde, 'a photo-capable Pollinations model outranks an untested volunteer-queue model');
  assert.equal(view.bestUsable, false, 'nothing callable has proven itself without a key');
  assert.equal(view.suggested, 'pollinations:black-forest-labs/flux.2-klein-4b', 'the screen can say which key to get for the best photo editor');
});

test('picture checks reject what an engine can fake: empty, not an image, tiny, blank, or an "edit" that returned the input', () => {
  assert.equal(checkPicture(picture()).ok, true);
  assert.equal(checkPicture(Buffer.alloc(0)).error, 'empty');
  assert.equal(checkPicture(Buffer.from('<html>error page</html> padding padding')).error, 'not_an_image');
  assert.equal(checkPicture(picture(64, 64)).error, 'too_small');
  assert.equal(checkPicture(flat()).error, 'blank');
  const same = picture();
  assert.equal(checkPicture(same, { notSameAs: Buffer.from(same) }).error, 'unchanged');
  assert.equal(checkPicture(picture(512, 384, 5), { notSameAs: same }).ok, true);
});

/* ======================================================================= scan: discover + prove */
test('a scan finds candidates from all five sources, proves them with real generations and an edit, and ranks the best first', async () => {
  const net = fakeNet();
  const { finder } = await finderFor(net);
  const view = await finder.scan({});
  assert.deepEqual(view.sources.map(s => [s.id, s.ok]), [['pollinations', true], ['keyless', true], ['openrouter', true], ['huggingface', true], ['horde', true]]);
  assert.equal(view.totals.found, 4 + 1 + 1 + 2 + 2);
  const klein = view.candidates.find(x => /klein/.test(x.model));
  assert.equal(klein.status, 'verified'); assert.equal(klein.i2iProven, true, 'the edit really happened and returned a different picture');
  assert.ok(klein.latencyMs >= 0 && klein.editMs >= 0);
  const edit = net.calls.find(c => /images\/edits/.test(c.url) && /klein/.test(c.body.model));
  assert.ok(edit && Array.isArray(edit.body.image) && /^data:image\/png;base64,/.test(edit.body.image[0].image_url), 'the edit sends a real picture');
  assert.equal(edit.auth, `Bearer ${FAKE_KEY.key}`);
  assert.equal(view.candidates.find(x => /z-image/.test(x.model)).i2iProven, false);
  assert.equal(view.candidates.some(x => x.id === 'keyless:sana' && x.status === 'verified'), true, 'the keyless model is tested too, with no key');
  assert.equal(view.candidates.find(x => x.source === 'openrouter').status, 'needs_key');
  assert.equal(view.best, 'pollinations:black-forest-labs/flux.2-klein-4b'.replace('flux.2-klein-4b', view.candidates.find(x => x.id === view.best)?.model.split('/')[1]), 'best is a verified, callable, photo-capable model');
  const best = view.candidates.find(x => x.id === view.best);
  assert.ok(best.connectable && best.i2iProven && best.status === 'verified');
  assert.equal(view.bestUsable, true);
  assert.equal(view.candidates[0].status, 'verified', 'verified models come first');
  for (let i = 1; i < view.candidates.length; i++) if (view.candidates[i - 1].status === view.candidates[i].status) assert.ok(view.candidates[i - 1].score >= view.candidates[i].score, 'ordered by score inside a status');
  assert.ok(!JSON.stringify(view).includes(FAKE_KEY.key), 'a key never appears in the answer');
});

test('one source down never blocks the others, and its candidates survive the outage', async () => {
  const net = fakeNet();
  const { finder, db } = await finderFor(net);
  await finder.scan({ probe: false });
  const before = (await finder.view()).candidates.filter(x => x.source === 'openrouter').length;
  assert.equal(before, 1);
  const broken = fakeNet({ openrouter: () => 503, horde: () => { throw new Error('socket'); } });
  const f2 = createFinder({ db, env: { PGLITE_DIR: ':memory:' }, fetch: broken.fetch, keyFor: async () => FAKE_KEY });
  const view = await f2.scan({ probe: false });
  const src = Object.fromEntries(view.sources.map(s => [s.id, s]));
  assert.equal(src.openrouter.ok, false); assert.equal(src.openrouter.error, 'http_503');
  assert.equal(src.horde.ok, false); assert.equal(src.horde.error, 'unreachable');
  assert.equal(src.pollinations.ok, true);
  assert.equal(view.candidates.filter(x => x.source === 'openrouter').length, 1, 'an outage is not a removal');
});

test('quota is not failure; a real failure is; an edit that changes nothing is not an edit proof; a flat image is a failure', async () => {
  const net = fakeNet({
    gen: (url, body) => {
      if (/klein/.test(body.model)) return net.status(429);
      if (/z-image/.test(body.model)) return net.bytes(flat());
      if (/kontext/.test(body.model)) return body.image ? net.bytes(picture(512, 384, 1)) : net.bytes(picture(512, 384, 1));
      return net.status(500);
    },
  });
  const { finder } = await finderFor(net);
  const view = await finder.scan({});
  const by = m => view.candidates.find(x => x.model === m);
  assert.notEqual(by('black-forest-labs/flux.2-klein-4b').status, 'failing', '429 = inconclusive');
  assert.equal(by('black-forest-labs/flux.2-klein-4b').lastError, 'rate_limited');
  assert.equal(by('tongyi-mai/z-image-turbo').status, 'failing'); assert.equal(by('tongyi-mai/z-image-turbo').lastError, 'blank');
  const kontext = by('black-forest-labs/flux.1-kontext-pro');
  assert.equal(kontext.status, 'verified', 'it still draws pictures'); assert.equal(kontext.i2iProven, false, 'the "edit" returned the same picture: not a working editor');
  assert.ok(kontext.reasons.some(r => r.code === 'editFailed' && r.error === 'unchanged'), 'the screen can say why');
  assert.ok(!kontext.reasons.some(r => r.code === 'photo'), 'a failed edit earns no photo capability points');
  assert.equal(by('community/someone/odd-model').status, 'failing');
});

test('the stability average moves with real outcomes and a banned model is neither probed nor chosen', async () => {
  let fail = false;
  const net = fakeNet({ gen: (url, body) => (fail && /z-image/.test(body.model) ? 500 : body.image ? net.bytes(picture(512, 384, 9)) : net.bytes(picture())) });
  let t = 1_700_000_000_000;
  const { finder } = await finderFor(net, { clock: () => t });
  await finder.scan({});
  let z = (await finder.view()).candidates.find(x => /z-image/.test(x.model));
  assert.equal(z.status, 'verified');
  fail = true; t += 7 * 3600000;
  await finder.scan({});
  z = (await finder.view()).candidates.find(x => /z-image/.test(x.model));
  assert.equal(z.status, 'failing', 'the newest decisive result wins');
  assert.ok(z.reasons.some(r => r.code === 'stability' && r.value < 100));
  await finder.setSettings({ banned: [z.id, 'pollinations:black-forest-labs/flux.2-klein-4b'] });
  const before = net.calls.length;
  t += 7 * 3600000;
  const view = await finder.scan({});
  assert.equal(net.calls.slice(before).some(c => c.body && /klein|z-image/.test(c.body.model)), false, 'banned models are not probed');
  assert.notEqual(view.best, 'pollinations:black-forest-labs/flux.2-klein-4b');
  assert.equal(view.candidates.at(-1).banned || view.candidates.some(x => x.banned), true);
});

test('without a key only the keyless source is tested, and nothing is called with an empty key', async () => {
  const net = fakeNet();
  const { finder } = await finderFor(net, { key: null });
  const view = await finder.scan({});
  assert.equal(net.calls.some(c => /\/images\//.test(c.url)), false);
  assert.equal(view.keys.pollinations, false);
  assert.equal(view.candidates.find(x => /klein/.test(x.model)).status, 'needs_key');
  assert.equal(view.candidates.find(x => x.id === 'keyless:sana').status, 'verified');
  assert.equal(view.candidates.find(x => /klein/.test(x.model)).testable, false);
  await assert.rejects(() => finder.probe('pollinations:black-forest-labs/flux.2-klein-4b'), e => e.message === 'KEY_MISSING');
});

test('probeMax limits the work of one scan; the models never proven go first, so repeated scans cover everything', async () => {
  const net = fakeNet();
  const { finder } = await finderFor(net);
  await finder.setSettings({ probeMax: 1 });
  await finder.scan({});
  const proven = () => finder.view().then(v => v.candidates.filter(x => x.source === 'pollinations' && x.probedAt).length);
  assert.equal(await proven(), 1);
  await finder.scan({});
  assert.equal(await proven(), 2, 'the next scan proves a different model');
  await finder.setSettings({ probeMax: 0 });
  const calls = net.calls.length;
  await finder.scan({});
  assert.equal(net.calls.slice(calls).some(c => /\/images\/generations/.test(c.url)), false, 'probeMax 0 = discovery only');
});

test('scans never overlap: a second scan while one runs is refused, and the lock frees itself', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const net = fakeNet({ models: async () => { await gate; return net.json(POLL); } });
  const { finder, db } = await finderFor(net);
  const first = finder.scan({ probe: false });
  await new Promise(r => setTimeout(r, 30));
  const second = await finder.scan({ probe: false });
  assert.equal(second.skipped, 'busy'); assert.equal(second.scanning, true);
  await assert.rejects(() => finder.probe('keyless:sana'), e => e.message === 'SCAN_RUNNING');
  release();
  await first;
  assert.equal((await finder.view()).scanning, false);
  // a crashed scan leaves an expired lock behind: the next one proceeds
  await db.query("INSERT INTO saas_kv(key,value) VALUES('finder_lock','1') ON CONFLICT (key) DO UPDATE SET value='1'");
  assert.notEqual((await finder.scan({ probe: false })).skipped, 'busy');
});

test('tick: scans only when automatic scanning is on and the interval has passed', async () => {
  let t = 1_700_000_000_000;
  const net = fakeNet();
  const { finder } = await finderFor(net, { clock: () => t });
  assert.notEqual((await finder.tick()).skipped, 'off', 'on by default: the first tick scans');
  assert.equal((await finder.tick()).skipped, 'not-due');
  t += 5 * 3600000; assert.equal((await finder.tick()).skipped, 'not-due', 'default interval is 6 hours');
  t += 2 * 3600000; assert.notEqual((await finder.tick()).skipped, 'not-due');
  await finder.setSettings({ autoScan: false });
  t += 99 * 3600000; assert.equal((await finder.tick()).skipped, 'off');
  assert.notEqual((await finder.tick({ force: true })).skipped, 'off', 'force overrides the switch (the daily cron)');
});

test('settings are validated and a value out of range is refused', async () => {
  const { finder } = await finderFor(fakeNet());
  const saved = await finder.setSettings({ intervalHours: 12, probeMax: 6, autopilot: true });
  assert.equal(saved.intervalHours, 12); assert.equal(saved.autopilot, true);
  for (const bad of [{ intervalHours: 0 }, { intervalHours: 500 }, { intervalHours: 1.5 }, { probeMax: 9 }, { probeMax: -1 }, { banned: 'x' }]) await assert.rejects(() => finder.setSettings(bad), e => e.status === 400);
  assert.deepEqual((await finder.setSettings({ banned: ['pollinations:a', 'junk', 5, 'pollinations:a'] })).banned, ['pollinations:a']);
});

/* ======================================================================= Autopilot: the finder feeds the image generator */
test('chain(): proven + fresh + callable + not banned, best first, and empty while Autopilot is off', async () => {
  let t = 1_700_000_000_000;
  const net = fakeNet();
  const { finder } = await finderFor(net, { clock: () => t });
  await finder.scan({});
  assert.deepEqual(await finder.chain(true), [], 'Autopilot is off by default');
  await finder.setSettings({ autopilot: true });
  const photo = await finder.chain(true);
  assert.deepEqual(photo.map(x => x.model), ['black-forest-labs/flux.2-klein-4b', 'black-forest-labs/flux.1-kontext-pro'], 'only models that PROVED a photo edit, best first');
  assert.equal(photo.some(x => /z-image|odd|sana/.test(x.model)), false, 'text-only models never enter the photo chain');
  const text = await finder.chain(false);
  assert.ok(text.length >= 3 && text[0].score >= text[1].score);
  await finder.setSettings({ banned: ['pollinations:black-forest-labs/flux.2-klein-4b', 'pollinations:black-forest-labs/flux.1-kontext-pro'] });
  assert.equal((await finder.chain(true)).length, 0);
  await finder.setSettings({ banned: [] });
  t += 49 * 3600000;
  assert.deepEqual(await finder.chain(true), [], 'a proof older than two days is not trusted');
});

test('the image generator tries the proven models first, then its built-in list; a finder error changes nothing', async () => {
  const { createImageGen } = require('../server/imagegen');
  const seen = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body); seen.push(body.model);
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: picture(1024, 768).toString('base64') }] }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const db = await freshDb();
  const content = { snapshot: async () => ({ collections: { tools: [{ id: 't', title: { fr: 'x' } }], models: [] }, docs: { settings: {} } }) };
  const media = { storeMedia: async () => '/api/media/' + 'a'.repeat(32) + '.png', readMedia: async () => null };
  const make = finder => createImageGen(db, { env: { POLLINATIONS_API_KEY: 'test-pollinations-key-0001' }, fetch: fetchImpl, media, content, platform: null, finder });
  const chainOf = async finder => { const gen = make(finder); const r = await gen.previewPrompt({ toolId: 't', source: 'text' }); return r.model; };
  // The preview shows the model that would run first.
  assert.equal((await chainOf(null)).model, 'tongyi-mai/z-image-turbo', 'built-in order without a finder');
  const proven = { chain: async i2i => (i2i ? [] : [{ model: 'black-forest-labs/flux.2-klein-4b', label: 'FLUX.2 Klein 4B', refs: 10, score: 90, ms: 1000 }]) };
  assert.equal((await chainOf(proven)).model, 'black-forest-labs/flux.2-klein-4b', 'the proven model comes first');
  assert.equal((await chainOf({ chain: async () => { throw new Error('boom'); } })).model, 'tongyi-mai/z-image-turbo', 'a finder failure falls back to the built-in list');
  assert.equal((await chainOf({ chain: async () => [] })).model, 'tongyi-mai/z-image-turbo');
});

/* ======================================================================= the super-admin routes */
function call(backend, url, { method = 'GET', body, headers = {}, ip = 'finder-test' } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, socket: { remoteAddress: ip } });
    const out = { headers: {} }; const chunks = [];
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.headersSent = false;
    res.setHeader = (k, v) => { out.headers[k.toLowerCase()] = v; };
    res.writeHead = (status, extra) => { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(extra || {}).map(([k, v]) => [k.toLowerCase(), v]))); res.headersSent = true; };
    res.on('finish', () => { const text = Buffer.concat(chunks).toString(); try { out.body = text ? JSON.parse(text) : undefined; } catch { out.text = text; } resolve(out); });
    backend.handle(req, res);
  });
}
async function setup(net = fakeNet(), env = {}) {
  const db = await freshDb();
  const backend = createBackend({ env: { ...ENV, ...env }, db, media: { storage: null, download: offline }, imageFetch: net.fetch });
  await backend.db.query('select 1');
  await db.query("INSERT INTO saas_tenants(id,slug,name,kind,status,created_at,updated_at) VALUES('default','default','Default','default','active',0,0) ON CONFLICT (id) DO NOTHING");
  backend.tenants.invalidate();
  const signin = await call(backend, '/api/super-admin/login', { method: 'POST', headers: { 'x-dwira-native': '1' }, body: SUPER });
  assert.equal(signin.status, 200);
  const api = (url, opts = {}) => call(backend, `/api/super-admin${url}`, { ...opts, headers: { 'x-super-token': signin.body.token, ...(opts.headers || {}) } });
  return { db, backend, api, net };
}

test('routes: sign-in is required; scan, settings, test and add work; the platform key is used but never leaves the server', async () => {
  const net = fakeNet();
  const { api, backend, db } = await setup(net, { POLLINATIONS_API_KEY: FAKE_KEY.key });
  assert.equal((await call(backend, '/api/super-admin/finder')).status, 401);
  assert.equal((await call(backend, '/api/super-admin/finder/scan', { method: 'POST', body: {} })).status, 401);

  const empty = await api('/finder');
  assert.equal(empty.status, 200); assert.equal(empty.body.candidates.length, 0); assert.equal(empty.body.keys.pollinations, true, 'the host variable is found');

  const scanned = await api('/finder/scan', { method: 'POST', body: {} });
  assert.equal(scanned.status, 200, JSON.stringify(scanned.body));
  assert.ok(scanned.body.totals.verified >= 3 && scanned.body.best);
  assert.equal(scanned.body.settings.autopilot, false);
  assert.ok(!JSON.stringify(scanned.body).includes(FAKE_KEY.key));

  const settings = await api('/finder/settings', { method: 'PATCH', body: { autopilot: true, intervalHours: 3 } });
  assert.equal(settings.status, 200); assert.equal(settings.body.settings.autopilot, true); assert.equal(settings.body.settings.intervalHours, 3);
  assert.equal((await api('/finder/settings', { method: 'PATCH', body: { intervalHours: 0 } })).status, 400);

  const tested = await api('/finder/test', { method: 'POST', body: { id: 'pollinations:tongyi-mai/z-image-turbo' } });
  assert.equal(tested.status, 200);
  assert.equal((await api('/finder/test', { method: 'POST', body: { id: 'nope:none' } })).status, 404);
  assert.equal((await api('/finder/test', { method: 'POST', body: {} })).status, 404);

  // The Autopilot switch reaches the real tenant image generator through the bundle.
  assert.equal((await backend.bundles.finder.chain(false)).length > 0, true);

  // One-click connect: only engines the app can call; the key is stored in the manager and not returned.
  const bad = await api('/finder/add', { method: 'POST', body: { id: 'openrouter:recraft/recraft-v4.1-flash-v2:free', apiKey: 'abcdefabcdef1234' } });
  assert.equal(bad.status, 404, 'a source the app cannot call yet cannot be connected');
  const added = await api('/finder/add', { method: 'POST', body: { id: 'pollinations:tongyi-mai/z-image-turbo', apiKey: 'another-test-key-777777' } });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.kind, 'image'); assert.equal(added.body.provider, 'pollinations'); assert.ok(!JSON.stringify(added.body).includes('another-test-key'));
  assert.equal((await api('/finder/add', { method: 'POST', body: { id: 'pollinations:tongyi-mai/z-image-turbo', apiKey: 'x' } })).status, 400, 'a malformed key is refused');
  const audit = await db.query("SELECT action FROM saas_audit WHERE action LIKE 'finder.%' OR action='api.create'");
  assert.ok(audit.some(r => r.action === 'finder.scan') && audit.some(r => r.action === 'finder.settings'), 'every action is audited');
});

test('a key held in the API manager is used for the probes and a disabled one is not', async () => {
  const net = fakeNet();
  const { api } = await setup(net);
  assert.equal((await api('/finder')).body.keys.pollinations, false);
  const created = await api('/apis', { method: 'POST', body: { kind: 'image', provider: 'pollinations', apiKey: 'manager-held-key-12345' } });
  assert.equal(created.status, 201);
  assert.equal((await api('/finder')).body.keys.pollinations, true);
  const scanned = await api('/finder/scan', { method: 'POST', body: {} });
  assert.equal(net.calls.some(c => c.auth === 'Bearer manager-held-key-12345' && /images\/generations/.test(c.url)), true);
  assert.ok(scanned.body.totals.verified >= 3);
  await api(`/apis/${created.body.id}`, { method: 'PATCH', body: { enabled: false } });
  assert.equal((await api('/finder')).body.keys.pollinations, false, 'a switched-off connection is not used');
});
