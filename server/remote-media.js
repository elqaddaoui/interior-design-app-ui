/**
 * Safe one-time download of an external media URL (used to copy pasted Unsplash/CDN images into our own storage).
 *  - https only, default port, no credentials in the URL, at most 3 redirects (each one re-checked)
 *  - every resolved address must be public: private, loopback, link-local, CGNAT, multicast, documentation and other
 *    reserved ranges are refused. The check runs inside the socket's DNS lookup, so the connection is pinned to the
 *    address that was checked (no DNS-rebinding window).
 *  - 10 s overall timeout, size cap enforced on the Content-Length header AND while streaming
 *  - type allowlist from the Content-Type header, confirmed by sniffing the first bytes
 * Errors carry `policy: true` when the URL itself is unacceptable (retrying will not help) and `policy: false` for
 * transient failures (timeout, network, 5xx).
 */
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
// Voice notes recorded in the chat (Chrome/Firefox: webm or ogg, Safari/iOS/Android: mp4/m4a/aac, some: wav/mp3).
const AUDIO_TYPES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac'];
const AUDIO_ALIASES = { 'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/mp3': 'audio/mpeg', 'audio/x-aac': 'audio/aac', 'video/webm': 'audio/webm' };
const audioType = mime => AUDIO_ALIASES[mime] || mime;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_IMAGE_MAX = 10 * 1024 * 1024;

