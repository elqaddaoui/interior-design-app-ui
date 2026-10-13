import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, Platform, View } from 'react-native';
import { router as expoRouter, useRouter as useExpoRouter, useIsFocused } from 'expo-router';
import { usePreventRemove, useNavigation } from 'expo-router/react-navigation';
import { create } from 'zustand';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { toast } from '@/store/useToast';

type Guard = { save: () => Promise<boolean | void>; discard: () => void };
const guards = new Map<symbol, Guard>();
const dialog = create<{ pending: (() => void) | null }>(() => ({ pending: null }));
let bypass = false;
/** All app navigation goes through the same guard, including non-route actions (logout). */
export function requestLeave(action: () => void) {
  if (bypass || !guards.size) {
    if (Platform.OS === 'web') window.dispatchEvent(new Event('dwira:before-navigation'));
    action();
  }
  else if (!dialog.getState().pending) dialog.setState({ pending: action });
}
export const router = {
  ...expoRouter,
  push: (...args: Parameters<typeof expoRouter.push>) => requestLeave(() => expoRouter.push(...args)),
  replace: (...args: Parameters<typeof expoRouter.replace>) => requestLeave(() => expoRouter.replace(...args)),
  back: () => requestLeave(() => { if (expoRouter.canGoBack()) expoRouter.back(); }),
  dismiss: (...args: Parameters<typeof expoRouter.dismiss>) => requestLeave(() => expoRouter.dismiss(...args)),
  dismissAll: () => requestLeave(() => expoRouter.dismissAll()),
  dismissTo: (...args: Parameters<typeof expoRouter.dismissTo>) => requestLeave(() => expoRouter.dismissTo(...args)),
};
export function useRouter() { useExpoRouter(); return router; }

export function useLeaveGuard(dirty: boolean, save: Guard['save'], discard: Guard['discard']) {
  const focused = useIsFocused();
  const navigation = useNavigation();
  const ref = useRef({ save, discard });
  useLayoutEffect(() => { ref.current = { save, discard }; });
  useEffect(() => {
    if (!dirty || !focused) return;
    const id = Symbol('draft');
    guards.set(id, { save: () => ref.current.save(), discard: () => ref.current.discard() });
    return () => { guards.delete(id); };
  }, [dirty, focused]);
  usePreventRemove(dirty && focused && Platform.OS !== 'web', ({ data }) => {
    requestLeave(() => navigation.dispatch(data.action));
  });
  useEffect(() => {
    if (!dirty || !focused || Platform.OS !== 'web') return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty, focused]);
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
  topCheckpoint()?.action();
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
  const pending = dialog((s) => s.pending);
  const [busy, setBusy] = useState(false);
  const resolve = async (save: boolean) => {
    setBusy(true);
    try {
      for (const guard of [...guards.values()]) {
        if (save) { if (await guard.save() === false) return; }
        else guard.discard();
      }
      dialog.setState({ pending: null });
      // Let guard/checkpoint cleanup run before replaying the requested action.
      setTimeout(() => { bypass = true; try { pending?.(); } finally { bypass = false; } }, 80);
    } catch { toast('Could not save changes. Your draft is still available.'); }
    finally { setBusy(false); }
  };
  if (!pending) return null;
  return <Sheet visible={!!pending} history={false} onClose={() => { if (!busy) dialog.setState({ pending: null }); }} title="Unsaved changes">
    <Txt testID="unsaved-message" className="font-bold text-[17px] mb-4">You have unsaved changes. Save or discard?</Txt>
    <View className="gap-2">
      <Button testID="unsaved-save" title="Save" loading={busy} onPress={() => resolve(true)} />
      <Button testID="unsaved-discard" title="Discard" variant="soft" disabled={busy} onPress={() => resolve(false)} />
      <Button testID="unsaved-cancel" title="Cancel" variant="ghost" disabled={busy} onPress={() => dialog.setState({ pending: null })} />
    </View>
  </Sheet>;
}
