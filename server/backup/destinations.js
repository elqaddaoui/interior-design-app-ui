/**
 * Where a finished backup goes besides the server's own disk: Google Drive or Dropbox, uploaded in chunks from the file on disk
 * (never loaded whole in memory), each chunk retried on network / 5xx errors.
 *
 * Credentials: an OAuth access token typed by the administrator for this one job (kept in memory, never written to disk, never put in
 * the archive, never logged), or the server's own token variables (GDRIVE_ACCESS_TOKEN / DROPBOX_ACCESS_TOKEN), or a refresh token with
 * its client id / secret (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN / DROPBOX_APP_KEY, DROPBOX_APP_SECRET,
 * DROPBOX_REFRESH_TOKEN). The endpoints can be redirected (GDRIVE_UPLOAD_URL, GOOGLE_TOKEN_URL, DROPBOX_API_URL, DROPBOX_CONTENT_URL,
 * DROPBOX_TOKEN_URL): the tests point them at a local fake.
 */
const fs = require('node:fs');

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const CHUNK_DEFAULT = 8 * 1024 * 1024; // multiple of 256 KiB (Google's rule)
const DROPBOX_SINGLE_DEFAULT = 100 * 1024 * 1024;
// Sizes can be lowered (tests, very slow links); Drive needs a multiple of 256 KiB.
const chunkSize = env => Math.max(256 * 1024, Math.floor((Number(env.BACKUP_UPLOAD_CHUNK) || CHUNK_DEFAULT) / (256 * 1024)) * 256 * 1024);
const singleLimit = env => Number(env.BACKUP_DROPBOX_SINGLE_BYTES) || DROPBOX_SINGLE_DEFAULT;

const configured = env => ({
  gdrive: !!(env.GDRIVE_ACCESS_TOKEN || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN)),
  dropbox: !!(env.DROPBOX_ACCESS_TOKEN || (env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET && env.DROPBOX_REFRESH_TOKEN)),
});

async function readChunk(handle, start, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, start);
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

