import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, Platform } from 'react-native';
import { router as expoRouter, useRouter as useExpoRouter, useIsFocused } from 'expo-router';
import { usePreventRemove, useNavigation } from 'expo-router/react-navigation';
import { create } from 'zustand';
import { LeaveDialog } from '@/components/LeaveDialog';
import i18n, { useT } from '@/i18n';
import { changes, type Change } from '@/lib/changes';
import { describeChange, uniqueChanges } from '@/lib/changeLabels';
import { toast } from '@/store/useToast';
import { currentPath, parentRoute, TAB_ROOTS } from '@/lib/route';

type Guard = { save: () => Promise<boolean | void>; discard: () => void; changes?: () => Change[]; allow?: (destination?: string) => boolean };
export type DraftDetails = { before: unknown; after: unknown; labels?: Record<string, string>; secrets?: string[] };
let exitHandler: ((action: () => void) => void) | null = null;
export function registerAppExit(handler: typeof exitHandler) { exitHandler = handler; return () => { if (exitHandler === handler) exitHandler = null; }; }
export function requestAppExit(action: () => void) { if (exitHandler) exitHandler(action); else action(); }
const destinationOf = (href: unknown) => {
  if (typeof href === 'string') return href;
  const value = href as { pathname?: string; params?: Record<string, string> };
  if (value.pathname === '/tool/[id]') return `/tool/${value.params?.id}?forward=${value.params?.forward || '0'}`;
  if (value.pathname === '/pro' && value.params?.generation === '1') return '/pro?generation=1';
  return value.pathname;
};
const exitAware = (href: unknown, action: () => void) => {
  const value = typeof href === 'string' ? href : (href as { pathname?: string })?.pathname;
  if (value?.startsWith('/admin') || /^(https?:|mailto:|tel:)/.test(value ?? '')) requestAppExit(action); else action();
};
const guards = new Map<symbol, Guard>();
const dialog = create<{ pending: (() => void) | null; resolving: boolean }>(() => ({ pending: null, resolving: false }));
let bypass = false;
/** All app navigation goes through the same guard, including non-route actions (logout). */
export function requestLeave(action: () => void, destination?: string) {
  if (bypass || !guards.size || [...guards.values()].every(guard => guard.allow?.(destination))) {
    if (Platform.OS === 'web') window.dispatchEvent(new Event('dwira:before-navigation'));
    action();
  }
  else if (!dialog.getState().pending) dialog.setState({ pending: action });
}
/** Consume the synthetic checkpoint BEFORE Expo writes a new history entry. */
function navigate(action: () => void) {
  if (Platform.OS === 'web' && checkpointMarker && window.history.state?.dwiraCheckpoint === checkpointMarker) {
    checkpointMarker = null;
    window.removeEventListener('popstate', handleCheckpointPop, true);
    const resume = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      window.removeEventListener('popstate', resume, true);
      action();
    };
    window.addEventListener('popstate', resume, true);
    window.history.back();
  } else action();
}
let nativeDestination: string | undefined;
function navigateTo(href: unknown, action: () => void) {
  const destination = destinationOf(href);
  requestLeave(() => navigate(() => {
    nativeDestination = destination;
    action();
    setTimeout(() => { nativeDestination = undefined; }, 250);
  }), destination);
}
/** Back on a page that was opened directly (shared link, notification, reload): there is no in-app stack to pop. */
/** True when the page before this one in the browser history belongs to the app (never an external site or blank tab). */
function cameFromApp() {
  try { return !!document.referrer && new URL(document.referrer).origin === window.location.origin; } catch { return false; }
}

function backWithoutHistory() {
  const path = currentPath();
  // Bottom-bar roots keep the old behaviour: nothing to go back to inside the app.
  if (TAB_ROOTS.includes(path)) { requestAppExit(() => { if (Platform.OS !== 'web') BackHandler.exitApp(); }); return; }
  // Web: return to the page the visitor came from (previous site, chat, search...).
  if (Platform.OS === 'web' && window.history.length > 1 && cameFromApp()) { window.history.back(); return; }
  // Native, or a fresh tab: land on the logical parent instead of leaving the user stuck.
  expoRouter.replace(parentRoute(path) as never);
}
export const router = {
  ...expoRouter,
  navigate: (...args: Parameters<typeof expoRouter.navigate>) => navigateTo(args[0], () => exitAware(args[0], () => expoRouter.navigate(...args))),
  push: (...args: Parameters<typeof expoRouter.push>) => navigateTo(args[0], () => exitAware(args[0], () => expoRouter.push(...args))),
  replace: (...args: Parameters<typeof expoRouter.replace>) => navigateTo(args[0], () => exitAware(args[0], () => expoRouter.replace(...args))),
  back: () => {
    if (dialog.getState().pending) { dialog.setState({ pending: null }); return; }
    const overlay = topCheckpoint();
    if (overlay && overlay.priority > 0) { overlay.action(); return; }
    requestLeave(() => { if (expoRouter.canGoBack()) expoRouter.back(); else backWithoutHistory(); });
  },
  dismiss: (...args: Parameters<typeof expoRouter.dismiss>) => requestLeave(() => navigate(() => expoRouter.dismiss(...args))),
  dismissAll: () => requestLeave(() => navigate(() => expoRouter.dismissAll())),
  dismissTo: (...args: Parameters<typeof expoRouter.dismissTo>) => requestLeave(() => navigate(() => expoRouter.dismissTo(...args))),
};
export function useRouter() { useExpoRouter(); return router; }

/** Native stack gestures must dismiss an overlay rather than remove its parent route. */
export function useNativeOverlayBack(active: boolean, onBack: () => void) {
  const focused = useIsFocused();
  usePreventRemove(active && focused && Platform.OS !== 'web', () => onBack());
}

