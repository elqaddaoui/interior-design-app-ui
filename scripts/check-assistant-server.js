const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const A = require('../server/assistant/automations');
const knowledge = require('../server/assistant/knowledge');
const { freshDb, closeShared } = require('./test-db');

test.after(closeShared);

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'test-client' } });
    const output = { headers: {} };
    const res = { headersSent: false, setHeader(k, v) { output.headers[k.toLowerCase()] = v; }, writeHead(status) { output.status = status; this.headersSent = true; }, end(value) { output.body = value ? JSON.parse(value) : undefined; resolve(output); } };
    backend.handle(req, res);
  });
}
const native = { 'x-dwira-native': '1' };
const ok = text => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });
const status = code => ({ ok: false, status: code, json: async () => ({}) });

async function setup({ env = {}, routes = {} } = {}) {
  const calls = [];
  const chatFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, auth: options.headers.Authorization, model: body.model, messages: body.messages });
    const host = Object.keys(routes).find(h => url.includes(h));
    if (!host) throw new Error('network down');
    return routes[host](url, body, options);
  };
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', CHAT_RATE_LIMIT: '2000', ...env }, db: await freshDb(), chatFetch });
  const login = await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' }, headers: native });
  const admin = { authorization: `Bearer ${login.body.token}` };
  const u = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Amine Alaoui', phone: '0611111111' }, headers: native });
  const client = { 'x-user-token': u.body.token };
  const say = (text, extra = {}) => call(backend, '/api/chat/reply', { method: 'POST', headers: client, body: { messages: [{ role: 'user', text }], ...extra } });
  const save = items => call(backend, '/api/admin/assistant/automations', { method: 'PUT', headers: admin, body: { items } });
  return { backend, calls, admin, client, say, save };
}
const kw = (name, keywords, text, extra = {}) => ({ name, trigger: { type: 'keyword', keywords }, reply: { type: 'fixed', text }, ...extra });

/* ---------------------------------------------------------------- pure engine */
test('matching: whole words for Latin, substrings for Arabic, accents and letter variants ignored', () => {
  assert.equal(A.hasTerm(A.normalize('Je voudrais un achat'), 'ach'), false, '"ach" must not fire inside "achat"');
  assert.equal(A.hasTerm(A.normalize('ach kayn?'), 'ach'), true);
  assert.equal(A.hasTerm(A.normalize('وشحال الثمن'), A.normalize('شحال')), true, 'glued Arabic prefix');
  assert.equal(A.normalize('Créâtion  ÉTÉ !'), 'creation ete');
  assert.equal(A.normalize('أهلاً بإبراهيم'), 'اهلا بابراهيم');
  assert.equal(A.intentMatch('greeting', A.normalize('Salam')), true);
  assert.equal(A.intentMatch('greeting', A.normalize('salam, j ai un probleme avec ma photo qui ne charge pas')), false, 'a greeting is short');
  assert.equal(A.intentMatch('pricing', A.normalize('chhal taman dyal pro?')), true);
});

test('schedule windows: overnight, days, time zone', () => {
  const at = (iso) => Date.parse(iso);
  const night = { from: '18:00', to: '09:00', days: [], tz: 'Africa/Casablanca' };
  assert.equal(A.inWindow(night, at('2026-11-06T20:00:00+01:00')), true);
  assert.equal(A.inWindow(night, at('2026-11-06T03:00:00+01:00')), true);
  assert.equal(A.inWindow(night, at('2026-11-06T12:00:00+01:00')), false);
  const weekend = { from: '00:00', to: '00:00', days: [0, 6], tz: 'UTC' };
  assert.equal(A.inWindow(weekend, at('2026-11-07T10:00:00Z')), true, 'Saturday');
  assert.equal(A.inWindow(weekend, at('2026-11-09T10:00:00Z')), false, 'Monday');
});

test('templates: variables, fallbacks, unknown names untouched', () => {
  const vars = A.variables({ client: { name: 'Amine Alaoui', credits: 3 }, appName: 'Dwira', language: 'french', now: Date.parse('2026-11-06T09:00:00Z'), tz: 'UTC' });
  assert.equal(A.render('{greeting} {name}, {credits} crédits sur {app}', vars), 'Bonjour Amine, 3 crédits sur Dwira');
  const visitor = A.variables({ client: null, appName: 'Dwira', language: 'french', now: Date.now() });
  assert.equal(A.render('Salut {name|ami} !', visitor), 'Salut ami !');
  assert.equal(A.render('Salut {name} !', visitor), 'Salut !');
  assert.equal(A.render('Hello {name}, ok', visitor), 'Hello, ok');
  assert.equal(A.render('Hello {nope}', vars), 'Hello {nope}');
  assert.deepEqual(A.unknownVars('{name} {nope|x} {Other}'), ['nope', 'other']);
});

