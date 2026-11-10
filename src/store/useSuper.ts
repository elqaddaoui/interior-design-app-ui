import { create } from 'zustand';
import { BackendError } from '@/lib/backend';
import { superApi, saveSuperToken, type Catalog } from '@/lib/superApi';

/** Super Admin session (independent from the tenant admin session and from client accounts). */
interface SuperState {
  checked: boolean; signedIn: boolean; username: string; defaultCredentials: boolean; unavailable: boolean; catalog: Catalog | null;
  check(): Promise<void>;
  login(username: string, password: string): Promise<'ok' | 'invalid' | 'locked' | 'unavailable'>;
  logout(): Promise<void>;
  setDefaultCredentials(v: boolean): void;
  loadCatalog(): Promise<void>;
}
export const useSuper = create<SuperState>((set, get) => ({
  checked: false, signedIn: false, username: '', defaultCredentials: false, unavailable: false, catalog: null,
  async check() {
    try {
      const r = await superApi<{ user: { username: string }; defaultCredentials: boolean }>('/session');
      set({ checked: true, signedIn: true, username: r.user.username, defaultCredentials: r.defaultCredentials, unavailable: false });
    } catch (e) {
      const status = e instanceof BackendError ? e.status : 0;
      set({ checked: true, signedIn: false, username: '', unavailable: status !== 401 });
    }
  },
  async login(username, password) {
    try {
      const r = await superApi<{ user: { username: string }; defaultCredentials: boolean; token?: string }>('/login', { method: 'POST', body: { username, password } });
      await saveSuperToken(r.token);
      set({ checked: true, signedIn: true, username: r.user.username, defaultCredentials: r.defaultCredentials, unavailable: false });
      return 'ok';
    } catch (e) {
      if (e instanceof BackendError) {
        if (e.status === 429) return 'locked';
        if (e.status === 401 || e.status === 400) return 'invalid';
      }
      return 'unavailable';
    }
  },
  async logout() {
    try { await superApi('/logout', { method: 'POST', body: {} }); } catch { /* the session is dropped locally anyway */ }
    await saveSuperToken(undefined);
    set({ signedIn: false, username: '', defaultCredentials: false, catalog: null });
  },
  setDefaultCredentials: (defaultCredentials) => set({ defaultCredentials }),
  async loadCatalog() {
    if (get().catalog) return;
    try { set({ catalog: await superApi<Catalog>('/catalog') }); } catch { /* retried on next visit */ }
  },
}));

/** Runs an API call and turns a failure into a message key (shared by every Super page). */
export function errorKey(e: unknown): string {
  const code = e instanceof BackendError ? e.code : '';
  const known = ['USERNAME_TAKEN', 'SLUG_TAKEN', 'INVALID_USERNAME', 'INVALID_SLUG', 'INVALID_EMAIL', 'WEAK_PASSWORD', 'INVALID_PLAN', 'INVALID_ROLE', 'INVALID_LIMITS', 'NOT_FOUND', 'CONFIRMATION_REQUIRED', 'WRONG_PASSWORD', 'ROLE_IN_USE', 'PLAN_IN_USE', 'SYSTEM_ROLE_READONLY', 'DEFAULT_TENANT_PROTECTED', 'ADMIN_LIMIT', 'TENANT_SUSPENDED'];
  if (known.includes(code)) return `sx.err.${code}`;
  if (e instanceof BackendError && e.status === 401) return 'sx.err.SESSION';
  if (e instanceof BackendError && (e.status >= 500 || e.code === 'BACKEND_UNAVAILABLE')) return 'sx.err.UNAVAILABLE';
  return 'sx.err.GENERIC';
}
