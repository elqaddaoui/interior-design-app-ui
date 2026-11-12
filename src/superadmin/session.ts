import { create } from 'zustand';
import { sa, SaError } from './api';
import { SA, applySaTheme } from './tokens';
import { applySaLang, saLang, type SaLang } from './i18n';

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

/** Active console theme. Changing it swaps the live palette (tokens.ts) and bumps `theme` so the shell re-renders and remounts its pages. Browser-only. */
export const useSaTheme = create<{ theme: string; setTheme: (id: string) => void }>((set) => ({
  theme: SA.theme,
  setTheme: id => { if (applySaTheme(id)) set({ theme: id }); },
}));

/** Active console language (English, Français, العربية, الدارجة). Changing it bumps `lang` so the shell remounts its pages; browser-only, like the theme. */
export const useSaLang = create<{ lang: SaLang; setLang: (id: SaLang) => void }>((set) => ({
  lang: saLang(),
  setLang: id => { if (applySaLang(id)) set({ lang: id }); },
}));
