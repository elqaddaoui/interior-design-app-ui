const crypto = require('node:crypto');
const { downloadRemote, verifyMedia, IMAGE_TYPES, VIDEO_TYPES, AUDIO_TYPES, audioType } = require('./remote-media');

/**
 * All media (images and videos) of the app goes through this module.
 *
 *  - storeMedia()  is the ONE write path: data URLs from uploads, images downloaded from external URLs, legacy rows moved by
 *                  the migration script. It stores the bytes in Cloudflare R2 (or, only when the R2 variables are missing,
 *                  as raw bytes in the `media` table) and returns a stable `/api/media/<hash>.<ext>` URL.
 *  - readMedia()   is the ONE read path behind GET /api/media/<name>: a redirect to the public R2 URL, or the bytes of a
 *                  row stored in the database (fallback mode, or legacy rows not migrated yet).
 *  - presignUpload() / completeUpload(): large files (videos) go from the admin's device straight to R2 with a 5-minute
 *                  presigned PUT. The server picks the key, the type and the exact size, then checks the object.
 *
 * Content rows only ever contain `/api/media/...` URLs: base64 is never written into content, requests or user spaces.
 * The `media` table keeps one small metadata row per file (id, mime, size, storage) so reads know where the file lives.
 */
const PREFIX = '/api/media/';
// Optional parameters (`;codecs=opus`) are allowed: MediaRecorder reports them in its type.
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+)(?:;[a-z0-9-]+=[a-z0-9.,"'+-]+)*;base64,/i;
const EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  // Voice notes. `weba` (not `webm`) keeps audio and video names apart: the extension decides the type on read.
  'audio/webm': 'weba', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/aac': 'aac',
};
const MIME = Object.fromEntries(Object.entries(EXT).map(([mime, ext]) => [ext, mime]));
const NAME = /^([a-f0-9]{32})\.(png|jpg|webp|gif|avif|svg|mp4|webm|mov|weba|m4a|mp3|ogg|wav|aac)$/;
/** Native clients receive absolute media URLs; store them host-independent again. */
/** A file of ours, written as a path or as an absolute URL (native clients). */
const LOCAL_MEDIA = /^(?:https?:\/\/[^/]+)?\/api\/media\/([a-f0-9]{32}\.[a-z0-9]+)(?:[?#].*)?$/;
const ABSOLUTE = /^https?:\/\/[^/]+(\/api\/media\/[a-f0-9]{32}\.[a-z0-9]+)$/;
/** Object keys whose string value is a picture shown by the app (external https URLs there are copied into storage). */
const MEDIA_KEYS = new Set(['image', 'cover', 'poster', 'logoUri', 'loaderCustomUri', 'photoUri', 'aiResult', 'finalResult', 'before', 'after', 'uri', 'images']);
const UPLOAD_EXPIRES = 300; // seconds: presigned PUT URLs are valid for 5 minutes
const PENDING_TTL = 3600000; // an upload must be completed within 1 hour of its presign
const CACHE = 'public, max-age=31536000, immutable';
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];

const fail = (status, message) => Object.assign(new Error(message), { status });
/** The only object keys this app ever writes. Listings (storage audit) return nothing else, so a bucket shared with other things stays untouched. */
const KEY_SHAPE = /^(?:media|t\/[a-z0-9][a-z0-9_-]{0,62}\/media)\/[a-f0-9]{32}\.[a-z0-9]+$/;
/** What the Files grid shows. */
const IMAGE_KEY = /\.(png|jpg|webp|gif|avif|svg)$/;
/** What a file is, from its extension (any key of the storage, ours or not): the Files manager groups by this. */
const TYPE_EXT = { image: 'png jpg jpeg webp gif avif svg bmp ico heic heif tif tiff', video: 'mp4 webm mov m4v mkv avi mpeg mpg', audio: 'weba m4a mp3 ogg oga wav aac flac opus' };
const EXT_TYPE = Object.fromEntries(Object.entries(TYPE_EXT).flatMap(([type, list]) => list.split(' ').map(ext => [ext, type])));
const typeOfKey = key => EXT_TYPE[String(key).slice(String(key).lastIndexOf('.') + 1).toLowerCase()] || 'other';
const SCAN_CAP = 20000; // objects looked at by one page of a scan
const mb = (value, fallback) => Math.max(1, Math.min(5000, Number(value) || fallback)) * 1024 * 1024;
const limitsOf = env => ({ image: mb(env.MEDIA_MAX_IMAGE_MB, 10), video: mb(env.MEDIA_MAX_VIDEO_MB, 100), audio: mb(env.MEDIA_MAX_AUDIO_MB, 8) });
const kindOf = mime => (VIDEO_TYPES.includes(mime) ? 'video' : IMAGE_TYPES.includes(mime) ? 'image' : AUDIO_TYPES.includes(audioType(mime)) ? 'audio' : '');
/** Object key in R2. The default tenant keeps the historical `media/<name>`; every other tenant has its own prefix, so one tenant's files can never be addressed (or overwritten) through another's. */
const keyFor = tenantId => (!tenantId || tenantId === 'default' ? name => `media/${name}` : name => `t/${tenantId}/media/${name}`);
/** THE shared namespace: every new file lives at `media/<hash>.<ext>` whichever store added it. */
const sharedKey = name => `media/${name}`;
/** The object key of a row of `tenantId`: shared rows (`ns = 1`) at the shared key, legacy rows (`ns = 0`) at their store's own prefix. */
const keyOfRow = (tenantId, row, name) => (Number(row?.ns) === 1 ? sharedKey(name) : keyFor(tenantId)(name));
const idOf = body => crypto.createHash('sha256').update(body.toString('base64')).digest('hex').slice(0, 32);

/** 'r2' when every R2 variable is set, 'database' when none is, 'incomplete' otherwise (treated as missing). Never returns values. */
function r2Status(env = process.env) {
  const set = R2_VARS.filter(name => String(env[name] || '').trim());
  return set.length === R2_VARS.length ? 'r2' : set.length ? 'incomplete' : 'database';
}

/**
 * S3 client options for R2. The SDK (>= 3.729) adds "flexible checksums" by default: a CRC32 of the body on every PUT and
 * checksum validation on every GET. In a presigned PUT URL that CRC is computed for an EMPTY body (`x-amz-checksum-crc32=AAAAAA==`),
 * so R2 rejects the real file, and a ranged GET (used to check what arrived) can fail validation. R2 does not need them:
 * only send/validate checksums when an operation requires one.
 */
function r2ClientOptions(env) {
  // R2_ENDPOINT is optional: EU-jurisdiction buckets use https://<account>.eu.r2.cloudflarestorage.com; local S3 emulators (tests) need path-style URLs.
  const custom = String(env.R2_ENDPOINT || '').trim().replace(/\/+$/, '');
  return {
    region: 'auto',
    endpoint: custom || `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
    forcePathStyle: !!custom,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY.trim() },
  };
}

/** Cloudflare R2 through the S3 API (region "auto"). `client` may be injected (tests); otherwise the SDK is loaded lazily. */
function createR2Storage(env = process.env, { client, presign } = {}) {
  if (r2Status(env) !== 'r2') return null;
  const bucket = env.R2_BUCKET.trim();
  const base = env.R2_PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
  let sdk;
  const s3 = () => (sdk ||= require('@aws-sdk/client-s3'));
  let instance = client;
  const connection = () => (instance ||= new (s3().S3Client)(r2ClientOptions(env)));
  const sign = presign || ((...args) => require('@aws-sdk/s3-request-presigner').getSignedUrl(...args));
  return {
    kind: 'r2',
    publicUrl: key => `${base}/${key}`,
    async put(key, body, mime) {
      await connection().send(new (s3().PutObjectCommand)({ Bucket: bucket, Key: key, Body: body, ContentType: mime, ContentLength: body.length, CacheControl: CACHE }));
    },
    /** { size, mime } or null when the object does not exist. */
    async head(key) {
      try {
        const out = await connection().send(new (s3().HeadObjectCommand)({ Bucket: bucket, Key: key }));
        return { size: Number(out.ContentLength), mime: String(out.ContentType || '').split(';')[0].trim().toLowerCase() };
      } catch (error) {
        if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    /** The whole object (admin card-video renderer: pictures that the browser cannot read cross-origin are read through the server). */
    async get(key) {
      const out = await connection().send(new (s3().GetObjectCommand)({ Bucket: bucket, Key: key }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
    /** First `length` bytes, used to check the real type of a direct upload. */
    async getRange(key, length) {
      const out = await connection().send(new (s3().GetObjectCommand)({ Bucket: bucket, Key: key, Range: `bytes=0-${length - 1}` }));
      return Buffer.from(await out.Body.transformToByteArray());
    },
    /** The object as a Node stream (backups read every file this way: one file in memory at a time at most). */
    async stream(key) {
      const out = await connection().send(new (s3().GetObjectCommand)({ Bucket: bucket, Key: key }));
      return out.Body;
    },
    async remove(key) { await connection().send(new (s3().DeleteObjectCommand)({ Bucket: bucket, Key: key })); },
    /** Every object of ours under `prefix` ('media/' and 't/'): [{ key, size, modified }]. Keys of any other shape are never returned. */
    async list(prefix) {
      const out = [];
      let token;
      do {
        const page = await connection().send(new (s3().ListObjectsV2Command)({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }));
        for (const item of page.Contents || []) if (KEY_SHAPE.test(item.Key)) out.push({ key: item.Key, size: Number(item.Size), modified: item.LastModified ? new Date(item.LastModified).getTime() : 0 });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token && out.length < 2000000);
      return out;
    },
    /** One page of the pictures in `prefix` (sorted by key): { items: [{ key, size, modified }], more }. `after` = the last key of the previous page. */
    async listPage(prefix, { after = '', limit = 60 } = {}) {
      const items = [];
      let token;
      do {
        const page = await connection().send(new (s3().ListObjectsV2Command)({ Bucket: bucket, Prefix: prefix, StartAfter: token ? undefined : after || undefined, ContinuationToken: token, MaxKeys: Math.min(1000, Math.max(100, limit * 2)) }));
        for (const item of page.Contents || []) {
          if (!KEY_SHAPE.test(item.Key) || !IMAGE_KEY.test(item.Key)) continue;
          items.push({ key: item.Key, size: Number(item.Size), modified: item.LastModified ? new Date(item.LastModified).getTime() : 0 });
          if (items.length > limit) return { items: items.slice(0, limit), more: true };
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return { items, more: false };
    },
    /**
     * One page of EVERY object of the bucket, whatever its path or type (read-only: the Files manager shows what is hosted, not only `media/`).
     * `types` = only these kinds ('image' | 'video' | 'audio' | 'other'). `after` = the cursor of the previous page. Returns { items, more, cursor }.
     */
    async scanPage({ after = '', limit = 60, types = null } = {}) {
      const items = [];
      let token, scanned = 0, last = after;
      do {
        const page = await connection().send(new (s3().ListObjectsV2Command)({ Bucket: bucket, StartAfter: token ? undefined : after || undefined, ContinuationToken: token, MaxKeys: 1000 }));
        for (const item of page.Contents || []) {
          last = item.Key; scanned++;
          if (item.Key.endsWith('/') || (types && !types.includes(typeOfKey(item.Key)))) continue;
          items.push({ key: item.Key, size: Number(item.Size), modified: item.LastModified ? new Date(item.LastModified).getTime() : 0 });
          if (items.length >= limit) return { items, more: true, cursor: item.Key };
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (scanned >= SCAN_CAP && token) return { items, more: true, cursor: last };
      } while (token);
      return { items, more: false, cursor: last };
    },
    /** Server-side copy inside the bucket (nothing travels through this server: a clone of a store with large videos costs no bandwidth). */
    async copy(from, to) {
      await connection().send(new (s3().CopyObjectCommand)({ Bucket: bucket, Key: to, CopySource: `${bucket}/${from.split('/').map(encodeURIComponent).join('/')}`, CacheControl: CACHE }));
    },
    /** Presigned PUT: the type and the exact length are part of the signature, so the client cannot change them. */
    presignPut(key, mime, size) {
      return sign(connection(), new (s3().PutObjectCommand)({ Bucket: bucket, Key: key, ContentType: mime, ContentLength: size }), { expiresIn: UPLOAD_EXPIRES, signableHeaders: new Set(['content-type', 'content-length']) });
    },
  };
}

/**
 * "App directory" storage: files on the disk of the server (MEDIA_DIR, default server/data/media), same interface as the R2 adapter
 * (keys are the same `media/<name>` / `t/<tenant>/media/<name>`). Only for hosts with a persistent disk (VPS, Hostinger): serverless
 * disks are wiped. Served through /api/media like database files (there is no public URL).
 */
function createFsStorage(env = process.env) {
  const fs = require('node:fs'), nodePath = require('node:path');
  const root = nodePath.resolve(String(env.MEDIA_DIR || '').trim() || nodePath.join(__dirname, 'data', 'media'));
  const SAFE_KEY = /^(?:media|t\/[a-z0-9][a-z0-9_-]{0,62}\/media)\/[a-f0-9]{32}\.[a-z0-9]+$/;
  const file = key => { if (!SAFE_KEY.test(String(key))) throw fail(400, 'INVALID_MEDIA_KEY'); return nodePath.join(root, ...key.split('/')); };
  /** ANY path under the media folder (read-only previews of files the app did not write): no empty, `.` or `..` segment, nothing outside the root. */
  const fileAny = key => {
    const parts = String(key).split('/');
    if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw fail(400, 'INVALID_MEDIA_KEY');
    const full = nodePath.join(root, ...parts);
    if (!full.startsWith(root + nodePath.sep)) throw fail(400, 'INVALID_MEDIA_KEY');
    return full;
  };
  /** The old per-store folders (`t/<store>/media`) disappear with their last file: no empty directories are left behind. */
  const pruneEmpty = async key => {
    if (!String(key).startsWith('t/')) return;
    const stop = nodePath.join(root, 't');
    let dir = nodePath.dirname(file(key));
    while (dir === stop || dir.startsWith(stop + nodePath.sep)) {
      try { await fs.promises.rmdir(dir); } catch { return; } // not empty (or already gone)
      dir = nodePath.dirname(dir);
    }
  };
  return {
    kind: 'fs', root, publicUrl: null, file, fileAny,
    async put(key, body) {
      const target = file(key);
      await fs.promises.mkdir(nodePath.dirname(target), { recursive: true, mode: 0o750 });
      const temp = `${target}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, body);
      await fs.promises.rename(temp, target);
    },
    async putStream(key, source) {
      const target = file(key);
      await fs.promises.mkdir(nodePath.dirname(target), { recursive: true, mode: 0o750 });
      const temp = `${target}.${process.pid}.tmp`;
      try { await require('node:stream/promises').pipeline(source, fs.createWriteStream(temp)); await fs.promises.rename(temp, target); }
      catch (error) { await fs.promises.rm(temp, { force: true }); throw error; }
    },
    async copy(from, to) {
      const target = file(to);
      await fs.promises.mkdir(nodePath.dirname(target), { recursive: true, mode: 0o750 });
      const temp = `${target}.${process.pid}.tmp`;
      try { await fs.promises.copyFile(file(from), temp); await fs.promises.rename(temp, target); }
      catch (error) { await fs.promises.rm(temp, { force: true }); throw error; }
    },
    /** Free bytes on the disk that holds the media folder (null when the platform cannot tell). */
    async free() { try { await fs.promises.mkdir(root, { recursive: true, mode: 0o750 }); const st = await fs.promises.statfs(root); return Number(st.bavail) * Number(st.bsize); } catch { return null; } },
    async head(key) { try { const st = await fs.promises.stat(file(key)); return { size: st.size, mime: '' }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    get: key => fs.promises.readFile(file(key)),
    async getRange(key, length) { const handle = await fs.promises.open(file(key), 'r'); try { const buffer = Buffer.alloc(length); const { bytesRead } = await handle.read(buffer, 0, length, 0); return buffer.subarray(0, bytesRead); } finally { await handle.close(); } },
    stream: async key => fs.createReadStream(file(key)),
    remove: async key => { await fs.promises.rm(file(key), { force: true }); await pruneEmpty(key); },
    /** Every file of ours under `prefix` ('media/' or 't/'): [{ key, size, modified }]. Anything that is not one of our keys is ignored. */
    async list(prefix) {
      const out = [];
      await fs.promises.stat(root); // a missing root (an unmounted disk) must read as "cannot list", never as "no files"
      const walk = async (dir, rel) => {
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const key = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) { await walk(nodePath.join(dir, entry.name), key); continue; }
          if (!SAFE_KEY.test(key) || !key.startsWith(prefix)) continue;
          try { const st = await fs.promises.stat(nodePath.join(dir, entry.name)); out.push({ key, size: st.size, modified: Math.round(st.mtimeMs) }); } catch { /* vanished */ }
        }
      };
      await walk(prefix === 't/' ? nodePath.join(root, 't') : nodePath.join(root, 'media'), prefix === 't/' ? 't' : 'media');
      return out;
    },
    /** Removes every empty directory left under `t/` (the old per-store folders). Returns how many were removed. */
    async prune() {
      let removed = 0;
      const walk = async dir => {
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) if (entry.isDirectory()) await walk(nodePath.join(dir, entry.name));
        if (dir === nodePath.join(root, 't')) { try { await fs.promises.rmdir(dir); removed++; } catch { /* not empty */ } return; }
        try { await fs.promises.rmdir(dir); removed++; } catch { /* not empty */ }
      };
      await walk(nodePath.join(root, 't'));
      return removed;
    },
    /** One page of the pictures in `prefix` ('media/'), sorted by name: { items: [{ key, size, modified }], more }. */
    async listPage(prefix, { after = '', limit = 60 } = {}) {
      if (prefix === 't/') { // the old per-store folders: t/<store>/media/<name>
        const all = (await this.list('t/')).filter(o => IMAGE_KEY.test(o.key) && o.key > after).sort((a, b) => (a.key < b.key ? -1 : 1));
        return { items: all.slice(0, limit), more: all.length > limit };
      }
      const dir = nodePath.join(root, ...prefix.split('/').filter(Boolean));
      let names;
      try { names = (await fs.promises.readdir(dir)).sort(); } catch (error) { if (error.code === 'ENOENT') return { items: [], more: false }; throw error; }
      const wanted = names.filter(name => `${prefix}${name}` > after && SAFE_KEY.test(`${prefix}${name}`) && IMAGE_KEY.test(name));
      const items = [];
      for (const name of wanted.slice(0, limit)) {
        try { const st = await fs.promises.stat(nodePath.join(dir, name)); items.push({ key: `${prefix}${name}`, size: st.size, modified: Math.round(st.mtimeMs) }); } catch { /* vanished */ }
      }
      return { items, more: wanted.length > limit };
    },
    /** One page of EVERY file under the media folder, whatever its path or type (read-only). Same shape as the R2 adapter's `scanPage`. */
    async scanPage({ after = '', limit = 60, types = null } = {}) {
      await fs.promises.stat(root); // an unmounted disk reads as \"cannot list\", never as \"no files\"
      const keys = [];
      const walk = async (dir, rel) => {
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          const key = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await walk(nodePath.join(dir, entry.name), key);
          else if (entry.isFile() && !entry.name.endsWith('.tmp') && key > after && (!types || types.includes(typeOfKey(key)))) keys.push(key);
        }
      };
      await walk(root, '');
      keys.sort();
      const items = [];
      for (const key of keys.slice(0, limit)) {
        try { const st = await fs.promises.stat(nodePath.join(root, ...key.split('/'))); items.push({ key, size: st.size, modified: Math.round(st.mtimeMs) }); } catch { /* vanished */ }
      }
      return { items, more: keys.length > limit, cursor: items.length ? items[items.length - 1].key : after };
    },
    /** Writable? (the backup screen reports it before offering this target) */
    async writable() { try { await fs.promises.mkdir(root, { recursive: true, mode: 0o750 }); await fs.promises.access(root, fs.constants.W_OK); return true; } catch { return false; } },
  };
}

