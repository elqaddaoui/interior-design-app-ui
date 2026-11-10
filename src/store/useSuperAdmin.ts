import { create } from 'zustand';
import { BackendError } from '@/lib/backend';
import { rememberToken, saApi, setUnauthorizedHandler, type SaProfile } from '@/lib/superadmin';

type Result = { ok: true } | { ok: false; code: string };
interface State {
  /** unknown = not asked yet; out = no session; in = signed in. */
  status: 'unknown' | 'out' | 'in';
  profile: SaProfile | null;
  /** The "change the default password" dialog opens once per sign-in; this remembers it was shown. */
  promptShown: boolean;
  check(): Promise<void>;
  signIn(username: string, password: string): Promise<Result>;
  signOut(): Promise<void>;
  setProfile(profile: SaProfile): void;
  markPrompted(): void;
}

export const useSuperAdmin = create<State>((set, get) => ({
  status: 'unknown', profile: null, promptShown: false,
  async check() {
    try { const r = await saApi<{ profile: SaProfile }>('/session'); set({ status: 'in', profile: r.profile }); }
    catch (error) { if (get().status !== 'in' || (error instanceof BackendError && error.status === 401)) set({ status: 'out', profile: null }); }
  },
  async signIn(username, password) {
    try {
      const r = await saApi<{ profile: SaProfile; token?: string }>('/login', { method: 'POST', body: { username, password } });
      if (r.token) await rememberToken(r.token);
      set({ status: 'in', profile: r.profile, promptShown: false });
      return { ok: true };
    } catch (error) {
      return { ok: false, code: error instanceof BackendError ? (error.status === 429 ? 'TOO_MANY_ATTEMPTS' : error.status >= 500 || error.code === 'BACKEND_UNAVAILABLE' ? 'BACKEND_UNAVAILABLE' : 'INVALID') : 'BACKEND_UNAVAILABLE' };
    }
  },
  async signOut() {
    try { await saApi('/logout', { method: 'POST' }); } catch { /* the session is dropped locally either way */ }
    await rememberToken(null).catch(() => {});
    set({ status: 'out', profile: null, promptShown: false });
  },
  setProfile: (profile) => set({ profile }),
  markPrompted: () => set({ promptShown: true }),
}));
setUnauthorizedHandler(() => { void rememberToken(null).catch(() => {}); useSuperAdmin.setState({ status: 'out', profile: null }); });
