/**
 * Transition catalogue + geometry maths of the tools-card reveal engine. Pure functions only (no React):
 * the card engine, the admin benchmark and the checks share them.
 *
 * THE TRICK (every effect): the BACK layer is a clipping container holding one photo. Only the container moves
 * (transform + opacity); the photo inside gets the exact INVERSE transform, recomputed from the one progress value `q`
 * on every frame, so the photo never moves relative to the card and only the clipping window does.
 *
 *   wipe   container: rotate(a) translateX(d)        inner: translateX(-d) rotate(-a)
 *   rect   container: scale(sx, sy)  about (ox, oy)  inner: scale(1/sx, 1/sy) about (ox, oy)
 *   circle container: scale(s)       about (ox, oy)  inner: scale(1/s)        about (ox, oy)
 *   fade   container: opacity = q                    (the always-available fallback, id 0)
 *
 * RTL is handled HERE (angles `a -> 180 - a`, origins `ox -> 1 - ox`), never by flipping a photo.
 */
import type { ViewStyle } from 'react-native';
import type { ToolCardsGlobal } from '@/data/types';

/* ------------------------------ catalogue ------------------------------ */
export type Tier = 'safe' | 'medium' | 'heavy';
export type Kind = 'fade' | 'wipe' | 'rect' | 'circle';
export type Ease = 'inOut' | 'back' | 'expo';
/** Small decorative views riding the same progress. Optional: skipped on low-end devices. */
export type Extra = 'none' | 'line' | 'knob' | 'glow' | 'colorbar' | 'sparkle' | 'shine' | 'doorsH' | 'doorsV' | 'frame' | 'ring' | 'flash';

export interface FxDef {
  id: number; kind: Kind; tier: Tier; extra: Extra; ease: Ease;
  /** Wipe: direction of travel in degrees (0 = left to right, 90 = top to bottom, 180 = right to left, -90 = bottom to top). */
  angle?: number;
  /** Wipe: the angle starts here and eases to `angle` (swing). */
  swingFrom?: number;
  /** Rect: which axes grow. Rect / circle: origin as a fraction of the card (0..1). */
  sx?: boolean; sy?: boolean; ox?: number; oy?: number;
}

const wipe = (id: number, tier: Tier, angle: number, extra: Extra = 'line', more: Partial<FxDef> = {}): FxDef => ({ id, kind: 'wipe', tier, angle, extra, ease: 'inOut', ...more });
const rect = (id: number, tier: Tier, sx: boolean, sy: boolean, ox: number, oy: number, extra: Extra = 'none'): FxDef => ({ id, kind: 'rect', tier, sx, sy, ox, oy, extra, ease: 'inOut' });
const circle = (id: number, ox: number, oy: number, extra: Extra = 'none'): FxDef => ({ id, kind: 'circle', tier: 'heavy', ox, oy, extra, ease: 'inOut' });

/** id 0 = cross-fade: always enabled, cannot be turned off, used whenever a chosen effect is disabled or not allowed. */
export const FX: Record<number, FxDef> = {
  0: { id: 0, kind: 'fade', tier: 'safe', extra: 'none', ease: 'inOut' },
  1: wipe(1, 'safe', 0), 2: wipe(2, 'safe', 180), 3: wipe(3, 'safe', 90), 4: wipe(4, 'safe', -90),
  5: wipe(5, 'medium', 35), 6: wipe(6, 'medium', -35), 7: wipe(7, 'medium', 62),
  8: wipe(8, 'safe', 0, 'knob'), 9: wipe(9, 'safe', 0, 'glow'), 10: wipe(10, 'safe', 0, 'colorbar'), 11: wipe(11, 'safe', 0, 'sparkle'),
  12: wipe(12, 'medium', 35, 'shine'),
  13: wipe(13, 'medium', 0, 'line', { swingFrom: 28 }),
  14: wipe(14, 'safe', 0, 'line', { ease: 'back' }),
  15: wipe(15, 'safe', 0, 'line', { ease: 'expo' }),
  16: rect(16, 'safe', true, false, 0.5, 0.5, 'doorsH'), 17: rect(17, 'safe', false, true, 0.5, 0.5, 'doorsV'),
  18: rect(18, 'safe', true, true, 0.5, 0.5), 19: rect(19, 'medium', true, true, 0.5, 0.5, 'frame'),
  20: rect(20, 'medium', true, true, 0, 1), 21: rect(21, 'medium', true, true, 1, 0),
  22: circle(22, 0.5, 0.5), 23: circle(23, 0.5, 0.5, 'ring'), 24: circle(24, 0.5, 0.5, 'flash'),
  25: circle(25, 0, 0), 26: circle(26, 1, 1), 27: circle(27, 0, 0.5), 28: circle(28, 1, 0.5), 29: circle(29, 0.5, 0), 30: circle(30, 0.5, 1),
};