test('validation rejects incomplete automations and keeps ids unique', () => {
  const bad = [{}, { name: 'x' }, kw('a', [], 'hi'), kw('', ['a'], 'hi'), kw('a', ['a'], ''), { name: 'b', trigger: { type: 'button' }, reply: { type: 'fixed', text: 'x' } }, { name: 'c', trigger: { type: 'intent', intents: ['nope'] }, reply: { type: 'fixed', text: 'x' } }, { name: 'd', trigger: { type: 'first_visit' }, reply: { type: 'ai' } }];
  for (const item of bad) assert.throws(() => A.cleanAutomation(item), /INVALID_AUTOMATION/);
  const one = A.cleanAutomation(kw('Hi', ['salam'], 'hello'));
  assert.match(one.id, /^auto_[a-f0-9]{12}$/);
  assert.throws(() => A.cleanList([one, one]), /INVALID_AUTOMATIONS/);
});

/* ---------------------------------------------------------------- knowledge */
test('knowledge: multilingual retrieval, grounded prompt, "do not guess" rule', () => {
  const top = text => knowledge.search(text)[0]?.id;
  assert.equal(top('كيفاش نصاوب تصميم؟'), 'start');
  assert.deepEqual(knowledge.search('how many credits do I get for free').slice(0, 2).map(h => h.id).sort(), ['credits', 'firstfree']);
  assert.equal(top('chhal kayb9a lia mn credits'), 'credits');
  assert.equal(top('la photo ne se charge pas'), 'photo');
  assert.equal(top('xyzzy plugh'), undefined);
  const { prompt, ids } = knowledge.facts(['wach kayn garden?']);
  assert.ok(ids.includes('about'));
  assert.match(prompt, /APP FACTS/);
  assert.match(prompt, /do not know that one/);
  assert.ok(prompt.length < 6000, 'the facts block stays small');
  assert.equal(JSON.stringify(knowledge.overview()).includes('GEMINI_API_KEY'), false, 'no server internals in the knowledge');
});

/* ---------------------------------------------------------------- pipeline */
test('automations answer BEFORE the AI, in list order, with variables, and are counted; no match falls through to the AI', async () => {
  const { backend, calls, say, save, admin } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => ok('AI answer') } });
  try {
    const saved = await save([
      kw('Prices', ['prix', 'chhal'], 'Les prix: voir Pro.', { language: 'french' }),
      { name: 'Hello', trigger: { type: 'intent', intents: ['greeting'] }, reply: { type: 'template', text: '{greeting} {name}! Bienvenue sur {app}.' }, language: 'auto' },
    ]);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.items.length, 2);
    const hello = await say('salam');
    assert.equal(hello.body.provider, 'automation');
    assert.equal(hello.body.status, 'automation');
    assert.match(hello.body.text, /Amine! Bienvenue sur Dwira\./);
    assert.equal(calls.length, 0, 'no AI call when an automation answers');
    assert.equal((await say('Quel est le prix ?')).body.text, 'Les prix: voir Pro.');
    assert.equal((await say('شحال الثمن')).body.provider, 'groq', 'French-only automation does not answer in Arabic: the AI does');
    const ai = await say('bghit nbdel salon dyali');
    assert.equal(ai.body.provider, 'groq');
    assert.equal(ai.body.status, 'active');
    assert.match(calls[calls.length - 1].messages[0].content, /APP FACTS/, 'the AI is grounded on the knowledge base');
    const list = await call(backend, '/api/admin/assistant/automations', { headers: admin });
    const used = Object.fromEntries(list.body.items.map(i => [i.name, i.used]));
    assert.deepEqual(used, { Prices: 1, Hello: 1 });
    assert.equal(list.body.totals.ai, 2);
    assert.equal(list.body.totals.providers.groq, 2);
    // order = priority: both would match "salam prix", the first one in the list answers
    assert.equal((await say('salam prix')).body.automationName, 'Prices');
  } finally { backend.server.emit('close'); }
});

