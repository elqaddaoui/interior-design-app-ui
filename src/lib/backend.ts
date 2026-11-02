import { Platform } from 'react-native';
import { storage } from '@/data/mock/storage';
import { useLocal } from '@/store/useLocal';

// This is a public URL, never an admin credential or VAPID private key.
// Web deployments use the backend on the same host without build-time configuration.
// Native builds still need an absolute URL. Demo mode must be explicitly requested.
const BASE = (process.env.EXPO_PUBLIC_API_URL?.trim() || (Platform.OS === 'web' ? '/api' : '')).replace(/\/+$/, '');
export const backendEnabled = process.env.EXPO_PUBLIC_BACKEND_MODE !== 'demo' && !!BASE;
/** True when the API lives on the same origin as the page (web default): only then can the HTML shell prefetch it. */
export const sameOriginApi = Platform.OS === 'web' && BASE === '/api';
/** Uploaded images are served by the API at `/api/media/...`. The web resolves that against the page; native apps need the API host. */
const MEDIA_ORIGIN = Platform.OS === 'web' ? '' : BASE.replace(/\/api$/, '');
export const resolveMediaUrls = <T,>(value: T): T => {
  if (!MEDIA_ORIGIN) return value;
  const walk = (node: unknown): unknown => typeof node === 'string' ? (node.startsWith('/api/media/') ? MEDIA_ORIGIN + node : node)
    : Array.isArray(node) ? node.map(walk) : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)])) : node;
  return walk(value) as T;
};
export class BackendError extends Error { constructor(public status: number, public code = '') { super(code || `Backend HTTP ${status}`); } }
export const isBackendUnavailable = (error: unknown) => error instanceof BackendError && (error.code === 'BACKEND_UNAVAILABLE' || error.status >= 500);
let deviceToken: string | null = null;
export async function clientToken() {
  if (deviceToken) return deviceToken;
  const saved = await storage.read<string>('demand-client-token');
  if (saved) return deviceToken = saved;
  // Expo crypto uses the native secure RNG; browsers use crypto.getRandomValues.
  const random = Platform.OS === 'web' ? crypto.getRandomValues(new Uint8Array(32)) : await (await import('expo-crypto')).getRandomBytesAsync(32);
  deviceToken = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join('');
  await storage.write('demand-client-token', deviceToken);
  return deviceToken;
}
/** `timeoutMs`: default 15 s. File uploads pass a longer one (a few MB on a mobile network easily takes more than 15 s). */
export async function api<T>(path: string, options: { method?: string; body?: unknown; client?: boolean; raw?: Blob; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
  if (!backendEnabled) throw new BackendError(503, 'BACKEND_UNAVAILABLE');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
  if (options.client) headers['X-Demand-Token'] = await clientToken();
  if (Platform.OS !== 'web') {
    const { getItemAsync } = await import('expo-secure-store');
    const token = await getItemAsync('dwira-backend-session');
    if (token) headers.Authorization = `Bearer ${token}`;
    const userToken = await getItemAsync('dwira-user-session');
    if (userToken) headers['X-User-Token'] = userToken;
    headers['X-Dwira-Native'] = '1';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    const transport = Platform.OS === 'web' ? fetch : (await import('expo/fetch')).fetch;
    const response = await transport(`${BASE}${path}`, { method: options.method || 'GET', headers, credentials: 'include', body: options.raw ?? (options.body == null ? undefined : JSON.stringify(options.body)), signal: controller.signal });
    // Static SPA rewrites often return index.html with HTTP 200 for missing API routes.
    // Never mistake that response for a working backend or silently fall back to mocks.
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new BackendError(503, 'BACKEND_UNAVAILABLE');
    const body = await response.json().catch(() => { throw new BackendError(502, 'BACKEND_UNAVAILABLE'); });
    if (!response.ok) throw new BackendError(response.status, body.error);
    // Every response (content, requests, history, chats, uploads) may carry /api/media URLs: native apps need them absolute.
    return resolveMediaUrls(body) as T;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(503, 'BACKEND_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}
/**
 * Authenticated GET of a binary response (web only: used by the admin video renderer to read a picture the browser may not read directly).
 * Same session cookie as `api`; resolves the bytes, or rejects with a BackendError whose code is the server's error code.
 */
export async function apiBlob(path: string, timeoutMs = 30000): Promise<Blob> {
  if (!backendEnabled) throw new BackendError(503, 'BACKEND_UNAVAILABLE');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${BASE}${path}`, { credentials: 'include', signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({} as { error?: string }));
      throw new BackendError(response.status, body.error);
    }
    if (response.headers.get('content-type')?.toLowerCase().includes('text/html')) throw new BackendError(503, 'BACKEND_UNAVAILABLE');
    return await response.blob();
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(503, 'BACKEND_UNAVAILABLE');
  } finally { clearTimeout(timeout); }
}
/** Built-in default admin login. It must always open the admin panel, even if the API is unreachable or outdated. */
export const isDefaultAdmin = (email: string, password: string) => email.trim().toLowerCase() === 'admin' && password === 'admin';
export async function backendLogin(email: string, password: string) {
  try {
    const result = await api<{ ok: true; user: { id: string; name: string }; token?: string }>('/admin/login', { method: 'POST', body: { email, password } });
    if (Platform.OS !== 'web' && result.token) {
      const { setItemAsync } = await import('expo-secure-store');
      await setItemAsync('dwira-backend-session', result.token);
    }
    useLocal.getState().set({ adminOffline: false });
    return { ok: true as const, user: result.user };
  } catch {
    // Server missing (static hosting, /api not proxied) or running an older build without the default login:
    // still accept admin/admin locally. Server-protected data stays protected by the server itself.
    if (isDefaultAdmin(email, password)) {
      useLocal.getState().set({ adminOffline: true });
      return { ok: true as const, user: { id: 'usr_admin', name: 'Admin' } };
    }
    return { ok: false as const };
  }
}
export async function backendLogout() {
  useLocal.getState().set({ adminOffline: false });
  if (!backendEnabled) return;
  try { await api('/admin/logout', { method: 'POST', body: {} }); }
  finally { if (Platform.OS !== 'web') await (await import('expo-secure-store')).deleteItemAsync('dwira-backend-session'); }
}

