/**
 * Runtime guards of the animated home cards.
 *  - VISIBILITY: every card reports how much of it is on screen; only the MOST visible card animates, the others show a still image.
 *    Off-screen cards, other tabs (screen not focused) and a backgrounded app report 0 and therefore pause (pause = hold).
 *  - LOW-END: see lib/deviceTier.ts. Preferences (reduce-motion, data saver) + hardware facts (RAM, 32-bit, old Android, web cores) +
 *    frame times measured on this very device (several transitions, warm-up excluded, expires after a week). A low-end device only plays
 *    the effects the admin allowed for it, else the cross-fade, and no extras.
 *  - DEV LOG: image load state and dropped frames (development builds only).
 */
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { AppState, Dimensions, Platform, type View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import * as Device from 'expo-device';
import { storage } from '@/data/mock/storage';
import { addOutcome, classifyDevice, judgeTransition, measuredVerdict, type DeviceClass, type DeviceSignals, type Evidence, type FrameStats, type Measured, type Outcome } from './deviceTier';

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

/* ------------------------------ device capability ------------------------------ */
/** Static hardware / browser facts, read once (they do not change while the app runs). `reducedMotion` is added live by the hook. */
function readSignals(): Omit<DeviceSignals, 'reducedMotion'> {
  if (Platform.OS === 'web') {
    const n = (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    return {
      platform: 'web',
      memoryBytes: typeof n.deviceMemory === 'number' ? n.deviceMemory * GB : null,
      cores: typeof n.hardwareConcurrency === 'number' ? n.hardwareConcurrency : null,
      apiLevel: null, is64bit: null, saveData: n.connection?.saveData === true,
    };
  }
  const archs = Device.supportedCpuArchitectures;
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    memoryBytes: Device.totalMemory ?? null,
    cores: null,
    apiLevel: Platform.OS === 'android' ? Device.platformApiLevel ?? null : null,
    // Every iPhone that runs this app is 64-bit; on Android a phone that lists no 64-bit ABI is a 2013-2017 device.
    is64bit: Platform.OS === 'ios' ? true : archs && archs.length ? archs.some((a) => /64/.test(a)) : null,
    saveData: false,
  };
}
const GB = 1024 * 1024 * 1024;
const staticSignals = readSignals();

const STORE_KEY = 'fxEvidence';
let evidence: Evidence | null = null;
const lowListeners = new Set<() => void>();
const notify = () => lowListeners.forEach((fn) => fn());
/** Evidence of an earlier session is restored at startup; it is only used while it is less than a week old. */
void storage.read<Evidence>(STORE_KEY).then((v) => {
  if (v && Array.isArray(v.runs) && typeof v.at === 'number' && !evidence) { evidence = { at: v.at, runs: v.runs.filter((r) => typeof r === 'boolean') }; notify(); }
});
// The previous version stored a permanent boolean verdict that wrongly condemned healthy phones: forget it.
void storage.write('fxLowEnd', false);

/** Verdict of the measurements (a primitive: safe as a useSyncExternalStore snapshot). */
const measuredNow = (): Measured => measuredVerdict(evidence, Date.now());

/** Records the frame times of one transition played on this device (never the admin preview; see `shouldRecord`). */
export function recordTransition(stats: FrameStats): Outcome {
  const outcome = judgeTransition(stats);
  if (outcome === 'skip') return outcome;
  const before = measuredNow();
  evidence = addOutcome(evidence, outcome, Date.now());
  void storage.write(STORE_KEY, evidence);
  fxLog(`transition judged ${outcome} (${stats.frames} frames, avg ${(stats.sumMs / Math.max(1, stats.frames)).toFixed(1)} ms, ${stats.slow} slow) -> device ${measuredNow()}`);
  if (measuredNow() !== before) notify();
  return outcome;
}

/** Forget what was measured (admin "reset detection"): the device is classified from its hardware again. */
export function resetLowEnd() {
  evidence = null;
  void storage.write(STORE_KEY, null);
  notify();
}

/** Full classification of this device: verdict, reason, whether measurement can still change it, measured state. */
export function useDeviceClass(): DeviceClass {
  const reduced = useReducedMotion();
  const measured = useSyncExternalStore(
    (fn) => { lowListeners.add(fn); return () => { lowListeners.delete(fn); }; },
    measuredNow,
    () => 'unknown' as Measured,
  );
  return classifyDevice({ ...staticSignals, reducedMotion: reduced }, measured);
}

/** True when this device must play the low-end rules. */
export const useLowEnd = (): boolean => useDeviceClass().low;

/** Raw facts shown to the admin on the "device" line. */
export const deviceFacts = () => ({
  platform: staticSignals.platform,
  memoryGB: staticSignals.memoryBytes == null ? null : Math.round((staticSignals.memoryBytes / GB) * 10) / 10,
  api: staticSignals.apiLevel,
  cores: staticSignals.cores,
});
