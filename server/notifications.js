const crypto = require('node:crypto');
const webpush = require('web-push');
const TEXT = {
  en: { guest: 'Visitor', title: 'New demand', lead: 'New lead', ready: 'Your design is ready', readyBody: 'Open the app to see it.', open: 'Open', call: 'Call', chat: 'New message', reply: 'New reply', replyBody: 'Open the chat to read it.' },
  fr: { guest: 'Visiteur', title: 'Nouvelle demande', lead: 'Nouveau client', ready: 'Votre design est prêt', readyBody: 'Ouvrez l’app pour le voir.', open: 'Ouvrir', call: 'Appeler', chat: 'Nouveau message', reply: 'Nouvelle réponse', replyBody: 'Ouvrez la conversation pour la lire.' },
  ar: { guest: 'زائر', title: 'طلب جديد', lead: 'عميل جديد', ready: 'تصميمك جاهز', readyBody: 'افتح التطبيق لمشاهدته.', open: 'فتح', call: 'اتصال', chat: 'رسالة جديدة', reply: 'رد جديد', replyBody: 'افتح المحادثة لقراءته.' },
  dar: { guest: 'زائر', title: 'طلب جديد', lead: 'كليون جديد', ready: 'التصميم ديالك واجد', readyBody: 'حل التطبيق باش تشوفو.', open: 'فتح', call: 'اتصال', chat: 'ميساج جديد', reply: 'جواب جديد', replyBody: 'حل المحادثة باش تقراه.' },
};
const trim = (value, max) => Array.from(String(value ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim()).slice(0, max).join('');
const phone = value => trim(value, 32).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
const locale = value => Object.hasOwn(TEXT, value) ? value : 'en';
/** Pages a campaign notification may open (everything else falls back to Home): public app pages and one tool. */
const CAMPAIGN_URL = /^\/(?:(?:explore|assistant|history|pro|settings|tool\/[A-Za-z0-9_-]{1,100}))?$/;
const PICK = { dar: ['dar', 'ar', 'fr'], ar: ['ar', 'dar', 'fr'], fr: ['fr', 'ar', 'dar'], en: ['fr', 'ar', 'dar'] };
/** `{name}` becomes the client's first name; with no name the token and the space before punctuation disappear. */
const personalize = (text, name) => {
  const first = trim(name, 60).split(/\s+/)[0] || '';
  return text.replace(/\{name\}/gi, first).replace(/\s{2,}/g, ' ').replace(/\s+([,!?،؟.:])/g, '$1').trim();
};
const pickText = (value, lang) => (PICK[lang] || PICK.fr).map(key => trim(value?.[key], 400)).find(Boolean) || '';
/** event: 'request' (new render request, to admins) | 'lead' (new client account, to admins) | 'chat' (client message, to admins) | 'ready' (design delivered, to its owner) | 'reply' (admin chat reply, to its owner). */
function payloadFor(request, language, event = 'request') {
  const lang = locale(language), text = TEXT[lang], dir = lang === 'ar' || lang === 'dar' ? 'rtl' : 'ltr';
  // Campaign (admin-authored message to clients): text per language, `{name}` personalisation, link restricted to public app pages.
  if (event === 'campaign') {
    return {
      title: personalize(pickText(request.title, lang), request.name).slice(0, 120), body: personalize(pickText(request.body, lang), request.name).slice(0, 220),
      requestId: `campaign-${String(request.id).slice(0, 80)}`, phone: '', lang, dir,
      url: CAMPAIGN_URL.test(request.url || '') ? request.url : '/', actions: [{ action: 'open', title: text.open }],
    };
  }
  // Assistant chat: a client wrote (-> admins, opens that conversation) or an admin replied (-> the client, opens the chat).
  if (event === 'reply') return { title: text.reply, body: trim(request.text, 120) || (request.audio ? '🎤' : text.replyBody), requestId: String(request.id), phone: '', lang, dir, url: `/chat/${encodeURIComponent(request.id)}`, actions: [{ action: 'open', title: text.open }] };
  if (event === 'chat') {
    const preview = trim(request.text, 100) || (request.audio ? '🎤' : '📷');
    return { title: text.chat, body: `${trim(request.name, 60) || text.guest}: ${preview}`, requestId: String(request.id), phone: phone(request.whatsapp), lang, dir, url: `/admin/chats?target=${encodeURIComponent(request.id)}&open=${encodeURIComponent(request.id)}`, actions: [{ action: 'open', title: text.open }, { action: 'call', title: text.call }] };
  }
  if (event === 'ready') return { title: text.ready, body: text.readyBody, requestId: String(request.id), phone: '', lang, dir, url: '/history', actions: [{ action: 'open', title: text.open }] };
  const base = { body: `${trim(request.name, 80)} - ${phone(request.whatsapp)}`, requestId: String(request.id), phone: phone(request.whatsapp), lang, dir, actions: [{ action: 'open', title: text.open }, { action: 'call', title: text.call }] };
  if (event === 'lead') return { ...base, title: text.lead, url: `/admin/users?target=${encodeURIComponent(request.id)}` };
  return { ...base, title: text.title, url: `/admin/requests?target=${encodeURIComponent(request.id)}&open=${encodeURIComponent(request.id)}` };
}
function validateSubscription(input) {
  const lang = locale(input?.language);
  if (input?.kind === 'fcm') {
    const token = input.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 4096 || !/^[A-Za-z0-9_:\-]+$/.test(token)) throw new Error('Invalid FCM token');
    return { id: crypto.createHash('sha256').update(token).digest('hex'), kind: 'fcm', token, language: lang };
  }
  const value = input?.subscription;
  let endpoint;
  try { endpoint = new URL(value.endpoint); } catch { throw new Error('Invalid subscription'); }
  // Restrict outgoing requests to the browsers' push services (prevents SSRF).
  const allowed = host => ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(host)
    || host.endsWith('.push.services.mozilla.com') || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (endpoint.protocol !== 'https:' || !allowed(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.port || endpoint.href.length > 2048) throw new Error('Invalid push provider');
  const keys = value.keys;
  if (!keys || !['p256dh', 'auth'].every(key => typeof keys[key] === 'string' && /^[A-Za-z0-9_-]+$/.test(keys[key]))) throw new Error('Invalid keys');
  if (Buffer.from(keys.p256dh, 'base64url').length !== 65 || Buffer.from(keys.auth, 'base64url').length !== 16) throw new Error('Invalid key length');
  return { id: crypto.createHash('sha256').update(endpoint.href).digest('hex'), kind: 'web', subscription: { endpoint: endpoint.href, keys: { p256dh: keys.p256dh, auth: keys.auth } }, language: lang };
}

/** FCM HTTP v1 without firebase-admin: service-account JWT -> OAuth token -> REST send. */
function createFcm(json, fetchImpl = fetch) {
  let account, cached;
  const parse = () => account ||= JSON.parse(json);
  async function accessToken() {
    if (cached && cached.expires > Date.now() + 60000) return cached.token;
    const key = parse(), now = Math.floor(Date.now() / 1000);
    const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3300 })}`;
    const assertion = `${unsigned}.${crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')}`;
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
    if (!response.ok) throw Object.assign(new Error('FCM auth failed'), { statusCode: response.status });
    const body = await response.json();
    cached = { token: body.access_token, expires: Date.now() + (body.expires_in || 3300) * 1000 };
    return cached.token;
  }
  return async (token, payload) => {
    const response = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${parse().project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: payload.title, body: payload.body },
        data: { url: payload.url, phone: payload.phone, requestId: payload.requestId, categoryId: 'demands', language: payload.lang },
        android: { priority: 'HIGH', ttl: '86400s', notification: { channel_id: 'demands', tag: payload.requestId } } } }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const status = body.error?.details?.find(detail => detail.errorCode)?.errorCode || body.error?.status;
      throw Object.assign(new Error('FCM send failed'), { statusCode: response.status, code: status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' ? 'messaging/registration-token-not-registered' : status });
    }
  };
}