test('first visit, once per chat, button and AI-written automations', async () => {
  const { backend, calls, say, save } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => ok('Voici nos conseils') } });
  try {
    const out = await save([
      { name: 'Welcome', trigger: { type: 'first_visit' }, reply: { type: 'fixed', text: 'Bienvenue !' } },
      { name: 'Tips', trigger: { type: 'button', buttonLabel: 'Conseils déco' }, reply: { type: 'ai', instructions: 'Give 3 quick decor tips for small flats.' }, language: 'french' },
    ]);
    const tips = out.body.items.find(i => i.name === 'Tips');
    assert.equal((await say('hello')).body.text, 'Bienvenue !');
    const second = await call(backend, '/api/chat/reply', { method: 'POST', headers: { 'x-user-token': (await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Amine', phone: '0611111111' }, headers: native })).body.token }, body: { messages: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'hello' }] } });
    assert.notEqual(second.body.automationName, 'Welcome', 'only the first message of a chat');
    assert.equal((await say('hi', { used: [out.body.items[0].id] })).body.provider === 'automation', false, 'once per chat');
    const buttons = await call(backend, '/api/chat/buttons', { headers: { 'x-user-token': (await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Amine', phone: '0611111111' }, headers: native })).body.token } });
    assert.deepEqual(buttons.body.buttons.map(b => b.label), ['Conseils déco']);
    assert.equal(JSON.stringify(buttons.body).includes('quick decor tips'), false, 'instructions never reach visitors');
    const pressed = await say('Conseils déco', { buttonId: tips.id });
    assert.equal(pressed.body.automationId, tips.id);
    assert.equal(pressed.body.provider, 'groq');
    const system = calls[calls.length - 1].messages[0].content;
    assert.match(system, /OWNER INSTRUCTIONS/);
    assert.match(system, /Give 3 quick decor tips/);
    assert.match(system, /natural, friendly French/, 'the automation language is the reply language');
    assert.equal((await say('x', { buttonId: 'auto_unknown00000' })).status, 404);
  } finally { backend.server.emit('close'); }
});

test('admin test box previews without counting; drafts report why they would not trigger; admin only', async () => {
  const { backend, admin, client, save } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => ok('AI preview') } });
  try {
    assert.equal((await call(backend, '/api/admin/assistant/test', { method: 'POST', headers: client, body: { text: 'salam' } })).status, 401);
    assert.equal((await call(backend, '/api/admin/assistant/automations')).status, 401);
    assert.equal((await call(backend, '/api/admin/assistant/automations', { method: 'PUT', headers: client, body: { items: [] } })).status, 401);
    const draft = kw('Draft', ['livraison'], 'Bonjour {name|ami}, {unknown} {credits}', { language: 'french' });
    const hit = await call(backend, '/api/admin/assistant/test', { method: 'POST', headers: admin, body: { text: 'livraison ?', automation: draft } });
    assert.equal(hit.body.matches, true);
    assert.equal(hit.body.result.text, 'Bonjour Amine, {unknown} 3');
    assert.deepEqual(hit.body.unknownVars, ['unknown']);
    const miss = await call(backend, '/api/admin/assistant/test', { method: 'POST', headers: admin, body: { text: 'bonjour', automation: draft } });
    assert.equal(miss.body.matches, false);
    assert.equal(miss.body.why, 'no_match');
    const arabic = await call(backend, '/api/admin/assistant/test', { method: 'POST', headers: admin, body: { text: 'بغيت نعرف livraison', automation: draft } });
    assert.equal(arabic.body.why === 'language' || arabic.body.matches === true, true);
    const real = await call(backend, '/api/admin/assistant/test', { method: 'POST', headers: admin, body: { text: 'bghit nbdel salon dyali' } });
    assert.equal(real.body.result.provider, 'groq');
    assert.equal((await call(backend, '/api/admin/assistant/test', { method: 'POST', headers: admin, body: { text: '' } })).status, 400);
    await save([kw('Real', ['livraison'], 'x')]);
    const list = await call(backend, '/api/admin/assistant/automations', { headers: admin });
    assert.equal(list.body.items[0].used, 0, 'previews are never counted');
    assert.equal(list.body.totals.ai, 0);
  } finally { backend.server.emit('close'); }
});

test('list editing: duplicates and reordering through PUT keep counters of survivors, drop those of deleted ones', async () => {
  const { backend, admin, say, save } = await setup({ routes: {} });
  try {
    const first = await save([kw('A', ['aaa'], 'a'), kw('B', ['bbb'], 'b')]);
    const [a, b] = first.body.items;
    await say('aaa'); await say('aaa'); await say('bbb');
    const copy = { ...a, id: undefined, name: 'A (copy)' };
    const next = await save([b, copy, a]);
    assert.deepEqual(next.body.items.map(i => i.name), ['B', 'A (copy)', 'A']);
    assert.deepEqual(next.body.items.map(i => i.used), [1, 0, 2]);
    assert.notEqual(next.body.items[1].id, a.id);
    const removed = await save([next.body.items[1]]);
    assert.equal(removed.body.items.length, 1);
    const rows = await backend.db.query("SELECT key FROM settings WHERE key LIKE 'asst_n:auto:%'");
    assert.equal(rows.length, 0, 'counters of deleted automations are cleaned');
    assert.equal((await save([{ name: 'bad' }])).status, 400);
    assert.equal((await save('nope')).status, 400);
    assert.equal((await call(backend, '/api/admin/assistant/automations', { headers: admin })).body.items.length, 1, 'a rejected save changes nothing');
  } finally { backend.server.emit('close'); }
});

/* ---------------------------------------------------------------- providers */
test('free chain is ranked (Gemini, Mistral, Groq, OpenRouter, Pollinations); every failure is traced and the answer says who answered', async () => {
  const { backend, say } = await setup({
    env: { GEMINI_API_KEY: 'gem_test_key_1234567890', MISTRAL_API_KEY: 'mis_test_key_1234567890', GROQ_API_KEY: 'gsk_test_key_1234567890' },
    routes: { 'generativelanguage.googleapis.com': () => status(429), 'api.mistral.ai': () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }, 'api.groq.com': () => ok('Salam') },
  });
  try {
    const r = await say('bonjour');
    assert.equal(r.body.provider, 'groq');
    assert.equal(r.body.status, 'fallback');
    assert.equal(r.body.paid, false);
    assert.deepEqual(r.body.tried.map(t => [t.provider, t.status, t.reason]), [['gemini', 'failed', 'rate_limit'], ['mistral', 'failed', 'timeout']]);
    const first = await setup({ env: { GEMINI_API_KEY: 'gem_test_key_1234567890' }, routes: { 'generativelanguage.googleapis.com': () => ok('Hi') } });
    try {
      const direct = await first.say('bonjour');
      assert.equal(direct.body.status, 'active');
      assert.deepEqual(direct.body.tried, []);
    } finally { first.backend.server.emit('close'); }
  } finally { backend.server.emit('close'); }
});

test('paid zone: off until a key is added AND switched on, write-only keys, before/after the free chain, fallback into it, never reaches visitors', async () => {
  const { backend, calls, admin, say } = await setup({
    env: { GROQ_API_KEY: 'gsk_test_key_1234567890' },
    routes: { 'api.groq.com': () => ok('free answer'), 'api.openai.com': () => ok('paid answer') },
  });
  const put = body => call(backend, '/api/admin/chat/config', { method: 'PUT', headers: admin, body });
  try {
    let r = await put({ position: 'after', paid: [{ preset: 'openai', model: 'gpt-4o-mini', enabled: true }] });
    assert.equal(r.status, 200);
    const id = r.body.paid.providers[0].id;
    assert.equal(r.body.paid.providers[0].hasKey, false);
    assert.equal(r.body.paid.providers[0].state, 'off', 'enabled but without a key stays off');
    assert.equal((await say('salam')).body.provider, 'groq');
    r = await put({ paid: [{ id, preset: 'openai', model: 'gpt-4o-mini', enabled: true, key: 'sk-paid-secret-key-1234567890' }] });
    assert.equal(r.body.paid.providers[0].hasKey, true);
    assert.equal(JSON.stringify(r.body).includes('sk-paid-secret'), false, 'key never echoed');
    assert.equal(JSON.stringify((await call(backend, '/api/admin/chat/status', { headers: admin })).body).includes('sk-paid-secret'), false);
    assert.equal((await say('salam')).body.provider, 'groq', 'after: free first');
    r = await put({ position: 'before', paid: [{ id, preset: 'openai', model: 'gpt-4o-mini', enabled: true }] });
    assert.equal(r.body.paid.providers[0].hasKey, true, 'omitting the key keeps it');
    const paid = await say('salam');
    assert.equal(paid.body.provider, id);
    assert.equal(paid.body.status, 'paid');
    assert.equal(paid.body.paid, true);
    assert.equal(paid.body.model, 'gpt-4o-mini');
    assert.equal(calls[calls.length - 1].auth, 'Bearer sk-paid-secret-key-1234567890');
    // switching off / removing the key / deleting the provider
    r = await put({ paid: [{ id, preset: 'openai', model: 'gpt-4o-mini', enabled: false }] });
    assert.equal(r.body.paid.providers[0].state, 'off');
    assert.equal((await say('salam')).body.provider, 'groq');
    r = await put({ paid: [] });
    assert.equal(r.body.paid.providers.length, 0);
    assert.equal((await backend.db.query("SELECT value FROM settings WHERE key='chat_paid_keys'"))[0].value, '{}', 'keys of deleted providers are erased');
  } finally { backend.server.emit('close'); }
});

test('paid provider first but failing (bad key): the answer falls back to the free chain and the trace says why', async () => {
  const { backend, admin, say } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => ok('free answer'), 'api.openai.com': () => status(401) } });
  try {
    const cfg = await call(backend, '/api/admin/chat/config', { method: 'PUT', headers: admin, body: { position: 'before', paid: [{ preset: 'openai', enabled: true, key: 'sk-paid-secret-key-1234567890' }] } });
    assert.equal(cfg.status, 200);
    const fb = await say('salam');
    assert.equal(fb.body.provider, 'groq');
    assert.equal(fb.body.status, 'fallback');
    assert.equal(fb.body.tried[0].paid, true);
    assert.equal(fb.body.tried[0].reason, 'auth');
    const st = await call(backend, '/api/admin/chat/status', { headers: admin });
    assert.equal(st.body.paid.providers[0].state, 'cooling');
    assert.equal(st.body.paid.providers[0].resting, 'auth');
  } finally { backend.server.emit('close'); }
});

