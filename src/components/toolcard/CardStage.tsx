import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, View, type StyleProp, type ViewStyle } from 'react-native';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';
import { FADE_CFG, FX, FX_FADE, TR_BASE, effectiveEffect, enabledIds, makeCfg, type Cfg, type FxAvail, type FxDef } from '@/lib/toolCardFx';
import { availFromKey, availKey, requestedEffects, type ResolvedFx } from '@/lib/toolCards';
import { shouldRecord, type DeviceClass } from '@/lib/deviceTier';
import { fxLog, recordTransition, useDeviceClass, useIsMostVisible, useOnScreen } from '@/lib/toolCardPerf';
import { RevealStack } from './RevealStack';
import { useTransition, type PlayStats } from './useTransition';

/** The effects a card really plays, in order, after availability / low-end rules. Empty = still image. */
function effectList(fx: ResolvedFx, avail: FxAvail, lowEnd: boolean): number[] {
  const requested = requestedEffects(fx, enabledIds(avail));
  // Never edited and every effect disabled by the admin: the cross-fade (always available) plays.
  if (fx.mode === 'multiple' && fx.effects === null && requested.length === 0) return [FX_FADE];
  return requested.map((id) => effectiveEffect(id, avail, lowEnd));
}

type Size = { w: number; h: number };
type Pair<T> = [T, T];

/**
 * Engine of one card: two identical layers, one shared progress value, ONE transition at a time.
 *
 *   FRONT  fully visible, static.            BACK  hidden, holds the NEXT image (never more than two images per card).
 *   hold -> [next image fully loaded?] -> BACK animates START -> FULL -> (same UI frame) roles swap -> the old FRONT, now hidden
 *   underneath, receives the image after next and is reset to START. A visible layer never changes source, an image is never copied
 *   between layers. If the next image is not loaded when the hold ends, the card keeps holding (no transition, no placeholder).
 *
 * Everything the engine mutates outside React lives in `S` (refs), so the callbacks are stable and never go stale.
 */
