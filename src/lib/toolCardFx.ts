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
export type Tier = 'safe' | 'medium' | 'heavy' | 'creative';
export type Kind = 'fade' | 'wipe' | 'rect' | 'circle' | 'spin';
export type Ease = 'inOut' | 'back' | 'expo' | 'elastic' | 'bounce' | 'snap';
/** Small decorative views riding the same progress. Optional: skipped on low-end devices. */
export type Extra = 'none' | 'line' | 'knob' | 'glow' | 'colorbar' | 'sparkle' | 'shine' | 'ribbon' | 'doorsH' | 'doorsV' | 'frame' | 'ring' | 'flash';

/** Shapes of the small decorative pieces of the Creative tier (clean, flat, white and / or the accent colour). */
export type Shape = 'dot' | 'ring' | 'diamond' | 'plus' | 'bar' | 'tri';
/**
 * How the pieces move (all derived from the window's own maths, see `decoAt`):
 *   wipe:   tail (a comet trailing the edge) | beads (spread along the edge) | scan (one piece sliding up and down the edge) | wave (beads swaying)
 *   circle: orbit (a few pieces revolving on the iris ring) | rim (a beaded ring) | burst (pieces thrown out of the origin)
 *   rect / spin: corners (the four corners of the window) | far (only the corners that travel)
 */
export type Path = 'tail' | 'beads' | 'scan' | 'wave' | 'orbit' | 'rim' | 'burst' | 'corners' | 'far';
export interface Deco { shape: Shape; path: Path; n: number; color: 'white' | 'accent' | 'mix'; size: number }

export interface FxDef {
  id: number; kind: Kind; tier: Tier; extra: Extra; ease: Ease;
  /** Wipe: direction of travel in degrees (0 = left to right, 90 = top to bottom, 180 = right to left, -90 = bottom to top). Spin: the angle the window starts rotated by. */
  angle?: number;
  /** Creative tier: the decorative pieces riding the window. */
  deco?: Deco;
  /** Wipe: the angle starts here and eases to `angle` (swing). */
  swingFrom?: number;
  /** Rect: which axes grow. Rect / circle: origin as a fraction of the card (0..1). */
  sx?: boolean; sy?: boolean; ox?: number; oy?: number;
}

