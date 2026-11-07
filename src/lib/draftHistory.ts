/**
 * Undo / redo for the admin's unsaved ("live preview") edits. Pure: the store, the clock and the "is this draft still unsaved" test are injected
 * (see src/store/adminHistory.ts), so the rules can be unit-checked without React.
 *
 * One command stack for every draft of the admin panel (settings document, collections...). Each entry remembers a key and the value that key had
 * BEFORE the edit. Undo puts that value back and keeps the value it replaced on the redo stack (and the other way round), so a mix of edits made on
 * several drafts is walked back in exactly the order it was made. Consecutive edits of the same key within `gap` ms (a slider drag, typing) count
 * as one step. Saving or discarding a draft forgets its entries: the saved state is the new baseline.
 */
export interface HistoryIO {
  /** Current value of a draft key (`doc:settings`, `col:tools`...). */
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  /** False once the draft was saved or discarded: its old entries must not be replayed. */
  alive(key: string): boolean;
  now(): number;
}
interface Entry { key: string; value: unknown }

export const HISTORY_GAP_MS = 700;
export const HISTORY_MAX = 100;

export type HistoryAction = 'undo' | 'redo';
/** Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y = redo. Anything else (or with Alt) is not ours. */
export function historyKeyAction(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): HistoryAction | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = (e.key || '').toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

export function createHistory(io: HistoryIO, opts: { gap?: number; max?: number } = {}) {
  const gap = opts.gap ?? HISTORY_GAP_MS, max = opts.max ?? HISTORY_MAX;
  let past: Entry[] = [], future: Entry[] = [], at = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());
  const live = (list: Entry[], key?: string) => list.some((e) => io.alive(e.key) && (!key || e.key === key));

  return {
    /** Call BEFORE applying an edit, with the value the key had until now. */
    record(key: string, before: unknown) {
      const t = io.now(), last = past[past.length - 1];
      const joined = !!last && last.key === key && t - at <= gap && future.length === 0;
      if (!joined) { past = [...past, { key, value: before }].slice(-max); future = []; }
      at = t;
      emit();
    },
    /** The next edit starts a new step even if it comes right after the previous one (preset, reset, import). */
    breakGroup() { at = 0; },
    canUndo(key?: string) { return live(past, key); },
    canRedo(key?: string) { return live(future, key); },
    undo(): boolean {
      while (past.length) {
        const e = past[past.length - 1]; past = past.slice(0, -1);
        if (!io.alive(e.key)) continue;
        future = [...future, { key: e.key, value: io.read(e.key) }];
        io.write(e.key, e.value); at = 0; emit();
        return true;
      }
      return false;
    },
    redo(): boolean {
      while (future.length) {
        const e = future[future.length - 1]; future = future.slice(0, -1);
        if (!io.alive(e.key)) continue;
        past = [...past, { key: e.key, value: io.read(e.key) }].slice(-max);
        io.write(e.key, e.value); at = 0; emit();
        return true;
      }
      return false;
    },
    /** The draft was saved / discarded / re-based: its steps are meaningless now. */
    forget(key: string) {
      const keep = (e: Entry) => e.key !== key;
      if (!past.some((e) => !keep(e)) && !future.some((e) => !keep(e))) return;
      past = past.filter(keep); future = future.filter(keep); emit();
    },
    clear() { past = []; future = []; at = 0; emit(); },
    size: () => ({ past: past.length, future: future.length }),
    subscribe(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; },
  };
}
export type AdminHistory = ReturnType<typeof createHistory>;
