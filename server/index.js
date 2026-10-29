const http = require('node:http');
const path = require('node:path');
const { isIP } = require('node:net');
const crypto = require('node:crypto');
const { createDb } = require('./db');
const { sendBuffer } = require('./compress');
const { createClients } = require('./clients');
const { createSync } = require('./sync');
const { createContent } = require('./content');
const { r2Status } = require('./media');
const { translate } = require('./translate');
const { createNotifier, validateSubscription, trim, phone } = require('./notifications');
const { createCampaigns, cleanCampaign } = require('./campaigns');
const { createChat } = require('./chat');
const { createStatic } = require('./static');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
function passwordMatches(password, encoded) {
  const [salt, digest] = String(encoded || '').split(':');
  if (!salt || !digest || !/^[a-f0-9]{128}$/.test(digest)) return false;
  return crypto.timingSafeEqual(crypto.scryptSync(String(password), salt, 64), Buffer.from(digest, 'hex'));
}
// Built-in default admin login (admin / admin) unless DISABLE_DEFAULT_ADMIN=true. ADMIN_EMAIL / ADMIN_PASSWORD_HASH work in addition.
/** Returns the stable admin identity (preferences and notification devices are stored per admin) or null. */
function adminIdentity(env, email, password) {
  const user = email.trim().toLowerCase();
  if (env.DISABLE_DEFAULT_ADMIN !== 'true' && user === 'admin' && password === 'admin') return 'admin';
  return !!env.ADMIN_EMAIL && user === env.ADMIN_EMAIL.toLowerCase() && passwordMatches(password, env.ADMIN_PASSWORD_HASH) ? user : null;
}
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
  if (typeof value.photoUri !== 'string' || value.photoUri.length > 3000000 || !/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/|\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+$)/.test(value.photoUri)) throw fail(400, 'Invalid photo');
  const draft = {};
  for (const key of ['toolId', 'roomTypeId', 'styleId', 'paletteId', 'modelId', 'mode']) {
    if (value.draft?.[key] != null) {
      if (typeof value.draft[key] !== 'string' || value.draft[key].length > 100) throw fail(400, 'Invalid draft');
      draft[key] = value.draft[key];
    }
  }
  if (!draft.toolId) throw fail(400, 'Tool required');
  return { name, whatsapp, draft, photoUri: value.photoUri, userId: trim(value.userId || 'client', 100), status: 'pending', createdAt: Date.now() };
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
  value.messages = [...sent, ...kept].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return sent.filter(m => m.role === 'user' && !known.has(m.id));
}
const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(resolve, ms))]);

