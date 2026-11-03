import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { circleDiameter, ease, extraRamp, layerFrame, originPx, wipePivot, wipeR, withAlpha, MIN_SCALE, type Cfg, type FxDef } from '@/lib/toolCardFx';
import { barAlpha, barSegments, followDeco, gradPoints, mixHex, paintColors, pieceColor, pieceShape, pieceSize, studioPiece, studioPieceCount, tintAlpha, tintColors, type StudioBar, type StudioStyle } from '@/lib/fxStudio';
import type { FxValues } from './useTransition';
import { Shape } from './PieceShape';

/**
 * The Animation Studio's visual layer, drawn over the two photo layers (same z-order and the same progress value `p` as the classic extras):
 *   Tint        a colour wash (solid or gradient) that blooms and fades during the transition
 *   Bar         the custom edge: a wipe's moving bar (size, look, paint, glow, trail), the frame of a rect / spinning window, the ring of an iris
 *   Pieces      the animated elements (shape, count, motion, colours)
 * Everything moves through transform + opacity, except the frame / ring which resize (their borders must keep a constant thickness).
 */
const Z = 5;
const gradColors = (c: string[]) => c as unknown as readonly [string, string, ...string[]];
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const glowShadow = (px: number, color: string) => ({ boxShadow: `0 0 ${px}px ${color}` }) as object;

/** Growth of a rect / circle / spin window at progress p (same formula as the engine). */
const grow = (cfg: Cfg, p: number) => {
  'worklet';
  const e = clamp01(ease(cfg.e, p, cfg.ep));
  return { e, s: MIN_SCALE + (1 - MIN_SCALE) * e };
};

/* ------------------------------ tint ------------------------------ */
function Tint({ v, style }: { v: FxValues; style: StudioStyle }) {
  const t = style.tint;
  const st = useAnimatedStyle(() => ({ opacity: v.active.value * tintAlpha(t, v.p.value) }), [t]);
  const g = gradPoints(t.ang);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: Z - 1 }, st]}>
      <LinearGradient colors={gradColors(tintColors(t))} start={g.start} end={g.end} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/* ------------------------------ wipe bar ------------------------------ */
/** A straight bar that rides the wipe edge: same container geometry and transform as the wipe window. */
function WipeBar({ v, cfg, W, H, pr, bar, accent }: { v: FxValues; cfg: Cfg; W: number; H: number; pr: number; bar: StudioBar; accent: string }) {
  const R = wipeR(W, H), L = 2 * R;
  const { x: px, y: py } = wipePivot(W, H);
  const st = useAnimatedStyle(() => {
    const f = layerFrame(cfg, W, H, pr, ease(cfg.e, v.p.value, cfg.ep));
    return { opacity: v.active.value * barAlpha(bar, v.p.value), transform: f.ct as never };
  }, [cfg, W, H, pr, bar]);
  const { a, b, grad } = paintColors(bar.paint, accent);
  const size = bar.size, top = L - R, len = 2 * R;
  const g = gradPoints(bar.paint.ang);
  const mid = grad ? mixHex(a, b, 0.5) : a;
  const radius = bar.round ? size / 2 : 0;
  const strip = (left: number, width: number, c0: string, c1: string, key: string) => (
    <LinearGradient key={key} colors={[c0, c1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', left, top, width, height: len }} />
  );
  const solid = (left: number, width: number, key: string) => (grad
    ? <LinearGradient key={key} colors={[a, b]} start={g.start} end={g.end} style={{ position: 'absolute', left, top, width, height: len, borderRadius: radius }} />
    : <View key={key} style={{ position: 'absolute', left, top, width, height: len, borderRadius: radius, backgroundColor: a }} />);
  let core: React.ReactNode;
  if (bar.look === 'double') {
    const w = Math.max(1, Math.round(size / 3));
    core = [solid(L - size / 2, w, 'd0'), solid(L + size / 2 - w, w, 'd1')];
  } else if (bar.look === 'dashed' || bar.look === 'dotted') {
    const segs = barSegments(bar.look, size, len);
    core = segs.map(([off, l], k) => (
      <View key={k} style={{ position: 'absolute', left: L - size / 2, top: L + off, width: size, height: l, borderRadius: bar.look === 'dotted' ? size / 2 : radius, backgroundColor: grad ? mixHex(a, b, segs.length > 1 ? k / (segs.length - 1) : 0) : a }} />
    ));
  } else core = solid(L - size / 2, size, 'core');
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: px - L, top: py - L, width: L, height: 2 * L, transformOrigin: '100% 50%', zIndex: Z }, st]}>
      {bar.trail > 0 ? strip(L - size / 2 - bar.trail, bar.trail, withAlpha(bar.trailColor || mid, 0), withAlpha(bar.trailColor || mid, 0.6), 'trail') : null}
      {bar.glow > 0 ? <>{strip(L - size / 2 - bar.glow, bar.glow, withAlpha(mid, 0), withAlpha(mid, 0.55), 'gl')}{strip(L + size / 2, bar.glow, withAlpha(mid, 0.55), withAlpha(mid, 0), 'gr')}</> : null}
      {core}
    </Animated.View>
  );
}

