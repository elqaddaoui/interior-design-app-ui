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
const { keyFor, EXT, KEY_SHAPE, typeOfKey } = require('./media');

const OLD_AFTER_MS = 24 * 3600 * 1000;
const KINDS = { r2: 'r2', app: 'fs' };
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const fileName = row => `${row.id}.${EXT[row.mime]}`;
/** Which adapter a storage value names. `legacy-<storage>` = the store's own old copy left by a layout fix (see `consolidateOne`). */
const adapterKey = storage => (String(storage).replace(/^legacy-/, '') === 'fs' ? 'fs' : 'r2');
const isLegacyOld = old => String(old.storage).startsWith('legacy-');
const HOUR = 3600000;
const DB_LIMIT = 25 * 1024 * 1024; // a restore never puts a file bigger than this back into the database
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const HISTORY_KEEP = 30;
/** Operations whose restore point can be brought back. A cleanup only removes verified duplicates: it is recorded for the log, nothing to restore. */
const RESTORABLE = new Set(['consolidate', 'move', 'restore']);
const typeOfMime = mime => (String(mime).startsWith('image/') ? 'image' : String(mime).startsWith('video/') ? 'video' : String(mime).startsWith('audio/') ? 'audio' : 'other');
const sharedName = row => `media/${row.id}.${EXT[row.mime]}`;
/** SHA-256 of an object, read as a stream (one chunk in memory at a time). Throws when the object cannot be read. */
async function digestOf(adapter, key) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of await adapter.stream(key)) hash.update(chunk);
  return hash.digest('hex');
}
/** true ONLY when both objects exist and hold exactly the same bytes (size first, then the digest). Anything else, including an error, is false. */
async function sameBytes(a, keyA, b, keyB) {
  try {
    const [headA, headB] = await Promise.all([a.head(keyA), b.head(keyB)]);
    if (!headA || !headB || headA.size !== headB.size) return false;
    return (await digestOf(a, keyA)) === (await digestOf(b, keyB));
  } catch { return false; }
}
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
  async function start(target, { actor = '' } = {}) {
    const kind = KINDS[target];
    if (!kind) throw fail(400, 'INVALID_STORAGE');
    if (target === 'r2' && !adapters.r2) throw fail(409, 'R2_NOT_CONFIGURED');
    if (target === 'app') {
      const info = await hub.appInfo();
      if (!info.available) throw fail(409, 'APP_STORAGE_UNAVAILABLE');
    }
    if (consolidating) throw fail(409, 'CONSOLIDATE_RUNNING');
    const current = await readJob();
    if (current?.status === 'running' && current.lease > clock()) throw fail(409, 'MOVE_RUNNING');
    const todo = await countToMove(kind);
    // The restore point is saved BEFORE the first file moves: where every file lives now, and the stats the console showed.
    const historyId = todo.files ? await recordHistory('move', { actor, label: target, stats: { target, todo, totals: await totals() } }) : '';
    const job = { status: todo.files ? 'running' : 'done', historyId, target, kind, startedAt: clock(), finishedAt: todo.files ? null : clock(), total: todo.files, bytes: todo.bytes, done: 0, failed: 0, movedBytes: 0, cursor: ['', ''], lastError: '', lease: 0 };
    await writeJob(job);
    return status();
  }
  /** Reads one file as bytes or a stream and writes it to the target adapter. Throws when the source is missing or the copy does not verify. */
  async function transfer(tenantId, row, kind) {
    const key = row.storage === 'db' ? sharedName(row) : keyOfRow(tenantId, row), target = adapters[kind]; // bytes kept in the database always land in media/
    if (!target) throw fail(503, kind === 'fs' ? 'APP_STORAGE_UNAVAILABLE' : 'R2_NOT_CONFIGURED');
    let size, source, bytes;
    if (row.storage === 'db') {
      const stored = (await db.query('SELECT data,body FROM media WHERE tenant_id=$1 AND id=$2', [tenantId, row.id]))[0];
      let body = stored?.body ? Buffer.from(stored.body) : stored?.data ? Buffer.from(stored.data, 'base64') : null;
      if (!body?.length) body = await hub.shared.body(row.id); // another store's row holds the bytes
      if (!body?.length) throw fail(404, 'SOURCE_MISSING');
      bytes = body;
      size = body.length;
    } else {
      source = adapters[adapterKey(row.storage)];
      if (!source) throw fail(503, row.storage === 'fs' ? 'APP_STORAGE_UNAVAILABLE' : 'R2_NOT_CONFIGURED');
      const probe = await source.head(key);
      if (!probe) throw fail(404, 'SOURCE_MISSING');
      size = probe.size;
    }
    const expected = row.size == null ? size : Number(row.size);
    if (expected !== size) throw fail(502, 'VERIFY_FAILED');
    const matches = async () => bytes
      ? (await target.head(key))?.size === size && (await digestOf(target, key)) === sha256(bytes)
      : sameBytes(source, key, target, key);
    if (await target.head(key)) {
      if (!(await matches())) throw fail(409, 'TARGET_CONFLICT');
      return size;
    }
    if (bytes) await target.put(key, bytes, row.mime);
    else if (target.putStream) await target.putStream(key, await source.stream(key));
    else await target.put(key, await source.get(key), row.mime);
    if (!(await matches())) {
      await target.remove(key).catch(() => {});
      throw fail(502, 'VERIFY_FAILED');
    }
    return size;
  }
  /** Bytes kept in the database were copied to media/ (verified by `transfer`): every store that holds the id points at media/ now. The bytes stay in the row until cleanup verifies them. */
  async function repointDb(row, kind, size) {
    const moved = await db.query("UPDATE media SET storage=$2, ns=1, size=$3 WHERE id=$1 AND storage='db' RETURNING tenant_id", [row.id, kind, size]);
    for (const m of moved) await platform.oldAdd(m.tenant_id, row.id, 'db', row.mime, size);
    return moved.length;
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
            if (row.storage === 'db') await repointDb(row, job.kind, size);
            else {
              const moved = isShared(row) || row.tenant_id === 'default'
                ? await db.query("UPDATE media SET storage=$3 WHERE id=$1 AND storage=$2 AND (ns=1 OR tenant_id='default') RETURNING id", [row.id, row.storage, job.kind])
                : await db.query('UPDATE media SET storage=$4 WHERE tenant_id=$1 AND id=$2 AND storage=$3 RETURNING id', [row.tenant_id, row.id, row.storage, job.kind]);
              if (moved.length) await platform.oldAdd(row.tenant_id, row.id, row.storage, row.mime, size);
            }
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

  // ---------- Transfer history (restore points) ----------
  /**
   * Saves a restore point BEFORE an operation touches any file: one history entry (what, when, who, the stats the console showed) and, unless
   * `snapshot` is false, where EVERY file of the platform lives right now (storage + folder). `restore` brings files back to exactly that.
   */
  async function recordHistory(op, { actor = '', label = '', stats = {}, snapshot = true } = {}) {
    const id = `mh_${crypto.randomBytes(6).toString('hex')}`;
    await platform.history.add(id, clock(), op, label, String(actor || '').slice(0, 80), stats);
    if (snapshot) await platform.history.snapshot(id, "m.storage IN ('r2','fs','db')");
    await platform.history.prune(HISTORY_KEEP);
    return id;
  }
  async function historyList() {
    const out = [];
    for (const row of await platform.history.list(HISTORY_KEEP)) {
      let stats = {}; try { stats = JSON.parse(row.stats || '{}'); } catch { /* an old row */ }
      const restorable = RESTORABLE.has(row.op) && Number(row.files) > 0;
      out.push({ id: row.id, at: Number(row.at), op: row.op, label: row.label, actor: row.actor, files: Number(row.files), bytes: Number(row.bytes), restoredAt: row.restored_at == null ? null : Number(row.restored_at), stats, restorable, changed: restorable ? await platform.history.stray(row.id) : 0 });
    }
    return out;
  }

  /** Puts one file back where the restore point says it was. 'restored' | 'conflict' (something else sits at the old place: untouched) | 'skip'. Throws when a copy cannot be proven. */
  async function restoreOne(row) {
    const tenant = row.tenant_id, fid = row.id, mime = row.mime;
    const to = { storage: row.storage0, ns: Number(row.ns0) }, from = { storage: row.storage1, ns: Number(row.ns1) };
    if (!EXT[mime] || !['r2', 'fs', 'db'].includes(from.storage) || !['r2', 'fs', 'db'].includes(to.storage)) return 'skip';
    const keyAt = ns => keyOfRow(tenant, { id: fid, mime, ns });
    const fromAdapter = from.storage === 'db' ? null : adapters[adapterKey(from.storage)];
    if (from.storage !== 'db' && !fromAdapter) throw fail(503, 'STORAGE_UNAVAILABLE');
    let bytes = null; // bytes kept in the database
    const dbBytes = async () => {
      const own = (await db.query('SELECT data,body FROM media WHERE tenant_id=$1 AND id=$2', [tenant, fid]))[0];
      return own?.body ? Buffer.from(own.body) : own?.data ? Buffer.from(own.data, 'base64') : await hub.shared.body(fid);
    };
    if (from.storage === 'db') { bytes = await dbBytes(); if (!bytes?.length) throw fail(404, 'SOURCE_MISSING'); }
    let size = row.size1 == null ? Number(row.size || 0) : Number(row.size1);
    if (to.storage === 'db') {
      // The retained original wins over a potentially damaged hosted copy.
      bytes ||= await dbBytes();
      if (!bytes) {
        const head = await fromAdapter.head(keyAt(from.ns));
        if (!head) throw fail(404, 'SOURCE_MISSING');
        if (head.size > DB_LIMIT) throw fail(413, 'TOO_LARGE_FOR_DATABASE');
        bytes = Buffer.from(await fromAdapter.get(keyAt(from.ns)));
      }
      size = bytes.length;
      const done = await db.query("UPDATE media SET storage='db', ns=$5, size=$6, body=$7, data='' WHERE tenant_id=$1 AND id=$2 AND storage=$3 AND ns=$4 RETURNING id", [tenant, fid, from.storage, from.ns, to.ns, size, bytes]);
      if (!done.length) return 'skip';
    } else {
      const target = adapters[adapterKey(to.storage)];
      if (!target) throw fail(503, 'STORAGE_UNAVAILABLE');
      const fromKey = keyAt(from.ns), toKey = keyAt(to.ns);
      if (!(fromAdapter === target && fromKey === toKey)) {
        const there = await target.head(toKey);
        const same = async () => (bytes ? (await target.head(toKey))?.size === bytes.length && (await digestOf(target, toKey)) === sha256(bytes) : sameBytes(fromAdapter, fromKey, target, toKey));
        if (there) { if (!(await same())) return 'conflict'; }
        else {
          if (bytes) await target.put(toKey, bytes, mime);
          else if (fromAdapter === target && target.copy) await target.copy(fromKey, toKey);
          else if (target.putStream) await target.putStream(toKey, await fromAdapter.stream(fromKey));
          else await target.put(toKey, await fromAdapter.get(fromKey), mime);
          if (!(await same())) { await target.remove(toKey).catch(() => {}); throw fail(502, 'VERIFY_FAILED'); }
        }
        size = (await target.head(toKey))?.size ?? size;
      }
      const done = await db.query('UPDATE media SET storage=$5, ns=$6, size=$7 WHERE tenant_id=$1 AND id=$2 AND storage=$3 AND ns=$4 RETURNING id', [tenant, fid, from.storage, from.ns, to.storage, to.ns, size]);
      if (!done.length) return 'skip';
    }
    // The file lives at the restored place again: records of "an old copy here" are obsolete. The place it left waits like any old copy.
    await platform.oldDel(tenant, fid, to.storage);
    if (to.ns === 0) await platform.oldDel(tenant, fid, `legacy-${to.storage}`);
    if (from.storage === 'db' && to.storage !== 'db') await platform.oldAdd(tenant, fid, 'db', mime, size);
    else if (from.storage !== 'db' && from.ns === 0 && to.ns === 1) await platform.oldAdd(tenant, fid, `legacy-${from.storage}`, mime, size);
    else if (from.storage !== 'db' && from.ns === to.ns && from.storage !== to.storage) await platform.oldAdd(tenant, fid, from.storage, mime, size);
    return 'restored';
  }

  /**
   * Brings every file back to where a restore point says it was. A restore point of its own (the state right now) is saved first, so a restore can
   * be undone too. Time-boxed and resumable (`partial` + `cursor`: call again with them), idempotent, refused while another move runs.
   * Copies are verified byte for byte; a different file at the old place is a conflict and nothing touches it.
   */
  async function restore(id, { cursor = ['', ''], budgetMs = 15000, actor = '', backup = '' } = {}) {
    const point = await platform.history.get(String(id || ''));
    if (!point || !RESTORABLE.has(point.op)) throw fail(404, 'NOT_FOUND');
    if ((await status()).status === 'running') throw fail(409, 'MOVE_RUNNING');
    if (consolidating) throw fail(409, 'CONSOLIDATE_RUNNING');
    consolidating = true;
    const started = clock();
    const out = { restored: 0, conflicts: 0, failed: 0, bytes: 0, left: 0, partial: false, cursor, backup, done: false };
    try {
      if (!backup) out.backup = await recordHistory('restore', { actor, label: point.id, stats: { from: point.id, op: point.op, at: Number(point.at) } });
      let at = Array.isArray(cursor) && cursor.length === 2 ? cursor.map(String) : ['', ''];
      scan: for (;;) {
        const rows = await platform.history.pending(point.id, at, 50);
        if (!rows.length) break;
        for (const row of rows) {
          if (clock() - started > budgetMs) { out.partial = true; break scan; }
          try {
            const result = await restoreOne(row);
            if (result === 'restored') { out.restored++; out.bytes += Number(row.size || 0); } else if (result === 'conflict') out.conflicts++;
          } catch { out.failed++; }
          at = [row.tenant_id, row.id];
        }
      }
      out.cursor = at;
      out.left = await platform.history.stray(point.id);
      out.done = !out.partial;
      if (out.done && !out.left) await platform.history.markRestored(point.id, clock());
    } finally { consolidating = false; hub.bump(); platform.forget(); }
    return out;
  }

  // ---------- Old copies ----------
  async function cleanup({ limit = 200, budgetMs = 15000, force = false, legacyOnly = false, actor = '' } = {}) {
    const started = clock();
    let removed = 0, bytes = 0, kept = 0;
    // Logged first (what was waiting, as the console showed it); the entry is dropped again when nothing was removed.
    const logged = await recordHistory('cleanup', { actor, snapshot: false, stats: { waiting: await oldCopies(), now: force } }).catch(() => '');
    // `force` = the owner chose to remove them now instead of waiting the 24 h; every copy is still verified before it goes.
    const due = await platform.oldDue(force ? clock() + 1 : clock() - OLD_AFTER_MS, limit, legacyOnly);
    for (const old of due) {
      if (clock() - started > budgetMs) break;
      if (isLegacyOld(old)) { // the store's own copy under its prefix, left by a layout fix: removable once the shared object is verified
        try {
          const row = (await db.query('SELECT storage,size,ns FROM media WHERE tenant_id=$1 AND id=$2', [old.tenant_id, old.id]))[0];
          const name = fileName(old), adapter = adapters[adapterKey(old.storage)];
          if (!adapter) { kept++; continue; }
          if (!row || !['r2', 'fs'].includes(row.storage) || Number(row.ns) !== 1
            || !(await sameBytes(adapter, keyFor(old.tenant_id)(name), adapters[adapterKey(row.storage)], keyFor('default')(name)))) { kept++; continue; }
          await adapter.remove(keyFor(old.tenant_id)(name));
          await platform.oldDel(old.tenant_id, old.id, old.storage);
          removed++; bytes += Number(old.size || 0);
        } catch { kept++; }
        continue;
      }
      // The row that tells where the file lives now: the store's own, else any row of the shared object (the store itself may be gone).
      const current = (await db.query("SELECT tenant_id,storage,size,ns FROM media WHERE id=$2 AND storage IN ('r2','fs','db') AND (tenant_id=$1 OR ns=1 OR tenant_id='default') ORDER BY (tenant_id=$1) DESC LIMIT 1", [old.tenant_id, old.id]))[0];
      const key = current ? keyOfRow(current.tenant_id, { ...current, id: old.id, mime: old.mime }) : keyFor('default')(fileName(old));
      if (!current) { kept++; continue; } // No proof that a live copy exists.
      try {
        // Never delete the last good copy: the file must be present in the storage the row points at, with the expected size.
        const live = current.storage === 'db' ? true : await adapters[adapterKey(current.storage)]?.head(key);
        if (!live || current.storage === old.storage || (live !== true && current.size != null && live.size !== Number(current.size))) { kept++; continue; }
        // Another row (a restore may be half way) that still points at this very object in the old storage keeps it alive.
        if (old.storage !== 'db') {
          const users = await db.query('SELECT tenant_id,ns FROM media WHERE id=$1 AND storage=$2', [old.id, old.storage]);
          if (users.some(u => keyOfRow(u.tenant_id, { id: old.id, mime: old.mime, ns: u.ns }) === key)) { kept++; continue; }
        }
        if (old.storage === 'db' && live !== true) { // the bytes kept in the database must be exactly the ones now in storage before they are cleared
          const holders = await db.query("SELECT data,body FROM media WHERE id=$2 AND (body IS NOT NULL OR data<>'') AND (tenant_id=$1 OR ns=1 OR tenant_id='default')", [old.tenant_id, old.id]);
          const stored = await digestOf(adapters[adapterKey(current.storage)], key);
          if (holders.some(h => sha256(h.body ? Buffer.from(h.body) : Buffer.from(h.data, 'base64')) !== stored)) { kept++; continue; }
        }
        if (old.storage === 'db') await db.query("UPDATE media SET body=NULL, data='' WHERE id=$2 AND storage<>'db' AND (tenant_id=$1 OR ns=1 OR tenant_id='default')", [old.tenant_id, old.id]);
        else {
          if (current.storage === 'db' || !(await sameBytes(adapters[adapterKey(old.storage)], key, adapters[adapterKey(current.storage)], key))) { kept++; continue; }
          await adapters[adapterKey(old.storage)].remove(key);
        }
        await platform.oldDel(old.tenant_id, old.id, old.storage);
        removed++; bytes += Number(old.size || 0);
      } catch { kept++; }
    }
    if (removed) { hub.bump(); platform.forget(); }
    if (logged) { if (removed) await platform.history.setStats(logged, { waiting: await oldCopies().catch(() => null), now: force, result: { removed, bytes, kept } }); else await platform.history.drop(logged).catch(() => {}); }
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

  // ---------- One folder: media/ ----------
  /**
   * Everything this app stores lives at `media/<hash>.<ext>` (new uploads, demo clones, restores and the migration script all write there).
   * Files written by older versions sit under their store's own folder (`t/<store>/media/<hash>.<ext>`): `consolidate` moves them into `media/`
   * and the old `t/` folders disappear with their last file (R2 has no real folders; on the server disk the empty directories are removed).
   * Only exact legacy paths backed by a media row or old-copy record are eligible. A path that looks like ours is not proof of ownership.
   *
   * Per file, in this order, each step guarded by what the previous one proved:
   *   1 copy      to `media/<name>` (never overwrites: when something is already there, the two objects are compared byte for byte instead)
   *   2 verify    same size and same SHA-256, including large files
   *   3 rows      the store's database row is pointed at the shared place (`ns = 1`)
   *   4 delete    the old object, and only now
   * A copy that cannot be verified is removed again; a DIFFERENT file that already sits at the target name is a conflict and is left completely
   * alone. A storage that cannot be listed is never treated as empty: nothing is decided about it.
   */
  const MIME_OF = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));
  const STRAY = /^t\/([a-z0-9][a-z0-9_-]{0,62})\/media\/([a-f0-9]{32}\.[a-z0-9]+)$/;
  const strayOf = key => { const m = STRAY.exec(key); return m ? { tenant: m[1], name: m[2] } : null; };
  async function ownedLegacyKeys(rows) {
    const keys = new Set();
    for (const row of rows) {
      if (EXT[row.mime] && !isShared(row) && row.tenant_id !== 'default') keys.add(`${row.storage}|${keyOfRow(row.tenant_id, row)}`);
    }
    for (const old of await platform.oldAll()) {
      if (EXT[old.mime] && isLegacyOld(old) && old.tenant_id !== 'default') keys.add(`${adapterKey(old.storage)}|${keyFor(old.tenant_id)(fileName(old))}`);
    }
    return keys;
  }

  /** Every object of ours in every available storage: kind -> { available, complete, error, objects: Map(key -> { size, modified }) }. */
  async function listStorages() {
    const out = {};
    for (const kind of ['r2', 'fs']) {
      const adapter = adapters[kind];
      if (!adapter) { out[kind] = { available: false, complete: false, objects: new Map() }; continue; }
      try {
        const objects = new Map();
        for (const prefix of ['media/', 't/']) for (const object of await adapter.list(prefix)) if (KEY_SHAPE.test(object.key)) objects.set(object.key, object);
        out[kind] = { available: true, complete: true, objects };
      } catch (error) { out[kind] = { available: true, complete: false, error: String(error?.name || error?.code || error?.message || 'LIST_FAILED').slice(0, 60), objects: new Map() }; }
    }
    return out;
  }

  /**
   * Read-only preview: what sits outside `media/` (by folder, then file by file: where it is and where it goes), what `media/` holds, and whether every
   * database row points at an object that exists (the check to read after a move). The lists are capped, the counts are complete.
   */
  async function consolidation({ limit = 300 } = {}) {
    const stores = await listStorages();
    const rows = await db.query("SELECT tenant_id,id,mime,size,storage,ns FROM media WHERE storage IN ('r2','fs')");
    const owned = await ownedLegacyKeys(rows);
    const owners = await ownersMap();
    // Files whose bytes still sit inside the database go to media/ of the storage in use too (nothing to move when the database IS the storage in use).
    const choice = await hub.choice();
    const target = choice === 'database' ? '' : choice;
    const inDb = (await db.query(`SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM (SELECT DISTINCT ON (id) id,size FROM media WHERE storage='db' ORDER BY id) o`))[0];
    const out = { at: clock(), storages: {}, folders: [], files: [], totals: { files: 0, bytes: 0, move: 0, merge: 0, conflict: 0 }, database: { files: Number(inDb.files), bytes: Number(inDb.bytes), target }, rows: { checked: 0, missing: 0, samples: [] } };
    if (target && out.database.files && limit > 0) {
      for (const row of await db.query("SELECT DISTINCT ON (id) tenant_id,id,mime,size FROM media WHERE storage='db' ORDER BY id LIMIT $1", [Math.min(limit, 100)])) {
        if (EXT[row.mime]) out.files.push({ storage: 'db', from: 'database', to: sharedName(row), size: Number(row.size || 0), action: 'move', store: ownerOf(owners, row.tenant_id).name });
      }
    }
    const folderOf = new Map();
    for (const kind of ['r2', 'fs']) {
      const s = stores[kind];
      const expected = rows.filter(r => r.storage === kind).length;
      // A listing that finds nothing while the database expects files is the wrong bucket / an unmounted disk, never "everything moved".
      const trusted = s.complete && !(s.objects.size === 0 && expected >= 5);
      const inside = [...s.objects].filter(([key]) => key.startsWith('media/'));
      out.storages[kind] = { available: s.available, checked: trusted, error: s.error || (s.complete && !trusted ? 'LOOKS_EMPTY' : ''), media: { files: inside.length, bytes: inside.reduce((n, [, o]) => n + o.size, 0) }, outside: 0 };
      if (!s.complete) continue;
      for (const [key, object] of s.objects) {
        const stray = strayOf(key);
        if (!stray || !owned.has(`${kind}|${key}`)) continue;
        const target = s.objects.get(`media/${stray.name}`);
        const action = !target ? 'move' : target.size === object.size ? 'merge' : 'conflict';
        out.storages[kind].outside++;
        out.totals.files++; out.totals.bytes += object.size; out.totals[action]++;
        const fk = `${kind}|${stray.tenant}`;
        if (!folderOf.has(fk)) { const folder = { storage: kind, path: `t/${stray.tenant}/media/`, store: ownerOf(owners, stray.tenant).name, files: 0, bytes: 0 }; folderOf.set(fk, folder); out.folders.push(folder); }
        const folder = folderOf.get(fk); folder.files++; folder.bytes += object.size;
        if (out.files.length < limit) out.files.push({ storage: kind, from: key, to: `media/${stray.name}`, size: object.size, action, store: folder.store });
      }
      if (trusted) {
        for (const row of rows) {
          if (row.storage !== kind) continue;
          out.rows.checked++;
          if (!s.objects.has(keyOfRow(row.tenant_id, row))) { out.rows.missing++; if (out.rows.samples.length < 20) out.rows.samples.push({ id: row.id, store: ownerOf(owners, row.tenant_id).name, storage: kind, key: keyOfRow(row.tenant_id, row) }); }
        }
      }
    }
    out.clean = !out.totals.files && !(target && out.database.files) && !out.rows.missing && Object.values(out.storages).every(s => !s.available || s.checked);
    return out;
  }

  let consolidating = false;
  /**
   * Brings one stray object into `media/`. Returns 'moved' (copied now) | 'merged' (media/ already held the same bytes) | 'waiting' (done earlier, the old
   * copy is only waiting for its 24 h) | 'conflict' | 'gone'. Throws (and leaves everything as it was) when the copy cannot be proven.
   * The OLD object is never deleted here: other server instances and browsers may still hold the old address for a while, so it is recorded as an
   * old copy and removed by `cleanup` (after 24 h, or at once when the owner asks), which verifies it again first.
   */
  async function consolidateOne(kind, adapter, key, { tenant, name }) {
    const id = name.slice(0, 32), target = `media/${name}`;
    const source = await adapter.head(key);
    if (!source) return 'gone'; // a concurrent run removed it already
    let created = false;
    if (await adapter.head(target)) {
      if (!(await sameBytes(adapter, key, adapter, target))) return 'conflict'; // another file under the same name: nothing is touched
    } else {
      await adapter.copy(key, target);
      created = true;
      if (!(await sameBytes(adapter, key, adapter, target))) { await adapter.remove(target).catch(() => {}); throw fail(502, 'VERIFY_FAILED'); }
    }
    // The bytes at media/ are proven to be the old file: the store's row points there now.
    await db.query('UPDATE media SET ns=1, size=$4 WHERE tenant_id=$1 AND id=$2 AND ns=0 AND storage=$3', [tenant, id, kind, source.size]);
    const left = await db.query('SELECT 1 FROM media WHERE tenant_id=$1 AND id=$2 AND ns=0 AND storage=$3 LIMIT 1', [tenant, id, kind]);
    if (left.length) { if (created) await adapter.remove(target).catch(() => {}); throw fail(409, 'ROW_NOT_UPDATED'); }
    hub.bump();
    const recorded = (await platform.oldList(tenant, [id])).some(old => old.storage === `legacy-${kind}`);
    if (!recorded) await platform.oldAdd(tenant, id, `legacy-${kind}`, MIME_OF[name.slice(33)] || 'image/png', source.size);
    return created ? 'moved' : recorded ? 'waiting' : 'merged';
  }

  /**
   * Moves every file outside `media/` into it. Time-boxed and resumable (`remaining` > 0: call again), idempotent, refused while a "move all"
   * between storages runs. Rows of a store that still name an old folder whose object is gone, while the same file (same size) is in `media/`,
   * are pointed at `media/` too.
   */
  async function consolidate({ budgetMs = 20000, history = '', actor = '' } = {}) {
    if ((await status()).status === 'running') throw fail(409, 'MOVE_RUNNING');
    if (consolidating) throw fail(409, 'CONSOLIDATE_RUNNING');
    consolidating = true;
    const started = clock();
    const out = { moved: 0, merged: 0, waiting: 0, bytes: 0, conflicts: 0, failed: 0, rowsFixed: 0, dbMoved: 0, dbFailed: 0, unreadable: [], remaining: 0, partial: false, history: String(history || '') };
    let created = false;
    try {
      // The restore point comes FIRST: where every file lives now, and the stats of the preview. (A continuation of the same run keeps its point.)
      if (!out.history) {
        const { files: _files, ...previewStats } = await consolidation({ limit: 0 });
        out.history = await recordHistory('consolidate', { actor, stats: previewStats });
        created = true;
      } else if ((await platform.history.get(out.history))?.op !== 'consolidate') throw fail(404, 'NOT_FOUND');
      const stores = await listStorages();
      const owned = await ownedLegacyKeys(await db.query("SELECT tenant_id,id,mime,storage,ns FROM media WHERE storage IN ('r2','fs') AND ns=0"));
      for (const kind of ['r2', 'fs']) {
        const s = stores[kind], adapter = adapters[kind];
        if (!adapter) continue;
        if (!s.complete) { out.unreadable.push(kind); continue; }
        let kindRemaining = 0;
        for (const [key, object] of s.objects) {
          const stray = strayOf(key);
          if (!stray || !owned.has(`${kind}|${key}`)) continue;
          if (clock() - started > budgetMs) { kindRemaining++; continue; }
          try {
            const result = await consolidateOne(kind, adapter, key, stray);
            if (result === 'moved') { out.moved++; out.bytes += object.size; } else if (result === 'merged') { out.merged++; out.bytes += object.size; } else if (result === 'waiting') out.waiting++; else if (result === 'conflict') { out.conflicts++; }
          } catch { out.failed++; }
        }
        out.remaining += kindRemaining;
        if (kindRemaining) continue;
        const present = await adapter.list('media/').catch(() => null);
        if (!present) continue;
        const at = new Map(present.map(o => [o.key, o.size]));
        for (const row of await db.query("SELECT tenant_id,id,mime,size FROM media WHERE storage=$1 AND ns=0 AND tenant_id<>'default'", [kind])) {
          if (!EXT[row.mime]) continue;
          const size = at.get(`media/${fileName(row)}`);
          if (size == null || (row.size != null && Number(row.size) !== size)) continue;
          if (await adapter.head(keyFor(row.tenant_id)(fileName(row))).catch(() => ({}))) continue; // its own object still exists: not ours to decide
          out.rowsFixed += (await db.query('UPDATE media SET ns=1, size=$4 WHERE tenant_id=$1 AND id=$2 AND ns=0 AND storage=$3 RETURNING id', [row.tenant_id, row.id, kind, size])).length;
        }
      }
      // Bytes kept in the database: copied to media/ of the storage in use, verified, and only then do the rows point there.
      const choice = await hub.choice(), kind = choice === 'app' ? 'fs' : choice === 'r2' ? 'r2' : null;
      if (kind && adapters[kind]) {
        let after = '', over = false;
        while (!over) {
          const rows = await db.query("SELECT DISTINCT ON (id) tenant_id,id,mime,size,storage,ns FROM media WHERE storage='db' AND id > $1 ORDER BY id LIMIT 25", [after]);
          if (!rows.length) break;
          for (const row of rows) {
            after = row.id;
            if (clock() - started > budgetMs) { over = true; out.remaining++; continue; }
            if (!EXT[row.mime]) continue;
            try { const size = await transfer(row.tenant_id, row, kind); await repointDb(row, kind, size); out.dbMoved++; out.bytes += size; }
            catch (error) { if (error.message === 'TARGET_CONFLICT') out.conflicts++; else out.dbFailed++; }
          }
        }
      }
      out.partial = out.remaining > 0;
      // Nothing changed and nothing is left: this run needs no restore point.
      if (created && !out.partial && !(out.moved + out.merged + out.rowsFixed + out.dbMoved + out.waiting + out.conflicts + out.failed + out.dbFailed)) { await platform.history.drop(out.history).catch(() => {}); out.history = ''; }
    } finally { consolidating = false; hub.bump(); platform.forget(); }
    return out;
  }

  // ---------- The Files manager ----------
  /**
   * Two ways to look at what is hosted, both read-only and both listing (never decoding) files:
   *   by type     every object of the storage, WHATEVER its path (media/, old t/ folders, files uploaded by hand anywhere else), grouped as
   *               image / video / audio / other. `summary` counts them; `files({ view: 'type' })` pages through them.
   *   by owner    the files a store, a demo, a theme (or nobody: "other") holds in the database. `owners` lists them; `files({ view: 'owner' })` pages through one.
   * Nothing here is fetched until the console asks: no thumbnail, no listing, no count at page load.
   */
  const TYPES = ['image', 'video', 'audio', 'other'];
  const MIME_PREVIEW = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
    weba: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg',
  };
  const extOf = name => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const OUR_NAME = /^([a-f0-9]{32})\.[a-z0-9]+$/;
  const CURSOR_ANY = /^[^\0\\]{0,1100}$/;
  const OWNER_KIND = { instance: 'store', default: 'store', demo: 'demo', theme: 'theme', gone: 'other' };
  const ownerGroup = owner => OWNER_KIND[owner.kind] || 'other';
  const storageOf = async storage => {
    const choice = storage === 'r2' || storage === 'app' || storage === 'database' ? storage : await hub.choice();
    if (choice === 'r2' && !adapters.r2) throw fail(409, 'R2_NOT_CONFIGURED');
    if (choice === 'app' && !adapters.fs) throw fail(409, 'APP_STORAGE_UNAVAILABLE');
    return choice;
  };
  const encodeKey = key => key.split('/').map(encodeURIComponent).join('/');
  const previewUrl = (choice, key) => (choice === 'r2' ? adapters.r2.publicUrl(encodeKey(key)) : `/api/super-admin/media/object?storage=${choice}&key=${encodeURIComponent(key)}`);
  const SQL_TYPE = { image: "mime LIKE 'image/%'", video: "mime LIKE 'video/%'", audio: "mime LIKE 'audio/%'", other: "mime NOT LIKE 'image/%' AND mime NOT LIKE 'video/%' AND mime NOT LIKE 'audio/%'" };

  /** What is hosted, counted by type (and "inside media/" vs "elsewhere"), by reading the storage once. On demand only; time-boxed. */
  async function summary({ storage = '', budgetMs = 20000 } = {}) {
    const choice = await storageOf(storage);
    const out = { storage: choice, at: clock(), complete: true, scanned: 0, types: Object.fromEntries(TYPES.map(t => [t, { files: 0, bytes: 0, inMedia: 0, outside: 0 }])) };
    if (choice === 'database') {
      for (const row of await db.query("SELECT mime, COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM (SELECT DISTINCT ON (id) id,mime,size FROM media WHERE storage='db' ORDER BY id) o GROUP BY mime")) {
        const t = out.types[typeOfMime(row.mime)]; t.files += Number(row.files); t.bytes += Number(row.bytes); t.inMedia += Number(row.files); out.scanned += Number(row.files);
      }
      return out;
    }
    const adapter = adapters[choice === 'app' ? 'fs' : 'r2'];
    const started = clock();
    let after = '';
    for (;;) {
      const page = await adapter.scanPage({ after, limit: 1000 });
      for (const item of page.items) {
        const t = out.types[typeOfKey(item.key)]; t.files++; t.bytes += item.size; t[item.key.startsWith('media/') ? 'inMedia' : 'outside']++;
        out.scanned++;
      }
      if (!page.more) break;
      after = page.cursor;
      if (clock() - started > budgetMs || out.scanned >= 200000) { out.complete = false; break; }
    }
    return out;
  }

  /** The owners that hold files, grouped as the console shows them: stores, demos, themes, other (rows whose store no longer exists). */
  async function owners() {
    const map = await ownersMap();
    const per = await perStore();
    const groups = { store: [], demo: [], theme: [], other: [] };
    const other = { id: 'other', name: '', slug: '', files: 0, bytes: 0 };
    for (const [id, count] of per) {
      if (!count.files) continue;
      const owner = map.get(id);
      if (!owner) { other.files += count.files; other.bytes += count.bytes; continue; }
      groups[ownerGroup(owner)].push({ id, name: id === 'default' ? 'default' : owner.name, slug: owner.slug, files: count.files, bytes: count.bytes, main: id === 'default' });
    }
    if (other.files) groups.other.push(other);
    for (const list of Object.values(groups)) list.sort((x, y) => String(x.name).localeCompare(String(y.name)));
    return { groups, types: await typeCounts() };
  }
  /** Files per type that the DATABASE knows (instant: no storage listing). */
  async function typeCounts() {
    const out = Object.fromEntries(TYPES.map(t => [t, 0]));
    for (const row of await db.query("SELECT mime, COUNT(*) AS files FROM (SELECT DISTINCT ON (id) id,mime FROM media WHERE storage IN ('r2','fs','db') ORDER BY id) o GROUP BY mime")) out[typeOfMime(row.mime)] += Number(row.files);
    return out;
  }

  /**
   * One page of files. `view: 'type'`: every object of the storage whatever its path, filtered by `type`. `view: 'owner'`: the files one owner holds
   * (`owner` = its id, or 'other'), filtered by `type`. Cursor paging. Each item says where it sits, what it is, what the database knows, and its preview address.
   */
  async function files({ view = 'type', storage = '', type = 'all', owner = '', after = '', limit = 50 } = {}) {
    const n = Math.max(1, Math.min(100, Number(limit) || 50));
    const cursor = String(after || '');
    if (cursor && !CURSOR_ANY.test(cursor)) throw fail(400, 'INVALID_CURSOR');
    if (type !== 'all' && !TYPES.includes(type)) throw fail(400, 'INVALID_TYPE');
    const kinds = type === 'all' ? null : [type];
    const map = await ownersMap();
    let items = [], more = false, next = '', choice;
    if (view === 'owner') {
      choice = await storageOf(storage || (await hub.choice()));
      if (!owner) throw fail(400, 'SELECT_OWNER');
      const [ct, ci] = cursor.split('|');
      const where = [`storage IN ${SETTLED}`], args = [];
      if (owner === 'other') { args.push([...map.keys()]); where.push(`tenant_id<>ALL($${args.length})`); } else { args.push(String(owner)); where.push(`tenant_id=$${args.length}`); }
      if (kinds) where.push(SQL_TYPE[type]);
      if (cursor) { args.push(ct || '', ci || ''); where.push(`(tenant_id,id) > ($${args.length - 1},$${args.length})`); }
      args.push(n + 1);
      const rows = await db.query(`SELECT tenant_id,id,mime,size,storage,ns,created_at,title FROM media WHERE ${where.join(' AND ')} ORDER BY tenant_id,id LIMIT $${args.length}`, args);
      more = rows.length > n;
      items = rows.slice(0, n).filter(r => EXT[r.mime]).map(r => {
        const where = r.storage === 'db' ? 'database' : r.storage === 'fs' ? 'app' : 'r2';
        const key = r.storage === 'db' ? sharedName(r) : keyOfRow(r.tenant_id, r);
        return { key, size: Number(r.size || 0), modified: Number(r.created_at || 0), where, id: r.id, mime: r.mime, title: r.title || '', holder: r.tenant_id };
      });
      next = items.length ? `${rows[Math.min(n, rows.length) - 1].tenant_id}|${rows[Math.min(n, rows.length) - 1].id}` : '';
    } else {
      choice = await storageOf(storage);
      if (choice === 'database') {
        const where = ["storage='db'", 'id > $1'];
        if (kinds) where.push(SQL_TYPE[type]);
        const rows = await db.query(`SELECT id, MAX(mime) AS mime, MAX(size) AS size, MIN(created_at) AS created FROM media WHERE ${where.join(' AND ')} GROUP BY id ORDER BY id LIMIT $2`, [cursor.replace(/^media\//, '').slice(0, 32), n + 1]);
        more = rows.length > n;
        items = rows.slice(0, n).filter(r => EXT[r.mime]).map(r => ({ key: `media/${r.id}.${EXT[r.mime]}`, size: Number(r.size || 0), modified: Number(r.created || 0), where: 'database', id: r.id, mime: r.mime }));
        next = items.length ? items[items.length - 1].key : '';
      } else {
        const adapter = adapters[choice === 'app' ? 'fs' : 'r2'];
        const page = await adapter.scanPage({ after: cursor, limit: n, types: kinds });
        items = page.items.map(item => ({ ...item, where: choice, id: OUR_NAME.test(item.key.slice(item.key.lastIndexOf('/') + 1)) ? item.key.slice(item.key.lastIndexOf('/') + 1, item.key.lastIndexOf('/') + 33) : '', mime: MIME_PREVIEW[extOf(item.key)] || '' }));
        more = page.more; next = page.cursor;
      }
    }
    const ids = [...new Set(items.map(item => item.id).filter(Boolean))];
    const known = new Map();
    if (ids.length) {
      for (const row of await db.query(`SELECT tenant_id,id,title,mime,storage,ns FROM media WHERE id=ANY($1) AND storage IN ${SETTLED}`, [ids])) {
        const where = row.storage === 'db' ? 'database' : row.storage === 'fs' ? 'app' : 'r2';
        const key = row.storage === 'db' ? sharedName(row) : keyOfRow(row.tenant_id, row);
        const lookup = `${where}|${key}`;
        if (!known.has(lookup)) known.set(lookup, { title: '', stores: [] });
        const k = known.get(lookup); k.stores.push(ownerOf(map, row.tenant_id).name); if (row.title && !k.title) k.title = row.title;
      }
    }
    const view_ = items.map(item => {
      const name = item.key.slice(item.key.lastIndexOf('/') + 1), info = known.get(`${item.where}|${item.key}`), kind = typeOfKey(name);
      return {
        key: item.key, name, id: item.id, type: kind, folder: item.key.includes('/') ? item.key.slice(0, item.key.lastIndexOf('/') + 1) : '/', inMedia: item.key.startsWith('media/'),
        size: item.size, modified: item.modified, mime: item.mime || '', stray: !!info && STRAY.test(item.key), inDatabase: !!info, title: item.title || info?.title || '',
        stores: info ? info.stores.slice(0, 3) : [], storeCount: info ? info.stores.length : 0, storage: item.where || choice,
        url: previewUrl(item.where === 'database' ? 'database' : item.where === 'fs' ? 'app' : item.where || choice, item.key),
      };
    });
    return { view, storage: choice, items: view_, more, cursor: next };
  }

  /** One file for a preview: { redirect } | { path, mime, size } | { body, mime }. The key is a plain path inside the storage (no `..`, no absolute path). */
  async function object(key, storage = '') {
    const text = String(key || '');
    if (!text || text.length > 1024 || text.startsWith('/') || /[\0\\]/.test(text) || text.split('/').some(part => !part || part === '.' || part === '..')) throw fail(404, 'NOT_FOUND');
    const name = text.slice(text.lastIndexOf('/') + 1);
    const mime = MIME_PREVIEW[extOf(name)];
    if (!mime) throw fail(404, 'NOT_FOUND');
    const choice = await storageOf(storage).catch(() => { throw fail(404, 'NOT_FOUND'); });
    if (choice === 'r2') return { redirect: adapters.r2.publicUrl(encodeKey(text)), mime };
    if (choice === 'app') {
      const path = adapters.fs.fileAny(text);
      const st = await require('node:fs').promises.stat(path).catch(() => null);
      if (!st || !st.isFile()) throw fail(404, 'NOT_FOUND');
      return { path, mime, size: st.size };
    }
    const hit = OUR_NAME.exec(name);
    const body = hit ? await hub.shared.body(hit[1]) : null;
    if (!body) throw fail(404, 'NOT_FOUND');
    return { body, mime };
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

  return { copyRows, purgeRows, move: { start, step, status, cancel }, cleanup, oldCopies, totals, perStore, deleteFiles, consolidation, consolidate, summary, owners, files, object, history: { list: historyList, restore }, OLD_AFTER_MS };
}

module.exports = { createMediaOps, OLD_AFTER_MS };
