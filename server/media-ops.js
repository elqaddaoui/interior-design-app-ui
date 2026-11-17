/**
 * Platform media operations (super admin only, raw database on purpose): everything that touches the files of MORE than one store.
 *
 * ONE SHARED NAMESPACE: files are named after the hash of their bytes (`media/<hash>.<ext>`, rows with `ns = 1`), so a demo clone or a backup
 * restore copies ROWS and never bytes, and an object is deleted only when the last row that points at it goes (see server/media-hub.js).
 * Rows with `ns = 0` are legacy files that still live under their store's own prefix (`t/<store>/media/...`).
 *
 *   copyRows        give a store (or a theme) a row for every file of another one. No object is written.
 *   purgeRows       delete every row of a store / theme; objects nobody else uses are deleted from their storage too.
 *   mover           "move all media" to Cloudflare R2 or to the server folder: copy -> verify -> repoint the rows -> keep the old copy.
 *                   Resumable (cursor), tolerant (a failing file is counted and skipped, a later run retries it). A shared object moves ONCE.
 *   cleanup         removes the old copies a move left behind, but only once they are older than OLD_AFTER_MS, and only when the file is
 *                   verified in its new storage. Until then a rollback is possible and other server instances with a stale cache keep working.
 *   totals/perStore what the console shows: distinct stored objects per storage, and files + bytes per store.
 *
 * This file never names a platform table: the registry-side rows (old copies) come through `platform.media` (server/platform.js).
 */
const crypto = require('node:crypto');
const { keyFor, EXT, KEY_SHAPE } = require('./media');

const OLD_AFTER_MS = 24 * 3600 * 1000;
const KINDS = { r2: 'r2', app: 'fs' };
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const fileName = row => `${row.id}.${EXT[row.mime]}`;
/** Which adapter a storage value names. `legacy-<storage>` = the store's own old copy left by a layout fix (see `repair`). */
const adapterKey = storage => (String(storage).replace(/^legacy-/, '') === 'fs' ? 'fs' : 'r2');
const isLegacyOld = old => String(old.storage).startsWith('legacy-');
const HOUR = 3600000;
/** The id of a file stored by this app = the hash of its bytes (direct uploads use random ids: a mismatch proves nothing about them). */
const idOf = body => crypto.createHash('sha256').update(body.toString('base64')).digest('hex').slice(0, 32);
const HASH_LIMIT = 40 * 1024 * 1024;

