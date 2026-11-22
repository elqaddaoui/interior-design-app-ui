/**
 * Backup & restore service (tenant admin panel and super admin console share it).
 *
 *  - a backup is ONE zip: manifest.json (what it holds, hashes of every file; written last) + db/ (schema, rows as ndjson) + app/ (deployable
 *    files) + media/<store>/ (index.json and the files). Nothing secret is ever written (see dump.js, app-files.js, zip.js secretGuard).
 *  - everything runs as a background job (id, steps, progress, log, errors, cancel); routes return at once and the screen polls.
 *  - bytes always stream (database pages, files from R2 / disk, the upload from the browser): memory stays flat whatever the size.
 *  - a restore first VALIDATES the upload (zip safety, manifest, every hash), shows the plan, and only runs after an explicit confirmation.
 *    By default it first takes a safety snapshot of the database so a wrong restore can be undone.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yazl = require('yazl');
const { createArchive, openArchive, openEntry, readEntry, hashEntry, hashing } = require('./zip');
const { exportDatabase, importDatabase, detectProvider, checkProvider, tolerate, collectSecrets, specsFor } = require('./dump');
const { buildPreview, imageType } = require('./preview');
const { createSchedule } = require('./schedule');
const appFiles = require('./app-files');
const { createDestinations } = require('./destinations');
const { SCHEMA_VERSION } = require('../db');

const FORMAT = 'dwira-backup';
const FORMAT_VERSION = 1;
/** What the super admin picks: the whole app, the database, the code, or the files. Everything maps onto the archive parts below. */
const KIND_OPTIONS = { all: { type: 'both', media: true }, db: { type: 'db', media: false }, code: { type: 'app', media: false }, media: { type: 'media', media: true } };
const KIND_OF = (type, media) => (type === 'both' ? (media ? 'all' : 'db+code') : type === 'app' ? 'code' : type === 'media' ? 'media' : 'db');
const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const TYPES = { app: { app: true, db: false }, db: { app: false, db: true }, both: { app: true, db: true }, media: { app: false, db: false } };
/**
 * A store that is not the owner's has no server files of its own (the code is shared by every store and stays with the platform owner), so its
 * three choices split ITS OWN tables instead: "app" = how the store looks and what it offers (content, settings, theme, menus, preferences),
 * "db" = its operational data (clients, credits, requests, chats, campaigns, administrators), "both" = everything.
 */
const STORE_APP_TABLES = ['content_items', 'content_docs', 'settings', 'admin_prefs'];
const TEXTUAL = /\.(js|mjs|cjs|json|html|css|map|txt|md|sql|ndjson|xml|webmanifest|yml|yaml|ts|tsx)$/i;
const stamp = (at = Date.now()) => new Date(at).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const errorOf = error => ({ code: error.status ? error.message : 'INTERNAL', ...Object.fromEntries(['entry', 'table', 'destination', 'upstream', 'detected', 'tenant'].filter(k => error[k] !== undefined).map(k => [k, error[k]])) });