const wipe = (id: number, tier: Tier, angle: number, extra: Extra = 'line', more: Partial<FxDef> = {}): FxDef => ({ id, kind: 'wipe', tier, angle, extra, ease: 'inOut', ...more });
const rect = (id: number, tier: Tier, sx: boolean, sy: boolean, ox: number, oy: number, extra: Extra = 'none'): FxDef => ({ id, kind: 'rect', tier, sx, sy, ox, oy, extra, ease: 'inOut' });
const circle = (id: number, ox: number, oy: number, extra: Extra = 'none', tier: Tier = 'heavy', more: Partial<FxDef> = {}): FxDef => ({ id, kind: 'circle', tier, ox, oy, extra, ease: 'inOut', ...more });
const spin = (id: number, angle: number, ox: number, oy: number, extra: Extra, more: Partial<FxDef> = {}): FxDef => ({ id, kind: 'spin', tier: 'creative', angle, ox, oy, sx: true, sy: true, extra, ease: 'inOut', ...more });
const D = (shape: Shape, path: Path, n: number, color: Deco['color'] = 'white', size = 14): Deco => ({ shape, path, n, color, size });
const C = 'creative' as const;

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
  // Creative (31-60): the same window maths + new eases + a spinning window, each with clean flat pieces (dots, rings, diamonds, plus signs, bars,
  // triangles) that ride the window. No stars.
  31: wipe(31, C, 0, 'line', { deco: D('dot', 'tail', 4) }),
  32: wipe(32, C, 90, 'line', { deco: D('dot', 'tail', 4, 'accent') }),
  33: wipe(33, C, 35, 'line', { deco: D('ring', 'tail', 3, 'accent') }),
  34: wipe(34, C, 0, 'line', { deco: D('dot', 'beads', 5, 'white', 12) }),
  35: wipe(35, C, 90, 'line', { deco: D('ring', 'beads', 4, 'white', 16) }),
  36: wipe(36, C, -90, 'line', { deco: D('diamond', 'beads', 5, 'mix', 14) }),
  37: wipe(37, C, 0, 'line', { deco: D('dot', 'scan', 1, 'accent', 20) }),
  38: wipe(38, C, 90, 'line', { deco: D('diamond', 'scan', 2, 'white', 16) }),
  39: wipe(39, C, 0, 'none', { deco: D('dot', 'wave', 7, 'mix', 10) }),
  40: wipe(40, C, 35, 'glow', { deco: D('plus', 'wave', 5, 'white', 14) }),
  41: wipe(41, C, 0, 'ribbon', { deco: D('bar', 'beads', 3, 'white', 18) }),
  42: wipe(42, C, -35, 'ribbon', { deco: D('tri', 'tail', 3, 'white', 14) }),
  43: wipe(43, C, 0, 'line', { ease: 'elastic', deco: D('ring', 'beads', 3, 'accent', 16) }),
  44: wipe(44, C, 180, 'glow', { ease: 'elastic', deco: D('dot', 'scan', 1, 'white', 18) }),
  45: wipe(45, C, 0, 'colorbar', { ease: 'bounce', deco: D('bar', 'tail', 3, 'white', 18) }),
  46: wipe(46, C, 35, 'ribbon', { ease: 'bounce', deco: D('dot', 'wave', 5, 'white', 12) }),
  47: wipe(47, C, 90, 'shine', { swingFrom: 62, deco: D('dot', 'beads', 4, 'white', 12) }),
  48: wipe(48, C, 0, 'line', { ease: 'snap', deco: D('diamond', 'tail', 4, 'mix', 14) }),
  49: spin(49, 90, 0.5, 0.5, 'frame', { deco: D('diamond', 'corners', 4) }),
  50: spin(50, -90, 0.5, 0.5, 'frame', { deco: D('dot', 'corners', 4, 'accent') }),
  51: spin(51, 120, 0, 0, 'none', { deco: D('plus', 'corners', 4) }),
  52: spin(52, -120, 1, 1, 'none', { deco: D('ring', 'corners', 4, 'accent', 16) }),
  53: spin(53, 180, 0.5, 0.5, 'frame', { ease: 'back', deco: D('tri', 'corners', 4) }),
  54: { id: 54, kind: 'rect', tier: C, sx: false, sy: true, ox: 0.5, oy: 1, extra: 'none', ease: 'back', deco: D('ring', 'far', 2, 'accent', 16) },
  55: circle(55, 0.5, 0.5, 'ring', C, { deco: D('dot', 'rim', 10, 'white', 8) }),
  56: circle(56, 0.5, 0.5, 'ring', C, { deco: D('dot', 'orbit', 3, 'accent', 14) }),
  57: circle(57, 0.5, 0.5, 'none', C, { ease: 'expo', deco: D('dot', 'burst', 8, 'white', 10) }),
  58: circle(58, 0, 0.5, 'ring', C, { deco: D('diamond', 'orbit', 3, 'white', 14) }),
  59: circle(59, 1, 0, 'ring', C, { deco: D('plus', 'rim', 8, 'mix', 12) }),
  60: circle(60, 0, 1, 'none', C, { ease: 'back', deco: D('ring', 'burst', 6, 'accent', 14) }),
};

/** Highest effect id. The selectable effects are 1..FX_MAX (the cross-fade, id 0, is separate: it is always on). */
export const FX_MAX = 60;
export const FX_IDS = Array.from({ length: FX_MAX }, (_, i) => i + 1);
export const FX_FADE = 0;
export const TIERS: Record<Tier, number[]> = {
  safe: [1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 16, 17, 18],
  medium: [5, 6, 7, 12, 13, 19, 20, 21],
  heavy: [22, 23, 24, 25, 26, 27, 28, 29, 30],
  creative: Array.from({ length: 30 }, (_, i) => 31 + i),
};
export const TIER_ORDER: Tier[] = ['safe', 'medium', 'heavy', 'creative'];

/* ------------------------------ availability (admin, global) ------------------------------ */
export interface FxAvail { enabled: Set<number>; lowEnd: Set<number> }

