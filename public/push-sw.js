/* Push-only worker: deliberately does not intercept fetch or cache private app/admin data. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Admin requests/leads/chats, the client's own history ("design ready") and one of the client's chat threads are the only pages a notification may open.
const OPENABLE = ['/admin/requests', '/admin/users', '/admin/chats', '/history'];
const CHAT_THREAD = /^\/chat\/[A-Za-z0-9_-]{1,100}$/;
// Admin-authored campaign messages (server/notifications.js CAMPAIGN_URL): public app pages and one tool.
const PUBLIC_PAGE = /^\/(?:(?:explore|assistant|history|pro|settings|tool\/[A-Za-z0-9_-]{1,100}))?$/;
// Multi-tenant: every tenant served under the platform host (app.com/acme) registers THIS file as `/push-sw.js?b=acme` with scope `/acme/`,
// so its subscription, notifications and windows never mix with another tenant's. The default tenant and custom domains: no `b`, scope `/`.
const BASE = (() => { try { const slug = new URL(self.location.href).searchParams.get('b'); return /^[a-z0-9-]{3,40}$/.test(slug || '') ? '/' + slug : ''; } catch { return ''; } })();
// Kept equal to src/lib/reservedSlugs.js by scripts/check-tenant-client.js: a window whose first path segment is one of these (or none) is the default tenant's.
const RESERVED = ["admin", "assistant", "chat", "explore", "history", "lead", "lead-success", "login", "pro", "render", "result", "settings", "tool", "api", "_expo", "_sitemap", "assets", "icons", "index", "index.html", "push-sw.js", "manifest.webmanifest", "favicon.ico", "health", "static", "public", ".well-known", "robots.txt", "sitemap.xml", "default", "super-admin", "superadmin", "super", "root", "system", "platform", "saas", "tenant", "tenants", "www", "app", "apps", "demo", "demos", "docs", "help", "status", "support", "blog", "mail", "email", "ftp", "cdn", "dashboard", "billing", "account", "accounts", "signup", "register", "logout", "auth", "oauth", "about", "contact", "pricing", "terms", "privacy", "test", "null", "undefined"];
const ownsWindow = client => {
  try {
    const url = new URL(client.url);
    if (url.origin !== self.location.origin) return false;
    if (BASE) return url.pathname === BASE || url.pathname.startsWith(BASE + '/');
    const first = url.pathname.split('/')[1] || '';
    return first === '' || RESERVED.includes(first) || !/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(first);
  } catch { return false; }
};
// The server sends tenant-relative paths (/admin/requests); the page address of a tenant carries its prefix. Applied twice (when the
// notification is shown, and again on click), so an already prefixed URL of THIS tenant is accepted too and never prefixed again.
function safeUrl(value) {
  const fallback = new URL(BASE + '/admin/requests', self.location.origin).href;
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    const own = BASE && (url.pathname === BASE || url.pathname.startsWith(BASE + '/'));
    const pathname = own ? url.pathname.slice(BASE.length) || '/' : url.pathname;
    return OPENABLE.includes(pathname) || CHAT_THREAD.test(pathname) || PUBLIC_PAGE.test(pathname) ? self.location.origin + BASE + pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string') return;
  const phone = String(payload.phone || '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '').slice(0, 32);
  const actions = Array.isArray(payload.actions) ? payload.actions.filter(action => ['open', 'call'].includes(action.action) && typeof action.title === 'string').slice(0, 2).map(action => ({ action: action.action, title: action.title.slice(0, 40) })) : [];
  event.waitUntil(self.registration.showNotification(payload.title.slice(0, 120), {
    body: payload.body.slice(0, 220), icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', vibrate: [200, 100, 200], renotify: true, requireInteraction: false,
    tag: `demand-${String(payload.requestId).slice(0, 100)}`, lang: payload.lang || 'en', dir: payload.dir === 'rtl' ? 'rtl' : 'ltr',
    actions, data: { url: safeUrl(payload.url), phone },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil((async () => {
    const url = new URL(safeUrl(data.url));
    const phone = String(data.phone || '').replace(/[^\d+]/g, '').slice(0, 32);
    if (event.action === 'call' && /^\+?\d{6,20}$/.test(phone)) {
      try { const opened = await self.clients.openWindow(`tel:${phone}`); if (opened) return; } catch { /* Chrome may disallow tel: directly from a worker. */ }
      url.searchParams.set('call', phone);
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(ownsWindow);
    if (existing) {
      await existing.focus();
      // Let the app's unsaved-change guard handle navigation rather than destroying a draft.
      existing.postMessage({ type: 'dwira:notification-open', url: url.pathname.slice(BASE.length) + url.search });
      return;
    }
    return self.clients.openWindow(url.href);
  })());
});
