/** Undo / redo with coalescing: a burst of edits of the same control (a slider drag, typing) becomes ONE step. Pure. */
export interface Hist<T> { past: T[]; present: T; future: T[]; key: string; at: number }
export const LIMIT = 100;
export const COALESCE_MS = 700;
export const init = <T,>(v: T): Hist<T> => ({ past: [], present: v, future: [], key: '', at: 0 });
export function commit<T>(h: Hist<T>, next: T, key = '', now = Date.now(), same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)): Hist<T> {
  if (same(h.present, next)) return h;
  const merge = !!key && key === h.key && now - h.at < COALESCE_MS && h.past.length > 0;
  return { past: merge ? h.past : [...h.past, h.present].slice(-LIMIT), present: next, future: [], key, at: now };
}
export const canUndo = <T,>(h: Hist<T>) => h.past.length > 0;
export const canRedo = <T,>(h: Hist<T>) => h.future.length > 0;
export function undo<T>(h: Hist<T>): Hist<T> { if (!h.past.length) return h; const past = h.past.slice(0, -1); return { past, present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: '', at: 0 }; }
export function redo<T>(h: Hist<T>): Hist<T> { if (!h.future.length) return h; const [next, ...future] = h.future; return { past: [...h.past, h.present], present: next, future, key: '', at: 0 }; }
