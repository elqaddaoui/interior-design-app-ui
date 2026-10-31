import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Easing, cancelAnimation, useDerivedValue, useFrameCallback, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { FX_FADE, FX_PING_PONG, TR_BASE, activeEffects, loopSeconds, timeline, type ResolvedFx } from '@/lib/toolCards';
import { reportLowFps, useAnimSlot, useOnScreen, useSimpleMotion } from '@/lib/toolCardPerf';
import { Effect, Photo, ownsBase, type FxCtx } from './effects';

/** First effect id after `id` in the ascending `list` (wraps around). */
const nextIn = (list: number[], id: number) => list.find((x) => x > id) ?? list[0] ?? 0;

/**
 * The image zone of a tools card (media type "slideshow"): BEFORE photo as base, AFTER photo as the animated top layer.
 *
 * Loop (tr = 1.6s / speed): hold before (pause) -> reveal (tr) -> hold after (pause) -> reverse (tr), eased, repeating (exactly the reference file).
 * One shared value `phase` (0..1, linear) runs the whole loop on the UI thread; p (reveal) and b (sparkle bump) derive from it.
 *
 * Pictures:  1 = static picture.  2 = before / after, played forward and back.
 *            3+ = a chain: every loop is "hold, reveal" and the picture just revealed becomes the next BEFORE, so the slideshow never jumps.
 * At the end of every loop the next kept effect (Multiple mode) and the next picture take over, in a hold, so the change is seamless.
 *
 * Only the loop's own inputs restart it (effects, pause, speed, pictures, visibility). The stage size lives in shared values:
 * resizing the card (global height) never restarts the loop and never reloads an image.
 */
