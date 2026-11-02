import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { MIN_SCALE, circleDiameter, decoAt, decoColor, decoCount, ease, extraRamp, layerFrame, layerGeometry, originPx, wipePivot, wipeR, withAlpha, type Cfg, type Deco, type Extra, type FxDef, type Shape as DecoShape } from '@/lib/toolCardFx';
import type { FxValues } from './useTransition';

/**
 * The two identical layers of a card (L0, L1) + the optional extras.
 *
 * Layer = clipping container (overflow hidden) holding ONE photo of exactly the card's size. At rest one layer is FRONT (FULL state, static)
 * and the other is BACK (START state, invisible, holding the next photo). During a transition only the BACK container's transform / opacity
 * change, and the photo inside gets the exact inverse transform, recomputed from `p` on every frame in ONE worklet (a derived value shared
 * by the container and its photo, so both always use the same frame). Nothing else moves: no width / height / clip-path / mask / blur.
 *
 * z-order is plain React state, changed only while the layer is hidden (the BACK layer sits above FRONT, invisible until p > 0), so no
 * animated zIndex is needed and the role swap on the UI thread never changes what is on top.
 */
const WILL_CHANGE = Platform.OS === 'web';

function Layer({ idx, uri, cfg, W, H, pr, z, v, raster, onLoad, onError }: {
  idx: 0 | 1; uri: string | null; cfg: Cfg; W: number; H: number; pr: number; z: number; v: FxValues; raster: boolean;
  onLoad: (idx: 0 | 1, uri: string) => void; onError: (idx: 0 | 1, uri: string) => void;
}) {
  const geo = useMemo(() => layerGeometry(cfg, W, H), [cfg, W, H]);
  const sv = idx === 0 ? v.cfg0 : v.cfg1;
  const frame = useDerivedValue(() => {
    const c = sv.value;
    // FRONT: FULL state (q = 1), static.
    if (v.backIdx.value !== idx) { const f = layerFrame(c, W, H, pr, 1); return { o: 1, ct: f.ct, it: f.it }; }
    const p = v.p.value;
    // BACK, waiting: START state, invisible.
    if (p <= 0) { const f = layerFrame(c, W, H, pr, 0); return { o: 0, ct: f.ct, it: f.it }; }
    return layerFrame(c, W, H, pr, ease(c.e, p));
  }, [W, H, pr]);
  const boxStyle = useAnimatedStyle(() => ({ opacity: frame.value.o, transform: frame.value.ct as never }));
  const innerStyle = useAnimatedStyle(() => ({ transform: frame.value.it as never }));
  // Native: rasterize the two layers only while a transition runs. Web: the equivalent compositing hint.
  const hint = Platform.OS === 'web' ? ({ willChange: raster ? 'transform, opacity' : 'auto' } as object) : null;
  const native = Platform.OS === 'web' ? null : { renderToHardwareTextureAndroid: raster, shouldRasterizeIOS: raster };
  return (
    <Animated.View pointerEvents="none" style={[geo.box, { zIndex: z }, hint, boxStyle]} {...native}>
      <Animated.View style={[geo.inner, innerStyle]}>
        {uri ? (
          <Image
            source={{ uri }} style={{ width: W, height: H }} contentFit="cover" contentPosition="center"
            cachePolicy="memory-disk" transition={0} recyclingKey={uri} accessible={false}
            onLoad={() => onLoad(idx, uri)} onDisplay={() => onLoad(idx, uri)} onError={() => onError(idx, uri)}
          />
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

/* ------------------------------ extras (optional visuals) ------------------------------ */
const WHITE = '#FFFFFF';
const EXTRA_Z = 5;
void WILL_CHANGE;

/** A small view riding the wipe edge: same container geometry and transform as the wipe window, no clipping, no photo. */
function WipeRider({ v, cfg, W, H, pr, x, accent }: { v: FxValues; cfg: Cfg; W: number; H: number; pr: number; x: Extra; accent: string }) {
  const L = 2 * wipeR(W, H);
  const { x: px, y: py } = wipePivot(W, H);
  const st = useAnimatedStyle(() => {
    const f = layerFrame(cfg, W, H, pr, ease(cfg.e, v.p.value));
    return { opacity: v.active.value, transform: f.ct as never };
  }, [cfg, W, H, pr]);
  const sparkle = useAnimatedStyle(() => ({ opacity: Math.sin(Math.PI * Math.min(1, Math.max(0, v.p.value))) }));
  const edge = (w: number, more: object) => ({ position: 'absolute', left: L - w, top: 0, width: w, height: 2 * L, ...more }) as const;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: px - L, top: py - L, width: L, height: 2 * L, transformOrigin: '100% 50%', zIndex: EXTRA_Z }, st]}>
      {x === 'line' || x === 'knob' || x === 'sparkle' || x === 'ribbon' ? <View style={{ position: 'absolute', left: L - 1, top: 0, width: 2, height: 2 * L, backgroundColor: WHITE }} /> : null}
      {x === 'knob' ? <View style={{ position: 'absolute', left: L - 15, top: L - 15, width: 30, height: 30, borderRadius: 15, backgroundColor: WHITE }} /> : null}
      {x === 'glow' ? <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={edge(32, {})} /> : null}
      {x === 'ribbon' ? (
        <LinearGradient colors={[withAlpha(accent, 0), withAlpha(accent, 0.55), WHITE]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={edge(64, {})} />
      ) : null}
      {x === 'colorbar' ? <View style={edge(16, { backgroundColor: accent })} /> : null}
      {x === 'shine' ? (
        <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', left: L - 20, top: 0, width: 40, height: 2 * L, transform: [{ skewX: '-20deg' }] }} />
      ) : null}
      {x === 'sparkle' ? (
        <Animated.View style={[{ position: 'absolute', left: L - 7, top: L - H * 0.3, width: 14, height: H * 0.6, alignItems: 'center', justifyContent: 'space-between' }, sparkle]}>
          <Icon name="star" size={14} color={WHITE} /><Icon name="star" size={14} color={WHITE} /><Icon name="star" size={14} color={WHITE} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Rect / circle growth at progress p (same formula as the layer: scale 0.2 -> 1). */
const grow = (cfg: Cfg, p: number) => {
  'worklet';
  const e = Math.min(1, Math.max(0, ease(cfg.e, p)));
  return { e, s: MIN_SCALE + (1 - MIN_SCALE) * e };
};

/** One door: a 2px white line that travels with one edge of the growing window (horizontal doors: left / right, vertical: up / down). */
function Door({ v, cfg, W, H, vertical, sign }: { v: FxValues; cfg: Cfg; W: number; H: number; vertical: boolean; sign: 1 | -1 }) {
  const half = (vertical ? H : W) / 2;
  const st = useAnimatedStyle(() => {
    const { e, s } = grow(cfg, v.p.value);
    const t = sign * s * half;
    return { opacity: v.active.value * extraRamp(e), transform: [vertical ? { translateY: t } : { translateX: t }] };
  }, [cfg, W, H]);
  const base = vertical
    ? ({ position: 'absolute', left: 0, top: Math.round(H / 2) - 1, width: W, height: 2, backgroundColor: WHITE, zIndex: EXTRA_Z } as const)
    : ({ position: 'absolute', left: Math.round(W / 2) - 1, top: 0, width: 2, height: H, backgroundColor: WHITE, zIndex: EXTRA_Z } as const);
  return <Animated.View pointerEvents="none" style={[base, st]} />;
}

/** Frame zoom: a 2px white frame the size of the card, scaling with the window about the same origin. */
function Frame({ v, cfg, W, H }: { v: FxValues; cfg: Cfg; W: number; H: number }) {
  const { x, y } = originPx(cfg, W, H);
  const st = useAnimatedStyle(() => {
    const { e, s } = grow(cfg, v.p.value);
    // A spinning window (kind 4) turns its frame with it: same rotate-then-scale order as the window's own transform.
    const turn = cfg.k === 4 ? [{ rotate: `${cfg.a0 * (1 - e)}deg` }] : [];
    return { opacity: v.active.value * extraRamp(e), transform: [...turn, { scaleX: s }, { scaleY: s }] };
  }, [cfg]);
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: W, height: H, borderWidth: 2, borderColor: WHITE, transformOrigin: `${x}px ${y}px`, zIndex: EXTRA_Z }, st]} />;
}

/** Iris ring: a 2px white circle with the diameter of the circle container, scaling with it; it fades in the last 15% (out, so nothing pops). */
function Ring({ v, cfg, W, H }: { v: FxValues; cfg: Cfg; W: number; H: number }) {
  const { x, y } = originPx(cfg, W, H);
  const D = circleDiameter(cfg, W, H);
  const st = useAnimatedStyle(() => {
    const { e, s } = grow(cfg, v.p.value);
    return { opacity: v.active.value * extraRamp(e), transform: [{ scale: s }] };
  }, [cfg]);
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: x - D / 2, top: y - D / 2, width: D, height: D, borderRadius: D / 2, borderWidth: 2, borderColor: WHITE, transformOrigin: '50% 50%', zIndex: EXTRA_Z }, st]} />;
}