function Engine({ images, fx, rtl, run, force, lowEnd, record, avail, layout, onReady, onEffect }: {
  images: string[]; fx: ResolvedFx; rtl: boolean; run: boolean; force: boolean; lowEnd: boolean; record: boolean; avail: FxAvail; layout: Size;
  onReady?: () => void; onEffect?: (effect: number) => void;
}) {
  const { colors } = useTheme();
  const drv = useTransition();
  const pr = PixelRatio.get();
  const lite = lowEnd && !force; // low-end: no extras (and the effect list is already reduced by effectList)
  const list = useMemo(() => effectList(fx, avail, lowEnd && !force), [fx, avail, lowEnd, force]);
  const animatable = images.length >= 2 && list.length > 0;
  const listKey = `${list.join(',')}|${rtl ? 1 : 0}|${lite ? 1 : 0}|${animatable ? 1 : 0}`;

  // Rendered state (only what the layers need to draw).
  const [uris, setUris] = useState<Pair<string | null>>(() => [images[0] ?? null, null]);
  const [cfgs, setCfgs] = useState<Pair<Cfg>>([FADE_CFG, FADE_CFG]);
  const [back, setBack] = useState<0 | 1>(1);
  const [phase, setPhase] = useState<'idle' | 'running'>('idle');
  const [extra, setExtra] = useState<{ def: FxDef; cfg: Cfg } | null>(null);
  // The size never changes during a transition: a new layout is applied once the layers are idle again.
  const [size, setSize] = useState<Size>(layout);
  if (phase !== 'running' && (size.w !== layout.w || size.h !== layout.h)) setSize(layout);

  // Mutable engine state.
  const S = useRef({
    alive: false, running: false, front: 0 as 0 | 1, cur: 0, next: -1, effect: 0, cursor: 0,
    uris: [images[0] ?? null, null] as Pair<string | null>, loaded: [null, null] as Pair<string | null>,
    frontLoaded: false, prepared: false, backLoaded: false, holdDone: false, readyDone: false,
    failed: new Set<string>(), timer: null as ReturnType<typeof setTimeout> | null,
  });
  // Latest props, read by the stable callbacks (written after each commit).
  const P = useRef({ images, fx, rtl, run, force, lowEnd, record, avail, lite, onReady, onEffect, size });
  useLayoutEffect(() => { P.current = { images, fx, rtl, run, force, lowEnd, record, avail, lite, onReady, onEffect, size }; });

  const reportReady = useCallback(() => { if (!S.current.readyDone) { S.current.readyDone = true; P.current.onReady?.(); } }, []);

  /** Index of the image shown after `from` (cyclic, failed images skipped); -1 when there is none. */
  const pickNext = useCallback((from: number) => {
    const { images: list2 } = P.current;
    for (let k = 1; k < list2.length; k++) { const i = (from + k) % list2.length; if (!S.current.failed.has(list2[i])) return i; }
    return -1;
  }, []);

  const tryStart = useCallback(() => {
    const s = S.current;
    if (!s.alive || s.running || !P.current.run) return;
    // Start only when the next image is fully loaded; otherwise keep holding.
    if (!s.holdDone || !s.prepared || !s.backLoaded || !s.frontLoaded) return;
    const { size: sz } = P.current;
    if (sz.w <= 0 || sz.h <= 0) return;
    s.running = true;
    setPhase('running');
  }, []);

  /** Loads the NEXT image into the hidden BACK layer and gives that layer the next effect. Never touches the visible layer. */
  const prepare = useCallback(() => {
    const s = S.current, p = P.current;
    if (!s.alive || s.running || s.prepared || !p.run || !s.frontLoaded) return;
    const list2 = effectList(p.fx, p.avail, p.lowEnd && !p.force);
    const next = pickNext(s.cur);
    if (p.images.length < 2 || list2.length === 0 || next < 0) return;
    const e = list2[s.cursor % list2.length];
    const def = FX[e] ?? FX[FX_FADE];
    const cfg = makeCfg(def, p.rtl);
    const b = (1 - s.front) as 0 | 1;
    const uri = p.images[next];
    s.next = next; s.effect = e; s.prepared = true;
    // With 2 images the hidden layer already holds that very image (no reload, nothing to wait for).
    if (s.uris[b] !== uri) { s.uris[b] = uri; s.loaded[b] = null; }
    s.backLoaded = s.loaded[b] === uri;
    drv.configure(b, cfg);
    setUris([s.uris[0], s.uris[1]]);
    setCfgs((old) => (b === 0 ? [cfg, old[1]] : [old[0], cfg]));
    setBack(b);
    setExtra(!p.lite && def.extra !== 'none' ? { def, cfg } : null);
    fxLog(`prepare layer ${b} <- #${next} effect ${e} (${s.backLoaded ? 'already loaded' : 'loading'})`);
    p.onEffect?.(e);
    if (s.backLoaded) tryStart();
  }, [drv, pickNext, tryStart]);

  /** (Re)starts the hold timer. Pause = hold: while the card is not allowed to run, no timer runs and nothing starts. */
  const startHold = useCallback(() => {
    const s = S.current;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null; s.holdDone = false;
    if (!P.current.run || s.running) return;
    s.timer = setTimeout(() => { s.timer = null; s.holdDone = true; tryStart(); }, P.current.fx.hold * 1000);
  }, [tryStart]);

  const onLoad = useCallback((idx: 0 | 1, uri: string) => {
    const s = S.current;
    if (s.uris[idx] !== uri) return; // a late event of a previous source
    if (s.loaded[idx] !== uri) { s.loaded[idx] = uri; fxLog(`loaded layer ${idx}: ${uri.slice(-40)}`); }
    if (idx === s.front) {
      if (!s.frontLoaded) { s.frontLoaded = true; reportReady(); startHold(); }
      prepare();
    } else if (s.prepared && uri === P.current.images[s.next]) {
      s.backLoaded = true;
      tryStart();
    }
  }, [prepare, reportReady, startHold, tryStart]);

  const onError = useCallback((idx: 0 | 1, uri: string) => {
    const s = S.current;
    if (s.uris[idx] !== uri) return;
    fxLog(`image failed, skipped: ${uri.slice(-40)}`);
    s.failed.add(uri);
    if (idx === s.front) {
      // The first picture cannot load: show the first one that can.
      const imgs = P.current.images;
      const n = imgs.findIndex((u) => !s.failed.has(u));
      if (n < 0) { reportReady(); return; }
      s.cur = n; s.uris[idx] = imgs[n]; s.loaded[idx] = null;
      setUris([s.uris[0], s.uris[1]]);
    } else if (!s.running) {
      // The prepared image cannot load: skip it and prepare the next one.
      s.prepared = false; s.backLoaded = false; s.loaded[idx] = null;
      prepare();
    }
  }, [prepare, reportReady]);

  /** The transition has finished and the UI thread has already swapped the roles. Only now the image after next is loaded. */
  const onDone = useCallback((stats: PlayStats) => {
    const s = S.current;
    if (!s.alive) return;
    s.running = false;
    s.front = (1 - s.front) as 0 | 1;
    s.cur = s.next; s.prepared = false; s.backLoaded = false; s.frontLoaded = true; s.cursor += 1;
    setPhase('idle');
    setBack((1 - s.front) as 0 | 1);
    setExtra(null);
    const avg = stats.frames ? stats.sumMs / stats.frames : 0;
    fxLog(`transition effect ${s.effect}: ${stats.frames} frames, avg ${avg.toFixed(1)} ms, dropped ${stats.dropped}, slow(>32ms) ${stats.slow}`);
    // Evidence for the device classification (lib/deviceTier.ts): one janky transition proves nothing, several in a row do. The admin
    // preview never counts, and nothing is recorded once the verdict cannot change (see shouldRecord).
    if (!P.current.force && P.current.record) recordTransition(stats);
    startHold();
    prepare();
  }, [prepare, startHold]);

  // Start the UI-thread transition once the layers have been committed with raster hints on.
  useEffect(() => {
    if (phase !== 'running') return;
    drv.play(Math.round((TR_BASE / P.current.fx.speed) * 1000), onDone);
  }, [phase, drv, onDone]);

  useEffect(() => {
    const s = S.current;
    s.alive = true;
    return () => { s.alive = false; if (s.timer) clearTimeout(s.timer); s.timer = null; };
  }, []);

  // Pause / resume (off-screen, other tab, app in background, not the most visible card): a fresh hold starts when the card may run again.
  useEffect(() => {
    if (!run) { const s = S.current; if (s.timer) clearTimeout(s.timer); s.timer = null; s.holdDone = false; return; }
    startHold();
    prepare();
  }, [run, fx.hold, startHold, prepare]);

  // The effect list changed (admin edit, availability, low-end, RTL): re-prepare the hidden layer. A running transition is never touched.
  useEffect(() => {
    const s = S.current;
    if (!animatable) onEffect?.(-1);
    if (s.running) return;
    s.prepared = false; s.backLoaded = false;
    prepare();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- listKey is the signature of everything that matters here
  }, [listKey]);

  if (size.w <= 0 || size.h <= 0) return null;
  const extraNow = phase === 'running' || extra ? extra : null;
  return (
    <RevealStack W={size.w} H={size.h} pr={pr} v={drv.v} uris={uris} cfgs={cfgs} back={back} raster={phase === 'running'}
      extra={extraNow} accent={colors.primary} onLoad={onLoad} onError={onError} />
  );
}

