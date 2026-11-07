import { create } from 'zustand';
import { storage } from '@/data/mock/storage';

/** Per-device state of the admin side menu: expanded or collapsed to the icon rail. The ONLY control is the collapse icon in the page header. */
interface AdminMenu {
  collapsed: boolean;
  loaded: boolean;
  load(): Promise<void>;
  setCollapsed(next: boolean | ((old: boolean) => boolean)): void;
}
export const useAdminMenu = create<AdminMenu>((set, get) => ({
  collapsed: false,
  loaded: false,
  async load() {
    if (get().loaded) return;
    const v = await storage.read<{ collapsed?: boolean }>('adminMenu');
    set({ collapsed: !!v?.collapsed, loaded: true });
  },
  setCollapsed(next) {
    const collapsed = typeof next === 'function' ? next(get().collapsed) : next;
    set({ collapsed, loaded: true });
    void storage.write('adminMenu', { collapsed });
  },
}));
