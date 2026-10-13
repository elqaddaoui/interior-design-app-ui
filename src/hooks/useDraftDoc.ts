import { toast } from '@/store/useToast';
import { moveSelection } from '@/lib/reorder';
import { sorted, useStore } from '@/store/useStore';
import type { CollMap, CollName, DocMap, DocName } from '@/data/types';
import { useBackCheckpoint, useLeaveGuard, router } from './useLeaveGuard';

const baselines: Partial<DocMap> = {};
/** Repository data is untouched until Submit. The shared store is the live preview. */
export function useDraftDoc<K extends DocName>(name: K) {
  const draft = useStore((s) => s.doc[name]);
  if (!baselines[name]) (baselines as any)[name] = draft;
  const saved = baselines[name] as DocMap[K];
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (value: DocMap[K] | ((old: DocMap[K]) => DocMap[K])) => {
    const current = useStore.getState().doc[name];
    useStore.setState((s) => ({ doc: { ...s.doc, [name]: typeof value === 'function' ? (value as (old: DocMap[K]) => DocMap[K])(current) : value } }));
  };
  const patch = (value: Partial<DocMap[K]>) => set((old) => ({ ...old, ...value }));
  const save = async () => {
    try {
      await useStore.getState().patchDoc(name, useStore.getState().doc[name]);
      (baselines as any)[name] = useStore.getState().doc[name];
      useStore.setState((s) => ({ doc: { ...s.doc } }));
      return true;
    } catch { toast('Could not save changes. Your draft is still available.'); return false; }
  };
  const discard = () => set(baselines[name] as DocMap[K]);
  useLeaveGuard(dirty, save, discard);
  useBackCheckpoint(dirty, () => router.back());
  return { draft, saved, set, patch, save, discard, dirty };
}

const collectionBaselines = new Map<CollName, any[]>();
/** Inline visibility and ordering are previews too, not implicit repository writes. */
export function useCollectionDraft<K extends CollName>(name: K) {
  const list = useStore((s) => s[name]);
  const baseline = collectionBaselines.get(name);
  const dirty = !!baseline && JSON.stringify(list) !== JSON.stringify(baseline);
  const stage = (next: CollMap[K][]) => {
    if (!collectionBaselines.has(name)) collectionBaselines.set(name, [...useStore.getState()[name]]);
    useStore.setState({ [name]: next } as any);
  };
  const update = (id: string, patch: Partial<CollMap[K]>) => stage((useStore.getState()[name] as CollMap[K][]).map((row) => row.id === id ? { ...row, ...patch } : row));
  const move = (ids: string[], direction: -1 | 1) => {
    const rows = sorted(useStore.getState()[name] as any[]);
    stage(moveSelection(rows, ids, direction).map((row, order) => ({ ...row, order })));
  };
  const save = async () => {
    const saved = collectionBaselines.get(name);
    if (!saved) return true;
    try {
      for (const row of useStore.getState()[name] as any[]) {
        const index = saved.findIndex((old) => old.id === row.id);
        if (index >= 0 && JSON.stringify(row) !== JSON.stringify(saved[index])) {
          await useStore.getState().update(name, row.id, row);
          saved[index] = row;
        }
      }
      collectionBaselines.delete(name);
      useStore.setState({ [name]: [...useStore.getState()[name]] } as any);
      return true;
    } catch { toast('Could not save changes. Your draft is still available.'); return false; }
  };
  const discard = () => {
    const saved = collectionBaselines.get(name);
    if (saved) {
      collectionBaselines.delete(name);
      useStore.setState({ [name]: saved } as any);
    }
  };
  useLeaveGuard(dirty, save, discard);
  useBackCheckpoint(dirty, () => router.back());
  const forget = (ids: string[]) => {
    const saved = collectionBaselines.get(name);
    if (saved) collectionBaselines.set(name, saved.filter((row) => !ids.includes(row.id)));
  };
  return { update, move, save, discard, dirty, forget };
}
