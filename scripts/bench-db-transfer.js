/**
 * Database transfer benchmark: how many bytes (and queries) the API pulls OUT of Postgres for a fixed, realistic scenario.
 * Neon bills "network transfer" for exactly this traffic, so it is the number to drive down.
 *
 *   node scripts/bench-db-transfer.js                         # this checkout
 *   node scripts/bench-db-transfer.js --root=.bench-base      # another checkout (e.g. a worktree of the old main)
 *   node scripts/bench-db-transfer.js --mode=base|opt         # how the app reacts to sync changes (see MODES)
 *   node scripts/bench-db-transfer.js --json                  # machine readable
 *
 * Uses in-process PGlite (no network, no credentials). Bytes are measured on the rows the driver returns, which is what
 * the pg wire protocol would carry (BYTEA counts as raw bytes).
 */
const path = require('node:path');
const { Readable } = require('node:stream');
const arg = (name, fallback) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1] ?? fallback;
const root = path.resolve(__dirname, '..', arg('root', '.'));
const mode = arg('mode', 'opt');
const asJson = process.argv.includes('--json');
const { createBackend } = require(path.join(root, 'server'));
const { createDb } = require(path.join(root, 'server', 'db'));

const sizeOf = value => {
  if (value == null) return 0;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value === 'boolean') return 1;
  if (Array.isArray(value)) return value.reduce((n, v) => n + sizeOf(v), 0);
  return Object.entries(value).reduce((n, [k, v]) => n + k.length + sizeOf(v), 0);
};
function metered(db) {
  const m = { tag: 'setup', groups: {}, on: false };
  const add = rows => {
    if (!m.on) return rows;
    const g = (m.groups[m.tag] ||= { queries: 0, bytes: 0 });
    g.queries++; g.bytes += sizeOf(rows);
    return rows;
  };
  return {
    meter: m,
    db: {
      ...db,
      query: async (sql, params) => add(await db.query(sql, params)),
      tx: work => db.tx(q => work(async (sql, params) => add(await q(sql, params)))),
    },
  };
}

function call(backend, url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise(resolve => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url, method, headers: { 'content-type': 'application/json', ...headers }, socket: { remoteAddress: 'bench' } });
    const out = { headers: {} };
    const res = {
      headersSent: false,
      setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
      writeHead(status, h) { out.status = status; Object.assign(out.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v]))); this.headersSent = true; },
      end(value) { try { out.body = value && String(out.headers['content-type'] || '').includes('json') ? JSON.parse(zlibSafe(value, out.headers)) : undefined; } catch { /* binary */ } resolve(out); },
    };
    backend.handle(req, res);
  });
}
const zlibSafe = (value, headers) => {
  if (!headers['content-encoding']) return value;
  const zlib = require('node:zlib');
  return (headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(value) : zlib.gunzipSync(value)).toString();
};
const native = { 'x-dwira-native': '1' };
const png = size => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, 7)]);
const fakeR2 = () => ({ kind: 'r2', publicUrl: key => `https://media.example.com/${key}`, put: async () => {}, head: async () => null, getRange: async () => Buffer.alloc(0), remove: async () => {}, presignPut: async () => '' });

