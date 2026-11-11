import type { CollectionRepo, DocRepo } from './types';
import type { CollName, CollMap, DocMap, DocName } from '@/data/types';
import { api, resolveMediaUrls, sameOriginApi } from '@/lib/backend';
import { storage } from '@/data/mock/storage';
import { useLocal } from '@/store/useLocal';
import { uid } from '@/lib/uid';

/** Everything an admin edits (collections + settings documents) lives in the database; this is the only reader/writer. */
interface Snapshot { version: number; collections: Record<string, { id: string }[]>; docs: Record<string, unknown> }

/**
 * The HTML shell (see scripts/postexport.js) starts GET /api/content while the JavaScript is still downloading and leaves
 * its promise on `window.__dwiraEarly`. The first read consumes it instead of issuing a second request.
 */
interface Early { admin: boolean; promise: Promise<Snapshot | null>; value?: Snapshot | null; used?: boolean }
const earlyShell = (): Early | undefined => (sameOriginApi && typeof window !== 'undefined' ? (window as unknown as { __dwiraEarly?: Early }).__dwiraEarly : undefined);
const isAdminDevice = () => useLocal.getState().adminSession;

/** Last public snapshot, kept on the device so a returning visitor sees real content before any network answer. */
const CACHE_KEY = 'content-cache';
const CACHE_SCHEMA = 1;
let cacheTimer: ReturnType<typeof setTimeout> | undefined;
function saveCache(snapshot: Snapshot) {
  // Never persist what an admin session returned (it contains provider keys): only the public copy is cached.
  if (isAdminDevice()) return;
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => { void storage.write(CACHE_KEY, { schema: CACHE_SCHEMA, snapshot }); }, 1500);
}

let inflight: Promise<Snapshot> | null = null;
/**
 * Writes this device completed recently. A download that STARTED before a write finished may have been answered by the
 * server before that write was committed (slow network, cold database), so adopting it as-is would silently drop the
 * new row until the next page load. Every adopted snapshot is therefore re-based on the writes that finished after
 * its request began; a download that started later necessarily contains them and replays nothing.
 */
type Write = { coll: string; id: string; row: { id: string } | null; at: number };
let writes: Write[] = [];
let docWrites: { name: string; value: unknown; at: number }[] = [];
const remember = (coll: string, ids: string[], rows: ({ id: string } | null)[]) => {
  const at = Date.now();
  writes = writes.filter(w => at - w.at < 120000);
  ids.forEach((id, i) => writes.push({ coll, id, row: rows[i], at }));
};
function rebase(snapshot: Snapshot, startedAt: number): Snapshot {
  const pending = writes.filter(w => w.at >= startedAt);
  const docs = { ...snapshot.docs };
  for (const w of docWrites) if (w.at >= startedAt) docs[w.name] = w.value;
  if (!pending.length) return { ...snapshot, docs };
  const collections = { ...snapshot.collections };
  for (const w of pending) {
    const list = (collections[w.coll] ??= []).filter(row => row.id !== w.id);
    const old = snapshot.collections[w.coll]?.findIndex(row => row.id === w.id) ?? -1;
    if (w.row) { if (old >= 0) list.splice(Math.min(old, list.length), 0, w.row); else list.push(w.row); }
    collections[w.coll] = list;
  }
  return { ...snapshot, collections, docs };
}
let current: Snapshot | null = null;
let fetchedAt = 0;
/** Version of the last snapshot received; the sync loop compares it with the server counter. */
export const contentVersion = () => current?.version ?? -1;
/** Time of the last local write; a snapshot fetched before it is stale and must not replace the store. */
let lastWrite = 0;
export const lastContentWrite = () => lastWrite;

/** Parallel reads (init loads 13 repos at once) share one request. */
let firstReadAt = 0;
export function contentSnapshot(force = true, version?: number): Promise<Snapshot> {
  if (inflight) return inflight;
  const now = Date.now();
  if (!firstReadAt && !force) firstReadAt = now;
  // A snapshot prefetched while the session was still loading serves the whole startup burst, however long that took.
  if (!force && current && (now - fetchedAt < 2000 || now - firstReadAt < 2000)) return Promise.resolve(current);
  const startedAt = Date.now();
  inflight = download(version).then(raw => { const snapshot = rebase(raw, startedAt); current = snapshot; fetchedAt = Date.now(); saveCache(snapshot); return snapshot; }).finally(() => { inflight = null; });
  return inflight;
}

/**
 * Admin devices ask for `?a=1` so a shared cache can never answer them with the public copy (which hides provider keys and
 * would blank them on the next save). `?v=<version>` makes a reload after a sync notification skip any short-lived cached copy.
 */
