/**
 * Performance guards for the animated home cards (slow phones).
 *  - At most MAX_ANIMATING cards animate at once (the first ones to become visible); the others show the static AFTER image.
 *  - Reduced motion, a low-end device or a measured frame rate below 30 FPS switch every card to the simple fade (effect 14, no flash).
 */
import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { AppState, Dimensions, Platform, type View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';

export const MAX_ANIMATING = 2;

/* ---- animation slots ---- */
const visibleIds: string[] = [];
const slotListeners = new Set<() => void>();
const emitSlots = () => slotListeners.forEach((fn) => fn());

/**
 * True while this card may animate. Only cards that are on screen take a slot; the first MAX_ANIMATING keep it until they leave.
 * `force` (the admin preview) always animates and never uses up a slot.
 */
export function useAnimSlot(id: string, onScreen: boolean, force = false): boolean {
  useEffect(() => {
    if (!onScreen || force) return;
    visibleIds.push(id);
    emitSlots();
    return () => { const i = visibleIds.indexOf(id); if (i >= 0) visibleIds.splice(i, 1); emitSlots(); };
  }, [id, onScreen, force]);
  const slot = useSyncExternalStore(
    (fn) => { slotListeners.add(fn); return () => { slotListeners.delete(fn); }; },
    () => visibleIds.indexOf(id) >= 0 && visibleIds.indexOf(id) < MAX_ANIMATING,
    () => false,
  );
  return force ? onScreen : slot;
}

/* ---- visibility ---- */
const NEAR_MARGIN = 300;
/** Native polling period for the on-screen check (cheap: one measure per card). */
const POLL_MS = 700;

/**
 * `visible` = the card is on screen, the app is in the foreground and the screen is focused (animations run only then).
 * `near` = within 300px of the viewport: images start loading (lazy loading). Web uses IntersectionObserver; native measures the card.
 */
export function useOnScreen(ref: RefObject<View | null>) {
  const focused = useIsFocused();
  const [state, setState] = useState({ visible: false, near: Platform.OS !== 'web' });
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
      if (!element || typeof IntersectionObserver === 'undefined') { setState({ visible: true, near: true }); return; }
      const observe = (margin: string, key: 'visible' | 'near') => {
        const observer = new IntersectionObserver(([entry]) => setState((old) => (old[key] === entry.isIntersecting ? old : { ...old, [key]: entry.isIntersecting })), { rootMargin: margin, threshold: 0.01 });
        observer.observe(element);
        return observer;
      };
      const a = observe('0px', 'visible');
      const b = observe(`${NEAR_MARGIN}px`, 'near');
      return () => { a.disconnect(); b.disconnect(); };
    }
    const poll = () => ref.current?.measureInWindow((_x, y, _w, h) => {
      const screenH = Dimensions.get('window').height;
      const visible = h > 0 && y + h > 0 && y < screenH;
      const near = h > 0 && y + h > -NEAR_MARGIN && y < screenH + NEAR_MARGIN;
      setState((old) => (old.visible === visible && old.near === near ? old : { visible, near }));
    });
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [ref]);
  return { visible: state.visible && focused && foreground, near: state.near };
}

/* ---- low FPS / low-end ---- */
let lowFps = false;
const perfListeners = new Set<() => void>();
/** Called by an animating card when its measured frame rate stayed under 30 FPS: every card falls back to the fade. */
export function reportLowFps() { if (!lowFps) { lowFps = true; perfListeners.forEach((fn) => fn()); } }

/** Small devices: few CPU cores or little memory (web only; the native signal is the measured frame rate). */
const lowEndDevice = (() => {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.deviceMemory !== undefined && n.deviceMemory <= 2) || (n.hardwareConcurrency !== undefined && n.hardwareConcurrency <= 2);
})();

/** True when cards must use the simple fade instead of the 20 effects. */
export function useSimpleMotion(): boolean {
  const reduced = useReducedMotion();
  const slow = useSyncExternalStore(
    (fn) => { perfListeners.add(fn); return () => { perfListeners.delete(fn); }; },
    () => lowFps,
    () => false,
  );
  return reduced || slow || lowEndDevice;
}