/** The 30 selectable effects (the cross-fade, id 0, is separate: it is always on). */
export const FX_IDS = Array.from({ length: 30 }, (_, i) => i + 1);
export const FX_FADE = 0;
export const TIERS: Record<Tier, number[]> = {
  safe: [1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 16, 17, 18],
  medium: [5, 6, 7, 12, 13, 19, 20, 21],
  heavy: [22, 23, 24, 25, 26, 27, 28, 29, 30],
};
export const TIER_ORDER: Tier[] = ['safe', 'medium', 'heavy'];

/* ------------------------------ availability (admin, global) ------------------------------ */
export interface FxAvail { enabled: Set<number>; lowEnd: Set<number> }

/** Defaults: Safe + Medium are enabled, only Safe is allowed on low-end devices, Heavy is disabled. */
export const DEFAULT_ENABLED = [...TIERS.safe, ...TIERS.medium].sort((a, b) => a - b);
export const DEFAULT_LOW_END = [...TIERS.safe].sort((a, b) => a - b);

const cleanIds = (v: unknown, fallback: number[]) => (Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 30))].sort((a, b) => a - b) : fallback);

/** Stored shape (`settings.toolCards.fxEnabled / fxLowEnd`, plain id lists) -> sets. Missing = defaults. */
export function resolveAvail(g?: ToolCardsGlobal): FxAvail {
  return { enabled: new Set(cleanIds(g?.fxEnabled, DEFAULT_ENABLED)), lowEnd: new Set(cleanIds(g?.fxLowEnd, DEFAULT_LOW_END)) };
}
export const enabledIds = (a: FxAvail) => FX_IDS.filter((id) => a.enabled.has(id));
export const availToStored = (a: FxAvail) => ({ fxEnabled: [...a.enabled].sort((x, y) => x - y), fxLowEnd: [...a.lowEnd].sort((x, y) => x - y) });

/** Nearest ENABLED Safe effect (by id distance, lower id on a tie); 0 (cross-fade) when there is none. */
export function nearestSafe(id: number, a: FxAvail): number {
  let best = 0, bestD = Infinity;
  for (const s of TIERS.safe) {
    if (!a.enabled.has(s)) continue;
    const d = Math.abs(s - id);
    if (d < bestD || (d === bestD && s < best)) { best = s; bestD = d; }
  }
  return best;
}

/**
 * The effect that really plays when a card asked for `id`:
 *  - disabled anywhere -> nearest enabled Safe effect (or the cross-fade);
 *  - low-end device and the effect is not allowed there -> cross-fade.
 */
export function effectiveEffect(id: number, a: FxAvail, lowEnd: boolean): number {
  if (id <= 0 || !FX[id]) return FX_FADE;
  const e = a.enabled.has(id) ? id : nearestSafe(id, a);
  if (e === FX_FADE) return FX_FADE;
  return lowEnd && !a.lowEnd.has(e) ? FX_FADE : e;
}

/* ------------------------------ timing ------------------------------ */
/** One transition lasts TR_BASE / speed seconds; the hold (pause) between two transitions is admin configurable. */
export const TR_BASE = 0.65;
export const HOLD_DEFAULT = 0.9;
export const HOLDS = [0.5, 0.9, 1.5, 2, 3] as const;
export const SPEEDS = [0.5, 1, 1.5, 2] as const;

/** Frame interval above which a frame counts as dropped (~1.5 frames at 60 Hz). */
export const DROP_MS = 25;
/** Runtime guard: more than this many frames slower than SLOW_MS inside one transition marks the device as low-end. */
export const SLOW_MS = 32;
export const SLOW_LIMIT = 3;

export type Verdict = 'smooth' | 'borderline' | 'slow';
/** Benchmark verdict from the average frame time and the share of dropped frames (independent of the display's refresh rate). */
export function verdictOf(avgMs: number, droppedShare: number): Verdict {
  if (avgMs <= 20 && droppedShare <= 0.05) return 'smooth';
  if (avgMs <= 28 && droppedShare <= 0.15) return 'borderline';
  return 'slow';
}