/** Iris flash: white overlay, opacity = sin(pi p) x 0.55. */
function Flash({ v }: { v: FxValues }) {
  const st = useAnimatedStyle(() => ({ opacity: v.active.value * 0.55 * Math.sin(Math.PI * Math.min(1, Math.max(0, v.p.value))) }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: WHITE, zIndex: EXTRA_Z }, st]} />;
}

/** The six clean flat shapes of the Creative tier, drawn with plain views (no images, no icon font). */
function Shape({ shape, size, color }: { shape: DecoShape; size: number; color: string }) {
  const t = Math.max(2, Math.round(size / 7));
  switch (shape) {
    case 'ring': return <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: t, borderColor: color }} />;
    case 'diamond': { const d = size * 0.72; return <View style={{ width: d, height: d, backgroundColor: color, borderRadius: 2, transform: [{ rotate: '45deg' }] }} />; }
    case 'plus': return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: size, height: t + 1, borderRadius: 2, backgroundColor: color }} />
        <View style={{ position: 'absolute', width: t + 1, height: size, borderRadius: 2, backgroundColor: color }} />
      </View>
    );
    case 'bar': return <View style={{ width: size * 0.34, height: size * 1.5, borderRadius: size * 0.17, backgroundColor: color }} />;
    case 'tri': return <View style={{ width: 0, height: 0, borderLeftWidth: size * 0.5, borderRightWidth: size * 0.5, borderBottomWidth: size * 0.86, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />;
    default: return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
  }
}

