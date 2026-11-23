/**
 * The super admin's notification centre.
 *
 * Every warning meant for the platform owner (free-tier limits, automatic backups, API abuse alerts) is stored here as a small
 * row: `kind`, `severity`, a `code` and its `params`. No sentence is stored: the console renders the text in the owner's language
 * and shows it as a bell entry, an in-app toast and (once the owner allowed it) a browser notification.
 * There is no e-mail anywhere: nothing to configure on the server.
 *
 * Only the platform side (server/platform.js, server/limits.js, server/usage.js, server/superadmin.js) uses this module.
 */
const crypto = require('node:crypto');

const KINDS = ['limits', 'backup', 'api', 'system'];
const SEVERITIES = ['info', 'ok', 'warn', 'danger'];
const KEEP = 200;
const KEEP_MS = 60 * 86400000;

const fail = (status, message) => Object.assign(new Error(message), { status });
/** Only a console page of this app can be opened from a notification. */
const safeHref = href => (typeof href === 'string' && /^\/super-admin(\/[a-z0-9-]+)?(\?[a-z0-9=&_-]{0,80})?$/.test(href) ? href : '');
/** Params are small and flat: strings (cut), finite numbers and booleans only. */
function cleanParams(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input).slice(0, 20)) {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}

/** `onAdd(notice)` (optional) is awaited after the row is saved: the platform uses it to push the notice to the owner's phones (server/notice-push.js). */
function createNotices(db, { clock = Date.now, onAdd } = {}) {
  let lastPrune = 0;
  const view = row => {
    let params = {};
    try { params = JSON.parse(row.params || '{}'); } catch { /* none */ }
    return { id: row.id, at: Number(row.at), kind: row.kind, severity: row.severity, code: row.code, params, href: row.href || '', read: row.read_at != null };
  };

  /** Never throws: a notice must not break the job that raised it. Returns the id, or '' when it could not be saved. `silent`: no push to the phones (the caller sends it). */
  async function add({ kind = 'system', severity = 'info', code, params, href = '', silent = false } = {}) {
    try {
      if (!code || typeof code !== 'string') return '';
      const now = clock();
      const id = `nt_${crypto.randomBytes(6).toString('hex')}`;
      await db.query('INSERT INTO saas_notices(id,at,kind,severity,code,params,href) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, now, KINDS.includes(kind) ? kind : 'system', SEVERITIES.includes(severity) ? severity : 'info', code.slice(0, 60), JSON.stringify(cleanParams(params)), safeHref(href)]);
      if (now - lastPrune > 3600000) {
        lastPrune = now;
        await db.query('DELETE FROM saas_notices WHERE at<$1 OR id NOT IN (SELECT id FROM saas_notices ORDER BY at DESC LIMIT $2)', [now - KEEP_MS, KEEP]).catch(() => {});
      }
      if (onAdd && !silent) await Promise.resolve(onAdd({ id, kind, severity: SEVERITIES.includes(severity) ? severity : 'info', code, params: cleanParams(params), href: safeHref(href) })).catch(() => {});
      return id;
    } catch { return ''; }
  }

  /** The newest notices (newest first) and how many are unread. */
  async function list({ limit = 50 } = {}) {
    const n = Math.max(1, Math.min(KEEP, Number(limit) || 50));
    const rows = await db.query('SELECT * FROM saas_notices ORDER BY at DESC, id DESC LIMIT $1', [n]);
    return { notices: rows.map(view), unread: await unread() };
  }
  const unread = async () => Number((await db.query('SELECT COUNT(*) AS n FROM saas_notices WHERE read_at IS NULL'))[0].n);
  /** `ids` = an array of notice ids, or 'all'. */
  async function markRead(ids) {
    const now = clock();
    if (ids === 'all') await db.query('UPDATE saas_notices SET read_at=$1 WHERE read_at IS NULL', [now]);
    else if (Array.isArray(ids)) {
      for (const id of ids.slice(0, 200)) {
        if (/^nt_[a-f0-9]{12}$/.test(String(id))) await db.query('UPDATE saas_notices SET read_at=$2 WHERE id=$1 AND read_at IS NULL', [String(id), now]);
      }
    } else throw fail(400, 'INVALID_REQUEST');
    return { ok: true, unread: await unread() };
  }
  async function clear() { await db.query('DELETE FROM saas_notices'); return { ok: true, unread: 0 }; }

  return { add, list, unread, markRead, clear };
}

module.exports = { createNotices, safeHref, cleanParams, KINDS, SEVERITIES };
