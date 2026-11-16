/**
 * Database export / import for backups, written in Node over the app's own database interface, so it works on every host and every
 * provider (Neon, Supabase, any Postgres, PGlite in development) without pg_dump being installed.
 *
 * Archive layout produced here:
 *   db/schema.sql           the full idempotent schema (what a fresh database needs)
 *   db/tables.json          { schemaVersion, schemaOnly, tables: { name: { columns, rows } } }
 *   db/data/<table>.ndjson  one JSON row per line (absent in a schema-only backup)
 *
 * Secrets never leave the database: sessions and push subscriptions are not exported, password hashes / provider keys are omitted
 * (db.js BACKUP_TABLES: omit), settings rows that hold keys are skipped, and the API key inside "models" content rows is blanked.
 * A restore never takes those values from a backup either: it keeps what the rows hold now.
 *
 * Scope: `tenant: true` works on ONE store (the handle must be the tenant-bound one, see server/scope.js); `tenant: false` works on
 * the raw database (platform backup: every store plus the platform tables).
 */
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { BACKUP_TABLES, TENANT_TABLES, SECRET_SETTINGS, SCHEMA, SCHEMA_MT, SCHEMA_VERSION } = require('../db');

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const PAGE = 1000;
const BATCH = 100;
const isTenantTable = table => TENANT_TABLES.includes(table);
/** Tables of one backup scope, in dependency order. The media table is handled with the files, never here. */
const specsFor = tenant => BACKUP_TABLES.filter(spec => !spec.media && !(tenant && spec.platform));
const ident = name => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw fail(400, 'INVALID_NAME'); return `"${name}"`; };
/** Table names are written bare (validated): the tenant-bound handle (server/scope.js) then still checks that every statement carries :tenant. */
const tref = name => { if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw fail(400, 'INVALID_NAME'); return name; };

/** Provider of the active database: DB_PROVIDER (explicit), else the host name, else generic Postgres; PGlite in development. */
function detectProvider(env, kind) {
  const forced = String(env.DB_PROVIDER || '').toLowerCase();
  if (forced === 'neon' || forced === 'supabase') return forced;
  if (kind === 'pglite') return 'pglite';
  const url = env.DATABASE_URL || env.POSTGRES_URL || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL_NON_POOLING || '';
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* not a URL */ }
  if (/(^|\.)neon\.tech$/.test(host)) return 'neon';
  if (/(^|\.)supabase\.(co|com)$/.test(host) || /pooler\.supabase\.com$/.test(host)) return 'supabase';
  return 'postgres';
}
/** `requested` = neon | supabase | auto. A generic / development database accepts either label; a real Neon database refuses "supabase". */
function checkProvider(requested, detected) {
  const want = String(requested || 'auto').toLowerCase();
  if (!['auto', 'neon', 'supabase'].includes(want)) throw fail(400, 'INVALID_PROVIDER');
  if (want === 'auto') return detected;
  if ((detected === 'neon' || detected === 'supabase') && want !== detected) throw fail(400, 'PROVIDER_MISMATCH', { detected });
  return want;
}

async function columnsOf(q, table) {
  return (await q("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position", [table])).map(row => row.column_name);
}
const jsonLine = row => JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)) + '\n';

/** Row as exported: the API key of a "models" content row is blanked. */
function sanitize(table, row) {
  if (table === 'content_items' && row.coll === 'models') {
    try { const data = JSON.parse(row.data); if (data && typeof data === 'object') { data.apiKey = ''; return { ...row, data: JSON.stringify(data) }; } } catch { /* not JSON: leave */ }
  }
  return row;
}

/**
 * Writes db/schema.sql content, db/tables.json content and one ndjson file per table into `dir` (a temp directory).
 * Returns { schemaSql, tables: { table: { columns, rows } }, files: [{ name, file }] }.
 */
