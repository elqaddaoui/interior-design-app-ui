/**
 * Tenant slugs that can never be used (docs/MULTI_TENANT_PLAN.md section 2). Shared by the server (resolver, tenant creation) and the
 * client; plain CommonJS so both Node and Metro load it. scripts/check-tenant-routing.js fails when a top-level route is added to
 * src/app without being listed here, so a new screen can never be shadowed by (or shadow) a tenant.
 */
// First path segment of every screen in src/app (route groups such as `(tabs)` do not appear in URLs).
const ROUTES = ['admin', 'assistant', 'chat', 'explore', 'history', 'lead', 'lead-success', 'login', 'pro', 'render', 'result', 'settings', 'tool'];
// Files and endpoints the host serves itself.
const INFRA = ['api', '_expo', '_sitemap', 'assets', 'icons', 'index', 'index.html', 'push-sw.js', 'manifest.webmanifest', 'favicon.ico', 'health', 'static', 'public', '.well-known', 'robots.txt', 'sitemap.xml'];
// The platform itself and words that would mislead visitors.
const PLATFORM = ['default', 'super-admin', 'superadmin', 'super', 'root', 'system', 'platform', 'saas', 'tenant', 'tenants', 'www', 'app', 'apps', 'demo', 'demos', 'docs', 'help', 'status', 'support', 'blog', 'mail', 'email', 'ftp', 'cdn', 'dashboard', 'billing', 'account', 'accounts', 'signup', 'register', 'logout', 'auth', 'oauth', 'about', 'contact', 'pricing', 'terms', 'privacy', 'test', 'null', 'undefined'];

const RESERVED = new Set([...ROUTES, ...INFRA, ...PLATFORM]);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** The slug is not usable: 'invalid' (format) | 'reserved' | null (fine). */
function slugProblem(slug) {
  if (typeof slug !== 'string' || !SLUG.test(slug) || slug.includes('--')) return 'invalid';
  return RESERVED.has(slug) ? 'reserved' : null;
}
/** A path segment that has the SHAPE of a slug (it may still be unknown or reserved). */
const looksLikeSlug = segment => typeof segment === 'string' && SLUG.test(segment);

module.exports = { ROUTES, INFRA, PLATFORM, RESERVED, SLUG, slugProblem, looksLikeSlug, isReserved: value => RESERVED.has(String(value).toLowerCase()) };
