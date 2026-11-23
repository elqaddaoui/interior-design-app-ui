/**
 * Web Push for the super admin's notification centre.
 *
 * The bell and the toasts only work while the console is open. A phone shows a notification when the browser is in the background or
 * closed only if the SERVER pushes it (Web Push: Chrome/Android keeps a connection to Google's push service and wakes the console's
 * service worker, public/sa-sw.js). This module keeps the devices the owner turned notifications on for (table saas_push) and sends every
 * new notice to all of them, with the sentence already written in the language that device chose.
 *
 * Reuses the VAPID keys and the push-provider allow-list of server/notifications.js. Sending never throws: a failed push must not break
 * the job that raised the notice, and a device that has gone (HTTP 404/410) is forgotten.
 * Only the platform side (server/platform.js, server/superadmin.js, server/notices.js) uses this module.
 */
const crypto = require('node:crypto');
const webpush = require('web-push');
const { loadVapid, validateSubscription } = require('./notifications');
const TEXTS = require('./notice-texts.json');

const LANGS = ['en', 'fr', 'ar', 'dar'];
const COLUMN = { fr: 0, ar: 1, dar: 2 };
const MAX_DEVICES = 20;
const GB = 1e9;
const withTimeout = (promise, ms) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('timeout'), ms))]);

/** The same sentences as src/superadmin/notices.ts (`noticeText`), written on the server in the language of the device. */
function render(code, params = {}, lang = 'en') {
  const tr = (text, vars) => {
    let out = text;
    if (lang !== 'en' && TEXTS[text]) out = TEXTS[text][COLUMN[lang]];
    return vars ? out.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole)) : out;
  };
  const p = params || {};
  const s = key => String(p[key] ?? '');
  const x = key => Number(p[key]) || 0;
  const bytes = v => (v >= GB ? `${(v / GB).toFixed(2)} GB` : `${(v / 1e6).toFixed(1)} MB`);
  const figure = (id, v) => (/\.(storage|egress)$/.test(id) ? bytes(v) : id.endsWith('.compute') ? `${v.toFixed(1)} h` : Math.round(v).toLocaleString('en'));
  const day = at => new Date(at).toISOString().slice(0, 10);
  const LIMIT = { 'neon.storage': 'Neon database storage', 'neon.compute': 'Neon compute hours', 'neon.egress': 'Neon network transfer', 'r2.storage': 'R2 file storage', 'r2.classA': 'R2 write operations (Class A)', 'r2.classB': 'R2 read operations (Class B)' };
  const RULE = { burst: 'Burst of API calls', daily: 'Daily API cap reached', spike: 'Usage spike', failures: 'Many failing API calls', probe: 'Repeated attempts while AI is switched off' };
  const WHERE = { vault: 'your backup vault', gdrive: 'Google Drive', dropbox: 'Dropbox' };
  if (code === 'limits.alert') {
    const id = s('id');
    const name = LIMIT[id] ? tr(LIMIT[id]) : id;
    const lines = [p.exceeded ? tr('The limit is reached. Back up all your data now.')
      : p.level === 'critical' ? tr('Very close to the limit. Back up all your data now.')
        : p.level === 'urgent' ? tr('Time to back up your data.') : tr('Getting close to the limit. Plan a backup soon.')];
    if (p.days != null && p.at != null) lines.push(tr('At the current pace it runs out around {date} (in about {days} days).', { date: day(x('at')), days: x('days') }));
    if (p.reserveNeed != null) lines.push(tr('Only {left} of transfer is left and a full backup needs about {need}. Back up now.', { left: figure(id, x('reserveLeft')), need: figure(id, x('reserveNeed')) }));
    return { title: p.why === 'reminder' ? tr('{name} at {pct} % (reminder)', { name, pct: x('pct') }) : tr('{name} at {pct} %', { name, pct: x('pct') }), body: lines.join(' ') };
  }
  if (code === 'limits.blind') return { title: tr('{name} cannot be read', { name: s('service') === 'cloudflare' ? 'Cloudflare' : 'Neon' }), body: tr('The monitor could not read this service for more than 12 hours. Check the key or token in the server settings.') };
  if (code === 'backup.auto.done') return { title: tr('Automatic backup made'), body: tr('Saved to {where}. Nothing else to do: you can restore it from Backup & restore.', { where: tr(WHERE[s('destination')] || 'your backup vault') }) };
  if (code === 'backup.auto.failed') return { title: tr('Automatic backup failed'), body: tr('{why} It is tried again later. If this keeps happening, open Backup & restore and make a backup by hand.', { why: tr('Something went wrong.') }) };
  if (code === 'api.alert') {
    const rule = s('rule');
    const what = rule === 'failures'
      ? tr('{value} % of calls failed (alert level {limit} %)', { value: x('value'), limit: x('limit') })
      : tr('{value} calls in about {min} min (alert level {limit})', { value: x('value'), min: x('windowMin'), limit: x('limit') });
    return { title: `${tr(RULE[rule] || 'API warning')} · ${s('store')}`, body: p.paused ? `${what}. ${tr('Its API was paused automatically. Resume it from the warning.')}` : what };
  }
  if (code === 'system.test') return { title: tr('Notifications are working'), body: tr('This is a test. Warnings about your free limits, backups and API use appear here and in your browser.') };
  return { title: code, body: '' };
}

