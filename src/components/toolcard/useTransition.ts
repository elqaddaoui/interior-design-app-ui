import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Easing, cancelAnimation, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { DROP_MS, FADE_CFG, SLOW_MS, type Cfg } from '@/lib/toolCardFx';
import { WARMUP_FRAMES } from '@/lib/deviceTier';

/** Frame statistics of one transition, measured on the UI thread (the first WARMUP_FRAMES frames are not counted). */
export interface PlayStats { frames: number; sumMs: number; dropped: number; slow: number }

/**
 * The shared values the animated styles read. ONLY plain shared values live here (never JS functions), so a worklet can capture the
 * whole object safely.
 *
 *  p        ONE progress value per card (0 -> 1, linear). Each effect shapes it with its own easing inside the animated styles.
 *  backIdx  index (0 / 1) of the layer that is currently BACK (the one that animates next).
 *  active   1 while a transition runs (the extras are visible only then).
 *  cfg0/1   per-layer effect configuration. A FRONT layer keeps the configuration it was revealed with, so its FULL state stays
 *           pixel-identical until it is hidden underneath; only the BACK layer is ever reconfigured.
 */
export interface FxValues {
  p: { value: number };
  backIdx: { value: number };
  active: { value: number };
  cfg0: { value: Cfg };
  cfg1: { value: Cfg };
}

/**
 * The animation driver of one card.
 *
 * When p reaches 1 the UI thread, in that same frame, flips `backIdx`, resets p to 0 and clears `active`: the layer that has just covered
 * the other one is FRONT (it keeps the identical FULL state) and the old FRONT is BACK at START, which is invisible. No frame ever shows
 * both layers partly visible, and the swap does not wait for a JS round trip. The JS thread is told afterwards (`play`'s callback) and
 * only then loads the image after next into the hidden layer.
 *
 * Frame times are measured while a transition runs (dropped / slow frames) for the runtime guard, the dev log and the admin benchmark.
 */
export function useTransition() {
  const p = useSharedValue(0);
  const backIdx = useSharedValue(1);
  const active = useSharedValue(0);
  const cfg0 = useSharedValue<Cfg>(FADE_CFG);
  const cfg1 = useSharedValue<Cfg>(FADE_CFG);
  const frames = useSharedValue(0);
  const sum = useSharedValue(0);
  const dropped = useSharedValue(0);
  const slow = useSharedValue(0);
  const done = useRef<((s: PlayStats) => void) | null>(null);

  const seen = useSharedValue(0);
  const meter = useFrameCallback((info) => {
    const dt = info.timeSincePreviousFrame;
    if (dt == null || dt > 500) return; // first frame / a stall (tab hidden): not a measurement
    // The first frames of a transition pay for layer raster and image upload: they say nothing about the device, so they are not counted.
    seen.value += 1;
    if (seen.value <= WARMUP_FRAMES) return;
    frames.value += 1; sum.value += dt;
    if (dt > DROP_MS) dropped.value += 1;
    if (dt > SLOW_MS) slow.value += 1;
  }, false);

  const finish = useCallback((f: number, s: number, d: number, sl: number) => {
    meter.setActive(false);
    const cb = done.current;
    done.current = null;
    cb?.({ frames: f, sumMs: s, dropped: d, slow: sl });
  }, [meter]);

  /** Sets the configuration of layer `idx`. Call it only while that layer is hidden (BACK, waiting). */
  const configure = useCallback((idx: 0 | 1, cfg: Cfg) => { (idx === 0 ? cfg0 : cfg1).set(cfg); }, [cfg0, cfg1]);

  /** Runs one transition of `ms` milliseconds on the BACK layer; `cb` runs on the JS thread once the roles have been swapped. */
  const play = useCallback((ms: number, cb: (s: PlayStats) => void) => {
    done.current = cb;
    frames.set(0); sum.set(0); dropped.set(0); slow.set(0); seen.set(0);
    active.set(1);
    meter.setActive(true);
    p.set(0);
    p.set(withTiming(1, { duration: Math.max(1, ms), easing: Easing.linear }, (fin) => {
      if (!fin) return;
      // Same UI-thread frame: BACK (now fully covering) becomes FRONT, the old FRONT goes back to START (hidden).
      backIdx.value = 1 - backIdx.value;
      p.value = 0;
      active.value = 0;
      scheduleOnRN(finish, frames.value, sum.value, dropped.value, slow.value);
    }));
  }, [p, backIdx, active, frames, sum, dropped, slow, seen, meter, finish]);

  /** Stops the animation and the meter (unmount). A mounted card never cancels mid-transition: it always runs to its end. */
  const cancel = useCallback(() => {
    cancelAnimation(p);
    meter.setActive(false);
    done.current = null;
  }, [p, meter]);

  // Cancel on unmount.
  useEffect(() => cancel, [cancel]);

  const v = useMemo<FxValues>(() => ({ p, backIdx, active, cfg0, cfg1 }), [p, backIdx, active, cfg0, cfg1]);
  return useMemo(() => ({ v, play, configure, cancel }), [v, play, configure, cancel]);
}
export type Driver = ReturnType<typeof useTransition>;
