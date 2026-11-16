/**
 * Media hub: the process-wide part of media storage, shared by every store's `createMedia` (server/bundle.js builds ONE hub).
 *
 *  - Which storage receives NEW files: 'r2' (Cloudflare), 'app' (a folder on the server) or 'database'. The platform owner picks it in the console
 *    (stored by server/platform.js); until then the deployment default applies (R2 variables set -> r2; MEDIA_STORAGE=app / MEDIA_DIR -> app).
 *    A picked storage that is not usable on this host is ignored, so a misconfiguration can never lose uploads.
 *  - ONE SHARED NAMESPACE. A file is named after the hash of its bytes, so the same picture is ONE stored object (`media/<hash>.<ext>`) however
 *    many stores use it. Every store keeps its OWN row (its library, title, alt text; `media.ns = 1` marks "the object lives at the shared key").
 *    `shared` answers the questions only the whole platform can answer: is this file already stored (by anybody)? who else still points at it?
 *    A stored object is deleted only when the last row that points at it goes. Cloning a demo or restoring a backup therefore copies ROWS, not bytes.
 *  - A `version` that changes whenever files move between storages, so every store forgets what it remembered about where a file lives.
 *
 * It reads the `media` table of every store on purpose (raw database, only by a hash the caller already holds), never by anything a request carries
 * as a store id. Reading a file is still limited to a store's own rows: knowing a hash gives no access to it.
 */
const { createR2Storage, createFsStorage } = require('./media');

const MODE = { r2: 'r2', app: 'fs', database: 'database' };
const SETTLED = "('r2','fs','db')";

/** `mediaOptions` is the object passed to createBackend({ media }): `storage` present = injected (tests), `undefined` = from the environment. */
function createMediaHub({ db, platform, env = process.env, mediaOptions = {} } = {}) {
  const injected = 'storage' in mediaOptions && mediaOptions.storage !== undefined;
  const given = mediaOptions.storage;
  const adapters = {
    r2: injected && given?.kind === 'r2' ? given : mediaOptions.r2 !== undefined ? mediaOptions.r2 : createR2Storage(env),
    fs: injected && given?.kind === 'fs' ? given : mediaOptions.fsStorage !== undefined ? mediaOptions.fsStorage : createFsStorage(env),
  };
  let version = 0;
  let current;

  const hasAppDir = () => !env.VERCEL && !!adapters.fs;
  const available = kind => (kind === 'r2' ? !!adapters.r2 : kind === 'app' ? hasAppDir() : kind === 'database');
  const envChoice = () => {
    if (injected) return given === null ? 'database' : given.kind === 'fs' ? 'app' : 'r2';
    if (adapters.r2) return 'r2';
    return hasAppDir() && (env.MEDIA_STORAGE === 'app' || String(env.MEDIA_DIR || '').trim()) ? 'app' : 'database';
  };
  current = envChoice();

  /** 'r2' | 'app' | 'database': what receives new files right now. */
  async function choice() {
    let picked = null;
    try { picked = await platform.storageChoice(); } catch { /* the registry is unreachable: the default applies */ }
    current = picked && picked !== 'database' && available(picked) ? picked : envChoice();
    return current;
  }
  async function primary() {
    const kind = await choice();
    return kind === 'r2' ? adapters.r2 : kind === 'app' ? adapters.fs : null;
  }

  /** What the console shows about the server folder: can it be used, is it writable, does it survive a deploy, how much room is left. */
  async function appInfo() {
    const fsAdapter = adapters.fs;
    const platformName = env.VERCEL ? 'vercel' : require('./config').platformName(env);
    const customDir = !!String(env.MEDIA_DIR || '').trim();
    const usable = hasAppDir();
    const writable = usable ? await fsAdapter.writable().catch(() => false) : false;
    return {
      available: usable && writable, writable, root: usable ? fsAdapter.root : null, platform: platformName, customDir,
      freeBytes: usable && writable ? await fsAdapter.free().catch(() => null) : null,
      // Hostinger replaces the whole build folder on every deploy: files survive only in a folder OUTSIDE it (MEDIA_DIR).
      persistent: usable && platformName !== 'vercel' && (platformName !== 'hostinger' || customDir),
    };
  }

  /** The shared namespace, seen across stores. */
  const shared = {
    /** A stored object for file `id` that any store holds: { tenant, mime, storage, size } or null. Prefers an object on a real storage over database bytes. */
    async find(id) {
      const row = (await db.query(`SELECT tenant_id,mime,storage,size FROM media WHERE id=$1 AND storage IN ${SETTLED} AND (ns=1 OR tenant_id='default' OR storage='db') ORDER BY CASE storage WHEN 'db' THEN 1 ELSE 0 END LIMIT 1`, [id]))[0];
      return row ? { tenant: row.tenant_id, mime: row.mime, storage: row.storage, size: row.size == null ? null : Number(row.size) } : null;
    },
    /** Bytes kept in the database for file `id`, whichever store's row holds them (rows of other stores point at them with an empty body). */
    async body(id) {
      const row = (await db.query("SELECT data,body FROM media WHERE id=$1 AND storage='db' AND (body IS NOT NULL OR data<>'') LIMIT 1", [id]))[0];
      return row?.body ? Buffer.from(row.body) : row?.data ? Buffer.from(row.data, 'base64') : null;
    },
    /** How many OTHER stores (rows) still point at the same stored object as this file of `tenantId`. */
    async others(tenantId, id) {
      return Number((await db.query(`SELECT COUNT(*) AS n FROM media WHERE id=$1 AND tenant_id<>$2 AND storage IN ${SETTLED} AND (ns=1 OR tenant_id='default' OR storage='db')`, [id, tenantId]))[0].n);
    },
    /** Before a row that holds database bytes is deleted: hand the bytes to another row that points at them, so nobody loses the picture. */
    async handOver(tenantId, id) {
      const mine = (await db.query("SELECT data,body FROM media WHERE tenant_id=$1 AND id=$2 AND storage='db'", [tenantId, id]))[0];
      if (!mine || (!mine.body && !mine.data)) return;
      const next = (await db.query("SELECT tenant_id FROM media WHERE id=$1 AND tenant_id<>$2 AND storage='db' AND body IS NULL AND data='' LIMIT 1", [id, tenantId]))[0];
      if (next) await db.query('UPDATE media SET body=$3, data=$4 WHERE tenant_id=$1 AND id=$2', [next.tenant_id, id, mine.body || null, mine.data || '']);
    },
  };

  return {
    adapters, available, envChoice, choice, primary, appInfo, shared,
    mode: () => MODE[current] || 'database',
    /** Bumped when files change storage: stores drop their "where does this file live" memory. */
    version: () => version,
    bump: () => { version++; },
    forget: () => platform.forget?.(),
    /** The handle one store's media module gets. */
    forTenant() {
      return {
        adapters, primary, version: () => version, mode: () => MODE[current] || 'database', shared,
        /** Copies of this store's files left in a previous storage after a move (kept for a day before cleanup). */
        old: { list: (tenantId, ids) => platform.oldList(tenantId, ids), del: (tenantId, id, storage) => platform.oldDel(tenantId, id, storage) },
      };
    },
  };
}

module.exports = { createMediaHub, MODE };
