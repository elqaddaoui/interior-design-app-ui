import { create } from 'zustand';
import type { Conversation } from '@/data/types';
import { api, backendEnabled } from '@/lib/backend';
import { useLocal } from '@/store/useLocal';

/** A client's conversation as the admin sees it (with who wrote it). */
export type AdminConversation = Conversation & { clientName: string; whatsapp: string; guest?: boolean };

/** Admin inbox: every client's assistant conversations. Loaded on demand and whenever the server announces a `chats` change. */
export const useAdminChats = create<{
  chats: AdminConversation[];
  loaded: boolean;
  load(): Promise<void>;
  reply(id: string, text: string): Promise<void>;
  clear(): void;
}>((set, get) => ({
  chats: [],
  loaded: false,
  async load() {
    if (!backendEnabled || !useLocal.getState().adminSession) return;
    // After the first full load only what changed since the newest known conversation is fetched (`ids` is the current newest-300 set, so deleted ones drop out).
    const known = get().chats;
    if (!get().loaded || !known.length) { set({ chats: await api<AdminConversation[]>('/admin/conversations'), loaded: true }); return; }
    const since = known.reduce((max, chat) => Math.max(max, chat.updatedAt || 0), 0);
    const delta = await api<{ chats: AdminConversation[]; ids: string[] } | AdminConversation[]>(`/admin/conversations?since=${since}`);
    if (Array.isArray(delta)) { set({ chats: delta, loaded: true }); return; }
    const changed = new Map(delta.chats.map(chat => [chat.id, chat]));
    const keep = new Set(delta.ids);
    const merged = [...delta.chats, ...get().chats.filter(chat => keep.has(chat.id) && !changed.has(chat.id))];
    set({ chats: merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), loaded: true });
  },
  async reply(id, text) {
    const updated = await api<AdminConversation>(`/admin/conversations/${encodeURIComponent(id)}`, { method: 'POST', body: { text } });
    set({ chats: [updated, ...get().chats.filter(chat => chat.id !== id)] });
  },
  clear: () => set({ chats: [], loaded: false }),
}));