function createMediaOps({ db, hub, platform, env = process.env, clock = Date.now }) {
  const { adapters } = hub;

  const SETTLED = "('r2','fs','db')";
  const isShared = row => Number(row.ns) === 1;
  /** The object key of a row of `tenantId`. */
  const keyOfRow = (tenantId, row) => (isShared(row) ? keyFor('default')(fileName(row)) : keyFor(tenantId)(fileName(row)));

  // ---------- Rows ----------
  /**
   * Gives `to` a row for every settled file of `from` (title, alt and library flag included), or only for `ids`. Nothing is written to any
   * storage: both stores point at the same object. Database bytes stay in the first row (rows of the other stores are empty and read them from
   * there). `run(sql, params)` may be a transaction's query function. Returns the number of rows added.
   */
  async function copyRows(from, to, { ids = null, run = (sql, params) => db.query(sql, params) } = {}) {
    if (ids && !ids.length) return 0;
    const only = ids ? ' AND id=ANY($3)' : '', args = ids ? [from, to, ids] : [from, to];
    const rows = await run(`INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,lib,title,alt,ns)
      SELECT $2,id,mime,'',NULL,size,storage,created_at,lib,title,alt,1 FROM media WHERE tenant_id=$1 AND storage IN ${SETTLED} AND (ns=1 OR storage='db')${only}
      ON CONFLICT (tenant_id,id) DO NOTHING RETURNING id`, args);
    // Legacy rows kept under the source's own prefix: they join the shared namespace as soon as their object is copied (once, here).
    const legacy = await run(`SELECT id,mime,storage,size,created_at,lib,title,alt FROM media WHERE tenant_id=$1 AND storage IN ('r2','fs') AND ns=0${only.replace('$3', '$2')}`, ids ? [from, ids] : [from]);
    let copied = rows.length;
    for (const row of legacy) {
      const adapter = adapters[adapterKey(row.storage)];
      if (!adapter) continue;
      try {
        const target = keyFor('default')(fileName(row));
        if (!(await adapter.head(target))) {
          if (adapter.copy) await adapter.copy(keyFor(from)(fileName(row)), target);
          else await adapter.put(target, await adapter.get(keyFor(from)(fileName(row))), row.mime);
        }
        const done = await run("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,lib,title,alt,ns) VALUES($1,$2,$3,'',NULL,$4,$5,$6,$7,$8,$9,1) ON CONFLICT (tenant_id,id) DO NOTHING RETURNING id", [to, row.id, row.mime, row.size, row.storage, row.created_at, row.lib, row.title, row.alt]);
        copied += done.length;
      } catch { /* that picture stays unavailable in the copy */ }
    }
    return copied;
  }

  /** Ids (of `ids`) that a row of ANOTHER store than `tenantId` still points at through the shared namespace. */
  async function heldElsewhere(tenantId, ids) {
    const held = new Set();
    for (let i = 0; i < ids.length; i += 500) {
      for (const row of await db.query(`SELECT DISTINCT id FROM media WHERE tenant_id<>$1 AND id=ANY($2) AND storage IN ${SETTLED} AND (ns=1 OR tenant_id='default' OR storage='db')`, [tenantId, ids.slice(i, i + 500)])) held.add(row.id);
    }
    return held;
  }

  /**
   * Deletes every row of a store (or theme) and the stored objects nobody else uses. Objects other stores still point at stay where they are.
   * Returns { rows, objects } (objects = how many were removed from a storage; best effort, like a purge).
   */
  async function purgeRows(tenantId) {
    const rows = await db.query(`SELECT id,mime,storage,ns FROM media WHERE tenant_id=$1`, [tenantId]);
    const held = await heldElsewhere(tenantId, rows.map(row => row.id));
    const byId = new Map(rows.map(row => [row.id, row]));
    let objects = 0;
    for (const row of rows) {
      const shared = (isShared(row) || tenantId === 'default' || row.storage === 'db') && held.has(row.id);
      if (row.storage === 'db') { if (shared) await hub.shared.handOver(tenantId, row.id); continue; }
      if (shared || (row.storage !== 'r2' && row.storage !== 'fs')) continue;
      try { await adapters[adapterKey(row.storage)]?.remove(keyOfRow(tenantId, row)); objects++; } catch { /* a later purge can remove the prefix */ }
    }
    // Copies a move left in another storage.
    for (const old of await platform.oldOf(tenantId).catch(() => [])) {
      if (old.storage === 'db') continue;
      if (isLegacyOld(old)) { try { await adapters[adapterKey(old.storage)]?.remove(keyFor(tenantId)(fileName(old))); } catch { /* best effort */ } continue; }
      const row = byId.get(old.id);
      if (held.has(old.id) && (!row || isShared(row))) continue;
      try { await adapters[adapterKey(old.storage)]?.remove(row ? keyOfRow(tenantId, row) : keyFor('default')(fileName(old))); } catch { /* best effort */ }
    }
    await platform.oldDropTenant(tenantId);
    await db.query('DELETE FROM media WHERE tenant_id=$1', [tenantId]);
    return { rows: rows.length, objects };
  }

  // ---------- Move all media to another storage ----------
  // One line per STORED OBJECT: rows of different stores that share the object count once.
  const OBJECTS = "SELECT DISTINCT ON (obj, id) obj, id, storage, size FROM (SELECT CASE WHEN ns=1 OR tenant_id='default' THEN '' ELSE tenant_id END AS obj, id, storage, size FROM media) m";
  const JOB = 'media_move';
  const lease = { id: crypto.randomBytes(6).toString('hex') };
  const readJob = async () => { try { return JSON.parse((await platform.kvGet(JOB)) || 'null'); } catch { return null; } };
  const writeJob = job => platform.kvSet(JOB, JSON.stringify(job));
  const NONE = { status: 'idle' };

  async function countToMove(kind) {
    const r = (await db.query(`SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM (${OBJECTS} WHERE storage IN ${SETTLED} AND storage<>$1) o`, [kind]))[0];
    return { files: Number(r.files), bytes: Number(r.bytes) };
  }
  async function status() {
    const job = (await readJob()) || NONE;
    return job.status === 'idle' ? job : { ...job, lease: undefined, leaseId: undefined };
  }
  /** Checks that the target can really take files, then records the job. The caller has already set the target as the storage for NEW files. */
  async function start(target) {
    const kind = KINDS[target];
    if (!kind) throw fail(400, 'INVALID_STORAGE');
    if (target === 'r2' && !adapters.r2) throw fail(409, 'R2_NOT_CONFIGURED');
    if (target === 'app') {
      const info = await hub.appInfo();
      if (!info.available) throw fail(409, 'APP_STORAGE_UNAVAILABLE');
    }
    const current = await readJob();
    if (current?.status === 'running' && current.lease > clock()) throw fail(409, 'MOVE_RUNNING');
    const todo = await countToMove(kind);
    const job = { status: todo.files ? 'running' : 'done', target, kind, startedAt: clock(), finishedAt: todo.files ? null : clock(), total: todo.files, bytes: todo.bytes, done: 0, failed: 0, movedBytes: 0, cursor: ['', ''], lastError: '', lease: 0 };
    await writeJob(job);
    return status();
  }
  /** Reads one file as bytes or a stream and writes it to the target adapter. Throws when the source is missing or the copy does not verify. */
  async function transfer(tenantId, row, kind) {
    const key = keyOfRow(tenantId, row), target = adapters[kind];
    if (!target) throw fail(503, kind === 'fs' ? 'APP_STORAGE_UNAVAILABLE' : 'R2_NOT_CONFIGURED');
    let size;
    if (row.storage === 'db') {
      const stored = (await db.query('SELECT data,body FROM media WHERE tenant_id=$1 AND id=$2', [tenantId, row.id]))[0];
      let body = stored?.body ? Buffer.from(stored.body) : stored?.data ? Buffer.from(stored.data, 'base64') : null;
      if (!body?.length) body = await hub.shared.body(row.id); // another store's row holds the bytes
      if (!body?.length) throw fail(404, 'SOURCE_MISSING');
      await target.put(key, body, row.mime);
      size = body.length;
    } else {
      const source = adapters[adapterKey(row.storage)];
      if (!source) throw fail(503, row.storage === 'fs' ? 'APP_STORAGE_UNAVAILABLE' : 'R2_NOT_CONFIGURED');
      const probe = await source.head(key);
      if (!probe) throw fail(404, 'SOURCE_MISSING');
      size = probe.size;
      if (kind === 'fs') await target.putStream(key, await source.stream(key));
      else await target.put(key, await source.get(key), row.mime);
    }
    const written = await target.head(key);
    const expected = row.size == null ? size : Number(row.size);
    if (!written || written.size !== size || (expected && size !== expected)) {
      await target.remove(key).catch(() => {});
      throw fail(502, 'VERIFY_FAILED');
    }
    return size;
  }
  /**
   * Advances the job by one time-boxed slice. Safe to call from several places: a short lease keeps two callers from working at once
   * (another instance may call it too on serverless hosts).
   */
  async function step({ budgetMs = 8000, batch = 25 } = {}) {
    let job = await readJob();
    if (!job || job.status !== 'running') return status();
    if (job.lease > clock() && job.leaseId !== lease.id) return status();
    job.lease = clock() + budgetMs + 15000; job.leaseId = lease.id;
    await writeJob(job);
    const deadline = clock() + budgetMs;
    try {
      while (clock() < deadline) {
        const rows = await db.query("SELECT tenant_id,id,mime,size,storage,ns FROM media WHERE storage IN ('r2','fs','db') AND storage<>$1 AND (tenant_id,id) > ($2,$3) ORDER BY tenant_id,id LIMIT $4", [job.kind, job.cursor[0], job.cursor[1], batch]);
        if (!rows.length) { job.status = 'done'; job.finishedAt = clock(); break; }
        for (const row of rows) {
          job.cursor = [row.tenant_id, row.id];
          try {
            // A shared object moves once: a row of another store may already have been repointed earlier in this very batch.
            const still = (await db.query('SELECT storage FROM media WHERE tenant_id=$1 AND id=$2', [row.tenant_id, row.id]))[0];
            if (!still || still.storage !== row.storage) continue;
            const size = await transfer(row.tenant_id, row, job.kind);
            // Repoint only if nothing changed meanwhile (a concurrent move / delete): the guard is the old storage value.
            // A shared object moved once: every row that points at it follows (they are skipped when the cursor reaches them).
            const moved = isShared(row) || row.tenant_id === 'default'
              ? await db.query("UPDATE media SET storage=$3 WHERE id=$1 AND storage=$2 AND (ns=1 OR tenant_id='default') RETURNING id", [row.id, row.storage, job.kind])
              : await db.query('UPDATE media SET storage=$4 WHERE tenant_id=$1 AND id=$2 AND storage=$3 RETURNING id', [row.tenant_id, row.id, row.storage, job.kind]);
            if (moved.length) await platform.oldAdd(row.tenant_id, row.id, row.storage, row.mime, size);
            job.done++; job.movedBytes += size;
          } catch (error) { job.failed++; job.lastError = String(error.message || 'FAILED').slice(0, 80); }
        }
        hub.bump(); // every store forgets where its files live
        await writeJob({ ...job, lease: clock() + budgetMs + 15000, leaseId: lease.id });
      }
    } finally {
      job.lease = 0; job.leaseId = '';
      await writeJob(job);
      hub.bump(); platform.forget();
    }
    return status();
  }
  async function cancel() {
    const job = await readJob();
    if (job?.status === 'running') { job.status = 'cancelled'; job.finishedAt = clock(); job.lease = 0; await writeJob(job); }
    return status();
  }

  // ---------- Old copies ----------
  async function cleanup({ limit = 200, budgetMs = 15000 } = {}) {
    const started = clock();
    let removed = 0, bytes = 0, kept = 0;
    const due = await platform.oldDue(clock() - OLD_AFTER_MS, limit);
    for (const old of due) {
      if (clock() - started > budgetMs) break;
      if (isLegacyOld(old)) { // the store's own copy under its prefix, left by a layout fix: removable once the shared object is verified
        try {
          const row = (await db.query('SELECT storage,size,ns FROM media WHERE tenant_id=$1 AND id=$2', [old.tenant_id, old.id]))[0];
          const name = fileName(old), adapter = adapters[adapterKey(old.storage)];
          if (!adapter) { kept++; continue; }
          if (row) {
            const live = row.storage === 'db' ? true : Number(row.ns) === 1 ? await adapters[adapterKey(row.storage)]?.head(keyFor('default')(name)) : null;
            if (!live || (live !== true && row.size != null && live.size !== Number(row.size))) { kept++; continue; }
          }
          await adapter.remove(keyFor(old.tenant_id)(name));
          await platform.oldDel(old.tenant_id, old.id, old.storage);
          removed++; bytes += Number(old.size || 0);
        } catch { kept++; }
        continue;
      }
      // The row that tells where the file lives now: the store's own, else any row of the shared object (the store itself may be gone).
      const current = (await db.query("SELECT tenant_id,storage,size,ns FROM media WHERE id=$2 AND storage IN ('r2','fs','db') AND (tenant_id=$1 OR ns=1 OR tenant_id='default') ORDER BY (tenant_id=$1) DESC LIMIT 1", [old.tenant_id, old.id]))[0];
      const key = current ? keyOfRow(current.tenant_id, { ...current, id: old.id, mime: old.mime }) : keyFor('default')(fileName(old));
      if (!current) { // nothing points at the file any more: its old copy is garbage (best effort), the record goes either way
        try { if (old.storage !== 'db') await adapters[adapterKey(old.storage)]?.remove(key); } catch { /* nothing to do */ }
        await platform.oldDel(old.tenant_id, old.id, old.storage);
        continue;
      }
      try {
        // Never delete the last good copy: the file must be present in the storage the row points at, with the expected size.
        const live = current.storage === 'db' ? true : await adapters[adapterKey(current.storage)]?.head(key);
        if (!live || current.storage === old.storage || (live !== true && current.size != null && live.size !== Number(current.size))) { kept++; continue; }
        if (old.storage === 'db') await db.query("UPDATE media SET body=NULL, data='' WHERE id=$2 AND storage<>'db' AND (tenant_id=$1 OR ns=1 OR tenant_id='default')", [old.tenant_id, old.id]);
        else await adapters[adapterKey(old.storage)].remove(key);
        await platform.oldDel(old.tenant_id, old.id, old.storage);
        removed++; bytes += Number(old.size || 0);
      } catch { kept++; }
    }
    return { removed, bytes, kept, due: due.length };
  }
  async function oldCopies() {
    const row = await platform.oldSummary();
    const files = Number(row.files), first = row.first == null ? null : Number(row.first);
    return { files, bytes: Number(row.bytes), oldestAt: first, cleanableAt: first == null ? null : first + OLD_AFTER_MS, cleanable: first != null && first + OLD_AFTER_MS <= clock() };
  }

  // ---------- Every file of the platform ----------
  /**
   * Who points at what, across the whole platform: id -> { content: Set(store), client: Set(store) }.
   *   content  what a store (or demo, or theme) SHOWS: content items and documents, settings, administrator avatars, campaigns, theme snapshots.
   *   client   what clients of a store hold: render requests and personal spaces (a deleted file would break their history).
   * One SQL pass per table: the database extracts the ids, only (store, id) pairs travel.
   */
  async function references() {
    const found = new Map();
    const mark = (id, who, kind) => { let entry = found.get(id); if (!entry) found.set(id, entry = { content: new Set(), client: new Set() }); entry[kind].add(who); };
    const RE = "'/api/media/([a-f0-9]{32})\\.'";
    const scan = async (table, column, kind, owner = 't.tenant_id') => {
      for (const row of await db.query(`SELECT DISTINCT ${owner} AS owner, m[1] AS id FROM ${table} t, regexp_matches(t.${column}, ${RE}, 'g') AS m`)) mark(row.id, row.owner, kind);
    };
    await scan('content_items', 'data', 'content'); await scan('content_docs', 'data', 'content'); await scan('settings', 'value', 'content');
    await scan('admin_accounts', 'avatar', 'content'); await scan('campaigns', 'data', 'content');
    for (const row of await platform.themeRefs(RE)) mark(row.id, row.owner, 'content');
    await scan('requests', 'data', 'client'); await scan('space', 'value', 'client');
    return found;
  }

  /** Names of everything that can own a file row: stores, demos, the main store, themes. */
  async function ownersMap() {
    const out = new Map();
    const { tenants, themes } = await platform.owners();
    for (const row of tenants) out.set(row.id, { id: row.id, name: row.name, slug: row.slug, kind: row.kind });
    for (const row of themes) out.set(row.id, { id: row.id, name: row.name, slug: '', kind: 'theme' });
    return out;
  }
  const ownerOf = (map, id) => map.get(id) || { id, name: id, slug: '', kind: 'gone' };

  /**
   * One line per distinct FILE (the hash), however many stores hold a row for it: where it is stored, how many bytes (all copies), who owns it,
   * whether any store / demo / theme still shows it, whether clients' history holds it. `usage`: all | used | unused. Pages of `limit`.
   */
  async function library({ q = '', kind = '', usage = 'all', storage = '', owner = '', sort = 'new', limit = 50, offset = 0 } = {}) {
    const [rows, refs, owners] = await Promise.all([
      db.query("SELECT tenant_id,id,mime,size,storage,ns,lib,title,created_at FROM media WHERE storage<>'pending'"), references(), ownersMap(),
    ]);
    const files = new Map();
    for (const row of rows) {
      let f = files.get(row.id);
      if (!f) files.set(row.id, f = { id: row.id, mime: row.mime, createdAt: Number(row.created_at), lib: false, title: '', owners: new Set(), objects: new Map() });
      f.owners.add(row.tenant_id);
      f.createdAt = Math.min(f.createdAt, Number(row.created_at));
      if (Number(row.lib)) f.lib = true;
      if (row.title && !f.title) f.title = row.title;
      const slot = isShared(row) || row.tenant_id === 'default' ? '' : row.tenant_id;
      if (!f.objects.has(slot)) f.objects.set(slot, { size: row.size == null ? 0 : Number(row.size), storage: row.storage, tenant: row.tenant_id, ns: Number(row.ns) });
    }
    const needle = String(q || '').trim().toLowerCase().slice(0, 80);
    let list = [];
    const totals = { files: 0, bytes: 0, unused: { files: 0, bytes: 0 }, duplicates: { files: 0, bytes: 0 }, legacy: { files: 0, bytes: 0 } };
    for (const f of files.values()) {
      const objects = [...f.objects.values()];
      const bytes = objects.reduce((n, o) => n + o.size, 0);
      const ref = refs.get(f.id);
      const used = !!ref?.content.size, inClientData = !!ref?.client.size;
      const stores = new Set(objects.map(o => o.storage));
      const legacy = objects.some(o => o.ns === 0 && o.tenant !== 'default' && (o.storage === 'r2' || o.storage === 'fs'));
      const item = {
        id: f.id, mime: f.mime, kind: kindOfMime(f.mime), size: Math.max(0, ...objects.map(o => o.size)), bytes, copies: objects.length,
        storage: stores.size === 1 ? [...stores][0] : 'mixed', createdAt: f.createdAt, title: f.title, inLibrary: f.lib,
        used, inClientData, legacy, owners: [...f.owners].map(id => ownerOf(owners, id)),
        usedBy: ref ? [...ref.content].map(id => ownerOf(owners, id)) : [],
      };
      totals.files++; totals.bytes += bytes;
      if (!used && !inClientData) { totals.unused.files++; totals.unused.bytes += bytes; }
      if (objects.length > 1) { totals.duplicates.files++; totals.duplicates.bytes += bytes - item.size; }
      if (legacy) { totals.legacy.files++; totals.legacy.bytes += bytes; }
      if (kind && item.kind !== kind) continue;
      if (usage === 'used' && !(used || inClientData)) continue;
      if (usage === 'unused' && (used || inClientData)) continue;
      if (storage && item.storage !== storage) continue;
      if (owner && !f.owners.has(owner)) continue;
      if (needle && !(f.title.toLowerCase().includes(needle) || f.id.startsWith(needle) || item.owners.some(o => o.name.toLowerCase().includes(needle)))) continue;
      list.push(item);
    }
    list.sort(sort === 'size' ? (a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1) : sort === 'old' ? (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1) : (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
    const n = Math.max(1, Math.min(200, Number(limit) || 50)), skip = Math.max(0, Number(offset) || 0);
    const page = list.slice(skip, skip + n);
    const r2 = adapters.r2;
    for (const item of page) {
      const f = files.get(item.id), shared = f.objects.get('');
      const only = shared || [...f.objects.values()][0];
      item.preview = item.kind === 'image' && only?.storage === 'r2' && r2 ? r2.publicUrl(only === shared ? keyFor('default')(fileName(item)) : keyFor(only.tenant)(fileName(item))) : '';
    }
    return { items: page, total: list.length, more: skip + n < list.length, totals, owners: [...owners.values()].sort((a, b) => a.name.localeCompare(b.name)).map(o => ({ id: o.id, name: o.name, kind: o.kind })) };
  }
  function kindOfMime(mime) { return String(mime).startsWith('video/') ? 'video' : String(mime).startsWith('audio/') ? 'audio' : 'image'; }

  /** Removes one stored copy. Throws when the storage refuses (the caller then keeps the row). */
  async function removeCopy(storage, key) {
    if (storage === 'db') return;
    const adapter = adapters[adapterKey(storage)];
    if (!adapter) throw fail(503, 'STORAGE_UNAVAILABLE');
    await adapter.remove(key);
  }
  /**
   * Deletes whole FILES from the platform: every row of every store, every stored copy, every old copy a move left. The platform owner's tool: a file
   * that a store/demo/theme still shows (`used`) or that clients' history holds is refused unless `force`.
   * `allUnused` = every file nobody uses (no store, demo, theme or client), except files younger than a day and files kept in a store library
   * (people upload there on purpose: those only go by an explicit selection). Time-boxed: `remaining` tells the console to call again.
   */
  async function deleteFiles({ ids = [], force = false, allUnused = false, budgetMs = 15000 } = {}) {
    const started = clock();
    const refs = await references();
    let list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(id => /^[a-f0-9]{32}$/.test(id)))].slice(0, 500);
    let pool = null;
    if (allUnused) {
      pool = (await db.query("SELECT id, MAX(lib) AS lib, MIN(created_at) AS created FROM media WHERE storage<>'pending' GROUP BY id")).filter(r => !refs.has(r.id) && !Number(r.lib) && Number(r.created) < clock() - 24 * HOUR).map(r => r.id);
      list = pool.slice(0, 300);
    }
    const removed = [], blocked = [];
    let bytes = 0;
    for (const id of list) {
      if (clock() - started > budgetMs) break;
      const rows = await db.query('SELECT tenant_id,id,mime,storage,ns,size,created_at FROM media WHERE id=$1', [id]);
      if (!rows.length) { blocked.push({ id, reason: 'NOT_FOUND' }); continue; }
      if (!force && !allUnused && (refs.get(id)?.content.size || refs.get(id)?.client.size)) { blocked.push({ id, reason: refs.get(id).content.size ? 'IN_USE' : 'IN_CLIENT_DATA' }); continue; }
      if (rows.some(r => r.storage === 'pending' && Number(r.created_at) > clock() - HOUR)) { blocked.push({ id, reason: 'UPLOADING' }); continue; }
      try {
        const copies = new Map(); // storage|key -> size
        for (const row of rows) {
          if (!EXT[row.mime]) continue;
          if (row.storage === 'r2' || row.storage === 'fs') copies.set(`${row.storage}|${keyOfRow(row.tenant_id, row)}`, Number(row.size || 0));
          for (const old of await platform.oldList(row.tenant_id, [id])) {
            if (old.storage === 'db') continue;
            copies.set(`${adapterKey(old.storage)}|${isLegacyOld(old) ? keyFor(row.tenant_id)(fileName(old)) : keyOfRow(row.tenant_id, row)}`, 0);
          }
        }
        for (const [copy] of copies) { const at = copy.indexOf('|'); await removeCopy(copy.slice(0, at), copy.slice(at + 1)); }
        for (const row of rows) await platform.oldDropFile?.(row.tenant_id, id);
        await db.query('DELETE FROM media WHERE id=$1', [id]);
        bytes += [...copies.values()].reduce((n, v) => n + v, 0) || rows.reduce((n, r) => n + Number(r.size || 0), 0) / Math.max(1, rows.length);
        removed.push(id);
      } catch { blocked.push({ id, reason: 'STORAGE_ERROR' }); }
    }
    hub.bump(); platform.forget();
    const done = new Set([...removed, ...blocked.map(b => b.id)]);
    return { removed, blocked, bytes: Math.round(bytes), ...(pool ? { remaining: pool.filter(id => !done.has(id)).length } : {}) };
  }

  // ---------- Storage audit & repair ----------
  /** Every object of ours in every available storage: kind -> { available, complete, error, objects: Map(key -> { size, modified }) }. */
  async function listStorages() {
    const out = {};
    for (const kind of ['r2', 'fs']) {
      const adapter = adapters[kind];
      if (!adapter) { out[kind] = { available: false, complete: false, objects: new Map() }; continue; }
      if (!adapter.list) { out[kind] = { available: true, complete: false, error: 'LIST_UNSUPPORTED', objects: new Map() }; continue; }
      try {
        const objects = new Map();
        for (const prefix of ['media/', 't/']) for (const object of await adapter.list(prefix)) if (KEY_SHAPE.test(object.key)) objects.set(object.key, object);
        out[kind] = { available: true, complete: true, objects };
      } catch (error) { out[kind] = { available: true, complete: false, error: String(error?.name || error?.code || error?.message || 'LIST_FAILED').slice(0, 60), objects: new Map() }; }
    }
    return out;
  }

  /**
   * Compares the database with what the storages really hold. Read-only. Returns the full findings (`plan`, used by `repair`) and a summary.
   * A storage whose listing failed (or came back suspiciously empty while the database expects files in it) is reported as unchecked and is
   * NEVER treated as "files missing": nothing is decided about a storage we could not read.
   */
  async function inspect() {
    const stores = await listStorages();
    const rows = (await db.query("SELECT tenant_id,id,mime,size,storage,ns,created_at FROM media WHERE storage IN ('r2','fs','db','pending')")).filter(r => EXT[r.mime]);
    const olds = await platform.oldAll();
    const claimed = { r2: new Set(), fs: new Set() };
    const rowOf = new Map(rows.map(r => [`${r.tenant_id}|${r.id}`, r]));
    const expect = { r2: 0, fs: 0 };
    for (const row of rows) {
      if (row.storage === 'pending') claimed.r2.add(keyFor('default')(fileName(row)));
      else if (row.storage === 'r2' || row.storage === 'fs') { claimed[row.storage].add(keyOfRow(row.tenant_id, row)); expect[row.storage]++; }
    }
    for (const old of olds) {
      if (old.storage === 'db') continue;
      const row = rowOf.get(`${old.tenant_id}|${old.id}`);
      const key = isLegacyOld(old) ? keyFor(old.tenant_id)(fileName(old)) : row ? keyOfRow(old.tenant_id, row) : keyFor('default')(fileName(old));
      claimed[adapterKey(old.storage)].add(key);
    }
    for (const kind of ['r2', 'fs']) { // a listing that finds nothing while the database expects many files = wrong bucket / unmounted disk, not "all missing"
      const s = stores[kind];
      if (s.complete && s.objects.size === 0 && expect[kind] >= 5) { s.complete = false; s.error = 'LOOKS_EMPTY'; }
    }
    const trusted = kind => !!stores[kind]?.complete;
    const plan = { missing: [], wrong: [], prefix: [], legacy: [], sizeUnknown: [], sizeMismatch: [], orphans: [], inDatabase: { files: 0, bytes: 0 } };
    const legacyIds = new Map(); // id -> number of own-prefix copies
    for (const row of rows) {
      if (row.storage === 'db') { plan.inDatabase.files++; plan.inDatabase.bytes += Number(row.size || 0); continue; }
      if (row.storage === 'pending') continue;
      const kind = row.storage, name = fileName(row);
      if (!trusted(kind)) continue;
      const key = keyOfRow(row.tenant_id, row), object = stores[kind].objects.get(key);
      const base = { tenant: row.tenant_id, id: row.id, mime: row.mime, storage: row.storage, ns: Number(row.ns), size: row.size == null ? null : Number(row.size), key };
      const legacyRow = Number(row.ns) === 0 && row.tenant_id !== 'default';
      if (!object) {
        const sharedKey = keyFor('default')(name), ownKey = keyFor(row.tenant_id)(name);
        const other = kind === 'r2' ? 'fs' : 'r2';
        if (legacyRow && stores[kind].objects.has(sharedKey)) { plan.legacy.push({ ...base, sourceMissing: true, targetExists: true }); continue; }
        if (!legacyRow && row.tenant_id !== 'default' && stores[kind].objects.has(ownKey)) { plan.prefix.push({ ...base, from: ownKey }); continue; }
        if (trusted(other) && stores[other].objects.has(key)) { plan.wrong.push({ ...base, to: other }); continue; }
        plan.missing.push(base);
        continue;
      }
      if (base.size == null) plan.sizeUnknown.push({ ...base, actual: object.size });
      else if (object.size !== base.size) plan.sizeMismatch.push({ ...base, actual: object.size });
      if (legacyRow || (Number(row.ns) === 0 && row.tenant_id === 'default')) {
        const targetExists = stores[kind].objects.has(keyFor('default')(name));
        plan.legacy.push({ ...base, actual: object.size, targetExists });
        if (legacyRow) legacyIds.set(`${kind}|${row.id}`, (legacyIds.get(`${kind}|${row.id}`) || 0) + 1);
      }
    }
    const idsHeld = new Map();
    for (const row of rows) { if (!idsHeld.has(row.id)) idsHeld.set(row.id, []); idsHeld.get(row.id).push(row); }
    for (const kind of ['r2', 'fs']) {
      if (!trusted(kind)) continue;
      for (const [key, object] of stores[kind].objects) {
        if (claimed[kind].has(key)) continue;
        const name = key.slice(key.lastIndexOf('/') + 1), id = name.slice(0, 32);
        const prefixTenant = key.startsWith('t/') ? key.split('/')[1] : null;
        plan.orphans.push({ key, storage: kind, size: object.size, modified: object.modified || 0, id, tenant: prefixTenant, recent: (object.modified || 0) > clock() - HOUR, held: idsHeld.has(id) });
      }
    }
    // Reclaimable: legacy copies that become redundant once every row of that file points at the shared object.
    let reclaimBytes = 0, reclaimFiles = 0;
    const seen = new Set();
    for (const item of plan.legacy) {
      if (item.tenant === 'default' || item.sourceMissing) continue;
      const k = `${item.storage}|${item.id}`;
      const sharedHere = item.targetExists || seen.has(k);
      if (sharedHere) { reclaimBytes += item.actual || item.size || 0; reclaimFiles++; }
      seen.add(k);
    }
    const sum = list => ({ files: list.length, bytes: list.reduce((n, o) => n + (o.size || 0), 0) });
    const deletable = plan.orphans.filter(o => !o.recent);
    const summary = {
      rows: rows.length,
      storages: Object.fromEntries(['r2', 'fs'].map(kind => [kind, { available: stores[kind].available, checked: trusted(kind), error: stores[kind].error || '', objects: stores[kind].objects.size, bytes: [...stores[kind].objects.values()].reduce((n, o) => n + o.size, 0) }])),
      missing: { files: plan.missing.length }, wrongStorage: { files: plan.wrong.length }, strayPrefix: { files: plan.prefix.length },
      legacy: { ...sum(plan.legacy.filter(x => !x.sourceMissing || x.targetExists)), reclaimFiles, reclaimBytes },
      sizeMismatch: { files: plan.sizeMismatch.length }, sizeUnknown: { files: plan.sizeUnknown.length },
      orphans: { ...sum(plan.orphans), deletable: deletable.length, deletableBytes: sum(deletable).bytes, recent: plan.orphans.length - deletable.length },
      inDatabase: plan.inDatabase,
    };
    summary.healthy = !summary.missing.files && !summary.wrongStorage.files && !summary.strayPrefix.files && !summary.legacy.files && !summary.sizeMismatch.files && !summary.orphans.files;
    return { plan, summary, stores };
  }
  async function audit() {
    const { plan, summary } = await inspect();
    const owners = await ownersMap();
    const name = id => ownerOf(owners, id).name;
    const view = item => ({ id: item.id, store: name(item.tenant), storage: item.storage, key: item.key, size: item.size ?? item.actual ?? null });
    return {
      at: clock(), ...summary,
      samples: {
        missing: plan.missing.slice(0, 20).map(view), wrongStorage: plan.wrong.slice(0, 10).map(view), strayPrefix: plan.prefix.slice(0, 10).map(view),
        legacy: plan.legacy.slice(0, 20).map(view), sizeMismatch: plan.sizeMismatch.slice(0, 10).map(view),
        orphans: plan.orphans.slice(0, 20).map(o => ({ key: o.key, storage: o.storage, size: o.size, recent: o.recent, store: o.tenant ? name(o.tenant) : '' })),
      },
    };
  }

  /** Copies the store's own legacy object to the shared key (never overwrites). Returns 'ok' | 'conflict' | 'missing'. */
  async function ensureShared(item, adapter) {
    const name = fileName(item), shared = keyFor('default')(name), own = keyFor(item.tenant)(name);
    const source = await adapter.head(own).catch(() => null);
    const target = await adapter.head(shared).catch(() => null);
    if (!source && !target) return { state: 'missing' };
    if (target) {
      if (source && target.size !== source.size) return { state: 'conflict' };
      if (!source && item.size != null && target.size !== Number(item.size)) return { state: 'conflict' };
      return { state: 'ok', source };
    }
    if (adapter.copy) await adapter.copy(own, shared); else await adapter.put(shared, await adapter.get(own), item.mime);
    const written = await adapter.head(shared);
    if (!written || written.size !== source.size) { await adapter.remove(shared).catch(() => {}); throw fail(502, 'VERIFY_FAILED'); }
    return { state: 'ok', source, created: true };
  }

  /**
   * Brings the storage in line with the database. Everything here is idempotent, guarded by what the row says right now, and time-boxed
   * (`remaining` > 0: call again). Never deletes the last copy of anything. Steps, in this order:
   *   1 sizes          fill in unknown sizes; correct a wrong size only when the stored bytes hash to the file's id (proof they are intact)
   *   2 storage        a row that points at the wrong storage (the object is in the other one) is pointed at the right one
   *   3 prefix         a shared row whose object only exists under the store's own prefix: copy it to the shared key
   *   4 legacy         rows still at `t/<store>/media/...` join the shared namespace (copy once -> verify -> flag the row); the old copy is kept 24 h
   *                    and removed by the normal "old copies" cleanup after it is verified again
   *   5 broken (opt-in)  rows whose object exists nowhere: removed, so the stores stop pointing at a file that cannot be read
   *   6 orphans (opt-in) objects no row (and no kept old copy) points at, older than an hour, and whose file is safe elsewhere or unknown to the database
   */
  async function repair({ orphans = false, broken = false, budgetMs = 20000 } = {}) {
    if ((await status()).status === 'running') throw fail(409, 'MOVE_RUNNING');
    const started = clock();
    const { plan, summary, stores } = await inspect();
    const out = { sizes: 0, repointed: 0, copied: 0, migrated: 0, orphansDeleted: 0, orphanBytes: 0, brokenRemoved: 0, failed: 0, skipped: 0 };
    let pending = 0;
    const time = () => clock() - started < budgetMs;
    const bump = () => { hub.bump(); platform.forget(); };
    const adapterOfRow = item => adapters[adapterKey(item.storage)];
    const sharedRows = item => (item.ns === 1 || item.tenant === 'default');

    // 1 sizes
    for (const item of plan.sizeUnknown) {
      if (!time()) { pending++; continue; }
      try { await db.query('UPDATE media SET size=$3 WHERE tenant_id=$1 AND id=$2 AND size IS NULL', [item.tenant, item.id, item.actual]); out.sizes++; } catch { out.failed++; }
    }
    for (const item of plan.sizeMismatch) {
      if (!time()) { pending++; continue; }
      try {
        if (item.actual > HASH_LIMIT || !adapterOfRow(item)) { out.skipped++; continue; }
        const body = await adapterOfRow(item).get(item.key);
        if (idOf(body) !== item.id || body.length !== item.actual) { out.skipped++; continue; } // cannot prove the bytes are intact: leave it for a human
        if (sharedRows(item)) await db.query("UPDATE media SET size=$2 WHERE id=$1 AND (ns=1 OR tenant_id='default') AND storage=$3", [item.id, item.actual, item.storage]);
        else await db.query('UPDATE media SET size=$2 WHERE id=$1 AND tenant_id=$4 AND storage=$3', [item.id, item.actual, item.storage, item.tenant]);
        out.sizes++;
      } catch { out.failed++; }
    }
    // 2 storage
    for (const item of plan.wrong) {
      if (!time()) { pending++; continue; }
      try {
        const target = adapters[adapterKey(item.to)];
        const head = await target?.head(item.key);
        if (!head || (item.size != null && head.size !== item.size)) { out.skipped++; continue; }
        const done = sharedRows(item)
          ? await db.query("UPDATE media SET storage=$3 WHERE id=$1 AND storage=$2 AND (ns=1 OR tenant_id='default') RETURNING id", [item.id, item.storage, item.to])
          : await db.query('UPDATE media SET storage=$3 WHERE id=$1 AND storage=$2 AND tenant_id=$4 RETURNING id', [item.id, item.storage, item.to, item.tenant]);
        if (done.length) out.repointed++;
      } catch { out.failed++; }
    }
    // 3 prefix
    for (const item of plan.prefix) {
      if (!time()) { pending++; continue; }
      try { const r = await ensureShared(item, adapterOfRow(item)); if (r.state === 'ok' && r.created) out.copied++; else if (r.state !== 'ok') out.skipped++; } catch { out.failed++; }
    }
    // 4 legacy
    for (const item of plan.legacy) {
      if (!time()) { pending++; continue; }
      try {
        if (item.tenant === 'default') {
          if ((await db.query("UPDATE media SET ns=1 WHERE tenant_id='default' AND id=$1 AND ns=0 AND storage=$2 RETURNING id", [item.id, item.storage])).length) out.migrated++;
          continue;
        }
        const adapter = adapterOfRow(item);
        if (!adapter) { out.skipped++; continue; }
        const r = await ensureShared(item, adapter);
        if (r.state !== 'ok') { out.skipped++; continue; }
        const flipped = await db.query('UPDATE media SET ns=1 WHERE tenant_id=$1 AND id=$2 AND ns=0 AND storage=$3 RETURNING id', [item.tenant, item.id, item.storage]);
        if (flipped.length) {
          out.migrated++;
          if (r.source) await platform.oldAdd(item.tenant, item.id, `legacy-${item.storage}`, item.mime, r.source.size);
        } else if (r.created) {
          // The row went away while we copied (a store deleted it): do not leave the new object behind unless somebody else uses it now.
          const left = await db.query("SELECT 1 FROM media WHERE id=$1 AND storage=$2 AND (ns=1 OR tenant_id='default') LIMIT 1", [item.id, item.storage]);
          if (!left.length) await adapter.remove(keyFor('default')(fileName(item))).catch(() => {});
        }
      } catch { out.failed++; }
    }
    // 5 broken rows
    if (broken) {
      for (const item of plan.missing) {
        if (!time()) { pending++; continue; }
        try {
          const live = await adapterOfRow(item)?.head(item.key);
          if (live) { out.skipped++; continue; } // it is there after all
          if ((await db.query('DELETE FROM media WHERE tenant_id=$1 AND id=$2 AND storage=$3 RETURNING id', [item.tenant, item.id, item.storage])).length) out.brokenRemoved++;
        } catch { out.failed++; }
      }
    }
    // 6 orphans
    if (orphans) {
      for (const o of plan.orphans) {
        if (!time()) { pending++; continue; }
        if (o.recent) { out.skipped++; continue; }
        try {
          const adapter = adapters[o.storage];
          if (!adapter || !stores[o.storage].complete) { out.skipped++; continue; }
          const rows = await db.query('SELECT tenant_id,id,mime,storage,ns FROM media WHERE id=$1', [o.id]);
          // Never remove an object a row claims (a row may have appeared since the listing), nor the only copy of a file the database knows.
          if (rows.some(row => row.storage !== 'db' && row.storage !== 'pending' && adapters[adapterKey(row.storage)] === adapter && keyOfRow(row.tenant_id, row) === o.key) || rows.some(row => row.storage === 'pending')) { out.skipped++; continue; }
          if (rows.length) {
            let safe = false;
            for (const row of rows) { if (row.storage === 'r2' || row.storage === 'fs') { const alive = await adapters[row.storage]?.head(keyOfRow(row.tenant_id, row)).catch(() => null); if (alive) { safe = true; break; } } }
            if (!safe) { out.skipped++; continue; }
          }
          await adapter.remove(o.key);
          out.orphansDeleted++; out.orphanBytes += o.size;
        } catch { out.failed++; }
      }
    }
    bump();
    return { ...out, remaining: pending, before: summary.healthy, partial: pending > 0 };
  }

  // ---------- Reporting ----------
  async function totals() {
    const by = {};
    for (const row of await db.query(`SELECT storage, COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM (${OBJECTS} WHERE storage IN ${SETTLED}) o GROUP BY storage`)) by[row.storage] = { files: Number(row.files), bytes: Number(row.bytes) };
    return { r2: by.r2 || { files: 0, bytes: 0 }, app: by.fs || { files: 0, bytes: 0 }, database: by.db || { files: 0, bytes: 0 } };
  }
  /** Files and bytes per store (a file two stores share counts for both: it is in both libraries). */
  async function perStore() {
    const out = new Map();
    for (const row of await db.query(`SELECT tenant_id, COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM media WHERE storage IN ${SETTLED} GROUP BY tenant_id`)) out.set(row.tenant_id, { files: Number(row.files), bytes: Number(row.bytes) });
    return out;
  }

  return { copyRows, purgeRows, move: { start, step, status, cancel }, cleanup, oldCopies, totals, perStore, library, deleteFiles, audit, repair, OLD_AFTER_MS };
}

module.exports = { createMediaOps, OLD_AFTER_MS };
