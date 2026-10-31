const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { buildPrompt, normalizeColors, colorName } = require('../server/imagegen/prompt');
const { sniffMime, imageSize, fitSize } = require('../server/imagegen/image');
const { freshDb, closeShared } = require('./test-db');

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const out = { headers: {} };
    const res = { headersSent: false, setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, writeHead(status, h) { out.status = status; for (const [k, v] of Object.entries(h || {})) out.headers[k.toLowerCase()] = v; this.headersSent = true; },
      end(value) { try { out.body = value && String(out.headers['content-type']).includes('json') && !out.headers['content-encoding'] ? JSON.parse(value) : undefined; } catch { /* binary */ } out.raw = value; resolve(out); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
/** A real 8x6 PNG header + padding: enough for the magic bytes and the size reader. */
const png = (w = 640, h = 480) => { const b = Buffer.alloc(64, 1); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const photoUri = `data:image/png;base64,${png().toString('base64')}`;

/** Fake image API: records every call and answers like the OpenAI-compatible endpoints. */
function fakeApi(plan = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, headers: options.headers || {}, body });
    const model = body?.model;
    const answer = plan[model] ?? plan.default ?? 200;
    if (typeof answer === 'number' && answer !== 200) return { ok: false, status: answer, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png(1024, 768).toString('base64') }] }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}
async function setup(env = {}, api = fakeApi()) {
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', ...env }, db: await freshDb(), media: { storage: null, download: offline }, imageFetch: api.fetch });
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  const admin = { authorization: `Bearer ${login.body.token}` };
  const who = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Design Client', phone: '0661000077' } });
  await backend.clients.grant(who.body.user.id, 20);
  return { backend, admin, api, auth: { 'x-user-token': who.body.token, 'x-demand-token': 'a'.repeat(64) }, user: who.body.user };
}
const demand = (id, draft = {}, extra = {}) => ({ id, photoUri, draft: { toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', mode: 'restyle', ...draft }, ...extra });

test('prompt: structure rules, mode, exact hex colours, style, user text; palette names are sensible', () => {
  const colors = normalizeColors(['#b5651d', '#B5651D', 'red', '#12345', '#F2EFEA']);
  assert.deepEqual(colors, ['#B5651D', '#F2EFEA']);
  const restyle = buildPrompt({ photo: true, toolId: 'tool_interior', roomTitle: 'bedroom', styleId: 'st_scandi', mode: 'restyle', colors, prompt: 'add a  big\nplant' });
  assert.match(restyle, /same camera position/);
  assert.match(restyle, /MODE restyle: keep the existing furniture/);
  assert.match(restyle, /#B5651D \(rust\) as dominant/);
  assert.match(restyle, /Scandinavian/);
  assert.match(restyle, /"add a big plant"/);
  const reno = buildPrompt({ photo: true, toolId: 'tool_interior', roomTitle: 'kitchen', mode: 'renovation' });
  assert.match(reno, /MODE renovation/);
  assert.match(reno, /real-world scale/);
  const text = buildPrompt({ photo: false, toolId: 'tool_interior', roomTitle: 'living room', styleId: 'st_luxury', surprise: true });
  assert.doesNotMatch(text, /same camera position/);
  assert.match(text, /choose a harmonious/);
  assert.match(buildPrompt({ photo: true, hasReference: true, toolId: 'x' }), /STYLE REFERENCE ONLY/);
  assert.equal(colorName('#FFFFFF'), 'white');
  assert.equal(colorName('#1C2E5A'), 'navy blue');
});

test('image helpers: magic bytes, header size, size that keeps the aspect ratio', () => {
  assert.equal(sniffMime(png()), 'image/png');
  assert.equal(sniffMime(Buffer.from('not an image at all')), null);
  assert.deepEqual(imageSize(png(800, 600)), { width: 800, height: 600 });
  assert.deepEqual(fitSize({ width: 800, height: 600 }), { width: 1024, height: 768 });
  assert.deepEqual(fitSize({ width: 600, height: 800 }), { width: 768, height: 1024 });
  const wide = fitSize({ width: 4000, height: 500 });
  assert(wide.width % 16 === 0 && wide.height % 16 === 0 && wide.width / wide.height <= 2.51);
});

test('render: photo + palette + prompt go to the free image-to-image model; result stored as media, idempotent, key never leaks', async () => {
  const api = fakeApi();
  const { backend, auth, admin } = await setup({ POLLINATIONS_API_KEY: 'sk_test_key_123456' }, api);
  try {
    const created = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('render-claim-0001', { paletteId: 'pal_earth', prompt: 'warm light', colors: ['#112233'] }) });
    assert.equal(created.status, 201);
    const out = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'render-claim-0001' } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.match(out.body.imageUri, /^\/api\/media\/[a-f0-9]{32}\.png$/);
    assert.equal(out.body.model, 'black-forest-labs/flux.2-klein-4b');
    assert.equal(api.calls.length, 1);
    const sent = api.calls[0];
    assert.match(sent.url, /\/images\/edits$/);
    assert.equal(sent.headers.Authorization, 'Bearer sk_test_key_123456');
    assert.equal(sent.body.size, '1024x768', 'matches the photo ratio 4:3');
    assert.match(sent.body.image[0].image_url, /^data:image\/png;base64,/);
    assert.match(sent.body.prompt, /#112233/, 'custom colours win over the preset palette');
    assert.doesNotMatch(sent.body.prompt, /#B5651D/);
    assert.match(sent.body.prompt, /warm light/);
    assert.match(sent.body.prompt, /Moroccan/);
    assert.match(sent.body.prompt, /living room/);
    // The generated picture is served from our media store and recorded on the request.
    assert.equal((await call(backend, out.body.imageUri)).status, 200);
    const list = await call(backend, '/api/requests', { headers: admin });
    assert.equal(list.body[0].aiResult, out.body.imageUri);
    assert.equal(list.body[0].aiModel.model, 'black-forest-labs/flux.2-klein-4b');
    // Replay: no second generation, same answer.
    const again = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'render-claim-0001' } });
    assert.equal(again.body.imageUri, out.body.imageUri);
    assert.equal(api.calls.length, 1);
    assert.equal(JSON.stringify(await call(backend, '/api/ai/status', { headers: auth })).includes('sk_test_key'), false);
  } finally { backend.server.emit('close'); }
});

