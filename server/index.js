const http = require('node:http');
const path = require('node:path');
const { isIP } = require('node:net');
const crypto = require('node:crypto');
const { createDb } = require('./db');
const { sendBuffer } = require('./compress');
const { passwordMatches } = require('./admins');
const { createBundles } = require('./bundle');
const { createTenants } = require('./tenants');
const { createSuperAdmin } = require('./superadmin');
const { r2Status } = require('./media');
const { translate } = require('./translate');
const { validateSubscription, trim, phone } = require('./notifications');
const { cleanCampaign } = require('./campaigns');
const knowledge = require('./assistant/knowledge');
const { normalizeColors } = require('./imagegen/prompt');
const { createStatic } = require('./static');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const DEFAULT_RESOLVED = pathname => ({ tenant: { id: 'default', slug: 'default', name: 'Default', kind: 'default', status: 'active' }, via: 'default', base: '', pathname, platform: true });
/** The installable web app of a non-default tenant: its own name, and a scope / start_url under its prefix. */
const tenantManifest = resolved => ({
  name: resolved.tenant.name, short_name: String(resolved.tenant.name).slice(0, 12), description: resolved.tenant.name,
  start_url: `${resolved.base}/`, scope: `${resolved.base}/`, display: 'standalone', background_color: '#FFFFFF', theme_color: '#FFFFFF',
  icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
});
const MANIFEST_HEADERS = { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=300' };
const fail = (status, message) => Object.assign(new Error(message), { status });
async function readBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail(415, 'JSON required');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw fail(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw fail(400, 'Invalid JSON'); }
}
function validateDemand(value) {
  const name = trim(value?.name, 120), whatsapp = phone(value?.whatsapp);
  if (name.length < 2 || !/^\+?\d{6,20}$/.test(whatsapp)) throw fail(400, 'Name and phone required');
  const textOnly = value.draft?.source === 'text' && (value.photoUri === '' || value.photoUri == null);
  if (textOnly) value = { ...value, photoUri: '' };
  if (!textOnly && (typeof value.photoUri !== 'string' || value.photoUri.length > 3000000 || !/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/|\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+$)/.test(value.photoUri))) throw fail(400, 'Invalid photo');
  const draft = {};
  for (const key of ['toolId', 'roomTypeId', 'styleId', 'paletteId', 'modelId', 'mode']) {
    if (value.draft?.[key] != null) {
      if (typeof value.draft[key] !== 'string' || value.draft[key].length > 100) throw fail(400, 'Invalid draft');
      draft[key] = value.draft[key];
    }
  }
  if (!draft.toolId) throw fail(400, 'Tool required');
  // AI inputs: the person's own words, custom palette colours (exact #RRGGBB), an Explore inspiration used as a style reference, and text-only mode.
  if (value.draft?.prompt != null) { if (typeof value.draft.prompt !== 'string') throw fail(400, 'Invalid draft'); const text = value.draft.prompt.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 500); if (text) draft.prompt = text; }
  if (value.draft?.colors != null) { if (!Array.isArray(value.draft.colors) || value.draft.colors.length > 8 || value.draft.colors.some(c => typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c))) throw fail(400, 'Invalid colors'); const colors = normalizeColors(value.draft.colors); if (colors.length) draft.colors = colors; }
  if (value.draft?.inspirationId != null) { if (typeof value.draft.inspirationId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.draft.inspirationId)) throw fail(400, 'Invalid draft'); draft.inspirationId = value.draft.inspirationId; }
  if (value.draft?.source != null) { if (!['photo', 'text'].includes(value.draft.source)) throw fail(400, 'Invalid draft'); draft.source = value.draft.source; }
  if (draft.source === 'text' && value.photoUri) throw fail(400, 'Invalid photo');
  return { name, whatsapp, draft, photoUri: value.photoUri, userId: trim(value.userId || 'client', 100), status: 'pending', createdAt: Date.now() };
}
const META_STATUS = ['automation', 'active', 'fallback', 'paid', 'local'];
const short = (v, n = 60) => (typeof v === 'string' ? v.slice(0, n) : '');
/** The part of a reply's `meta` we keep: status, who answered, and the providers tried before. Null when it is not a usable object. */
function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object' || !META_STATUS.includes(meta.status)) return null;
  const out = { status: meta.status, provider: short(meta.provider, 40), label: short(meta.label), model: short(meta.model, 80) };
  if (meta.paid === true) out.paid = true;
  if (typeof meta.language === 'string') out.language = short(meta.language, 12);
  if (typeof meta.automationId === 'string') out.automationId = short(meta.automationId, 40);
  if (typeof meta.automationName === 'string') out.automationName = short(meta.automationName, 80);
  if (Array.isArray(meta.tried)) out.tried = meta.tried.slice(0, 12).filter(x => x && typeof x === 'object').map(x => ({ provider: short(x.provider, 40), label: short(x.label), model: short(x.model, 80), ...(x.paid === true ? { paid: true } : {}), reason: short(x.reason, 20) }));
  return out;
}
/**
 * Validates a conversation write (shared by signed-in clients and visitors): shape, size, and who may write which role.
 * Admin answers belong to the server: a client can neither forge nor erase them (and a stale copy never drops a new reply).
 * Mutates `value.messages`; returns the user messages that are new (they notify the admins).
 */
function mergeConversation(value, existing) {
  if (!Array.isArray(value.messages) || value.messages.length > 1000 || typeof value.title !== 'string') throw fail(400, 'INVALID_CONVERSATION');
  const known = new Map((existing?.messages || []).map(m => [m.id, m]));
  const sent = value.messages.filter(m => m && typeof m.id === 'string' && typeof m.text === 'string' && m.text.length <= 4000 && ['user', 'assistant'].includes(m.role));
  const kept = (existing?.messages || []).filter(m => m.role === 'admin');
  // A voice note is `{ uri, durationMs }` (the data URL is replaced by /api/media/... before this runs); anything else is dropped.
  for (const m of sent) {
    if (m.audio == null) continue;
    const ok = m.audio && typeof m.audio.uri === 'string' && m.audio.uri.length <= 300 && /^(?:\/api\/media\/|https?:\/\/)/.test(m.audio.uri);
    if (ok) m.audio = { uri: m.audio.uri, ...(Number.isFinite(m.audio.durationMs) ? { durationMs: Math.max(0, Math.min(600000, Math.round(m.audio.durationMs))) } : {}) };
    else delete m.audio;
  }
  // `meta` says who answered (admin-only badge). Only known short fields survive: a client cannot store anything else there.
  for (const m of sent) {
    if (m.meta === undefined) continue;
    const meta = m.role === 'assistant' ? cleanMeta(m.meta) : null;
    if (meta) m.meta = meta; else delete m.meta;
  }
  value.messages = [...sent, ...kept].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return sent.filter(m => m.role === 'user' && !known.has(m.id));
}
const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

/** `media` (tests): { storage, download } overrides for the R2 adapter and the external downloader. */
/**
 * `isReady` (long-running server only, see server/start.js): while it returns false the database is still starting up in the
 * background, so /api/health answers 503 `database: "starting"` and every other /api route 503 with a clear message.
 * Without it (Vercel, tests) the backend is always ready and behaves exactly as before.
 */
