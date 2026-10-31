import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { useAnimatedStyle, useDerivedValue } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { FX_COLORS as K } from '@/lib/toolCards';

/**
 * The 20 before/after effects of the home tools card, ported one by one from the reference file
 * "Tools card animations: 20 before/after effects" (same elements, sizes, colours, offsets and easing).
 * Everything is built for LTR (reveal from the left):
 * the stage mirrors the whole zone in RTL and every <Photo/> mirrors itself back, so photos are never flipped.
 *
 * All layers read two shared values, so they run on the UI thread without any React render:
 *   p = reveal progress 0..1, b = sparkle bump (0 -> 1 -> 0).
 * Wipes and curtains animate transform only (window slides, photo counter-slides). Circles, bands and slats must change
 * their size, so they animate layout props of one small clip box (the photos are never reloaded).
 */
type Val = { readonly value: number };
export interface FxCtx {
  /** Stage size (px, measured) and the two animation drivers. Read on the UI thread only. */
  W: Val; H: Val; p: Val; b: Val;
  rtl: boolean; before: string; after: string;
  /** False in the low-end / reduced-motion fade: the camera flash is skipped. */
  flash: boolean;
}
/** Effect 19 draws its own (scaling, fading) BEFORE layer; every other effect sits on top of the stage's plain BEFORE base. */
export const ownsBase = (id: number) => id === 19;

const WC = (Platform.OS === 'web' ? { willChange: 'transform, opacity' } : {}) as object;
const FILL = StyleSheet.absoluteFill;

/** One photo, filling its parent. Mirrors itself in RTL so the mirrored stage shows it the right way round. */
export function Photo({ uri, rtl, onLoad }: { uri: string; rtl: boolean; onLoad?: () => void }) {
  return <Image source={{ uri }} style={[FILL, rtl ? { transform: [{ scaleX: -1 }] } : null]} contentFit="cover" cachePolicy="memory-disk" transition={0} recyclingKey={uri} onLoad={onLoad} onError={onLoad} accessible={false} />;
}

/* ------------------------------ building blocks ------------------------------ */

