import { create } from 'zustand';
import type { Level, Levels } from '@/lib/superApi';

/** What the signed-in administrator may open, as computed by the server (plan ∩ role, see server/access.js). */
export interface AccessInfo {
  tenant: { id: string; slug: string; name: string };
  plan: { id: string; name: string } | null;
  role: { id: string; name: string } | null;
  account: { id: string; username: string; name: string } | null;
  legacy: boolean;
  levels: Levels;
  limits: Record<string, number | null>;
  platform: { maintenance: { enabled: boolean; message: string }; announcement: { enabled: boolean; text: string; level: 'info' | 'warning' | 'success' }; signupOpen: boolean; supportEmail: string };
}
interface AccessState {
  /** null = unknown (offline built-in login, or not loaded yet): the menu is not restricted client-side, the server still enforces everything. */
  info: AccessInfo | null;
  impersonated: boolean;
  set(info: AccessInfo | null, impersonated?: boolean): void;
  clear(): void;
}
export const useAccess = create<AccessState>((set) => ({
  info: null, impersonated: false,
  set: (info, impersonated) => set((s) => ({ info, impersonated: impersonated ?? s.impersonated })),
  clear: () => set({ info: null, impersonated: false }),
}));

/** Level of a page for the current administrator ('edit' while unknown: the server stays the authority). */
export const levelOf = (info: AccessInfo | null, key: string | null): Level => (!info || !key ? 'edit' : info.levels[key] ?? 'none');
export const useLevel = (key: string | null): Level => useAccess((s) => levelOf(s.info, key));

/** Which admin page does a path belong to (mirror of featureForPath in server/access.js). */
export function featureForPath(pathname: string): string | null {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/';
  if (clean === '/admin') return 'dashboard';
  const parts = clean.split('/');
  if (parts[1] !== 'admin') return null;
  const name = parts[2];
  if (name === 'prompt-cards') return 'promptCards';
  if (name === 'settings') return 'settingsMap';
  return name && NAMES.has(name) ? name : null;
}
const NAMES = new Set(['dashboard', 'requests', 'users', 'chats', 'notifications', 'credits', 'plans', 'tabs', 'tools', 'sections', 'categories', 'inspirations', 'styles', 'roomTypes', 'palettes', 'models', 'assistant', 'branding', 'theme', 'interface', 'layouts', 'studio', 'performance']);