/* ------------------------------ frame / ring ------------------------------ */
/** The border lines of a box: solid / dashed / dotted use one border; a gradient paints four gradient edges; double adds an inner line. */
function Lines({ bar, accent, radius }: { bar: StudioBar; accent: string; radius: number }) {
  const { a, b, grad } = paintColors(bar.paint, accent);
  const size = bar.size;
  const line = (inset: number, w: number, c1: string, c2: string, key: string) => {
    if (grad && radius === 0 && bar.look !== 'dashed' && bar.look !== 'dotted') {
      return (
        <View key={key} pointerEvents="none" style={{ position: 'absolute', left: inset, top: inset, right: inset, bottom: inset }}>
          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: w }} />
          <LinearGradient colors={[c2, c1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: w }} />
          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w }} />
          <LinearGradient colors={[c2, c1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: w }} />
        </View>
      );
    }
    return <View key={key} pointerEvents="none" style={{ position: 'absolute', left: inset, top: inset, right: inset, bottom: inset, borderWidth: w, borderColor: grad && radius === 0 ? mixHex(c1, c2, 0.5) : c1, borderRadius: Math.max(0, radius - inset), borderStyle: bar.look === 'dashed' ? 'dashed' : bar.look === 'dotted' ? 'dotted' : 'solid' }} />;
  };
  if (bar.look === 'double') { const w = Math.max(1, Math.round(size / 3)); return <>{line(0, w, a, b, 'o')}{line(size - w, w, b, a, 'i')}</>; }
  // Gradient on a circle (or any dashed look): two concentric lines, one per colour, so both colours always show.
  return <>{line(0, size, a, b, 'o')}{grad && radius > 0 ? line(size * 1.7, Math.max(1, size * 0.7), b, a, 'i') : null}</>;
}

/** Frame of a rect / spinning window: a box that grows (and turns) with the window, its border keeps a constant thickness. */
function FrameBar({ v, cfg, W, H, bar, accent }: { v: FxValues; cfg: Cfg; W: number; H: number; bar: StudioBar; accent: string }) {
  const { x: ox, y: oy } = originPx(cfg, W, H);
  const turn = cfg.k === 4;
  const outer = useAnimatedStyle(() => {
    const { e } = grow(cfg, v.p.value);
    return { opacity: v.active.value * barAlpha(bar, v.p.value) * extraRamp(e), transform: turn ? [{ rotate: `${cfg.a0 * (1 - e)}deg` }] : [] } as never;
  }, [cfg, bar]);
  const box = useAnimatedStyle(() => {
    const { s } = grow(cfg, v.p.value);
    const sx = cfg.ax ? s : 1, sy = cfg.ay ? s : 1;
    return { left: ox - ox * sx, top: oy - oy * sy, width: W * sx, height: H * sy };
  }, [cfg, W, H]);
  const { a, b, grad } = paintColors(bar.paint, accent);
  const radius = bar.round ? Math.min(28, bar.size * 4 + 8) : 0;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, transformOrigin: `${ox}px ${oy}px`, zIndex: Z }, outer]}>
      <Animated.View style={[{ position: 'absolute', borderRadius: radius }, bar.glow > 0 ? glowShadow(bar.glow, grad ? mixHex(a, b, 0.5) : a) : null, box]}>
        <Lines bar={bar} accent={accent} radius={radius} />
      </Animated.View>
    </Animated.View>
  );
}

