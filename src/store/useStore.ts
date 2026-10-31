import { useUserSession } from './useUserSession';
import { useLocal } from './useLocal';
import { create } from 'zustand';
import type { CollMap, CollName, DocMap, DocName, AppUser } from '@/data/types';
import { repos, docs, ME } from '@/data/repositories';
import { backendEnabled } from '@/lib/backend';
import { contentSnapshot } from '@/data/repositories/remoteContent';
import { collectionBaselines, docBaselines } from '@/store/drafts';
import { moveSelection } from '@/lib/reorder';
import { uid } from '@/lib/uid';
import { defaultAssistant, defaultBranding, defaultSettings, defaultTheme } from '@/data/mock/seed';

type Colls = { [K in CollName]: CollMap[K][] };

interface State extends Colls {
  doc: DocMap;
  ready: boolean;
  /** True once real content (cached copy or network) is in the store. Until then screens show placeholders, never an "empty" state. */
  contentReady: boolean;
  /** True once the signed-in person's own data (designs, chats, requests) has been read once. Screens show skeletons until then, never a false "empty" state. */
  personalReady: boolean;
  /** True once the admin lists (requests, clients) have been read in this admin session. */
  adminLoaded: boolean;
  init(): Promise<void>;
  /** Reads the person's own space (and, for an admin device, the admin lists) in the background; never blocks the first screen. */
  loadPersonal(): Promise<void>;
  loadAdminData(): Promise<void>;
  /** Puts the content snapshot already held in memory (cache / HTML shell / last download) into the store without any network call. */
  applyContent(): Promise<void>;
  reload(name: CollName): Promise<void>;
  /** Re-reads the shared content (collections + settings documents) from the database, keeping unsaved admin drafts. */
  reloadContent(version?: number): Promise<void>;
  create<K extends CollName>(name: K, input: Omit<CollMap[K], 'id'> & { id?: string }): Promise<CollMap[K]>;
  update<K extends CollName>(name: K, id: string, patch: Partial<CollMap[K]>): Promise<void>;
  remove(name: CollName, id: string): Promise<void>;
  removeMany(name: CollName, ids: string[]): Promise<void>;
  patchDoc<K extends DocName>(name: K, patch: Partial<DocMap[K]>): Promise<void>;
  /** Reorder helper for any collection with `order`. */
  move(name: CollName, id: string, dir: -1 | 1): Promise<void>;
  moveMany(name: CollName, ids: string[], dir: -1 | 1): Promise<void>;
}

const empty: Colls = {
  tabs: [], tools: [], roomTypes: [], styles: [], palettes: [], sections: [], categories: [],
  inspirations: [], models: [], plans: [], users: [], requests: [], history: [], conversations: [],
};
let initializing: Promise<void> | null = null;
let adminInflight: Promise<void> | null = null;
const CONTENT_COLLS = ['tabs', 'tools', 'roomTypes', 'styles', 'palettes', 'sections', 'categories', 'inspirations', 'models', 'plans'] as const;
const DOC_NAMES = ['branding', 'theme', 'assistant', 'settings'] as const;

