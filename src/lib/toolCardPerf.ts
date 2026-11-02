/**
 * Runtime guards of the animated home cards.
 *  - VISIBILITY: every card reports how much of it is on screen; only the MOST visible card animates, the others show a still image.
 *    Off-screen cards, other tabs (screen not focused) and a backgrounded app report 0 and therefore pause (pause = hold).
 *  - LOW-END: low memory, an old device year class (expo-device), reduce-motion, or a device that janked during a transition
 *    (runtime guard, persisted) -> only effects allowed on low-end devices are played, else the cross-fade; extras are skipped.
 *  - DEV LOG: image load state and dropped frames (development builds only).
 */
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { AppState, Dimensions, Platform, type View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import * as Device from 'expo-device';
import { storage } from '@/data/mock/storage';

/** Development-only log (image load state, dropped frames). Silent in production. */
export function fxLog(...args: unknown[]) {
  if (__DEV__) console.log('[toolcard]', ...args);
}

/* ------------------------------ most visible card ------------------------------ */
const ratios = new Map<string, number>();
let winner: string | null = null;
const winListeners = new Set<() => void>();
/** The current leader keeps its place unless another card is clearly more visible (no flip-flop between two equal cards). */
const SWITCH_MARGIN = 0.1;

function recompute() {
  let best: string | null = null;
  let bestRatio = 0;
  // Map keeps insertion order: on a tie the card that registered first wins.
  ratios.forEach((r, id) => { if (r > bestRatio + 1e-6) { best = id; bestRatio = r; } });
  const current = winner ? ratios.get(winner) ?? 0 : 0;
  const next = !best ? null : winner && current > 0 && bestRatio - current < SWITCH_MARGIN ? winner : best;
  if (next !== winner) { winner = next; winListeners.forEach((fn) => fn()); }
}

/** A card reports the share (0..1) of itself that is visible. 0 removes it from the contest. */
function reportVisibility(id: string, ratio: number) {
  if (ratio <= 0) { if (!ratios.delete(id)) return; } else if (ratios.get(id) === ratio) return; else ratios.set(id, ratio);
  recompute();
}

/** True while this card is the most visible one on screen. */
export function useIsMostVisible(id: string): boolean {
  return useSyncExternalStore(
    (fn) => { winListeners.add(fn); return () => { winListeners.delete(fn); }; },
    () => winner === id,
    () => false,
  );
}

/* ------------------------------ visibility measurement ------------------------------ */
const NEAR_MARGIN = 300;
/** Native polling period for the on-screen check (cheap: one measure per card). */
const POLL_MS = 500;
const STEPS = Array.from({ length: 21 }, (_, i) => i / 20);

/**
 * `visible` = part of the card is on screen, the app is in the foreground and the screen is focused.
 * `near` = within 300px of the viewport: images start loading (lazy loading).
 * With `register`, the card also takes part in the "most visible card" contest (the admin preview does not: it always animates).
 * Web uses IntersectionObserver (visible ratio); native measures the card in the window (this home list is a plain ScrollView, so
 * FlatList's onViewableItemsChanged does not exist here: this is the same signal, with a ratio).
 */
export function useOnScreen(ref: RefObject<View | null>, id: string, register = true) {
  const focused = useIsFocused();
  const [state, setState] = useState({ ratio: 0, near: Platform.OS !== 'web' });
  const [foreground, setForeground] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const sync = () => setForeground(!document.hidden);
      document.addEventListener('visibilitychange', sync);
      sync();
      return () => document.removeEventListener('visibilitychange', sync);
    }
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const element = ref.current as unknown as Element | null;
      if (!element || typeof IntersectionObserver === 'undefined') { setState({ ratio: 1, near: true }); return; }
      const a = new IntersectionObserver(([entry]) => {
        const ratio = Math.round(entry.intersectionRatio * 20) / 20;
        setState((old) => (old.ratio === ratio ? old : { ...old, ratio }));
      }, { threshold: STEPS });
      const b = new IntersectionObserver(([entry]) => setState((old) => (old.near === entry.isIntersecting ? old : { ...old, near: entry.isIntersecting })), { rootMargin: `${NEAR_MARGIN}px`, threshold: 0.01 });
      a.observe(element); b.observe(element);
      return () => { a.disconnect(); b.disconnect(); };
    }
    const poll = () => ref.current?.measureInWindow((_x, y, _w, h) => {
      const screenH = Dimensions.get('window').height;
      const shown = h > 0 ? Math.max(0, Math.min(screenH, y + h) - Math.max(0, y)) / h : 0;
      const ratio = Math.round(shown * 20) / 20;
      const near = h > 0 && y + h > -NEAR_MARGIN && y < screenH + NEAR_MARGIN;
      setState((old) => (old.ratio === ratio && old.near === near ? old : { ratio, near }));
    });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [ref]);
  const ratio = focused && foreground ? state.ratio : 0;
  useEffect(() => {
    if (!register) return;
    reportVisibility(id, ratio);
    return () => reportVisibility(id, 0);
  }, [id, ratio, register]);
  return { visible: ratio > 0, near: state.near };
}

/* ------------------------------ low-end detection ------------------------------ */
const GB = 1024 * 1024 * 1024;
/** Device year class at or below this = an old phone (Android only: expo-device returns null elsewhere). */
const OLD_YEAR_CLASS = 2017;
/** Total RAM at or below this = a low-memory phone (a "4 GB" phone reports ~3.7 GB, a "3 GB" phone ~2.8 GB). */
const LOW_MEMORY = 3.5 * GB;

/** Static signals, read once: low memory or an old device year class (web: few cores / little memory). */
const lowEndDevice = (() => {
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined') return false;
    const n = navigator as Navigator & { deviceMemory?: number };
    return (n.deviceMemory !== undefined && n.deviceMemory <= 2) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 2);
  }
  const memory = Device.totalMemory;
  const year = Device.deviceYearClass;
  return (memory != null && memory <= LOW_MEMORY) || (year != null && year <= OLD_YEAR_CLASS);
})();

const STORE_KEY = 'fxLowEnd';
let sessionLowEnd = false;
const lowListeners = new Set<() => void>();
/** The runtime verdict of an earlier session is restored at startup (persisted by markLowEnd). */
void storage.read<boolean>(STORE_KEY).then((v) => { if (v && !sessionLowEnd) { sessionLowEnd = true; lowListeners.forEach((fn) => fn()); } });

/** Runtime guard: this device janked during a transition. Persisted, so the next launch starts in low-end mode. */
export function markLowEnd(reason = 'slow frames') {
  if (sessionLowEnd) return;
  sessionLowEnd = true;
  fxLog('device marked low-end:', reason);
  void storage.write(STORE_KEY, true);
  lowListeners.forEach((fn) => fn());
}

/** Forget the runtime verdict (admin "reset detection"). */
export function resetLowEnd() {
  sessionLowEnd = false;
  void storage.write(STORE_KEY, false);
  lowListeners.forEach((fn) => fn());
}

/** Why this phone is (or is not) treated as low-end. */
export function lowEndReason(reduced: boolean): 'reduceMotion' | 'device' | 'measured' | null {
  return reduced ? 'reduceMotion' : lowEndDevice ? 'device' : sessionLowEnd ? 'measured' : null;
}

/** True when this device must play low-end rules: low memory / old device / reduce-motion / measured jank. */
export function useLowEnd(): boolean {
  const reduced = useReducedMotion();
  const measured = useSyncExternalStore(
    (fn) => { lowListeners.add(fn); return () => { lowListeners.delete(fn); }; },
    () => sessionLowEnd,
    () => false,
  );
  return reduced || lowEndDevice || measured;
}