export function useLeaveGuard(dirty: boolean, save: Guard['save'], discard: Guard['discard'], details?: DraftDetails, allow?: Guard['allow']) {
  const resolving = dialog(s => s.resolving);
  const focused = useIsFocused();
  const navigation = useNavigation();
  const ref = useRef({ save, discard, details, allow });
  useLayoutEffect(() => { ref.current = { save, discard, details, allow }; });
  useEffect(() => {
    if (!dirty || !focused) return;
    const id = Symbol('draft');
    guards.set(id, { allow: destination => ref.current.allow?.(destination) ?? false, save: () => ref.current.save(), discard: () => ref.current.discard(), changes: () => {
      const value = ref.current.details;
      return value ? changes(value.before, value.after).map(change => ({ ...change, label: value.labels?.[change.path] ?? value.labels?.[change.path.split('.')[0]], secret: value.secrets?.some(key => change.path === key || change.path.startsWith(`${key}.`)) })) : [];
    } });
    return () => { guards.delete(id); };
  }, [dirty, focused]);
  usePreventRemove(dirty && focused && !resolving && Platform.OS !== 'web', ({ data }) => {
    const destination = ['REPLACE', 'PUSH', 'NAVIGATE'].includes(data.action.type) ? nativeDestination : undefined;
    nativeDestination = undefined;
    requestLeave(() => {
      // Native remove guards must observe the released state before replay.
      dialog.setState({ resolving: true });
      setTimeout(() => { navigation.dispatch(data.action); setTimeout(() => dialog.setState({ resolving: false }), 100); }, 80);
    }, destination);
  });
  useEffect(() => {
    if (!dirty || !focused || resolving || Platform.OS !== 'web') return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, focused, resolving]);
}

/** A history checkpoint prevents browser Back from unmounting a dirty screen.
 * It is also used by sheets, so browser/mobile-web Back closes the top overlay first.
 */
const checkpoints = new Map<symbol, { action: () => void; priority: number }>();
const topCheckpoint = () => [...checkpoints.values()].sort((a, b) => a.priority - b.priority).at(-1);
let hardwareBack: ReturnType<typeof BackHandler.addEventListener> | null = null;
let checkpointMarker: string | null = null;
function handleCheckpointPop(event: PopStateEvent) {
  if (!checkpoints.size || !checkpointMarker) return;
  event.stopImmediatePropagation();
  window.history.pushState({ ...window.history.state, dwiraCheckpoint: checkpointMarker }, '', window.location.href);
  if (dialog.getState().pending) dialog.setState({ pending: null });
  else topCheckpoint()?.action();
}
export function useBackCheckpoint(active: boolean, onBack: () => void, priority = 0) {
  const latest = useRef(onBack);
  useLayoutEffect(() => { latest.current = onBack; });
  const focused = useIsFocused();
  useEffect(() => {
    if (!active || !focused) return;
    const id = Symbol('checkpoint');
    checkpoints.set(id, { action: () => latest.current(), priority });
    if (Platform.OS !== 'web') {
      if (!hardwareBack) hardwareBack = BackHandler.addEventListener('hardwareBackPress', () => { topCheckpoint()?.action(); return true; });
      return () => { checkpoints.delete(id); if (!checkpoints.size) { hardwareBack?.remove(); hardwareBack = null; } };
    }
    if (!checkpointMarker) {
      checkpointMarker = `checkpoint-${Date.now()}`;
      window.history.pushState({ ...window.history.state, dwiraCheckpoint: checkpointMarker }, '', window.location.href);
      window.addEventListener('popstate', handleCheckpointPop, true);
    }
    return () => {
      checkpoints.delete(id);
      if (checkpoints.size) return;
      const marker = checkpointMarker; checkpointMarker = null;
      window.removeEventListener('popstate', handleCheckpointPop, true);
      if (window.history.state?.dwiraCheckpoint === marker) {
        const swallow = (event: PopStateEvent) => { event.stopImmediatePropagation(); window.removeEventListener('popstate', swallow, true); };
        window.addEventListener('popstate', swallow, true);
        window.history.back();
      }
    };
  }, [active, focused, priority]);
}

export function UnsavedChangesHost() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const capture = () => window.dispatchEvent(new Event('dwira:before-navigation'));
    window.addEventListener('popstate', capture, true);
    return () => window.removeEventListener('popstate', capture, true);
  }, []);
  const { t, lang } = useT();
  const pending = dialog((s) => s.pending);
  const [busy, setBusy] = useState(false);
  const resolve = async (save: boolean) => {
    setBusy(true);
    try {
      for (const guard of [...guards.values()]) {
        if (save) { if (await guard.save() === false) return; }
        else guard.discard();
      }
      // Synchronously release all dirty guards before replaying navigation.
      guards.clear();
      dialog.setState({ pending: null, resolving: true });
      // Let guard/checkpoint cleanup run before replaying the requested action.
      setTimeout(() => { bypass = true; try { pending?.(); } finally { bypass = false; setTimeout(() => dialog.setState({ resolving: false }), 100); } }, 80);
    } catch { toast(t('improve.saveError')); }
    finally { setBusy(false); }
  };
  if (!pending) return null;
  const list = uniqueChanges([...guards.values()].flatMap((guard) => guard.changes?.() ?? []));
  const ctx = { lang, t: (k: string, o?: Record<string, unknown>) => String(t(k, o as never)), has: (k: string) => i18n.exists(k) };
  return <LeaveDialog visible={!!pending} changes={list.map((c) => describeChange(c, ctx))} canSave={list.length > 0} busy={busy}
    onSave={() => resolve(true)} onDiscard={() => resolve(false)} onStay={() => { if (!busy) dialog.setState({ pending: null }); }} />;
}