async function exportDatabase({ db, tenant, schemaOnly, dir, onTable, cancelled, only }) {
  // `only` = a list of table names: a partial backup of a store (its design and settings, or its operational data).
  const specs = specsFor(tenant).filter(spec => !Array.isArray(only) || only.includes(spec.table));
  const tables = {};
  const files = [];
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  const work = async q => {
    for (const spec of specs) {
      if (cancelled?.()) throw fail(409, 'CANCELLED');
      const all = await columnsOf(q, spec.table);
      if (!all.length) continue; // table not in this database (older schema)
      const columns = all.filter(c => !(spec.omit || []).includes(c) && !(tenant && c === 'tenant_id' && isTenantTable(spec.table)));
      tables[spec.table] = { columns, rows: 0 };
      if (schemaOnly) { onTable?.({ table: spec.table, rows: 0 }); continue; }
      const file = path.join(dir, `${spec.table}.ndjson`);
      const out = await fs.promises.open(file, 'w', 0o600);
      try {
        const where = [];
        const params = [];
        if (tenant && isTenantTable(spec.table)) where.push('tenant_id=:tenant');
        if (spec.table === 'settings') { params.push(SECRET_SETTINGS); where.push(`key <> ALL($${params.length})`); }
        const order = (!tenant && isTenantTable(spec.table) ? ['tenant_id', ...spec.pk] : spec.pk).map(ident).join(',');
        const select = `SELECT ${columns.map(ident).join(',')} FROM ${tref(spec.table)}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${PAGE} OFFSET `;
        for (let offset = 0; ; offset += PAGE) {
          const rows = await q(select + offset, params);
          if (!rows.length) break;
          await out.write(rows.map(row => jsonLine(sanitize(spec.table, row))).join(''));
          tables[spec.table].rows += rows.length;
          if (rows.length < PAGE) break;
        }
      } finally { await out.close(); }
      files.push({ name: `db/data/${spec.table}.ndjson`, file });
      onTable?.({ table: spec.table, rows: tables[spec.table].rows });
    }
  };
  // One snapshot of the whole export (REPEATABLE READ): the tables are consistent with each other even while the store is in use.
  await db.tx(async q => { await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); await work(q); });
  const schemaSql = `-- Dwira database schema (version ${SCHEMA_VERSION}). Idempotent: safe to run on an empty or an existing database.\n${SCHEMA}\n${SCHEMA_MT}\n`;
  return { schemaSql, tables, files, schemaVersion: SCHEMA_VERSION };
}

async function* readRows(stream) {
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { throw fail(400, 'ARCHIVE_CORRUPT', { entry: 'db data' }); }
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw fail(400, 'ARCHIVE_CORRUPT', { entry: 'db data' });
    yield row;
  }
}

/** Validates the tables.json of an archive against the specs of this scope (unknown tables or columns are refused: they could be injected SQL names). */
function checkTables(meta, tenant) {
  if (!meta || typeof meta !== 'object' || typeof meta.tables !== 'object' || !meta.tables) throw fail(400, 'ARCHIVE_INVALID_DB');
  const allowed = new Map(specsFor(tenant).map(spec => [spec.table, spec]));
  for (const [table, info] of Object.entries(meta.tables)) {
    if (!allowed.has(table)) throw fail(400, 'ARCHIVE_UNKNOWN_TABLE', { table: table.slice(0, 40) });
    if (!Array.isArray(info?.columns) || info.columns.some(c => typeof c !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(c))) throw fail(400, 'ARCHIVE_INVALID_DB');
    if (!Number.isInteger(info.rows) || info.rows < 0) throw fail(400, 'ARCHIVE_INVALID_DB');
  }
  return allowed;
}

/**
 * Replaces the data of the tables listed in `meta` by the archive's rows, in ONE transaction (any error rolls everything back).
 * `open(table)` returns a readable stream of the table's ndjson, or null (schema-only archive).
 * `protect` = { admin_accounts: adminId } rows the restore must not touch (the administrator who is restoring keeps their account).
 * Resolves with { tables: { table: { rows, inserted } } }.
 */
