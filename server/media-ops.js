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
const { keyFor, EXT } = require('./media');

const OLD_AFTER_MS = 24 * 3600 * 1000;
const KINDS = { r2: 'r2', app: 'fs' };
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const fileName = row => `${row.id}.${EXT[row.mime]}`;
const adapterKey = storage => (storage === 'fs' ? 'fs' : 'r2');

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

  return { copyRows, purgeRows, move: { start, step, status, cancel }, cleanup, oldCopies, totals, perStore, OLD_AFTER_MS };
}

module.exports = { createMediaOps, OLD_AFTER_MS };
