/**
 * Vercel serverless entry: every /api/* request (including nested paths such as
 * /api/user/login) is handled by the same code as the Node/Bun server.
 *
 * Routing: vercel.json rewrites `/api/(.*)` -> `/api?__path=$1`. A filesystem
 * catch-all (`api/[...path].js`) is not used because, outside Next.js, Vercel
 * only matched it for single-segment paths (nested routes returned NOT_FOUND).
 */
const { createBackend } = require('../server');
let backend;

/**
 * Restore the original URL whether Vercel exposes the original or the rewritten one: `/api/...` for the platform host and custom
 * domains, `/{slug}/api/...` for a tenant served under the platform host (vercel.json adds `__slug`). The tenant resolver
 * (server/tenants.js) then strips the slug; this function never decides which tenant a request belongs to.
 */
function originalUrl(raw) {
  const url = new URL(raw || '/api', 'http://localhost');
  const rewritten = url.searchParams.get('__path');
  const slug = url.searchParams.get('__slug');
  url.searchParams.delete('__path');
  url.searchParams.delete('__slug');
  if (rewritten !== null && (url.pathname === '/api' || url.pathname === '/api/' || url.pathname === '/api/index' || url.pathname === '/api/index.js')) {
    url.pathname = (slug && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) ? `/${slug}` : '') + '/api/' + rewritten.replace(/^\/+/, '');
  }
  return url.pathname + url.search;
}

module.exports = (req, res) => {
  req.url = originalUrl(req.url);
  return (backend ||= createBackend()).handle(req, res);
};
module.exports.originalUrl = originalUrl;
module.exports.config = { maxDuration: 30 };
