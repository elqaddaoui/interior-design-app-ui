import { create } from 'zustand';

/** This store's own AI-credit allowance, as the server reports it to a signed-in administrator (`instance` in /admin/session). `limit: null` = unlimited. */
export interface AdminCredits { limit: number | null; used: number; left: number | null }
export interface AdminInstance { credits: AdminCredits; apiMode: 'own' | 'platform' }

interface State {
  instance: AdminInstance | null;
  hydrate(i: AdminInstance | null | undefined): void;
  clear(): void;
}
export const useAdminInstance = create<State>((set) => ({
  instance: null,
  hydrate: (instance) => set({ instance: instance ?? null }),
  clear: () => set({ instance: null }),
}));

/** 0..1 share of the allowance used (0 when unlimited). */
export const creditsRatio = (c: AdminCredits | undefined | null) => (!c || c.limit == null ? 0 : c.limit === 0 ? 1 : Math.min(1, c.used / c.limit));
/** 'ok' | 'low' (80% used or more) | 'out'. */
export const creditsLevel = (c: AdminCredits | undefined | null): 'ok' | 'low' | 'out' => { const r = creditsRatio(c); return r >= 1 ? 'out' : r >= 0.8 ? 'low' : 'ok'; };