/** Ring of an iris: a circle that grows with the window, its border keeps a constant thickness. */
function RingBar({ v, cfg, W, H, bar, accent }: { v: FxValues; cfg: Cfg; W: number; H: number; bar: StudioBar; accent: string }) {
  const { x: ox, y: oy } = originPx(cfg, W, H);
  const D = circleDiameter(cfg, W, H);
  const st = useAnimatedStyle(() => {
    const { e, s } = grow(cfg, v.p.value);
    const d = D * s;
    return { opacity: v.active.value * barAlpha(bar, v.p.value) * extraRamp(e), left: ox - d / 2, top: oy - d / 2, width: d, height: d, borderRadius: d / 2 };
  }, [cfg, W, H, bar]);
  const { a, b, grad } = paintColors(bar.paint, accent);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', zIndex: Z }, bar.glow > 0 ? glowShadow(bar.glow, grad ? mixHex(a, b, 0.5) : a) : null, st]}>
      <Lines bar={bar} accent={accent} radius={D} />
    </Animated.View>
  );
}

/* ------------------------------ pieces ------------------------------ */
function Piece({ v, cfg, def, style, W, H, i, accent }: { v: FxValues; cfg: Cfg; def: FxDef; style: StudioStyle; W: number; H: number; i: number; accent: string }) {
  const e = style.els;
  const size = pieceSize(e, style.seed, i);
  const half = Math.ceil(size * 0.9);
  const deco = followDeco(e, def, style.seed, i);
  const color = pieceColor(e, i, accent);
  const st = useAnimatedStyle(() => {
    const b = studioPiece(style, def, deco, cfg, W, H, v.p.value, i);
    return { opacity: v.active.value * clamp01(b.o), transform: [{ translateX: b.x - half }, { translateY: b.y - half }, { rotate: `${b.r}deg` }, { scale: b.s }] };
  }, [style, def, cfg, W, H, i]);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 2 * half, height: 2 * half, alignItems: 'center', justifyContent: 'center', zIndex: Z }, st]}>
      <View style={[{ alignItems: 'center', justifyContent: 'center', borderRadius: size }, e.glow > 0 ? glowShadow(e.glow, color) : null]}>
        <Shape shape={pieceShape(e, i)} size={size} color={color} />
      </View>
    </Animated.View>
  );
}

const MAX_PIECES = Array.from({ length: 24 }, (_, i) => i);

/** The Studio's drawn layer for one transition: tint, custom bar, pieces. Only what the style switched on is mounted. */
export function StudioLayer({ v, cfg, def, style, W, H, pr, accent }: { v: FxValues; cfg: Cfg; def: FxDef; style: StudioStyle; W: number; H: number; pr: number; accent: string }) {
  const n = studioPieceCount(style, def, cfg);
  let bar: React.ReactNode = null;
  if (style.bar.mode === 'custom') {
    if (cfg.k === 1) bar = <WipeBar v={v} cfg={cfg} W={W} H={H} pr={pr} bar={style.bar} accent={accent} />;
    else if (cfg.k === 2 || cfg.k === 4) bar = <FrameBar v={v} cfg={cfg} W={W} H={H} bar={style.bar} accent={accent} />;
    else if (cfg.k === 3) bar = <RingBar v={v} cfg={cfg} W={W} H={H} bar={style.bar} accent={accent} />;
  }
  return (
    <>
      {style.tint.on ? <Tint v={v} style={style} /> : null}
      {bar}
      {MAX_PIECES.slice(0, n).map((i) => <Piece key={i} v={v} cfg={cfg} def={def} style={style} W={W} H={H} i={i} accent={accent} />)}
    </>
  );
}
