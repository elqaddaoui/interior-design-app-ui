/**
 * Tenant resolution (docs/MULTI_TENANT_PLAN.md section 2). Called first thing in `handle`, before any other work.
 *
 * Order, first match wins:
 *   1. a VERIFIED custom domain (Host header)                       -> that tenant, path unchanged
 *   2. platform host, first path segment is a tenant slug           -> that tenant, `/slug` stripped from the path
 *   3. platform host + native app header `X-Dwira-Native: 1` + `X-Dwira-Tenant: <slug>`
 *   4. everything else on the platform host                         -> the default tenant (today's behaviour)
 * Unknown slug -> 404 TENANT_NOT_FOUND. Suspended tenant -> 403 TENANT_SUSPENDED. Both carry `page: true` for non-API paths so
 * the caller can answer with a plain page instead of JSON.
 *
 * Only registry rows are read here (saas_tenants / saas_domains, on the raw database); the tenant id used afterwards always comes
 * from a row, never from request data.
 */
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { slugProblem, looksLikeSlug, isReserved } = require('../src/lib/reservedSlugs');

const fail = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;
const MAX_DOMAINS = 3;

function createTenants({ db, env = process.env, resolveTxt = name => dns.resolveTxt(name) } = {}) {
  const ttl = Math.max(0, Math.min(300000, Number(env.TENANT_RESOLVE_MS ?? 15000) || 0));
  const platformHosts = new Set(String(env.PLATFORM_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const cache = new Map();
  const hostOf = req => String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

  async function cached(key, load) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.until > now) return hit.value;
    const value = await load();
    if (cache.size > 5000) cache.clear();
    if (ttl) cache.set(key, { value, until: now + ttl });
    return value;
  }
  const publicTenant = row => row && { id: row.id, slug: row.slug, name: row.name, kind: row.kind, status: row.status };
  const bySlug = slug => cached(`s:${slug}`, async () => publicTenant((await db.query('SELECT id,slug,name,kind,status FROM saas_tenants WHERE slug=$1', [slug]))[0]));
  const byDomain = host => cached(`h:${host}`, async () => publicTenant((await db.query(
    'SELECT t.id,t.slug,t.name,t.kind,t.status FROM saas_domains d JOIN saas_tenants t ON t.id=d.tenant_id WHERE d.domain=$1 AND d.verified_at IS NOT NULL', [host]))[0]));

  // An API call is `/api/...` or `/{slug}/api/...`: only the other requests are pages (answered with plain text, not JSON).
  const isPage = pathname => !/^(?:\/[^/]+)?\/api(?:\/|$)/.test(pathname);
  function finish(tenant, via, base, pathname) {
    if (tenant.status === 'suspended') throw fail(403, 'TENANT_SUSPENDED', { code: 'TENANT_SUSPENDED', page: isPage(base + pathname) });
    return { tenant, via, base, pathname, platform: false };
  }
  const missing = pathname => fail(404, 'TENANT_NOT_FOUND', { code: 'TENANT_NOT_FOUND', page: isPage(pathname) });

  /**
   * -> { tenant, via: 'domain'|'slug'|'native'|'default', base ('' or '/slug'), pathname (the path to route, prefix removed),
   *      platform (true only on the platform host without a slug: the one place the super admin lives) }.
   */
  async function resolve(req, pathname) {
    const host = hostOf(req);
    if (host) {
      let domain;
      try { domain = await byDomain(host); } catch (error) { if (pathname !== '/api/health') throw error; }
      if (domain) return finish(domain, 'domain', '', pathname);
    }
    if (platformHosts.size && host && !platformHosts.has(host)) throw missing(pathname);
    const match = /^\/([^/]+)(\/.*)?$/.exec(pathname);
    const first = match ? match[1] : '';
    if (match && looksLikeSlug(first) && !isReserved(first)) {
      const tenant = await bySlug(first);
      if (!tenant) throw missing(pathname);
      return finish(tenant, 'slug', `/${first}`, match[2] || '/');
    }
    const header = req.headers['x-dwira-tenant'];
    if (req.headers['x-dwira-native'] === '1' && typeof header === 'string' && header) {
      const tenant = looksLikeSlug(header) && !isReserved(header) ? await bySlug(header) : null;
      if (!tenant) throw missing(pathname);
      return finish(tenant, 'native', '', pathname);
    }
    return { tenant: { id: 'default', slug: 'default', name: 'Default', kind: 'default', status: 'active' }, via: 'default', base: '', pathname, platform: true };
  }

  // ---- Custom domains (a tenant admin or the super admin attaches them; they only work once the DNS TXT record proves ownership) ----
  const txtName = domain => `_dwira-verify.${domain}`;
  const view = row => ({ domain: row.domain, verified: !!row.verified_at, verifiedAt: row.verified_at ? Number(row.verified_at) : null, txtName: txtName(row.domain), txtValue: row.token, createdAt: Number(row.created_at) });
  /** Normalised hostname, or throws 400 INVALID_DOMAIN / 409 DOMAIN_RESERVED. */
  function cleanDomain(raw) {
    const domain = String(raw ?? '').trim().toLowerCase().replace(/\.$/, '');
    if (!DOMAIN.test(domain)) throw fail(400, 'INVALID_DOMAIN');
    const local = /(?:^|\.)(?:localhost|local|internal|invalid|example|test|vercel\.app|hstgr\.io|hostingersite\.com)$/.test(domain);
    if (local || platformHosts.has(domain) || [...platformHosts].some(host => domain.endsWith(`.${host}`))) throw fail(409, 'DOMAIN_RESERVED');
    return domain;
  }
  const domains = {
    async list(tenantId) {
      return (await db.query('SELECT domain,token,verified_at,created_at FROM saas_domains WHERE tenant_id=$1 ORDER BY created_at', [tenantId])).map(view);
    },
    async add(tenantId, raw) {
      const domain = cleanDomain(raw);
      const existing = (await db.query('SELECT tenant_id,verified_at FROM saas_domains WHERE domain=$1', [domain]))[0];
      if (existing?.tenant_id === tenantId) return view((await db.query('SELECT domain,token,verified_at,created_at FROM saas_domains WHERE domain=$1', [domain]))[0]);
      // A verified domain belongs to its owner. An unverified claim proves nothing, so the real owner can take it over.
      if (existing?.verified_at) throw fail(409, 'DOMAIN_TAKEN');
      if ((await db.query('SELECT 1 FROM saas_domains WHERE tenant_id=$1 AND domain<>$2', [tenantId, domain])).length >= MAX_DOMAINS) throw fail(409, 'TOO_MANY_DOMAINS');
      const row = { domain, token: crypto.randomBytes(18).toString('hex'), created_at: Date.now(), verified_at: null };
      await db.query('DELETE FROM saas_domains WHERE domain=$1 AND verified_at IS NULL', [domain]);
      await db.query('INSERT INTO saas_domains(domain,tenant_id,token,verified_at,created_at) VALUES($1,$2,$3,NULL,$4)', [domain, tenantId, row.token, row.created_at]);
      cache.clear();
      return view(row);
    },
    /** Looks for the TXT record. `force` (super admin only) marks the domain verified without DNS. */
    async verify(tenantId, raw, { force = false } = {}) {
      const domain = cleanDomain(raw);
      const row = (await db.query('SELECT domain,token,verified_at,created_at FROM saas_domains WHERE domain=$1 AND tenant_id=$2', [domain, tenantId]))[0];
      if (!row) throw fail(404, 'NOT_FOUND');
      if (row.verified_at) return view(row);
      if (!force) {
        let records = [];
        try { records = (await resolveTxt(txtName(domain))).map(chunks => [].concat(chunks).join('')); } catch { /* NXDOMAIN / timeout: not verified yet */ }
        if (!records.some(value => value.trim() === row.token || value.trim() === `dwira-verify=${row.token}`)) throw fail(409, 'DOMAIN_NOT_VERIFIED');
      }
      const at = Date.now();
      // Only one tenant can hold a verified domain; the row is the proof, the primary key the lock.
      const done = await db.query('UPDATE saas_domains SET verified_at=$1 WHERE domain=$2 AND tenant_id=$3 AND verified_at IS NULL RETURNING domain', [at, domain, tenantId]);
      cache.clear();
      return view({ ...row, verified_at: done.length ? at : row.verified_at });
    },
    async remove(tenantId, raw) {
      const domain = String(raw ?? '').trim().toLowerCase();
      await db.query('DELETE FROM saas_domains WHERE domain=$1 AND tenant_id=$2', [domain, tenantId]);
      cache.clear();
    },
  };

  return { resolve, domains, invalidate: () => cache.clear(), platformHosts, slugProblem };
}

module.exports = { createTenants, DOMAIN };