/** Defaults: Safe + Medium are enabled, only Safe is allowed on low-end devices, Heavy and Creative are disabled (the admin opts in). */
export const DEFAULT_ENABLED = [...TIERS.safe, ...TIERS.medium].sort((a, b) => a - b);
export const DEFAULT_LOW_END = [...TIERS.safe].sort((a, b) => a - b);

const cleanIds = (v: unknown, fallback: number[]) => (Array.isArray(v) ? [...new Set(v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= FX_MAX))].sort((a, b) => a - b) : fallback);

/** Stored shape (`settings.toolCards.fxEnabled / fxLowEnd`, plain id lists) -> sets. Missing = defaults. */
export function resolveAvail(g?: ToolCardsGlobal): FxAvail {
  return { enabled: new Set(cleanIds(g?.fxEnabled, DEFAULT_ENABLED)), lowEnd: new Set(cleanIds(g?.fxLowEnd, DEFAULT_LOW_END)) };
}
export const enabledIds = (a: FxAvail) => FX_IDS.filter((id) => a.enabled.has(id));
export const availToStored = (a: FxAvail) => ({ fxEnabled: [...a.enabled].sort((x, y) => x - y), fxLowEnd: [...a.lowEnd].sort((x, y) => x - y) });

/* ------------------------------ tier checkboxes (admin) ------------------------------ */
export type TierState = 'all' | 'some' | 'none';
/** State of a tier checkbox: every effect of the tier enabled / only some / none. */
export function tierState(tier: Tier, a: FxAvail): TierState {
  const on = TIERS[tier].filter((id) => a.enabled.has(id)).length;
  return on === 0 ? 'none' : on === TIERS[tier].length ? 'all' : 'some';
}
/**
 * Tapping a tier checkbox: when the whole tier is on it is switched off, otherwise (none or some) it is switched fully on.
 * Switching a tier off also removes its low-end permission (an effect that cannot play at all cannot play on low-end either);
 * switching it on touches nothing else (the low-end permissions stay exactly as the admin set them).
 */
export function toggleTier(tier: Tier, a: FxAvail): FxAvail {
  const enabled = new Set(a.enabled), lowEnd = new Set(a.lowEnd);
  if (tierState(tier, a) === 'all') TIERS[tier].forEach((id) => { enabled.delete(id); lowEnd.delete(id); });
  else TIERS[tier].forEach((id) => enabled.add(id));
  return { enabled, lowEnd };
}

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
/** Hold between two transitions (seconds): 0 = the next transition starts at once. Continuous range, the admin uses a slider. */
export const HOLD_MIN = 0;
export const HOLD_MAX = 5;
export const HOLD_STEP = 0.1;
/** Animation speed multiplier: 0.2 = five times slower than the base duration, 2 = twice as fast. */
export const SPEED_MIN = 0.2;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.1;
export const SPEED_DEFAULT = 1;

/** Whole tenths (0.1 steps), free of floating point noise (0.30000000000000004). */
export const roundTenth = (v: number) => Math.round(v * 10) / 10;
const clampTo = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, roundTenth(v))) : fallback);
export const clampHold = (v: unknown) => clampTo(v, HOLD_MIN, HOLD_MAX, HOLD_DEFAULT);
export const clampSpeed = (v: unknown) => clampTo(v, SPEED_MIN, SPEED_MAX, SPEED_DEFAULT);