function createBackend({ env = process.env, db = createDb(env), dnsResolver, senders, media: mediaOptions = {}, translator = translate, chatFetch, imageFetch, isReady = () => true } = {}) {
  // `db` is the RAW database: only the tenant registry, the background sweep and the platform tables use it. Every request works on the
  // modules of ONE tenant (server/bundle.js), each built on a tenant-bound handle (server/scope.js) that cannot read another tenant's rows.
  const bundles = createBundles({ db, env, senders, media: mediaOptions, chatFetch, imageFetch });
  const rawDb = db; // `handle` shadows `db` with the tenant-bound handle; the registry check below needs the raw one
  const tenants = createTenants({ db, env, resolveTxt: dnsResolver });
  // Platform back office: the only code that touches the saas_* tables with the raw database (server/superadmin.js).
  const superAdmin = createSuperAdmin({ db: rawDb, env, bundles, tenants });
  const base = bundles.get('default'); // the original single-tenant app = the default tenant (also what `createBackend()` exposes to tests / scripts)
  const { notifier, clients, campaigns, chat, assistant } = base;
  const trustedProxies = new Set(String(env.TRUSTED_PROXY_IPS || '').split(',').map(value => value.trim()).filter(Boolean));
  // Managed hosts (Hostinger) put a reverse proxy on the same machine in front of the app: every request then comes from a
  // loopback address. TRUST_PROXY=true (set automatically by server/start.js on Hostinger) reads the client address the proxy
  // forwards for loopback peers only; the app port itself is not reachable from the internet there.
  const trustLoopback = env.TRUST_PROXY === 'true';
  const loopback = remote => remote === '::1' || /^(::ffff:)?127\./.test(remote);
  const address = req => {
    const remote = req.socket?.remoteAddress || 'unknown';
    // On Vercel every request reaches the function through the platform proxy: without this all visitors would
    // share one rate-limit bucket and real traffic (including leads) would be throttled.
    if (env.VERCEL) {
      const forwarded = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
      return isIP(forwarded) ? forwarded : remote;
    }
    if (!trustedProxies.has(remote) && !(trustLoopback && loopback(remote))) return remote;
    // X-Real-IP is set by the proxy; otherwise the LAST X-Forwarded-For entry, the one the immediate proxy appended
    // (earlier entries can be written by the client).
    const real = typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'].trim() : '';
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(value => value.trim()).filter(Boolean);
    const forwarded = real || chain[chain.length - 1] || '';
    return isIP(forwarded) ? forwarded : remote;
  };
  const staticFiles = createStatic(env.STATIC_DIR || path.join(__dirname, '..', 'dist'));
  let lastApiAt = 0; // last API request (any route): the background timer slows down while nobody uses the app
  const allowedOrigins = String(env.APP_ORIGINS || 'http://localhost:4173,http://localhost:8080').split(',').map(value => value.trim());
  const apiLimit = Math.max(300, Math.min(5000, Number(env.API_RATE_LIMIT) || 300));
  const buckets = new Map();
  const rowOf = row => JSON.parse(row.data);
  // `aiRun` (the full prompt and the models tried) is for the admin; the owner's own app never needs it.
  const publicRow = ({ clientHash: ignored, clientRequestId: ignored2, ...row }, isAdmin = true) => { if (!isAdmin) delete row.aiRun; return row; };

  async function handle(req, res) {
    const origin = req.headers.origin;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const json = (status, value, extra) => sendBuffer(req, res, status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }, Buffer.from(JSON.stringify(value)));
    try {
      const url = new URL(req.url, 'http://localhost');
      // Which tenant is this request for? (server/tenants.js: custom domain -> /slug prefix -> native header -> default tenant.)
      // The registry cannot be read while the database is still starting or unconfigured: those answers do not depend on a tenant.
      const resolved = rawDb.configured() && isReady() ? await tenants.resolve(req, url.pathname) : DEFAULT_RESOLVED(url.pathname);
      url.pathname = resolved.pathname; // from here on every route sees the same path whatever the tenant's URL looks like
      const apiBase = `${resolved.base}/api`; // where this tenant's API lives for the browser: also the cookie Path
      // The super admin exists on the platform host only: never under a tenant slug and never on a custom domain.
      if ((url.pathname === '/super-admin' || url.pathname.startsWith('/super-admin/') || url.pathname.startsWith('/api/super-admin/')) && !resolved.platform) throw fail(404, 'NOT_FOUND');
      const bundle = bundles.get(resolved.tenant.id);
      const { content, media, sync, admins, imagegen, enqueue, pump, clients, notifier, campaigns, chat, assistant } = bundle;
      const db = bundle.db; // tenant-bound: shadows the raw database for everything below
      if (url.pathname.startsWith('/api/')) {
        lastApiAt = Date.now();
        // Same-origin needs no configuration; other origins need an explicit allowlist.
        const sameOrigin = origin && /^https?:\/\//.test(origin) && new URL(origin).host === req.headers.host;
        if (origin && !sameOrigin && !allowedOrigins.includes(origin)) throw fail(403, 'Origin not allowed');
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Demand-Token, X-Dwira-Native, X-Dwira-Tenant, X-User-Token, X-Super-Token, If-None-Match');
        res.setHeader('Access-Control-Expose-Headers', 'ETag');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        if (!isReady()) {
          const retry = { 'Retry-After': '5' };
          if (url.pathname === '/api/health' && req.method === 'GET') return json(503, { ok: false, runtime: process.versions.bun ? 'bun' : 'node', node: process.versions.node, platform: env.DWIRA_PLATFORM || 'node', database: 'starting', media: r2Status(env), adminConfigured: !!(env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH), uptime: Math.round(process.uptime()) }, retry);
          res.setHeader('Retry-After', '5');
          throw fail(503, 'The database is starting up. Please retry in a few seconds.');
        }
        // The web-app manifest of a tenant under a slug (the shell links to it: /acme/api/manifest.webmanifest).
        if (url.pathname === '/api/manifest.webmanifest' && req.method === 'GET' && resolved.tenant.id !== 'default') return json(200, tenantManifest(resolved), MANIFEST_HEADERS);
        // Media (images and videos): stable content-addressed /api/media/<hash>.<ext> URLs. Files stored in R2 are a redirect
        // to the public R2 URL (bytes never pass through the function); the database fallback serves the bytes, cached forever.
        // Served before rate limiting: one Home screen can show dozens of them.
        if (url.pathname.startsWith('/api/media/') && (req.method === 'GET' || req.method === 'HEAD')) {
          if (!db.configured()) throw fail(503, 'DATABASE_NOT_CONFIGURED');
          await content.ensureSeed();
          const name = url.pathname.slice('/api/media/'.length);
          const file = await media.readMedia(name, { head: req.method === 'HEAD' });
          if (!file) throw fail(404, 'NOT_FOUND');
          // The target never changes for a name, but a day-long cache lets a change of R2_PUBLIC_BASE_URL take effect.
          if (file.redirect) { res.writeHead(302, { Location: file.redirect, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' }); return res.end(); }
          // The name is the hash of the bytes: it is its own ETag, so a revalidation costs no database read at all.
          const etag = `"${name}"`;
          const headers = { 'Content-Type': file.mime, ETag: etag, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', ...(file.mime === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) };
          if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] }); return res.end(); }
          if (req.method === 'HEAD') { res.writeHead(200, { ...headers, 'Content-Length': file.size ?? file.body.length }); return res.end(); }
          // Audio/video players seek with Range requests (Safari refuses to play without them).
          headers['Accept-Ranges'] = 'bytes';
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          if (range && (range[1] || range[2])) {
            const total = file.body.length;
            let start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
            let end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
            if (start >= total || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); return res.end(); }
            res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 });
            return res.end(file.body.subarray(start, end + 1));
          }
          return sendBuffer(req, res, 200, headers, file.body);
        }
        const bucketName = (url.pathname === '/api/admin/login' || url.pathname === '/api/super-admin/login') ? 'login' : url.pathname === '/api/sync' ? 'sync' : (url.pathname === '/api/chat/reply' || url.pathname === '/api/chat/demo-click') ? 'chat' : 'api';
        const key = `${bundle.tenantId}:${address(req)}:${bucketName}`; // one tenant's traffic can never exhaust another's allowance
        const now = Date.now();
        if (buckets.size > 10000) for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
        const bucket = buckets.get(key) || { count: 0, until: now + 15 * 60000 };
        if (bucket.until < now) { bucket.count = 0; bucket.until = now + 15 * 60000; }
        bucket.count++; buckets.set(key, bucket);
        // The AI chat spends a shared free quota: its own, much smaller allowance per address (CHAT_RATE_LIMIT per 15 minutes, default 90).
        if (bucket.count > (bucketName === 'login' ? 20 : bucketName === 'sync' ? 20000 : bucketName === 'chat' ? Math.max(5, Math.min(2000, Number(env.CHAT_RATE_LIMIT) || 90)) : apiLimit)) throw fail(429, 'Too many requests');

        if (url.pathname === '/api/health' && req.method === 'GET') {
          // Never exposes secrets: only whether the database answers right now (one `SELECT 1`, 5 s at most).
          let database = 'missing';
          try {
            if (db.configured()) {
              const kind = await db.info();
              const answered = await withTimeout(db.query('SELECT 1 AS ok').then(rows => rows[0]?.ok === 1), 5000);
              database = answered ? kind : 'error';
            }
          } catch { database = 'error'; }
          const ok = database !== 'error' && database !== 'missing';
          // media: 'r2' | 'database' (no R2 variables) | 'incomplete' (some missing). Only the mode, never a value.
          return json(ok ? 200 : 503, { ok, runtime: process.versions.bun ? 'bun' : 'node', node: process.versions.node, platform: env.VERCEL ? 'vercel' : env.DWIRA_PLATFORM || 'node', database, media: r2Status(env), adminConfigured: !!(env.ADMIN_EMAIL && env.ADMIN_PASSWORD_HASH), uptime: Math.round(process.uptime()) });
        }
        if (!db.configured()) throw fail(503, 'DATABASE_NOT_CONFIGURED');

        // ---- Super admin (platform host only: guarded above, never under a slug or on a custom domain) ----
        if (url.pathname.startsWith('/api/super-admin/')) {
          const result = await superAdmin.handle({ req, url, readBody, ip: address(req) });
          return json(result.status, result.data, { 'Cache-Control': 'private, no-store', ...(result.headers || {}) });
        }

        const rawCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_admin='))?.slice(12);
        const sessionToken = req.headers.authorization?.replace(/^Bearer /, '') || rawCookie;

        // Public content: no session, no client lookup. Only a request that carries an admin credential (or says it is an
        // admin panel request with ?a=1) pays for the session query, because only admins may see provider API keys.
        if (url.pathname === '/api/content' && req.method === 'GET') {
          const adminAsked = !!sessionToken || url.searchParams.has('a');
          const admin = !!sessionToken && !!(await db.query('SELECT 1 FROM admin_sessions WHERE tenant_id=:tenant AND token_hash=$1 AND expires_at>$2', [hash(sessionToken), now]))[0];
          // The ETag is the content version (one tiny sync_state read): an unchanged app gets a bodyless 304 and the database is never asked for the snapshot.
          const etag = await content.etag(admin);
          const matches = (req.headers['if-none-match'] || '').split(',').map(value => value.trim()).includes(etag);
          // The shared CDN may keep the PUBLIC copy briefly (CONTENT_S_MAXAGE seconds, default 30, 0 disables) and serve a stale one while it
          // refreshes in the background, so visitors rarely wait on a database that may be waking up. Browsers always revalidate
          // (max-age=0). Admin copies (which contain secrets) and admin-panel requests are never stored. Edits stay visible quickly:
          // /api/sync bumps the content version and the app then asks for /api/content?v=<version>, a distinct cache key.
          const maxAge = Math.max(0, Math.min(300, Number(env.CONTENT_S_MAXAGE ?? 30) || 0));
          const cacheable = !adminAsked && maxAge > 0;
          const cacheControl = cacheable ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 10}` : 'private, no-store';
          if (matches) { res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl, ...(admin ? {} : { Vary: 'Accept-Encoding' }) }); return res.end(); }
          const snapshot = await content.snapshot(admin);
          return json(200, snapshot, { 'Cache-Control': cacheControl, ETag: etag });
        }

        const session = sessionToken && (await db.query('SELECT token_hash,admin_id FROM admin_sessions WHERE tenant_id=:tenant AND token_hash=$1 AND expires_at>$2', [hash(sessionToken), now]))[0];
        const adminId = session?.admin_id;
        const admin = () => { if (!session) throw fail(401, 'Admin login required'); };
        const clientToken = req.headers['x-demand-token'];
        const clientHash = typeof clientToken === 'string' && /^[a-f0-9]{64}$/.test(clientToken) ? hash(clientToken) : null;
        const userCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_user='))?.slice(11);
        const userToken = req.headers['x-user-token'] || userCookie;
        const client = await clients.authenticate(userToken);
        // One client's data changed: `c:<id>` (everything, the legacy key) plus one key per part so a device reloads only the part that changed.
        const PARTS = ['conversations', 'history', 'requests'];
        const touch = (id, ...parts) => [`c:${id}`, ...(parts.length ? parts : PARTS).map(part => `c:${id}:${part}`)];
        const requireUser = () => { if (!client) throw fail(401, 'USER_LOGIN_REQUIRED'); if (client.blocked) throw fail(403, 'ACCOUNT_BLOCKED'); return client; };
        const cookie = (name, token, age) => `${name}=${token}; HttpOnly; SameSite=Strict; Path=${apiBase}; Max-Age=${age}${env.COOKIE_SECURE === 'false' ? '' : '; Secure'}`;

        // ---- Client accounts ----
        if (url.pathname === '/api/user/login' && req.method === 'POST') {
          const body = await readBody(req);
          const result = await clients.login(body.name, body.phone, (await content.getDoc('settings')).defaultFreeCredits);
          res.setHeader('Set-Cookie', cookie('dwira_user', result.token, 365 * 86400));
          // Chats this device held as a visitor now belong to the person who just signed in.
          if (clientHash && (await clients.adoptGuest(clientHash, result.user)).length) await sync.bump(...touch(result.user.id, 'conversations'), 'chats', `g:${clientHash}`);
          if (result.created) {
            // A brand-new lead: tell the admins right away (bounded wait; failures stay queued for retry).
            await enqueue('lead', `lead:${result.user.id}`, { id: result.user.id, name: result.user.name, whatsapp: result.user.whatsapp });
            await sync.bump('clients');
            await withTimeout(pump(`lead:${result.user.id}`), Number(env.PUSH_WAIT_MS) || 8000);
          }
          return json(200, { user: result.user, prefs: await content.clientPrefs(result.user.id), ...(req.headers['x-dwira-native'] === '1' ? { token: result.token } : {}) });
        }
        if (url.pathname === '/api/user/session' && req.method === 'GET') return json(200, { user: requireUser(), prefs: await content.clientPrefs(client.id) });
        // ---- Sync, shared content and preferences ----
        if (url.pathname === '/api/sync' && req.method === 'GET') {
          const keys = ['content', ...(session ? ['requests', 'clients', 'chats', 'campaigns', `a:${adminId}`] : []), ...(client ? [`c:${client.id}`, ...['conversations', 'history', 'requests'].map(part => `c:${client.id}:${part}`)] : []), ...(clientHash && !client ? [`g:${clientHash}`] : [])];
          const versions = await sync.read(keys);
          if (env.VERCEL) {
            // Serverless has no background timer (cron is only daily): any open app retries failed notifications and drives
            // scheduled / recurring / automated campaigns (cross-instance throttled to one run per 10 s).
            const waiting = (await db.query('SELECT 1 FROM outbox WHERE tenant_id=:tenant AND next_at<=$1 LIMIT 1', [now]))[0];
            if (waiting) await withTimeout(pump(), 9000);
            await withTimeout(campaigns.tick({ budgetMs: 6000 }), 8000);
          }
          // Long-running server: the background timer below does both, so a poll costs only the version read.
          return json(200, { content: versions.content, campaigns: session ? versions.campaigns : null, requests: session ? versions.requests : null, clients: session ? versions.clients : null, chats: session ? versions.chats : null, admin: session ? versions[`a:${adminId}`] : null, client: client ? versions[`c:${client.id}`] : null, parts: client ? Object.fromEntries(['conversations', 'history', 'requests'].map(part => [part, versions[`c:${client.id}:${part}`]])) : null, guest: clientHash && !client ? versions[`g:${clientHash}`] : null, user: client ? { id: client.id, blocked: !!client.blocked } : null, isAdmin: !!session });
        }
        if (url.pathname === '/api/prefs') {
          const asAdmin = url.searchParams.get('as') === 'admin';
          if (asAdmin) admin(); else requireUser();
          if (req.method === 'GET') return json(200, asAdmin ? await content.adminPrefs(adminId) : await content.clientPrefs(client.id));
          if (req.method === 'PATCH') return json(200, asAdmin ? await content.setAdminPrefs(adminId, await readBody(req)) : await content.setClientPrefs(client.id, await readBody(req)));
          throw fail(405, 'Method not allowed');
        }
        if (url.pathname === '/api/user/logout' && req.method === 'POST') {
          await clients.logout(userToken);
          res.setHeader('Set-Cookie', cookie('dwira_user', '', 0));
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/user/claim' && req.method === 'POST') {
          const body = await readBody(req);
          const claimed = await clients.claim(requireUser(), body.id);
          await sync.bump(...touch(client.id, 'history'), 'clients');
          return json(200, { user: claimed });
        }
        if (url.pathname === '/api/user/requests' && req.method === 'GET') {
          requireUser();
          return json(200, (await db.query('SELECT data FROM requests WHERE tenant_id=:tenant AND user_id=$1 ORDER BY created_at DESC', [client.id])).map(row => publicRow(rowOf(row), false)));
        }
        // ---- Visitors: assistant chats without an account or any personal detail, stored under the device token ----
        const guestChat = url.pathname.match(/^\/api\/guest\/conversations(?:\/([A-Za-z0-9_-]{1,100}))?$/);
        if (guestChat) {
          if (client) throw fail(409, 'ALREADY_SIGNED_IN'); // a signed-in person uses /api/user/conversations
          if (!clientHash) throw fail(400, 'Client token required');
          const id = guestChat[1];
          if (req.method === 'GET') {
            if (!id) return json(200, await clients.guestList(clientHash));
            const row = await clients.guestGet(clientHash, id);
            if (!row) throw fail(404, 'NOT_FOUND');
            return json(200, row);
          }
          if (req.method === 'DELETE' && id) { await clients.guestRemove(clientHash, id); await sync.bump('chats', `g:${clientHash}`); return json(200, { ok: true }); }
          if (req.method === 'POST' || req.method === 'PATCH' && id) {
            const body = await readBody(req);
            const existing = id && (await clients.guestGet(clientHash, id));
            if (id && !existing) throw fail(404, 'NOT_FOUND');
            const value = { ...existing, ...(await media.externalize(body, { remote: 'report', svg: false })).value };
            const fresh = mergeConversation(value, existing);
            const saved = await clients.guestPut(clientHash, value, id || crypto.randomUUID());
            await sync.bump('chats', `g:${clientHash}`);
            if (fresh.length) {
              const last = fresh[fresh.length - 1], jobId = `chat:${saved.id}:${last.id}`;
              await enqueue('chat', jobId, { id: saved.id, name: '', whatsapp: '', text: last.text, audio: !!last.audio });
              await withTimeout(pump(jobId), Number(env.PUSH_WAIT_MS) || 8000);
            }
            return json(200, saved);
          }
          throw fail(405, 'Method not allowed');
        }
        const space = url.pathname.match(/^\/api\/user\/(history|conversations)(?:\/([A-Za-z0-9_-]{1,100}))?$/);
        if (space) {
          requireUser();
          const kind = space[1], id = space[2];
          if (req.method === 'GET') {
            if (!id) return json(200, await clients.listSpace(client, kind));
            const row = await clients.getSpaceItem(client, kind, id);
            if (!row) throw fail(404, 'NOT_FOUND');
            return json(200, row);
          }
          if (req.method === 'DELETE' && id) { await clients.removeSpace(client, kind, id); await sync.bump(...touch(client.id, kind)); return json(200, { ok: true }); }
          if (req.method === 'POST' || req.method === 'PATCH' && id) {
            const body = await readBody(req);
            const existing = id && (await clients.getSpaceItem(client, kind, id));
            if (id && !existing) throw fail(404, 'NOT_FOUND');
            if (req.method === 'POST' && kind === 'history' && !(await clients.hasClaim(body.claimId, client.id))) throw fail(403, 'CLAIM_REQUIRED');
            // Inline uploads (data URLs) and external pictures go to media storage; a failed download keeps the URL so a design is never lost.
            const value = { ...existing, ...(await media.externalize(body, { remote: 'report', svg: false })).value };
            if (kind === 'history' && (!value.draft?.toolId || typeof value.before !== 'string' || !['pending', 'done'].includes(value.status))) throw fail(400, 'INVALID_HISTORY');
            const fresh = kind === 'conversations' ? mergeConversation(value, existing) : [];
            const saved = await clients.putSpace(client, kind, value, id || (kind === 'history' ? body.claimId : crypto.randomUUID()));
            // The admin client list shows profile and credits only: claims/credits bump `clients` themselves, so a chat or history write must not make every admin reload it.
            await sync.bump(...touch(client.id, kind));
            if (fresh.length) {
              // Tell the admins about the newest message; the link opens exactly this conversation.
              const last = fresh[fresh.length - 1], jobId = `chat:${saved.id}:${last.id}`;
              await enqueue('chat', jobId, { id: saved.id, name: client.name, whatsapp: client.whatsapp, text: last.text, audio: !!last.audio });
              await sync.bump('chats');
              await withTimeout(pump(jobId), Number(env.PUSH_WAIT_MS) || 8000);
            }
            return json(200, saved);
          }
          throw fail(405, 'Method not allowed');
        }

        // ---- Admin ----
        if (url.pathname === '/api/admin/clients' && req.method === 'GET') { admin(); return json(200, await clients.users()); }
        if (url.pathname === '/api/admin/conversations' && req.method === 'GET') {
          admin();
          // Without `since`: the newest 300 as a plain array (as before). With `since=<updatedAt>`: `{ chats, ids }`, only what changed after it.
          const since = url.searchParams.get('since');
          if (since === null) return json(200, (await clients.adminConversations()).chats);
          return json(200, await clients.adminConversations({ since: Number(since) || 0 }));
        }
        const adminChat = url.pathname.match(/^\/api\/admin\/conversations\/([A-Za-z0-9_-]{1,100})$/);
        if (adminChat && req.method === 'POST') {
          admin();
          const body = await readBody(req), text = typeof body.text === 'string' ? body.text.trim() : '';
          if (text.length > 4000) throw fail(400, 'INVALID_MESSAGE');
          // A voice note: `audio: { uri: <data URL>, durationMs }`, stored as an /api/media file (its real type is checked from the bytes).
          let audio;
          if (body.audio != null) {
            const data = body.audio?.uri;
            if (typeof data !== 'string' || !/^data:audio\//i.test(data)) throw fail(400, 'INVALID_MESSAGE');
            const uri = (await media.externalize({ file: data }, { remote: 'skip', svg: false })).value.file;
            audio = { uri, ...(Number.isFinite(body.audio.durationMs) ? { durationMs: Math.max(0, Math.min(600000, Math.round(body.audio.durationMs))) } : {}) };
          }
          if (!text && !audio) throw fail(400, 'INVALID_MESSAGE');
          const message = { id: `a_${crypto.randomUUID()}`, role: 'admin', text, ...(audio ? { audio } : {}), createdAt: Date.now() };
          const { conversation, clientId, deviceHash } = await clients.adminReply(adminChat[1], text, message);
          // A visitor has no account to notify: their open chat picks the answer up through the sync loop.
          if (!clientId) { await sync.bump('chats', `g:${deviceHash}`); return json(200, conversation); }
          await sync.bump(...touch(clientId, 'conversations'), 'chats');
          const jobId = `reply:${conversation.id}:${message.id}`;
          await enqueue('reply', jobId, { id: conversation.id, text, audio: !!audio, audience: { type: 'client', id: clientId } });
          await withTimeout(pump(jobId), Number(env.PUSH_WAIT_MS) || 8000);
          return json(200, conversation);
        }
        if (url.pathname === '/api/admin/notification-subscribers' && req.method === 'GET') {
          admin();
          return json(200, { adminsEnabled: await notifier.enabled('admin'), usersEnabled: await notifier.enabled('client'), users: await notifier.clientSubscribers() });
        }
        // ---- Notification campaigns (admin) ----
        if (url.pathname.startsWith('/api/admin/campaigns')) {
          admin();
          const route = url.pathname.slice('/api/admin/campaigns'.length).replace(/^\//, '');
          if (!route) {
            if (req.method === 'GET') return json(200, await campaigns.list());
            if (req.method === 'POST') return json(201, await campaigns.create(await readBody(req)));
            throw fail(405, 'Method not allowed');
          }
          if (route === 'segments' && req.method === 'GET') return json(200, await campaigns.segments({ newDays: Number(url.searchParams.get('newDays')) || undefined, inactiveDays: Number(url.searchParams.get('inactiveDays')) || undefined }));
          if (route === 'preview' && req.method === 'POST') return json(200, await campaigns.preview(await readBody(req)));
          if (route === 'people' && req.method === 'GET') return json(200, await campaigns.people());
          if (route === 'test' && req.method === 'POST') {
            // Shows the message on THIS admin's own devices, exactly as clients will see it ({name} becomes "Admin").
            const body = await readBody(req);
            if (!(await notifier.count())) throw fail(409, 'NO_SUBSCRIPTION');
            const cleaned = cleanCampaign({ ...body, name: body?.name || 'test', audience: {} }, 'once');
            const result = await withTimeout(notifier.deliver({ id: 'test', name: 'Admin', title: cleaned.title, body: cleaned.body, url: cleaned.url }, [], { event: 'campaign', audience: { type: 'admin' }, force: true }), 12000);
            return json(200, { ok: !!result && !result.retry && result.sent > 0, devices: result?.devices ?? 0 });
          }
          const [id, action] = route.split('/');
          if (!/^[a-f0-9-]{8,64}$/.test(id)) throw fail(404, 'NOT_FOUND');
          if (!action) {
            if (req.method === 'GET') return json(200, await campaigns.get(id));
            if (req.method === 'PATCH') return json(200, await campaigns.update(id, await readBody(req)));
            if (req.method === 'DELETE') { await campaigns.remove(id); return json(200, { ok: true }); }
            throw fail(405, 'Method not allowed');
          }
          if (req.method !== 'POST') throw fail(405, 'Method not allowed');
          if (action === 'activate') {
            const result = await campaigns.activate(id);
            // "Send now" must not wait for the next poll: run the scheduler once, bounded.
            await withTimeout(campaigns.tick({ force: true, budgetMs: 8000 }), 10000);
            return json(200, await campaigns.get(result.id));
          }
          if (action === 'pause') return json(200, await campaigns.pause(id));
          if (action === 'duplicate') return json(201, await campaigns.duplicate(id));
          throw fail(404, 'NOT_FOUND');
        }
        // ---- AI assistant: reply generated by the free provider chain (visitors and clients; the prompt comes from the stored assistant settings) ----
        if (url.pathname === '/api/chat/reply' && req.method === 'POST') {
          if (client?.blocked) throw fail(403, 'ACCOUNT_BLOCKED');
          if (!client && !clientHash) throw fail(400, 'Client token required');
          const body = await readBody(req);
          const config = await content.getDoc('assistant');
          if (config.type === 'whatsapp') throw fail(409, 'ASSISTANT_DISABLED');
          // Automations first (the owner's rules), then the AI grounded on the app knowledge, free providers then paid ones with automatic fallback.
          try { return json(200, await assistant.answer(body, { config, client })); }
          catch (error) { if (error.message === 'NO_PROVIDER') return json(503, { error: 'NO_PROVIDER', tried: error.tried || [] }); throw error; }
        }
        // One tap on a demo message (counter only: never trusts or stores anything but the id).
        if (url.pathname === '/api/chat/demo-click' && req.method === 'POST') {
          if (!client && !clientHash) throw fail(400, 'Client token required');
          await assistant.demo.click((await readBody(req)).id);
          return json(200, { ok: true });
        }
        // Quick-reply buttons of the chat (labels only).
        if (url.pathname === '/api/chat/buttons' && req.method === 'GET') {
          if (!client && !clientHash) throw fail(400, 'Client token required');
          return json(200, { buttons: await assistant.buttons() }, { 'Cache-Control': 'private, max-age=30' });
        }
        // ---- AI image generation: the request (photo or text, style, palette, colours, prompt) was stored by POST /api/requests, which also spent the credit. ----
        if (url.pathname === '/api/ai/status' && req.method === 'GET') return json(200, await imagegen.publicStatus(), { 'Cache-Control': 'private, max-age=30' });
        if (url.pathname === '/api/ai/render' && req.method === 'POST') {
          requireUser();
          const body = await readBody(req);
          try { return json(200, await imagegen.renderRequest(client, body.id)); }
          catch (error) {
            // The wizard shows its sample result when no engine is configured (demo mode) and offers Retry for every other failure.
            if (error.status === 503 && error.message === 'AI_NOT_CONFIGURED') return json(503, { error: 'AI_NOT_CONFIGURED' });
            throw error;
          }
        }
        if (url.pathname === '/api/admin/ai/status' && req.method === 'GET') { admin(); return json(200, await imagegen.status()); }
        if (url.pathname === '/api/admin/ai/keys' && req.method === 'PATCH') { admin(); return json(200, await imagegen.setKeys(await readBody(req))); }
        // ---- Prompt cards: the admin decides the final prompt and pictures sent to the image model (per tool or for all tools). ----
        if (url.pathname === '/api/admin/prompt-rules' && req.method === 'GET') { admin(); return json(200, await imagegen.rulesInfo()); }
        if (url.pathname === '/api/admin/prompt-rules' && req.method === 'PUT') { admin(); return json(200, await imagegen.setRules(await readBody(req))); }
        if (url.pathname === '/api/admin/prompt-rules/preview' && req.method === 'POST') { admin(); return json(200, await imagegen.previewPrompt(await readBody(req))); }
        if (url.pathname === '/api/admin/chat/status' && req.method === 'GET') { admin(); return json(200, await chat.status()); }
        if (url.pathname === '/api/admin/chat/keys' && req.method === 'PATCH') { admin(); return json(200, await chat.setKeys(await readBody(req))); }
        // Providers: free switches, the paid zone (position, providers, write-only keys).
        if (url.pathname === '/api/admin/chat/config' && req.method === 'PUT') { admin(); return json(200, await chat.setConfig(await readBody(req))); }
        // Automations: the whole ordered list (order = priority) with usage counters; saved as a whole.
        if (url.pathname === '/api/admin/assistant/automations' && req.method === 'GET') { admin(); return json(200, await assistant.overview()); }
        if (url.pathname === '/api/admin/assistant/automations' && req.method === 'PUT') { admin(); return json(200, await assistant.saveList(await readBody(req))); }
        // Preview: what a visitor (or a draft automation) would get. Nothing is counted. Costs one AI call at most.
        if (url.pathname === '/api/admin/assistant/test' && req.method === 'POST') {
          admin();
          const body = await readBody(req);
          const config = await content.getDoc('assistant');
          return json(200, await assistant.test(body, { config }));
        }
        // What the assistant knows (sections built from the docs and the app data) for the Knowledge tab.
        if (url.pathname === '/api/admin/assistant/knowledge' && req.method === 'GET') { admin(); return json(200, knowledge.overview()); }
        // Demo messages: usage counters and the questions customers really ask (to promote them to demo messages).
        if (url.pathname === '/api/admin/assistant/demo' && req.method === 'GET') {
          admin();
          const chats = (await clients.adminConversations()).chats;
          return json(200, { stats: await assistant.demo.stats(), popular: assistant.demo.popular(chats, { limit: 8 }) });
        }
        if (url.pathname === '/api/admin/clients/bulk' && req.method === 'POST') {
          admin();
          const body = await readBody(req), result = await clients.bulk(body);
          if (body.action === 'delete') for (const id of body.ids) await notifier.removeOwner('client', id);
          await sync.bump('clients', 'requests', ...(Array.isArray(body.ids) ? body.ids.flatMap(id => typeof id === 'string' ? (body.action === 'delete' ? touch(id) : touch(id, 'requests')) : []) : []));
          return json(200, result);
        }
        const contentItem = url.pathname.match(/^\/api\/admin\/content\/([A-Za-z]+)(?:\/([A-Za-z0-9_-]{1,100}))?$/);
        if (contentItem) {
          admin();
          if (req.method === 'PUT' && contentItem[2]) return json(200, await content.putItem(contentItem[1], contentItem[2], await readBody(req)));
          if (req.method === 'DELETE' && !contentItem[2]) { await content.deleteItems(contentItem[1], (await readBody(req)).ids); return json(200, { ok: true }); }
          throw fail(405, 'Method not allowed');
        }
        // Automatic translation of admin content (fr / ar / Moroccan Darija) through free keyless providers; admin only.
        if (url.pathname === '/api/admin/translate' && req.method === 'POST') { admin(); return json(200, await translator(await readBody(req))); }
        const contentDoc = url.pathname.match(/^\/api\/admin\/doc\/([A-Za-z]+)$/);
        if (contentDoc && req.method === 'PATCH') { admin(); return json(200, await content.patchDoc(contentDoc[1], await readBody(req))); }
        const creditClient = url.pathname.match(/^\/api\/admin\/clients\/([a-f0-9-]+)$/);
        if (creditClient && req.method === 'PATCH') {
          admin();
          const body = await readBody(req);
          const updated = await clients.update(creditClient[1], { credits: body.credits, blocked: body.blocked });
          await sync.bump('clients', `c:${creditClient[1]}`);
          return json(200, updated);
        }
        if (creditClient && req.method === 'DELETE') {
          admin();
          await clients.remove(creditClient[1]);
          await notifier.removeOwner('client', creditClient[1]);
          await sync.bump('clients', 'requests', ...touch(creditClient[1]));
          return json(200, { ok: true });
        }
        // ---- Admin media uploads ----
        // Small files (images picked in the admin): JSON { data: 'data:<type>;base64,...' } -> stored via media.storeMedia.
        if (url.pathname === '/api/admin/media' && req.method === 'POST') {
          admin();
          const body = await readBody(req);
          if (typeof body.data !== 'string' || !/^data:[a-z]+\/[a-z0-9.+-]+;base64,/i.test(body.data)) throw fail(400, 'INVALID_MEDIA');
          const { value } = await media.externalize({ file: body.data });
          return json(200, { url: value.file });
        }
        // Raw upload (database mode, where presigned uploads do not exist): the file is the request body, its type the Content-Type.
        if (url.pathname === '/api/admin/media/raw' && req.method === 'POST') {
          admin();
          const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          const max = media.rawLimit(type.startsWith('video/') ? 'video' : 'image');
          let size = 0;
          const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > max) throw fail(413, 'MEDIA_TOO_LARGE'); chunks.push(chunk); }
          return json(200, { url: await media.storeRaw(Buffer.concat(chunks), type) });
        }
        // Admin card-video renderer: the bytes of one picture (ours, or an external https one) so the browser can draw it without CORS.
        if (url.pathname === '/api/admin/media/fetch' && req.method === 'GET') {
          admin();
          const source = url.searchParams.get('url') || '';
          if (!source || source.length > 2048) throw fail(400, 'INVALID_URL');
          let file;
          try { file = await media.fetchBytes(source); }
          catch (error) { throw error.status ? error : fail(error.policy ? 400 : 502, `MEDIA_URL_${error.code || 'FAILED'}`); }
          res.writeHead(200, { 'Content-Type': file.mime, 'Content-Length': file.body.length, 'Cache-Control': 'private, no-store' });
          return res.end(file.body);
        }
        // External image URL -> downloaded once into storage (https, public hosts, 10 s, 10 MB, image/* only).
        if (url.pathname === '/api/admin/media/import' && req.method === 'POST') {
          admin();
          const body = await readBody(req);
          if (typeof body.url !== 'string' || body.url.length > 2048) throw fail(400, 'INVALID_URL');
          try { return json(200, { url: await media.importRemote(body.url) }); }
          catch (error) { throw fail(error.policy ? 400 : 502, `MEDIA_URL_${error.code || 'FAILED'}`); }
        }
        // Large files and videos: presigned PUT straight to R2 (5 minutes). The server picks the key, type and exact size.
        if (url.pathname === '/api/admin/media/presign' && req.method === 'POST') {
          admin();
          const body = await readBody(req);
          return json(200, await media.presignUpload({ contentType: body.contentType, size: body.size }));
        }
        if (url.pathname === '/api/admin/media/complete' && req.method === 'POST') {
          admin();
          return json(200, await media.completeUpload((await readBody(req)).id));
        }
        if (req.method === 'POST' && url.pathname === '/api/admin/login') {
          const body = await readBody(req);
          const identity = typeof body.email === 'string' && typeof body.password === 'string' ? await admins.verify(body.email, body.password) : null;
          if (!identity) throw fail(401, 'Invalid credentials');
          const token = crypto.randomBytes(32).toString('hex');
          await db.query('DELETE FROM admin_sessions WHERE tenant_id=:tenant AND expires_at<=$1', [now]);
          await db.query('INSERT INTO admin_sessions(tenant_id,token_hash,expires_at,admin_id,created_at,ua) VALUES(:tenant,$1,$2,$3,$4,$5)', [hash(token), now + 7 * 86400000, identity, now, String(req.headers['user-agent'] || '').slice(0, 300)]);
          await admins.touchLogin(identity);
          res.setHeader('Set-Cookie', cookie('dwira_admin', token, 604800));
          const profile = await admins.get(identity);
          return json(200, { ok: true, user: { id: 'usr_admin', name: profile.name || 'Admin' }, ...(req.headers['x-dwira-native'] === '1' ? { token } : {}) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/session') { admin(); return json(200, { ok: true, prefs: await content.adminPrefs(adminId), profile: await admins.get(adminId) }); }
        // ---- Administrator account (profile, password, signed-in devices) ----
        if (url.pathname === '/api/admin/account') {
          admin();
          if (req.method === 'GET') return json(200, await admins.get(adminId));
          if (req.method === 'PATCH') return json(200, await admins.update(adminId, await readBody(req)));
          throw fail(405, 'Method not allowed');
        }
        if (url.pathname === '/api/admin/account/password' && req.method === 'POST') {
          admin();
          const body = await readBody(req);
          return json(200, await admins.changePassword(adminId, body.current, body.next, session.token_hash));
        }
        if (url.pathname === '/api/admin/account/sessions' && req.method === 'GET') { admin(); return json(200, { sessions: await admins.sessions(adminId, session.token_hash) }); }
        if (url.pathname === '/api/admin/account/sessions' && req.method === 'DELETE') { admin(); await admins.revokeOthers(adminId, session.token_hash); return json(200, { ok: true }); }
        const sessionId = url.pathname.match(/^\/api\/admin\/account\/sessions\/([a-f0-9]{16})$/);
        if (sessionId && req.method === 'DELETE') { admin(); await admins.revoke(adminId, sessionId[1], session.token_hash); return json(200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
          if (session) await db.query('DELETE FROM admin_sessions WHERE tenant_id=:tenant AND token_hash=$1', [session.token_hash]);
          res.setHeader('Set-Cookie', cookie('dwira_admin', '', 0));
          return json(200, { ok: true });
        }

        // ---- This tenant's own change requests to the platform operator (customise / manage / support). The tenant id comes from the
        // resolved tenant, never from the body, so an administrator can only read and write the requests of their own instance. ----
        if (url.pathname === '/api/admin/instance' && req.method === 'GET') {
          admin();
          const { tenant } = resolved;
          return json(200, { id: tenant.id, slug: tenant.slug, name: tenant.name, kind: tenant.kind, status: tenant.status, base: resolved.base });
        }
        if (url.pathname === '/api/admin/change-requests') {
          admin();
          if (resolved.tenant.kind === 'default' && !resolved.tenant.id) throw fail(404, 'NOT_FOUND');
          if (req.method === 'GET') return json(200, await superAdmin.requestsOfTenant(resolved.tenant.id));
          if (req.method === 'POST') return json(201, await superAdmin.submitRequest(resolved.tenant, adminId, await readBody(req)));
          throw fail(405, 'Method not allowed');
        }

        // ---- Notifications for new requests ----
        if (req.method === 'GET' && url.pathname === '/api/push/config') return json(200, await notifier.config());
        if (url.pathname === '/api/push/subscriptions') {
          const body = await readBody(req);
          // `owner: 'client'` registers the device for the signed-in client's own notifications (design ready).
          const owner = body.owner === 'client' ? (requireUser(), { type: 'client', id: client.id }) : (admin(), { type: 'admin', id: adminId });
          let subscriber;
          try { subscriber = validateSubscription(body); } catch { throw fail(400, 'Invalid subscription'); }
          if (req.method === 'POST') {
            if (subscriber.kind === 'fcm' && !(await notifier.config()).android) throw fail(503, 'Push is not configured');
            await notifier.save(subscriber, owner);
          } else if (req.method === 'DELETE') await notifier.remove(subscriber.id, owner);
          else throw fail(405, 'Method not allowed');
          return json(200, { ok: true });
        }
        if (url.pathname === '/api/push/test' && req.method === 'POST') {
          admin();
          if (!(await notifier.enabled('admin'))) throw fail(409, 'NOTIFICATIONS_OFF');
          const total = await notifier.count();
          if (!total) throw fail(409, 'NO_SUBSCRIPTION');
          const result = await withTimeout(notifier.deliver({ id: 'test', name: 'Test', whatsapp: '+212600000000' }, []), 12000);
          return json(200, { ok: !!result && !result.retry, devices: total });
        }
        // Retry queue trigger for Vercel Cron (Authorization: Bearer $CRON_SECRET) or an admin session.
        if (url.pathname === '/api/push/pump' && (req.method === 'GET' || req.method === 'POST')) {
          const cron = !!env.CRON_SECRET && req.headers.authorization === `Bearer ${env.CRON_SECRET}`;
          if (!session && !cron) throw fail(401, 'Admin login required');
          // The platform cron serves every tenant with work due; an administrator's own call only serves their tenant.
          let ran;
          for (const id of cron ? await bundles.dueTenants() : [bundle.tenantId]) {
            const target = bundles.get(id);
            await withTimeout(target.pump(), 25000);
            const result = await withTimeout(target.campaigns.tick({ force: true, budgetMs: 20000 }), 25000);
            if (id === bundle.tenantId || !ran) ran = result;
          }
          return json(200, { ok: true, campaigns: ran && !ran.skipped ? !!ran.ok : null });
        }

        // ---- Render requests ----
        if (url.pathname === '/api/requests' && req.method === 'POST') {
          if (!clientHash) throw fail(400, 'Client token required');
          requireUser();
          const body = await readBody(req), input = validateDemand({ ...body, userId: client.id, name: client.name, whatsapp: client.whatsapp });
          if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.id)) throw fail(400, 'Stable request ID required');
          await clients.claim(client, body.id);
          // The photo is stored as media (R2 or the database fallback); the request row keeps only its /api/media URL.
          // Skipped for a retry of a request that already exists (idempotent, no duplicate upload work).
          const known = (await db.query('SELECT 1 FROM requests WHERE tenant_id=:tenant AND user_id=$1 AND client_request_id=$2', [client.id, body.id]))[0];
          if (!known) input.photoUri = (await media.externalize({ photoUri: input.photoUri }, { remote: 'report', svg: false })).value.photoUri;
          const request = { ...input, id: crypto.randomUUID(), clientHash, clientRequestId: body.id };
          const inserted = await db.query('INSERT INTO requests(tenant_id,id,user_id,client_request_id,created_at,data) VALUES(:tenant,$1,$2,$3,$4,$5) ON CONFLICT (user_id, client_request_id) DO NOTHING RETURNING id', [request.id, client.id, body.id, request.createdAt, JSON.stringify(request)]);
          if (inserted.length) { await enqueue('request', request.id); await sync.bump('requests', 'clients', ...touch(client.id, 'requests', 'history')); }
          const stored = rowOf((await db.query('SELECT data FROM requests WHERE tenant_id=:tenant AND user_id=$1 AND client_request_id=$2', [client.id, body.id]))[0]);
          // The demand is already durable. Serverless functions freeze after the response, so send the
          // notification now (bounded) instead of in the background; failures stay queued for retry.
          if (inserted.length) await withTimeout(pump(request.id), Number(env.PUSH_WAIT_MS) || 8000);
          return json(201, publicRow(stored, false));
        }
        if (url.pathname === '/api/requests' && req.method === 'GET') {
          admin();
          void pump();
          // Newest first. Default: the newest 500 (a few hundred KB at most instead of every request ever made); ?limit= (max 2000) and ?before=<createdAt> page further back.
          const limit = Math.max(1, Math.min(2000, Number(url.searchParams.get('limit')) || 500)), before = Number(url.searchParams.get('before')) || null;
          const rows = before ? await db.query('SELECT data FROM requests WHERE tenant_id=:tenant AND created_at<$1 ORDER BY created_at DESC LIMIT $2', [before, limit]) : await db.query('SELECT data FROM requests WHERE tenant_id=:tenant ORDER BY created_at DESC LIMIT $1', [limit]);
          return json(200, rows.map(row => publicRow(rowOf(row))));
        }
        const match = url.pathname.match(/^\/api\/requests\/([A-Za-z0-9_-]+)$/);
        if (match) {
          const found = (await db.query('SELECT data FROM requests WHERE tenant_id=:tenant AND id=$1', [match[1]]))[0];
          const request = found && rowOf(found);
          if (!request || (!session && (!client || request.userId !== client.id))) throw fail(404, 'Not found');
          if (req.method === 'GET') return json(200, publicRow(request, !!session));
          if (req.method === 'DELETE') { admin(); await db.query('DELETE FROM outbox WHERE tenant_id=:tenant AND request_id=$1', [request.id]); await db.query('DELETE FROM requests WHERE tenant_id=:tenant AND id=$1', [request.id]); await sync.bump('requests', ...touch(request.userId, 'requests')); return json(200, { ok: true }); }
          if (req.method === 'PATCH') {
            const body = await readBody(req), patch = {};
            const fields = session ? ['status', 'autoSent', 'aiResult', 'finalResult', 'historyId'] : ['aiResult', 'historyId'];
            for (const field of fields) if (body[field] != null) {
              if (field === 'status') { if (!['pending', 'processing', 'delivered'].includes(body[field])) throw fail(400, 'Invalid status'); patch[field] = body[field]; }
              else if (field === 'autoSent') { if (typeof body[field] !== 'boolean') throw fail(400, 'Invalid value'); patch[field] = body[field]; }
              else { if (typeof body[field] !== 'string' || body[field].length > 3000000) throw fail(400, 'Invalid value'); patch[field] = body[field]; }
            }
            // AI results and final designs (data URLs or provider/CDN URLs) are copied into media storage.
            Object.assign(patch, (await media.externalize(patch, { remote: 'report', svg: false })).value);
            // The client's own auto-send workflow may only mark its own completed render.
            if (!session && body.status === 'delivered' && body.autoSent === true && body.aiResult) { patch.status = 'delivered'; patch.autoSent = true; }
            let wasDelivered = false;
            const result = await db.tx(async q => {
              const current = rowOf((await q('SELECT data FROM requests WHERE tenant_id=:tenant AND id=$1 FOR UPDATE', [request.id]))[0]);
              wasDelivered = current.status === 'delivered';
              const next = Object.assign(current, patch);
              await q('UPDATE requests SET data=$1 WHERE tenant_id=:tenant AND id=$2', [JSON.stringify(next), request.id]);
              return next;
            });
            await sync.bump('requests', ...touch(result.userId, 'requests', 'history'));
            // The admin delivered the final design: tell its owner on every device they enabled notifications on.
            if (session && result.status === 'delivered' && !wasDelivered) {
              await enqueue('ready', `ready:${result.id}`, { id: result.id, name: result.name, whatsapp: result.whatsapp, audience: { type: 'client', id: result.userId } });
              await withTimeout(pump(`ready:${result.id}`), Number(env.PUSH_WAIT_MS) || 8000);
            }
            if (result.status === 'delivered' && result.historyId && (result.finalResult || result.aiResult)) {
              const owner = await clients.user(result.userId);
              const item = owner && result.historyId && (await clients.getSpaceItem(owner, 'history', result.historyId));
              if (item) await clients.putSpace(owner, 'history', { ...item, after: result.finalResult || result.aiResult, status: 'done' }, item.id);
            }
            return json(200, publicRow(result, !!session));
          }
        }
        throw fail(404, 'API route not found');
      }
      // Same-origin static hosting of dist/ for the long-running server (Vercel serves dist/ itself). Same rules as vercel.json.
      // A custom domain installs its own app: the root manifest answers with the tenant's name instead of the static default one.
      if (url.pathname === '/manifest.webmanifest' && req.method === 'GET' && resolved.tenant.id !== 'default') return json(200, tenantManifest(resolved), MANIFEST_HEADERS);
      return staticFiles.handle(req, res, url);
    } catch (error) {
      if (!error.status) console.warn('API error', error.code || error.message);
      // An unknown / suspended tenant asked for a PAGE: a plain page, nothing about the tenant's data.
      if (error.page && !res.headersSent) {
        const suspended = error.code === 'TENANT_SUSPENDED';
        res.writeHead(suspended ? 503 : 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(suspended ? 'This site is temporarily unavailable.' : 'Not found');
      }
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Server error', ...(error.code === 'TENANT_SUSPENDED' || error.code === 'TENANT_NOT_FOUND' ? { code: error.code } : {}) }); else res.end();
    }
  }
  const server = http.createServer(handle);
  server.requestTimeout = 30000;
  /*
   * Background work of the long-running server: notification retries and the campaign scheduler. Every
   * BACKGROUND_INTERVAL_MS (default 30 s) while the app is in use (an API request in the last 5 minutes), every
   * BACKGROUND_IDLE_MS (default 5 minutes) otherwise, so an idle site stops querying the database every few seconds and
   * Neon can suspend. Scheduled campaigns therefore start at most ~5 minutes late when nobody has the app open; a host cron
   * calling /api/push/pump (docs/HOSTINGER.md) makes them exact.
   */
  const activeEvery = Math.max(5000, Number(env.BACKGROUND_INTERVAL_MS) || 30000);
  const idleEvery = Math.max(activeEvery, Number(env.BACKGROUND_IDLE_MS) || 300000);
  let lastRunAt = 0, closed = false;
  const timer = setInterval(() => {
    if (!db.configured() || !isReady()) return;
    const now = Date.now();
    if (now - lastRunAt < (now - lastApiAt < 300000 ? activeEvery : idleEvery) - 1000) return;
    lastRunAt = now;
    // Every tenant that has work due (a notification job, a live campaign), one after the other so a busy platform never opens a burst of connections.
    void (async () => {
      for (const id of await bundles.dueTenants(now)) {
        if (closed) return;
        const target = bundles.get(id);
        await target.pump();
        if (!closed) await target.campaigns.tick();
      }
    })().catch(() => {});
  }, Math.min(activeEvery, 15000));
  timer.unref();
  server.on('close', () => { closed = true; clearInterval(timer); void db.close(); });
  return { server, handle, pump: base.pump, db, clients, notifier, campaigns, chat, assistant, staticFiles, bundles, tenants, superAdmin };
}
module.exports = { createBackend, passwordMatches };
// `node server/index.js` keeps working (README, browser checks): same startup as server/start.js.
if (require.main === module) require('./start'); // loading start.js starts the server