async function importDatabase({ db, tenant, meta, open, protect = {}, onTable, cancelled }) {
  const allowed = checkTables(meta, tenant);
  const result = {};
  // `preserve` tables (the audit trail) are never replaced by a restore: an older backup must not erase what happened since.
  // Only the tables the archive lists are replaced: a partial backup (a store's design only, or its data only) leaves the others untouched.
  const order = specsFor(tenant).filter(spec => allowed.has(spec.table) && meta.tables[spec.table] && !spec.preserve);
  await db.tx(async q => {
    const current = {};
    const keepers = {};
    // 1. read what must survive, 2. empty the tables (children first)
    for (const spec of [...order].reverse()) {
      current[spec.table] = await columnsOf(q, spec.table);
      if (!current[spec.table].length) throw fail(400, 'SCHEMA_MISMATCH', { table: spec.table });
      const tenantFilter = tenant && isTenantTable(spec.table) ? 'tenant_id=:tenant' : '';
      const keyCols = !tenant && isTenantTable(spec.table) ? ['tenant_id', ...spec.pk] : spec.pk;
      const keepCols = (spec.keep || []).filter(c => current[spec.table].includes(c));
      const old = new Map();
      const wantsModels = spec.table === 'content_items';
      if (keepCols.length || wantsModels) {
        const cols = wantsModels ? ['coll', 'id', 'data'] : [...keyCols, ...keepCols];
        for (const row of await q(`SELECT ${[...new Set(cols)].map(ident).join(',')} FROM ${tref(spec.table)}${tenantFilter ? ' WHERE ' + tenantFilter : ''}`)) {
          if (wantsModels) { if (row.coll === 'models') { try { const key = JSON.parse(row.data)?.apiKey; if (key) old.set(row.id, key); } catch { /* ignore */ } } }
          else old.set(keyCols.map(c => row[c]).join('\u0000'), Object.fromEntries(keepCols.map(c => [c, row[c]])));
        }
      }
      keepers[spec.table] = { old, keepCols, keyCols };
      const where = [];
      const params = [];
      if (tenantFilter) where.push(tenantFilter);
      if (spec.table === 'settings') { params.push(SECRET_SETTINGS); where.push(`key <> ALL($${params.length})`); }
      if (spec.table === 'admin_accounts' && protect.admin_accounts) { params.push(protect.admin_accounts); where.push(`admin_id <> $${params.length}`); }
      await q(`DELETE FROM ${tref(spec.table)}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`, params);
    }
    // 3. insert the archive's rows (parents first)
    for (const spec of order) {
      if (cancelled?.()) throw fail(409, 'CANCELLED');
      const info = meta.tables[spec.table];
      const stream = info.rows > 0 ? await open(spec.table) : null;
      const out = { rows: 0, inserted: 0 };
      result[spec.table] = out;
      if (info.rows > 0 && !stream) throw fail(400, 'ARCHIVE_MISSING_ENTRY', { entry: `db/data/${spec.table}.ndjson` });
      if (stream) {
        const columns = info.columns.filter(c => current[spec.table].includes(c) && !(spec.keep || []).includes(c) && !(spec.omit || []).includes(c));
        const withTenant = tenant && isTenantTable(spec.table);
        const names = (withTenant ? ['tenant_id', ...columns.filter(c => c !== 'tenant_id')] : columns);
        const dataCols = withTenant ? names.slice(1) : names;
        if (!names.length) throw fail(400, 'ARCHIVE_INVALID_DB');
        let batch = [];
        const flush = async () => {
          if (!batch.length) return;
          const params = [];
          const tuples = batch.map(row => `(${names.map(c => {
            if (withTenant && c === 'tenant_id') return ':tenant';
            params.push(row[c] === undefined ? null : row[c]);
            return `$${params.length}`;
          }).join(',')})`);
          const done = await q(`INSERT INTO ${tref(spec.table)}(${names.map(ident).join(',')}) VALUES ${tuples.join(',')} ON CONFLICT DO NOTHING RETURNING 1 AS n`, params);
          out.inserted += done.length;
          batch = [];
        };
        for await (let row of readRows(stream)) {
          out.rows++;
          if (spec.table === 'content_items' && row.coll === 'models') {
            const key = keepers.content_items.old.get(row.id);
            if (key) { try { const data = JSON.parse(row.data); data.apiKey = data.apiKey || key; row = { ...row, data: JSON.stringify(data) }; } catch { /* keep as is */ } }
          }
          void dataCols;
          batch.push(row);
          if (batch.length >= BATCH) await flush();
        }
        await flush();
        if (out.rows !== info.rows) throw fail(400, 'ARCHIVE_CORRUPT', { entry: `db/data/${spec.table}.ndjson` });
      }
      // 4. give back the values that are never restored from a backup (password hashes, API keys, access rights)
      const { old, keepCols, keyCols } = keepers[spec.table];
      if (keepCols.length) {
        for (const [key, values] of old) {
          const parts = key.split('\u0000');
          const set = keepCols.map((c, i) => `${ident(c)}=$${i + 1}`).join(',');
          const conds = keyCols.map((c, i) => `${ident(c)}=$${keepCols.length + i + 1}`);
          if (tenant && isTenantTable(spec.table)) conds.push('tenant_id=:tenant');
          await q(`UPDATE ${tref(spec.table)} SET ${set} WHERE ${conds.join(' AND ')}`, [...keepCols.map(c => values[c]), ...parts]);
        }
      }
      onTable?.({ table: spec.table, rows: out.rows });
    }
  });
  return { tables: result };
}

/**
 * Every secret value the database holds (password hashes, provider keys, push private key, the API key of AI models). The archive writer
 * refuses to finish when one of them shows up in any text entry: a second line of defence behind the column / row exclusions above.
 */
async function collectSecrets({ db, tenant }) {
  const found = new Set();
  const add = value => { if (typeof value === 'string' && value.length >= 12) found.add(value); };
  const walk = (value, key = '') => {
    if (typeof value === 'string') { if (!/public|url|name|model|provider|label|id$/i.test(key)) add(value); }
    else if (Array.isArray(value)) value.forEach(item => walk(item, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  for (const spec of specsFor(tenant)) {
    for (const column of spec.secret || []) {
      try { for (const row of await db.query(`SELECT ${ident(column)} AS v FROM ${tref(spec.table)}${tenant && isTenantTable(spec.table) ? ' WHERE tenant_id=:tenant' : ''}`)) add(row.v); } catch { /* column not there */ }
    }
  }
  try {
    const rows = await db.query(`SELECT value FROM settings WHERE ${tenant ? 'tenant_id=:tenant AND ' : ''}key = ANY($1)`, [SECRET_SETTINGS]);
    for (const row of rows) { try { walk(JSON.parse(row.value)); } catch { add(row.value); } }
    for (const row of await db.query(`SELECT data FROM content_items WHERE ${tenant ? 'tenant_id=:tenant AND ' : ''}coll='models'`)) { try { add(JSON.parse(row.data)?.apiKey); } catch { /* skip */ } }
  } catch { /* tables not there */ }
  return [...found];
}

module.exports = { collectSecrets, exportDatabase, importDatabase, detectProvider, checkProvider, checkTables, specsFor, readRows };