/** Frame interval above which a frame counts as dropped (~1.5 frames at 60 Hz). */
export const DROP_MS = 25;
/** A frame slower than this is "slow" (~2 frames at 60 Hz). */
export const SLOW_MS = 32;

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
  /** 0 fade, 1 wipe, 2 rect, 3 circle, 4 spin (a rect that turns: a0 = the starting angle). */
  k: 0 | 1 | 2 | 3 | 4;
  /** Wipe angle at q = 0 and q = 1 (degrees, already mirrored for RTL). */
  a0: number; a1: number;
  /** Origin as a fraction of the card (already mirrored for RTL). */
  ox: number; oy: number;
  /** Rect: which axes grow (1 / 0). */
  ax: number; ay: number;
  /** 1 = the angle is a multiple of 90: the travel is rounded to whole physical pixels. */
  snap: number;
  /** Easing: 0 ease-in-out cubic, 1 easeOutBack, 2 easeOutExpo, 3 easeOutElastic, 4 easeOutBounce, 5 ease-in-out quint, 6 cubic-bezier, 7 spring, 8 linear, 9 anticipate, 10 steps. */
  e: number;
  /** Easing parameters: cubic-bezier [x1, y1, x2, y2], spring [wobbles, damping], steps [n]. Unused by the other easings. */
  ep: number[];
  /** Photo motion (Animation Studio): arrival zoom of the incoming photo, departure zoom of the covered photo, push of the covered photo along a wipe (share of the edge speed). */
  zi: number; zo: number; pu: number;
}
export const FADE_CFG: Cfg = { k: 0, a0: 0, a1: 0, ox: 0.5, oy: 0.5, ax: 0, ay: 0, snap: 0, e: 0, ep: [0, 0, 0, 0], zi: 0, zo: 0, pu: 0 };

/** What the Animation Studio may override on an effect's own window maths (null / undefined = keep the effect's own value). */
export interface CfgOverride {
  e?: number; ep?: number[];
  /** Wipe: direction of travel (degrees, LTR). Spin: the angle the window starts rotated by. */
  angle?: number | null;
  /** Wipe: the angle starts `sweep` degrees away from `angle` and eases to it. */
  sweep?: number | null;
  ox?: number | null; oy?: number | null;
  zi?: number; zo?: number; pu?: number;
}

