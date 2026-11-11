#!/usr/bin/env node
/**
 * Moves every media file of the app to Cloudflare R2.
 *
 *   node scripts/migrate-media-to-r2.js [--dry-run] [--external] [--videos] [--tenant=<id> | --all]
 *
 * Multi-tenant: one run migrates ONE tenant (default: the `default` tenant, i.e. the original app). `--tenant=<id>` picks another,
 * `--all` goes through every tenant in turn. Files of a non-default tenant are stored under its own R2 prefix (t/<id>/media/).
 *
 * Steps (each one idempotent: running the script again only does what is left):
 *   1. `media` table rows stored in the database (legacy base64 `data` or `body` bytes) are uploaded to R2 under the SAME
 *      /api/media/<hash>.<ext> name, then marked storage='r2'. The database copy is NOT deleted (never).
 *   2. Inline `data:` URLs left in content, documents, requests and user spaces (history, chats) are stored in R2 and
 *      replaced by their /api/media URL.
 *   3. --external: external https image URLs (Unsplash, CDNs, AI providers) in those rows are downloaded once into R2
 *      (https only, public hosts only, 10 s timeout, 10 MB, image/* only) and replaced by their /api/media URL. A URL
 *      that cannot be downloaded is kept and reported. --videos also copies external video URLs (size cap MEDIA_MAX_VIDEO_MB).
 *   --dry-run: reads everything and prints what would change; writes nothing (neither R2 nor the database).
 *
 * Requires DATABASE_URL (or PGLITE_DIR for a local database) and the five R2_* variables. Secrets are never printed.
 */
const path = require('node:path');
const fs = require('node:fs');
const { createDb } = require('../server/db');
const { scopeDb } = require('../server/scope');
const { createSync } = require('../server/sync');
const { createMedia, createR2Storage, r2Status, R2_VARS } = require('../server/media');

