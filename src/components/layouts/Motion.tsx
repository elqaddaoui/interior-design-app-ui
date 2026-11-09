import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, cancelAnimation, runOnJS, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, Extrapolation, type SharedValue } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import type { Media, Tool } from '@/data/types';
import { MediaView } from '@/components/ui/MediaView';
import { Icon } from '@/components/ui/Icon';
import { useDeviceClass } from '@/lib/toolCardPerf';
import { isRtl, useLang } from '@/i18n';
import { slideshowImages } from '@/lib/toolCards';

/** The motion kit of the "wow" layouts: 3D coverflow, tilt, float, aurora, story bars. Every effect stops on a low-end device / reduce-motion. */
const web = Platform.OS === 'web';
/** A blur that works on web (CSS) and native (RN filter). */
export const blur = (px: number) => (web ? { filter: `blur(${px}px)` } : { filter: [{ blur: px }] }) as object;

/** The admin's live previews are drawn inside this: layouts then stay still (no timers, no loops, no live slideshows) so a page of 16 previews stays light. */
const PreviewCtx = React.createContext(false);
export const PreviewProvider = PreviewCtx.Provider;
export const usePreview = () => React.useContext(PreviewCtx);
/** False on a low-end device, with reduced motion, or inside an admin preview: layouts then show a calm, still version of themselves. */
export function useMotion() {
  const low = useDeviceClass().low;
  const preview = usePreview();
  return !low && !preview;
}
export const useSign = () => (isRtl(useLang((s) => s.lang)) ? -1 : 1);

/** The picture a tool is shown with in the still layouts: the first slideshow picture, else the poster / image of the media. */
export function posterMedia(tool: Tool): Media {
  const first = slideshowImages(tool.media)[0];
  if (first) return { type: 'image', uri: first };
  if (tool.media.type === 'video') return tool.media.poster ? { type: 'image', uri: tool.media.poster } : tool.media;
  return { type: 'image', uri: tool.media.uri };
}
export const Poster = ({ tool, style, priority, onReady }: { tool: Tool; style?: object; priority?: 'high'; onReady?: () => void }) => <MediaView media={posterMedia(tool)} style={style as any} priority={priority} onReady={onReady} />;

/* ------------------------------ Float / Tilt ------------------------------ */
/** Idle levitation: the child drifts up and down slowly; `i` staggers neighbours so they never move in step. */
export function Float({ i = 0, amp = 5, children }: { i?: number; amp?: number; children: React.ReactNode }) {
  const on = useMotion();
  const y = useSharedValue(0);
  React.useEffect(() => {
    if (!on) return;
    const d = 2300 + (i % 4) * 400;
    y.set(withDelay((i % 5) * 220, withRepeat(withSequence(withTiming(-amp, { duration: d, easing: Easing.inOut(Easing.sin) }), withTiming(amp, { duration: d, easing: Easing.inOut(Easing.sin) })), -1, true)));
    return () => cancelAnimation(y);
  }, [on, i, amp, y]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  return <Animated.View style={a}>{children}</Animated.View>;
}

/** Pointer tilt with a light that follows the cursor (web with a mouse; on touch screens the child simply stays flat). */
export function Tilt({ children, radius = 20, max = 9 }: { children: React.ReactNode; radius?: number; max?: number }) {
  const on = useMotion();
  const rx = useSharedValue(0); const ry = useSharedValue(0); const lx = useSharedValue(0.5); const ly = useSharedValue(0.5); const lit = useSharedValue(0);
  const body = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateX: `${rx.get()}deg` }, { rotateY: `${ry.get()}deg` }, { scale: 1 + lit.get() * 0.02 }] }));
  const glow = useAnimatedStyle(() => ({ opacity: lit.get() * 0.5, left: `${lx.get() * 100 - 45}%`, top: `${ly.get() * 100 - 45}%` }));
  if (!web || !on) return <>{children}</>;
  const t = { duration: 140, easing: Easing.out(Easing.quad) };
  const handlers = {
    onPointerMove: (e: any) => {
      if (e.pointerType === 'touch') return;
      const r = e.currentTarget.getBoundingClientRect();
      const px = (e.clientX - r.left) / Math.max(1, r.width); const py = (e.clientY - r.top) / Math.max(1, r.height);
      ry.set(withTiming((px - 0.5) * 2 * max, t)); rx.set(withTiming(-(py - 0.5) * 2 * max, t)); lx.set(px); ly.set(py); lit.set(withTiming(1, t));
    },
    onPointerLeave: () => { rx.set(withSpring(0)); ry.set(withSpring(0)); lit.set(withTiming(0, { duration: 300 })); },
  };
  return (
    <Animated.View style={body} {...(handlers as object)}>
      {children}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
        <Animated.View style={[{ position: 'absolute', width: '90%', aspectRatio: 1, borderRadius: 9999, backgroundColor: '#fff', filter: 'blur(36px)' } as any, glow]} />
      </View>
    </Animated.View>
  );
}

