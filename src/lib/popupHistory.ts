/**
 * Undo / redo INSIDE a popup (the edit form of a tool, a campaign, an automation, a user...). Pure: the hook that wires it to React is
 * src/hooks/usePopupHistory.ts. Three small parts:
 *  - a registry of the open popups: the TOP one owns Ctrl+Z / Ctrl+Y, so the page behind the popup is never changed by accident;
 *  - `createSourceLog`: a popup that edits two stores at once (the slideshow popup writes into its form AND into the shared settings draft) walks
 *    them back in the order the edits were made;
 *  - `popupKeyAction`: the key handling shared by the web listener and the checks.
 */
export interface PopupApi { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void; /** The next edit starts a new step. */ breakGroup?(): void }
interface Entry { get: () => PopupApi }
const stack: Entry[] = [];

export function registerPopup(get: () => PopupApi): () => void {
  const e: Entry = { get }; stack.push(e);
  return () => { const i = stack.indexOf(e); if (i >= 0) stack.splice(i, 1); };
}
export const openPopups = () => stack.length;

/** Runs the shortcut on the topmost popup. Returns true when a popup is open (the key is then ours, even if there is nothing to undo). */
export function popupKeyAction(action: 'undo' | 'redo'): boolean {
  const top = stack[stack.length - 1]?.get();
  if (!top) return false;
  if (action === 'undo' ? top.canUndo : top.canRedo) { if (action === 'undo') top.undo(); else top.redo(); }
  return true;
}

export interface Source { canUndo(): boolean; canRedo(): boolean; undo(): void; redo(): void; breakGroup(): void }
interface LogEntry { name: string }

/** Remembers WHICH source made each step. `note(name)` is called right BEFORE an edit of that source is applied. */
export function createSourceLog(sources: Record<string, Source>, opts: { gap?: number; now?: () => number } = {}) {
  const gap = opts.gap ?? 700, now = opts.now ?? Date.now;
  let past: LogEntry[] = [], future: LogEntry[] = [], at = 0;
  const usable = (list: LogEntry[], can: (s: Source) => boolean) => list.some((e) => sources[e.name] && can(sources[e.name]));
  return {
    note(name: string) {
      const t = now(), last = past[past.length - 1];
      const joined = !!last && last.name === name && t - at <= gap && future.length === 0;
      if (!joined) { sources[name]?.breakGroup(); if (last && last.name !== name) sources[last.name]?.breakGroup(); past = [...past, { name }]; future = []; }
      at = t;
    },
    canUndo: () => usable(past, (s) => s.canUndo()),
    canRedo: () => usable(future, (s) => s.canRedo()),
    undo(): boolean {
      while (past.length) {
        const e = past[past.length - 1]; past = past.slice(0, -1); const s = sources[e.name];
        if (!s || !s.canUndo()) continue;
        s.undo(); future = [...future, e]; at = 0; return true;
      }
      return false;
    },
    redo(): boolean {
      while (future.length) {
        const e = future[future.length - 1]; future = future.slice(0, -1); const s = sources[e.name];
        if (!s || !s.canRedo()) continue;
        s.redo(); past = [...past, e]; at = 0; return true;
      }
      return false;
    },
    size: () => ({ past: past.length, future: future.length }),
  };
}