/** AFTER seen through a window that slides in from the left (x) or down from the top (y). Transform only. */
function SlideAfter({ c, axis = 'x' }: { c: FxCtx; axis?: 'x' | 'y' }) {
  const win = useAnimatedStyle(() => {
    const size = axis === 'x' ? c.W.value : c.H.value;
    const d = c.p.value * size - size;
    return { transform: [axis === 'x' ? { translateX: d } : { translateY: d }] };
  });
  const inner = useAnimatedStyle(() => {
    const size = axis === 'x' ? c.W.value : c.H.value;
    const d = size - c.p.value * size;
    return { transform: [axis === 'x' ? { translateX: d } : { translateY: d }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[FILL, { overflow: 'hidden' }, WC, win]}>
      <Animated.View style={[FILL, WC, inner]}><Photo uri={c.after} rtl={c.rtl} /></Animated.View>
    </Animated.View>
  );
}

/** Soft wipe (effect 2). The reference mask is `linear-gradient(90deg,#000 40%,transparent 60%)` at 250% width: a feather 50% of the width wide whose far edge sits at p x 150%. */
const SOFT_LAYERS = 12;
const SOFT_FEATHER = 0.5;
/** Edge of soft-wipe layer m (1 = outermost). Layers are spaced evenly across the feather. */
function softEdge(c: FxCtx, m: number) {
  'worklet';
  const W = c.W.value;
  return c.p.value * W * (1 + SOFT_FEATHER) - (SOFT_FEATHER * W * (m - 1)) / SOFT_LAYERS;
}

/**
 * Radius of a reveal circle. CSS `circle(p x k%)` measures k% against sqrt((W^2+H^2)/2); we use the same reference so the speed is identical,
 * and never less than what covers the card at p = 1 (the reference leaves a corner of tall or very wide cards uncovered).
 */
function coverR(k: number, W: number, H: number, corner: boolean) {
  'worklet';
  const need = (corner ? Math.hypot(W, H) : Math.hypot(W, H) / 2) + 1;
  return Math.max(k * Math.sqrt((W * W + H * H) / 2), need);
}

/** Feathered edge: stacked windows whose opacities 1/L, 1/(L-1) ... 1 add up to a smooth 0 -> 100% ramp. */
function SoftWipe({ c }: { c: FxCtx }) {
  return <>{Array.from({ length: SOFT_LAYERS }, (_, i) => <SoftLayer key={i} c={c} m={i + 1} />)}</>;
}
function SoftLayer({ c, m }: { c: FxCtx; m: number }) {
  const win = useAnimatedStyle(() => {
    const e = softEdge(c, m);
    return { opacity: 1 / (SOFT_LAYERS + 1 - m), transform: [{ translateX: e - c.W.value }] };
  });
  const inner = useAnimatedStyle(() => {
    const e = softEdge(c, m);
    return { transform: [{ translateX: c.W.value - e }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[FILL, { overflow: 'hidden' }, WC, win]}>
      <Animated.View style={[FILL, WC, inner]}><Photo uri={c.after} rtl={c.rtl} /></Animated.View>
    </Animated.View>
  );
}

/** 2px white divider, full height, sitting on the wipe edge (offset = 0) or moving with the band edges (split doors). */
function Line({ c, side = 0 }: { c: FxCtx; side?: -1 | 0 | 1 }) {
  const st = useAnimatedStyle(() => {
    const x = side === 0 ? c.p.value * c.W.value : c.W.value / 2 + (side * c.p.value * c.W.value) / 2;
    return { transform: [{ translateX: x }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, backgroundColor: '#FFFFFF' }, WC, st]} />;
}

/** Coloured bar(s) riding the edge: `pct` % of the width in total, its front at p x front x W. */
function Bar({ c, colors, pct, front }: { c: FxCtx; colors: string[]; pct: number; front: number }) {
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: c.p.value * front * c.W.value - (c.W.value * pct) / 100 }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pct}%`, flexDirection: 'row' }, WC, st]}>
      {colors.map((col) => <View key={col} style={{ flex: 1, backgroundColor: col }} />)}
    </Animated.View>
  );
}

/** 4px amber bar on the bottom edge of the falling curtain. */
function CurtainBar({ c }: { c: FxCtx }) {
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: c.p.value * c.H.value - 2 }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: 4, backgroundColor: K.amber }, WC, st]} />;
}

/** AFTER cross-fades in (opacity = p). */
function FadeAfter({ c }: { c: FxCtx }) {
  const st = useAnimatedStyle(() => ({ opacity: c.p.value }));
  return <Animated.View pointerEvents="none" style={[FILL, WC, st]}><Photo uri={c.after} rtl={c.rtl} /></Animated.View>;
}

/** White flash popping over the swap (opacity = b x 0.9). */
function Flash({ c }: { c: FxCtx }) {
  const st = useAnimatedStyle(() => ({ opacity: c.b.value * 0.9 }));
  return <Animated.View pointerEvents="none" style={[FILL, { backgroundColor: '#FFFFFF' }, WC, st]} />;
}

/** Zoom twinkle (effect 19): BEFORE fades out while growing 1 -> 1.3, AFTER fades in while growing 0.7 -> 1. */
function ZoomBefore({ c, onLoad }: { c: FxCtx; onLoad?: () => void }) {
  const st = useAnimatedStyle(() => ({ opacity: 1 - c.p.value, transform: [{ scale: 1 + 0.3 * c.p.value }] }));
  return <Animated.View pointerEvents="none" style={[FILL, WC, st]}><Photo uri={c.before} rtl={c.rtl} onLoad={onLoad} /></Animated.View>;
}
function ZoomAfter({ c }: { c: FxCtx }) {
  const st = useAnimatedStyle(() => ({ opacity: c.p.value, transform: [{ scale: 0.7 + 0.3 * c.p.value }] }));
  return <Animated.View pointerEvents="none" style={[FILL, WC, st]}><Photo uri={c.after} rtl={c.rtl} /></Animated.View>;
}

type BoxKind = 'circle' | 'corner' | 'band' | 'hslat' | 'vslat';
/**
 * AFTER seen through a box whose size follows p: a circle from the centre (radius p x k x W), a circle from the top corner,
 * a band growing from the centre, or one of 8 horizontal / vertical slats that each open to p x slat size.
 */
function BoxClip({ c, kind, k = 1, i = 0 }: { c: FxCtx; kind: BoxKind; k?: number; i?: number }) {
  const box = useDerivedValue(() => {
    const p = c.p.value, W = c.W.value, H = c.H.value;
    let left = 0, top = 0, width = W, height = H, r = 0;
    if (kind === 'circle') { r = p * coverR(k, W, H, false); left = W / 2 - r; top = H / 2 - r; width = 2 * r; height = 2 * r; }
    else if (kind === 'corner') { r = p * coverR(k, W, H, true); left = -r; top = -r; width = 2 * r; height = 2 * r; }
    else if (kind === 'band') { width = p * W; left = (W - width) / 2; }
    else if (kind === 'hslat') { const h = H / 8; top = i * h; height = p * h; }
    else { const w = W / 8; left = i * w; width = p * w; }
    return { left, top, width, height, r };
  });
  const win = useAnimatedStyle(() => ({ left: box.value.left, top: box.value.top, width: box.value.width, height: box.value.height, borderRadius: box.value.r }));
  const inner = useAnimatedStyle(() => ({ left: -box.value.left, top: -box.value.top, width: c.W.value, height: c.H.value }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', overflow: 'hidden' }, WC, win]}>
      <Animated.View style={[{ position: 'absolute' }, inner]}><Photo uri={c.after} rtl={c.rtl} /></Animated.View>
    </Animated.View>
  );
}

/** Pulse ring (effect 17): 3px coral circle, diameter p x 133% of the width, opacity = b. */
function Ring({ c }: { c: FxCtx }) {
  const st = useAnimatedStyle(() => {
    const d = 1.33 * c.p.value * c.W.value;
    return { opacity: c.b.value, left: c.W.value / 2 - d / 2, top: c.H.value / 2 - d / 2, width: d, height: d, borderRadius: d / 2 };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', borderWidth: 3, borderColor: K.coral }, WC, st]} />;
}

/**
 * Diagonal wipe (effect 9): the top edge reaches p x 140% of the width, the bottom edge p x 100%.
 * A tall window rotates about the middle of its right edge; the photo inside counter-rotates so it stays still.
 */
function DiagWipe({ c }: { c: FxCtx }) {
  const win = useAnimatedStyle(() => {
    const xm = 1.2 * c.p.value * c.W.value;
    const a = c.H.value > 0 ? Math.atan((0.4 * c.p.value * c.W.value) / c.H.value) : 0;
    return { transform: [{ translateX: xm }, { rotate: `${a}rad` }] };
  });
  const inner = useAnimatedStyle(() => {
    const xm = 1.2 * c.p.value * c.W.value;
    const a = c.H.value > 0 ? Math.atan((0.4 * c.p.value * c.W.value) / c.H.value) : 0;
    return { transform: [{ rotate: `${-a}rad` }, { translateX: -xm }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: '300%', height: '300%', left: '-300%', top: '-100%', overflow: 'hidden', transformOrigin: 'right center' }, WC, win]}>
      <Animated.View style={[{ position: 'absolute', width: '33.3334%', height: '33.3334%', left: '100%', top: '33.3334%', transformOrigin: 'left center' }, WC, inner]}>
        <Photo uri={c.after} rtl={c.rtl} />
      </Animated.View>
    </Animated.View>
  );
}

/**
 * How a sparkle travels (all values are the reference file's calc() expressions):
 *  edge    : left = p x 100% (rides the wipe edge)       xy      : moves p x (dx, dy) px from its base point
 *  diag    : left = p x 120% + off px (diagonal wipe)     fallpct : top = H x (p x k - c)  (falling stars)
 */
type Move = { kind: 'none' } | { kind: 'edge' } | { kind: 'xy'; dx: number; dy: number } | { kind: 'diag'; off: number } | { kind: 'fallpct'; k: number; c: number };
/** 5-point star (or 8px dot): opacity = b, scale = 0.3 + b (stars only). `left` / `top` are the base position, `move` the travel. */
function Spark({ c, size = 16, color, left, top, move = { kind: 'none' }, dot }: { c: FxCtx; size?: number; color: string; left: string; top: string; move?: Move; dot?: boolean }) {
  const st = useAnimatedStyle(() => {
    const p = c.p.value, b = c.b.value;
    let tx = 0, ty = 0;
    if (move.kind === 'edge') tx = p * c.W.value;
    else if (move.kind === 'xy') { tx = p * move.dx; ty = p * move.dy; }
    else if (move.kind === 'diag') tx = 1.2 * p * c.W.value + move.off;
    else if (move.kind === 'fallpct') ty = c.H.value * (p * move.k - move.c);
    return { opacity: b, transform: [{ translateX: tx }, { translateY: ty }, { scale: dot ? 1 : 0.3 + b }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: left as `${number}%`, top: top as `${number}%`, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2, alignItems: 'center', justifyContent: 'center' }, dot ? { borderRadius: size / 2, backgroundColor: color } : null, WC, st]}>
      {dot ? null : <Icon name="star" size={size} color={color} />}
    </Animated.View>
  );
}

/* ------------------------------ the 20 effects ------------------------------ */
const { gold, white, pink, coral, teal, purple, amber, blue } = K;

const xy = (dx: number, dy: number): Move => ({ kind: 'xy', dx, dy });

/** Layers drawn above the BEFORE photo for effect `id`. Every number below is copied from the reference file. */
export function renderEffect(id: number, c: FxCtx, onBaseLoad?: () => void): React.ReactNode {
  switch (id) {
    case 1: return <><SlideAfter c={c} /><Line c={c} /></>;
    case 2: return <SoftWipe c={c} />;
    case 3: return <>
      <SlideAfter c={c} />
      <Spark c={c} left="0%" top="18%" color={gold} size={16} move={{ kind: 'edge' }} />
      <Spark c={c} left="0%" top="42%" color={white} size={20} move={{ kind: 'edge' }} />
      <Spark c={c} left="0%" top="66%" color={pink} size={16} move={{ kind: 'edge' }} />
      <Spark c={c} left="0%" top="86%" color={gold} size={12} move={{ kind: 'edge' }} />
    </>;
    case 4: return <><SlideAfter c={c} /><Bar c={c} colors={[coral]} pct={18} front={1.18} /></>;
    case 5: return <><SlideAfter c={c} /><Bar c={c} colors={[teal]} pct={18} front={1.18} /></>;
    case 6: return <><SlideAfter c={c} /><Bar c={c} colors={[purple]} pct={18} front={1.18} /></>;
    case 7: return <><SlideAfter c={c} /><Bar c={c} colors={[coral, amber, teal]} pct={30} front={1.3} /></>;
    case 8: return <>
      <BoxClip c={c} kind="circle" k={0.75} />
      <Spark c={c} left="50%" top="50%" color={gold} move={xy(62, 0)} />
      <Spark c={c} left="50%" top="50%" color={pink} move={xy(31, 40)} />
      <Spark c={c} left="50%" top="50%" color={white} move={xy(-31, 40)} />
      <Spark c={c} left="50%" top="50%" color={gold} move={xy(-62, 0)} />
      <Spark c={c} left="50%" top="50%" color={pink} move={xy(-31, -40)} />
      <Spark c={c} left="50%" top="50%" color={white} move={xy(31, -40)} />
    </>;
    case 9: return <>
      <DiagWipe c={c} />
      <Spark c={c} left="0%" top="50%" color={gold} size={28} move={{ kind: 'diag', off: 0 }} />
      <Spark c={c} left="0%" top="30%" color={white} size={12} move={{ kind: 'diag', off: -18 }} />
      <Spark c={c} left="0%" top="72%" color={pink} size={14} move={{ kind: 'diag', off: -14 }} />
    </>;
    case 10: return <><BoxClip c={c} kind="band" /><Line c={c} side={-1} /><Line c={c} side={1} /></>;
    case 11: return <>{Array.from({ length: 8 }, (_, i) => <BoxClip key={i} c={c} kind="hslat" i={i} />)}</>;
    case 12: return <>{Array.from({ length: 8 }, (_, i) => <BoxClip key={i} c={c} kind="vslat" i={i} />)}</>;
    case 13: return <><SlideAfter c={c} axis="y" /><CurtainBar c={c} /></>;
    case 14: return <><FadeAfter c={c} />{c.flash ? <Flash c={c} /> : null}</>;
    case 15: return <>
      <FadeAfter c={c} />
      <Spark c={c} dot size={8} color={coral} left="50%" top="50%" move={xy(70, -30)} />
      <Spark c={c} dot size={8} color={teal} left="50%" top="50%" move={xy(-70, -24)} />
      <Spark c={c} dot size={8} color={amber} left="50%" top="50%" move={xy(40, 45)} />
      <Spark c={c} dot size={8} color={purple} left="50%" top="50%" move={xy(-45, 40)} />
      <Spark c={c} dot size={8} color={pink} left="50%" top="50%" move={xy(0, -48)} />
      <Spark c={c} dot size={8} color={blue} left="50%" top="50%" move={xy(78, 18)} />
    </>;
    case 16: return <>
      <FadeAfter c={c} />
      <Spark c={c} left="15%" top="0%" color={gold} size={16} move={{ kind: 'fallpct', k: 1.2, c: 0.1 }} />
      <Spark c={c} left="35%" top="0%" color={white} size={12} move={{ kind: 'fallpct', k: 1.1, c: 0.2 }} />
      <Spark c={c} left="55%" top="0%" color={pink} size={16} move={{ kind: 'fallpct', k: 1.3, c: 0.08 }} />
      <Spark c={c} left="75%" top="0%" color={gold} size={20} move={{ kind: 'fallpct', k: 1.15, c: 0.15 }} />
      <Spark c={c} left="90%" top="0%" color={white} size={12} move={{ kind: 'fallpct', k: 1.25, c: 0.05 }} />
    </>;
    case 17: return <><BoxClip c={c} kind="circle" k={0.75} /><Ring c={c} /></>;
    case 18: return <>
      <BoxClip c={c} kind="corner" k={1.3} />
      <Spark c={c} left="14%" top="18%" color={gold} size={20} />
      <Spark c={c} left="32%" top="10%" color={white} size={12} />
      <Spark c={c} left="10%" top="42%" color={pink} size={14} />
    </>;
    case 19: return <>
      <ZoomBefore c={c} onLoad={onBaseLoad} /><ZoomAfter c={c} />
      <Spark c={c} left="12%" top="15%" color={gold} size={16} />
      <Spark c={c} left="88%" top="20%" color={white} size={12} />
      <Spark c={c} left="85%" top="82%" color={pink} size={12} />
    </>;
    case 20: return <><SlideAfter c={c} /><Line c={c} /></>;
    default: return null;
  }
}

/** Component form of renderEffect (keeps callbacks out of plain function calls during render). */
export function Effect({ id, c, onBaseLoad }: { id: number; c: FxCtx; onBaseLoad?: () => void }) {
  return <>{renderEffect(id, c, onBaseLoad)}</>;
}