/** One shared store: user app and admin panel read/write the same state, so changes appear instantly. */
export const useStore = create<State>((set, get) => ({
  ...empty,
  doc: { branding: defaultBranding(), theme: defaultTheme(), assistant: defaultAssistant(), settings: defaultSettings() },
  ready: false,
  contentReady: false,
  personalReady: false,
  adminLoaded: false,
  async applyContent() {
    const snapshot = await contentSnapshot(false);
    const patch: Record<string, unknown> = {};
    for (const name of CONTENT_COLLS) if (!collectionBaselines.has(name)) patch[name] = [...(snapshot.collections[name] ?? [])];
    const doc = { ...get().doc };
    for (const name of DOC_NAMES) if (!docBaselines.has(name)) (doc as any)[name] = await docs[name].get();
    set({ ...(patch as Partial<State>), doc, contentReady: true });
  },
  async init() {
    if (get().ready) return;
    if (initializing) return initializing;
    initializing = (async () => {
    // Only the shared public content gates the first screen. The person's own data (designs, chats, requests, clients) is
    // read separately by loadPersonal(), in parallel with the session, so a slow account lookup never delays a page.
    const listsPromise = Promise.all(CONTENT_COLLS.map((c) => repos[c].list()));
    const docsPromise = Promise.all([docs.branding.get(), docs.theme.get(), docs.assistant.get(), docs.settings.get()]);
    const lists = await listsPromise;
    const [branding, theme, assistant, settings] = await docsPromise;
    const patch: Record<string, unknown> = {};
    CONTENT_COLLS.forEach((c, i) => (patch[c] = lists[i]));
    set({ ...(patch as Partial<Colls>), doc: { branding, theme, assistant, settings }, ready: true, contentReady: true });
    })().finally(() => { initializing = null; });
    return initializing;
  },
  async loadPersonal() {
    // The space readers only return data for the person who is signed in right now (or the visitor's own chats).
    await Promise.allSettled([reloadUserSpace(), get().loadAdminData()]);
    set({ personalReady: true });
  },
  loadAdminData() {
    if (!useLocal.getState().adminSession) return Promise.resolve();
    // Startup, the admin shell and the login form all ask: one set of requests answers them all.
    adminInflight ??= (async () => {
      const [requests, users] = await Promise.allSettled([repos.requests.list(), repos.users.list()]);
      // A failed read keeps what is on screen; the loader still ends so a skeleton never stays forever.
      set({ ...(requests.status === 'fulfilled' ? { requests: requests.value } : {}), ...(users.status === 'fulfilled' ? { users: users.value } : {}), adminLoaded: true });
    })().finally(() => { adminInflight = null; });
    return adminInflight;
  },
  async reload(name) {
    set({ [name]: await repos[name].list() } as Partial<State>);
  },
  async reloadContent(version) {
    // `version` is the counter the server announced through /api/sync: asking for that exact version bypasses any short-lived shared cache.
    const [snapshot] = await Promise.all([contentSnapshot(true, version)]);
    // The repository re-bases the snapshot on any save of this device that finished after its request began, so it is safe to adopt as is.
    const patch: Record<string, unknown> = {};
    for (const name of CONTENT_COLLS) if (!collectionBaselines.has(name)) patch[name] = [...(snapshot.collections[name] ?? [])];
    const doc = { ...get().doc };
    for (const name of DOC_NAMES) if (!docBaselines.has(name)) (doc as any)[name] = await docs[name].get();
    set({ ...(patch as Partial<State>), doc, contentReady: true });
  },
  async create(name, input) {
    const item = await (repos[name] as any).create(input);
    // The row may already be here (a reload that raced this write adopted it): one id is one row, the saved copy wins.
    const rows = get()[name] as any[];
    set({ [name]: rows.some((x) => x.id === item.id) ? rows.map((x) => (x.id === item.id ? item : x)) : [...rows, item] } as Partial<State>);
    return item;
  },
  async update(name, id, p) {
    const item = await (repos[name] as any).update(id, p);
    set({ [name]: (get()[name] as any[]).map((x) => (x.id === id ? item : x)) } as Partial<State>);
  },
  async remove(name, id) {
    await repos[name].remove(id);
    set({ [name]: (get()[name] as any[]).filter((x) => x.id !== id) } as Partial<State>);
  },
  async removeMany(name, ids) {
    await repos[name].removeMany(ids);
    const s = new Set(ids);
    set({ [name]: (get()[name] as any[]).filter((x) => !s.has(x.id)) } as Partial<State>);
  },
  async patchDoc(name, p) {
    const v = await (docs[name] as any).patch(p);
    set({ doc: { ...get().doc, [name]: v } });
  },
  async move(name, id, dir) {
    await get().moveMany(name, [id], dir);
  },
  async moveMany(name, ids, dir) {
    const list = sorted(get()[name] as any[]);
    const reordered = moveSelection(list, ids, dir);
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].order !== i) await get().update(name, reordered[i].id, { order: i } as any);
    }
  },
}));

export const sorted = <T extends { order: number }>(a: T[]) => [...a].sort((x, y) => x.order - y.order);
export const nextOrder = (a: { order: number }[]) => (a.length ? Math.max(...a.map((x) => x.order)) + 1 : 0);

/** Current (single, device-local) end user. */
export const useMe = (): AppUser | undefined => {
  const user = useUserSession(s => s.user);
  // Only the offline demo has a local guest profile; with the backend a person exists once they sign in.
  const guest = useStore(s => (backendEnabled ? undefined : s.users.find(u => u.id === ME)));
  return user ?? guest;
};
const SPACE_COLLS = ['history', 'conversations', 'requests'] as const;
let spaceInflight: { who: string; full: boolean; promise: Promise<void> } | null = null;
/**
 * Reload the signed-in person's own chats, designs and requests. A response that arrives after the person changed
 * (sign-out, another account) is dropped, so one account's data can never land in another's session.
 * Concurrent calls for the same person share one set of requests (startup and the sign-in hook both ask).
 */
export function reloadUserSpace(only?: readonly CollName[]): Promise<void> {
  const who = useUserSession.getState().user?.id ?? '';
  // A partial reload (one part changed) joins a full one in flight; a full reload is never replaced by a partial one.
  if (spaceInflight?.who === who && (!only || spaceInflight.full)) return spaceInflight.promise;
  const promise = (async () => {
    // An admin device's `requests` list is the admin's, loaded by loadAdminData: only a signed-in person's own list is replaced here.
    const all = useLocal.getState().adminSession && !who ? SPACE_COLLS.filter(name => name !== 'requests') : SPACE_COLLS;
    const names = only ? all.filter(name => only.includes(name)) : all;
    const lists = await Promise.all(names.map(name => repos[name].list()));
    if ((useUserSession.getState().user?.id ?? '') !== who) return;
    useStore.setState(Object.fromEntries(names.map((name, i) => [name, lists[i]])) as Partial<State>);
  })().finally(() => { if (spaceInflight?.promise === promise) spaceInflight = null; });
  spaceInflight = { who, full: !only, promise };
  return promise;
}
/** Whoever the data on screen belongs to changed (sign-in, sign-out, expired or blocked session): start from an empty space, then load theirs. */
useUserSession.subscribe((state, previous) => {
  if ((state.user?.id ?? '') === (previous.user?.id ?? '')) return;
  // Signing in keeps the chats on screen: the server has just moved this device's visitor chats into the account and the reload below returns them.
  useStore.setState(previous.user || !state.user
    ? { history: [], conversations: [], requests: [] }
    : { history: [], requests: [], conversations: useStore.getState().conversations.map(c => ({ ...c, userId: state.user!.id })) });
  void reloadUserSpace().catch(() => {});
});
/** Admin panel access: a server-validated admin session (backend) or the seeded admin profile (demo). */
export const useIsAdmin = () => useStore((s) => backendEnabled || s.users.some((u) => u.role === 'admin'));
export { uid };
