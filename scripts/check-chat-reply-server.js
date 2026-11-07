const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createBackend } = require('../server');
const { detectLanguage, clean } = require('../server/chat');
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

/** `routes`: provider host -> handler(url, options) returning a fake response. Every request is recorded in `calls`. */
async function setup({ env = {}, routes = {} } = {}) {
  const calls = [];
  const chatFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, auth: options.headers.Authorization, model: body.model, messages: body.messages });
    const host = Object.keys(routes).find(h => url.includes(h));
    if (!host) throw new Error('network down');
    return routes[host](url, body, options);
  };
  const backend = createBackend({ env: { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', CHAT_RATE_LIMIT: '4', ...env }, db: await freshDb(), chatFetch });
  const login = await call(backend, '/api/admin/login', { method: 'POST', body: { email: 'admin', password: 'admin' }, headers: native });
  const admin = { authorization: `Bearer ${login.body.token}` };
  const u = await call(backend, '/api/user/login', { method: 'POST', body: { name: 'Amine', phone: '0611111111' }, headers: native });
  const client = { 'x-user-token': u.body.token };
  return { backend, calls, admin, client };
}
const freeOf = (body, id) => body.free.find(p => p.id === id);
const ask = (backend, headers, text = 'bghit nbdel salon dyali') => call(backend, '/api/chat/reply', { method: 'POST', headers, body: { messages: [{ role: 'user', text }] } });

test('language detection tells Darija (Arabic and Latin letters), Arabic and French apart', () => {
  assert.equal(detectLanguage('بغيت نبدل ديكور الصالون ديالي'), 'darija');
  assert.equal(detectLanguage('أريد تغيير ألوان غرفة المعيشة'), 'arabic');
  assert.equal(detectLanguage('bghit nbdel salon dyali, chno nssa7ni'), 'darija_latin');
  assert.equal(detectLanguage('Bonjour, je voudrais repeindre ma chambre'), 'french');
  assert.equal(detectLanguage('?'), 'unknown');
  assert.equal(clean('<think>hmm</think>**Salut** !\n\n\n\n## Titre\n- un'), 'Salut !\n\nTitre\n• un');
});

test('chat needs a client or visitor token, is blocked for WhatsApp mode and rate limited', async () => {
  const { backend, admin, client } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': () => ok('Salam!') } });
  try {
    assert.equal((await call(backend, '/api/chat/reply', { method: 'POST', body: { messages: [{ role: 'user', text: 'salut' }] } })).status, 400, 'anonymous without a device token');
    assert.equal((await call(backend, '/api/chat/reply', { method: 'POST', headers: { 'x-demand-token': 'a'.repeat(64) }, body: { messages: [{ role: 'user', text: 'salut' }] } })).status, 200, 'a visitor with a device token can chat');
    assert.equal((await call(backend, '/api/chat/reply', { method: 'POST', headers: client, body: { messages: [{ role: 'assistant', text: 'hi' }] } })).status, 400, 'the last turn must come from the user');
    await call(backend, '/api/admin/content/doc/assistant', { method: 'PATCH', headers: admin, body: { type: 'whatsapp' } });
    const wa = await ask(backend, client);
    if (wa.status === 409) assert.equal(wa.body.error ?? wa.body.code ?? wa.body.message, 'ASSISTANT_DISABLED');
    let limited = 0;
    for (let i = 0; i < 8; i++) if ((await ask(backend, client)).status === 429) limited++;
    assert.ok(limited > 0, 'a burst of messages is rate limited');
  } finally { backend.server.emit('close'); }
});

test('providers are tried in order: a quota error or an outage moves to the next one, the answer is cleaned and the prompt follows the user language', async () => {
  const { backend, calls, client } = await setup({
    env: { GEMINI_API_KEY: 'gem_test_key_1234567890', GROQ_API_KEY: 'gsk_test_key_1234567890', OPENROUTER_API_KEY: 'or_test_key_1234567890' },
    routes: {
      'generativelanguage.googleapis.com': () => status(429),
      'api.groq.com': () => status(503),
      'openrouter.ai': () => ok('<think>x</think>**Wakha**, kayn bzaf d l-afkar'),
    },
  });
  try {
    const r = await ask(backend, client);
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, 'openrouter');
    assert.equal(r.body.language, 'darija_latin');
    assert.equal(r.body.text, 'Wakha, kayn bzaf d l-afkar');
    const hosts = calls.map(c => new URL(c.url).host);
    assert.equal(hosts[0], 'generativelanguage.googleapis.com');
    assert.ok(hosts.includes('api.groq.com') && hosts.includes('openrouter.ai'));
    assert.match(calls[0].messages[0].content, /Latin letters/);
    assert.equal(calls[0].auth, 'Bearer gem_test_key_1234567890');
    // Gemini and Groq are now resting: the next message goes straight to OpenRouter.
    calls.length = 0;
    await ask(backend, client, 'merci beaucoup');
    assert.deepEqual([...new Set(calls.map(c => new URL(c.url).host))], ['openrouter.ai']);
  } finally { backend.server.emit('close'); }
});

test('a model the provider no longer serves is skipped for the next model; with no provider at all the answer is a clear 503', async () => {
  const seen = [];
  const { backend, client } = await setup({ env: { GROQ_API_KEY: 'gsk_test_key_1234567890' }, routes: { 'api.groq.com': (url, body) => { seen.push(body.model); return seen.length === 1 ? status(404) : ok('Salam'); } } });
  try {
    const r = await ask(backend, client);
    assert.equal(r.body.provider, 'groq');
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0], seen[1]);
  } finally { backend.server.emit('close'); }
  const none = await setup({ routes: {} });
  try {
    const r = await ask(none.backend, none.client);
    assert.equal(r.status, 503);
  } finally { none.backend.server.emit('close'); }
});

test('admin keys are write-only: stored, used, reported as configured but never returned; removable; admin only', async () => {
  const { backend, calls, admin, client } = await setup({ routes: { 'api.groq.com': () => ok('Salam') } });
  try {
    assert.equal((await call(backend, '/api/admin/chat/status')).status, 401);
    assert.equal((await call(backend, '/api/admin/chat/keys', { method: 'PATCH', headers: client, body: { groq: 'x'.repeat(30) } })).status, 401);
    assert.equal((await call(backend, '/api/admin/chat/keys', { method: 'PATCH', headers: admin, body: { groq: 'bad key!' } })).status, 400);
    const set = await call(backend, '/api/admin/chat/keys', { method: 'PATCH', headers: admin, body: { groq: 'gsk_admin_stored_key_123456' } });
    assert.equal(set.status, 200);
    assert.equal(freeOf(set.body, 'groq').configured, true);
    assert.equal(freeOf(set.body, 'groq').source, 'db');
    assert.equal(JSON.stringify(set.body).includes('gsk_admin_stored_key'), false, 'the key is never echoed');
    assert.equal(JSON.stringify((await call(backend, '/api/admin/chat/status', { headers: admin })).body).includes('gsk_admin_stored_key'), false);
    assert.equal((await ask(backend, client)).body.provider, 'groq');
    assert.equal(calls[calls.length - 1].auth, 'Bearer gsk_admin_stored_key_123456');
    const removed = await call(backend, '/api/admin/chat/keys', { method: 'PATCH', headers: admin, body: { groq: '' } });
    assert.equal(freeOf(removed.body, 'groq').configured, false);
  } finally { backend.server.emit('close'); }
});
