/**
 * The backup VAULT: where finished backups live, in the same Cloudflare R2 bucket as the media, under their own prefix:
 *
 *   backup/<v + app version>/<all | db | code | media>/<name>.zip        the archive (".zip.enc" when it is encrypted)
 *   backup/<v + app version>/<kind>/<name>.json                          the sidecar: what the archive holds, its SHA-256, who made it
 *   backup/<v + app version>/<kind>/<name>.png | .svg                    the preview: how the app looked when the backup started
 *
 * Safety rules (same ideas as restic / Borg / WordPress backup plugins):
 *  - the sidecar is written LAST: a backup without a sidecar is an unfinished upload and is never listed or restored, and is swept later;
 *  - after the upload the object is READ BACK and hashed (R2 egress is free): a backup is only "stored" when the bytes in the bucket are the bytes we sent;
 *  - large archives go up as retried multipart uploads, from disk, never whole in memory;
 *  - optional encryption (BACKUP_ENCRYPTION_KEY, see crypt.js) happens before the bytes leave the server; the key never goes into the bucket;
 *  - retention deletes by age but always keeps the newest backup of each kind, so a long outage can never prune the vault empty;
 *  - nothing outside `backup/` is ever listed, read or deleted here (the media files of the app are not touched).
 * Without R2 the vault falls back to a folder on the server's disk (self-hosted hosts), flagged `kind: 'disk'`.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { hashing } = require('./zip');
const { encryptStream, decryptStream } = require('./crypt');

const ROOT = 'backup';
const KINDS = ['all', 'db', 'code', 'media'];
const KEY = /^backup\/(v[0-9A-Za-z._-]{1,40})\/(all|db|code|media)\/([A-Za-z0-9._-]{1,140})\.(zip\.enc|zip|json|png|jpg|svg)$/;
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const versionFolder = version => `v${String(version || '0.0.0').replace(/^v/i, '').replace(/[^0-9A-Za-z._-]/g, '_').slice(0, 38) || '0.0.0'}`;
const idOf = key => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
const stamp = at => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------------ storage drivers (same small interface)
/** Cloudflare R2 through the S3 API. `client` may be injected (tests); `partSize` is the multipart part size (R2 minimum 5 MiB). */
function createR2Driver({ env, client, partSize = 16 * 1024 * 1024 } = {}) {
  const bucket = String(env.R2_BUCKET || '').trim();
  let sdk, instance = client;
  const s3 = () => (sdk ||= require('@aws-sdk/client-s3'));
  const conn = () => (instance ||= new (s3().S3Client)(require('../media').r2ClientOptions(env)));
  const send = command => conn().send(command);
  const retry = async (work, tries = 4) => {
    let last;
    for (let attempt = 0; attempt < tries; attempt++) {
      try { return await work(); } catch (error) {
        last = error;
        const code = error?.$metadata?.httpStatusCode;
        if (code && code < 500 && code !== 429 && code !== 408) throw error; // a refusal (auth, bad request) will not change
        await sleep(env.NODE_ENV === 'test' ? 2 : 500 * 2 ** attempt);
      }
    }
    throw last;
  };
  return {
    kind: 'r2', partSize,
    async list(prefix) {
      const out = [];
      let token;
      do {
        const page = await retry(() => send(new (s3().ListObjectsV2Command)({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 })));
        for (const o of page.Contents || []) out.push({ key: o.Key, size: Number(o.Size), modified: o.LastModified ? new Date(o.LastModified).getTime() : 0 });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async putBuffer(key, body, mime) { await retry(() => send(new (s3().PutObjectCommand)({ Bucket: bucket, Key: key, Body: body, ContentType: mime, ContentLength: body.length }))); },
    async putFile(key, file, { mime = 'application/octet-stream', onBytes } = {}) {
      const size = (await fs.promises.stat(file)).size;
      if (size <= partSize) {
        await retry(() => send(new (s3().PutObjectCommand)({ Bucket: bucket, Key: key, Body: fs.createReadStream(file), ContentType: mime, ContentLength: size })));
        onBytes?.(size);
        return;
      }
      const started = await retry(() => send(new (s3().CreateMultipartUploadCommand)({ Bucket: bucket, Key: key, ContentType: mime })));
      const UploadId = started.UploadId;
      const handle = await fs.promises.open(file, 'r');
      try {
        const parts = [];
        for (let offset = 0, n = 1; offset < size; offset += partSize, n++) {
          const length = Math.min(partSize, size - offset);
          const body = Buffer.alloc(length);
          const { bytesRead } = await handle.read(body, 0, length, offset);
          if (bytesRead !== length) throw fail(500, 'UPLOAD_READ_SHORT');
          const done = await retry(() => send(new (s3().UploadPartCommand)({ Bucket: bucket, Key: key, UploadId, PartNumber: n, Body: body, ContentLength: length })));
          parts.push({ ETag: done.ETag, PartNumber: n });
          onBytes?.(length);
        }
        await retry(() => send(new (s3().CompleteMultipartUploadCommand)({ Bucket: bucket, Key: key, UploadId, MultipartUpload: { Parts: parts } })));
      } catch (error) {
        await send(new (s3().AbortMultipartUploadCommand)({ Bucket: bucket, Key: key, UploadId })).catch(() => {});
        throw error;
      } finally { await handle.close(); }
    },
    async getBuffer(key) { const out = await retry(() => send(new (s3().GetObjectCommand)({ Bucket: bucket, Key: key }))); return Buffer.from(await out.Body.transformToByteArray()); },
    async stream(key) { const out = await retry(() => send(new (s3().GetObjectCommand)({ Bucket: bucket, Key: key }))); return out.Body; },
    async head(key) {
      try { const out = await send(new (s3().HeadObjectCommand)({ Bucket: bucket, Key: key })); return { size: Number(out.ContentLength) }; }
      catch (error) { if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null; throw error; }
    },
    async remove(key) { await retry(() => send(new (s3().DeleteObjectCommand)({ Bucket: bucket, Key: key }))); },
  };
}

/** A folder on the server's disk (hosts without R2). Only keys of the vault's own shape are accepted. */
function createDiskDriver({ dir }) {
  const root = path.resolve(dir);
  const file = key => { if (!KEY.test(key)) throw fail(400, 'INVALID_VAULT_KEY'); return path.join(root, ...key.split('/')); };
  return {
    kind: 'disk', root,
    async list(prefix) {
      const out = [];
      const walk = async (d, rel) => {
        let entries; try { entries = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const key = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(path.join(d, e.name), key);
          else if (key.startsWith(prefix) && KEY.test(key)) { const st = await fs.promises.stat(path.join(d, e.name)); out.push({ key, size: st.size, modified: Math.round(st.mtimeMs) }); }
        }
      };
      await walk(root, '');
      return out;
    },
    async putBuffer(key, body) { const f = file(key); await fs.promises.mkdir(path.dirname(f), { recursive: true, mode: 0o700 }); const t = `${f}.tmp`; await fs.promises.writeFile(t, body, { mode: 0o600 }); await fs.promises.rename(t, f); },
    async putFile(key, src, { onBytes } = {}) {
      const f = file(key); await fs.promises.mkdir(path.dirname(f), { recursive: true, mode: 0o700 });
      const t = `${f}.tmp`;
      try { await pipeline(fs.createReadStream(src), hashing(n => onBytes?.(n)), fs.createWriteStream(t, { mode: 0o600 })); await fs.promises.rename(t, f); } catch (error) { await fs.promises.rm(t, { force: true }); throw error; }
    },
    getBuffer: key => fs.promises.readFile(file(key)),
    stream: async key => fs.createReadStream(file(key)),
    async head(key) { try { return { size: (await fs.promises.stat(file(key))).size }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async remove(key) {
      const f = file(key); await fs.promises.rm(f, { force: true });
      for (let d = path.dirname(f); d.startsWith(root + path.sep); d = path.dirname(d)) { try { await fs.promises.rmdir(d); } catch { break; } }
    },
  };
}

// ------------------------------------------------------------------ the vault
function createVault({ storage, env = process.env, now = Date.now } = {}) {
  if (!storage) return null;
  const secret = String(env.BACKUP_ENCRYPTION_KEY || '');
  const encryptionKey = secret.length >= 12 ? secret : '';
  const cache = new Map(); // sidecar key + size -> item
  let listed = { at: 0, items: null };

  const view = (meta, key, size) => ({
    id: idOf(key), key, kind: meta.kind, version: meta.version, name: meta.name, createdAt: meta.createdAt, createdBy: meta.createdBy || 'manual',
    size: meta.size ?? size, plainSize: meta.plainSize, sha256: meta.sha256, encrypted: !!meta.encrypted, includes: meta.includes || {}, rows: meta.rows ?? null,
    tables: meta.tables ?? null, mediaFiles: meta.mediaFiles ?? 0, appFiles: meta.appFiles ?? 0, schemaVersion: meta.schemaVersion || '', formatVersion: meta.formatVersion || 1,
    preview: meta.previewKey ? { type: meta.previewType, source: meta.previewSource || 'generated' } : null, previewKey: meta.previewKey || null,
  });
  const publicItem = ({ key, previewKey, metaKey, ...rest }) => rest;

  /** Every finished backup (a sidecar exists), newest first. Sidecars are read once and remembered. */
  async function items({ fresh = false } = {}) {
    if (!fresh && listed.items && now() - listed.at < 20000) return listed.items;
    const objects = await storage.list(`${ROOT}/`);
    const found = [];
    const seen = new Set();
    for (const o of objects) {
      const m = KEY.exec(o.key);
      if (!m || m[4] !== 'json') continue;
      const tag = `${o.key}:${o.size}`;
      seen.add(tag);
      let item = cache.get(tag);
      if (!item) {
        try {
          const meta = JSON.parse((await storage.getBuffer(o.key)).toString('utf8'));
          if (!meta || meta.format !== 'dwira-vault' || !KINDS.includes(meta.kind) || typeof meta.zipKey !== 'string' || !KEY.test(meta.zipKey)) continue;
          item = { ...view(meta, meta.zipKey, meta.size), metaKey: o.key };
          cache.set(tag, item);
        } catch { continue; }
      }
      found.push(item);
    }
    for (const tag of cache.keys()) if (!seen.has(tag)) cache.delete(tag);
    found.sort((a, b) => b.createdAt - a.createdAt);
    listed = { at: now(), items: found, objects };
    return found;
  }
  const find = async id => { const item = (await items()).find(i => i.id === String(id)) || (await items({ fresh: true })).find(i => i.id === String(id)); if (!item) throw fail(404, 'BACKUP_NOT_FOUND'); return item; };
  const forget = () => { listed = { at: 0, items: null }; cache.clear(); };

  /**
   * Upload + verify one finished archive. `progress(stage, fraction)` stages: 'upload' | 'verify'. Resolves with the stored item.
   * On any failure everything this call wrote is removed again.
   */
  async function store({ file, meta, preview, progress, work }) {
    if (!KINDS.includes(meta.kind)) throw fail(400, 'INVALID_TYPE');
    const at = now();
    const folder = `${ROOT}/${versionFolder(meta.version)}/${meta.kind}`;
    const base = `dwira-${meta.kind}-${versionFolder(meta.version)}-${stamp(at)}${meta.createdBy === 'schedule' ? '-auto' : meta.createdBy === 'pre-restore' ? '-pre-restore' : meta.createdBy === 'limit' ? '-limit' : ''}-${crypto.randomBytes(6).toString('hex')}`;
    const encrypted = !!encryptionKey;
    const zipKey = `${folder}/${base}.zip${encrypted ? '.enc' : ''}`;
    const metaKey = `${folder}/${base}.json`;
    const previewKey = preview ? `${folder}/${base}.${preview.type === 'image/svg+xml' ? 'svg' : preview.type === 'image/jpeg' ? 'jpg' : 'png'}` : null;
    const written = [];
    let source = file;
    try {
      if (encrypted) {
        source = path.join(work, `${base}.enc`);
        await pipeline(fs.createReadStream(file), encryptStream(encryptionKey), fs.createWriteStream(source, { mode: 0o600 }));
      }
      const storedSize = (await fs.promises.stat(source)).size;
      const storedHash = await sha256File(source);
      let sent = 0;
      written.push(zipKey);
      await storage.putFile(zipKey, source, { mime: 'application/octet-stream', onBytes: n => { sent += n; progress?.('upload', Math.min(1, sent / Math.max(1, storedSize))); } });
      // Read-back: the object in the bucket must be byte-for-byte what we hold.
      const head = await storage.head(zipKey);
      if (!head || head.size !== storedSize) throw fail(502, 'VAULT_VERIFY_FAILED', { detected: 'size' });
      const hasher = hashing();
      let read = 0;
      hasher.on('data', chunk => { read += chunk.length; progress?.('verify', Math.min(1, read / Math.max(1, storedSize))); });
      await pipeline(await storage.stream(zipKey), hasher, new (require('node:stream').Writable)({ write(_c, _e, cb) { cb(); } }));
      if (hasher.result().sha256 !== storedHash) throw fail(502, 'VAULT_VERIFY_FAILED', { detected: 'hash' });
      if (preview) { written.push(previewKey); await storage.putBuffer(previewKey, preview.buffer, preview.type); }
      const record = {
        format: 'dwira-vault', sidecarVersion: 1, kind: meta.kind, version: meta.version, name: base, createdAt: at, createdBy: meta.createdBy || 'manual',
        zipKey, size: storedSize, plainSize: meta.plainSize, sha256: meta.sha256, storedSha256: storedHash, encrypted,
        includes: meta.includes, rows: meta.rows, tables: meta.tables, mediaFiles: meta.mediaFiles, appFiles: meta.appFiles, schemaVersion: meta.schemaVersion, formatVersion: meta.formatVersion,
        previewKey, previewType: preview?.type || null, previewSource: preview?.source || null,
      };
      written.push(metaKey);
      await storage.putBuffer(metaKey, Buffer.from(JSON.stringify(record)), 'application/json');
      forget();
      return find(idOf(zipKey));
    } catch (error) {
      for (const key of written) await storage.remove(key).catch(() => {});
      forget();
      throw error;
    } finally { if (encrypted && source !== file) await fs.promises.rm(source, { force: true }).catch(() => {}); }
  }

  /** Downloads an item to `dest` as a plain zip (decrypting when needed) and checks it against the recorded SHA-256. */
  async function fetchTo(item, dest, { onBytes } = {}) {
    if (item.encrypted && !encryptionKey) throw fail(400, 'BACKUP_KEY_MISSING');
    const hasher = hashing(n => onBytes?.(n));
    const source = await storage.stream(item.key);
    const steps = [source, ...(item.encrypted ? [decryptStream(encryptionKey)] : []), hasher, fs.createWriteStream(dest, { mode: 0o600 })];
    try { await pipeline(...steps); } catch (error) { await fs.promises.rm(dest, { force: true }).catch(() => {}); throw error.status ? error : fail(502, 'VAULT_DOWNLOAD_FAILED'); }
    const got = hasher.result();
    if (item.sha256 && got.sha256 !== item.sha256) { await fs.promises.rm(dest, { force: true }).catch(() => {}); throw fail(400, 'BACKUP_HASH_MISMATCH'); }
    return got;
  }

  /** A readable stream of the plain zip (download button). */
  async function openPlain(item) {
    if (item.encrypted && !encryptionKey) throw fail(400, 'BACKUP_KEY_MISSING');
    const source = await storage.stream(item.key);
    if (!item.encrypted) return source;
    const out = decryptStream(encryptionKey);
    source.on('error', error => out.destroy(error));
    return source.pipe(out);
  }
  /** An encrypted archive that was uploaded by hand (a copy of the object in the bucket): decrypted in place. Plain files are left alone. */
  async function decryptFile(file) {
    const handle = await fs.promises.open(file, 'r');
    const head = Buffer.alloc(5);
    try { await handle.read(head, 0, 5, 0); } finally { await handle.close(); }
    if (head.toString('latin1') !== 'DWBK1') return false;
    if (!encryptionKey) throw fail(400, 'BACKUP_KEY_MISSING');
    const temp = `${file}.dec`;
    try { await pipeline(fs.createReadStream(file), decryptStream(encryptionKey), fs.createWriteStream(temp, { mode: 0o600 })); await fs.promises.rename(temp, file); }
    catch (error) { await fs.promises.rm(temp, { force: true }).catch(() => {}); throw error.status ? error : fail(400, 'BACKUP_DECRYPT_FAILED'); }
    return true;
  }
  async function previewOf(item) {
    if (!item.previewKey) throw fail(404, 'NOT_FOUND');
    return { body: await storage.getBuffer(item.previewKey), type: item.preview.type };
  }
  async function remove(item) {
    for (const key of [item.metaKey, item.key, item.previewKey]) if (key) await storage.remove(key);
    forget();
  }
  /**
   * Retention. Removes backups older than `keepDays`, except the newest one of every kind, and sweeps unfinished uploads (an archive with no
   * sidecar older than 6 hours). `dryRun` only counts. Returns { removed, bytes, orphans }.
   */
  async function prune({ keepDays, dryRun = false } = {}) {
    const days = Math.max(1, Number(keepDays) || 28);
    const all = await items({ fresh: true });
    const newest = new Set(KINDS.map(k => all.find(i => i.kind === k)?.id).filter(Boolean));
    const cutoff = now() - days * 86400000;
    const old = all.filter(i => i.createdAt < cutoff && !newest.has(i.id));
    let bytes = 0;
    for (const item of old) { bytes += item.size || 0; if (!dryRun) await remove(item).catch(() => {}); }
    const known = new Set(all.flatMap(i => [i.metaKey, i.key, i.previewKey]));
    const orphans = (listed.objects || []).filter(o => KEY.test(o.key) && !known.has(o.key) && o.modified < now() - 6 * 3600000 && !old.some(i => [i.metaKey, i.key, i.previewKey].includes(o.key)));
    if (!dryRun) { for (const o of orphans) await storage.remove(o.key).catch(() => {}); if (old.length || orphans.length) forget(); }
    return { removed: old.length, bytes, orphans: orphans.length, items: old.map(i => i.id) };
  }
  return {
    kind: storage.kind, encrypted: !!encryptionKey, storage,
    items, find, store, fetchTo, openPlain, decryptFile, previewOf, remove, prune, publicItem, forget,
  };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', c => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

module.exports = { createVault, createR2Driver, createDiskDriver, versionFolder, KINDS, KEY, ROOT };