/** `media` (tests): { storage, download } overrides for the R2 adapter and the external downloader. */
function createBackend({ env = process.env, db = createDb(env), senders, media: mediaOptions = {}, translator = translate, chatFetch } = {}) {
  const notifier = createNotifier(db, env, senders, { settings: () => content.getDoc('settings') });
  const clients = createClients(db);
  // Long-running server: anonymous polls are answered from a 2 s in-memory copy of the versions (local writes invalidate it at once).
  // Serverless instances keep no cache: each one only sees a fraction of the writes.
  const sync = createSync(db, { cacheMs: env.VERCEL ? 0 : Math.max(0, Math.min(10000, Number(env.SYNC_CACHE_MS ?? 2000) || 0)) });
  const content = createContent(db, sync, { env, ...mediaOptions });
  const media = content.media;
  // Campaigns (scheduled / recurring / automated pushes) and the free-provider AI chat. Both are lazy: no work until used.
  const campaigns = createCampaigns(db, notifier, { sync, settings: () => content.getDoc('settings') });
  const chat = createChat(db, { env, ...(chatFetch ? { fetch: chatFetch } : {}) });
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
  const publicRow = ({ clientHash: ignored, clientRequestId: ignored2, ...row }) => row;

  /** Queue a notification. `kind`: request (new demand -> admins) | lead (new client -> admins) | ready (design delivered -> its owner). */
  async function enqueue(kind, jobId, payload) {
    await db.query('INSERT INTO outbox(request_id,attempts,next_at,completed,kind,payload) VALUES($1,0,$2,$3,$4,$5) ON CONFLICT (request_id) DO NOTHING', [jobId, Date.now(), '[]', kind, payload ? JSON.stringify(payload) : null]);
  }
  /** Deliver due notification jobs. A short lease stops concurrent instances sending the same job twice. */
  async function pump(only) {
    try {
      const now = Date.now();
      const due = await db.query(only ? 'SELECT * FROM outbox WHERE request_id=$1 AND next_at<=$2' : 'SELECT * FROM outbox WHERE next_at<=$1 ORDER BY next_at LIMIT 20', only ? [only, now] : [now]);
      for (const job of due) {
        const leased = await db.query('UPDATE outbox SET next_at=$1 WHERE request_id=$2 AND next_at=$3 RETURNING request_id', [now + 60000, job.request_id, job.next_at]);
        if (!leased.length) continue;
        let item, options;
        if (job.kind === 'request') {
          const demand = (await db.query('SELECT data FROM requests WHERE id=$1', [job.request_id]))[0];
          if (demand) { item = rowOf(demand); options = { event: 'request' }; }
        } else {
          const payload = JSON.parse(job.payload || 'null');
          if (payload) { item = payload; options = { event: job.kind, ...(payload.audience ? { audience: payload.audience } : {}) }; }
        }
        if (!item) { await db.query('DELETE FROM outbox WHERE request_id=$1', [job.request_id]); continue; }
        try {
          const result = await notifier.deliver(item, JSON.parse(job.completed), options);
          if (!result.retry || job.attempts >= 6) await db.query('DELETE FROM outbox WHERE request_id=$1', [job.request_id]);
          else await db.query('UPDATE outbox SET completed=$1, attempts=attempts+1, next_at=$2 WHERE request_id=$3', [JSON.stringify(result.completed), Date.now() + Math.min(3600000, 30000 * 2 ** (job.attempts + 1)), job.request_id]);
        } catch { console.warn('Notification job deferred'); }
      }
    } catch { console.warn('Notification queue temporarily unavailable'); }
  }

  async function handle(req, res) {
    const origin = req.headers.origin;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    const json = (status, value, extra) => sendBuffer(req, res, status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra }, Buffer.from(JSON.stringify(value)));
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        lastApiAt = Date.now();
        // Same-origin needs no configuration; other origins need an explicit allowlist.
        const sameOrigin = origin && /^https?:\/\//.test(origin) && new URL(origin).host === req.headers.host;
        if (origin && !sameOrigin && !allowedOrigins.includes(origin)) throw fail(403, 'Origin not allowed');
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Vary', 'Origin'); }
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Demand-Token, X-Dwira-Native, X-User-Token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
        // Media (images and videos): stable content-addressed /api/media/<hash>.<ext> URLs. Files stored in R2 are a redirect
        // to the public R2 URL (bytes never pass through the function); the database fallback serves the bytes, cached forever.
        // Served before rate limiting: one Home screen can show dozens of them.
        if (url.pathname.startsWith('/api/media/') && (req.method === 'GET' || req.method === 'HEAD')) {
          if (!db.configured()) throw fail(503, 'DATABASE_NOT_CONFIGURED');
          await content.ensureSeed();
          const file = await media.readMedia(url.pathname.slice('/api/media/'.length));
          if (!file) throw fail(404, 'NOT_FOUND');
          // The target never changes for a name, but a day-long cache lets a change of R2_PUBLIC_BASE_URL take effect.
          if (file.redirect) { res.writeHead(302, { Location: file.redirect, 'Cache-Control': 'public, max-age=86400, s-maxage=86400' }); return res.end(); }
          return sendBuffer(req, res, 200, { 'Content-Type': file.mime, 'Cache-Control': 'public, max-age=31536000, s-maxage=31536000, immutable', ...(file.mime === 'image/svg+xml' ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}) }, file.body);
        }
        const bucketName = url.pathname === '/api/admin/login' ? 'login' : url.pathname === '/api/sync' ? 'sync' : url.pathname === '/api/chat/reply' ? 'chat' : 'api';
        const key = `${address(req)}:${bucketName}`;
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

        const rawCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_admin='))?.slice(12);
        const sessionToken = req.headers.authorization?.replace(/^Bearer /, '') || rawCookie;

        // Public content: no session, no client lookup. Only a request that carries an admin credential (or says it is an
        // admin panel request with ?a=1) pays for the session query, because only admins may see provider API keys.
        if (url.pathname === '/api/content' && req.method === 'GET') {
          const adminAsked = !!sessionToken || url.searchParams.has('a');
          const admin = !!sessionToken && !!(await db.query('SELECT 1 FROM admin_sessions WHERE token_hash=$1 AND expires_at>$2', [hash(sessionToken), now]))[0];
          const snapshot = await content.snapshot(admin);
          // The shared CDN may keep the PUBLIC copy briefly (CONTENT_S_MAXAGE seconds, default 30, 0 disables) and serve a stale one while it
          // refreshes in the background, so visitors rarely wait on a database that may be waking up. Browsers always revalidate
          // (max-age=0). Admin copies (which contain secrets) and admin-panel requests are never stored. Edits stay visible quickly:
          // /api/sync bumps the content version and the app then asks for /api/content?v=<version>, a distinct cache key.
          const maxAge = Math.max(0, Math.min(300, Number(env.CONTENT_S_MAXAGE ?? 30) || 0));
          const cacheable = !adminAsked && maxAge > 0;
          return json(200, snapshot, { 'Cache-Control': cacheable ? `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 10}` : 'private, no-store' });
        }

        const session = sessionToken && (await db.query('SELECT token_hash,admin_id FROM admin_sessions WHERE token_hash=$1 AND expires_at>$2', [hash(sessionToken), now]))[0];
        const adminId = session?.admin_id;
        const admin = () => { if (!session) throw fail(401, 'Admin login required'); };
        const clientToken = req.headers['x-demand-token'];
        const clientHash = typeof clientToken === 'string' && /^[a-f0-9]{64}$/.test(clientToken) ? hash(clientToken) : null;
        const userCookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('dwira_user='))?.slice(11);
        const userToken = req.headers['x-user-token'] || userCookie;
        const client = await clients.authenticate(userToken);
        const requireUser = () => { if (!client) throw fail(401, 'USER_LOGIN_REQUIRED'); if (client.blocked) throw fail(403, 'ACCOUNT_BLOCKED'); return client; };
        const cookie = (name, token, age) => `${name}=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${age}${env.COOKIE_SECURE === 'false' ? '' : '; Secure'}`;

        // ---- Client accounts ----
        if (url.pathname === '/api/user/login' && req.method === 'POST') {
          const body = await readBody(req);
          const result = await clients.login(body.name, body.phone, (await content.getDoc('settings')).defaultFreeCredits);
          res.setHeader('Set-Cookie', cookie('dwira_user', result.token, 365 * 86400));
          // Chats this device held as a visitor now belong to the person who just signed in.
          if (clientHash && (await clients.adoptGuest(clientHash, result.user)).length) await sync.bump(`c:${result.user.id}`, 'chats', `g:${clientHash}`);
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
          const keys = ['content', ...(session ? ['requests', 'clients', 'chats', 'campaigns', `a:${adminId}`] : []), ...(client ? [`c:${client.id}`] : []), ...(clientHash && !client ? [`g:${clientHash}`] : [])];
          const versions = await sync.read(keys);
          if (env.VERCEL) {
            // Serverless has no background timer (cron is only daily): any open app retries failed notifications and drives
            // scheduled / recurring / automated campaigns (cross-instance throttled to one run per 10 s).
            const waiting = (await db.query('SELECT 1 FROM outbox WHERE next_at<=$1 LIMIT 1', [now]))[0];
            if (waiting) await withTimeout(pump(), 9000);
            await withTimeout(campaigns.tick({ budgetMs: 6000 }), 8000);
          }
          // Long-running server: the background timer below does both, so a poll costs only the version read.
          return json(200, { content: versions.content, campaigns: session ? versions.campaigns : null, requests: session ? versions.requests : null, clients: session ? versions.clients : null, chats: session ? versions.chats : null, admin: session ? versions[`a:${adminId}`] : null, client: client ? versions[`c:${client.id}`] : null, guest: clientHash && !client ? versions[`g:${clientHash}`] : null, user: client ? { id: client.id, blocked: !!client.blocked } : null, isAdmin: !!session });
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
          await sync.bump(`c:${client.id}`, 'clients');
          return json(200, { user: claimed });
        }
        if (url.pathname === '/api/user/requests' && req.method === 'GET') {
          requireUser();
          return json(200, (await db.query('SELECT data FROM requests WHERE user_id=$1 ORDER BY created_at DESC', [client.id])).map(row => publicRow(rowOf(row))));
        }
        // ---- Visitors: assistant chats without an account or any personal detail, stored under the device token ----
        const guestChat = url.pathname.match(/^\/api\/guest\/conversations(?:\/([A-Za-z0-9_-]{1,100}))?$/);
        if (guestChat) {
          if (client) throw fail(409, 'ALREADY_SIGNED_IN'); // a signed-in person uses /api/user/conversations
          if (!clientHash) throw fail(400, 'Client token required');
          const id = guestChat[1];
          if (req.method === 'GET') {
            const rows = await clients.guestList(clientHash);
            if (!id) return json(200, rows);
            const row = rows.find(row => row.id === id);
            if (!row) throw fail(404, 'NOT_FOUND');
            return json(200, row);
          }
          if (req.method === 'DELETE' && id) { await clients.guestRemove(clientHash, id); await sync.bump('chats', `g:${clientHash}`); return json(200, { ok: true }); }
          if (req.method === 'POST' || req.method === 'PATCH' && id) {
            const body = await readBody(req);
            const existing = id && (await clients.guestList(clientHash)).find(row => row.id === id);
            if (id && !existing) throw fail(404, 'NOT_FOUND');
            const value = { ...existing, ...(await media.externalize(body, { remote: 'report', svg: false })).value };
            const fresh = mergeConversation(value, existing);
            const saved = await clients.guestPut(clientHash, value, id || crypto.randomUUID());
            await sync.bump('chats', `g:${clientHash}`);
            if (fresh.length) {
              const last = fresh[fresh.length - 1], jobId = `chat:${saved.id}:${last.id}`;
              await enqueue('chat', jobId, { id: saved.id, name: '', whatsapp: '', text: last.text });
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
            const rows = await clients.listSpace(client, kind);
            if (!id) return json(200, rows);
            const row = rows.find(row => row.id === id);
            if (!row) throw fail(404, 'NOT_FOUND');
            return json(200, row);
          }
          if (req.method === 'DELETE' && id) { await clients.removeSpace(client, kind, id); await sync.bump(`c:${client.id}`, 'clients'); return json(200, { ok: true }); }
          if (req.method === 'POST' || req.method === 'PATCH' && id) {
            const body = await readBody(req);
            const existing = id && (await clients.listSpace(client, kind)).find(row => row.id === id);
            if (id && !existing) throw fail(404, 'NOT_FOUND');
            if (req.method === 'POST' && kind === 'history' && !(await clients.hasClaim(body.claimId, client.id))) throw fail(403, 'CLAIM_REQUIRED');
            // Inline uploads (data URLs) and external pictures go to media storage; a failed download keeps the URL so a design is never lost.
            const value = { ...existing, ...(await media.externalize(body, { remote: 'report', svg: false })).value };
            if (kind === 'history' && (!value.draft?.toolId || typeof value.before !== 'string' || !['pending', 'done'].includes(value.status))) throw fail(400, 'INVALID_HISTORY');
            const fresh = kind === 'conversations' ? mergeConversation(value, existing) : [];
            const saved = await clients.putSpace(client, kind, value, id || (kind === 'history' ? body.claimId : crypto.randomUUID()));
            await sync.bump(`c:${client.id}`, 'clients');
            if (fresh.length) {
              // Tell the admins about the newest message; the link opens exactly this conversation.
              const last = fresh[fresh.length - 1], jobId = `chat:${saved.id}:${last.id}`;
              await enqueue('chat', jobId, { id: saved.id, name: client.name, whatsapp: client.whatsapp, text: last.text });
              await sync.bump('chats');
              await withTimeout(pump(jobId), Number(env.PUSH_WAIT_MS) || 8000);
            }
            return json(200, saved);
          }
          throw fail(405, 'Method not allowed');
        }

        // ---- Admin ----
        if (url.pathname === '/api/admin/clients' && req.method === 'GET') { admin(); return json(200, await clients.users()); }
        if (url.pathname === '/api/admin/conversations' && req.method === 'GET') { admin(); return json(200, await clients.adminConversations()); }
        const adminChat = url.pathname.match(/^\/api\/admin\/conversations\/([A-Za-z0-9_-]{1,100})$/);
        if (adminChat && req.method === 'POST') {
          admin();
          const body = await readBody(req), text = typeof body.text === 'string' ? body.text.trim() : '';
          if (!text || text.length > 4000) throw fail(400, 'INVALID_MESSAGE');
          const message = { id: `a_${crypto.randomUUID()}`, role: 'admin', text, createdAt: Date.now() };
          const { conversation, clientId, deviceHash } = await clients.adminReply(adminChat[1], text, message);
          // A visitor has no account to notify: their open chat picks the answer up through the sync loop.
          if (!clientId) { await sync.bump('chats', `g:${deviceHash}`); return json(200, conversation); }
          await sync.bump(`c:${clientId}`, 'chats');
          const jobId = `reply:${conversation.id}:${message.id}`;
          await enqueue('reply', jobId, { id: conversation.id, text, audience: { type: 'client', id: clientId } });
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
          return json(200, await chat.reply(body.messages, config));
        }
        if (url.pathname === '/api/admin/chat/status' && req.method === 'GET') { admin(); return json(200, await chat.status()); }
        if (url.pathname === '/api/admin/chat/keys' && req.method === 'PATCH') { admin(); return json(200, await chat.setKeys(await readBody(req))); }
        if (url.pathname === '/api/admin/clients/bulk' && req.method === 'POST') {
          admin();
          const body = await readBody(req), result = await clients.bulk(body);
          if (body.action === 'delete') for (const id of body.ids) await notifier.removeOwner('client', id);
          await sync.bump('clients', 'requests', ...(Array.isArray(body.ids) ? body.ids.map(id => `c:${id}`) : []));
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
          await sync.bump('clients', 'requests', `c:${creditClient[1]}`);
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
          const identity = typeof body.email === 'string' && typeof body.password === 'string' && body.password.length <= 512 ? adminIdentity(env, body.email, body.password) : null;
          if (!identity) throw fail(401, 'Invalid credentials');
          const token = crypto.randomBytes(32).toString('hex');
          await db.query('DELETE FROM admin_sessions WHERE expires_at<=$1', [now]);
          await db.query('INSERT INTO admin_sessions(token_hash,expires_at,admin_id) VALUES($1,$2,$3)', [hash(token), now + 7 * 86400000, identity]);
          res.setHeader('Set-Cookie', cookie('dwira_admin', token, 604800));
          return json(200, { ok: true, user: { id: 'usr_admin', name: 'Admin' }, ...(req.headers['x-dwira-native'] === '1' ? { token } : {}) });
        }
        if (req.method === 'GET' && url.pathname === '/api/admin/session') { admin(); return json(200, { ok: true, prefs: await content.adminPrefs(adminId) }); }
        if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
          if (session) await db.query('DELETE FROM admin_sessions WHERE token_hash=$1', [session.token_hash]);
          res.setHeader('Set-Cookie', cookie('dwira_admin', '', 0));
          return json(200, { ok: true });
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
          if (!session && !(env.CRON_SECRET && req.headers.authorization === `Bearer ${env.CRON_SECRET}`)) throw fail(401, 'Admin login required');
          await withTimeout(pump(), 25000);
          const ran = await withTimeout(campaigns.tick({ force: true, budgetMs: 20000 }), 25000);
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
          const known = (await db.query('SELECT 1 FROM requests WHERE user_id=$1 AND client_request_id=$2', [client.id, body.id]))[0];
          if (!known) input.photoUri = (await media.externalize({ photoUri: input.photoUri }, { remote: 'report', svg: false })).value.photoUri;
          const request = { ...input, id: crypto.randomUUID(), clientHash, clientRequestId: body.id };
          const inserted = await db.query('INSERT INTO requests(id,user_id,client_request_id,created_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id, client_request_id) DO NOTHING RETURNING id', [request.id, client.id, body.id, request.createdAt, JSON.stringify(request)]);
          if (inserted.length) { await enqueue('request', request.id); await sync.bump('requests', 'clients', `c:${client.id}`); }
          const stored = rowOf((await db.query('SELECT data FROM requests WHERE user_id=$1 AND client_request_id=$2', [client.id, body.id]))[0]);
          // The demand is already durable. Serverless functions freeze after the response, so send the
          // notification now (bounded) instead of in the background; failures stay queued for retry.
          if (inserted.length) await withTimeout(pump(request.id), Number(env.PUSH_WAIT_MS) || 8000);
          return json(201, publicRow(stored));
        }
        if (url.pathname === '/api/requests' && req.method === 'GET') {
          admin();
          void pump();
          return json(200, (await db.query('SELECT data FROM requests ORDER BY created_at DESC')).map(row => publicRow(rowOf(row))));
        }
        const match = url.pathname.match(/^\/api\/requests\/([A-Za-z0-9_-]+)$/);
        if (match) {
          const found = (await db.query('SELECT data FROM requests WHERE id=$1', [match[1]]))[0];
          const request = found && rowOf(found);
          if (!request || (!session && (!client || request.userId !== client.id))) throw fail(404, 'Not found');
          if (req.method === 'GET') return json(200, publicRow(request));
          if (req.method === 'DELETE') { admin(); await db.query('DELETE FROM outbox WHERE request_id=$1', [request.id]); await db.query('DELETE FROM requests WHERE id=$1', [request.id]); await sync.bump('requests', `c:${request.userId}`); return json(200, { ok: true }); }
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
              const current = rowOf((await q('SELECT data FROM requests WHERE id=$1 FOR UPDATE', [request.id]))[0]);
              wasDelivered = current.status === 'delivered';
              const next = Object.assign(current, patch);
              await q('UPDATE requests SET data=$1 WHERE id=$2', [JSON.stringify(next), request.id]);
              return next;
            });
            await sync.bump('requests', `c:${result.userId}`);
            // The admin delivered the final design: tell its owner on every device they enabled notifications on.
            if (session && result.status === 'delivered' && !wasDelivered) {
              await enqueue('ready', `ready:${result.id}`, { id: result.id, name: result.name, whatsapp: result.whatsapp, audience: { type: 'client', id: result.userId } });
              await withTimeout(pump(`ready:${result.id}`), Number(env.PUSH_WAIT_MS) || 8000);
            }
            if (result.status === 'delivered' && result.historyId && (result.finalResult || result.aiResult)) {
              const owner = await clients.user(result.userId);
              const item = owner && (await clients.listSpace(owner, 'history')).find(row => row.id === result.historyId);
              if (item) await clients.putSpace(owner, 'history', { ...item, after: result.finalResult || result.aiResult, status: 'done' }, item.id);
            }
            return json(200, publicRow(result));
          }
        }
        throw fail(404, 'API route not found');
      }
      // Same-origin static hosting of dist/ for the long-running server (Vercel serves dist/ itself). Same rules as vercel.json.
      return staticFiles.handle(req, res, url);
    } catch (error) {
      if (!error.status) console.warn('API error', error.code || error.message);
      if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Server error' }); else res.end();
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
    if (!db.configured()) return;
    const now = Date.now();
    if (now - lastRunAt < (now - lastApiAt < 300000 ? activeEvery : idleEvery) - 1000) return;
    lastRunAt = now;
    void pump().then(() => (closed ? null : campaigns.tick()));
  }, Math.min(activeEvery, 15000));
  timer.unref();
  server.on('close', () => { closed = true; clearInterval(timer); void db.close(); });
  return { server, handle, pump, db, clients, notifier, campaigns, chat, staticFiles };
}
module.exports = { createBackend, passwordMatches };
// `node server/index.js` keeps working (README, browser checks): same startup as server/start.js.
if (require.main === module) require('./start').start();
