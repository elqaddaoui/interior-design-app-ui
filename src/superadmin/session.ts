import { create } from 'zustand';
import { sa, SaError } from './api';

/** Own store (never the tenant store): who is signed in to the console. `state`: 'checking' until the first answer. */
type Me = { email: string; isDefault: boolean };
type S = {
  state: 'checking' | 'out' | 'in'; email: string; isDefault: boolean;
  check: () => Promise<void>; login: (email: string, password: string) => Promise<void>; logout: () => Promise<void>;
  /** After Settings changed the account: keep the header and the factory-credentials banner in step. */
  setMe: (me: Me) => void;
};
export const useSuper = create<S>((set) => ({
  state: 'checking', email: '', isDefault: false,
  check: async () => {
    try { const r = await sa<Me>('/session'); set({ state: 'in', email: r.email, isDefault: !!r.isDefault }); }
    catch (error) { set({ state: 'out', email: '', isDefault: false }); void (error instanceof SaError); }
  },
  login: async (email, password) => { const r = await sa<Me>('/login', { method: 'POST', body: { email, password } }); set({ state: 'in', email: r.email, isDefault: !!r.isDefault }); },
  logout: async () => { await sa('/logout', { method: 'POST', body: {} }).catch(() => {}); set({ state: 'out', email: '', isDefault: false }); },
  setMe: me => set({ email: me.email, isDefault: me.isDefault }),
}));
