/**
 * Runtime guards of the animated home cards.
 *  - VISIBILITY: every card with ANY part on screen animates (even a few pixels); cards outside the viewport, other tabs (screen not focused)
 *    and a backgrounded app pause (pause = hold: no timer, no transition), which is what saves the CPU on phones.
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

/* ------------------------------ visibility measurement ------------------------------ */
const NEAR_MARGIN = 300;
/** Native polling period for the on-screen check (cheap: one measure per card). Short, so a card that has just entered starts quickly. */
const POLL_MS = 250;

/**
 * `visible` = ANY part of the card (even a few pixels) is on screen, the app is in the foreground and the screen is focused.
 *             Every visible card animates; a card outside the viewport does not (no timer, no transition: nothing runs, to save the CPU).
 * `near`    = within 300px of the viewport: images start loading (lazy loading).
 * Web uses IntersectionObserver (two thresholds: 0 and a tiny one, so one pixel of overlap already counts; edges that only touch do not).
 * Native measures the card in the window (this home list is a plain ScrollView, so FlatList's onViewableItemsChanged does not exist here).
 * There is no contest between cards any more: the old "only the most visible card animates" rule is gone.
 */
export function useOnScreen(ref: RefObject<View | null>) {
  const focused = useIsFocused();
  const [state, setState] = useState({ shown: false, near: Platform.OS !== 'web' });
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
      if (!element || typeof IntersectionObserver === 'undefined') { setState({ shown: true, near: true }); return; }
      const a = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        const shown = entry.isIntersecting && entry.intersectionRatio > 0;
        setState((old) => (old.shown === shown ? old : { ...old, shown }));
      }, { threshold: [0, 0.001] });
      const b = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        setState((old) => (old.near === entry.isIntersecting ? old : { ...old, near: entry.isIntersecting }));
      }, { rootMargin: `${NEAR_MARGIN}px`, threshold: 0.01 });
      a.observe(element); b.observe(element);
      return () => { a.disconnect(); b.disconnect(); };
    }
    const poll = () => ref.current?.measureInWindow((_x, y, _w, h) => {
      const screenH = Dimensions.get('window').height;
      const shown = h > 0 && y < screenH && y + h > 0;
      const near = h > 0 && y + h > -NEAR_MARGIN && y < screenH + NEAR_MARGIN;
      setState((old) => (old.shown === shown && old.near === near ? old : { shown, near }));
    });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [ref]);
  return { visible: state.shown && focused && foreground, near: state.near };
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
