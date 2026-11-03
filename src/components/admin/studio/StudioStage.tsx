import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PixelRatio, Pressable, View } from 'react-native';
import { FADE_CFG, FX, FX_FADE, TR_BASE, hasExtras, makeCfg, type Cfg, type FxDef } from '@/lib/toolCardFx';
import { overrideFor, studioHasExtras, studioKey, type StudioStyle } from '@/lib/fxStudio';
import { RevealStack } from '@/components/toolcard/RevealStack';
import { useTransition } from '@/components/toolcard/useTransition';
import { Icon } from '@/components/ui/Icon';
import { Slider } from '@/components/ui/Slider';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';

type Pair<T> = [T, T];

/**
 * The Studio's live stage: the REAL transition engine (two layers, one progress value, the same worklets and the same Studio layer as the home
 * cards) with a transport bar (play / pause / replay / loop / scrub). Any change of the style, the effect, the direction or the size restarts the
 * transition after a short delay, so every tweak shows up at once ("live edit"). While paused, a tweak is applied to the frozen frame instead.
 * The two pictures stay in their layers and the roles swap after each run: A -> B, B -> A, ...
 */
export function StudioStage({ style, effect, rtl, speed, lowEnd, images, height, accent }: {
  style: StudioStyle | null; effect: number; rtl: boolean; speed: number; lowEnd: boolean; images: Pair<string>; height: number; accent: string;
}) {
  const { t } = useT();
  const { colors } = useTheme();
  const drv = useTransition();
  const pr = PixelRatio.get();
  const [box, setBox] = useState(0);
  const W = PixelRatio.roundToNearestPixel(box), H = PixelRatio.roundToNearestPixel(height);
  const [cfgs, setCfgs] = useState<Pair<Cfg>>([FADE_CFG, FADE_CFG]);
  const [back, setBack] = useState<0 | 1>(1);
  const [extra, setExtra] = useState<{ def: FxDef; cfg: Cfg } | null>(null);
  const [now, setNow] = useState<{ def: FxDef; cfg: Cfg; style: StudioStyle } | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'playing' | 'paused'>('playing');
  const [loop, setLoop] = useState(true);
  const [pos, setPos] = useState(0);
  // The parent remounts the stage (key) when the pictures change, so both layers always start unloaded.
  const loaded = useRef<[boolean, boolean]>([false, false]);
  const [ready, setReady] = useState(false);

  // Latest props for the stable callbacks (written after each commit, read only inside callbacks).
  const P = useRef({ style, effect, rtl, speed, lowEnd, W, H, loop });
  useLayoutEffect(() => { P.current = { style, effect, rtl, speed, lowEnd, W, H, loop }; });
  const S = useRef({ b: 1 as 0 | 1, cursor: 0, mode: 'playing' as 'playing' | 'paused', running: false, timer: null as ReturnType<typeof setTimeout> | null, pos: 0 });
  // `onDone` restarts the loop through this ref (the starter is declared after it).
  const again = useRef<(from: number) => void>(() => {});

  const clearTimer = () => { if (S.current.timer) clearTimeout(S.current.timer); S.current.timer = null; };

  /** Configures the hidden layer for the next transition (same rules as the home engine). */
  const prepare = useCallback(() => {
    const p = P.current, s = S.current;
    const def = FX[p.effect] ?? FX[FX_FADE];
    const st = p.style;
    const ov = st ? overrideFor(st, def, s.cursor) : null;
    if (ov && p.lowEnd) { ov.zi = 0; ov.zo = 0; ov.pu = 0; }
    const cfg = makeCfg(def, p.rtl, ov);
    const b = s.b;
    drv.configure(b, cfg);
    setCfgs((old) => (b === 0 ? [cfg, old[1]] : [old[0], cfg]));
    setBack(b);
    const cdef: FxDef = st ? { ...def, extra: st.bar.mode === 'effect' ? def.extra : 'none', deco: st.els.mode === 'effect' ? def.deco : undefined } : def;
    setExtra(!p.lowEnd && hasExtras(cdef) ? { def: cdef, cfg } : null);
    setNow(!p.lowEnd && st && studioHasExtras(st) ? { def, cfg, style: st } : null);
  }, [drv]);

  const onDone = useCallback(() => {
    const s = S.current;
    s.running = false; setRunning(false);
    s.b = (1 - s.b) as 0 | 1; s.cursor += 1; s.pos = 0;
    setBack(s.b); setPos(0);
    if (s.mode === 'playing' && P.current.loop) {
      clearTimer();
      s.timer = setTimeout(() => { s.timer = null; if (S.current.mode === 'playing') again.current(0); }, 700);
    } else { s.mode = 'paused'; setMode('paused'); }
  }, []);

  const start = useCallback((from: number) => {
    const s = S.current, p = P.current;
    if (p.W <= 0 || p.H <= 0) return;
    clearTimer();
    drv.reset();
    prepare();
    s.running = true; setRunning(true);
    s.mode = 'playing'; setMode('playing');
    drv.play(Math.round((TR_BASE / p.speed) * 1000), onDone, from);
  }, [drv, prepare, onDone]);
  useLayoutEffect(() => { again.current = start; }, [start]);

  // Live editing: whatever changes the picture of the transition restarts it (or refreshes the frozen frame).
  const sig = `${studio(style)}|${effect}|${rtl ? 1 : 0}|${lowEnd ? 1 : 0}|${speed}|${W}x${H}|${images[0].length}${images[1].length}`;
  useEffect(() => {
    if (!ready || W <= 0) return;
    const s = S.current;
    if (s.mode === 'paused') { prepare(); drv.scrub(s.pos / 100); return; }
    clearTimer();
    s.timer = setTimeout(() => { s.timer = null; start(0); }, 160);
    return clearTimer;
  }, [sig, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimer(), []);

  // Progress read-out while playing.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { const u = Math.round(drv.v.p.value * 100); S.current.pos = u; setPos(u); }, 90);
    return () => clearInterval(id);
  }, [running, drv]);

  const onLoad = useCallback((idx: 0 | 1) => { loaded.current[idx] = true; if (loaded.current[0] && loaded.current[1]) setReady(true); }, []);
  const onError = useCallback((idx: 0 | 1) => { loaded.current[idx] = true; if (loaded.current[0] && loaded.current[1]) setReady(true); }, []);

  const playPause = () => {
    const s = S.current;
    if (s.mode === 'playing' && s.running) {
      drv.freeze(); const u = Math.round(drv.v.p.value * 100); s.pos = u; setPos(u);
      s.running = false; setRunning(false); s.mode = 'paused'; setMode('paused'); clearTimer();
    } else if (s.mode === 'playing') { clearTimer(); s.mode = 'paused'; setMode('paused'); }
    else start(s.pos > 0 && s.pos < 100 ? s.pos / 100 : 0);
  };
  const scrub = (u: number) => {
    const s = S.current;
    clearTimer(); s.running = false; setRunning(false); s.mode = 'paused'; setMode('paused'); s.pos = u; setPos(u);
    prepare(); drv.scrub(u / 100);
  };
  const name = t(`tc.fx.${effect}`);
  const btn = 'w-10 h-10 rounded-full items-center justify-center bg-surface2';
  const imgs: Pair<string | null> = [images[0], images[1]];

  return (
    <View>
      <View onLayout={(e) => setBox(e.nativeEvent.layout.width)} style={{ width: '100%' }}>
        <View testID="st-stage" style={{ width: W || '100%', height: H, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface2, alignSelf: 'center' }}>
          {W > 0 ? (
            <RevealStack W={W} H={H} pr={pr} v={drv.v} uris={imgs} cfgs={cfgs} back={back} raster={running} extra={extra} studio={now} accent={accent} onLoad={onLoad} onError={onError} />
          ) : null}
        </View>
      </View>
      <View className="flex-row items-center mt-2" style={{ gap: 8 }}>
        <Pressable testID="st-play" accessibilityRole="button" accessibilityLabel={mode === 'playing' ? t('st.pause') : t('st.play')} onPress={playPause} className={btn}><Icon name={mode === 'playing' ? 'pause' : 'play'} size={20} /></Pressable>
        <Pressable testID="st-replay" accessibilityRole="button" accessibilityLabel={t('st.replay')} onPress={() => start(0)} className={btn}><Icon name="replay" size={20} /></Pressable>
        <Pressable testID="st-loop" accessibilityRole="switch" accessibilityState={{ checked: loop }} accessibilityLabel={t('st.loop')} onPress={() => setLoop((v) => !v)} className={`w-10 h-10 rounded-full items-center justify-center ${loop ? 'bg-ink' : 'bg-surface2'}`}><Icon name="repeat" size={20} tone={loop ? 'onink' : 'fg'} /></Pressable>
        <View style={{ flex: 1 }}><Slider testID="st-scrub" label={t('st.scrub')} value={pos} min={0} max={100} step={1} onChange={scrub} /></View>
      </View>
      <Txt className="text-muted text-[12px] mt-1" numberOfLines={1}>{`#${effect} · ${name} · ${pos}%`}</Txt>
    </View>
  );
}
const studio = (s: StudioStyle | null) => (s ? studioKey(s) : '');
