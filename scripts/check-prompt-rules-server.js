const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { buildBrief } = require('../server/imagegen/prompt');
const { cleanRules, resolveRules, defaultRules } = require('../server/imagegen/rules');
const { freshDb, closeShared } = require('./test-db');
const fixtures = require('./fixtures/prompt-defaults.json');

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
const png = (w = 640, h = 480) => { const b = Buffer.alloc(64, 1); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const photoUri = `data:image/png;base64,${png().toString('base64')}`;

/** Fake image API + fake picture host: engine calls are recorded, any other GET (a style / room / inspiration picture) returns a PNG. */
function fakeApi(plan = {}) {
  const calls = [], downloads = [];
  const fetch = async (url, options = {}) => {
    if (!/\/images\/(generations|edits)$/.test(url)) { downloads.push(url); return { ok: true, status: 200, arrayBuffer: async () => { const b = png(600, 400); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } }; }
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, body });
    const answer = plan[body?.model] ?? 200;
    if (answer !== 200) return { ok: false, status: answer, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png(1024, 768).toString('base64') }] }), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls, downloads };
}
async function setup(env = { POLLINATIONS_API_KEY: 'sk_test_key_123456' }, api = fakeApi()) {
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50', ...env }, db: await freshDb(), media: { storage: null, download: offline }, imageFetch: api.fetch });
  const login = await call(backend, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  const admin = { authorization: `Bearer ${login.body.token}` };
  const who = await call(backend, '/api/user/login', { method: 'POST', headers: native, body: { name: 'Design Client', phone: '0661000077' } });
  await backend.clients.grant(who.body.user.id, 30);
  const put = body => call(backend, '/api/admin/prompt-rules', { method: 'PUT', headers: admin, body });
  const preview = body => call(backend, '/api/admin/prompt-rules/preview', { method: 'POST', headers: admin, body });
  return { backend, admin, api, put, preview, auth: { 'x-user-token': who.body.token, 'x-demand-token': 'a'.repeat(64) } };
}
const draft = (extra = {}) => ({ toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', mode: 'restyle', ...extra });

test('defaults: with no rules the prompt and the record are exactly what the app always sent (15 fixtures)', () => {
  for (const [name, fx] of Object.entries(fixtures)) {
    const brief = buildBrief(fx.input);
    assert.equal(brief.prompt, fx.prompt, name);
    assert.equal(brief.applied.task, fx.applied.task, name);
    assert.deepEqual(brief.applied.colors, fx.applied.colors, name);
  }
  // an explicitly empty rules object resolves to the same thing
  const same = buildBrief({ ...fixtures.photo_restyle_colors_brief.input, rules: resolveRules(defaultRules(), 'tool_interior') });
  assert.equal(same.prompt, fixtures.photo_restyle_colors_brief.prompt);
});

test('rules: sanitising, a tool overrides blocks only, explore-only text', () => {
  const dirty = cleanRules({ appliesTo: 'nope', global: { rules: { text: '  keep\u0000 walls \r\n\r\n\r\n\r\n no clutter ', exploreText: 'x'.repeat(5000) }, images: { room: 'weird', style: 'image', inspiration: 'off' }, blocks: { order: ['quality', 'bogus', 'quality'], items: { quality: { on: false }, task: { texts: { photo: 'Redo {room}.', nope: 'x' } }, structure: { texts: { default: 'STRUCTURE (never change): keep exactly the same camera position, angle, lens, framing and perspective, the same layout and architecture - wall positions, ceiling height, floor area, windows, doors, openings, stairs, beams and built-in fixtures - and the same proportions. Do not add, remove, move or resize any structural element or window. Keep the direction and brightness of the natural light.' } } } }, output: { brief: 'english', maxSide: 999 } },
    tools: { tool_paint: { rules: { text: 'only walls' }, images: { style: 'image' }, blocks: { items: { quality: { on: false } } } }, 'bad id!': { blocks: {} } }, vocab: { styles: { st_modern: '  sleek  ', 'bad id': 'x' }, rooms: {} } });
  assert.equal(dirty.appliesTo, 'all');
  assert.equal(dirty.global.rules.text, 'keep walls\n\nno clutter');
  assert.equal(dirty.global.rules.exploreText.length, 2000);
  assert.deepEqual(dirty.global.images, { room: 'text', style: 'image' }, 'the Explorer picture is not a setting any more');
  assert.equal(dirty.global.blocks.order[0], 'quality');
  assert.equal(dirty.global.blocks.order.length, new Set(dirty.global.blocks.order).size);
  assert(dirty.global.blocks.order.includes('finalCheck'), 'every block is always present in the order');
  assert.deepEqual(dirty.global.blocks.items.quality, { on: false });
  assert.deepEqual(dirty.global.blocks.items.task, { texts: { photo: 'Redo {room}.' } });
  assert.equal(dirty.global.blocks.items.structure, undefined, 'default wording is never stored as a customisation');
  assert.equal(dirty.global.output.maxSide, 0);
  assert.deepEqual(Object.keys(dirty.tools), ['tool_paint']);
  assert.deepEqual(Object.keys(dirty.tools.tool_paint), ['blocks'], 'a tool can only override the prompt blocks (rules / pictures / output stay global)');
  assert.deepEqual(dirty.vocab.styles, { st_modern: 'sleek' });
  const base = { global: { rules: { text: 'A', exploreText: 'E' } } };
  assert.equal(resolveRules(cleanRules({ ...base, tools: { t1: { blocks: { items: { quality: { on: false } } } } } }), 't1', true).rulesText, 'A\nE');
  assert.equal(resolveRules(cleanRules(base), 'zzz', false).rulesText, 'A');
  // a tool's own blocks never override the picture blocks: they follow the global picture settings
  const own = cleanRules({ global: { images: { style: 'image' }, blocks: { items: { reference: { texts: { default: 'GLOBAL REF {nth}' } } } } }, tools: { t1: { blocks: { items: { reference: { texts: { default: 'TOOL REF' } }, styleImage: { on: false }, quality: { on: false } } } } } });
  const res = resolveRules(own, 't1');
  assert.equal(res.blocks.items.reference.texts.default, 'GLOBAL REF {nth}'); assert.equal(res.blocks.items.styleImage, undefined); assert.deepEqual(res.blocks.items.quality, { on: false });
  assert.equal(res.images.style, 'image', 'pictures are global');
});

test('blocks: switch off, reorder, own wording with placeholders, rules block, brief language', () => {
  const input = { ...fixtures.photo_restyle_colors_brief.input, promptEnglish: 'add a large plant', prompt: 'زيد نبتة كبيرة' };
  const rules = (g, extra = {}) => resolveRules(cleanRules({ global: g, ...extra }), 'tool_interior');
  const off = buildBrief({ ...input, rules: rules({ blocks: { items: { quality: { on: false }, structure: { on: false } } } }) });
  assert.doesNotMatch(off.prompt, /QUALITY:/); assert.doesNotMatch(off.prompt, /STRUCTURE \(never change\)/);
  assert.deepEqual(off.applied.blocksOff.sort(), ['quality', 'roomImage', 'structure', 'styleImage'], 'the style / room picture blocks are off by default');
  const moved = buildBrief({ ...input, rules: rules({ blocks: { order: ['quality'] } }) });
  assert.match(moved.prompt, /^QUALITY:/);
  assert.equal(moved.blocks[0].id, 'quality');
  const own = buildBrief({ ...input, rules: rules({ blocks: { items: { task: { texts: { photo: 'Redo this {room} ({group}) in {style} style.' } } } } }) });
  assert.match(own.prompt, /^Redo this living room \(interior\) in Scandinave style\./);
  assert.equal(own.blocks[0].custom, true);
  const withRules = buildBrief({ ...input, rules: rules({ rules: { text: 'Never change the floor\n- Keep the TV wall' } }) });
  assert.match(withRules.prompt, /DESIGN RULES \(mandatory, follow every rule\):\n- Never change the floor\n- Keep the TV wall/);
  const forgot = buildBrief({ ...input, rules: rules({ rules: { text: 'Only walls' }, blocks: { items: { rules: { texts: { default: 'MY RULES:' } } } } }) });
  assert.match(forgot.prompt, /MY RULES:\n- Only walls/, 'rules are appended when {rules} is missing from the wording');
  assert.match(buildBrief({ ...input, rules: rules({ output: { brief: 'english' } }) }).prompt, /"add a large plant"\./);
  assert.doesNotMatch(buildBrief({ ...input, rules: rules({ output: { brief: 'english' } }) }).prompt, /original wording/);
  assert.match(buildBrief({ ...input, rules: rules({ output: { brief: 'original' } }) }).prompt, /"زيد نبتة كبيرة"/);
  const vocab = buildBrief({ ...input, rules: resolveRules(cleanRules({ vocab: { styles: { st_scandi: 'pale ash wood, white linen' } } }), 'tool_interior') });
  assert.match(vocab.prompt, /STYLE: pale ash wood, white linen\./);
});

test('blocks: the picture blocks are off by default and follow the picture setting; an explicit switch wins', () => {
  const { blockOn, DEFAULT_OFF } = require('../server/imagegen/blocks');
  assert.deepEqual([...DEFAULT_OFF].sort(), ['roomImage', 'styleImage']);
  const R = (images, items) => resolveRules(cleanRules({ global: { images, blocks: { items } } }), 'tool_interior');
  const input = { ...fixtures.photo_restyle_colors_brief.input, roomTypeId: 'rt_living', imageRoles: ['style', 'room'] };
  assert.equal(R({}, {}).blocks.items.styleImage, undefined, 'nothing stored by default');
  assert.equal(blockOn('styleImage', undefined, { style: 'text', room: 'text' }), false); assert.equal(blockOn('styleImage', undefined, { style: 'both', room: 'text' }), true);
  assert.equal(blockOn('roomImage', undefined, { style: 'image', room: 'text' }), false); assert.equal(blockOn('quality', undefined, {}), true);
  // words only: no picture block even if a picture would travel
  assert.doesNotMatch(buildBrief({ ...input, rules: R({}, {}) }).prompt, /image shows/);
  // Image / Both switch the matching block on by themselves
  const both = buildBrief({ ...input, rules: R({ style: 'both', room: 'image' }, {}) });
  assert.match(both.prompt, /second image shows the "Scandinave" style/); assert.match(both.prompt, /third image shows the TYPE OF ROOM/);
  assert.deepEqual(both.applied.blocksOff, []);
  // an explicit OFF removes the sentence although the picture is still sent
  const forced = buildBrief({ ...input, rules: R({ style: 'image' }, { styleImage: { on: false } }) });
  assert.doesNotMatch(forced.prompt, /shows the STYLE/); assert.deepEqual(forced.applied.blocksOff, ['styleImage', 'roomImage']);
  assert.deepEqual(cleanRules({ global: { blocks: { items: { styleImage: { on: true }, quality: { on: true } } } } }).global.blocks.items, { styleImage: { on: true } }, 'only a real difference from the default is stored');
});

test('images: style / room pictures replace or join the words; missing picture or text-only keeps the words', () => {
  const input = { ...fixtures.photo_restyle_colors_brief.input, roomTypeId: 'rt_living' };
  const R = images => resolveRules(cleanRules({ global: { images } }), 'tool_interior');
  const img = buildBrief({ ...input, imageRoles: ['style'], rules: R({ style: 'image' }) });
  assert.match(img.prompt, /The second image shows the STYLE the client chose/);
  assert.doesNotMatch(img.prompt, /STYLE: Scandinavian/, 'the written style is replaced by the picture');
  assert.equal(img.applied.styleMode, 'image');
  assert.match(img.prompt, /FINAL CHECK:(?!.*style)/s.source ? /FINAL CHECK/ : /FINAL CHECK/);
  const both = buildBrief({ ...input, imageRoles: ['style', 'room'], rules: R({ style: 'both', room: 'both' }) });
  assert.match(both.prompt, /STYLE: Scandinavian/); assert.match(both.prompt, /second image shows the "Scandinave" style/); assert.match(both.prompt, /third image shows an example of the chosen room type \("living room"\)/);
  // style asked as picture-only but the picture is not sent (no picture / model takes one image): the words come back
  const fallback = buildBrief({ ...input, imageRoles: [], rules: R({ style: 'image', room: 'image' }) });
  assert.match(fallback.prompt, /STYLE: Scandinavian/); assert.match(fallback.prompt, /\(a living room\)/); assert.doesNotMatch(fallback.prompt, /image shows/);
  const roomImg = buildBrief({ ...input, imageRoles: ['room'], rules: R({ room: 'image' }) });
  assert.match(roomImg.prompt, /\(a room\)/); assert.match(roomImg.prompt, /second image shows the TYPE OF ROOM/);
  // text mode never mentions pictures
  const text = buildBrief({ ...fixtures.text_plain.input, imageRoles: ['style', 'room', 'inspiration'], rules: R({ style: 'image', room: 'image' }) });
  assert.doesNotMatch(text.prompt, /image shows|STYLE REFERENCE/);
});

test('preview: a fake generation shows the final prompt, the pictures and warnings, calls no image engine, admin only', async () => {
  const { backend, admin, api, put, preview } = await setup();
  try {
    assert.equal((await call(backend, '/api/admin/prompt-rules')).status, 401);
    assert.equal((await call(backend, '/api/admin/prompt-rules/preview', { method: 'POST', body: { toolId: 'tool_interior' } })).status, 401);
    const info = await call(backend, '/api/admin/prompt-rules', { headers: admin });
    assert.equal(info.status, 200);
    assert.equal(info.body.rules.v, 1); assert(info.body.catalog.blocks.structure.default); assert(info.body.catalog.placeholders.includes('room'));
    assert(info.body.catalog.vocab.styles.st_moroccan.includes('zellige') && info.body.catalog.vocab.rooms.rt_living === 'living room');
    const plain = await preview({ toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', colors: ['#112233'], prompt: 'warm light' });
    assert.equal(plain.status, 200, JSON.stringify(plain.body));
    assert.match(plain.body.prompt, /Moroccan/); assert.match(plain.body.prompt, /#112233/); assert.match(plain.body.prompt, /warm light/);
    assert.equal(plain.body.model.model, 'black-forest-labs/flux.2-klein-4b'); assert.equal(plain.body.source, 'photo');
    assert(plain.body.blocks.length >= 5 && plain.body.blocks.every(b => b.id && b.text));
    assert.equal(plain.body.prompt, plain.body.blocks.map(b => b.text).join('\n\n'));
    assert.equal(api.calls.length, 0, 'a preview never calls the image engine');
    assert.equal((await preview({ toolId: 'nope' })).status, 404);
    // unsaved edits are previewed without being saved
    const edited = await preview({ toolId: 'tool_interior', styleId: 'st_modern', rules: { global: { rules: { text: 'Keep the sofa' }, images: { style: 'image' } } } });
    assert.match(edited.body.prompt, /Keep the sofa/);
    assert.equal(edited.body.images.find(i => i.role === 'style').sent, true);
    assert.equal((await call(backend, '/api/admin/prompt-rules', { headers: admin })).body.rules.global.rules.text, '');
    // Explore: the inspiration brings room + style, the exploreText joins the rules, and a model that takes one picture reports it
    await put({ appliesTo: 'all', global: { rules: { text: 'Always keep windows', exploreText: 'Copy the mood of the explore picture' }, images: { inspiration: 'image' } } });
    const explore = await preview({ toolId: 'tool_interior', inspirationId: 'ins_cat_living_1' });
    assert.equal(explore.body.explore, true); assert.equal(explore.body.draft.styleId, 'st_cozy'); assert.equal(explore.body.draft.roomTypeId, 'rt_living');
    assert.match(explore.body.prompt, /Copy the mood of the explore picture/); assert.match(explore.body.prompt, /STYLE REFERENCE ONLY/);
    const notExplore = await preview({ toolId: 'tool_interior', styleId: 'st_cozy' });
    assert.doesNotMatch(notExplore.body.prompt, /Copy the mood/); assert.match(notExplore.body.prompt, /Always keep windows/);
    // single-picture model: the extra pictures are reported as not sent and the prompt does not mention them
    await call(backend, '/api/admin/content/models/mdl_one', { method: 'PUT', headers: admin, body: { name: 'Kontext', provider: 'Pollinations', engine: 'pollinations', modelName: 'black-forest-labs/flux.1-kontext-pro', apiKey: '', enabled: true, isDefault: true, order: 0, visible: true } });
    const one = await preview({ toolId: 'tool_interior', inspirationId: 'ins_cat_living_1', modelId: 'mdl_one' });
    assert.equal(one.body.images.find(i => i.role === 'inspiration').sent, false); assert.equal(one.body.images.find(i => i.role === 'inspiration').why, 'model');
    assert.doesNotMatch(one.body.prompt, /STYLE REFERENCE ONLY/);
    assert(one.body.warnings.some(w => w.code === 'modelImages'));
    // text only
    const text = await preview({ toolId: 'tool_interior', source: 'text', styleId: 'st_modern', prompt: 'a calm room', rules: { global: { images: { style: 'image' } } } });
    assert.equal(text.status, 200, JSON.stringify(text.body)); assert.equal(text.body.source, 'text'); assert.equal(text.body.images.find(i => i.role === 'style').why, 'textOnly'); assert.match(text.body.prompt, /STYLE: modern/);
    const bad = await preview({ toolId: 'tool_interior', rules: { global: { blocks: { items: { task: { texts: { photo: 'Make {rooom} nice' } } } } } } });
    assert(bad.body.warnings.some(w => w.code === 'unknownPlaceholder' && w.items.includes('rooom')));
    // no engine key: the preview still works and says so
    const bare = await setup({}, fakeApi());
    try { const p = await bare.preview({ toolId: 'tool_interior', styleId: 'st_modern' }); assert.equal(p.status, 200); assert.equal(p.body.model.live, false); } finally { bare.backend.server.emit('close'); }
  } finally { backend.server.emit('close'); }
});

test('render: saved rules reach the image model (global, per-tool, explore-only), style picture is sent, aiRun records it', async () => {
  const api = fakeApi();
  const { backend, admin, auth, put } = await setup({ POLLINATIONS_API_KEY: 'sk_test_key_123456' }, api);
  const create = async (id, d, extra = {}) => { const c = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id, photoUri, draft: d, ...extra } }); assert.equal(c.status, 201, JSON.stringify(c.body)); const o = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id } }); assert.equal(o.status, 200, JSON.stringify(o.body)); return api.calls[api.calls.length - 1].body; };
  try {
    assert.equal((await put({ global: { rules: { text: 'Keep the TV wall' }, images: { style: 'image', room: 'text' } }, tools: { tool_paint: { blocks: { items: { quality: { on: false } } } } } })).status, 200);
    const a = await create('rule-claim-00001', draft());
    assert.match(a.prompt, /Keep the TV wall/); assert.match(a.prompt, /second image shows the STYLE/); assert.equal(a.image.length, 2, 'photo + the style picture');
    assert.doesNotMatch(a.prompt, /STYLE: Moroccan/);
    const paint = await create('rule-claim-00002', draft({ toolId: 'tool_paint', colors: ['#2E7D32'] }));
    assert.match(paint.prompt, /Keep the TV wall/, 'rules are global'); assert.doesNotMatch(paint.prompt, /QUALITY:/, 'the tool switched its quality block off'); assert.match(a.prompt, /QUALITY:/); assert.equal(paint.image.length, 2, 'pictures are global');
    const withIns = await create('rule-claim-00003', draft({ inspirationId: 'ins_cat_living_1' }));
    assert.equal(withIns.image.length, 3, 'photo + inspiration + style'); assert.match(withIns.prompt, /second image is a STYLE REFERENCE ONLY/); assert.match(withIns.prompt, /third image shows the STYLE/);
    const listed = await call(backend, '/api/requests', { headers: admin });
    const row = listed.body.find(r => r.draft.inspirationId === 'ins_cat_living_1');
    assert.deepEqual(row.aiRun.images.map(i => [i.role, i.sent]), [['inspiration', true], ['style', true]]);
    assert.equal(row.aiRun.rules.explore, true); assert.equal(row.aiRun.rules.applied, true); assert.equal(row.aiRun.used.imagesSent, 2);
    // a stored legacy appliesTo:'explore' is ignored: the rules always apply, the Explore text only needs an Explore picture
    await put({ appliesTo: 'explore', global: { rules: { text: 'Always rule', exploreText: 'Explore only text' }, images: { style: 'image' } } });
    const normal = await create('rule-claim-00004', draft());
    assert.match(normal.prompt, /Always rule/); assert.doesNotMatch(normal.prompt, /Explore only text/); assert.equal(normal.image.length, 2);
    const viaExplore = await create('rule-claim-00005', draft({ inspirationId: 'ins_cat_living_1' }));
    assert.match(viaExplore.prompt, /Always rule/); assert.match(viaExplore.prompt, /Explore only text/);
    // a model that fails over to a single-picture model gets a prompt without pictures it cannot see
    const fail = fakeApi({ 'black-forest-labs/flux.2-klein-4b': 429 });
    const b = await setup({ POLLINATIONS_API_KEY: 'sk_test_key_123456' }, fail);
    try {
      await b.put({ global: { images: { style: 'image' } } });
      const c = await call(b.backend, '/api/requests', { method: 'POST', headers: b.auth, body: { id: 'rule-claim-00006', photoUri, draft: draft({ inspirationId: 'ins_cat_living_1' }) } });
      assert.equal(c.status, 201);
      const o = await call(b.backend, '/api/ai/render', { method: 'POST', headers: b.auth, body: { id: 'rule-claim-00006' } });
      assert.equal(o.status, 200); assert.equal(o.body.model, 'black-forest-labs/flux.1-kontext-pro');
      const [first, second] = fail.calls;
      assert.equal(first.body.image.length, 3); assert.equal(second.body.image.length, 1);
      assert.doesNotMatch(second.body.prompt, /image shows|STYLE REFERENCE/); assert.match(second.body.prompt, /STYLE: Moroccan/);
    } finally { b.backend.server.emit('close'); }
  } finally { backend.server.emit('close'); }
});