/**
 * @param db       the database (metadata rows; bytes too, only without R2)
 * @param options  env, storage (R2 adapter or null = database fallback), download (external fetcher), dryRun (compute URLs, write nothing)
 */
function createMedia(db, { env = process.env, storage = createR2Storage(env) || (env.MEDIA_STORAGE === 'app' || String(env.MEDIA_DIR || '').trim() ? createFsStorage(env) : null), download = downloadRemote, dryRun = false, r2, fsStorage, hub } = {}) {
  const limits = limitsOf(env);
  // Every kind of file the database can point to stays readable whichever storage is the primary one (a restore may move files to another).
  // With a hub (the server: one per process, see server/media-hub.js) the adapters are shared and the primary storage is chosen at run time;
  // without one (scripts, unit tests) `storage` is the fixed primary.
  const adapters = hub ? hub.adapters : {
    r2: storage?.kind === 'r2' ? storage : r2 !== undefined ? r2 : createR2Storage(env),
    fs: storage?.kind === 'fs' ? storage : fsStorage !== undefined ? fsStorage : createFsStorage(env),
  };
  const primary = async () => (hub ? hub.primary() : storage);
  const modeNow = () => (hub ? hub.mode() : storage ? storage.kind : 'database');
  const tenantId = db.tenantId;
  const shared = hub?.shared || null;
  let seenVersion = hub ? hub.version() : 0;
  const saved = new Set();
  const remoteCache = new Map(); // url -> Promise<media URL>: an external image is downloaded once per process
  const stats = { stored: 0, downloaded: 0 };
  /*
   * Read-path caches (database transfer). A media id is the hash of its bytes, so what it maps to never changes:
   *   meta    id -> { mime, storage, size }   what the row says (a few bytes). Only settled rows ('r2' | 'db') are kept.
   *   bodies  id -> Buffer                    files served from the database (no-R2 fallback / legacy rows), LRU by bytes.
   * Without these every GET /api/media/<id> downloaded the whole blob out of Postgres (even for files that live in R2 and are
   * only redirected), which is the single biggest consumer of Neon network transfer.
   */
  const meta = new Map();
  const bodies = new Map();
  let bodyBytes = 0;
  const bodyBudget = Math.max(0, Math.min(512, Number(env.MEDIA_CACHE_MB ?? 24))) * 1024 * 1024;
  const bodyMax = Math.min(bodyBudget, 4 * 1024 * 1024);
  const keepBody = (id, body) => {
    if (!bodyBudget || body.length > bodyMax) return;
    if (bodies.has(id)) { bodyBytes -= bodies.get(id).length; bodies.delete(id); }
    bodies.set(id, body); bodyBytes += body.length;
    for (const [oldest, value] of bodies) { if (bodyBytes <= bodyBudget) break; bodies.delete(oldest); bodyBytes -= value.length; }
  };

  /**
   * THE single function that stores media. `body` = file bytes, `mime` = verified type. Content-addressed, so storing the
   * same bytes twice is free and every migration step is idempotent.
   *  lib / title: the file was added by an administrator on purpose (upload or import): it belongs to the store's media library.
   *               Pictures that arrive any other way (clients' photos, AI renders, copies inside content) are stored but not listed there.
   */
  async function storeMedia({ body, mime, lib = false, title = '' }) {
    if (!EXT[mime]) throw fail(400, 'UNSUPPORTED_MEDIA');
    const id = idOf(body), name = `${id}.${EXT[mime]}`;
    if (dryRun || (saved.has(id) && !lib)) return PREFIX + name;
    const store = await primary();
    const existing = (await db.query('SELECT storage FROM media WHERE tenant_id=:tenant AND id=$1', [id]))[0];
    const flag = lib ? 1 : 0, label = String(title || '').slice(0, 200);
    const settled = existing && (existing.storage === 'r2' || existing.storage === 'fs' || existing.storage === 'db');
    // A settled file stays where it is (moving files between storages is an explicit operation of the console), except a legacy
    // database row, which is upgraded as soon as a real storage exists.
    const keep = settled && (existing.storage === 'db' ? !store : !!adapters[existing.storage]);
    if (keep) {
      if (lib) await db.query("UPDATE media SET lib=1, title=CASE WHEN $2<>'' THEN $2 ELSE title END WHERE tenant_id=:tenant AND id=$1", [id, label]);
    } else {
      // Same bytes already stored for ANY store: only this store's row is new, nothing is uploaded.
      const found = shared ? await shared.find(id) : null;
      const reuse = found && found.storage !== 'db' && adapters[found.storage] ? found.storage : null;
      let kind = null;
      if (reuse && (await adapters[reuse].head(sharedKey(name)).catch(() => null))) kind = reuse;
      else if (store) { await store.put(sharedKey(name), body, mime); kind = store.kind; stats.stored++; }
      if (kind) {
        await db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,lib,title,ns) VALUES(:tenant,$1,$2,'',NULL,$3,$5,$4,$6,$7,1) ON CONFLICT (tenant_id,id) DO UPDATE SET storage=EXCLUDED.storage, ns=1, size=EXCLUDED.size, body=NULL, data='', lib=GREATEST(media.lib,EXCLUDED.lib), title=CASE WHEN EXCLUDED.title<>'' THEN EXCLUDED.title ELSE media.title END", [id, mime, body.length, Date.now(), kind, flag, label]);
        meta.delete(id);
        // Another store may have deleted the LAST other row (and with it the object) between the check above and this insert: make sure the
        // object is still there now that this row exists, and write it again if it is not.
        if (kind === reuse && !(await adapters[kind].head(sharedKey(name)).catch(() => ({ size: 0 })))) await adapters[kind].put(sharedKey(name), body, mime);
      } else if (!existing) {
        // Fallback without any storage: raw bytes (BYTEA), never base64 text. When another store already holds the same bytes this row stays empty and points at them.
        const hold = found?.storage === 'db';
        await db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,lib,title,ns) VALUES(:tenant,$1,$2,'',$3,$4,'db',$5,$6,$7,1) ON CONFLICT (tenant_id,id) DO NOTHING", [id, mime, hold ? null : body, body.length, Date.now(), flag, label]);
        stats.stored++;
      } else if (lib) {
        await db.query("UPDATE media SET lib=1, title=CASE WHEN $2<>'' THEN $2 ELSE title END WHERE tenant_id=:tenant AND id=$1", [id, label]);
      }
    }
    saved.add(id);
    return PREFIX + name;
  }

  /** A `data:` URL from an upload: decoded, its real type checked, then stored. */
  async function storeDataUrl(value, { svg = true, lib = false, title = '' } = {}) {
    const match = DATA_URL.exec(value);
    const declared = match[1].toLowerCase();
    const body = Buffer.from(value.slice(match[0].length), 'base64');
    const kind = kindOf(declared);
    if (!kind || !body.length) throw fail(400, 'INVALID_MEDIA');
    if (body.length > limits[kind]) throw fail(413, 'MEDIA_TOO_LARGE');
    let mime;
    try { mime = verifyMedia(body, declared, kind); } catch { throw fail(400, 'INVALID_MEDIA'); }
    if (mime === 'image/svg+xml' && !svg) throw fail(400, 'INVALID_MEDIA');
    return storeMedia({ body, mime, lib, title });
  }

  /**
   * Raw bytes from the admin (database mode, where there is no presigned upload): a video or a large picture sent as the request
   * body. The real type is checked from the bytes. Without R2 the database holds the file, so a lower cap applies.
   */
  async function storeRaw(body, declared, { lib = false, title = '' } = {}) {
    const mime = String(declared || '').split(';')[0].trim().toLowerCase();
    const kind = mime === 'image/svg+xml' ? '' : kindOf(mime);
    if (!kind || !body.length) throw fail(400, 'INVALID_MEDIA');
    if (body.length > rawLimit(kind)) throw fail(413, 'MEDIA_TOO_LARGE');
    let actual;
    try { actual = verifyMedia(body, mime, kind); } catch { throw fail(400, 'INVALID_MEDIA'); }
    return storeMedia({ body, mime: actual, lib, title });
  }
  const rawLimit = kind => (modeNow() !== 'database' ? limits[kind] : Math.min(limits[kind], mb(env.MEDIA_MAX_DB_MB, 25)));

  /** Copies an external https image into storage once and returns its /api/media URL. */
  function importRemote(url, { kind = 'image', lib = false } = {}) {
    const cacheKey = `${kind}:${url}`; // one download per URL whoever asks (the library flag is applied afterwards)
    if (!remoteCache.has(cacheKey)) {
      const job = (async () => {
        const file = await download(url, { kind, maxBytes: kind === 'video' ? limits.video : Math.min(limits.image, 10 * 1024 * 1024) });
        stats.downloaded++;
        return storeMedia({ ...file, lib });
      })();
      job.catch(() => remoteCache.delete(cacheKey)); // failures may be retried later
      remoteCache.set(cacheKey, job);
    }
    const job = remoteCache.get(cacheKey);
    // Asked by an administrator (library import) after a content save already fetched it: just list the stored file.
    return lib ? job.then(async result => { await tagLibrary(result); return result; }) : job;
  }
  /** Marks an already stored file (by its /api/media URL) as part of this store's library. */
  async function tagLibrary(url) {
    const id = LOCAL_MEDIA.exec(url)?.[1]?.split('.')[0];
    if (id && !dryRun) await db.query("UPDATE media SET lib=1 WHERE tenant_id=:tenant AND id=$1 AND storage<>'pending'", [id]);
  }

  /**
   * The bytes of a picture for the admin's card-video renderer. A browser can only draw a picture into a canvas it will encode when the
   * picture is served with CORS headers; /api/media redirects to R2 (CORS only when the bucket allows the admin's origin) and external
   * pictures usually have none. So the renderer falls back to this: a file of ours is read from storage, an external https picture is
   * downloaded with the same SSRF rules as every import (https, public hosts, 10 s, 10 MB, image/* only). Nothing is stored.
   */
  async function fetchBytes(input) {
    const text = String(input || '');
    const local = LOCAL_MEDIA.exec(text);
    if (local) {
      const name = local[1];
      const file = await readMedia(name);
      if (!file) throw fail(404, 'NOT_FOUND');
      if (file.redirect) {
        if (!adapters.r2 || !adapters.r2.get) throw fail(502, 'MEDIA_UNREADABLE');
        return { body: await adapters.r2.get(file.key), mime: file.mime };
      }
      if (file.path) return { body: await require('node:fs').promises.readFile(file.path), mime: file.mime };
      return { body: file.body, mime: file.mime };
    }
    const file = await download(text, { kind: 'image', maxBytes: Math.min(limits.image, 10 * 1024 * 1024) });
    return { body: file.body, mime: file.mime };
  }

  /**
   * Returns a copy of `value` where every inline data URL (anywhere) and every external https picture (under a media key)
   * is replaced by its /api/media URL.
   *  options.remote: 'strict' (default) = a failed download rejects the save; 'lenient' = transient failures keep the URL;
   *                  'report' = any failure keeps the URL (client data: a finished AI render is never lost); 'skip' = no download.
   *  options.known:  strings already stored in this row: kept as they are (only NEW external URLs are downloaded on save).
   *  options.videos: also copy external videos (`{ type: 'video', uri }`), used by the migration script.
   *  options.svg:    allow SVG uploads (admin content only).
   */
  async function externalize(value, { remote = 'strict', videos = false, svg = true, known, onError, lib = false, title = '' } = {}) {
    let changed = false;
    const visit = async (node, key, parent) => {
      if (typeof node === 'string') {
        if (DATA_URL.test(node)) { changed = true; return storeDataUrl(node, { svg, lib, title }); }
        const absolute = ABSOLUTE.exec(node);
        if (absolute) { changed = true; return absolute[1]; }
        // Unchanged URLs already in the row are left to the migration script, so an unrelated edit (or a reorder burst) never waits on downloads.
        if (remote !== 'skip' && MEDIA_KEYS.has(key) && /^https?:\/\//i.test(node) && !known?.has(node)) {
          const isVideo = key === 'uri' && parent?.type === 'video';
          if (isVideo && !videos) return node;
          try {
            const url = await importRemote(node, { kind: isVideo ? 'video' : 'image' });
            changed = true;
            return url;
          } catch (error) {
            onError?.(node, error);
            if (remote === 'report' || (remote === 'lenient' && !error.policy)) return node;
            throw fail(error.policy ? 400 : 502, `MEDIA_URL_${error.code || 'FAILED'}`);
          }
        }
        return node;
      }
      if (Array.isArray(node)) { const out = []; for (const child of node) out.push(await visit(child, key, parent)); return out; }
      if (node && typeof node === 'object') {
        const out = {};
        // Sequential on purpose: bounded memory and at most one download at a time per request.
        for (const [childKey, child] of Object.entries(node)) out[childKey] = await visit(child, childKey, node);
        return out;
      }
      return node;
    };
    const result = await visit(value, '', null);
    return { value: result, changed };
  }

  /**
   * THE single read function. `name` = `<hash>.<ext>`. Returns { redirect } | { mime, body } | null when unknown.
   * `{ head: true }` (HEAD requests) never loads the file. Database transfer: only the small metadata columns are read for a
   * file in R2 (the bytes are never needed), and a file served from the database is read at most once per cache lifetime.
   */
  async function readMedia(name, { head = false } = {}) {
    const match = NAME.exec(String(name || ''));
    if (!match) return null;
    const id = match[1];
    if (hub && hub.version() !== seenVersion) { seenVersion = hub.version(); meta.clear(); } // files moved between storages
    let info = meta.get(id);
    if (!info) {
      // Only this store's own rows are readable: knowing a hash gives no access to another store's file.
      const row = (await db.query('SELECT mime,storage,size,ns FROM media WHERE tenant_id=:tenant AND id=$1', [id]))[0];
      if (!row) return null;
      info = { mime: row.mime, storage: row.storage, size: row.size == null ? null : Number(row.size), ns: Number(row.ns) };
      if (info.storage === 'r2' || info.storage === 'db' || info.storage === 'fs') { // 'pending' rows change: never remembered
        if (meta.size >= 5000) meta.delete(meta.keys().next().value);
        meta.set(id, info);
      }
    }
    if (MIME[match[2]] !== info.mime) return null;
    const key = keyOfRow(tenantId, info, match[0]);
    if (info.storage === 'r2') return adapters.r2 ? { redirect: adapters.r2.publicUrl(key), mime: info.mime, key } : null;
    // A file on the disk of the server: served from the path (never loaded whole), with Range support in the route.
    if (info.storage === 'fs') {
      if (!adapters.fs) return null;
      const path = adapters.fs.file(key);
      const st = await require('node:fs').promises.stat(path).catch(() => null);
      return st ? { mime: info.mime, size: st.size, path } : null;
    }
    if (info.storage !== 'db') return null; // pending direct upload
    if (head) return { mime: info.mime, body: Buffer.alloc(0), size: info.size };
    const cached = bodies.get(id);
    if (cached) { bodies.delete(id); bodies.set(id, cached); return { mime: info.mime, body: cached }; } // refresh LRU position
    let body = null;
    const row = (await db.query('SELECT data,body FROM media WHERE tenant_id=:tenant AND id=$1', [id]))[0];
    if (row?.body) body = Buffer.from(row.body);
    else if (row?.data) body = Buffer.from(row.data, 'base64'); // legacy base64 row (read-only)
    else if (shared) body = await shared.body(id); // the bytes sit in the row of the store that stored them first
    if (!body) return null;
    keepBody(id, body);
    return { mime: info.mime, body };
  }

  /** Step 1 of a direct upload (admin only, checked by the caller). The server picks the key; type and size are signed. */
  async function presignUpload({ contentType, size }) {
    const storage = await primary();
    if (storage?.kind !== 'r2') throw fail(503, 'R2_NOT_CONFIGURED'); // the client then sends the file through the API (raw upload)
    const mime = String(contentType || '').toLowerCase();
    const kind = mime === 'image/svg+xml' ? '' : kindOf(mime);
    if (!kind) throw fail(400, 'UNSUPPORTED_MEDIA_TYPE');
    if (!Number.isSafeInteger(size) || size < 1) throw fail(400, 'INVALID_SIZE');
    if (size > limits[kind]) throw fail(413, 'MEDIA_TOO_LARGE');
    const id = crypto.randomBytes(16).toString('hex'), name = `${id}.${EXT[mime]}`;
    await db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns) VALUES(:tenant,$1,$2,'',NULL,$3,'pending',$4,1)", [id, mime, size, Date.now()]);
    const uploadUrl = await storage.presignPut(sharedKey(name), mime, size);
    return { id, uploadUrl, method: 'PUT', headers: { 'Content-Type': mime }, url: PREFIX + name, expiresIn: UPLOAD_EXPIRES, maxBytes: limits[kind] };
  }

  /** Step 2: verifies what actually arrived in R2 (size, type, magic bytes) and publishes it. */
  async function completeUpload(id, { lib = false } = {}) {
    const storage = adapters.r2;
    if (!storage) throw fail(503, 'R2_NOT_CONFIGURED');
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw fail(400, 'INVALID_ID');
    const row = (await db.query('SELECT mime,size,storage,created_at FROM media WHERE tenant_id=:tenant AND id=$1', [id]))[0];
    if (!row) throw fail(404, 'NOT_FOUND');
    const name = `${id}.${EXT[row.mime]}`;
    if (row.storage === 'r2') { if (lib) await db.query('UPDATE media SET lib=1 WHERE tenant_id=:tenant AND id=$1', [id]); return { url: PREFIX + name }; }
    if (row.storage !== 'pending' || Number(row.created_at) < Date.now() - PENDING_TTL) throw fail(410, 'UPLOAD_EXPIRED');
    const object = await storage.head(sharedKey(name));
    if (!object) throw fail(409, 'UPLOAD_MISSING');
    const reject = async code => { await storage.remove(sharedKey(name)).catch(() => {}); await db.query("DELETE FROM media WHERE tenant_id=:tenant AND id=$1 AND storage='pending'", [id]); throw fail(400, code); };
    if (object.size !== Number(row.size) || object.mime !== row.mime) return reject('UPLOAD_MISMATCH');
    try { verifyMedia(await storage.getRange(sharedKey(name), 64), row.mime, kindOf(row.mime)); } catch { return reject('INVALID_MEDIA'); }
    await db.query("UPDATE media SET storage='r2', lib=$2 WHERE tenant_id=:tenant AND id=$1", [id, lib ? 1 : 0]);
    meta.delete(id);
    return { url: PREFIX + name };
  }

  /**
   * Migration helper: copies one legacy database row (base64 `data` or `body` bytes) to R2 and marks it as stored there.
   * The database copy is left untouched (nothing is ever deleted).
   */
  async function moveRowToR2(row) {
    const storage = adapters.r2;
    if (!storage) throw fail(503, 'R2_NOT_CONFIGURED');
    const body = row.body ? Buffer.from(row.body) : Buffer.from(row.data || '', 'base64');
    if (!body.length || !EXT[row.mime]) return false;
    const name = `${row.id}.${EXT[row.mime]}`;
    if (dryRun) return true;
    // Always the shared `media/<hash>.<ext>` key (and `ns = 1`): nothing this app writes ever lands outside `media/`.
    const key = sharedKey(name);
    const object = await storage.head(key);
    if (!object || object.size !== body.length) await storage.put(key, body, row.mime);
    await db.query("UPDATE media SET storage='r2', size=$2, ns=1 WHERE tenant_id=:tenant AND id=$1", [row.id, body.length]);
    meta.delete(row.id);
    return true;
  }

  /**
   * Backup / restore access (server/backup). Reads every file of THIS tenant from wherever its row says it lives, and writes a file to the
   * storage the restore chose ('r2' | 'app'). Bytes travel as streams, one file at a time.
   */
  const backup = {
    adapters,
    keyOf: (row, name) => keyOfRow(tenantId, row, name),
    nameOf: row => `${row.id}.${EXT[row.mime]}`,
    /** Settled files only (a pending direct upload has no bytes yet). Every file the store HAS, whether or not another store shares the object. */
    async list() {
      return (await db.query("SELECT id,mime,size,storage,ns FROM media WHERE tenant_id=:tenant AND storage<>'pending' ORDER BY id")).map(row => ({ id: row.id, mime: row.mime, size: row.size == null ? null : Number(row.size), storage: row.storage, ns: Number(row.ns) }));
    },
    /** A readable stream of the file, or throws (missing object, unknown storage). */
    async open(row) {
      const name = `${row.id}.${EXT[row.mime]}`;
      if (!EXT[row.mime]) throw fail(400, 'UNSUPPORTED_MEDIA');
      const key = keyOfRow(tenantId, row, name);
      if (row.storage === 'r2') { if (!adapters.r2) throw fail(503, 'R2_NOT_CONFIGURED'); return adapters.r2.stream(key); }
      if (row.storage === 'fs') return adapters.fs.stream(key);
      const stored = (await db.query('SELECT data,body FROM media WHERE tenant_id=:tenant AND id=$1', [row.id]))[0];
      let body = stored?.body ? Buffer.from(stored.body) : stored?.data ? Buffer.from(stored.data, 'base64') : null;
      if (!body && shared) body = await shared.body(row.id);
      if (!body) throw fail(404, 'NOT_FOUND');
      return require('node:stream').Readable.from([body]);
    },
    /**
     * target: 'r2' | 'app'. The restored file joins the shared namespace: when the same bytes are already stored (by this or any store) nothing
     * is written, the row just points at them; otherwise the object is written once. Returns false when the target is unavailable.
     */
    async restore({ id, mime }, stream, size, target) {
      const name = `${id}.${EXT[mime]}`;
      if (!EXT[mime]) throw fail(400, 'UNSUPPORTED_MEDIA');
      const kind = target === 'r2' ? 'r2' : 'fs';
      const adapter = adapters[kind];
      if (!adapter) throw fail(503, 'R2_NOT_CONFIGURED');
      let have = null;
      const found = shared ? await shared.find(id) : null;
      if (found && found.storage !== 'db' && adapters[found.storage] && (await adapters[found.storage].head(sharedKey(name)).catch(() => null))) have = found.storage;
      if (have) { for await (const chunk of stream) void chunk; } // drain: the object is already stored
      else {
        if (kind === 'fs') await adapter.putStream(sharedKey(name), stream);
        else { const chunks = []; for await (const chunk of stream) chunks.push(chunk); await adapter.put(sharedKey(name), Buffer.concat(chunks), mime); }
      }
      await db.query("INSERT INTO media(tenant_id,id,mime,data,body,size,storage,created_at,ns) VALUES(:tenant,$1,$2,'',NULL,$3,$4,$5,1) ON CONFLICT (tenant_id,id) DO UPDATE SET mime=EXCLUDED.mime, data='', body=NULL, size=EXCLUDED.size, storage=EXCLUDED.storage, ns=1", [id, mime, size, have || kind, Date.now()]);
      meta.delete(id); bodies.delete(id);
    },
  };

  /**
   * The store's media library (WordPress-like): EVERY file this store holds (uploads, clients' photos, AI renders, pictures copied from a demo
   * or a backup), because each of them is a row of this store. Only THIS tenant's rows are ever listed or touched (`:tenant`).
   * A file stored by several stores is one object; deleting it here removes this store's row, and the object only when nobody else uses it.
   */
  const library = (() => {
    const view = (row, used) => ({
      id: row.id, url: `${PREFIX}${row.id}.${EXT[row.mime]}`, mime: row.mime, kind: kindOf(row.mime) || 'image', size: row.size == null ? null : Number(row.size),
      title: row.title || '', alt: row.alt || '', storage: row.storage, createdAt: Number(row.created_at), ...(used === undefined ? {} : { used }),
    });
    const REF = id => `%${PREFIX}${id}.%`;
    const ID = /^[a-f0-9]{32}$/;
    const own = async id => {
      if (!ID.test(String(id))) throw fail(400, 'INVALID_ID');
      const row = (await db.query("SELECT id,mime,size,storage,title,alt,created_at,ns FROM media WHERE tenant_id=:tenant AND id=$1 AND storage<>'pending'", [id]))[0];
      if (!row) throw fail(404, 'NOT_FOUND');
      return row;
    };
    /** Where a file is used: content items / documents of this store (collection or document name), administrator avatars and requests. */
    async function usage(id) {
      const out = [];
      for (const row of await db.query('SELECT coll,id FROM content_items WHERE tenant_id=:tenant AND data LIKE $1 ORDER BY coll,id LIMIT 20', [REF(id)])) out.push({ type: 'item', coll: row.coll, id: row.id });
      for (const row of await db.query('SELECT name FROM content_docs WHERE tenant_id=:tenant AND data LIKE $1 ORDER BY name LIMIT 20', [REF(id)])) out.push({ type: 'doc', name: row.name });
      for (const row of await db.query('SELECT admin_id FROM admin_accounts WHERE tenant_id=:tenant AND avatar LIKE $1 LIMIT 20', [REF(id)])) out.push({ type: 'avatar', id: row.admin_id });
      return out;
    }
    /** Ids of the files this store's content / avatars point at (one scan, used to flag tiles as "in use"). */
    async function usedIds() {
      const found = new Set();
      const scan = text => { for (const hit of String(text || '').matchAll(/\/api\/media\/([a-f0-9]{32})\./g)) found.add(hit[1]); };
      for (const row of await db.query('SELECT data FROM content_items WHERE tenant_id=:tenant')) scan(row.data);
      for (const row of await db.query('SELECT data FROM content_docs WHERE tenant_id=:tenant')) scan(row.data);
      for (const row of await db.query("SELECT avatar FROM admin_accounts WHERE tenant_id=:tenant AND avatar<>''")) scan(row.avatar);
      return found;
    }
    /**
     * Pictures and videos the store's content shows from an EXTERNAL https address (starter content, a link pasted before import). They are not
     * files of the store (no row, nothing stored), but they are part of what the store shows, so the library lists them read-only as `linked`.
     */
    async function linked() {
      const found = new Map();
      const walk = (node, key, parent) => {
        if (typeof node === 'string') {
          if (MEDIA_KEYS.has(key) && /^https?:\/\//i.test(node) && !LOCAL_MEDIA.test(node) && node.length <= 2048 && !found.has(node)) {
            const video = (key === 'uri' && parent?.type === 'video') || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(node);
            found.set(node, video ? 'video' : 'image');
          }
        } else if (Array.isArray(node)) node.forEach(child => walk(child, key, parent));
        else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, k, node);
      };
      const scan = text => { try { walk(JSON.parse(text), '', null); } catch { /* not JSON */ } };
      for (const row of await db.query("SELECT data FROM content_items WHERE tenant_id=:tenant AND data LIKE '%http%'")) scan(row.data);
      for (const row of await db.query("SELECT data FROM content_docs WHERE tenant_id=:tenant AND data LIKE '%http%'")) scan(row.data);
      return [...found].map(([url, type]) => ({
        id: crypto.createHash('sha256').update(url).digest('hex').slice(0, 32), url, mime: type === 'video' ? 'video/mp4' : 'image/*', kind: type, size: null,
        title: '', alt: '', storage: 'external', createdAt: 0, used: true, linked: true,
      }));
    }
    return {
      async list({ q = '', kind = '', limit = 60, offset = 0 } = {}) {
        const where = ["tenant_id=:tenant", "storage<>'pending'"], params = [];
        if (kind === 'image') { params.push('image/%'); where.push(`mime LIKE $${params.length}`); }
        else if (kind === 'video') { params.push('video/%'); where.push(`mime LIKE $${params.length}`); }
        else if (kind === 'audio') { params.push('audio/%'); where.push(`mime LIKE $${params.length}`); }
        const text = String(q || '').trim().slice(0, 80).toLowerCase();
        if (text) { params.push(`%${text.replace(/[%_\\]/g, ch => `\\${ch}`)}%`); where.push(`(LOWER(title) LIKE $${params.length} ESCAPE '\\' OR LOWER(alt) LIKE $${params.length} ESCAPE '\\')`); }
        const n = Math.max(1, Math.min(200, Number(limit) || 60)), skip = Math.max(0, Number(offset) || 0);
        const rows = await db.query(`SELECT id,mime,size,storage,title,alt,created_at FROM media WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT ${n + 1} OFFSET ${skip}`, params);
        const total = Number((await db.query(`SELECT COUNT(*) AS n FROM media WHERE ${where.join(' AND ')}`, params))[0].n);
        const used = await usedIds();
        const items = rows.slice(0, n).map(row => view(row, used.has(row.id)));
        // Externally hosted pictures follow the store's own files (read-only).
        const needle = text.replace(/[%_\\]/g, '');
        const extra = (await linked()).filter(item => (!kind || item.kind === kind) && (!text || item.url.toLowerCase().includes(needle)));
        const room = n - items.length;
        const from = Math.max(0, skip - total);
        if (room > 0) items.push(...extra.slice(from, from + room));
        return { items, more: rows.length > n || (room > 0 ? from + room < extra.length : skip + n < total + extra.length), total: total + extra.length };
      },
      async get(id) { const row = await own(id); return { ...view(row), usedIn: await usage(row.id) }; },
      async update(id, patch) {
        const row = await own(id);
        const next = {};
        if (patch?.title !== undefined) next.title = Array.from(String(patch.title ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 200).join('');
        if (patch?.alt !== undefined) next.alt = Array.from(String(patch.alt ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()).slice(0, 300).join('');
        const keys = Object.keys(next);
        if (keys.length) await db.query(`UPDATE media SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE tenant_id=:tenant AND id=$1`, [row.id, ...keys.map(k => next[k])]);
        return { ...view({ ...row, ...next }), usedIn: await usage(row.id) };
      },
      /**
       * Deletes files from THIS store. The store's row always goes; the stored object (every copy) goes only when no other store still points at
       * it (the store was the only owner). A file that content still shows is refused (`IN_USE`) unless `force`.
       */
      async remove(ids, { force = false } = {}) {
        const list = [...new Set((Array.isArray(ids) ? ids : [ids]).map(String))].slice(0, 200);
        const removed = [], blocked = [];
        for (const id of list) {
          let row;
          try { row = await own(id); } catch { blocked.push({ id, reason: 'NOT_FOUND' }); continue; }
          if (!force && (await usage(row.id)).length) { blocked.push({ id: row.id, reason: 'IN_USE' }); continue; }
          const result = await dropRow(row);
          if (result.error) { blocked.push({ id: row.id, reason: 'STORAGE_ERROR' }); continue; }
          removed.push(row.id);
        }
        return { removed, blocked };
      },
      async stats() {
        const r = (await db.query("SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM media WHERE tenant_id=:tenant AND storage<>'pending'"))[0];
        return { files: Number(r.files), bytes: Number(r.bytes) };
      },
    };
  })();

  /**
   * Removes this store's row of a file and, when no other store points at the same object, the object itself (and any copy a move left).
   * Database bytes are handed to another row that still needs them. Returns { object: true } when the stored object was deleted.
   */
  async function dropRow(row) {
    const name = `${row.id}.${EXT[row.mime]}`;
    const others = shared ? await shared.others(tenantId, row.id) : 0;
    let object = false;
    // Leftovers of a layout migration (`legacy-<storage>` records, see media-ops `repair`): this store's OWN old copy under its prefix.
    // It is never shared with anybody, so it goes with the row whether or not other stores still use the shared object.
    const olds = hub ? await hub.old.list(tenantId, [row.id]) : [];
    const ownCopy = old => old.storage.startsWith('legacy-');
    const adapterOf = old => adapters[old.storage.replace(/^legacy-/, '') === 'fs' ? 'fs' : 'r2'];
    const keyOfOld = old => (ownCopy(old) ? keyFor(tenantId)(name) : keyOfRow(tenantId, row, name));
    if (!others) {
      const key = keyOfRow(tenantId, row, name);
      if (row.storage === 'r2' || row.storage === 'fs') {
        try { await adapters[row.storage]?.remove(key); object = true; } catch { return { error: true }; }
      }
      for (const old of olds) { try { await adapterOf(old)?.remove(keyOfOld(old)); await hub.old.del(tenantId, row.id, old.storage); } catch { /* the console cleanup retries */ } }
    } else {
      if (shared && row.storage === 'db') await shared.handOver(tenantId, row.id);
      for (const old of olds) {
        if (ownCopy(old)) await adapterOf(old)?.remove(keyOfOld(old)).catch(() => {});
        await hub.old.del(tenantId, row.id, old.storage).catch(() => {});
      }
    }
    await db.query('DELETE FROM media WHERE tenant_id=:tenant AND id=$1', [row.id]);
    meta.delete(row.id); bodies.delete(row.id); saved.delete(row.id);
    return { object };
  }

  return { storeMedia, storeRaw, rawLimit, readMedia, fetchBytes, externalize, importRemote, presignUpload, completeUpload, moveRowToR2, backup, library, stats, get mode() { return modeNow(); } };
}

module.exports = { KEY_SHAPE, keyFor, createMedia, createR2Storage, createFsStorage, r2ClientOptions, r2Status, MEDIA_PREFIX: PREFIX, MEDIA_KEYS, R2_VARS, EXT, typeOfKey };