export function CardStage({ id, images, fx, rtl, force, onReady, onEffect, style }: {
  id: string; images: string[]; fx: ResolvedFx; rtl: boolean;
  /** Admin preview: always animates and does not use one of the 2 animation slots. */
  force?: boolean; onReady?: () => void;
  /** Reports the effect now playing (0 = static AFTER image); the admin status line shows it. */
  onEffect?: (effect: number) => void; style?: StyleProp<ViewStyle>;
}) {
  const box = useRef<View>(null);
  const { near, visible } = useOnScreen(box);
  const slot = useAnimSlot(id, visible, force);
  // The admin preview always shows the configured effects, so it ignores the low-end / low-FPS fallback (the app's cards obey it).
  const lowMotion = useSimpleMotion();
  const simple = lowMotion && !force;

  // Effects played: the kept ones (Multiple), the chosen one (Single), or only the plain fade (reduced motion / low-end / low FPS).
  const list = useMemo(() => (simple ? [FX_FADE] : activeEffects(fx)), [simple, fx]);
  const listKey = list.join(',');
  const [fxId, setFxId] = useState(0);
  const [pairIdx, setPairIdx] = useState(0);
  const [tick, setTick] = useState(0);
  const cur = list.length ? (list.includes(fxId) ? fxId : nextIn(list, fxId)) : 0;
  const count = images.length;
  const ping = cur === FX_PING_PONG;
  // 3+ pictures play as a chain (see above), except the ping-pong effect, which returns to its start and so steps to the next pair instead.
  const chain = count >= 3 && !ping;
  // 2 pictures: always (first, second). 3+: (n, n+1) stepping one picture per loop.
  const at = count < 2 ? 0 : count === 2 ? 0 : pairIdx % count;
  const before = images[at];
  const after = images[count < 2 ? 0 : count === 2 ? 1 : (at + 1) % count];
  const pair = useMemo(() => (count === 0 ? undefined : { before, after }), [count, before, after]);
  // Static pictures (no effect, off-screen, beyond the 2 animation slots): the AFTER picture.
  const still = images[Math.min(1, Math.max(0, count - 1))];

  const W = useSharedValue(0);
  const H = useSharedValue(0);
  const phase = useSharedValue(0);
  const tr = TR_BASE / fx.speed;
  const pause = fx.pause;
  const loopMs = Math.round(loopSeconds(tr, pause, ping, chain) * 1000);
  const pb = useDerivedValue(() => timeline(phase.value, tr, pause, ping, chain), [tr, pause, ping, chain]);
  const p = useDerivedValue(() => pb.value[0], []);
  const b = useDerivedValue(() => pb.value[1], []);

  // Nothing kept = static AFTER image. Cards beyond the 2 animation slots (or off-screen) also show the static AFTER image.
  const animate = slot && cur > 0 && count > 1;

  const shown = animate ? cur : 0;
  useEffect(() => { onEffect?.(shown); }, [shown, onEffect]);

  // End of a loop: next kept effect + next pair. Read through a ref (set after render) so the running timing callback never goes stale.
  const nextLoop = useRef<() => void>(() => {});
  useLayoutEffect(() => { nextLoop.current = () => { setFxId(nextIn(list, cur)); setPairIdx((i) => i + 1); setTick((t) => t + 1); }; });
  const advance = useCallback(() => nextLoop.current(), []);
  useEffect(() => {
    if (!animate) { cancelAnimation(phase); phase.set(0); return; }
    phase.set(0);
    phase.set(withTiming(1, { duration: loopMs, easing: Easing.linear }, (done) => { if (done) scheduleOnRN(advance); }));
    return () => cancelAnimation(phase);
  }, [animate, cur, loopMs, tick, listKey, phase, advance]);

  // Preload the pictures that come next while this loop plays (and all of them once, for a short slideshow).
  useEffect(() => {
    if (count < 2) return;
    const upcoming = [1, 2].map((k) => images[(pairIdx + k) % count]);
    void Image.prefetch(upcoming, 'memory-disk').catch(() => {});
  }, [pairIdx, count, images]);

  // Frame-rate watchdog: three consecutive windows of 60 frames under 30 FPS switch every card to the simple fade.
  const acc = useSharedValue(0);
  const frames = useSharedValue(0);
  const slow = useSharedValue(0);
  const watchdog = useFrameCallback((info) => {
    const dt = info.timeSincePreviousFrame;
    if (dt == null || dt > 500) return; // first frame / a stall (tab hidden): not a measurement
    acc.value += dt; frames.value += 1;
    if (frames.value < 60) return;
    slow.value = acc.value / frames.value > 1000 / 30 ? slow.value + 1 : 0;
    acc.value = 0; frames.value = 0;
    if (slow.value >= 3) scheduleOnRN(reportLowFps);
  }, false);
  const measuring = animate && !force && !simple;
  useEffect(() => { watchdog.setActive(measuring); }, [measuring, watchdog]);

  // The first picture on screen reports "painted" once (the startup loader waits for the first cards).
  const ready = useRef(onReady);
  useLayoutEffect(() => { ready.current = onReady; });
  const painted = useRef(false);
  const reportReady = useCallback(() => { if (!painted.current) { painted.current = true; ready.current?.(); } }, []);
  useEffect(() => { if (!pair) reportReady(); }, [pair, reportReady]);

  const ctx: FxCtx | null = pair ? { W, H, p, b, rtl, before: pair.before, after: pair.after, flash: !simple } : null;

  return (
    <View ref={box} style={[styles.box, style]} onLayout={(e) => { W.set(e.nativeEvent.layout.width); H.set(e.nativeEvent.layout.height); }}>
      {/* Mirrored in RTL as one piece (wipes, stars, lines); every photo un-mirrors itself. */}
      {near && pair && ctx ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, rtl ? { transform: [{ scaleX: -1 }] } : null]}>
          {animate ? (
            <>
              {ownsBase(cur) ? null : <Photo uri={pair.before} rtl={rtl} onLoad={reportReady} />}
              <Effect id={cur} c={ctx} onBaseLoad={reportReady} />
            </>
          ) : (
            <Photo uri={still} rtl={rtl} onLoad={reportReady} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ box: { overflow: 'hidden' } });
