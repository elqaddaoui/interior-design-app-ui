/**
 * Pure helpers for "which tenant is this page?" (docs/MULTI_TENANT_PLAN.md section 2, client side). No React Native, no `window`:
 * plain CommonJS so the HTML shell build (scripts/postexport.js), the Babel plugin and the Node tests all use the same rules as the app.
 * `base` is '' (default tenant / custom domain: the app lives at the root) or '/slug'.
 */
const { RESERVED, SLUG } = require('./reservedSlugs');

/** '/slug' when the first path segment is a tenant slug, else ''. The server stays the authority; this only has to agree with it. */
function baseFromPath(pathname) {
  const first = String(pathname || '').split('/')[1] || '';
  return SLUG.test(first) && !RESERVED.has(first) ? `/${first}` : '';
}
/** '/admin' -> '/acme/admin' (and '/' -> '/acme'). */
const withBase = (base, path) => (base ? (path === '/' || path === '' ? base : base + path) : path);
/** '/acme/admin' -> '/admin', '/acme' -> '/'; paths outside the base are returned unchanged. */
function stripBase(base, path) {
  if (!base) return path;
  if (path === base) return '/';
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}
/** localStorage / AsyncStorage prefix: the default tenant keeps the legacy `dwira:v1:` keys, every other tenant has its own namespace. */
const storagePrefix = base => (base ? `dwira:v1:t:${base.slice(1)}:` : 'dwira:v1:');
/** Keys of OTHER tenants share the default prefix: they must never be listed or cleared as the default tenant's own. */
const isForeignKey = (base, key) => !base && key.startsWith('dwira:v1:t:');
/** Stored media URLs are always the canonical `/api/media/...`; the page shows (and may send back) `/slug/api/media/...`. */
const mediaUrl = (base, value) => (base && typeof value === 'string' && value.startsWith('/api/media/') ? base + value : value);
const canonicalMediaUrl = (base, value) => (base && typeof value === 'string' && value.startsWith(`${base}/api/media/`) ? value.slice(base.length) : value);
/** Deep copy of `value` with every string passed through `fn` (only copies what changed). */
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) { let out = value; value.forEach((item, i) => { const next = mapStrings(item, fn); if (next !== item) { if (out === value) out = value.slice(); out[i] = next; } }); return out; }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    let out = value;
    for (const key of Object.keys(value)) { const next = mapStrings(value[key], fn); if (next !== value[key]) { if (out === value) out = { ...value }; out[key] = next; } }
    return out;
  }
  return value;
}
/** The script the HTML shell runs first: sets window.__DWIRA_BASE__ ('' or 'slug') and the storage prefix before any other code. */
function shellScript() {
  // __DWIRA_BASE__: slug or ''. __DWIRA_ROUTE: the app's own path (address bar minus the slug). __DWIRA_PFX: storage prefix.
  // A tenant under a slug gets ITS web-app manifest (name, start_url, scope) from its own API: written before the static manifest link, and the first one wins.
  return `(function(){var R=${JSON.stringify([...RESERVED])},p=location.pathname,s=p.split('/')[1]||'',b=${SLUG.toString()}.test(s)&&R.indexOf(s)<0?s:'';` +
    `window.__DWIRA_BASE__=b;window.__DWIRA_ROUTE=b?(p.slice(b.length+1)||'/'):p;window.__DWIRA_PFX='dwira:v1:'+(b?'t:'+b+':':'');` +
    `if(b)document.write('<link rel="manifest" href="/'+b+'/api/manifest.webmanifest">')})();`;
}

module.exports = { baseFromPath, withBase, stripBase, storagePrefix, isForeignKey, mediaUrl, canonicalMediaUrl, mapStrings, shellScript };
