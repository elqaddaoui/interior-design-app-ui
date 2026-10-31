const fs = require('node:fs');
const path = require('node:path');
const { createMedia } = require('./media');
const fail = (status, message) => Object.assign(new Error(message), { status });

/** Collections and documents that make up the app content. The database is their only source of truth. */
const COLLECTIONS = ['tabs', 'tools', 'roomTypes', 'styles', 'palettes', 'sections', 'categories', 'inspirations', 'models', 'plans'];
const DOCS = ['branding', 'theme', 'assistant', 'settings'];
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const LANGS = ['dar', 'ar', 'fr'];

let seedCache;
const loadSeed = () => seedCache ||= JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-content.json'), 'utf8'));

function createContent(db, sync, mediaOptions = {}) {
  /**
   * First start only: copy the bundled starter content into the database. A flag row makes this run once, so
   * content an admin later deletes is never resurrected. Concurrent cold starts are safe (the flag insert wins once).
   */
  let seeded;
  const ensureSeed = () => seeded ||= (async () => {
    if ((await db.query("SELECT 1 FROM settings WHERE key='content_seeded'"))[0]) return;
    const seed = loadSeed(), now = Date.now();
    await db.tx(async q => {
      const claimed = await q("INSERT INTO settings(key,value) VALUES('content_seeded',$1) ON CONFLICT (key) DO NOTHING RETURNING key", [String(now)]);
      if (!claimed.length) return;
      for (const [coll, rows] of Object.entries(seed.collections)) for (const row of rows) await q('INSERT INTO content_items(coll,id,data,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [coll, row.id, JSON.stringify(row), now]);
      for (const [name, doc] of Object.entries(seed.docs)) await q('INSERT INTO content_docs(name,data,updated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [name, JSON.stringify(doc), now]);
    });
  })().then(migrateMedia).catch(error => { seeded = undefined; throw error; });

  /**
   * Once per database: rows saved before media storage existed may hold inline `data:` images. Move them to media storage
   * (R2, or the database fallback) so the public content JSON stays small and holds no base64. Network-free: external URLs
   * are left to scripts/migrate-media-to-r2.js --external. A failure never blocks content; it is retried on the next start.
   */
  const media = createMedia(db, mediaOptions);
  async function migrateMedia() {
    if ((await db.query("SELECT 1 FROM settings WHERE key='media_migrated_v2'"))[0]) return;
    let moved = 0, failed = 0;
    const move = async (data, save) => {
      try {
        const { value, changed } = await media.externalize(JSON.parse(data), { remote: 'skip' });
        if (changed) { await save(JSON.stringify(value)); moved++; }
      } catch { failed++; }
    };
    for (const row of await db.query("SELECT coll,id,data FROM content_items WHERE data LIKE '%data:%;base64,%'")) await move(row.data, data => db.query('UPDATE content_items SET data=$1 WHERE coll=$2 AND id=$3', [data, row.coll, row.id]));
    for (const row of await db.query("SELECT name,data FROM content_docs WHERE data LIKE '%data:%;base64,%'")) await move(row.data, data => db.query('UPDATE content_docs SET data=$1 WHERE name=$2', [data, row.name]));
    if (failed) console.warn(`Media migration: ${failed} content row(s) could not be moved yet`);
    else await db.query("INSERT INTO settings(key,value) VALUES('media_migrated_v2',$1) ON CONFLICT (key) DO NOTHING", [String(Date.now())]);
    if (moved) await sync.bump('content');
  }
  /** Strings already stored in a row (external URLs among them are not re-downloaded on every save). */
  const strings = (value, out = new Set()) => {
    if (typeof value === 'string') out.add(value);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) strings(child, out);
    return out;
  };

  /** Provider API keys are only ever returned to an authenticated admin. */
  const hideSecrets = row => ({ ...row, apiKey: '' });

  /**
   * Database transfer: the whole content (every table row, ~30 KB and growing with the admin's work) used to be downloaded from
   * Postgres on EVERY /api/content call. It only changes when an admin saves, and every save bumps the `content` version, so the
   * result is kept per version (one public copy, one admin copy) and rebuilt only after a bump. The version is read BEFORE the
   * rows: a save writes its rows first and bumps second, so a copy built under version N is never newer than N and the bump
   * to N+1 always replaces it (the reverse order could keep old rows under a new number).
   */
  let built = null; // { version, rows: { items, docs }, publicCopy, adminCopy }
  let building = null;
  async function load() {
    await ensureSeed();
    const version = (await sync.read(['content'])).content;
    if (built?.version === version) return built;
    // Concurrent callers on the same version share one set of reads.
    if (building?.version === version) return building.promise;
    const promise = (async () => {
      const [itemRows, docRows] = await Promise.all([db.query('SELECT coll,data FROM content_items'), db.query('SELECT name,data FROM content_docs')]);
      const items = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
      for (const row of itemRows) if (items[row.coll]) items[row.coll].push(JSON.parse(row.data));
      const docs = {};
      for (const row of docRows) docs[row.name] = JSON.parse(row.data);
      const adminCopy = { version, collections: items, docs };
      const publicCopy = { version, collections: { ...items, models: items.models.map(hideSecrets) }, docs };
      return (built = { version, adminCopy, publicCopy });
    })().finally(() => { if (building?.promise === promise) building = null; });
    building = { version, promise };
    return promise;
  }
  /** `{ ...snapshot, etag }`: the etag identifies this exact version of this exact copy (public / admin). */
  async function snapshot(isAdmin) {
    const copy = await load();
    return isAdmin ? copy.adminCopy : copy.publicCopy;
  }
  /** Cheap validator for conditional requests: costs one (cached) version read, never a table read. */
  const etag = async isAdmin => { await ensureSeed(); return `W/"content:${isAdmin ? 'a' : 'p'}:${(await sync.read(['content'])).content}"`; };

  async function putItem(coll, id, body) {
    if (!COLLECTIONS.includes(coll)) throw fail(404, 'Unknown collection');
    if (!ID.test(id)) throw fail(400, 'Invalid id');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail(400, 'Invalid item');
    await ensureSeed();
    const oldRow = (await db.query('SELECT data FROM content_items WHERE coll=$1 AND id=$2', [coll, id]))[0];
    const old = oldRow ? JSON.parse(oldRow.data) : undefined;
    const item = { ...(await media.externalize(body, { known: strings(old) })).value, id };
    if (coll === 'models' && item.apiKey === undefined && old) item.apiKey = old.apiKey ?? '';
    await db.query('INSERT INTO content_items(coll,id,data,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (coll,id) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at', [coll, id, JSON.stringify(item), Date.now()]);
    await sync.bump('content');
    return item;
  }
  async function deleteItems(coll, ids) {
    if (!COLLECTIONS.includes(coll)) throw fail(404, 'Unknown collection');
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== 'string' || !ID.test(id))) throw fail(400, 'Invalid ids');
    await ensureSeed();
    for (const id of ids) await db.query('DELETE FROM content_items WHERE coll=$1 AND id=$2', [coll, id]);
    await sync.bump('content');
  }
  async function patchDoc(name, patch) {
    if (!DOCS.includes(name)) throw fail(404, 'Unknown document');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, 'Invalid document');
    await ensureSeed();
    const current = (await db.query('SELECT data FROM content_docs WHERE name=$1', [name]))[0];
    const clean = (await media.externalize(patch, { known: strings(current && JSON.parse(current.data)) })).value; // outside the transaction: it writes media rows itself
    const next = await db.tx(async q => {
      const row = (await q('SELECT data FROM content_docs WHERE name=$1 FOR UPDATE', [name]))[0];
      const merged = { ...(row ? JSON.parse(row.data) : {}), ...clean };
      await q('INSERT INTO content_docs(name,data,updated_at) VALUES($1,$2,$3) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at', [name, JSON.stringify(merged), Date.now()]);
      return merged;
    });
    await sync.bump('content');
    return next;
  }

  /** Preferences are stored per identity (one row per client, one per admin). */
  function cleanPrefs(input) {
    if (!input || typeof input !== 'object') throw fail(400, 'Invalid preferences');
    const out = {};
    if (input.notifications !== undefined) { if (typeof input.notifications !== 'boolean') throw fail(400, 'Invalid notifications'); out.notifications = input.notifications; }
    if (input.bannerDismissed !== undefined) { if (typeof input.bannerDismissed !== 'boolean') throw fail(400, 'Invalid banner'); out.bannerDismissed = input.bannerDismissed; }
    if (input.lang !== undefined) { if (!LANGS.includes(input.lang)) throw fail(400, 'Invalid language'); out.lang = input.lang; }
    return out;
  }
  const adminPrefs = async adminId => JSON.parse((await db.query('SELECT data FROM admin_prefs WHERE admin_id=$1', [adminId]))[0]?.data || '{}');
  const clientPrefs = async clientId => JSON.parse((await db.query('SELECT prefs FROM clients WHERE id=$1', [clientId]))[0]?.prefs || '{}');
  async function setAdminPrefs(adminId, patch) {
    const clean = cleanPrefs(patch);
    const next = { ...(await adminPrefs(adminId)), ...clean };
    await db.query('INSERT INTO admin_prefs(admin_id,data) VALUES($1,$2) ON CONFLICT (admin_id) DO UPDATE SET data=EXCLUDED.data', [adminId, JSON.stringify(next)]);
    await sync.bump(`a:${adminId}`);
    return next;
  }
  async function setClientPrefs(clientId, patch) {
    const clean = cleanPrefs(patch);
    const next = await db.tx(async q => {
      const row = (await q('SELECT prefs FROM clients WHERE id=$1 FOR UPDATE', [clientId]))[0];
      if (!row) throw fail(404, 'NOT_FOUND');
      const merged = { ...JSON.parse(row.prefs || '{}'), ...clean };
      await q('UPDATE clients SET prefs=$1 WHERE id=$2', [JSON.stringify(merged), clientId]);
      return merged;
    });
    await sync.bump(`c:${clientId}`);
    return next;
  }
  /** Settings documents come from the same per-version copy as /api/content: no table read per login / chat reply / scheduler tick. */
  const getDoc = async name => ({ ...((await load()).adminCopy.docs[name] || {}) });
  return { media, getDoc, snapshot, etag, putItem, deleteItems, patchDoc, adminPrefs, clientPrefs, setAdminPrefs, setClientPrefs, ensureSeed };
}
module.exports = { createContent, COLLECTIONS, DOCS };