/* ------------------------------ Aurora ------------------------------ */
function Blob({ color, size, x, y, i }: { color: string; size: number; x: string; y: string; i: number }) {
  const on = useMotion();
  const p = useSharedValue(0);
  React.useEffect(() => {
    if (!on) return;
    p.set(withDelay(i * 700, withRepeat(withTiming(1, { duration: 9000 + i * 2500, easing: Easing.inOut(Easing.sin) }), -1, true)));
    return () => cancelAnimation(p);
  }, [on, i, p]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(p.get(), [0, 1], [-size * 0.18, size * 0.18]) }, { translateY: interpolate(p.get(), [0, 1], [size * 0.12, -size * 0.14]) }, { scale: interpolate(p.get(), [0, 1], [0.92, 1.14]) }] }));
  const soft = blur(web ? 70 : 48);
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: color, opacity: web ? 0.62 : 0.4, ...soft } as any, a]} />;
}
/** Slow-drifting coloured light on a deep background: the "aurora" behind glass tiles. */
export function Aurora({ primary, radius = 32, children, pad = 16 }: { primary: string; radius?: number; children: React.ReactNode; pad?: number }) {
  return (
    <View style={{ borderRadius: radius, overflow: 'hidden', backgroundColor: '#080a14', padding: pad }}>
      <LinearGradient pointerEvents="none" colors={['#0a0d1c', '#150c2b', '#07131f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <Blob color={primary} size={420} x="-12%" y="-6%" i={0} />
      <Blob color="#7c3aed" size={380} x="52%" y="18%" i={1} />
      <Blob color="#06b6d4" size={340} x="8%" y="58%" i={2} />
      <Blob color="#f472b6" size={300} x="62%" y="70%" i={3} />
      {children}
    </View>
  );
}

/* ------------------------------ Story bars ------------------------------ */
function Bar({ state, duration, run, paused, onDone }: { state: 'done' | 'now' | 'next'; duration: number; run: boolean; paused: boolean; onDone?: () => void }) {
  const w = useSharedValue(state === 'done' ? 1 : 0);
  const cb = React.useRef(onDone);
  React.useEffect(() => { cb.current = onDone; });
  const finish = React.useCallback(() => cb.current?.(), []);
  React.useEffect(() => {
    cancelAnimation(w);
    if (state === 'done') w.set(1);
    else if (state === 'next') w.set(0);
    else if (!run) w.set(0.45);
    else if (!paused) w.set(withTiming(1, { duration: Math.max(1, duration * (1 - w.get())), easing: Easing.linear }, (fin) => { if (fin) runOnJS(finish)(); }));
  }, [state, duration, run, paused, w, finish]);
  const a = useAnimatedStyle(() => ({ width: `${w.get() * 100}%` }));
  return <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.32)', overflow: 'hidden' }}><Animated.View style={[{ height: 3, backgroundColor: '#fff' }, a]} /></View>;
}
/** Instagram-style progress bars: the ones before `index` are full, the current one fills over `duration` (then calls `onDone`) and freezes while `paused`. */
export function StoryBars({ count, index, duration, run, paused = false, onDone }: { count: number; index: number; duration: number; run: boolean; paused?: boolean; onDone?: () => void }) {
  const rtl = useSign() === -1;
  return <View style={{ flexDirection: 'row', gap: 4, direction: rtl ? 'rtl' : 'ltr' }}>{Array.from({ length: count }, (_, k) => <Bar key={k} state={k < index ? 'done' : k === index ? 'now' : 'next'} duration={duration} run={run} paused={paused} onDone={k === index ? onDone : undefined} />)}</View>;
}

/* ------------------------------ 3D coverflow ------------------------------ */
export interface FlowItem { key: string; testID?: string; render: () => React.ReactNode; onPress: () => void }

function FlowCard({ i, active, step, itemW, height, sign, left, children, onPress, testID }: { testID?: string; i: number; active: SharedValue<number>; step: number; itemW: number; height: number; sign: number; left: number; children: React.ReactNode; onPress: () => void }) {
  const a = useAnimatedStyle(() => {
    const p = i - active.get();
    const ap = Math.abs(p);
    const dir = p < 0 ? -1 : 1;
    const x = sign * dir * (Math.min(ap, 1) * step * 1.22 + Math.max(ap - 1, 0) * step * 0.5);
    return {
      zIndex: 100 - Math.round(ap * 10),
      opacity: interpolate(ap, [0, 1, 2, 3], [1, 0.92, 0.6, 0], Extrapolation.CLAMP),
      transform: [{ perspective: 1000 }, { translateX: x }, { rotateY: `${-sign * dir * Math.min(ap, 1) * 54}deg` }, { scale: interpolate(ap, [0, 1, 2], [1, 0.8, 0.64], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', top: 10, left, width: itemW, height }, a]}>
      <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={{ flex: 1 }}>
        <View pointerEvents="none" style={[{ flex: 1 }, (web ? { boxShadow: '0 24px 48px rgba(0,0,0,0.38)', borderRadius: 24 } : { elevation: 10 }) as any]}>{children}</View>
      </Pressable>
    </Animated.View>
  );
}

const ArrowBtn = ({ side, onPress }: { side: 'left' | 'right'; onPress: () => void }) => (
  <Pressable accessibilityRole="button" onPress={onPress} className="w-11 h-11 rounded-full bg-surface border border-line items-center justify-center" style={{ position: 'absolute', top: '50%', marginTop: -22, [side]: 4, zIndex: 300, boxShadow: '0 6px 22px rgba(0,0,0,0.2)' } as any}>
    <Icon name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={24} />
  </Pressable>
);

/** Bookkeeping of one coverflow that gesture / timer callbacks read outside of React's render (a class so it is plain mutable state, not a ref). */
class FlowState {
  private i: number; private drag = false; private at = 0;
  constructor(start: number) { this.i = start; }
  idx() { return this.i; }
  setIdx(v: number) { this.i = v; }
  dragging() { return this.drag; }
  touch() { this.at = Date.now(); }
  quiet(ms: number) { return Date.now() - this.at > ms; }
  begin() { this.drag = true; this.touch(); }
  end() { setTimeout(() => { this.drag = false; }, 90); }
}

/**
 * Coverflow: the centre card faces you, the others turn away in perspective. Drag / swipe / arrows / tap a side card to move; it also drifts
 * by itself every few seconds until you touch it. Mirrors in RTL.
 */
export function Coverflow({ items, itemW, height, auto = 4500, caption, testID, dark, onChange }: { items: FlowItem[]; itemW: number; height: number; auto?: number; caption?: (index: number) => React.ReactNode; testID?: string; dark?: boolean; onChange?: (index: number) => void }) {
  const sign = useSign();
  const motion = useMotion();
  const n = items.length;
  const start = n > 2 ? 1 : 0;
  const [cw, setCw] = React.useState(0);
  const [idx, setIdx] = React.useState(start);
  const active = useSharedValue(start);
  const from = useSharedValue(start);
  const [S] = React.useState(() => new FlowState(start));
  const step = Math.round(itemW * 0.5);
  const go = React.useCallback((to: number) => {
    const c = Math.max(0, Math.min(n - 1, to));
    S.setIdx(c); setIdx(c); onChange?.(c);
    active.set(withSpring(c, { damping: 17, stiffness: 120, mass: 0.9 }));
  }, [n, active, onChange, S]);
  React.useEffect(() => {
    if (!motion || !auto || n < 2) return;
    const t = setInterval(() => { if (S.quiet(9000)) go(S.idx() + 1 >= n ? 0 : S.idx() + 1); }, auto);
    return () => clearInterval(t);
  }, [motion, auto, n, go, S]);
  const pan = Gesture.Pan().runOnJS(true).activeOffsetX([-10, 10]).failOffsetY([-14, 14])
    .onStart(() => { S.begin(); cancelAnimation(active); from.set(active.get()); })
    .onUpdate((e) => { active.set(Math.max(-0.4, Math.min(n - 0.6, from.get() - (sign * e.translationX) / step))); })
    .onEnd((e) => { go(Math.round(active.get() - (sign * e.velocityX * 0.1) / step)); })
    .onFinalize(() => { S.end(); });
  const press = (i: number, open: () => void) => () => { if (S.dragging()) return; S.touch(); if (i === S.idx()) open(); else go(i); };
  const left = Math.max(0, (cw - itemW) / 2);
  return (
    <View testID={testID} style={{ minWidth: 0 }}>
      <View style={{ height: height + 44, direction: 'ltr', overflow: 'hidden' }} onLayout={(e) => setCw(e.nativeEvent.layout.width)}>
        {cw > 0 ? <GestureDetector gesture={pan} touchAction="pan-y"><View style={{ flex: 1 }}>
          {items.map((it, i) => <FlowCard key={it.key} i={i} active={active} step={step} itemW={itemW} height={height} sign={sign} left={left} testID={it.testID} onPress={press(i, it.onPress)}>{it.render()}</FlowCard>)}
        </View></GestureDetector> : null}
        {n > 1 && cw > itemW + 120 ? <>
          <ArrowBtn side="left" onPress={() => { S.touch(); go(idx - sign); }} />
          <ArrowBtn side="right" onPress={() => { S.touch(); go(idx + sign); }} />
        </> : null}
      </View>
      {caption ? <View style={{ marginTop: 10, alignItems: 'center' }}>{caption(idx)}</View> : null}
      {n > 1 ? <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10, direction: 'ltr' }}>
        {items.map((it, i) => <Pressable key={it.key} accessibilityRole="button" onPress={() => { S.touch(); go(i); }} hitSlop={8}><View className={dark ? '' : i === idx ? 'bg-primary' : 'bg-line'} style={{ width: i === idx ? 22 : 7, height: 7, borderRadius: 4, ...(dark ? { backgroundColor: i === idx ? '#fff' : 'rgba(255,255,255,0.35)' } : null) }} /></Pressable>)}
      </View> : null}
    </View>
  );
}
