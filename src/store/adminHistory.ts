import { create } from 'zustand';
import { createHistory } from '@/lib/draftHistory';
import { docBaselines, collectionBaselines } from './drafts';
import { useStore } from './useStore';
import type { CollName, DocName } from '@/data/types';

const split = (key: string): ['doc' | 'col', string] => { const i = key.indexOf(':'); return [key.slice(0, i) as 'doc' | 'col', key.slice(i + 1)]; };

/** The admin's undo / redo stack for unsaved edits (settings document, collections). See lib/draftHistory. */
export const adminHistory = createHistory({
  read: (key) => { const [k, n] = split(key); return k === 'doc' ? useStore.getState().doc[n as DocName] : useStore.getState()[n as CollName]; },
  write: (key, value) => {
    const [k, n] = split(key);
    if (k === 'doc') useStore.setState((s) => ({ doc: { ...s.doc, [n]: value } as typeof s.doc }));
    else useStore.setState({ [n]: value } as never);
  },
  // Only a draft that is still unsaved can be walked back (a save or a discard re-bases it).
  alive: (key) => { const [k, n] = split(key); return k === 'doc' ? docBaselines.has(n as DocName) : collectionBaselines.has(n as CollName); },
  now: () => Date.now(),
});

/** Re-renders the components that show the undo / redo buttons whenever the stacks change. */
export const useHistoryRev = create<{ rev: number }>(() => ({ rev: 0 }));
adminHistory.subscribe(() => useHistoryRev.setState((s) => ({ rev: s.rev + 1 })));

export const docKey = (name: DocName) => `doc:${name}`;
export const colKey = (name: CollName) => `col:${name}`;

/** `canUndo` / `canRedo` (optionally limited to one draft) + the two actions, reactive. */
export function useAdminHistory(key?: string) {
  useHistoryRev((s) => s.rev);
  return { canUndo: adminHistory.canUndo(key), canRedo: adminHistory.canRedo(key), undo: () => adminHistory.undo(), redo: () => adminHistory.redo() };
}