/**
 * One Creative piece (dot, ring, diamond, plus, bar, triangle) riding the effect: position / scale / opacity / turn come from `decoAt`, the same
 * maths as the window it decorates. One derived worklet per piece, transform + opacity only, nothing allocated outside it.
 */
function DecoView({ v, cfg, deco, W, H, i, accent }: { v: FxValues; cfg: Cfg; deco: Deco; W: number; H: number; i: number; accent: string }) {
  const half = Math.ceil(deco.size * 0.75);
  const st = useAnimatedStyle(() => {
    const b = decoAt(deco, cfg, W, H, v.p.value, i);
    return { opacity: v.active.value * b.o, transform: [{ translateX: b.x - half }, { translateY: b.y - half }, { rotate: `${b.r}deg` }, { scale: b.s }] };
  }, [deco, cfg, W, H, i]);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 2 * half, height: 2 * half, alignItems: 'center', justifyContent: 'center', zIndex: EXTRA_Z }, st]}>
      <Shape shape={deco.shape} size={deco.size} color={decoColor(deco, i, accent)} />
    </Animated.View>
  );
}

const PIECES = Array.from({ length: 12 }, (_, i) => i);

/** The extras of one effect. They only use transform / opacity and ride the same progress `p`. Rendered only when allowed (never on low-end devices). */
export function Extras({ v, cfg, def, W, H, pr, accent }: { v: FxValues; cfg: Cfg; def: FxDef; W: number; H: number; pr: number; accent: string }) {
  const n = decoCount(def);
  const pieces = def.deco && n ? PIECES.slice(0, n).map((i) => <DecoView key={i} v={v} cfg={cfg} deco={def.deco as Deco} W={W} H={H} i={i} accent={accent} />) : null;
  let core: React.ReactNode = null;
  switch (def.extra) {
    case 'line': case 'knob': case 'glow': case 'colorbar': case 'sparkle': case 'shine': case 'ribbon':
      core = <WipeRider v={v} cfg={cfg} W={W} H={H} pr={pr} x={def.extra} accent={accent} />; break;
    case 'doorsH': core = <><Door v={v} cfg={cfg} W={W} H={H} vertical={false} sign={-1} /><Door v={v} cfg={cfg} W={W} H={H} vertical={false} sign={1} /></>; break;
    case 'doorsV': core = <><Door v={v} cfg={cfg} W={W} H={H} vertical sign={-1} /><Door v={v} cfg={cfg} W={W} H={H} vertical sign={1} /></>; break;
    case 'frame': core = <Frame v={v} cfg={cfg} W={W} H={H} />; break;
    case 'ring': core = <Ring v={v} cfg={cfg} W={W} H={H} />; break;
    case 'flash': core = <Flash v={v} />; break;
    default: break;
  }
  return <>{core}{pieces}</>;
}

/** The stage content: exactly W x H, always LTR (RTL is handled by the effects' maths; a photo is never mirrored). */
export function RevealStack({ W, H, pr, v, uris, cfgs, back, raster, extra, accent, onLoad, onError }: {
  W: number; H: number; pr: number; v: FxValues; uris: [string | null, string | null]; cfgs: [Cfg, Cfg]; back: 0 | 1; raster: boolean;
  extra: { def: FxDef; cfg: Cfg } | null; accent: string; onLoad: (idx: 0 | 1, uri: string) => void; onError: (idx: 0 | 1, uri: string) => void;
}) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'hidden', direction: 'ltr' }}>
      <Layer idx={0} uri={uris[0]} cfg={cfgs[0]} W={W} H={H} pr={pr} z={back === 0 ? 2 : 1} v={v} raster={raster} onLoad={onLoad} onError={onError} />
      <Layer idx={1} uri={uris[1]} cfg={cfgs[1]} W={W} H={H} pr={pr} z={back === 1 ? 2 : 1} v={v} raster={raster} onLoad={onLoad} onError={onError} />
      {extra ? <Extras v={v} cfg={extra.cfg} def={extra.def} W={W} H={H} pr={pr} accent={accent} /> : null}
    </View>
  );
}
