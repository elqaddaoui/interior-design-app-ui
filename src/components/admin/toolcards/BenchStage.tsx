import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, View } from 'react-native';
import { FX, TR_BASE, makeCfg, verdictOf, type Verdict } from '@/lib/toolCardFx';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { RevealStack } from '@/components/toolcard/RevealStack';
import { useTransition, type PlayStats } from '@/components/toolcard/useTransition';

export interface BenchResult { avgMs: number; dropped: number; frames: number; verdict: Verdict }
const RUNS = 3;
/** Sample card: small and fixed, so the admin compares effects under the same load. */
const BOX = { w: 240, h: 130 };
/** Two generated sample pictures (inline SVG, no asset resolver needed, same on web and native): a grid makes any wobble visible. */
const sample = (a: string, b: string) => `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="260" viewBox="0 0 480 260"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><pattern id="p" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#fff" stroke-opacity=".35"/></pattern></defs><rect width="480" height="260" fill="url(#g)"/><rect width="480" height="260" fill="url(#p)"/></svg>`)}`;
const FALLBACK = [sample('#ef4444', '#7f1d1d'), sample('#22c55e', '#14532d')];

/**
 * "Test on this phone": plays ONE effect RUNS times on a sample card (the real layers, the real worklets, extras included) and reports
 * the average frame time and the dropped frames. It uses two pictures (the card's own when it has 2+, else bundled ones) that stay in
 * their layers: the roles swap after each run, so run 2 reveals the first picture over the second, and so on.
 * Mounted only while a test runs; unmounting cancels it.
 */
export function BenchStage({ effect, images, onProgress, onDone }: {
  effect: number; images: string[]; onProgress: (run: number) => void; onDone: (r: BenchResult) => void;
}) {
  const { rtl } = useT();
  const { colors } = useTheme();
  const drv = useTransition();
  const pr = PixelRatio.get();
  const W = PixelRatio.roundToNearestPixel(BOX.w), H = PixelRatio.roundToNearestPixel(BOX.h);
  const def = FX[effect] ?? FX[0];
  const cfg = useMemo(() => makeCfg(def, rtl), [def, rtl]);
  const uris = useMemo<[string, string]>(() => (images.length >= 2 ? [images[0], images[1]] : [FALLBACK[0], FALLBACK[1]]), [images]);
  const [back, setBack] = useState<0 | 1>(1);
  const [running, setRunning] = useState(false);
  const loaded = useRef([false, false]);
  const acc = useRef({ frames: 0, sumMs: 0, dropped: 0, run: 0, alive: true });
  const cb = useRef({ onProgress, onDone });
  // The run loop re-schedules itself: it goes through a ref so the callback never refers to itself before it exists.
  const again = useRef<() => void>(() => {});
  useEffect(() => { cb.current = { onProgress, onDone }; });

  // Both layers carry the effect's configuration from the start (the front one in its FULL state).
  useEffect(() => { drv.configure(0, cfg); drv.configure(1, cfg); }, [drv, cfg]);

  const next = useCallback(() => {
    const a = acc.current;
    if (!a.alive) return;
    a.run += 1;
    cb.current.onProgress(a.run);
    setRunning(true);
    drv.play(Math.round(TR_BASE * 1000), (s: PlayStats) => {
      if (!a.alive) return;
      a.frames += s.frames; a.sumMs += s.sumMs; a.dropped += s.dropped;
      setRunning(false);
      setBack((b) => (1 - b) as 0 | 1);
      if (a.run < RUNS) { setTimeout(() => again.current(), 350); return; }
      const avgMs = a.frames ? a.sumMs / a.frames : 0;
      cb.current.onDone({ avgMs, dropped: a.dropped, frames: a.frames, verdict: verdictOf(avgMs, a.frames ? a.dropped / a.frames : 0) });
    });
  }, [drv]);

  useEffect(() => { again.current = next; }, [next]);

  const onLoad = useCallback((idx: 0 | 1) => {
    loaded.current[idx] = true;
    if (loaded.current[0] && loaded.current[1] && acc.current.run === 0) setTimeout(next, 300);
  }, [next]);
  // A picture that cannot load must not leave the test hanging: it runs anyway on what is there.
  const onError = onLoad;

  useEffect(() => { const a = acc.current; a.alive = true; return () => { a.alive = false; }; }, []);

  return (
    <View testID={`bench-stage-${effect}`} style={{ width: W, height: H, alignSelf: 'center', borderRadius: 12, overflow: 'hidden' }}>
      <RevealStack W={W} H={H} pr={pr} v={drv.v} uris={uris} cfgs={[cfg, cfg]} back={back} raster={running} extra={def.extra !== 'none' ? { def, cfg } : null}
        accent={colors.primary} onLoad={onLoad} onError={onError} />
    </View>
  );
}