test('paid config validation: https custom URL only, no private hosts, bad keys, admin only, free switches skip a provider', async () => {
  const { backend, admin, client, say } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => ok('x'), 'text.pollinations.ai': () => ok('poll') } });
  const put = (body, headers = admin) => call(backend, '/api/admin/chat/config', { method: 'PUT', headers, body });
  try {
    assert.equal((await put({ position: 'after' }, client)).status, 401);
    assert.equal((await put({ position: 'sideways' })).status, 400);
    for (const baseUrl of ['http://api.example.com/v1/chat/completions', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://user:pw@api.example.com/x', 'not a url', '']) {
      assert.equal((await put({ paid: [{ preset: 'custom', baseUrl, model: 'm', enabled: false }] })).status, 400, baseUrl);
    }
    assert.equal((await put({ paid: [{ preset: 'custom', baseUrl: 'https://api.example.com/v1/chat/completions', model: 'm', key: 'bad key', enabled: false }] })).status, 400);
    assert.equal((await put({ paid: Array.from({ length: 7 }, () => ({ preset: 'openai' })) })).status, 400);
    const good = await put({ paid: [{ preset: 'custom', baseUrl: 'https://api.example.com/v1/chat/completions', model: 'my-model', label: 'Mine', enabled: false }] });
    assert.equal(good.status, 200);
    assert.equal(good.body.paid.providers[0].label, 'Mine');
    // a free provider switched off is skipped, the keyless Pollinations answers
    const off = await put({ freeOff: ['groq'] });
    assert.equal(off.body.free.find(p => p.id === 'groq').state, 'off');
    assert.equal((await say('salam')).body.provider, 'pollinations');
    const ranks = off.body.free.map(p => p.id);
    assert.deepEqual(ranks, ['gemini', 'mistral', 'groq', 'openrouter', 'pollinations']);
  } finally { backend.server.emit('close'); }
});

test('NO_PROVIDER returns the trace so the admin can see why nothing answered; failures are counted', async () => {
  const { backend, admin, say } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => status(500), 'text.pollinations.ai': () => status(502) } });
  try {
    const r = await say('salam');
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'NO_PROVIDER');
    assert.deepEqual(r.body.tried.map(t => [t.provider, t.reason]), [['groq', 'server'], ['pollinations', 'server']]);
    const list = await call(backend, '/api/admin/assistant/automations', { headers: admin });
    assert.equal(list.body.totals.failed, 1);
    const st = await call(backend, '/api/admin/chat/status', { headers: admin });
    assert.equal(st.body.free.find(p => p.id === 'groq').state, 'cooling');
    assert.equal(st.body.free.find(p => p.id === 'groq').resting, 'server');
  } finally { backend.server.emit('close'); }
});
