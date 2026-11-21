/**
 * Optional encryption of a backup archive before it leaves the server (BACKUP_ENCRYPTION_KEY).
 *
 * Format "DWBK1": magic (5) | salt (16) | chunk size (4, big endian), then records of
 *   flag (1: 1 = last record) | cipher length (4) | AES-256-GCM cipher text | tag (16).
 * The key is scrypt(passphrase, salt). The nonce of record n is 4 bytes of the salt + n (8 bytes), the flag is authenticated data, so a
 * tampered, reordered, cut-off or wrong-key file fails with BACKUP_DECRYPT_FAILED instead of producing garbage. Streams in 1 MiB records:
 * memory stays flat whatever the size.
 */
const crypto = require('node:crypto');
const { Transform } = require('node:stream');

const MAGIC = Buffer.from('DWBK1');
const CHUNK = 1024 * 1024;
const TAG = 16;
const fail = (status, message) => Object.assign(new Error(message), { status });
const deriveKey = (pass, salt) => crypto.scryptSync(String(pass), salt, 32, { N: 16384, r: 8, p: 1 });
const nonceOf = (salt, n) => { const b = Buffer.alloc(12); salt.copy(b, 0, 0, 4); b.writeBigUInt64BE(BigInt(n), 4); return b; };

function encryptStream(pass) {
  if (!pass) throw fail(500, 'BACKUP_KEY_MISSING');
  const salt = crypto.randomBytes(16);
  const key = deriveKey(pass, salt);
  let counter = 0, pending = Buffer.alloc(0), started = false;
  const header = () => { const h = Buffer.alloc(4); h.writeUInt32BE(CHUNK); return Buffer.concat([MAGIC, salt, h]); };
  const seal = (plain, last) => {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonceOf(salt, counter++));
    cipher.setAAD(Buffer.from([last ? 1 : 0]));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    const head = Buffer.alloc(5); head[0] = last ? 1 : 0; head.writeUInt32BE(body.length, 1);
    return Buffer.concat([head, body, cipher.getAuthTag()]);
  };
  return new Transform({
    transform(chunk, _enc, cb) {
      try {
        if (!started) { started = true; this.push(header()); }
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        while (pending.length > CHUNK) { this.push(seal(pending.subarray(0, CHUNK), false)); pending = pending.subarray(CHUNK); }
        cb();
      } catch (error) { cb(error); }
    },
    flush(cb) {
      try { if (!started) this.push(header()); this.push(seal(pending, true)); cb(); } catch (error) { cb(error); }
    },
  });
}

function decryptStream(pass) {
  if (!pass) throw fail(400, 'BACKUP_KEY_MISSING');
  let buf = Buffer.alloc(0), key = null, salt = null, counter = 0, sawLast = false;
  const bad = () => fail(400, 'BACKUP_DECRYPT_FAILED');
  const drain = stream => {
    for (;;) {
      if (!key) {
        if (buf.length < MAGIC.length + 16 + 4) return;
        if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw fail(400, 'BACKUP_NOT_ENCRYPTED');
        salt = Buffer.from(buf.subarray(MAGIC.length, MAGIC.length + 16));
        key = deriveKey(pass, salt);
        buf = buf.subarray(MAGIC.length + 16 + 4);
        continue;
      }
      if (sawLast) { if (buf.length) throw bad(); return; }
      if (buf.length < 5) return;
      const length = buf.readUInt32BE(1);
      if (length > CHUNK) throw bad();
      if (buf.length < 5 + length + TAG) return;
      const last = buf[0] === 1;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonceOf(salt, counter++));
      decipher.setAAD(Buffer.from([last ? 1 : 0]));
      decipher.setAuthTag(buf.subarray(5 + length, 5 + length + TAG));
      try { stream.push(Buffer.concat([decipher.update(buf.subarray(5, 5 + length)), decipher.final()])); } catch { throw bad(); }
      buf = buf.subarray(5 + length + TAG);
      sawLast = last;
    }
  };
  return new Transform({
    transform(chunk, _enc, cb) { try { buf = buf.length ? Buffer.concat([buf, chunk]) : chunk; drain(this); cb(); } catch (error) { cb(error); } },
    flush(cb) { try { drain(this); if (!key) throw fail(400, 'BACKUP_NOT_ENCRYPTED'); if (!sawLast || buf.length) throw bad(); cb(); } catch (error) { cb(error); } },
  });
}

module.exports = { encryptStream, decryptStream };
