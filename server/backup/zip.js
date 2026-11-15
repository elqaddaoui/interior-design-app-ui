/**
 * Streaming ZIP helpers for backups (yazl writes, yauzl reads). Nothing here ever loads a whole file in memory:
 *  - the writer pipes every entry through a SHA-256 hasher and finishes with manifest.json (built from those hashes);
 *  - the reader lists the central directory first and rejects anything unsafe (path traversal, absolute / drive paths, symlinks,
 *    absurd entry counts or sizes: zip bombs) before a single byte is extracted.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);

/** A pass-through that hashes and counts what flows through it. `.result()` is valid once the stream has ended. */
function hashing(onBytes) {
  const hash = crypto.createHash('sha256');
  let size = 0;
  const stream = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); size += chunk.length; if (onBytes) onBytes(chunk.length); cb(null, chunk); } });
  stream.result = () => ({ size, sha256: hash.digest('hex') });
  return stream;
}

/**
 * A pass-through that fails the stream when one of `secrets` (exact strings) appears in the data. A rolling window keeps matches that
 * straddle two chunks. The error names the entry, never the secret.
 */
function secretGuard(secrets, label) {
  const needles = secrets.filter(Boolean).map(value => Buffer.from(String(value)));
  if (!needles.length) return null;
  const keep = Math.max(...needles.map(n => n.length)) - 1;
  let tail = Buffer.alloc(0);
  return new Transform({
    transform(chunk, _enc, cb) {
      const window = tail.length ? Buffer.concat([tail, chunk]) : chunk;
      if (needles.some(needle => window.includes(needle))) return cb(fail(500, 'SECRET_LEAK', { entry: label }));
      tail = window.subarray(Math.max(0, window.length - keep));
      cb(null, chunk);
    },
  });
}

/**
 * Archive writer. `add*` queue entries (written one after the other); `finish(buildManifest)` appends manifest.json built from the hashes
 * of every earlier entry, closes the archive and resolves with { size, sha256, entries }.
 */
function createArchive(outPath, { onBytes, cancelled, secrets = [] } = {}) {
  const zip = new yazl.ZipFile();
  const entries = [];
  const out = fs.createWriteStream(outPath, { mode: 0o600 });
  const overall = hashing();
  let failure = null;
  const done = new Promise((resolve, reject) => {
    const abort = error => { failure ||= error; reject(failure); };
    zip.on('error', abort);
    out.on('error', abort);
    overall.on('error', abort);
    out.on('finish', () => (failure ? reject(failure) : resolve()));
    zip.outputStream.on('error', abort);
    zip.outputStream.pipe(overall).pipe(out);
  });
  done.catch(() => {});
  const lazy = (name, options, open, { guard: useGuard = true } = {}) => {
    zip.addReadStreamLazy(name, options, cb => {
      if (failure) return cb(failure);
      if (cancelled?.()) { failure = fail(409, 'CANCELLED'); return cb(failure); }
      Promise.resolve().then(open).then(source => {
        const hasher = hashing(onBytes);
        const guard = useGuard ? secretGuard(secrets, name) : null;
        const fromSource = guard ? source.pipe(guard) : source;
        source.on('error', error => hasher.destroy(error));
        if (guard) guard.on('error', error => hasher.destroy(error));
        // pipe() does not forward errors of its source: a failing entry (secret leak, unreadable file) must fail the whole archive.
        hasher.on('error', error => { failure ||= error; zip.outputStream.destroy(failure); out.destroy(failure); });
        hasher.on('end', () => entries.push({ path: name, ...hasher.result() }));
        cb(null, fromSource.pipe(hasher));
      }).catch(error => { failure ||= error; cb(error); });
    });
  };
  return {
    addFile(name, file, { compress = true, mtime, guard } = {}) { lazy(name, { compress, mtime: mtime || new Date(), mode: 0o100644 }, () => fs.createReadStream(file), { guard }); },
    addStream(name, open, { compress = true, guard } = {}) { lazy(name, { compress, mtime: new Date(), mode: 0o100644 }, open, { guard }); },
    addBuffer(name, buffer, { compress = true, guard } = {}) { lazy(name, { compress, mtime: new Date(), mode: 0o100644 }, () => Readable.from([buffer]), { guard }); },
    entries,
    async finish(buildManifest) {
      lazy('manifest.json', { compress: true, mtime: new Date(), mode: 0o100644 }, () => Readable.from([Buffer.from(JSON.stringify(buildManifest(entries.slice()), null, 2))]));
      zip.end();
      await done;
      const total = overall.result();
      return { size: total.size, sha256: total.sha256, entries: entries.slice() };
    },
    abort(error) { failure ||= error; zip.outputStream.destroy(error); out.destroy(error); },
  };
}

