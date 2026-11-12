/** The console's own identity in the browser: tab icon, title, install manifest. Web only; used on /super-admin pages and nowhere else. */
import { Platform } from 'react-native';

export const CONSOLE_TITLE = 'Platform console';
export const CONSOLE_ICONS = { svg: '/icons/superadmin-icon.svg', p32: '/icons/superadmin-32.png', p180: '/icons/superadmin-180.png', p192: '/icons/superadmin-192.png', manifest: '/icons/superadmin.webmanifest' };

function setLink(rel: string, href: string, extra: Record<string, string> = {}) {
  document.querySelectorAll(`link[rel="${rel}"]`).forEach(n => n.remove());
  const link = document.createElement('link');
  link.rel = rel; link.href = href;
  for (const k of Object.keys(extra)) link.setAttribute(k, extra[k]);
  document.head.appendChild(link);
}

/** Replaces the platform / store favicon, title and manifest with the console's. Safe to call repeatedly. */
export function applyConsoleBrand() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  document.title = CONSOLE_TITLE;
  document.querySelectorAll('link[rel~="icon"]').forEach(n => n.remove());
  setLink('icon', CONSOLE_ICONS.p32, { type: 'image/png', sizes: '32x32' });
  setLink('apple-touch-icon', CONSOLE_ICONS.p180);
  setLink('manifest', CONSOLE_ICONS.manifest);
  let theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!theme) { theme = document.createElement('meta'); theme.name = 'theme-color'; document.head.appendChild(theme); }
  theme.content = '#4F46E5';
  const app = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
  if (app) app.content = 'Console';
}