/** Effect definition -> Cfg, mirrored for RTL. `ov` = the Animation Studio's overrides (easing, angle, origin, photo motion). */
export function makeCfg(def: FxDef, rtl: boolean, ov?: CfgOverride | null): Cfg {
  const mirrorA = (a: number) => (rtl ? 180 - a : a);
  const mirrorX = (x: number) => (rtl ? 1 - x : x);
  const e = ov?.e ?? ({ inOut: 0, back: 1, expo: 2, elastic: 3, bounce: 4, snap: 5 } as const)[def.ease] ?? 0;
  const ep = ov?.ep && ov.ep.length ? [ov.ep[0] ?? 0, ov.ep[1] ?? 0, ov.ep[2] ?? 0, ov.ep[3] ?? 0] : [0, 0, 0, 0];
  const zi = ov?.zi ?? 0, zo = ov?.zo ?? 0;
  const num = (v: number | null | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  if (def.kind === 'wipe') {
    const base = num(ov?.angle, def.angle ?? 0);
    const a1 = mirrorA(base);
    const swing = ov?.sweep != null ? (ov.sweep === 0 ? undefined : base + ov.sweep) : def.swingFrom;
    const a0 = swing === undefined ? a1 : mirrorA(swing);
    return { k: 1, a0, a1, ox: 0.5, oy: 0.5, ax: 0, ay: 0, snap: a0 === a1 && Math.abs(a1) % 90 === 0 ? 1 : 0, e, ep, zi, zo, pu: a0 === a1 ? ov?.pu ?? 0 : 0 };
  }
  const ox = mirrorX(num(ov?.ox, def.ox ?? 0.5)), oy = num(ov?.oy, def.oy ?? 0.5);
  if (def.kind === 'rect') return { k: 2, a0: 0, a1: 0, ox, oy, ax: def.sx ? 1 : 0, ay: def.sy ? 1 : 0, snap: 0, e, ep, zi, zo, pu: 0 };
  if (def.kind === 'spin') { const a = num(ov?.angle, def.angle ?? 90); return { k: 4, a0: rtl ? -a : a, a1: 0, ox, oy, ax: 1, ay: 1, snap: 0, e, ep, zi, zo, pu: 0 }; }
  if (def.kind === 'circle') return { k: 3, a0: 0, a1: 0, ox, oy, ax: 0, ay: 0, snap: 0, e, ep, zi, zo, pu: 0 };
  return { ...FADE_CFG, e, ep, zi, zo };
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
 *  0 = ease-in-out cubic, 1 = easeOutBack (overshoots 1 a little, then settles), 2 = easeOutExpo, 3 = elastic (damped rubber-band wobble, overshoot up to ~1.3),
 *  4 = easeOutBounce, 5 = ease-in-out quint (snappy). All return exactly 0 at 0 and exactly 1 at 1.
 */
export function ease(kind: number, u: number, ep?: number[]): number {
  'worklet';
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (kind === 1) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2); }
  if (kind === 2) return 1 - Math.pow(2, -10 * u);
  // Elastic (rubber band): a damped oscillation around 1 that zero-crosses at 1/7, 3/7, 5/7 and 1: first overshoot ~+30%, then it springs back
  // ~14% short (the edge is visibly pulled back inside the card), then a small second overshoot and it settles on exactly 1.
  if (kind === 3) return 1 - Math.exp(-3.6 * u) * Math.cos(3.5 * Math.PI * u);
  if (kind === 4) {
    const n1 = 7.5625, d1 = 2.75;
    if (u < 1 / d1) return n1 * u * u;
    if (u < 2 / d1) { const t = u - 1.5 / d1; return n1 * t * t + 0.75; }
    if (u < 2.5 / d1) { const t = u - 2.25 / d1; return n1 * t * t + 0.9375; }
    const t = u - 2.625 / d1; return n1 * t * t + 0.984375;
  }
  if (kind === 5) return u < 0.5 ? 16 * u * u * u * u * u : 1 - Math.pow(-2 * u + 2, 5) / 2;
  if (kind === 6) {
    // cubic-bezier(x1, y1, x2, y2) like CSS: bisection on x (monotone because x1, x2 are kept in 0..1), then y.
    const x1 = ep ? ep[0] : 0.4, y1 = ep ? ep[1] : 0, x2 = ep ? ep[2] : 0.2, y2 = ep ? ep[3] : 1;
    let lo = 0, hi = 1, t = u;
    for (let i = 0; i < 16; i++) {
      t = (lo + hi) / 2;
      const m = 1 - t;
      const x = 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t;
      if (x < u) lo = t; else hi = t;
    }
    const m = 1 - t;
    return 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t;
  }
  if (kind === 7) {
    // Spring: damped oscillation with `wobbles` whole swings; cos((w + 1/2) pi) = 0 at u = 1, so it settles on exactly 1.
    const w = ep ? Math.round(ep[0]) : 3, d = ep ? ep[1] : 3.6;
    return 1 - Math.exp(-d * u) * Math.cos((w + 0.5) * Math.PI * u);
  }
  if (kind === 8) return u;
  if (kind === 9) { const c2 = 1.70158 * 1.525; return u < 0.5 ? (Math.pow(2 * u, 2) * ((c2 + 1) * 2 * u - c2)) / 2 : (Math.pow(2 * u - 2, 2) * ((c2 + 1) * (2 * u - 2) + c2) + 2) / 2; }
  if (kind === 10) { const n = ep ? Math.max(2, Math.round(ep[0])) : 5; return Math.min(1, (Math.floor(u * n) + 1) / n); }
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/** Highest value the easing reaches over the transition (>= 1): sizes the wipe container's trailing spare so an overshoot never exposes the covered picture. */
export function maxQ(c: Cfg): number {
  let m = 1;
  for (let i = 1; i < 96; i++) m = Math.max(m, ease(c.e, i / 96, c.ep));
  return m;
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
  ct: Tr[];
  it: Tr[];
}
export type Tr = { rotate: string } | { translateX: number } | { translateY: number } | { scaleX: number } | { scaleY: number } | { scale: number };

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
  if (c.k === 4) {
    // Spin: the rect window turns from a0 to 0 while it grows; the photo gets the exact inverse (scale^-1 after rotate^-1).
    const e = clamp01(q);
    const s = MIN_SCALE + (1 - MIN_SCALE) * e;
    const a = c.a0 * (1 - e);
    return { o: Math.min(1, e / FADE_IN), ct: [{ rotate: `${a}deg` }, { scaleX: s }, { scaleY: s }], it: [{ scaleX: 1 / s }, { scaleY: 1 / s }, { rotate: `${-a}deg` }] };
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

/* ------------------------------ photo motion (Animation Studio) ------------------------------ */
/** Extra motion of a photo inside its window: zoom about `motionOrigin` + a translation in card pixels. Identity = { s: 1, tx: 0, ty: 0 }. */
export interface PhotoMotion { s: number; tx: number; ty: number }

/** The point the photo zoom is about: the same point as the photo's own transform origin (card centre for wipes, the window origin for rect / circle / spin). */
export function motionOrigin(c: Cfg, W: number, H: number) {
  'worklet';
  if (c.k >= 2) return { x: Math.round(c.ox * W), y: Math.round(c.oy * H) };
  return { x: Math.round(W / 2), y: Math.round(H / 2) };
}

/** The INCOMING photo: arrives zoomed in by `zi` and settles to 1 while the window opens. Never below 1, so the photo always covers the window. */
export function backMotion(c: Cfg, q: number): PhotoMotion {
  'worklet';
  const e = q < 0 ? 0 : q > 1 ? 1 : q;
  return { s: 1 + c.zi * (1 - e), tx: 0, ty: 0 };
}

/**
 * The COVERED photo: it keeps growing by `zo` while the incoming one covers it and, on a wipe, it is pushed along the edge's direction of travel
 * (`pu` = share of the edge travel, 0..1). The push never exceeds the part already covered by the incoming picture, so no gap ever shows.
 */
export function frontMotion(c: Cfg, W: number, H: number, q: number): PhotoMotion {
  'worklet';
  const e = q < 0 ? 0 : q > 1 ? 1 : q;
  let tx = 0, ty = 0;
  if (c.k === 1 && c.pu > 0) {
    const a = (c.a1 * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const ext = Math.abs(ca) * W + Math.abs(sa) * H;
    const R = Math.ceil(Math.sqrt(W * W + H * H) / 2) + 4;
    const te = ext / 2 - R + 2 * R * e;
    const sh = c.pu * (te < 0 ? 0 : te > ext ? ext : te);
    tx = ca * sh; ty = sa * sh;
  }
  return { s: 1 + c.zo * e, tx, ty };
}

/** Transform list for a photo motion (appended to the photo's inverse transform; translation first, then the zoom about the photo's origin). */
export function motionTransform(m: PhotoMotion): Tr[] {
  'worklet';
  return [{ translateX: m.tx }, { translateY: m.ty }, { scale: m.s }];
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
    // The trailing side is R / 2 longer than the travel needs: an elastic / spring ease overshoots (q up to ~1.3; the spare is a full R then; the Studio's spring / bezier eases get a spare computed from their real maximum, see maxQ) and a back ease a little (~1.1), and without this spare the
    // container's far end would leave the card edge uncovered for a moment and the previous picture would show through.
    const T = c.e === 3 ? wipeR(W, H) : c.e <= 5 ? Math.ceil(wipeR(W, H) / 2) : Math.ceil(wipeR(W, H) * Math.max(0.5, 2 * (maxQ(c) - 1) + 0.25));
    return {
      // borderRadius 1 forces an anti-aliased clip path on Android (a plain rect clip is hard-edged once rotated).
      box: { position: 'absolute', left: x - L - T, top: y - L, width: L + T, height: 2 * L, overflow: 'hidden', borderRadius: 1, transformOrigin: '100% 50%' },
      inner: { ...photo, left: L + T - x, top: L - y, transformOrigin: `${x}px ${y}px` },
    };
  }
  if (c.k === 2 || c.k === 4) {
    const { x, y } = originPx(c, W, H);
    const o = OVERSCAN;
    return {
      // The spinning window also gets the anti-aliased clip trick of the wipe (a plain rect clip is hard-edged once rotated on Android).
      box: { position: 'absolute', left: -o, top: -o, width: W + 2 * o, height: H + 2 * o, overflow: 'hidden', ...(c.k === 4 ? { borderRadius: 1 } : null), transformOrigin: `${x + o}px ${y + o}px` },
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

/* ------------------------------ creative pieces ------------------------------ */
/** One decorative piece at progress `p`: centre (card pixels), scale, opacity, rotation (degrees). */
export interface Badge { x: number; y: number; s: number; o: number; r: number }

/** Corners (0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right) that travel while a rect window grows: the others stay on the card corner. */
export function farCorners(ax: number, ay: number, ox: number, oy: number): number[] {
  const list: number[] = [];
  for (let j = 0; j < 4; j++) {
    const cx = j % 2, cy = j >= 2 ? 1 : 0;
    const okx = !ax || Math.abs(ox - 0.5) < 0.01 || (ox < 0.5 ? cx === 1 : cx === 0);
    const oky = !ay || Math.abs(oy - 0.5) < 0.01 || (oy < 0.5 ? cy === 1 : cy === 0);
    if (okx && oky) list.push(j);
  }
  return list;
}

/** True when an effect has anything to draw on top of the window (a classic extra and / or creative pieces). */
export const hasExtras = (def: FxDef) => def.extra !== 'none' || !!def.deco;

/** How many pieces an effect shows (0 for every effect without a `deco`). */
export function decoCount(def: FxDef, cfg?: Cfg): number {
  const d = def.deco;
  if (!d) return 0;
  if (d.path !== 'far') return d.n;
  // `cfg` carries the Studio's origin override; without it the effect's own origin is used.
  return cfg ? farCorners(cfg.ax, cfg.ay, cfg.ox, cfg.oy).length : farCorners(def.kind === 'spin' || def.sx ? 1 : 0, def.kind === 'spin' || def.sy ? 1 : 0, def.ox ?? 0.5, def.oy ?? 0.5).length;
}

/** Colour of piece `i`: white, the accent colour, or alternating (mix). */
export const decoColor = (d: Deco, i: number, accent: string) => (d.color === 'accent' || (d.color === 'mix' && i % 2) ? accent : '#FFFFFF');

/**
 * Piece `i` of the effect decoration `d` at progress `p`, from scratch every frame (pure, UI-thread safe: no allocations beyond one small
 * object). It uses the very same maths as the window it rides (wipe edge / iris ring / growing or turning rect), so it can never drift from
 * it, and only moves through transform + opacity: no layout, no mask, no blur.
 */
export function decoAt(d: Deco, c: Cfg, W: number, H: number, p: number, i: number, spread = 1, turn = 0.75): Badge {
  'worklet';
  const TAU = 2 * Math.PI;
  const q = ease(c.e, p, c.ep);
  const e = q < 0 ? 0 : q > 1 ? 1 : q;
  const s = MIN_SCALE + (1 - MIN_SCALE) * e;
  const ramp = Math.min(1, e / FADE_IN) * (1 - Math.min(1, Math.max(0, (e - (1 - FADE_IN)) / FADE_IN)));
  const pp = p < 0 ? 0 : p > 1 ? 1 : p;
  const n = d.n < 1 ? 1 : d.n;
  const bar = d.shape === 'bar';
  const spin = turn * 360 * pp + i * 30;
  if (c.k === 1) {
    const R = Math.ceil(Math.sqrt(W * W + H * H) / 2) + 4;
    const dist0 = -R + 2 * R * q;
    const adeg = c.a0 + (c.a1 - c.a0) * e;
    const a = (adeg * Math.PI) / 180;
    const ar = (c.a1 * Math.PI) / 180;
    // Length of the card along the wipe edge: pieces are spread over 80% of it.
    const extent = Math.abs(Math.sin(ar)) * W + Math.abs(Math.cos(ar)) * H;
    const gap = d.size * 1.6 * spread;
    const step = (0.8 * extent * spread) / Math.max(1, n - 1);
    let back = 0, dy = 0, sc = 1, op = 1;
    if (d.path === 'tail') { back = i * gap; sc = 1 - 0.17 * i; op = 1 - 0.22 * i; }
    else if (d.path === 'beads') { dy = (i - (n - 1) / 2) * step; sc = 0.85 + 0.15 * Math.sin(TAU * (pp * 2 + i / n)); }
    else if (d.path === 'scan') dy = 0.38 * extent * Math.sin(TAU * (pp * 1.5 + i / n));
    else if (d.path === 'wave') { dy = (i - (n - 1) / 2) * step; back = gap * 0.8 * Math.sin(TAU * (pp * 2 + i / n)); }
    const dist = dist0 - back;
    const px = Math.round(W / 2), py = Math.round(H / 2);
    return { x: px + Math.cos(a) * dist - Math.sin(a) * dy, y: py + Math.sin(a) * dist + Math.cos(a) * dy, s: sc, o: op, r: bar ? adeg + 90 : spin };
  }
  const ox = Math.round(c.ox * W), oy = Math.round(c.oy * H);
  if (c.k === 3) {
    const far = Math.max(Math.sqrt(ox * ox + oy * oy), Math.sqrt((W - ox) * (W - ox) + oy * oy), Math.sqrt(ox * ox + (H - oy) * (H - oy)), Math.sqrt((W - ox) * (W - ox) + (H - oy) * (H - oy)));
    const half = Math.ceil(far) + 4; // radius of the circle container; the iris window is `half * s`
    let th = 0, rad = half * s, sc = 1, op = ramp;
    // Origin at the card centre: pieces use the whole ring. Origin on an edge / in a corner: only the arc that faces the card is on screen, so the
    // pieces are spread over that arc (about 160 degrees from an edge, 90 from a corner) and sway inside it.
    const mx = W / 2 - ox, my = H / 2 - oy;
    const centred = Math.abs(mx) < 2 && Math.abs(my) < 2;
    const span = Math.abs(mx) < 2 || Math.abs(my) < 2 ? 2.7 : 1.2;
    const f = n > 1 ? i / (n - 1) : 0.5;
    let facing = Math.atan2(my, mx) + (f - 0.5) * span;
    if (Math.abs(mx) >= 2 && Math.abs(my) >= 2) {
      // Corner origin: spread the pieces over the quadrant that holds the card (a little away from both card edges).
      const ax = mx > 0 ? 0 : Math.PI, ay = my > 0 ? Math.PI / 2 : ax === Math.PI ? 1.5 * Math.PI : -Math.PI / 2;
      facing = ax + (ay - ax) * (0.1 + 0.8 * f);
    }
    if (d.path === 'orbit') {
      if (centred) th = ((-90 + 300 * pp) * Math.PI) / 180 + (i * TAU) / n;
      else th = facing + 0.12 * span * Math.sin(TAU * (pp * 1.5 + i / n));
    }
    else if (d.path === 'rim') {
      if (centred) th = (i * TAU) / n + (110 * pp * Math.PI) / 180;
      else th = facing + 0.06 * span * Math.sin(TAU * pp + i);
      sc = i % 2 ? 0.65 : 1;
    }
    else { th = centred ? (i * TAU) / n + 0.4 : facing; rad = half * 0.75 * e; sc = Math.sin(Math.PI * e); op = Math.min(1, 2 * sc); } // burst
    return { x: ox + Math.cos(th) * rad, y: oy + Math.sin(th) * rad, s: sc, o: op, r: bar ? (th * 180) / Math.PI + 90 : spin };
  }
  // rect (2) / spin (4): a corner of the window.
  const ang = c.k === 4 ? (c.a0 * (1 - e) * Math.PI) / 180 : 0;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let j = i;
  if (d.path === 'far') {
    let k = 0;
    for (let t = 0; t < 4; t++) {
      const cx = t % 2, cy = t >= 2 ? 1 : 0;
      const okx = !c.ax || Math.abs(c.ox - 0.5) < 0.01 || (c.ox < 0.5 ? cx === 1 : cx === 0);
      const oky = !c.ay || Math.abs(c.oy - 0.5) < 0.01 || (c.oy < 0.5 ? cy === 1 : cy === 0);
      if (okx && oky) { if (k === i) { j = t; break; } k++; }
    }
  }
  const ux = ((j % 2 ? W : 0) - ox) * (c.ax ? s : 1), uy = ((j >= 2 ? H : 0) - oy) * (c.ay ? s : 1);
  return { x: ox + ca * ux - sa * uy, y: oy + sa * ux + ca * uy, s: 1, o: ramp, r: bar ? (ang * 180) / Math.PI : 270 * e + j * 45 };
}

/** `#RRGGBB` / `#RGB` colour with an alpha (other colour strings are returned unchanged). */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
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
