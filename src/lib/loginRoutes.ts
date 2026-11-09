/** The two sign-in pages have their own URLs: /admin/login (administrators) and /login (clients). */
export const ADMIN_LOGIN = '/admin/login';
export const USER_LOGIN = '/login';

/** A return path from a query string is only followed when it stays inside the app (no external or protocol-relative redirects). */
export function safeNext(raw: unknown, scope: 'admin' | 'user'): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return scope === 'admin' ? '/admin' : '/';
  let path = value.trim();
  try { path = decodeURIComponent(path); } catch { return scope === 'admin' ? '/admin' : '/'; }
  const ok = /^\/(?!\/)[^\s\\]*$/.test(path) && !/[\u0000-\u001f]/.test(path);
  const login = path === ADMIN_LOGIN || path.startsWith(`${ADMIN_LOGIN}?`) || path === USER_LOGIN || path.startsWith(`${USER_LOGIN}?`);
  const inScope = scope === 'admin' ? (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?')) : !(path === '/admin' || path.startsWith('/admin/'));
  return ok && !login && inScope ? path : scope === 'admin' ? '/admin' : '/';
}

/** `/admin/login?next=/admin/users` (the default destination is left out). */
export function loginHref(scope: 'admin' | 'user', next?: string): string {
  const base = scope === 'admin' ? ADMIN_LOGIN : USER_LOGIN;
  const to = safeNext(next, scope);
  return to === (scope === 'admin' ? '/admin' : '/') ? base : `${base}?next=${encodeURIComponent(to)}`;
}
export const isAdminLoginPath = (path: string) => path.replace(/\/+$/, '') === ADMIN_LOGIN;