/**
 * The image zone of a tools card (media type "slideshow"): before / after reveal between 2 or more images.
 * It owns the box (size from onLayout, rounded to whole physical pixels), visibility and device rules; the Engine owns the transitions.
 *
 *  - Only the most visible card animates; the others show a still image. Off-screen cards, other tabs and a backgrounded app pause.
 *  - Low-end devices (and reduce-motion) play only the effects the admin allowed for them, else the cross-fade, and no extras.
 *  - Admin availability: a disabled effect is replaced by the nearest enabled Safe effect, or the cross-fade.
 */
export function CardStage({ id, images, fx, rtl, force, onReady, onEffect, style }: {
  id: string; images: string[]; fx: ResolvedFx; rtl: boolean;
  /** Admin preview: always animates (does not compete for "most visible card") and ignores the low-end demotion. */
  force?: boolean; onReady?: () => void;
  /** Reports the effect prepared / playing (0 = cross-fade, -1 = still image); the admin status line shows it. */
  onEffect?: (effect: number) => void; style?: StyleProp<ViewStyle>;
}) {
  const box = useRef<View>(null);
  const { visible, near } = useOnScreen(box, id, !force);
  const most = useIsMostVisible(id);
  const device: DeviceClass = useDeviceClass();
  const lowEnd = device.low;
  const record = shouldRecord(device);
  const key = useStore((s) => availKey(s.doc.settings.toolCards));
  const avail = useMemo(() => availFromKey(key), [key]);
  const [layout, setLayout] = useState<Size>({ w: 0, h: 0 });
  const run = visible && (force || most);

  // Whole physical pixels: the layers, the photos and the maths all use exactly this size.
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const w = PixelRatio.roundToNearestPixel(e.nativeEvent.layout.width);
    const h = PixelRatio.roundToNearestPixel(e.nativeEvent.layout.height);
    setLayout((old) => (old.w === w && old.h === h ? old : { w, h }));
  }, []);

  // A different picture set is a different engine (fresh state); a settings change never remounts it.
  const sig = images.join('\n');
  return (
    <View ref={box} style={[{ overflow: 'hidden' }, style]} onLayout={onLayout}>
      {near && images.length > 0 && layout.w > 0 ? (
        <Engine key={sig} images={images} fx={fx} rtl={rtl} run={run} force={!!force} lowEnd={lowEnd} record={record} avail={avail} layout={layout} onReady={onReady} onEffect={onEffect} />
      ) : null}
    </View>
  );
}