test('render: text-to-image (no photo) uses the text endpoint and a text model; inspiration is a style reference on multi-image models', async () => {
  const api = fakeApi();
  const { backend, auth, admin } = await setup({ POLLINATIONS_API_KEY: 'sk_test_key_123456' }, api);
  try {
    const text = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id: 'text-claim-00001', photoUri: '', draft: { toolId: 'tool_interior', roomTypeId: 'rt_bedroom', styleId: 'st_boho', source: 'text', prompt: 'a calm bedroom' } } });
    assert.equal(text.status, 201, JSON.stringify(text.body));
    const out = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'text-claim-00001' } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.match(api.calls[0].url, /\/images\/generations$/);
    assert.equal(api.calls[0].body.model, 'tongyi-mai/z-image-turbo');
    assert.equal(api.calls[0].body.image, undefined);
    assert.match(api.calls[0].body.prompt, /bedroom/);
    assert.doesNotMatch(api.calls[0].body.prompt, /same camera position/);
    assert.equal((await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id: 'text-bad-000001', photoUri, draft: { toolId: 'tool_interior', source: 'text' } } })).status, 400, 'text mode carries no photo');
    // Inspiration (Explore) as a reference image: stored inspirations are admin content, so an https picture is fetched by the server.
    await call(backend, '/api/admin/content/inspirations/ins_ref', { method: 'PUT', headers: admin, body: { id: 'ins_ref', categoryId: 'x', image: `data:image/png;base64,${png(600, 400).toString('base64')}`, order: 1, visible: true } });
    await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('insp-claim-00001', { inspirationId: 'ins_ref' }) });
    const ref = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'insp-claim-00001' } });
    assert.equal(ref.status, 200);
    const sent = api.calls[api.calls.length - 1].body;
    assert.equal(sent.image.length, 2, 'photo + style reference');
    assert.match(sent.prompt, /STYLE REFERENCE ONLY/);
  } finally { backend.server.emit('close'); }
});

