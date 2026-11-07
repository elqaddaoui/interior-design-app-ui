import { useEffect } from 'react';
import { Platform } from 'react-native';
import { historyKeyAction } from '@/lib/draftHistory';
import { adminHistory } from '@/store/adminHistory';

/**
 * Ctrl/Cmd+Z = undo, Ctrl/Cmd+Y (or Ctrl/Cmd+Shift+Z) = redo for the admin's unsaved edits. Text fields keep their own native undo, and a page that
 * already handled the key itself (the logo editor has its own history) wins: the event is skipped when it was already `defaultPrevented`.
 * Mounted once, in the admin shell.
 */
export function useHistoryShortcuts() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const action = historyKeyAction(e);
      if (!action) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (action === 'undo' ? !adminHistory.canUndo() : !adminHistory.canRedo()) return;
      e.preventDefault();
      if (action === 'undo') adminHistory.undo(); else adminHistory.redo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
