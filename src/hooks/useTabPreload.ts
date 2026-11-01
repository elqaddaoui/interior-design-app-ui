import { useEffect, useLayoutEffect, useRef } from 'react';
import { InteractionManager, Platform } from 'react-native';
import { useStore } from '@/store/useStore';
import { boot } from '@/lib/boot';

/**
 * Why this exists: the bottom-bar tabs are lazy (a screen is built the first time its tab is pressed). That keeps start-up cheap, but the
 * FIRST press on Explore / History / Assistant then pays for the whole screen at once (dozens of views, images, skeletons) right when the
 * person is waiting, while every later press only flips a flag. This hook builds the other tabs in the background instead, so the first
 * press is as cheap as the second one.
 *
 * It never competes with start-up or with the person:
 *  - it waits until the public content is in and the start-up loader is gone (Home's first pictures come first; capped, so a loader that never ends cannot block it), then a short grace period;
 *  - it builds ONE tab at a time, only when the JS thread is idle (requestIdleCallback on web, after interactions on native), with a pause between tabs;
 *  - it does nothing while the browser asks to save data, and stops the moment the tab bar unmounts.
 * A preloaded screen stays hidden and unfocused (cards, videos and animations of a hidden screen do not run); pressing its tab just shows it.
 */
const START_DELAY_MS = 1500;
const GAP_MS = 700;
/** Longest total wait for the start-up loader to disappear. */
const LOADER_WAIT_MS = 8000;

type Cancel = () => void;
/** Runs `job` when the thread is idle (never later than `timeout`). */
function whenIdle(job: () => void, timeout = 2500): Cancel {
  if (Platform.OS === 'web') {
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(job, { timeout });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = setTimeout(job, 50);
    return () => clearTimeout(id);
  }
  const task = InteractionManager.runAfterInteractions(job);
  return () => task.cancel();
}

const saveData = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !!(navigator as unknown as { connection?: { saveData?: boolean } }).connection?.saveData;

/** `names` = tab route names in the order to build them; `focused` = the tab on screen now (never preloaded). */
export function useTabPreload(navigation: { preload?: (name: string) => void }, names: readonly string[], focused: string) {
  const ready = useStore((s) => s.contentReady);
  const latest = useRef({ navigation, focused });
  useLayoutEffect(() => { latest.current = { navigation, focused }; });
  const key = names.join('|');
  useEffect(() => {
    if (!ready || saveData() || !latest.current.navigation.preload) return;
    let stopped = false;
    let cancel: Cancel = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = key.split('|');
    const startedAt = Date.now();
    const next = () => {
      if (stopped) return;
      // Home's first pictures have priority: wait for the start-up loader (checked twice a second, never longer than LOADER_WAIT_MS).
      if (!boot.isHidden() && Date.now() - startedAt < LOADER_WAIT_MS) { timer = setTimeout(next, 500); return; }
      const name = queue.shift();
      if (!name) return;
      // The person may have opened it meanwhile (then it is built already): skip it.
      if (name === latest.current.focused) { next(); return; }
      cancel = whenIdle(() => {
        if (stopped) return;
        try { latest.current.navigation.preload?.(name); } catch { /* a navigator without preload: the tab simply stays lazy */ }
        timer = setTimeout(next, GAP_MS);
      });
    };
    timer = setTimeout(next, START_DELAY_MS);
    return () => { stopped = true; cancel(); if (timer) clearTimeout(timer); };
  }, [ready, key]);
}
