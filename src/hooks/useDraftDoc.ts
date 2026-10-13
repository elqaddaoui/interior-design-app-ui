import { useStore } from '@/store/useStore';
import type { DocMap, DocName } from '@/data/types';
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
    await useStore.getState().patchDoc(name, useStore.getState().doc[name]);
    (baselines as any)[name] = useStore.getState().doc[name];
    // Trigger a render after baseline changes, even if the repository returned the same object.
    useStore.setState((s) => ({ doc: { ...s.doc } }));
  };
  const discard = () => set(baselines[name] as DocMap[K]);
  useLeaveGuard(dirty, save, discard);
  useBackCheckpoint(dirty, () => router.back());
  return { draft, saved, set, patch, save, discard, dirty };
}
