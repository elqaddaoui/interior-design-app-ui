/*
 * Service worker of the Super Admin console (registered as /sa-sw.js with scope /super-admin/).
 * Android Chrome only shows notifications that a service worker creates, and only a Web Push message wakes a worker while the browser
 * is in the background or closed. Every notice of the console arrives here from the server (server/notice-push.js).
 * Push-only: it never intercepts fetch and never caches anything. The tenant apps have their own worker (/push-sw.js), never mixed with this one.
 */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

const ICON = '/icons/superadmin-192.png';
// A notification may only open a page of the console.
const PAGE = /^\/super-admin(?:\/[a-z0-9-]+)?$/;
function safeUrl(value) {
  const fallback = new URL('/super-admin', self.location.origin).href;
  try {
    const url = new URL(value, self.location.origin);
    return url.origin === self.location.origin && PAGE.test(url.pathname) ? self.location.origin + url.pathname + url.search : fallback;
  } catch { return fallback; }
}
const isConsole = client => { try { const url = new URL(client.url); return url.origin === self.location.origin && (url.pathname === '/super-admin' || url.pathname.startsWith('/super-admin/')); } catch { return false; } };

self.addEventListener('push', event => {
  let payload = null;
  try { payload = event.data ? event.data.json() : null; } catch { payload = null; }
  const title = payload && typeof payload.title === 'string' && payload.title ? payload.title.slice(0, 120) : 'Super admin';
  const body = payload && typeof payload.body === 'string' ? payload.body.slice(0, 300) : '';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Tell open console pages to refresh their bell right away.
    for (const client of windows) if (isConsole(client)) client.postMessage({ type: 'notices' });
    // A console window the owner is looking at already shows the toast: no second pop-up (except for the test button).
    const looking = windows.some(client => isConsole(client) && client.visibilityState === 'visible' && client.focused);
    if (looking && !(payload && payload.test)) return;
    await self.registration.showNotification(title, {
      body, icon: ICON, badge: ICON, vibrate: [200, 100, 200],
      tag: payload && typeof payload.id === 'string' ? payload.id.slice(0, 60) : 'console',
      lang: payload && payload.lang ? String(payload.lang).slice(0, 8) : 'en', dir: payload && payload.dir === 'rtl' ? 'rtl' : 'ltr',
      data: { url: safeUrl(payload && payload.url) },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(isConsole);
    if (existing) {
      try { await existing.focus(); existing.postMessage({ type: 'open', url: new URL(target).pathname + new URL(target).search }); return; } catch { /* fall through and open a window */ }
    }
    await self.clients.openWindow(target);
  })());
});