/* ------------------------------ geometry ------------------------------ */
/** Everything the per-frame maths needs about one effect (plain numbers: it is copied into shared values). */
export interface Cfg {
  /** 0 fade, 1 wipe, 2 rect, 3 circle. */
  k: 0 | 1 | 2 | 3;
  /** Wipe angle at q = 0 and q = 1 (degrees, already mirrored for RTL). */
  a0: number; a1: number;
  /** Origin as a fraction of the card (already mirrored for RTL). */
  ox: number; oy: number;
  /** Rect: which axes grow (1 / 0). */
  ax: number; ay: number;
  /** 1 = the angle is a multiple of 90: the travel is rounded to whole physical pixels. */
  snap: number;
  /** Easing: 0 ease-in-out cubic, 1 easeOutBack, 2 easeOutExpo. */
  e: 0 | 1 | 2;
}
export const FADE_CFG: Cfg = { k: 0, a0: 0, a1: 0, ox: 0.5, oy: 0.5, ax: 0, ay: 0, snap: 0, e: 0 };

/** Effect definition -> Cfg, mirrored for RTL. */
export function makeCfg(def: FxDef, rtl: boolean): Cfg {
  const mirrorA = (a: number) => (rtl ? 180 - a : a);
  const mirrorX = (x: number) => (rtl ? 1 - x : x);
  const e = (def.ease === 'back' ? 1 : def.ease === 'expo' ? 2 : 0) as 0 | 1 | 2;
  if (def.kind === 'wipe') {
    const a1 = mirrorA(def.angle ?? 0);
    const a0 = def.swingFrom === undefined ? a1 : mirrorA(def.swingFrom);
    return { k: 1, a0, a1, ox: 0.5, oy: 0.5, ax: 0, ay: 0, snap: a0 === a1 && Math.abs(a1) % 90 === 0 ? 1 : 0, e };
  }
  if (def.kind === 'rect') return { k: 2, a0: 0, a1: 0, ox: mirrorX(def.ox ?? 0.5), oy: def.oy ?? 0.5, ax: def.sx ? 1 : 0, ay: def.sy ? 1 : 0, snap: 0, e };
  if (def.kind === 'circle') return { k: 3, a0: 0, a1: 0, ox: mirrorX(def.ox ?? 0.5), oy: def.oy ?? 0.5, ax: 0, ay: 0, snap: 0, e };
  return FADE_CFG;
}

/** Rect / circle grow from this scale (never lower: the counter-scale of the photo stays at most 5x). */
export const MIN_SCALE = 0.2;
/** Opacity 0 -> 1 during the first 15% of a rect / circle reveal. */
export const FADE_IN = 0.15;
/** Container overscan (px) of a rect container, so no hairline seam shows at the card edge. */
export const OVERSCAN = 2;

const clamp01 = (v: number) => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/**
 * Easing of the linear progress `u` (0..1). Computed on the UI thread, every frame.
 *  0 = ease-in-out cubic, 1 = easeOutBack (overshoots 1 a little, then settles), 2 = easeOutExpo. All return exactly 0 at 0 and exactly 1 at 1.
 */
export function ease(kind: number, u: number): number {
  'worklet';
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (kind === 1) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); }
  if (kind === 2) return 1 - Math.pow(2, -10 * u);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * R = half of the card diagonal + 4, rounded UP to a whole pixel: the wipe window travels from -R to +R.
 * Whole numbers everywhere (R, L = 2R, pivot) keep the container and its counter-transformed photo on the same pixel grid.
 */
export function wipeR(W: number, H: number) {
  'worklet';
  return Math.ceil(Math.sqrt(W * W + H * H) / 2) + 4;
}

/** Wipe pivot = card centre, on whole pixels. */
export const wipePivot = (W: number, H: number) => ({ x: Math.round(W / 2), y: Math.round(H / 2) });
/** Rect / circle origin on whole pixels (the same value drives the container, the inverse transform and the extras). */
export const originPx = (c: Cfg, W: number, H: number) => ({ x: Math.round(c.ox * W), y: Math.round(c.oy * H) });
/** Circle container diameter: 2 x (distance from the origin to the farthest card corner) + 8, as an even whole number. */
export function circleDiameter(c: Cfg, W: number, H: number) {
  const { x, y } = originPx(c, W, H);
  return 2 * Math.ceil(farthestCorner(W, H, x, y)) + 8;
}

export interface LayerFrame {
  /** Container opacity. */
  o: number;
  /** Container transform and the exact inverse transform of the photo inside it. */
  ct: ({ rotate: string } | { translateX: number } | { scaleX: number } | { scaleY: number })[];
  it: ({ rotate: string } | { translateX: number } | { scaleX: number } | { scaleY: number })[];
}

/**
 * The state of a layer at progress `q` (0 = START, 1 = FULL), computed from scratch on every frame (no keyframes).
 * `q` may overshoot 1 for the elastic wipe; rect / circle clamp it.
 */