function createDestinations({ env = process.env, fetch: doFetch = globalThis.fetch } = {}) {
  const CHUNK = chunkSize(env), DROPBOX_SINGLE = singleLimit(env);
  const send = async (url, init, label, { retries = 3, ok = [200, 201, 204] } = {}) => {
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await doFetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(120000) });
        if (ok.includes(response.status)) return response;
        if (response.status === 401 || response.status === 403) throw fail(502, 'DESTINATION_AUTH', { destination: label });
        if (response.status < 500 && response.status !== 429) throw fail(502, 'DESTINATION_FAILED', { destination: label, upstream: response.status });
        last = fail(502, 'DESTINATION_FAILED', { destination: label, upstream: response.status });
      } catch (error) {
        if (error.message === 'DESTINATION_AUTH' || (error.message === 'DESTINATION_FAILED' && error.upstream < 500 && error.upstream !== 429)) throw error;
        last = error.status ? error : fail(502, 'DESTINATION_UNREACHABLE', { destination: label });
      }
      await new Promise(resolve => setTimeout(resolve, env.NODE_ENV === 'test' ? 5 : 800 * (attempt + 1)));
    }
    throw last;
  };
  const form = body => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

  async function token(kind, given) {
    if (given) return String(given);
    if (kind === 'gdrive') {
      if (env.GDRIVE_ACCESS_TOKEN) return env.GDRIVE_ACCESS_TOKEN;
      if (!configured(env).gdrive) throw fail(400, 'DESTINATION_NOT_CONFIGURED', { destination: 'gdrive' });
      const response = await send(env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', form({ grant_type: 'refresh_token', client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: env.GOOGLE_REFRESH_TOKEN }), 'gdrive', { retries: 1, ok: [200] });
      const value = (await response.json().catch(() => ({}))).access_token;
      if (!value) throw fail(502, 'DESTINATION_AUTH', { destination: 'gdrive' });
      return value;
    }
    if (env.DROPBOX_ACCESS_TOKEN) return env.DROPBOX_ACCESS_TOKEN;
    if (!configured(env).dropbox) throw fail(400, 'DESTINATION_NOT_CONFIGURED', { destination: 'dropbox' });
    const response = await send(env.DROPBOX_TOKEN_URL || 'https://api.dropboxapi.com/oauth2/token', form({ grant_type: 'refresh_token', client_id: env.DROPBOX_APP_KEY, client_secret: env.DROPBOX_APP_SECRET, refresh_token: env.DROPBOX_REFRESH_TOKEN }), 'dropbox', { retries: 1, ok: [200] });
    const value = (await response.json().catch(() => ({}))).access_token;
    if (!value) throw fail(502, 'DESTINATION_AUTH', { destination: 'dropbox' });
    return value;
  }

  /** Google Drive resumable upload. Resolves with { id, name }. */
  async function toDrive({ file, name, size, accessToken, folderId, onBytes }) {
    const auth = { Authorization: `Bearer ${accessToken}` };
    const base = env.GDRIVE_UPLOAD_URL || 'https://www.googleapis.com/upload/drive/v3/files';
    const metadata = { name, ...(folderId ? { parents: [String(folderId)] } : {}) };
    const start = await send(`${base}?uploadType=resumable&fields=id,name`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/zip', 'X-Upload-Content-Length': String(size) }, body: JSON.stringify(metadata) }, 'gdrive');
    const session = start.headers.get('location');
    if (!session) throw fail(502, 'DESTINATION_FAILED', { destination: 'gdrive' });
    const handle = await fs.promises.open(file, 'r');
    try {
      let offset = 0;
      if (size === 0) { const empty = await send(session, { method: 'PUT', headers: { ...auth, 'Content-Length': '0' } }, 'gdrive', { ok: [200, 201] }); return empty.json().catch(() => ({})); }
      while (offset < size) {
        const body = await readChunk(handle, offset, Math.min(CHUNK, size - offset));
        const end = offset + body.length - 1;
        const response = await send(session, { method: 'PUT', headers: { ...auth, 'Content-Length': String(body.length), 'Content-Range': `bytes ${offset}-${end}/${size}` }, body }, 'gdrive', { ok: [200, 201, 308] });
        offset = end + 1;
        onBytes?.(body.length);
        if (response.status !== 308) return response.json().catch(() => ({}));
      }
      throw fail(502, 'DESTINATION_FAILED', { destination: 'gdrive' });
    } finally { await handle.close(); }
  }

  /** Dropbox: one request up to 100 MB, an upload session in 8 MB chunks above. Resolves with { path }. */
  async function toDropbox({ file, name, size, accessToken, folder, onBytes }) {
    const api = env.DROPBOX_CONTENT_URL || 'https://content.dropboxapi.com/2';
    const dir = `/${String(folder || 'Dwira backups').replace(/^\/+|\/+$/g, '').replace(/[\\:*?"<>|]/g, '_')}`;
    const target = `${dir}/${name}`;
    const call = (endpoint, arg, body) => send(`${api}/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify(arg).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`) }, body }, 'dropbox', { ok: [200] });
    const handle = await fs.promises.open(file, 'r');
    try {
      if (size <= DROPBOX_SINGLE) {
        const body = await readChunk(handle, 0, size);
        const done = await call('files/upload', { path: target, mode: 'add', autorename: true, mute: true }, body);
        onBytes?.(size);
        return done.json().catch(() => ({ path_display: target }));
      }
      let offset = 0;
      const first = await readChunk(handle, 0, CHUNK);
      const started = await call('files/upload_session/start', { close: false }, first);
      const sessionId = (await started.json().catch(() => ({}))).session_id;
      if (!sessionId) throw fail(502, 'DESTINATION_FAILED', { destination: 'dropbox' });
      offset = first.length; onBytes?.(first.length);
      while (size - offset > CHUNK) {
        const body = await readChunk(handle, offset, CHUNK);
        await call('files/upload_session/append_v2', { cursor: { session_id: sessionId, offset }, close: false }, body);
        offset += body.length; onBytes?.(body.length);
      }
      const last = await readChunk(handle, offset, size - offset);
      const done = await call('files/upload_session/finish', { cursor: { session_id: sessionId, offset }, commit: { path: target, mode: 'add', autorename: true, mute: true } }, last);
      onBytes?.(last.length);
      return done.json().catch(() => ({ path_display: target }));
    } finally { await handle.close(); }
  }

  return {
    configured: () => configured(env),
    /** Uploads `file`; resolves with a short, secret-free description of where it went. */
    async upload(kind, { file, name, size, auth = {}, onBytes }) {
      if (kind === 'gdrive') { const accessToken = await token('gdrive', auth.accessToken); const done = await toDrive({ file, name, size, accessToken, folderId: auth.folderId, onBytes }); return { destination: 'gdrive', name: done.name || name, id: done.id || '' }; }
      if (kind === 'dropbox') { const accessToken = await token('dropbox', auth.accessToken); const done = await toDropbox({ file, name, size, accessToken, folder: auth.folder, onBytes }); return { destination: 'dropbox', name: done.name || name, path: done.path_display || '' }; }
      throw fail(400, 'INVALID_DESTINATION');
    },
  };
}
module.exports = { createDestinations, configured };