test('render: a failing model rests and the next free model takes over; no key = AI_NOT_CONFIGURED; other clients cannot render someone else\'s request', async () => {
  const api = fakeApi({ 'black-forest-labs/flux.2-klein-4b': 429 });
  const { backend, auth } = await setup({ POLLINATIONS_API_KEY: 'sk_test_key_123456' }, api);
  try {
    await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('chain-claim-00001') });
    const out = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'chain-claim-00001' } });
    assert.equal(out.status, 200);
    assert.equal(out.body.model, 'black-forest-labs/flux.1-kontext-pro');
    assert.deepEqual(api.calls.map(c => c.body.model), ['black-forest-labs/flux.2-klein-4b', 'black-forest-labs/flux.1-kontext-pro']);
    await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('chain-claim-00002') });
    await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'chain-claim-00002' } });
    assert.equal(api.calls.filter(c => c.body.model.includes('klein')).length, 1, 'the resting model is skipped');
    const other = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Someone Else', phone: '0661000078' } });
    const stranger = { 'x-user-token': other.body.token, 'x-demand-token': 'b'.repeat(64) };
    assert.equal((await call(backend, '/api/ai/render', { method: 'POST', headers: stranger, body: { id: 'chain-claim-00001' } })).status, 404);
    assert.equal((await call(backend, '/api/ai/render', { method: 'POST', body: { id: 'chain-claim-00001' } })).status, 401);
    assert.equal((await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'x' } })).status, 400);
  } finally { backend.server.emit('close'); }
  const { backend: bare, auth: bareAuth } = await setup({}, fakeApi());
  try {
    await call(bare, '/api/requests', { method: 'POST', headers: bareAuth, body: demand('bare-claim-00001') });
    const out = await call(bare, '/api/ai/render', { method: 'POST', headers: bareAuth, body: { id: 'bare-claim-00001' } });
    assert.equal(out.status, 503);
    assert.equal(out.body.error, 'AI_NOT_CONFIGURED');
  } finally { bare.server.emit('close'); }
});

test('admin: engine keys are write-only; an admin model with an engine runs first; status never shows keys', async () => {
  const api = fakeApi();
  const { backend, auth, admin } = await setup({}, api);
  try {
    assert.equal((await call(backend, '/api/admin/ai/status')).status, 401);
    assert.equal((await call(backend, '/api/admin/ai/keys', { method: 'PATCH', headers: admin, body: { pollinations: 'bad key!' } })).status, 400);
    const saved = await call(backend, '/api/admin/ai/keys', { method: 'PATCH', headers: admin, body: { pollinations: 'sk_stored_key_123456' } });
    assert.equal(saved.body.engines.pollinations.configured, true);
    assert.equal(saved.body.engines.pollinations.source, 'db');
    assert.equal(JSON.stringify(saved.body).includes('sk_stored_key'), false);
    await call(backend, '/api/admin/content/models/mdl_gemini', { method: 'PUT', headers: admin, body: { name: 'Kontext', provider: 'Pollinations', engine: 'pollinations', modelName: 'black-forest-labs/flux.1-kontext-pro', apiKey: '', enabled: true, isDefault: true, order: 0, visible: true } });
    await call(backend, '/api/requests', { method: 'POST', headers: auth, body: demand('admin-claim-00001', { modelId: 'mdl_gemini' }) });
    const out = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'admin-claim-00001' } });
    assert.equal(out.body.model, 'black-forest-labs/flux.1-kontext-pro');
    assert.equal(api.calls[0].headers.Authorization, 'Bearer sk_stored_key_123456');
    const pub = await call(backend, '/api/ai/status', { headers: auth });
    assert.equal(pub.body.live, true);
    assert(pub.body.models.some(m => m.id === 'mdl_gemini' && m.engine === 'pollinations' && m.i2i === true));
    assert.equal(JSON.stringify(pub.body).includes('sk_'), false);
    const removed = await call(backend, '/api/admin/ai/keys', { method: 'PATCH', headers: admin, body: { pollinations: '' } });
    assert.equal(removed.body.engines.pollinations.configured, false);
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);