test('settings.modeChoice off: every generation is a Relooking, in the preview and in the real render', async () => {
  const api = fakeApi();
  const { backend, admin, auth, preview } = await setup({ POLLINATIONS_API_KEY: 'sk_test_key_123456' }, api);
  try {
    const reno = { toolId: 'tool_interior', roomTypeId: 'rt_living', styleId: 'st_moroccan', mode: 'renovation' };
    assert.match((await preview(reno)).body.prompt, /MODE renovation/, 'choice on (default): the client\'s mode is used');
    assert.equal((await call(backend, '/api/admin/doc/settings', { method: 'PATCH', headers: admin, body: { modeChoice: false } })).status, 200);
    const off = await preview(reno);
    assert.match(off.body.prompt, /MODE restyle/); assert.doesNotMatch(off.body.prompt, /MODE renovation/);
    const c = await call(backend, '/api/requests', { method: 'POST', headers: auth, body: { id: 'mode-claim-00001', photoUri, draft: draft({ mode: 'renovation' }) } });
    assert.equal(c.status, 201);
    const o = await call(backend, '/api/ai/render', { method: 'POST', headers: auth, body: { id: 'mode-claim-00001' } });
    assert.equal(o.status, 200); assert.match(api.calls[0].body.prompt, /MODE restyle/); assert.doesNotMatch(api.calls[0].body.prompt, /MODE renovation/);
  } finally { backend.server.emit('close'); }
});

test.after(closeShared);