(async () => {
  const base = createDb({ PGLITE_DIR: ':memory:' });
  await base.query('select 1');
  const { db, meter } = metered(base);
  const env = { PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', PUSH_WAIT_MS: '50' };
  const offline = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE', policy: false }); };
  const r2 = createBackend({ env, db, media: { storage: fakeR2(), download: offline } });
  const plain = createBackend({ env, db, media: { storage: null, download: offline } });

  const login = await call(r2, '/api/admin/login', { method: 'POST', headers: native, body: { email: 'admin', password: 'admin' } });
  const admin = { authorization: `Bearer ${login.body.token}` };
  const person = async (name, phone) => (await call(r2, '/api/user/login', { method: 'POST', headers: native, body: { name, phone } })).body;
  const a = await person('Active Client', '0661000001');
  const auth = { 'x-user-token': a.token, 'x-demand-token': 'a'.repeat(64) };
  for (let i = 0; i < 40; i++) await person(`Client ${i}`, `06610001${String(i).padStart(2, '0')}`);
  await r2.clients.grant(a.user.id, 50);

  // Active client's data: 12 conversations of 30 messages, 8 designs, 6 requests.
  const conversationIds = [];
  for (let c = 0; c < 12; c++) {
    const messages = Array.from({ length: 30 }, (_, i) => ({ id: `m${c}_${i}`, role: i % 2 ? 'assistant' : 'user', text: `Message ${i} of chat ${c} `.repeat(6), createdAt: 1000 + i }));
    const saved = await call(r2, '/api/user/conversations', { method: 'POST', headers: auth, body: { title: `Chat ${c}`, messages, updatedAt: 5000 + c } });
    conversationIds.push(saved.body.id);
  }
  const photo = 'data:image/png;base64,' + png(2000).toString('base64');
  for (let i = 0; i < 6; i++) await call(r2, '/api/requests', { method: 'POST', headers: auth, body: { id: `bench-request-${i}-xxxx`, photoUri: photo, draft: { toolId: 'tool_interior' } } });
  for (let i = 0; i < 8; i++) {
    await r2.clients.claim(a.user, `bench-claim-${i}-xxxxxx`).catch(() => {});
    await call(r2, '/api/user/history', { method: 'POST', headers: auth, body: { claimId: `bench-claim-${i}-xxxxxx`, before: photo, after: photo, status: 'done', draft: { toolId: 'tool_interior' }, createdAt: Date.now() } });
  }
  // Media: a file that lives in R2 but whose legacy copy stayed in the database (what the migration leaves behind), and a
  // file that only exists in the database (no-R2 fallback). 180 KB each.
  const legacy = png(180 * 1024);
  await db.query("INSERT INTO media(id,mime,data,body,size,storage,created_at) VALUES($1,'image/png',$2,NULL,$3,'r2',$4)", ['a'.repeat(32), legacy.toString('base64'), legacy.length, Date.now()]);
  await db.query("INSERT INTO media(id,mime,data,body,size,storage,created_at) VALUES($1,'image/png','',$2,$3,'db',$4)", ['b'.repeat(32), png(180 * 1024), 180 * 1024, Date.now()]);

  // ---------------------------------------------------------------- measured scenario
  meter.on = true;
  const group = async (tag, count, fn) => { meter.tag = tag; for (let i = 0; i < count; i++) await fn(i); };
  await group('media: 100 reads of an R2 file (legacy copy still in DB)', 100, () => call(r2, `/api/media/${'a'.repeat(32)}.png`));
  await group('media: 100 reads of a DB-stored file', 100, () => call(plain, `/api/media/${'b'.repeat(32)}.png`));
  await group('content: 20 public loads', 20, () => call(r2, '/api/content'));
  await group('polls: 100 client polls (4 s tick)', 100, () => call(r2, '/api/sync', { headers: auth }));
  await group('polls: 100 admin polls', 100, () => call(r2, '/api/sync', { headers: admin }));
  await group('polls: 100 visitor polls', 100, () => call(r2, '/api/sync', { headers: { 'x-demand-token': 'c'.repeat(64) } }));
  // 20 chat messages from the active client; after each, this device reacts to the version change and an admin device reloads chats.
  const write = async i => {
    const id = conversationIds[i % conversationIds.length];
    const current = (await call(r2, `/api/user/conversations/${id}`, { headers: auth })).body;
    const message = { id: `new_${i}`, role: 'user', text: 'a new message', createdAt: 9000 + i };
    await call(r2, `/api/user/conversations/${id}`, { method: 'PATCH', headers: auth, body: { title: current.title, messages: [...current.messages, message], updatedAt: 9000 + i } });
  };
  await group('chat: 20 messages written', 20, write);
  await group('chat: 20 reactions of the writing device', 20, async () => {
    await call(r2, '/api/user/session', { headers: auth });
    await call(r2, '/api/user/conversations', { headers: auth });
    if (mode === 'base') { await call(r2, '/api/user/history', { headers: auth }); await call(r2, '/api/user/requests', { headers: auth }); }
  });
  let since = 0;
  await group('chat: 20 admin reloads of the inbox', 20, async () => {
    const reply = await call(r2, mode === 'base' ? '/api/admin/conversations' : `/api/admin/conversations?since=${since}`, { headers: admin });
    const list = Array.isArray(reply.body) ? reply.body : reply.body.chats;
    since = Math.max(since, ...list.map(c => c.updatedAt || 0));
  });
  await group('admin: 10 requests list + 10 clients list loads', 10, async () => {
    await call(r2, '/api/requests', { headers: admin });
    await call(r2, '/api/admin/clients', { headers: admin });
  });
  meter.on = false;

  const rows = Object.entries(meter.groups).map(([name, g]) => ({ name, queries: g.queries, kb: Math.round(g.bytes / 102.4) / 10 }));
  const total = rows.reduce((t, r) => ({ queries: t.queries + r.queries, kb: Math.round((t.kb + r.kb) * 10) / 10 }), { queries: 0, kb: 0 });
  if (asJson) console.log(JSON.stringify({ root: path.basename(root), mode, rows, total }));
  else {
    console.log(`\nDatabase transfer benchmark | checkout: ${path.basename(root)} | client reaction model: ${mode}\n`);
    for (const r of rows) console.log(`${String(r.kb).padStart(10)} KB  ${String(r.queries).padStart(5)} queries  ${r.name}`);
    console.log(`${String(total.kb).padStart(10)} KB  ${String(total.queries).padStart(5)} queries  TOTAL\n`);
  }
  process.exit(0); // PGlite is in-memory: nothing to flush
})().catch(error => { console.error(error); process.exit(1); });