// Two separate lists: Node's BlockList matches IPv4 addresses against IPv6 rules covering ::ffff:0:0/96, so one shared
// list containing ::/8 would block every public IPv4 address.
const BLOCKED_V4 = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED_V4.addSubnet(address, prefix, 'ipv4');
const BLOCKED_V6 = new net.BlockList();
for (const [address, prefix] of [
  // ::/8 covers ::, ::1 and IPv4-compatible addresses; IPv4-mapped ones are unwrapped and checked as IPv4 below.
  ['::', 8], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) BLOCKED_V6.addSubnet(address, prefix, 'ipv6');

/** `::ffff:a.b.c.d` or `::ffff:7f00:1` -> 'a.b.c.d'; null when the address is not IPv4-mapped. */
function unmapIPv4(address) {
  const lower = address.toLowerCase();
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`; }
  return null;
}

/** True for every address a server-side download must never reach. Unknown formats count as private. */
function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return BLOCKED_V4.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = unmapIPv4(address);
  if (mapped) return BLOCKED_V4.check(mapped, 'ipv4') || BLOCKED_V6.check(address, 'ipv6');
  return BLOCKED_V6.check(address, 'ipv6');
}

const policy = (code, status) => Object.assign(new Error(code), { code, policy: true, ...(status ? { httpStatus: status } : {}) });
const transient = code => Object.assign(new Error(code), { code, policy: false });

/** Parses and checks a URL before any network access. */
function parseRemoteUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw policy('INVALID_URL'); }
  if (url.protocol !== 'https:') throw policy('HTTPS_REQUIRED');
  if (url.username || url.password) throw policy('CREDENTIALS_NOT_ALLOWED');
  if (url.port && url.port !== '443') throw policy('PORT_NOT_ALLOWED');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw policy('INVALID_URL');
  if (net.isIP(host) && isPrivateAddress(host)) throw policy('PRIVATE_ADDRESS');
  return url;
}

/** A `lookup` for the socket that refuses private answers (so the connection uses exactly the checked address). */
function safeLookup(resolve = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]).filter(Boolean);
      if (!list.length || list.some(entry => isPrivateAddress(entry.address))) return callback(policy('PRIVATE_ADDRESS'));
      if (options.all) return callback(null, list);
      callback(null, list[0].address, list[0].family);
    });
  };
}

function httpsTransport(url, { lookup, signal, headers }) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers, lookup, signal, agent: false }, res => resolve({ status: res.statusCode, headers: res.headers, body: res }));
    req.on('error', reject);
    req.end();
  });
}

const startsWith = (buffer, bytes, offset = 0) => buffer.length >= offset + bytes.length && bytes.every((byte, i) => buffer[offset + i] === byte);
/** Real type of a media file from its first bytes, or '' when unknown. SVG is text and detected separately. */
function sniff(buffer) {
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand === 'qt  ') return 'video/quicktime';
    return 'video/mp4';
  }
  const head = buffer.subarray(0, 1024).toString('utf8').trimStart().toLowerCase();
  if ((head.startsWith('<svg') || head.startsWith('<?xml')) && head.includes('<svg')) return 'image/svg+xml';
  return '';
}

/** Magic bytes of the audio containers the chat records. Returns '' when unknown. */
function sniffAudio(buffer) {
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm';
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) return 'audio/mp4';
  if (startsWith(buffer, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x41, 0x56, 0x45], 8)) return 'audio/wav';
  if (startsWith(buffer, [0x49, 0x44, 0x33])) return 'audio/mpeg';
  if (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'audio/aac'; // ADTS
  if (buffer.length > 1 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg'; // MPEG frame sync
  return '';
}

/**
 * Confirms that `buffer` really is media of an allowed type. Returns the trusted MIME type (the sniffed one wins over a
 * wrong declaration) or throws a policy error.
 */
function verifyMedia(buffer, declared, kind) {
  if (kind === 'audio') {
    const found = sniffAudio(buffer);
    if (!found) throw policy('NOT_AUDIO');
    const claimed = audioType(declared);
    if (claimed && claimed !== found && !(AUDIO_TYPES.includes(claimed) && ['audio/aac', 'audio/mpeg'].includes(found) && ['audio/aac', 'audio/mpeg'].includes(claimed))) throw policy('TYPE_MISMATCH');
    return found;
  }
  const allowed = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
  const actual = sniff(buffer);
  if (!actual || !allowed.includes(actual)) throw policy(kind === 'video' ? 'NOT_A_VIDEO' : 'NOT_AN_IMAGE');
  // An MP4/MOV container may legitimately be declared as either.
  if (declared && declared !== actual && !(VIDEO_TYPES.includes(declared) && VIDEO_TYPES.includes(actual)) && !(IMAGE_TYPES.includes(declared) && IMAGE_TYPES.includes(actual))) throw policy('TYPE_MISMATCH');
  return actual;
}

/**
 * Downloads `input` once. kind 'image' (default): image/* only, `maxBytes` default 10 MB.
 * kind 'video' (migration script only): video/mp4|webm|quicktime.
 */
async function downloadRemote(input, { kind = 'image', maxBytes = DEFAULT_IMAGE_MAX, timeoutMs = DEFAULT_TIMEOUT_MS, lookup, transport = httpsTransport } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const accept = kind === 'video' ? VIDEO_TYPES.join(',') : 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8';
  try {
    let current = input;
    for (let hop = 0; hop <= 3; hop++) {
      const url = parseRemoteUrl(current);
      let res;
      try {
        res = await transport(url, { lookup: safeLookup(lookup), signal: controller.signal, headers: { Accept: accept, 'User-Agent': 'DwiraMediaImporter/1.0' } });
      } catch (error) {
        if (error?.policy) throw error;
        throw transient(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
      }
      const status = Number(res.status);
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.body?.destroy?.();
        if (!res.headers.location) throw policy('BAD_REDIRECT');
        current = new URL(String(res.headers.location), url).toString();
        continue;
      }
      if (status !== 200) { res.body?.destroy?.(); throw status >= 500 || status === 429 ? transient(`HTTP_${status}`) : policy(`HTTP_${status}`); }
      const declared = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const allowed = kind === 'video' ? VIDEO_TYPES : IMAGE_TYPES;
      if (!allowed.includes(declared)) { res.body?.destroy?.(); throw policy(kind === 'video' ? 'NOT_A_VIDEO' : 'NOT_AN_IMAGE'); }
      const length = Number(res.headers['content-length']);
      if (Number.isFinite(length) && length > maxBytes) { res.body?.destroy?.(); throw policy('TOO_LARGE'); }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of res.body) {
          size += chunk.length;
          if (size > maxBytes) { res.body.destroy?.(); throw policy('TOO_LARGE'); }
          chunks.push(Buffer.from(chunk));
        }
      } catch (error) {
        if (error?.policy) throw error;
        throw transient(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
      }
      const body = Buffer.concat(chunks);
      if (!body.length) throw policy('EMPTY');
      return { body, mime: verifyMedia(body, declared, kind) };
    }
    throw policy('TOO_MANY_REDIRECTS');
  } finally { clearTimeout(timer); }
}

module.exports = { downloadRemote, parseRemoteUrl, isPrivateAddress, safeLookup, sniff, sniffAudio, audioType, verifyMedia, IMAGE_TYPES, VIDEO_TYPES, AUDIO_TYPES };
