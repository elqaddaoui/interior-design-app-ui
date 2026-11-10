import { Platform } from 'react-native';

let current = '';
/** Kept in sync by the root layout so non-component code (stores, routers) knows where the user is. */
export const setCurrentPath = (path: string) => { current = path; };
export const currentPath = (): string => {
  const raw = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname : current;
  return raw.replace(/\/+$/, '') || '/';
};
export const inAdminArea = () => { const path = currentPath(); return path === '/admin' || path.startsWith('/admin/'); };
export const inSuperArea = () => { const path = currentPath(); return path === '/super' || path.startsWith('/super/'); };
/** The four bottom-bar roots: Back there means "leave the app", never "go to another page of the app". */
export const TAB_ROOTS = ['/', '/explore', '/history', '/assistant'];
/** Where Back leads when there is no history to return to (a link opened directly). */
export function parentRoute(path: string): string {
  if (path === '/super') return '/';
  if (path.startsWith('/super/')) return '/super';
  if (path === '/admin') return '/';
  if (path.startsWith('/admin/')) return '/admin';
  if (path.startsWith('/explore/')) return '/explore';
  if (path.startsWith('/chat/') || path.startsWith('/result/')) return '/history';
  return '/';
}