async function download(version?: number): Promise<Snapshot> {
  const admin = isAdminDevice();
  const early = earlyShell();
  if (early && !early.used && early.admin === admin) {
    early.used = true;
    const value = await early.promise;
    if (value) return resolveMediaUrls(value);
  }
  const query = [admin ? 'a=1' : '', version != null && version >= 0 ? `v=${version}` : ''].filter(Boolean).join('&');
  return resolveMediaUrls(await api<Snapshot>(`/content${query ? `?${query}` : ''}`));
}

/**
 * Makes content available WITHOUT waiting for the network: first what the HTML shell already downloaded, then the copy
 * kept on this device. Returns false when neither exists (the caller then renders placeholders and loads in the background).
 */
export async function primeContent(): Promise<boolean> {
  if (current) return true;
  const admin = isAdminDevice();
  const early = earlyShell();
  let snapshot: Snapshot | null | undefined;
  if (early && !early.used && early.admin === admin && early.value) { early.used = true; snapshot = resolveMediaUrls(early.value); }
  // An admin device always loads fresh data (the stored copy has no provider keys and must never feed an admin form).
  if (!snapshot && !admin) {
    const saved = await storage.read<{ schema?: number; snapshot?: Snapshot }>(CACHE_KEY);
    if (saved?.schema === CACHE_SCHEMA && saved.snapshot?.collections && saved.snapshot.docs) snapshot = saved.snapshot;
  }
  if (!snapshot) return false;
  current = snapshot; fetchedAt = Date.now(); firstReadAt = fetchedAt;
  saveCache(snapshot); // a copy that came from the HTML shell is stored for the next visit; one read from storage is rewritten unchanged
  return true;
}

export function remoteCollection<K extends CollName>(name: K): CollectionRepo<CollMap[K]> {
  type T = CollMap[K];
  const rows = async (force = false) => ((await contentSnapshot(force)).collections[name] ?? []) as T[];
  const put = async (item: T) => {
    lastWrite = Date.now();
    const saved = await api<T>(`/admin/content/${name}/${encodeURIComponent(item.id)}`, { method: 'PUT', body: item });
    lastWrite = Date.now();
    remember(name, [saved.id], [saved]);
    if (current) {
      const list = (current.collections[name] ??= []) as T[];
      const index = list.findIndex(row => row.id === saved.id);
      if (index >= 0) list[index] = saved; else list.push(saved);
    }
    return saved;
  };
  return {
    list: async () => [...await rows()],
    get: async id => (await rows()).find(row => row.id === id),
    create: input => put({ ...input, id: input.id ?? uid(name.slice(0, 3)) } as T),
    async update(id, patch) {
      // Merge over the freshest stored row; bursts (reordering) reuse the snapshot fetched moments ago.
      const old = (await rows()).find(row => row.id === id);
      if (!old) throw new Error(`${name}/${id} not found`);
      return put({ ...old, ...patch, id });
    },
    remove: id => remove([id]),
    removeMany: ids => remove(ids),
  };
  async function remove(ids: string[]) {
    if (!ids.length) return;
    lastWrite = Date.now();
    await api(`/admin/content/${name}`, { method: 'DELETE', body: { ids } });
    lastWrite = Date.now();
    remember(name, ids, ids.map(() => null));
    if (current) current.collections[name] = (current.collections[name] ?? []).filter(row => !ids.includes(row.id));
  }
}

export function remoteDoc<K extends DocName>(name: K, defaults: () => DocMap[K]): DocRepo<DocMap[K]> {
  type T = DocMap[K];
  // Stored values are merged over the defaults so settings added in later versions get a value.
  const withDefaults = (stored: unknown) => ({ ...defaults(), ...(stored as object | undefined) }) as T;
  const patch = async (value: Partial<T>) => {
    lastWrite = Date.now();
    const saved = withDefaults(await api<T>(`/admin/doc/${name}`, { method: 'PATCH', body: value }));
    lastWrite = Date.now();
    docWrites = docWrites.filter(w => Date.now() - w.at < 120000);
    docWrites.push({ name, value: saved, at: Date.now() });
    if (current) current.docs[name] = saved;
    return saved;
  };
  return {
    get: async () => withDefaults((await contentSnapshot(false)).docs[name]),
    set: value => patch(value),
    patch,
  };
}

/** Starts the content download at app launch (development / native, where there is no HTML shell to do it). */
export function prefetchContent() { void contentSnapshot(true).catch(() => { /* startup retries on its own */ }); }