/**
 * VAPID keys come from the environment when provided. Otherwise they are generated once and stored in the
 * database so the "Notifications" button works on a fresh deployment with zero configuration.
 */
async function loadVapid(db, env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
  const read = async () => (await db.query("SELECT value FROM settings WHERE key='vapid'"))[0];
  let row = await read();
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    await db.query("INSERT INTO settings VALUES('vapid',$1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(keys)]);
    row = await read(); // a concurrent cold start may have won the race: always use the stored winner
  }
  const keys = JSON.parse(row.value);
  return { ...keys, subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
}

/**
 * `options.settings()` returns the shared settings document. Two independent master switches live there:
 * `notifyAdmins` and `notifyUsers` (both on unless explicitly false). Every delivery path goes through `recipients()`, so a
 * switch that is off, or a person who turned their own notifications off, receives nothing.
 */
function createNotifier(db, env, adapters = {}, options = {}) {
  let vapid;
  const keys = async () => vapid ||= await loadVapid(db, env);
  const fcmSender = adapters.fcm || (env.FCM_SERVICE_ACCOUNT_JSON ? createFcm(env.FCM_SERVICE_ACCOUNT_JSON) : null);
  const ADMIN = { type: 'admin' };
  /** Devices of one audience whose owner has not switched notifications off (the preference lives in the database). */
  const enabled = async type => {
    const settings = options.settings ? await options.settings().catch(() => ({})) : {};
    return (type === 'client' ? settings?.notifyUsers : settings?.notifyAdmins) !== false;
  };
  async function recipients(audience = ADMIN) {
    if (!(await enabled(audience.type))) return [];
    if (audience.type === 'client') {
      const rows = await db.query("SELECT id,data,owner_id FROM subscriptions WHERE owner_type='client' AND owner_id=$1", [audience.id]);
      if (!rows.length) return [];
      const prefs = JSON.parse((await db.query('SELECT prefs FROM clients WHERE id=$1', [audience.id]))[0]?.prefs || '{}');
      return prefs.notifications === false ? [] : rows.map(row => ({ ...JSON.parse(row.data), rowId: row.id }));
    }
    const rows = await db.query("SELECT id,data,owner_id FROM subscriptions WHERE owner_type='admin'");
    if (!rows.length) return [];
    const off = new Set((await db.query('SELECT admin_id,data FROM admin_prefs')).filter(row => JSON.parse(row.data || '{}').notifications === false).map(row => row.admin_id));
    return rows.filter(row => !off.has(row.owner_id)).map(row => ({ ...JSON.parse(row.data), rowId: row.id }));
  }
  const removeDevice = deviceId => db.query('DELETE FROM subscriptions WHERE COALESCE(device_id,id)=$1', [deviceId]);
  async function deliver(request, completed = [], options = {}) {
    const done = new Set(completed), event = options.event || 'request';
    let retry = false, sent = 0;
    const { publicKey, privateKey, subject } = await keys();
    const targets = (await recipients(options.audience)).filter(row => !done.has(row.rowId));
    // Independent sends: one expired/failed device never suppresses the others.
    await Promise.all(targets.map(async subscriber => {
      const payload = payloadFor(request, subscriber.language, event);
      try {
        if (subscriber.kind === 'fcm') {
          if (!fcmSender) throw Object.assign(new Error('FCM is not configured'), { code: 'fcm-unconfigured' });
          await fcmSender(subscriber.token, payload);
        } else {
          await (adapters.web || ((sub, body, opts) => webpush.sendNotification(sub, body, { ...opts, vapidDetails: { subject, publicKey, privateKey } })))(subscriber.subscription, JSON.stringify(payload), { TTL: 86400, urgency: 'high', timeout: 8000 });
        }
        done.add(subscriber.rowId); sent++;
      } catch (error) {
        const expired = error.statusCode === 410 || error.statusCode === 404 || error.code === 'messaging/registration-token-not-registered';
        if (expired) { await removeDevice(subscriber.id); done.add(subscriber.rowId); } else retry = true;
        // Never log tokens, endpoints, payloads, names or phone numbers.
        console.warn('Push failed', { event, code: error.statusCode || error.code || 'delivery-failed' });
      }
    }));
    // `devices`: how many were tried; `sent`: how many accepted the message (0 with devices > 0 = every device had expired).
    return { retry, completed: [...done], sent, devices: targets.length };
  }
  return {
    deliver,
    config: async () => ({ publicKey: (await keys()).publicKey, web: true, android: !!fcmSender }),
    /** One row per (device, owner): the same browser can serve an admin and a client account at once. */
    save: async (subscriber, owner = { type: 'admin', id: 'admin' }) => {
      await db.query('INSERT INTO subscriptions(id,data,owner_type,owner_id,device_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data', [`${subscriber.id}:${owner.type}:${owner.id}`, JSON.stringify(subscriber), owner.type, owner.id, subscriber.id]);
    },
    remove: (deviceId, owner) => owner
      ? db.query('DELETE FROM subscriptions WHERE COALESCE(device_id,id)=$1 AND owner_type=$2 AND owner_id=$3', [deviceId, owner.type, owner.id])
      : removeDevice(deviceId),
    enabled,
    /** Clients that registered at least one device, with the state of their notifications (admin list). */
    clientSubscribers: async () => {
      const rows = await db.query("SELECT s.owner_id, s.data, c.name, c.phone, c.prefs FROM subscriptions s JOIN clients c ON c.id=s.owner_id WHERE s.owner_type='client'");
      const byClient = new Map();
      for (const row of rows) {
        const entry = byClient.get(row.owner_id) || { id: row.owner_id, name: row.name, whatsapp: row.phone, off: JSON.parse(row.prefs || '{}').notifications === false, browsers: 0, apps: 0 };
        if (JSON.parse(row.data).kind === 'fcm') entry.apps++; else entry.browsers++;
        byClient.set(row.owner_id, entry);
      }
      const on = await enabled('client');
      return [...byClient.values()].map(({ off, ...entry }) => ({ ...entry, devices: entry.browsers + entry.apps, status: !on ? 'paused' : off ? 'off' : 'on' })).sort((a, b) => a.name.localeCompare(b.name));
    },
    count: async () => (await db.query("SELECT COUNT(*)::int AS n FROM subscriptions WHERE owner_type='admin'"))[0].n,
    removeOwner: (type, id) => db.query('DELETE FROM subscriptions WHERE owner_type=$1 AND owner_id=$2', [type, id]),
  };
}
module.exports = { createNotifier, createFcm, payloadFor, validateSubscription, trim, phone, CAMPAIGN_URL };
