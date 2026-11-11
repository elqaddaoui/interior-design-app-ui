import { create } from 'zustand';
import { sa, SaError } from './api';

/** Own store (never the tenant store): who is signed in to the console. `state`: 'checking' until the first answer. */
type S = { state: 'checking' | 'out' | 'in' | 'unconfigured'; email: string; check: () => Promise<void>; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void> };
export const useSuper = create<S>((set) => ({
  state: 'checking', email: '',
  check: async () => {
    try { const r = await sa<{ email: string }>('/session'); set({ state: 'in', email: r.email }); }
    catch (error) { set({ state: error instanceof SaError && error.code === 'SUPERADMIN_NOT_CONFIGURED' ? 'unconfigured' : 'out', email: '' }); }
  },
  login: async (email, password) => { const r = await sa<{ email: string }>('/login', { method: 'POST', body: { email, password } }); set({ state: 'in', email: r.email }); },
  logout: async () => { await sa('/logout', { method: 'POST', body: {} }).catch(() => {}); set({ state: 'out', email: '' }); },
}));