/**
 * `send` (optional) replaces the real web-push call: `(subscription, payload, options) => Promise`. Tests inject it.
 * `onGone` is not needed: expired devices are deleted here.
 */
function createNoticePush(db, { env = process.env, clock = Date.now, send } = {}) {
  let vapid;
  const keys = async () => vapid ||= await loadVapid(db, env);
  const hashOf = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex');

  async function config() {
    const { publicKey } = await keys();
    return { publicKey, devices: await count() };
  }
  const count = async () => Number((await db.query('SELECT COUNT(*) AS n FROM saas_push'))[0].n);

  /** Stores (or refreshes) one device. `input` is what the browser gives: `{ subscription: PushSubscription.toJSON(), language }`. */
  async function subscribe(input, userAgent = '') {
    const device = validateSubscription({ kind: 'web', subscription: input?.subscription, language: input?.language });
    const lang = LANGS.includes(device.language) ? device.language : 'en';
    await db.query('INSERT INTO saas_push(id,data,lang,ua,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, lang=EXCLUDED.lang, ua=EXCLUDED.ua',
      [device.id, JSON.stringify(device.subscription), lang, String(userAgent || '').slice(0, 200), clock()]);
    // Never an unbounded list: keep the newest devices.
    await db.query('DELETE FROM saas_push WHERE id NOT IN (SELECT id FROM saas_push ORDER BY created_at DESC, id LIMIT $1)', [MAX_DEVICES]);
    return { ok: true, devices: await count() };
  }
  async function unsubscribe(input) {
    const endpoint = input?.subscription?.endpoint ?? input?.endpoint;
    if (typeof endpoint === 'string' && endpoint.length < 2049) await db.query('DELETE FROM saas_push WHERE id=$1', [hashOf(endpoint)]);
    return { ok: true, devices: await count() };
  }

  /**
   * Pushes one notice to every device. Resolves with `{ devices, sent }` and never rejects.
   * `notice`: { id, code, params, href, severity }.
   */
  async function notify(notice, { test = false } = {}) {
    const result = { devices: 0, sent: 0 };
    try {
      const rows = await db.query('SELECT id,data,lang FROM saas_push');
      result.devices = rows.length;
      if (!rows.length) return result;
      const { publicKey, privateKey, subject } = await keys();
      const sender = send || ((sub, body, options) => webpush.sendNotification(sub, body, { ...options, vapidDetails: { subject, publicKey, privateKey } }));
      const urgent = notice.severity === 'warn' || notice.severity === 'danger' || test;
      await Promise.all(rows.map(async row => {
        const lang = LANGS.includes(row.lang) ? row.lang : 'en';
        const text = render(notice.code, notice.params, lang);
        const payload = JSON.stringify({ id: notice.id, title: text.title.slice(0, 120), body: text.body.slice(0, 300), url: notice.href || '/super-admin', severity: notice.severity, lang, dir: lang === 'ar' || lang === 'dar' ? 'rtl' : 'ltr', test: test || undefined });
        try {
          const outcome = await withTimeout(sender(JSON.parse(row.data), payload, { TTL: 86400, urgency: urgent ? 'high' : 'normal', timeout: 8000 }), 10000);
          if (outcome === 'timeout') throw Object.assign(new Error('timeout'), { code: 'timeout' });
          result.sent++;
          await db.query('UPDATE saas_push SET last_ok_at=$2 WHERE id=$1', [row.id, clock()]).catch(() => {});
        } catch (error) {
          // 404/410: the phone removed the subscription (notifications switched off, browser data cleared). Forget it.
          if (error.statusCode === 404 || error.statusCode === 410) await db.query('DELETE FROM saas_push WHERE id=$1', [row.id]).catch(() => {});
          console.warn('Console push failed', { code: error.statusCode || error.code || 'delivery-failed' }); // never the endpoint or the text
        }
      }));
    } catch (error) { console.warn('Console push failed', { code: error.code || 'push-error' }); }
    return result;
  }

  return { config, subscribe, unsubscribe, notify, count, render };
}

module.exports = { createNoticePush, render };
