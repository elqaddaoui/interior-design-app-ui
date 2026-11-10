import { Platform } from 'react-native';
import { api, BackendError } from '@/lib/backend';
import type { AdminAccess, Permissions } from '@/lib/access';

/** The Super Admin has its own session (cookie `dwira_super` on the web, `X-Super-Token` on native), never the administrators'. */
const KEY = 'dwira-super-session';
let cached: string | null | undefined;
async function nativeToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  const { getItemAsync } = await import('expo-secure-store');
  return (cached = await getItemAsync(KEY));
}
export async function rememberToken(token: string | null) {
  if (Platform.OS === 'web') return;
  cached = token;
  const store = await import('expo-secure-store');
  if (token) await store.setItemAsync(KEY, token); else await store.deleteItemAsync(KEY);
}
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function saApi<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = Platform.OS === 'web' ? null : await nativeToken();
  try {
    return await api<T>(`/superadmin${path}`, { ...options, headers: token ? { 'X-Super-Token': token } : {} });
  } catch (error) {
    if (error instanceof BackendError && error.status === 401 && path !== '/login') onUnauthorized?.();
    throw error;
  }
}

export type SaProfile = { username: string; name: string; defaultPassword: boolean; createdAt: number; lastLoginAt: number; passwordChangedAt: number };
export type SaRole = { id: string; name: string; description: string; permissions: Permissions; ui: string[]; system: boolean; admins: number; createdAt: number; updatedAt: number };
export type SaTenant = { id: string; name: string; plan: 'free' | 'starter' | 'pro' | 'enterprise'; status: 'active' | 'trial' | 'suspended'; contactEmail: string; notes: string; maxAdmins: number | null; admins: number; createdAt: number; updatedAt: number };
export type SaAdmin = {
  id: string; username: string; name: string; email: string; phone: string; title: string; avatar: string; credits: number | null;
  createdAt: number; lastLoginAt: number; passwordSet: boolean; disabled: boolean; builtIn: boolean; sessions: number;
  role: { id: string; name: string } | null; tenant: { id: string; name: string; status: string } | null;
  override: { permissions: Permissions | null; ui: string[] | null } | null; access: AdminAccess;
};
export type SaClient = { id: string; name: string; whatsapp: string; credits: number; blocked: boolean; createdAt: number; lastSeen: number; designs: number };
export type SaAudit = { id: string; at: number; actor: string; action: string; target: string; detail: Record<string, unknown>; ip: string };
export type SaSession = { id: string; current: boolean; createdAt: number; expiresAt: number; ua: string; ip: string };
export type SaPlatform = { maintenance: boolean; maintenanceMessage: string; allowClientSignup: boolean; allowRequests: boolean; defaultFreeCredits: number; notifyAdmins: boolean; notifyUsers: boolean };
export type SaStats = {
  generatedAt: number;
  totals: { clients: number; clientsBlocked: number; requests: number; designs: number; conversations: number; admins: number; adminsDisabled: number; roles: number; tenants: number; pushDevices: number; creditsOutstanding: number };
  windows: { active7: number; clientsNew7: number; clientsPrev7: number; requests7: number; requestsPrev7: number; designs7: number; designsPrev7: number };
  requestsByStatus: { pending: number; processing: number; delivered: number };
  series: { start: number; clients: number[]; requests: number[]; designs: number[] };
  topTools: { id: string; count: number }[];
  tenantsByStatus: Record<string, number>;
  rolesUsage: { id: string; name: string; count: number }[];
  queue: { pendingNotifications: number };
  security: { defaultSuperPassword: boolean; defaultAdminPassword: boolean };
  recent: SaAudit[];
};

/** Strong-password rules the server enforces for the Super Admin (kept in step with server/superadmin.js). */
export const passwordRules = (value: string, username = '') => ({
  length: value.length >= 10,
  letter: /[A-Za-z]/.test(value),
  digit: /\d/.test(value),
  notDefault: !!value && !value.toLowerCase().includes('superadmin') && value.toLowerCase() !== username.toLowerCase(),
});
export const passwordOk = (value: string, username = '') => Object.values(passwordRules(value, username)).every(Boolean);

/** A random strong password suggestion (shown once to the owner, who hands it to the administrator). */
export function suggestPassword(): string {
  const letters = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', digits = '23456789', symbols = '#-_@!';
  const all = letters + digits + symbols;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes); else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const chars = Array.from(bytes, b => all[b % all.length]);
  chars[0] = letters[bytes[0] % letters.length]; chars[1] = digits[bytes[1] % digits.length]; chars[2] = symbols[bytes[2] % symbols.length];
  return chars.join('');
}

export const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? 100 : 0);

/** Copies text to the clipboard (web only: there is no clipboard module in the native build). Returns false when unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try { if (Platform.OS === 'web' && globalThis.navigator?.clipboard) { await globalThis.navigator.clipboard.writeText(text); return true; } } catch { /* denied */ }
  return false;
}
export const canCopy = Platform.OS === 'web';