export function layerFrame(c: Cfg, W: number, H: number, pr: number, q: number): LayerFrame {
  'worklet';
  if (c.k === 1) {
    const R = wipeR(W, H);
    let d = -R + 2 * R * q;
    if (c.snap) d = Math.round(d * pr) / pr;
    const a = c.a0 + (c.a1 - c.a0) * clamp01(q);
    return { o: 1, ct: [{ rotate: `${a}deg` }, { translateX: d }], it: [{ translateX: -d }, { rotate: `${-a}deg` }] };
  }
  if (c.k === 2 || c.k === 3) {
    const e = clamp01(q);
    const s = MIN_SCALE + (1 - MIN_SCALE) * e;
    const sx = c.k === 3 || c.ax ? s : 1;
    const sy = c.k === 3 || c.ay ? s : 1;
    return { o: Math.min(1, e / FADE_IN), ct: [{ scaleX: sx }, { scaleY: sy }], it: [{ scaleX: 1 / sx }, { scaleY: 1 / sy }] };
  }
  // Cross-fade: opacity only (the no-op transform keeps both layers on the same compositing path as the other effects).
  return { o: clamp01(q), ct: [{ translateX: 0 }], it: [{ translateX: 0 }] };
}

/** Opacity of a rect / circle extra: in with the container, out during the last 15% (so nothing pops away when the reveal ends). */
export function extraRamp(q: number) {
  'worklet';
  const e = clamp01(q);
  return Math.min(1, e / FADE_IN) * (1 - clamp01((e - (1 - FADE_IN)) / FADE_IN));
}

/** Farthest card corner from the point (x, y). */
export function farthestCorner(W: number, H: number, x: number, y: number) {
  return Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
}

export interface LayerGeo { box: ViewStyle; inner: ViewStyle }
/**
 * Static geometry (never animated): the clipping container and the photo's box inside it.
 * The photo box is always exactly W x H, placed so that at identity it lines up with the card, and its transform origin is the
 * container's pivot, so the inverse transform cancels the container's transform exactly.
 */
export function layerGeometry(c: Cfg, W: number, H: number): LayerGeo {
  const photo = { position: 'absolute', width: W, height: H } as const;
  if (c.k === 1) {
    // L wide, 2L tall; its right-centre edge (the pivot) sits on the card centre: the window is everything behind the moving edge.
    const L = 2 * wipeR(W, H);
    const { x, y } = wipePivot(W, H);
    return {
      // borderRadius 1 forces an anti-aliased clip path on Android (a plain rect clip is hard-edged once rotated).
      box: { position: 'absolute', left: x - L, top: y - L, width: L, height: 2 * L, overflow: 'hidden', borderRadius: 1, transformOrigin: '100% 50%' },
      inner: { ...photo, left: L - x, top: L - y, transformOrigin: `${x}px ${y}px` },
    };
  }
  if (c.k === 2) {
    const { x, y } = originPx(c, W, H);
    const o = OVERSCAN;
    return {
      box: { position: 'absolute', left: -o, top: -o, width: W + 2 * o, height: H + 2 * o, overflow: 'hidden', transformOrigin: `${x + o}px ${y + o}px` },
      inner: { ...photo, left: o, top: o, transformOrigin: `${x}px ${y}px` },
    };
  }
  if (c.k === 3) {
    const { x, y } = originPx(c, W, H);
    const D = circleDiameter(c, W, H);
    return {
      box: { position: 'absolute', left: x - D / 2, top: y - D / 2, width: D, height: D, overflow: 'hidden', borderRadius: D / 2, transformOrigin: '50% 50%' },
      inner: { ...photo, left: D / 2 - x, top: D / 2 - y, transformOrigin: `${x}px ${y}px` },
    };
  }
  return { box: { position: 'absolute', left: 0, top: 0, width: W, height: H, overflow: 'hidden' }, inner: { ...photo, left: 0, top: 0 } };
}

/* ------------------------------ image crop ------------------------------ */
/**
 * Centered crop rectangle of a `w` x `h` picture to the aspect ratio `ratio` (width / height), in whole pixels.
 * Used by the admin upload (every card image is cropped to the card's shape) and by the checks.
 */
export function cropToRatio(w: number, h: number, ratio: number) {
  if (!(w > 0 && h > 0 && ratio > 0)) return null;
  const wide = w / h > ratio;
  const width = wide ? Math.min(w, Math.round(h * ratio)) : w;
  const height = wide ? h : Math.min(h, Math.round(w / ratio));
  return { originX: Math.floor((w - width) / 2), originY: Math.floor((h - height) / 2), width, height };
}