/** Loads server/.env if present (KEY=VALUE lines) without overriding variables already set. Values are never printed. */
function loadEnvFile(env, file = path.join(__dirname, '..', 'server', '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && env[match[1]] === undefined && match[2] !== '') env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const TABLES = [
  { name: 'content items', select: 'SELECT coll,id,data FROM content_items WHERE tenant_id=:tenant', column: 'data', update: 'UPDATE content_items SET data=$1 WHERE tenant_id=:tenant AND coll=$2 AND id=$3', keys: row => [row.coll, row.id], label: row => `${row.coll}/${row.id}`, sync: () => ['content'] },
  { name: 'content documents', select: 'SELECT name,data FROM content_docs WHERE tenant_id=:tenant', column: 'data', update: 'UPDATE content_docs SET data=$1 WHERE tenant_id=:tenant AND name=$2', keys: row => [row.name], label: row => `doc/${row.name}`, sync: () => ['content'] },
  { name: 'requests', select: 'SELECT id,user_id,data FROM requests WHERE tenant_id=:tenant', column: 'data', update: 'UPDATE requests SET data=$1 WHERE tenant_id=:tenant AND id=$2', keys: row => [row.id], label: row => `request/${row.id}`, sync: row => ['requests', `c:${row.user_id}`] },
  { name: 'user spaces', select: 'SELECT id,client_id,kind,value FROM space WHERE tenant_id=:tenant', column: 'value', update: 'UPDATE space SET value=$1 WHERE tenant_id=:tenant AND id=$2', keys: row => [row.id], label: row => `${row.kind}/${row.id}`, sync: row => [`c:${row.client_id}`] },
];

async function migrate({ env = process.env, db: rawDb, tenant = 'default', storage, download, dryRun = false, external = false, videos = false, log = console.log } = {}) {
  const ownDb = !rawDb;
  rawDb ||= createDb(env);
  const db = scopeDb(rawDb, tenant); // every statement below is bound to this one tenant
  storage ||= createR2Storage(env);
  if (!storage) throw new Error(`R2 is not configured (${r2Status(env)}). Set ${R2_VARS.join(', ')}.`);
  const media = createMedia(db, { env, storage, download, dryRun });
  const sync = createSync(db);
  const report = { dryRun, rowsMoved: 0, rowsFailed: 0, fieldsUpdated: 0, rowsUpdated: 0, externalFailed: [], bumped: new Set() };
  try {
    // 1. Legacy media rows -> R2 (same names, so every existing /api/media URL keeps working).
    const rows = await db.query("SELECT id,mime,data,body FROM media WHERE tenant_id=:tenant AND storage='db'");
    log(`[media] ${rows.length} database media row(s) to copy to R2${dryRun ? ' (dry run)' : ''}`);
    for (const row of rows) {
      try { if (await media.moveRowToR2(row)) report.rowsMoved++; }
      catch (error) { report.rowsFailed++; log(`[media] could not copy ${row.id}: ${error.name || error.code || 'error'}`); }
    }
    // 2 + 3. Inline data URLs (and, with --external, external URLs) inside JSON rows.
    for (const table of TABLES) {
      let updated = 0;
      for (const row of await db.query(table.select)) {
        const raw = row[table.column];
        const hasInline = raw.includes(';base64,');
        const hasExternal = external && /"https?:\/\//.test(raw);
        if (!hasInline && !hasExternal) continue;
        let value;
        try { value = JSON.parse(raw); } catch { continue; }
        try {
          const before = report.externalFailed.length;
          const out = await media.externalize(value, {
            remote: external ? 'report' : 'skip', videos,
            onError: (url, error) => report.externalFailed.push({ row: table.label(row), url: url.slice(0, 200), reason: error.code || 'FAILED' }),
          });
          if (!out.changed) continue;
          const changedFields = countChanges(value, out.value);
          report.fieldsUpdated += changedFields;
          updated++;
          log(`[media] ${dryRun ? 'would update' : 'updated'} ${table.label(row)} (${changedFields} field(s)${report.externalFailed.length > before ? `, ${report.externalFailed.length - before} URL(s) kept` : ''})`);
          if (!dryRun) {
            await db.query(table.update, [JSON.stringify(out.value), ...table.keys(row)]);
            for (const key of table.sync(row)) report.bumped.add(key);
          }
        } catch (error) {
          log(`[media] skipped ${table.label(row)}: ${error.message}`);
        }
      }
      report.rowsUpdated += updated;
      log(`[media] ${table.name}: ${updated} row(s) ${dryRun ? 'would change' : 'changed'}`);
    }
    if (!dryRun && report.bumped.size) await sync.bump(...report.bumped);
    report.stored = media.stats.stored;
    report.downloaded = media.stats.downloaded;
    log(`[media] done${dryRun ? ' (dry run: nothing was written)' : ''}: ${report.rowsMoved} media row(s) copied to R2, ${report.rowsUpdated} JSON row(s) / ${report.fieldsUpdated} field(s) updated, ${report.downloaded} external file(s) downloaded, ${report.externalFailed.length} URL(s) kept, ${report.rowsFailed} copy error(s).`);
    for (const failure of report.externalFailed) log(`[media]   kept ${failure.url} in ${failure.row}: ${failure.reason}`);
    return report;
  } finally { if (ownDb) await rawDb.close(); }
}

function countChanges(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b ? 0 : 1;
  if (a && b && typeof a === 'object' && typeof b === 'object') return Object.keys(b).reduce((sum, key) => sum + countChanges(a[key], b[key]), 0);
  return 0;
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const tenantArg = [...args].find(arg => arg.startsWith('--tenant='));
  const unknown = [...args].filter(arg => !['--dry-run', '--external', '--videos', '--all', '--help', '-h'].includes(arg) && arg !== tenantArg);
  if (args.has('--help') || args.has('-h') || unknown.length) {
    console.log('Usage: node scripts/migrate-media-to-r2.js [--dry-run] [--external] [--videos] [--tenant=<id> | --all]');
    process.exit(unknown.length ? 1 : 0);
  }
  loadEnvFile(process.env);
  const options = { dryRun: args.has('--dry-run'), external: args.has('--external') || args.has('--videos'), videos: args.has('--videos') };
  (async () => {
    const db = createDb(process.env);
    try {
      const tenants = args.has('--all') ? (await db.query('SELECT id FROM saas_tenants ORDER BY created_at')).map(row => row.id) : [tenantArg ? tenantArg.slice('--tenant='.length) : 'default'];
      let failed = 0;
      for (const tenant of tenants) { console.log(`[media] tenant ${tenant}`); failed += (await migrate({ ...options, db: { ...db, close: async () => {} }, tenant })).rowsFailed; }
      return failed;
    } finally { await db.close(); }
  })()
    .then(failed => { process.exit(failed ? 2 : 0); })
    .catch(error => { console.error(`[media] migration failed: ${error.message}`); process.exit(1); });
}

module.exports = { migrate, loadEnvFile };
