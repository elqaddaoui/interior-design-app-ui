/**
 * HTTP surface of the backup service, shared by the store admin (/api/admin/backup/*) and the super admin (/api/super-admin/backup/*).
 * The caller authenticates, checks the role / permission and builds the `scope`; this file only maps requests to service calls.
 * Returns { status, data } or { download } (a finished archive to stream), or null when the path is not a backup route.
 *
 *   GET    /capabilities                      what this host can do (types, provider, media storages, destinations)
 *   GET    /jobs                              recent jobs of this scope
 *   POST   /jobs                              start a backup            { type, data, media, provider, destination, auth }
 *   GET    /jobs/:id                          progress, steps, log, errors
 *   POST   /jobs/:id/cancel
 *   GET    /jobs/:id/download                 the finished zip, streamed (Range supported)
 *   POST   /uploads                           { size } -> uploadId        (restore step 1)
 *   POST   /uploads/:id/chunk?offset=N        raw bytes of one chunk      (step 2, repeated)
 *   POST   /uploads/:id/complete              starts the validation job   (step 3)
 *   DELETE /uploads/:id
 *   POST   /restores                          { uploadId, confirm: true, parts, mediaTarget, safetyBackup }
 */
const ID = '([a-f0-9]{8,32})';

async function route({ backup, scope, req, url, readBody, path, audit }) {
  const method = req.method;
  let m;
  const ok = (data, status = 200) => ({ status, data });
  if (path === '/capabilities' && method === 'GET') return ok(await backup.capabilities(scope));
  // ---- the vault (platform scope only): history, previews, restore from history, schedule + retention
  if (path === '/vault' && method === 'GET') return ok(await backup.vault.info(scope));
  if (path === '/vault/settings' && (method === 'GET' || method === 'PATCH')) {
    const settings = await backup.vault.settings(scope, method === 'PATCH' ? await readBody(req) : undefined);
    if (method === 'PATCH') await audit?.('backup.settings', JSON.stringify(settings));
    return ok({ settings });
  }
  if (path === '/vault/prune' && method === 'POST') { const r = await backup.vault.prune(scope, await readBody(req)); await audit?.('backup.prune', `${r.removed} removed`); return ok(r); }
  if (path === '/previews' && method === 'POST') return ok(await backup.vault.addPreview(scope, (await readBody(req))?.data), 201);
  if ((m = new RegExp(`^/vault/${ID}/preview$`).exec(path)) && method === 'GET') return { image: await backup.vault.preview(scope, m[1]) };
  if ((m = new RegExp(`^/vault/${ID}/download$`).exec(path)) && method === 'GET') { const f = await backup.vault.open(scope, m[1]); await audit?.('backup.download', f.name); return { pipe: f }; }
  if ((m = new RegExp(`^/vault/${ID}/prepare$`).exec(path)) && method === 'POST') { const r = await backup.vault.prepare(scope, m[1]); await audit?.('restore.prepare', m[1]); return ok(r, 202); }
  if ((m = new RegExp(`^/vault/${ID}$`).exec(path)) && method === 'DELETE') { const r = await backup.vault.remove(scope, m[1]); await audit?.('backup.delete', r.name); return ok(r); }
  if (path === '/jobs' && method === 'GET') return ok({ jobs: await backup.list(scope) });
  if (path === '/jobs' && method === 'POST') {
    const body = await readBody(req);
    const job = await backup.startBackup(scope, body);
    await audit?.('backup.start', `${job.options.type}${job.options.media ? '+media' : ''} -> ${job.options.destination}`);
    return ok({ job }, 202);
  }
  if ((m = new RegExp(`^/jobs/${ID}$`).exec(path)) && method === 'GET') return ok({ job: await backup.get(scope, m[1]) });
  if ((m = new RegExp(`^/jobs/${ID}/cancel$`).exec(path)) && method === 'POST') return ok({ job: await backup.cancel(scope, m[1]) });
  if ((m = new RegExp(`^/jobs/${ID}/download$`).exec(path)) && method === 'GET') {
    const file = await backup.file(scope, m[1]);
    await audit?.('backup.download', file.name);
    return { download: file };
  }
  if (path === '/uploads' && method === 'POST') return ok(await backup.createUpload(scope, await readBody(req)), 201);
  if ((m = new RegExp(`^/uploads/${ID}/chunk$`).exec(path)) && method === 'POST') return ok(await backup.appendChunk(scope, m[1], Number(url.searchParams.get('offset')), req));
  if ((m = new RegExp(`^/uploads/${ID}/complete$`).exec(path)) && method === 'POST') return ok(await backup.completeUpload(scope, m[1]), 202);
  if ((m = new RegExp(`^/uploads/${ID}$`).exec(path)) && method === 'DELETE') { await backup.discardUpload(scope, m[1]); return ok({ ok: true }); }
  if (path === '/restores' && method === 'POST') {
    const body = await readBody(req);
    const job = await backup.startRestore(scope, body);
    await audit?.('restore.start', `${Object.entries(job.options.parts).filter(([, on]) => on).map(([k]) => k).join('+')}${job.options.mediaTarget ? ` media->${job.options.mediaTarget}` : ''}`);
    return ok({ job }, 202);
  }
  return null;
}
module.exports = { route };