/** Is `name` a normal relative path with forward slashes and no traversal? (zip-slip guard) */
function safeEntryName(name) {
  if (typeof name !== 'string' || !name || name.length > 500) return false;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some(part => part === '..' || part === '.');
}
const isSymlink = entry => ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000;

const open = file => new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, zipfile) => (error ? reject(error) : resolve(zipfile))));

/**
 * Opens and lists an archive. Rejects: not a zip, too many entries, unsafe names, symlinks, duplicate names, over-large declared sizes or
 * compression ratios. Returns { zip, entries: Map(name -> entry) }; the caller must `zip.close()`.
 */
async function openArchive(file, { maxEntries = 300000, maxBytes = 50 * 1024 ** 3, maxRatio = 500 } = {}) {
  let zip;
  try { zip = await open(file); } catch { throw fail(400, 'NOT_A_ZIP'); }
  const entries = new Map();
  let total = 0;
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        const name = entry.fileName;
        if (name.endsWith('/')) return zip.readEntry();
        if (entries.size >= maxEntries) return reject(fail(400, 'ARCHIVE_TOO_MANY_FILES'));
        if (!safeEntryName(name)) return reject(fail(400, 'ARCHIVE_UNSAFE_PATH', { entry: name.slice(0, 80) }));
        if (isSymlink(entry)) return reject(fail(400, 'ARCHIVE_SYMLINK', { entry: name.slice(0, 80) }));
        if (entries.has(name)) return reject(fail(400, 'ARCHIVE_DUPLICATE', { entry: name.slice(0, 80) }));
        total += entry.uncompressedSize;
        if (total > maxBytes) return reject(fail(400, 'ARCHIVE_TOO_LARGE'));
        if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > maxRatio && entry.uncompressedSize > 10 * 1024 * 1024) return reject(fail(400, 'ARCHIVE_BOMB', { entry: name.slice(0, 80) }));
        entries.set(name, entry);
        zip.readEntry();
      });
      zip.readEntry();
    });
  } catch (error) { zip.close(); throw error.status ? error : fail(400, 'NOT_A_ZIP'); }
  return { zip, entries, totalBytes: total, close: () => zip.close() };
}
/** A readable stream of one entry. */
const openEntry = (archive, name) => new Promise((resolve, reject) => {
  const entry = archive.entries.get(name);
  if (!entry) return reject(fail(400, 'ARCHIVE_MISSING_ENTRY', { entry: String(name).slice(0, 80) }));
  archive.zip.openReadStream(entry, (error, stream) => (error ? reject(fail(400, 'ARCHIVE_CORRUPT', { entry: String(name).slice(0, 80) })) : resolve(stream)));
});
/** The whole entry as a Buffer (small entries only: manifest, schema). */
async function readEntry(archive, name, limit = 64 * 1024 * 1024) {
  const stream = await openEntry(archive, name);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) { size += chunk.length; if (size > limit) { stream.destroy(); throw fail(400, 'ARCHIVE_ENTRY_TOO_LARGE'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
/** Streams an entry through a hasher and a sink; resolves with { size, sha256 }. */
async function hashEntry(archive, name, { head = 0 } = {}) {
  const stream = await openEntry(archive, name);
  const hasher = hashing();
  let first = Buffer.alloc(0);
  if (head) hasher.on('data', chunk => { if (first.length < head) first = Buffer.concat([first, chunk]).subarray(0, head); });
  else hasher.resume();
  try { await pipeline(stream, hasher); } catch (error) { throw error.status ? error : fail(400, 'ARCHIVE_CORRUPT', { entry: String(name).slice(0, 80) }); }
  return { ...hasher.result(), head: first };
}

module.exports = { createArchive, openArchive, openEntry, readEntry, hashEntry, safeEntryName, hashing, secretGuard };