function createBackupService({ db, bundles, env = process.env, appRoot, tenantIds = async () => ['default'], onRestored, onBackupFinished, fetch: doFetch, now = Date.now, vault = null } = {}) {
  const dir = path.resolve(env.BACKUP_DIR || path.join(appRoot, 'server', 'data', 'backups'));
  const FILES = path.join(dir, 'files'), WORK = path.join(dir, 'work'), UPLOADS = path.join(dir, 'uploads'), JOBS = path.join(dir, 'jobs');
  const keepMs = Math.max(1, Number(env.BACKUP_KEEP_HOURS) || 24) * 3600000;
  const keepFiles = Math.max(1, Number(env.BACKUP_KEEP_FILES) || 5);
  const maxUpload = Math.max(1, Number(env.BACKUP_MAX_UPLOAD_MB) || 5120) * 1024 * 1024;
  const destinations = createDestinations({ env, ...(doFetch ? { fetch: doFetch } : {}) });
  const jobs = new Map();
  const uploads = new Map();
  const appVersion = String(env.APP_VERSION || '').replace(/^v/i, '') || (() => { try { return JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version || ''; } catch { return ''; } })() || '0.0.0';
  const previews = new Map(); // id -> { buffer, type, at, scopeKey }: screenshots taken by the browser just before a backup
  const vaultOn = scope => !!vault && scope.kind === 'platform';
  const supported = () => !env.VERCEL || env.BACKUP_FORCE === '1';
  const scopeKey = scope => (scope.kind === 'platform' ? 'platform' : `tenant:${scope.tenantId}`);
  const handleOf = scope => (scope.kind === 'platform' ? db : bundles.get(scope.tenantId).db);
  const idsOf = async scope => (scope.kind === 'platform' ? tenantIds() : [scope.tenantId]);

  let loaded;
  const ensureLoaded = () => loaded ||= (async () => { if (!fs.existsSync(JOBS)) return; await api.load(); })().catch(() => {});
  const ensureDirs = async () => { for (const d of [FILES, WORK, UPLOADS, JOBS]) await fs.promises.mkdir(d, { recursive: true, mode: 0o700 }); };

  // ---------------------------------------------------------------- jobs
  const log = (job, level, code, extra = {}) => { job.seq = (job.seq || 0) + 1; job.log.push({ n: job.seq, at: now(), level, code, ...extra }); if (job.log.length > 600) job.log.shift(); };
  const view = job => ({
    id: job.id, kind: job.kind, status: job.status, progress: Math.round(job.progress), steps: job.steps.map(({ key, status, detail }) => ({ key, status, ...(detail ? { detail } : {}) })),
    log: job.log.slice(-300), errors: job.errors, warnings: job.warnings, options: job.options, createdAt: job.createdAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
    result: job.result ? { ...job.result, file: undefined, path: undefined } : null, canDownload: !!(job.result?.file && job.status !== 'running' && fs.existsSync(job.result.file)),
    cancelling: !!job.cancel && job.status === 'running',
  });
  const save = job => { if (job.status === 'running' || job.status === 'queued') return; fs.promises.writeFile(path.join(JOBS, `${job.id}.json`), JSON.stringify({ ...job, scopeKey: job.scopeKey }), { mode: 0o600 }).catch(() => {}); };
  const stepper = job => {
    const total = job.steps.reduce((sum, s) => sum + s.weight, 0) || 1;
    const recompute = () => { job.progress = Math.min(99.9, job.steps.reduce((sum, s) => sum + s.weight * (s.status === 'done' ? 1 : s.status === 'running' ? s.fraction || 0 : 0), 0) / total * 100); };
    return {
      start(key, detail) { const s = job.steps.find(x => x.key === key); if (!s) return; s.status = 'running'; s.fraction = 0; if (detail) s.detail = detail; log(job, 'info', 'step.start', { step: key }); recompute(); },
      fraction(key, value) { const s = job.steps.find(x => x.key === key); if (!s) return; s.fraction = Math.max(0, Math.min(1, value)); recompute(); },
      done(key, detail) { const s = job.steps.find(x => x.key === key); if (!s) return; s.status = 'done'; s.fraction = 1; if (detail) s.detail = detail; log(job, 'info', 'step.done', { step: key, ...(detail || {}) }); recompute(); },
      skip(key) { const s = job.steps.find(x => x.key === key); if (s) { s.status = 'skipped'; s.weight = 0; } },
      failed(key) { const s = job.steps.find(x => x.key === key); if (s && s.status === 'running') s.status = 'error'; },
    };
  };
  function newJob(kind, scope, options, keys) {
    const job = { id: crypto.randomBytes(8).toString('hex'), kind, scopeKey: scopeKey(scope), actor: scope.actor || '', status: 'queued', progress: 0, steps: keys.map(([key, weight]) => ({ key, weight, status: 'pending', fraction: 0 })), log: [], errors: [], warnings: [], options, createdAt: now(), result: null, cancel: false };
    jobs.set(job.id, job);
    return job;
  }
  const running = scope => [...jobs.values()].find(job => job.scopeKey === scopeKey(scope) && (job.status === 'running' || job.status === 'queued'));
  const globalRunning = () => [...jobs.values()].filter(job => job.status === 'running' || job.status === 'queued').length;
  async function launch(job, scope, body) {
    job.status = 'running'; job.startedAt = now();
    const steps = stepper(job);
    try {
      job.result = await body(steps);
      job.status = job.cancel ? 'cancelled' : job.errors.length && job.result?.failed ? 'error' : 'done';
      if (job.status === 'done') job.progress = 100;
    } catch (error) {
      job.status = error.message === 'CANCELLED' ? 'cancelled' : 'error';
      for (const step of job.steps) steps.failed(step.key);
      if (job.status === 'error') { job.errors.push(errorOf(error)); log(job, 'error', error.status ? error.message : 'INTERNAL', errorOf(error)); if (!error.status) console.warn('Backup job failed:', error.message); }
      job.result ||= job.partial || null;
    } finally {
      job.finishedAt = now(); job.partial = undefined;
      await fs.promises.rm(path.join(WORK, job.id), { recursive: true, force: true }).catch(() => {});
      save(job);
      // A finished backup is reported to the owner of the service (the free-tier monitor remembers the last good one). Never breaks the job.
      if (job.kind === 'backup' && job.status === 'done') { try { await onBackupFinished?.({ scope, job: view(job) }); } catch { /* informational */ } }
    }
  }
  const start = (job, scope, body) => { launch(job, scope, body).catch(() => {}); return view(job); };
  const guardStart = async scope => {
    if (!supported()) throw fail(501, 'BACKUP_UNSUPPORTED_HOST');
    if (running(scope)) throw fail(409, 'BACKUP_BUSY', { job: running(scope).id });
    if (globalRunning() >= Math.max(1, Number(env.BACKUP_MAX_JOBS) || 2)) throw fail(429, 'BACKUP_SERVER_BUSY');
    await ensureDirs();
  };

  // ---------------------------------------------------------------- options
  function backupOptions(scope, input = {}) {
    // `kind` (all | db | code | media) is the super admin's vocabulary; `type` (app | db | both | media) the archive's. One of them is enough.
    const kinded = input.kind !== undefined ? (KIND_OPTIONS[input.kind] || (() => { throw fail(400, 'INVALID_TYPE'); })()) : null;
    if (kinded) input = { ...input, type: kinded.type, media: kinded.media };
    const type = TYPES[input.type] ? input.type : (() => { throw fail(400, 'INVALID_TYPE'); })();
    const store = scope.kind === 'tenant' && !scope.canApp;
    if (store && type === 'media') throw fail(400, 'INVALID_TYPE');
    let parts = { ...TYPES[type] };
    let tables = null; // null = every table of the scope
    if (store) {
      parts = { app: false, db: true };
      if (type === 'app') tables = STORE_APP_TABLES;
      else if (type === 'db') tables = specsFor(true).map(spec => spec.table).filter(table => !STORE_APP_TABLES.includes(table));
    } else if (parts.app && !scope.canApp) throw fail(403, 'APP_SCOPE_FORBIDDEN');
    const data = input.data === 'empty' ? 'empty' : input.data === 'content' || input.data === undefined ? 'content' : (() => { throw fail(400, 'INVALID_DATA_MODE'); })();
    const destination = ['local', 'gdrive', 'dropbox', ...(vaultOn(scope) ? ['vault'] : [])].includes(input.destination || 'local') ? input.destination || 'local' : (() => { throw fail(400, 'INVALID_DESTINATION'); })();
    const auth = destination === 'local' || destination === 'vault' ? {} : { accessToken: typeof input.auth?.accessToken === 'string' ? input.auth.accessToken.trim().slice(0, 4096) : '', folderId: String(input.auth?.folderId || '').slice(0, 200), folder: String(input.auth?.folder || '').slice(0, 200) };
    return { type, kind: store ? null : KIND_OF(type, input.media === true), parts, tables, storeParts: store ? type : null, data: store && type === 'app' ? 'content' : data, media: type === 'media' ? true : input.media === true, destination, provider: input.provider || 'auto', auth, createdBy: ['schedule', 'pre-restore', 'limit'].includes(input.createdBy) ? input.createdBy : 'manual', previewId: typeof input.previewId === 'string' ? input.previewId.slice(0, 40) : '' };
  }
  const publicOptions = o => ({ type: o.type, kind: o.kind, data: o.data, media: o.media, destination: o.destination, provider: o.provider, createdBy: o.createdBy });

  // ---------------------------------------------------------------- backup
  async function startBackup(scope, input) {
    const o = backupOptions(scope, input);
    const engine = await handleOf(scope).info();
    const detected = detectProvider(env, engine);
    const provider = o.parts.db ? checkProvider(o.provider, detected) : null;
    if (o.destination === 'vault' && !vaultOn(scope)) throw fail(400, 'VAULT_NOT_CONFIGURED');
    await guardStart(scope);
    const keys = [['prepare', 3], ...(o.parts.db ? [['database', 20]] : []), ...(o.parts.app ? [['app', 15]] : []), ...(o.media ? [['media', 50]] : []), ['package', 5], ...(o.destination === 'vault' ? [['vault', 25]] : o.destination !== 'local' ? [['upload', 25]] : [])];
    const job = newJob('backup', scope, publicOptions({ ...o, provider: provider || 'auto' }), keys);
    return start(job, scope, steps => runBackup(job, scope, o, { provider, engine, detected }, steps));
  }

  async function runBackup(job, scope, o, { provider, engine }, steps) {
    const cancelled = () => job.cancel;
    const work = path.join(WORK, job.id);
    const partFile = path.join(FILES, `${job.id}.part`);
    const name = `dwira-${scope.kind === 'platform' ? 'platform' : scope.tenantId}-${o.type}${o.parts.db && o.data === 'empty' ? '-schema' : ''}${o.media && o.type !== 'media' ? '-media' : ''}-${stamp(now())}.zip`;
    const finalFile = path.join(FILES, `${job.id}-${name}`);
    steps.start('prepare');
    await fs.promises.mkdir(work, { recursive: true, mode: 0o700 });
    const handle = handleOf(scope);
    const tenant = scope.kind === 'tenant';
    const ids = await idsOf(scope);
    const secrets = [...new Set([
      ...Object.entries(env).filter(([k, v]) => /(SECRET|TOKEN|PASSWORD|PRIVATE|API_?KEY|ACCESS_KEY|DATABASE_URL|POSTGRES_URL|PRISMA)/i.test(k) && !/PUBLIC/i.test(k) && typeof v === 'string' && v.length >= 12).map(([, v]) => v),
      ...(o.parts.db || o.media ? await collectSecrets({ db: handle, tenant }) : []),
      ...(o.auth.accessToken && o.auth.accessToken.length >= 12 ? [o.auth.accessToken] : []),
    ])];
    // Media inventory (sizes known up front: disk check + progress).
    const media = [];
    if (o.media) for (const id of ids) { const b = bundles.get(id).media.backup; for (const row of await b.list()) media.push({ tenant: id, row, backup: b }); }
    const mediaBytes = media.reduce((sum, m) => sum + (m.row.size || 0), 0);
    const app = o.parts.app ? await appFiles.listApp(appRoot) : [];
    const appBytes = app.reduce((sum, f) => sum + f.size, 0);
    // A deployment that was built elsewhere (only dist/ + server/) cannot give back a project that builds: say so instead of staying silent.
    const noSource = o.parts.app && !app.some(f => f.rel.startsWith('src/'));
    if (noSource) { job.warnings.push({ code: 'APP_SOURCE_MISSING' }); log(job, 'warn', 'APP_SOURCE_MISSING'); }
    try {
      const free = (await fs.promises.statfs(FILES)); const available = Number(free.bavail) * Number(free.bsize);
      if (available < (mediaBytes + appBytes) * 1.05 + 64 * 1024 * 1024) throw fail(507, 'NOT_ENOUGH_DISK');
    } catch (error) { if (error.status) throw error; }
    // The picture of how the app looks right now (what a restore of this backup will bring back): the one the browser took, else a snapshot built from the data.
    let preview = null;
    if (o.destination === 'vault') {
      const given = o.previewId && previews.get(o.previewId);
      if (given && given.scopeKey === scopeKey(scope)) { preview = { buffer: given.buffer, type: given.type, source: 'screenshot' }; previews.delete(o.previewId); }
      else { try { preview = await buildPreview({ db: handle, version: appVersion, at: now(), kind: o.kind }); } catch { preview = null; } }
      if (preview) log(job, 'info', 'preview.ok', { source: preview.source, bytes: preview.buffer.length });
    }
    log(job, 'info', 'prepare.ok', { media: media.length, app: app.length, version: appVersion });
    steps.done('prepare');

    let mediaDone = 0;
    const archive = createArchive(partFile, { cancelled, secrets, onBytes: n => { if (o.media && mediaBytes) { mediaDone += n; } } });
    job.partial = null;
    try {
      let dumped = null;
      if (o.parts.db) {
        steps.start('database');
        let tables = 0;
        dumped = await exportDatabase({ db: handle, tenant, only: o.tables || undefined, schemaOnly: o.data === 'empty', dir: path.join(work, 'db'), cancelled, onTable: ({ table, rows }) => { tables++; log(job, 'info', 'db.table', { table, rows }); steps.fraction('database', Math.min(0.95, tables / 24)); } });
        archive.addBuffer('db/schema.sql', Buffer.from(dumped.schemaSql));
        for (const f of dumped.files) archive.addFile(f.name, f.file);
        archive.addBuffer('db/tables.json', Buffer.from(JSON.stringify({ schemaVersion: dumped.schemaVersion, schemaOnly: o.data === 'empty', tables: dumped.tables })));
        steps.done('database', { tables: Object.keys(dumped.tables).length });
      }
      if (o.parts.app) {
        steps.start('app');
        for (const f of app) archive.addFile(`app/${f.rel}`, f.abs, { guard: TEXTUAL.test(f.rel) });
        log(job, 'info', 'app.queued', { files: app.length });
      }
      const mediaIndex = {};
      const missing = [];
      if (o.media) {
        for (const id of ids) mediaIndex[id] = [];
        for (const m of media) {
          const file = `${m.row.id}.${require('../media').EXT[m.row.mime]}`;
          mediaIndex[m.tenant].push({ id: m.row.id, mime: m.row.mime, size: m.row.size, storage: m.row.storage, name: file });
          archive.addStream(`media/${m.tenant}/files/${file}`, async () => {
            try { return await m.backup.open(m.row); } catch (error) {
              missing.push({ tenant: m.tenant, id: m.row.id }); log(job, 'warn', 'media.missing', { entry: file });
              return require('node:stream').Readable.from([]);
            }
          }, { compress: false, guard: false });
        }
        archive.addStream('media/index.json', async () => require('node:stream').Readable.from([Buffer.from(JSON.stringify({ tenants: Object.fromEntries(Object.entries(mediaIndex).map(([id, files]) => [id, files.map(f => ({ ...f, missing: missing.some(x => x.tenant === id && x.id === f.id) || undefined }))])) }))]));
      }
      // Progress while the archive is being written: bytes through the writer / total expected.
      const expected = Math.max(1, appBytes + mediaBytes);
      const ticker = setInterval(() => {
        const written = archive.entries.reduce((sum, e) => sum + (e.path.startsWith('app/') || e.path.startsWith('media/') ? e.size : 0), 0) + 0;
        if (o.parts.app) steps.fraction('app', Math.min(0.99, archive.entries.filter(e => e.path.startsWith('app/')).length / Math.max(1, app.length)));
        if (o.media) steps.fraction('media', Math.min(0.99, written / expected));
      }, 300);
      let result;
      steps.start('package');
      try {
        result = await archive.finish(entries => ({
          format: FORMAT, version: FORMAT_VERSION, createdAt: now(), createdBy: 'dwira', appVersion, kind: o.kind || undefined,
          scope: scope.kind, tenantId: tenant ? scope.tenantId : null, type: o.type, storePart: o.storeParts || undefined,
          includes: { app: o.parts.app, db: o.parts.db, media: o.media },
          db: o.parts.db ? { provider, engine, dataMode: o.data, schemaOnly: o.data === 'empty', schemaVersion: SCHEMA_VERSION, tables: Object.fromEntries(Object.entries(dumped.tables).map(([t, v]) => [t, { rows: v.rows }])) } : null,
          app: o.parts.app ? { files: app.length, bytes: appBytes } : null,
          media: o.media ? { source: tenant ? bundles.get(scope.tenantId).media.mode : 'mixed', stores: Object.fromEntries(Object.entries(mediaIndex).map(([id, files]) => [id, { files: files.length, bytes: files.reduce((s, f) => s + (f.size || 0), 0) }])), missing: missing.length } : null,
          secretsExcluded: true,
          files: entries.map(e => ({ path: e.path, size: e.size, sha256: e.sha256 })),
        }));
      } finally { clearInterval(ticker); }
      if (o.parts.app) steps.done('app');
      if (o.media) steps.done('media', { files: media.length - missing.length });
      if (missing.length) job.warnings.push({ code: 'MEDIA_MISSING', count: missing.length });
      await fs.promises.rename(partFile, finalFile);
      steps.done('package');
      const summary = { file: finalFile, name, size: result.size, sha256: result.sha256, entries: result.entries.length, includes: { app: o.parts.app, db: o.parts.db, media: o.media }, rows: dumped ? Object.fromEntries(Object.entries(dumped.tables).map(([t, v]) => [t, v.rows])) : null, mediaFiles: o.media ? media.length - missing.length : 0 };
      job.partial = summary;
      if (o.destination === 'vault') {
        steps.start('vault');
        try {
          const item = await vault.store({
            file: finalFile, work, preview,
            progress: (stage, f) => steps.fraction('vault', stage === 'upload' ? f * 0.6 : 0.6 + f * 0.4),
            meta: {
              kind: o.kind, version: appVersion, createdBy: o.createdBy, plainSize: result.size, sha256: result.sha256, includes: summary.includes, rows: summary.rows, tables: summary.rows ? Object.keys(summary.rows).length : null,
              mediaFiles: summary.mediaFiles, appFiles: o.parts.app ? app.length : 0, schemaVersion: SCHEMA_VERSION, formatVersion: FORMAT_VERSION,
            },
          });
          steps.done('vault');
          log(job, 'info', 'vault.ok', { name: item.name, size: item.size, encrypted: item.encrypted, where: vault.kind });
          summary.destination = { destination: 'vault', id: item.id, name: item.name, kind: item.kind, version: item.version };
          summary.vaultId = item.id;
          // The copy in the vault is the backup now: the working copy on the server's disk is removed (BACKUP_KEEP_LOCAL=1 keeps it).
          if (env.BACKUP_KEEP_LOCAL !== '1') { await fs.promises.rm(finalFile, { force: true }).catch(() => {}); summary.file = null; }
        } catch (error) {
          job.errors.push(errorOf(error)); log(job, 'error', error.status ? error.message : 'VAULT_FAILED', errorOf(error));
          return { ...summary, failed: true };
        }
      } else if (o.destination !== 'local') {
        steps.start('upload');
        let sent = 0;
        try {
          const where = await destinations.upload(o.destination, { file: finalFile, name, size: result.size, auth: o.auth, onBytes: n => { sent += n; steps.fraction('upload', sent / Math.max(1, result.size)); } });
          steps.done('upload');
          log(job, 'info', 'upload.ok', { destination: o.destination });
          summary.destination = where;
        } catch (error) {
          job.errors.push(errorOf(error)); log(job, 'error', error.message, errorOf(error));
          return { ...summary, failed: true };
        }
      }
      log(job, 'info', 'backup.done', { size: result.size });
      return summary;
    } catch (error) {
      archive.abort(error); await fs.promises.rm(partFile, { force: true }).catch(() => {});
      throw error;
    }
  }

  // ---------------------------------------------------------------- restore: upload + validate
  // Chunked upload (resumable, and every request stays far below proxy body limits and the server's request timeout):
  //   createUpload({ size }) -> id;  appendChunk(id, offset, req) once per chunk, in order;  completeUpload(id) checks the size and starts the validation.
  const CHUNK_MAX = 4 * 1024 * 1024;
  async function createUpload(scope, input = {}) {
    if (!supported()) throw fail(501, 'BACKUP_UNSUPPORTED_HOST');
    await ensureDirs();
    const size = Number(input.size);
    if (!Number.isInteger(size) || size <= 0) throw fail(400, 'UPLOAD_EMPTY');
    if (size > maxUpload) throw fail(413, 'UPLOAD_TOO_LARGE');
    for (const [id, u] of uploads) if (u.scopeKey === scopeKey(scope) && !u.plan && !u.busy) { uploads.delete(id); await fs.promises.rm(u.file, { force: true }); } // one pending upload per scope
    if (uploads.size >= 20) throw fail(429, 'TOO_MANY_UPLOADS');
    const id = crypto.randomBytes(12).toString('hex');
    const file = path.join(UPLOADS, `${id}.zip`);
    await fs.promises.writeFile(file, '', { mode: 0o600 });
    uploads.set(id, { id, scopeKey: scopeKey(scope), file, expected: size, size: 0, createdAt: now(), plan: null });
    return { uploadId: id, chunkSize: CHUNK_MAX, size };
  }
  async function appendChunk(scope, id, offset, req) {
    const upload = uploadOf(scope, id);
    if (upload.plan || upload.busy) throw fail(409, 'UPLOAD_CLOSED');
    if (!Number.isInteger(offset) || offset !== upload.size) throw fail(409, 'UPLOAD_OFFSET', { expected: upload.size });
    const room = Math.min(CHUNK_MAX, upload.expected - upload.size);
    let got = 0;
    const counter = new (require('node:stream').Transform)({ transform(chunk, _e, cb) { got += chunk.length; if (got > room) return cb(fail(413, 'UPLOAD_TOO_LARGE')); cb(null, chunk); } });
    upload.busy = true;
    try { await pipeline(req, counter, fs.createWriteStream(upload.file, { flags: 'r+', start: offset })); }
    catch (error) { await fs.promises.truncate(upload.file, offset).catch(() => {}); throw error.status ? error : fail(400, 'UPLOAD_INTERRUPTED'); }
    finally { upload.busy = false; }
    if (!got) throw fail(400, 'UPLOAD_EMPTY');
    upload.size += got;
    return { received: upload.size, expected: upload.expected };
  }
  async function completeUpload(scope, id) {
    const upload = uploadOf(scope, id);
    if (upload.plan || upload.busy) throw fail(409, 'UPLOAD_CLOSED');
    if (upload.size !== upload.expected) throw fail(409, 'UPLOAD_INCOMPLETE', { expected: upload.expected });
    const readHead = async () => {
      const handle = await fs.promises.open(upload.file, 'r');
      const buf = Buffer.alloc(5);
      try { await handle.read(buf, 0, 5, 0); } finally { await handle.close(); }
      return buf;
    };
    let head = await readHead();
    if (head.toString('latin1') === 'DWBK1') { // a copy of an encrypted archive of the vault
      if (!vault) { uploads.delete(id); await fs.promises.rm(upload.file, { force: true }); throw fail(400, 'BACKUP_KEY_MISSING'); }
      upload.busy = true;
      try { await vault.decryptFile(upload.file); const st = await fs.promises.stat(upload.file); upload.size = upload.expected = st.size; head = await readHead(); }
      catch (error) { uploads.delete(id); await fs.promises.rm(upload.file, { force: true }); throw error; }
      finally { upload.busy = false; }
    }
    if (head.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') { uploads.delete(id); await fs.promises.rm(upload.file, { force: true }); throw fail(400, 'NOT_A_ZIP'); }
    upload.busy = true;
    try { return { uploadId: id, job: await startValidate(scope, upload) }; } finally { upload.busy = false; }
  }
  const uploadOf = (scope, id) => { const u = uploads.get(String(id)); if (!u || u.scopeKey !== scopeKey(scope)) throw fail(404, 'UPLOAD_NOT_FOUND'); return u; };

  async function startValidate(scope, upload) {
    await guardStart(scope);
    const job = newJob('validate', scope, { upload: upload.id, size: upload.size }, [['inspect', 5], ['verify', 95]]);
    return start(job, scope, steps => runValidate(job, scope, upload, steps));
  }
  /** Reads the whole archive once: structure, manifest, every hash. Never writes anything. */
  async function runValidate(job, scope, upload, steps) {
    steps.start('inspect');
    const archive = await openArchive(upload.file);
    try {
      let manifest;
      try { manifest = JSON.parse((await readEntry(archive, 'manifest.json')).toString('utf8')); } catch (error) { throw error.status ? error : fail(400, 'ARCHIVE_INVALID_MANIFEST'); }
      if (manifest?.format !== FORMAT || !Array.isArray(manifest.files)) throw fail(400, 'ARCHIVE_NOT_A_BACKUP');
      if (!Number.isInteger(manifest.version) || manifest.version > FORMAT_VERSION) throw fail(400, 'ARCHIVE_NEWER_VERSION');
      if (manifest.scope !== scope.kind) throw fail(400, 'SCOPE_MISMATCH', { detected: manifest.scope });
      const listed = new Map();
      for (const f of manifest.files) {
        if (!f || typeof f.path !== 'string' || !Number.isInteger(f.size) || !/^[a-f0-9]{64}$/.test(f.sha256 || '') || listed.has(f.path)) throw fail(400, 'ARCHIVE_INVALID_MANIFEST');
        listed.set(f.path, f);
      }
      for (const entry of archive.entries.keys()) {
        if (entry === 'manifest.json') continue;
        if (!listed.has(entry)) throw fail(400, 'ARCHIVE_UNLISTED_ENTRY', { entry: entry.slice(0, 80) });
        if (/(^|\/)\.env(?!\.(?:example|sample)$)(\.|$)|\.(pem|key|p12|p8|pfx|jks)$/i.test(entry)) throw fail(400, 'ARCHIVE_SECRET_FILE', { entry: entry.slice(0, 80) });
        if (!/^(db\/(schema\.sql|tables\.json|data\/[a-z_][a-z0-9_]*\.ndjson)|app\/.+|media\/(index\.json|[a-z0-9][a-z0-9_-]{0,62}\/files\/[a-f0-9]{32}\.[a-z0-9]+))$/.test(entry)) throw fail(400, 'ARCHIVE_UNKNOWN_ENTRY', { entry: entry.slice(0, 80) });
        if (entry.startsWith('app/') && !appFiles.allowed(entry.slice(4))) throw fail(400, 'ARCHIVE_UNSAFE_PATH', { entry: entry.slice(0, 80) });
      }
      for (const [p, f] of listed) {
        const entry = archive.entries.get(p);
        if (!entry) throw fail(400, 'ARCHIVE_MISSING_ENTRY', { entry: p.slice(0, 80) });
        if (entry.uncompressedSize !== f.size) throw fail(400, 'ARCHIVE_CORRUPT', { entry: p.slice(0, 80) });
      }
      steps.done('inspect');
      steps.start('verify');
      const total = Math.max(1, manifest.files.reduce((s, f) => s + f.size, 0));
      let read = 0;
      for (const f of manifest.files) {
        if (job.cancel) throw fail(409, 'CANCELLED');
        const hashed = await hashEntry(archive, f.path);
        if (hashed.sha256 !== f.sha256 || hashed.size !== f.size) throw fail(400, 'ARCHIVE_CORRUPT', { entry: f.path.slice(0, 80) });
        read += f.size; steps.fraction('verify', read / total);
      }
      steps.done('verify');
      let tablesMeta = null;
      if (manifest.includes?.db) {
        const raw = JSON.parse((await readEntry(archive, 'db/tables.json')).toString('utf8'));
        const reduced = tolerate(raw, scope.kind === 'tenant');
        tablesMeta = reduced.meta;
        if (reduced.skipped.length) job.warnings.push({ code: 'TABLES_SKIPPED', count: reduced.skipped.length, tables: reduced.skipped.slice(0, 6).join(', ') });
      }
      const plan = await buildPlan(scope, manifest, tablesMeta);
      for (const w of plan.warnings) job.warnings.push(w);
      upload.plan = { manifest, tablesMeta, stat: (await fs.promises.stat(upload.file)).mtimeMs, size: upload.size };
      upload.view = plan;
      log(job, 'info', 'validate.ok');
      return { plan };
    } finally { archive.close(); }
  }
  async function buildPlan(scope, manifest, tablesMeta) {
    const tenant = scope.kind === 'tenant';
    const warnings = [];
    const detected = detectProvider(env, await handleOf(scope).info());
    const mediaTargets = {};
    const sample = bundles.get(scope.kind === 'tenant' ? scope.tenantId : 'default').media.backup;
    mediaTargets.r2 = !!sample.adapters.r2;
    mediaTargets.app = !!(sample.adapters.fs && (await sample.adapters.fs.writable()));
    const current = {};
    if (manifest.includes?.db && tablesMeta) {
      const handle = handleOf(scope);
      for (const table of Object.keys(tablesMeta.tables)) {
        try { current[table] = Number((await handle.query(`SELECT COUNT(*) AS n FROM ${table}${tenant && require('../db').TENANT_TABLES.includes(table) ? ' WHERE tenant_id=:tenant' : ''}`))[0].n); } catch { /* skip */ }
      }
      if (manifest.db?.schemaVersion && manifest.db.schemaVersion !== SCHEMA_VERSION) warnings.push({ code: 'SCHEMA_VERSION_DIFFERS', from: manifest.db.schemaVersion, to: SCHEMA_VERSION });
      if (manifest.db?.provider && detected && manifest.db.provider !== detected && !(manifest.db.provider === 'pglite' || detected === 'pglite')) warnings.push({ code: 'PROVIDER_DIFFERS', from: manifest.db.provider, to: detected });
      warnings.push({ code: 'PASSWORDS_NOT_IN_BACKUP' });
      if (manifest.db?.schemaOnly) warnings.push({ code: 'WILL_EMPTY_DATABASE' });
    }
    if (manifest.includes?.app && !scope.canApp) warnings.push({ code: 'APP_NOT_RESTORED_HERE' });
    if (manifest.includes?.app && scope.canApp) warnings.push({ code: 'APP_RESTART_REQUIRED' });
    if (manifest.appVersion && appVersion && manifest.appVersion !== appVersion) warnings.push({ code: 'VERSION_DIFFERS', from: manifest.appVersion, to: appVersion });
    if (tenant && manifest.tenantId && manifest.tenantId !== scope.tenantId) warnings.push({ code: 'OTHER_STORE', tenant: manifest.tenantId });
    if (manifest.media?.missing) warnings.push({ code: 'MEDIA_MISSING', count: manifest.media.missing });
    return {
      manifest: { createdAt: manifest.createdAt, appVersion: manifest.appVersion, kind: manifest.kind, scope: manifest.scope, tenantId: manifest.tenantId, type: manifest.type, storePart: manifest.storePart, includes: manifest.includes, db: manifest.db ? { provider: manifest.db.provider, dataMode: manifest.db.dataMode, schemaOnly: manifest.db.schemaOnly, tables: manifest.db.tables } : null, app: manifest.app, media: manifest.media },
      restorable: { app: !!manifest.includes?.app && !!scope.canApp, db: !!manifest.includes?.db, media: !!manifest.includes?.media },
      mediaTargets, defaultMediaTarget: sample.adapters.r2 && bundles.get(scope.kind === 'tenant' ? scope.tenantId : 'default').media.mode === 'r2' ? 'r2' : 'app',
      willReplace: current, currentProvider: detected, warnings,
    };
  }

  /** Restore from the history: download the archive from the vault (decrypting it), then the same validation as an uploaded file. */
  async function prepareFromVault(scope, id) {
    if (!vaultOn(scope)) throw fail(400, 'VAULT_NOT_CONFIGURED');
    const item = await vault.find(id);
    await guardStart(scope);
    for (const [uid, u] of uploads) if (u.scopeKey === scopeKey(scope) && !u.plan && !u.busy) { uploads.delete(uid); await fs.promises.rm(u.file, { force: true }); }
    const uid = crypto.randomBytes(12).toString('hex');
    const file = path.join(UPLOADS, `${uid}.zip`);
    const upload = { id: uid, scopeKey: scopeKey(scope), file, expected: item.plainSize || item.size || 0, size: 0, createdAt: now(), plan: null, busy: true, vaultId: item.id };
    uploads.set(uid, upload);
    const job = newJob('validate', scope, { upload: uid, vault: item.id, version: item.version, kind: item.kind, name: item.name }, [['download', 40], ['inspect', 5], ['verify', 55]]);
    return start(job, scope, async steps => {
      try {
        steps.start('download');
        let got = 0;
        const total = Math.max(1, item.plainSize || item.size || 1);
        const stored = await vault.fetchTo(item, file, { onBytes: n => { got += n; steps.fraction('download', Math.min(1, got / total)); } });
        upload.size = upload.expected = stored.size;
        log(job, 'info', 'download.ok', { size: stored.size, encrypted: item.encrypted });
        steps.done('download');
        const planned = await runValidate(job, scope, upload, steps);
        return { ...planned, uploadId: uid };
      } catch (error) { uploads.delete(uid); await fs.promises.rm(file, { force: true }).catch(() => {}); throw error; }
      finally { upload.busy = false; }
    });
  }

  // ---------------------------------------------------------------- restore
  async function startRestore(scope, input = {}) {
    const upload = uploadOf(scope, input.uploadId);
    if (!upload.plan) throw fail(409, 'NOT_VALIDATED');
    const plan = upload.view;
    const stat = await fs.promises.stat(upload.file).catch(() => null);
    if (!stat || stat.mtimeMs !== upload.plan.stat || stat.size !== upload.plan.size) throw fail(409, 'UPLOAD_CHANGED');
    const wanted = input.parts && typeof input.parts === 'object' ? input.parts : plan.restorable;
    const parts = { app: !!wanted.app && plan.restorable.app, db: !!wanted.db && plan.restorable.db, media: !!wanted.media && plan.restorable.media };
    if (wanted.app && !plan.restorable.app) throw fail(400, scope.canApp ? 'NOTHING_TO_RESTORE' : 'APP_SCOPE_FORBIDDEN');
    if (!parts.app && !parts.db && !parts.media) throw fail(400, 'NOTHING_TO_RESTORE');
    const mediaTarget = parts.media ? (input.mediaTarget === 'r2' || input.mediaTarget === 'app' ? input.mediaTarget : plan.defaultMediaTarget) : null;
    if (parts.media && !plan.mediaTargets[mediaTarget]) throw fail(400, mediaTarget === 'r2' ? 'R2_NOT_CONFIGURED' : 'APP_STORAGE_NOT_WRITABLE');
    if (input.confirm !== true) throw fail(409, 'CONFIRMATION_REQUIRED', {});
    const safety = input.safetyBackup !== false && parts.db;
    await guardStart(scope);
    const job = newJob('restore', scope, { parts, mediaTarget, safetyBackup: safety, upload: upload.id }, [['verify', 2], ...(safety ? [['safety', 10]] : []), ...(parts.db ? [['database', 25]] : []), ...(parts.media ? [['media', 45]] : []), ...(parts.app ? [['app', 15]] : []), ['finish', 3]]);
    return start(job, scope, steps => runRestore(job, scope, upload, { parts, mediaTarget, safety }, steps));
  }

  async function runRestore(job, scope, upload, { parts, mediaTarget, safety }, steps) {
    const cancelled = () => job.cancel;
    const tenant = scope.kind === 'tenant';
    const { manifest, tablesMeta } = upload.plan;
    steps.start('verify');
    const archive = await openArchive(upload.file);
    const result = { restored: { app: 0, db: null, media: 0 }, failed: false, restartRequired: false };
    try {
      steps.done('verify');
      if (safety) {
        steps.start('safety');
        const toVault = vaultOn(scope);
        const pre = newJob('backup', scope, { type: 'db', data: 'content', media: false, destination: toVault ? 'vault' : 'local', provider: 'auto', safetyFor: job.id }, [['prepare', 1], ['database', 1], ['package', 1], ...(toVault ? [['vault', 1]] : [])]);
        pre.status = 'running'; pre.startedAt = now();
        const preSteps = stepper(pre);
        try { pre.result = await runBackup(pre, scope, { ...backupOptions({ ...scope, canApp: false }, { type: tenant ? 'both' : 'db', data: 'content', destination: toVault ? 'vault' : 'local', createdBy: 'pre-restore' }) }, { provider: null, engine: await handleOf(scope).info() }, preSteps); if (pre.result?.failed) throw fail(500, 'SAFETY_BACKUP_FAILED'); pre.status = 'done'; pre.progress = 100; }
        catch (error) { pre.status = 'error'; pre.errors.push(errorOf(error)); pre.finishedAt = now(); save(pre); throw fail(500, 'SAFETY_BACKUP_FAILED'); }
        pre.finishedAt = now(); save(pre);
        result.safetyBackup = { id: pre.id, name: pre.result.name, size: pre.result.size, ...(pre.result.vaultId ? { vaultId: pre.result.vaultId } : {}) };
        log(job, 'info', 'safety.ok', { name: pre.result.name });
        steps.done('safety');
      }
      if (parts.db) {
        steps.start('database');
        let n = 0; const tables = Object.keys(tablesMeta.tables).length;
        const imported = await importDatabase({
          db: handleOf(scope), tenant, meta: tablesMeta, cancelled, protect: tenant && scope.adminId ? { admin_accounts: scope.adminId } : {},
          open: async table => (archive.entries.has(`db/data/${table}.ndjson`) ? openEntry(archive, `db/data/${table}.ndjson`) : null),
          onTable: ({ table, rows }) => { n++; log(job, 'info', 'db.table', { table, rows }); steps.fraction('database', n / Math.max(1, tables)); },
        });
        result.restored.db = Object.fromEntries(Object.entries(imported.tables).map(([t, v]) => [t, v.rows]));
        steps.done('database');
      }
      if (parts.media) {
        steps.start('media');
        const index = JSON.parse((await readEntry(archive, 'media/index.json')).toString('utf8')).tenants || {};
        const wantedIds = tenant ? [scope.tenantId in index ? scope.tenantId : Object.keys(index)[0]].filter(Boolean) : Object.keys(index);
        const all = wantedIds.flatMap(id => (index[id] || []).map(file => ({ source: id, target: tenant ? scope.tenantId : id, file })));
        let done = 0;
        for (const item of all) {
          if (cancelled()) { job.warnings.push({ code: 'CANCELLED_DURING_MEDIA' }); break; }
          const { file } = item;
          done++;
          steps.fraction('media', done / Math.max(1, all.length));
          if (file.missing) continue;
          try {
            if (!/^[a-f0-9]{32}$/.test(file.id) || typeof file.mime !== 'string') throw fail(400, 'ARCHIVE_INVALID_MANIFEST');
            const stream = await openEntry(archive, `media/${item.source}/files/${file.name}`);
            await bundles.get(item.target).media.backup.restore({ id: file.id, mime: file.mime }, stream, file.size, mediaTarget);
            result.restored.media++;
          } catch (error) {
            job.errors.push({ ...errorOf(error), entry: file.name }); log(job, 'error', error.status ? error.message : 'INTERNAL', { entry: file.name });
          }
        }
        steps.done('media', { files: result.restored.media });
        if (job.errors.length) result.failed = true;
      }
      if (parts.app) {
        steps.start('app');
        const stage = path.join(WORK, job.id, 'stage');
        const rels = [];
        let i = 0; const files = [...archive.entries.keys()].filter(e => e.startsWith('app/'));
        for (const entry of files) {
          if (cancelled()) throw fail(409, 'CANCELLED');
          const rel = entry.slice(4);
          await appFiles.writeInto(stage, rel, await openEntry(archive, entry));
          rels.push(rel); i++; steps.fraction('app', (i / Math.max(1, files.length)) * 0.8);
        }
        result.restored.app = await appFiles.applyStage(stage, appRoot, rels, path.join(WORK, job.id, 'undo'));
        result.restartRequired = result.restored.app > 0;
        steps.done('app', { files: result.restored.app });
      }
      steps.start('finish');
      if (parts.db) await onRestored?.(scope);
      steps.done('finish');
      log(job, 'info', 'restore.done');
      return result;
    } finally { archive.close(); }
  }

  // ---------------------------------------------------------------- misc API
  async function capabilities(scope) {
    const engine = await handleOf(scope).info();
    const detected = detectProvider(env, engine);
    const sample = bundles.get(scope.kind === 'tenant' ? scope.tenantId : 'default').media;
    let count = 0, bytes = 0;
    for (const id of await idsOf(scope)) for (const row of await bundles.get(id).media.backup.list()) { count++; bytes += row.size || 0; }
    return {
      available: supported(), reason: supported() ? '' : 'BACKUP_UNSUPPORTED_HOST', scope: scope.kind,
      types: ['app', 'db', 'both', ...(scope.kind === 'platform' ? ['media'] : [])], canApp: !!scope.canApp, storeSplit: scope.kind === 'tenant' && !scope.canApp,
      provider: { detected, engine, options: ['neon', 'supabase'], locked: detected === 'neon' || detected === 'supabase' },
      media: { mode: sample.mode, count, bytes, targets: { r2: !!sample.backup.adapters.r2, app: !!(sample.backup.adapters.fs && await sample.backup.adapters.fs.writable()) } },
      destinations: { local: true, ...Object.fromEntries(Object.entries(destinations.configured()).map(([k, v]) => [k, { serverConfigured: v }])) },
      limits: { maxUploadBytes: maxUpload, keepHours: keepMs / 3600000 },
      vault: vaultOn(scope) ? { kind: vault.kind, encrypted: vault.encrypted } : null, version: appVersion,
      running: running(scope)?.id || null,
    };
  }
  const jobOf = (scope, id) => { const job = jobs.get(String(id)); if (!job || job.scopeKey !== scopeKey(scope)) throw fail(404, 'JOB_NOT_FOUND'); return job; };
  const sanitizeCaps = c => ({ ...c, provider: { detected: c.provider.detected, engine: c.provider.engine, options: c.provider.options, locked: !!c.provider.locked } });
  const platform = () => ({ kind: 'platform', canApp: true, actor: 'schedule' });
  const schedule = vault ? createSchedule({
    db, now, vault, supported,
    startBackup: input => startBackup(platform(), input),
    jobStatus: id => jobs.get(id) && { status: jobs.get(id).status, errors: jobs.get(id).errors, result: jobs.get(id).result },
    running: () => running(platform()),
    prune: opts => vault.prune(opts),
  }) : null;
  const need = scope => { if (!vaultOn(scope)) throw fail(400, 'VAULT_NOT_CONFIGURED'); };
  const api = {
    vault: {
      available: vaultOn,
      async info(scope) { need(scope); return { kind: vault.kind, encrypted: vault.encrypted, version: appVersion, items: (await vault.items({ fresh: true })).map(vault.publicItem), schedule: await schedule.status() }; },
      async prepare(scope, id) { return { job: await prepareFromVault(scope, id) }; },
      async remove(scope, id) { need(scope); const item = await vault.find(id); await vault.remove(item); return { ok: true, name: item.name }; },
      async preview(scope, id) { need(scope); return vault.previewOf(await vault.find(id)); },
      async open(scope, id) { need(scope); const item = await vault.find(id); return { name: `${item.name}.zip`, stream: await vault.openPlain(item) }; },
      /**
       * The code of a backup laid out like a Git repository: the files of `app/` at the root of the zip (no `app/` folder, no `dist/`, which
       * .gitignore leaves out anyway). Unzip it, `git init`, push: it installs and builds like the original project.
       */
      async openRepo(scope, id) {
        need(scope);
        const item = await vault.find(id);
        if (!item.includes?.app) throw fail(400, 'NO_CODE_IN_BACKUP');
        await ensureDirs();
        const temp = path.join(WORK, `repo-${crypto.randomBytes(6).toString('hex')}.zip`);
        await vault.fetchTo(item, temp);
        let archive;
        const cleanup = () => { try { archive?.close(); } catch { /* already closed */ } fs.promises.rm(temp, { force: true }).catch(() => {}); };
        try {
          archive = await openArchive(temp);
          const names = [...archive.entries.keys()].filter(e => e.startsWith('app/') && !e.startsWith('app/dist/') && appFiles.allowed(e.slice(4)));
          if (!names.length) throw fail(400, 'NO_CODE_IN_BACKUP');
          // A backup from before the source was included holds only the built app: pushing that to GitHub gives a repository that cannot build.
          if (!names.some(e => e.startsWith('app/src/'))) throw fail(400, 'BACKUP_HAS_NO_SOURCE');
          const zip = new yazl.ZipFile();
          for (const entry of names) {
            zip.addReadStreamLazy(entry.slice(4), { mtime: archive.entries.get(entry).getLastModDate(), mode: 0o100644, compress: true }, cb => { openEntry(archive, entry).then(stream => cb(null, stream), cb); });
          }
          zip.end();
          zip.outputStream.on('close', cleanup);
          return { name: `${item.name}-repo.zip`, stream: zip.outputStream };
        } catch (error) { cleanup(); throw error; }
      },
      async settings(scope, input) { need(scope); return input === undefined ? schedule.getSettings() : schedule.setSettings(input); },
      async prune(scope, body) { need(scope); const keep = (await schedule.getSettings()).retentionDays; return vault.prune({ keepDays: Number(body?.keepDays) || keep, dryRun: body?.dryRun === true }); },
      /** The browser's screenshot of the app, kept for 10 minutes until the backup that uses it starts. */
      async addPreview(scope, data) {
        need(scope);
        const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
        if (!m) throw fail(400, 'INVALID_PREVIEW');
        const buffer = Buffer.from(m[2], 'base64');
        if (buffer.length > 3 * 1024 * 1024 || !imageType(buffer)) throw fail(400, 'INVALID_PREVIEW');
        for (const [pid, p] of previews) if (p.at < now() - 600000) previews.delete(pid);
        if (previews.size >= 10) throw fail(429, 'TOO_MANY_UPLOADS');
        const pid = crypto.randomBytes(10).toString('hex');
        previews.set(pid, { buffer, type: imageType(buffer), at: now(), scopeKey: scopeKey(scope) });
        return { previewId: pid };
      },
    },
    /**
     * A FULL backup (database + code + files) into the vault, started by the free-tier monitor when a provider is close to its limit.
     * `avoidR2`: the R2 bucket is the one that is nearly full, prefer another destination. Resolves when the job has finished:
     * { status: 'done' | 'error' | 'cancelled', error?, name?, destination }. Throws BACKUP_BUSY / VAULT_NOT_CONFIGURED /
     * BACKUP_UNSUPPORTED_HOST when it cannot even start (the caller tries again later).
     */
    async runAutomatic({ avoidR2 = false } = {}) {
      if (!vault) throw fail(400, 'VAULT_NOT_CONFIGURED');
      // R2 is the stressed provider and the vault lives in it: use Google Drive / Dropbox when the server has them (their own tokens), else the vault.
      let destination = 'vault';
      if (avoidR2 && vault.kind === 'r2') { const c = destinations.configured(); destination = c.gdrive ? 'gdrive' : c.dropbox ? 'dropbox' : 'vault'; }
      const started = await startBackup({ ...platform(), actor: 'limits' }, { kind: 'all', destination, createdBy: 'limit', data: 'content' });
      for (;;) {
        const job = jobs.get(started.id);
        if (job && !['queued', 'running'].includes(job.status)) return { status: job.status, error: job.errors?.[0]?.code, name: job.result?.destination?.name, destination };
        await new Promise(resolve => setTimeout(resolve, env.NODE_ENV === 'test' ? 20 : 1000));
      }
    },
    /** Called by the server for every API request and every few minutes. */
    noteActivity: () => schedule?.noteActivity(),
    tick: () => (schedule ? schedule.tick() : Promise.resolve({ skipped: 'no vault' })),
    schedule,
    capabilities: async scope => { await ensureLoaded(); return sanitizeCaps(await capabilities(scope)); },
    startBackup, createUpload, appendChunk, completeUpload, startRestore,
    list: async scope => { await ensureLoaded(); return [...jobs.values()].filter(j => j.scopeKey === scopeKey(scope) && j.kind !== 'validate').sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map(view); },
    get: (scope, id) => view(jobOf(scope, id)),
    cancel(scope, id) { const job = jobOf(scope, id); if (job.status === 'running' || job.status === 'queued') { job.cancel = true; log(job, 'warn', 'cancel.requested'); } return view(job); },
    /** { file, name, size } of a finished backup, for the streaming download route. */
    file(scope, id) {
      const job = jobOf(scope, id);
      if (job.kind !== 'backup' || !job.result?.file || job.status === 'running' || !fs.existsSync(job.result.file)) throw fail(404, 'FILE_NOT_FOUND');
      return { file: job.result.file, name: job.result.name, size: job.result.size, sha256: job.result.sha256 };
    },
    discardUpload(scope, id) { const u = uploadOf(scope, id); uploads.delete(u.id); return fs.promises.rm(u.file, { force: true }); },
    /** Startup + periodic housekeeping: old archives and uploads go, interrupted jobs are reported as such. */
    async sweep() {
      if (!fs.existsSync(dir)) return;
      await ensureDirs();
      const cutoff = now() - keepMs;
      for (const folder of [UPLOADS, WORK]) for (const name of await fs.promises.readdir(folder).catch(() => [])) {
        const full = path.join(folder, name); const st = await fs.promises.stat(full).catch(() => null);
        const inUse = [...uploads.values()].some(u => u.file === full) || [...jobs.values()].some(j => j.id === name && j.status === 'running');
        if (st && st.mtimeMs < now() - 3600000 && !inUse) await fs.promises.rm(full, { recursive: true, force: true });
      }
      for (const [id, u] of uploads) if (u.createdAt < now() - 3600000) { uploads.delete(id); await fs.promises.rm(u.file, { force: true }); }
      const byScope = new Map();
      for (const job of [...jobs.values()].filter(j => j.kind === 'backup' && j.result?.file).sort((a, b) => b.createdAt - a.createdAt)) {
        const n = (byScope.get(job.scopeKey) || 0) + 1; byScope.set(job.scopeKey, n);
        if (job.status !== 'running' && (job.createdAt < cutoff || n > keepFiles)) { await fs.promises.rm(job.result.file, { force: true }); job.result.file = null; }
      }
      for (const name of await fs.promises.readdir(FILES).catch(() => [])) {
        const full = path.join(FILES, name); const st = await fs.promises.stat(full).catch(() => null);
        if (st && st.mtimeMs < cutoff && ![...jobs.values()].some(j => j.result?.file === full)) await fs.promises.rm(full, { force: true });
      }
    },
    /** Loads the finished jobs saved on disk (so the list survives a restart); anything that was running is marked interrupted. */
    async load() {
      await ensureDirs();
      for (const name of await fs.promises.readdir(JOBS).catch(() => [])) {
        try {
          const job = JSON.parse(await fs.promises.readFile(path.join(JOBS, name), 'utf8'));
          if (job.createdAt < now() - keepMs) { await fs.promises.rm(path.join(JOBS, name), { force: true }); continue; }
          jobs.set(job.id, job);
        } catch { /* ignore */ }
      }
    },
    _dir: dir,
  };
  return api;
}
module.exports = { createBackupService, FORMAT, FORMAT_VERSION };
