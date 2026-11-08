import { create } from 'zustand';
import { storage } from '@/data/mock/storage';
import { addGrant, markUndone, type Grant } from '@/lib/creditGrants';

/** The admin's grant log, kept on this device (the backend only stores the balance). Feeds "granted this month" and "recent activity". */
interface LogState { log: Grant[]; ready: boolean; load(): Promise<void>; add(g: Grant): void; undone(id: string): void }
const KEY = 'creditGrants';
export const useCreditLog = create<LogState>((set, get) => ({
  log: [], ready: false,
  async load() {
    if (get().ready) return;
    const saved = await storage.read<Grant[]>(KEY);
    set((s) => ({ ready: true, log: Array.isArray(saved) ? [...s.log, ...saved.filter((g) => !s.log.some((x) => x.id === g.id))] : s.log }));
  },
  add(g) { set((s) => ({ log: addGrant(s.log, g) })); void storage.write(KEY, get().log); },
  undone(id) { set((s) => ({ log: markUndone(s.log, id) })); void storage.write(KEY, get().log); },
}));
