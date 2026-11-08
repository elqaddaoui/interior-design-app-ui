import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { historyKeyAction } from '@/lib/draftHistory';
import { registerPopup, popupKeyAction, openPopups, type PopupApi } from '@/lib/popupHistory';
import * as H from '@/lib/brand/history';

/** Ctrl/Cmd+Z / Ctrl/Cmd+Y while a popup is open. Runs in the CAPTURE phase and calls preventDefault, so the admin-wide shortcut (which skips handled keys) leaves the page behind alone. Text fields keep their native undo. */
let installed = false;
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || !openPopups()) return;
  const action = historyKeyAction(e);
  if (!action) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
  if (popupKeyAction(action)) { e.preventDefault(); e.stopPropagation(); }
}
function install() {
  if (installed || Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  installed = true; window.addEventListener('keydown', onKey, true);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Undo / redo for a popup whose form lives in its own React state. OBSERVER style: the popup keeps its state exactly as before (`value`, and
 * the setter it already has as `apply`); this hook watches `value`, records each change (bursts within 700 ms = one step) and, on undo / redo,
 * puts the old snapshot back through `apply`.
 *  - `active`: the popup is open. Opening (false -> true, or a new `resetKey`) re-bases the history on the current value.
 */
export function usePopupHistory<T>(value: T, apply: (v: T) => void, opts: { active?: boolean; resetKey?: string | number } = {}): PopupApi {
  const active = opts.active ?? true;
  const [h, setH] = useState(() => H.init(value));
  const hr = useRef(h);
  const seen = useRef<{ active: boolean; key: string | number | undefined }>({ active: false, key: undefined });
  const applyRef = useRef(apply);
  // Keep the refs current after every render (never during render).
  useEffect(() => { hr.current = h; applyRef.current = apply; });
  useEffect(() => {
    if (!active) { seen.current = { active: false, key: opts.resetKey }; return; }
    if (!seen.current.active || seen.current.key !== opts.resetKey) { seen.current = { active: true, key: opts.resetKey }; setH(H.init(value)); return; }
    const cur = hr.current;
    if (!same(cur.present, value)) setH(H.commit(cur, value, 'e'));
  }, [active, value, opts.resetKey]);
  const undo = useCallback(() => { const cur = hr.current; if (!H.canUndo(cur)) return; const next = H.undo(cur); hr.current = next; setH(next); applyRef.current(next.present); }, []);
  const redo = useCallback(() => { const cur = hr.current; if (!H.canRedo(cur)) return; const next = H.redo(cur); hr.current = next; setH(next); applyRef.current(next.present); }, []);
  const breakGroup = useCallback(() => { hr.current = { ...hr.current, key: '', at: 0 }; setH((c) => ({ ...c, key: '', at: 0 })); }, []);
  const api = useMemo<PopupApi>(() => ({ canUndo: H.canUndo(h), canRedo: H.canRedo(h), undo, redo, breakGroup }), [h, undo, redo, breakGroup]);
  useRegisterPopup(active, api);
  return api;
}

/** Makes `api` the popup that owns the keyboard shortcuts while `active` (the last one registered = the topmost). */
export function useRegisterPopup(active: boolean, api: PopupApi) {
  const ref = useRef(api);
  useEffect(() => { ref.current = api; });
  useEffect(() => { if (!active) return; install(); return registerPopup(() => ref.current); }, [active]);
}

/** A popup shares its history with the popups it opens (the slideshow popup edits the form that opened it). */
export const PopupHistoryContext = createContext<PopupApi | null>(null);
export const usePopupHistoryContext = () => useContext(PopupHistoryContext);
