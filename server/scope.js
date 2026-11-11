/**
 * Tenant-bound database handle: THE isolation mechanism of the multi-tenant backend (docs/MULTI_TENANT_PLAN.md, section 1).
 *
 * Tenant code never receives the raw database. It receives `scopeDb(db, tenantId)`, whose `query` / `tx` take SQL written with the
 * token `:tenant` (`WHERE tenant_id=:tenant AND id=$1`). The wrapper binds the tenant id as one extra, LAST parameter and rewrites every
 * `:tenant` to its `$n`, so the id never comes from request data and can never be string-concatenated into SQL.
 *
 * Fail closed: every reference to a tenant-owned table (`FROM | JOIN | INTO | UPDATE <table>`) must be matched by at least one
 * `:tenant` token in the same statement, otherwise the call throws TENANT_SCOPE_MISSING before reaching the database. A forgotten filter
 * therefore fails the first test that runs the statement instead of leaking another tenant's rows in production.
 * (This is a floor, not a proof: scripts/check-tenant-isolation.js also runs every route against two tenants and compares.)
 */
const { TENANT_TABLES } = require('./db');

const TABLE_REF = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:ONLY\\s+)?(?:${TENANT_TABLES.join('|')})\\b`, 'gi');
const TOKEN = /:tenant\b/g;
const TENANT_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** `{ sql, params }` with the tenant bound, or a thrown TENANT_SCOPE_MISSING. Exported for the tests. */
function bind(tenantId, sql, params = []) {
  const text = String(sql);
  const refs = (text.match(TABLE_REF) || []).length;
  const tokens = (text.match(TOKEN) || []).length;
  if (tokens < refs) {
    // The statement text (never parameters or rows) is logged so the developer who wrote it can find it; it holds no customer data.
    console.error('TENANT_SCOPE_MISSING', text.replace(/\s+/g, ' ').slice(0, 160));
    throw Object.assign(new Error('TENANT_SCOPE_MISSING'), { code: 'TENANT_SCOPE_MISSING', status: 500 });
  }
  if (!tokens) return { sql: text, params };
  return { sql: text.replace(TOKEN, `$${params.length + 1}`), params: [...params, tenantId] };
}

function scopeDb(db, tenantId) {
  if (typeof tenantId !== 'string' || !TENANT_ID.test(tenantId)) throw Object.assign(new Error('INVALID_TENANT'), { status: 500 });
  // async: a refused statement is a rejected promise like any other database error (callers use `.catch()` and `await`), never a synchronous throw.
  const run = async (query, sql, params) => { const bound = bind(tenantId, sql, params); return query(bound.sql, bound.params); };
  return {
    tenantId,
    configured: () => db.configured(),
    info: () => db.info(),
    query: (sql, params) => run(db.query, sql, params),
    tx: work => db.tx(q => work((sql, params) => run(q, sql, params))),
  };
}

module.exports = { scopeDb, bind, TENANT_ID };
