/**
 * Animation Studio: the style layer on top of the transition catalogue (lib/toolCardFx.ts). Pure functions only (no React): the live engine,
 * the studio stage, the video renderer and the checks share them.
 *
 * A `StudioStyle` is ONE small JSON document. It is stored globally (`settings.toolCards.studio`, every card) and / or per card
 * (`tool.media.fx.studio`, replaces the global one for that card). Its DEFAULT value changes nothing: every part says "auto" / "effect",
 * so a card without a style looks exactly as before.
 *
 *   motion  how the window moves        easing (incl. cubic-bezier / spring / steps), direction mode, angle, sweep, origin, photo zoom + push
 *   bar     the edge line               size, look (solid / double / dashed / dotted), paint (white / accent / colour / gradient), glow, trail
 *   els     animated elements           shape, count, size, motion type (follow the transition / random / burst / rain / ...), colours
 *   tint    colour wash over the photo  solid or 3-stop gradient, angle, amount, when it peaks
 *   force   one main transition for every card
 */
import { MIN_SCALE, ease, farCorners, decoAt, wipeR, type Badge, type Cfg, type CfgOverride, type Deco, type FxDef, type Path, type Shape } from './toolCardFx';
import { hash } from './cardVideoPlan';

/* ------------------------------ model ------------------------------ */
export type EaseKey = 'auto' | 'inOut' | 'back' | 'expo' | 'elastic' | 'bounce' | 'snap' | 'bezier' | 'spring' | 'linear' | 'anticipate' | 'steps';
export const EASE_KEYS: EaseKey[] = ['auto', 'inOut', 'linear', 'expo', 'snap', 'back', 'anticipate', 'elastic', 'spring', 'bounce', 'steps', 'bezier'];
/** Numeric id used by `ease()` in lib/toolCardFx.ts. */
export const EASE_ID: Record<Exclude<EaseKey, 'auto'>, number> = { inOut: 0, back: 1, expo: 2, elastic: 3, bounce: 4, snap: 5, bezier: 6, spring: 7, linear: 8, anticipate: 9, steps: 10 };

export type PaintKind = 'white' | 'accent' | 'custom' | 'gradient';
/** A colour: white, the accent colour, a custom colour, or a gradient c1 -> c2 (`ang` = direction in degrees, 0 = left to right, 90 = top to bottom). */
export interface Paint { kind: PaintKind; c1: string; c2: string; ang: number }

export type BarMode = 'effect' | 'custom' | 'off';
export type BarLook = 'solid' | 'double' | 'dashed' | 'dotted';
export interface StudioBar {
  mode: BarMode;
  /** Thickness (px). Wipe: the edge bar. Rect / spin: the frame border. Circle: the ring border. */
  size: number;
  look: BarLook;
  paint: Paint;
  opacity: number;
  /** Soft light on both sides of the bar (px, 0 = none). */
  glow: number;
  /** Gradient trail behind the edge (px, wipe only, 0 = none); '' colour = the bar colour. */
  trail: number; trailColor: string;
  round: boolean;
  /** Fade in at the start and out at the end of the transition. */
  fade: boolean;
}

export type PieceShape = Shape | 'star' | 'heart' | 'hex' | 'spark' | 'moon' | 'bolt' | 'mixed';
export const PIECE_SHAPES: PieceShape[] = ['dot', 'ring', 'diamond', 'plus', 'bar', 'tri', 'star', 'spark', 'heart', 'hex', 'moon', 'bolt', 'mixed'];
const MIXED: Exclude<PieceShape, 'mixed'>[] = ['dot', 'diamond', 'star', 'ring', 'plus', 'heart', 'spark', 'tri', 'hex'];
export type PieceMotion = 'follow' | 'random' | 'burst' | 'rain' | 'rise' | 'drift' | 'swirl' | 'twinkle';
export const PIECE_MOTIONS: PieceMotion[] = ['follow', 'random', 'burst', 'rain', 'rise', 'drift', 'swirl', 'twinkle'];
export type PieceColors = 'white' | 'accent' | 'mix' | 'palette';
export interface StudioEls {
  mode: BarMode;
  shape: PieceShape;
  count: number;
  size: number;
  /** 0 = all the same size, 1 = sizes vary a lot. */
  sizeVar: number;
  motion: PieceMotion;
  /** Motion `follow`: the path along the window ('auto' = the effect's own path, or a sensible one for its kind). */
  path: Path | 'auto';
  /** Motion `follow`: how far apart the pieces travel (0.4 - 2). */
  spread: number;
  /** Whole turns each piece makes during the transition (-3 .. 3). */
  spin: number;
  opacity: number;
  colors: PieceColors;
  palette: string[];
  glow: number;
  /** 0 = every piece starts together, 1 = births spread over the whole transition. */
  stagger: number;
  /** 0 = steady size, 1 = pieces pulse. */
  pulse: number;
}

export interface StudioTint {
  on: boolean;
  kind: 'solid' | 'gradient';
  c1: string; c2: string; c3: string;
  ang: number;
  amount: number;
  peak: 'mid' | 'start' | 'end';
}

export type DirMode = 'auto' | 'fixed' | 'alternate' | 'random';
export interface StudioMotion {
  dir: DirMode;
  angle: number;
  /** Wipe: the edge starts this many degrees off and swings to its angle (null = the effect's own). */
  sweep: number | null;
  origin: boolean; ox: number; oy: number;
  /** Photo motion: the new photo arrives zoomed in by this much (0 - 0.6) and settles; the old one keeps growing by `zoomOut`; `push` drags the old one along a wipe (0 - 1). */
  zoomIn: number; zoomOut: number; push: number;
}

export interface StudioStyle {
  v: 1;
  /** 0 = every card keeps its own transitions; 1-60 = this transition on every card. */
  force: number;
  /** '' = the theme's accent colour. */
  accent: string;
  /** Seeds every random choice (piece positions, random directions): same seed = same look. */
  seed: number;
  ease: EaseKey;
  bz: number[];
  sp: number[];
  steps: number;
  motion: StudioMotion;
  bar: StudioBar;
  els: StudioEls;
  tint: StudioTint;
}

const WHITE = '#FFFFFF';
export const DEFAULT_PAINT: Paint = { kind: 'white', c1: WHITE, c2: '#FFD60A', ang: 90 };
export const DEFAULT_STUDIO: StudioStyle = {
  v: 1, force: 0, accent: '', seed: 7, ease: 'auto', bz: [0.4, 0, 0.2, 1], sp: [3, 3.6], steps: 6,
  motion: { dir: 'auto', angle: 0, sweep: null, origin: false, ox: 0.5, oy: 0.5, zoomIn: 0, zoomOut: 0, push: 0 },
  bar: { mode: 'effect', size: 2, look: 'solid', paint: DEFAULT_PAINT, opacity: 1, glow: 0, trail: 0, trailColor: '', round: false, fade: false },
  els: { mode: 'effect', shape: 'dot', count: 6, size: 14, sizeVar: 0.3, motion: 'follow', path: 'auto', spread: 1, spin: 0.75, opacity: 1, colors: 'white', palette: ['#FFFFFF', '#FFD60A', '#FF4D8D', '#38BDF8'], glow: 0, stagger: 0.3, pulse: 0 },
  tint: { on: false, kind: 'gradient', c1: '#FF4D8D', c2: '#FFD60A', c3: '', ang: 135, amount: 0.45, peak: 'mid' },
};

/* ------------------------------ sanitising ------------------------------ */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, min: number, max: number, d: number, step = 0) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return d;
  const c = Math.min(max, Math.max(min, v));
  // toFixed keeps 0.3 as 0.3 (0.05 * 6 = 0.30000000000000004 would make a default style differ from itself)
  return step ? +(Math.round(c / step) * step).toFixed(6) : c;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toUpperCase() : d);
const hexOrEmpty = (v: unknown, d: string) => (v === '' ? '' : hex(v, d));
const PATHS: Path[] = ['tail', 'beads', 'scan', 'wave', 'orbit', 'rim', 'burst', 'corners', 'far'];

function cleanPaint(v: unknown, d: Paint): Paint {
  const o = isObj(v) ? v : {};
  return { kind: oneOf(o.kind, ['white', 'accent', 'custom', 'gradient'] as const, d.kind), c1: hex(o.c1, d.c1), c2: hex(o.c2, d.c2), ang: num(o.ang, 0, 360, d.ang, 1) };
}

/** Any stored value -> a valid style. Unknown keys are dropped, every number is clamped, a missing part takes its default. Never throws. */
export function cleanStudio(raw: unknown): StudioStyle {
  const D = DEFAULT_STUDIO;
  if (!isObj(raw)) return structuredCopy(D);
  const m = isObj(raw.motion) ? raw.motion : {}, b = isObj(raw.bar) ? raw.bar : {}, e = isObj(raw.els) ? raw.els : {}, t = isObj(raw.tint) ? raw.tint : {};
  const bz = Array.isArray(raw.bz) ? raw.bz : [], sp = Array.isArray(raw.sp) ? raw.sp : [];
  const pal = Array.isArray(e.palette) ? e.palette.map((c) => hex(c, '')).filter(Boolean).slice(0, 6) : D.els.palette;
  return {
    v: 1,
    force: Number.isInteger(raw.force) && (raw.force as number) >= 0 && (raw.force as number) <= 999 ? (raw.force as number) : 0,
    accent: hexOrEmpty(raw.accent, ''),
    seed: Math.round(num(raw.seed, 1, 9999, D.seed)),
    ease: oneOf(raw.ease, EASE_KEYS, 'auto'),
    // x of a cubic-bezier must stay in 0..1 (the curve has to be a function of time); y may leave it (overshoot / anticipation).
    bz: [num(bz[0], 0, 1, D.bz[0], 0.01), num(bz[1], -1, 2, D.bz[1], 0.01), num(bz[2], 0, 1, D.bz[2], 0.01), num(bz[3], -1, 2, D.bz[3], 0.01)],
    sp: [Math.round(num(sp[0], 1, 6, D.sp[0])), num(sp[1], 1.5, 8, D.sp[1], 0.1)],
    steps: Math.round(num(raw.steps, 2, 16, D.steps)),
    motion: {
      dir: oneOf(m.dir, ['auto', 'fixed', 'alternate', 'random'] as const, 'auto'),
      angle: num(m.angle, -180, 180, 0, 1),
      sweep: m.sweep === null || m.sweep === undefined ? null : num(m.sweep, -120, 120, 0, 1),
      origin: bool(m.origin, false), ox: num(m.ox, 0, 1, 0.5, 0.01), oy: num(m.oy, 0, 1, 0.5, 0.01),
      zoomIn: num(m.zoomIn, 0, 0.6, 0, 0.01), zoomOut: num(m.zoomOut, 0, 0.6, 0, 0.01), push: num(m.push, 0, 1, 0, 0.01),
    },
    bar: {
      mode: oneOf(b.mode, ['effect', 'custom', 'off'] as const, 'effect'),
      size: num(b.size, 1, 40, D.bar.size, 1), look: oneOf(b.look, ['solid', 'double', 'dashed', 'dotted'] as const, 'solid'),
      paint: cleanPaint(b.paint, D.bar.paint), opacity: num(b.opacity, 0.1, 1, 1, 0.05),
      glow: num(b.glow, 0, 60, 0, 1), trail: num(b.trail, 0, 240, 0, 2), trailColor: hexOrEmpty(b.trailColor, ''),
      round: bool(b.round, false), fade: bool(b.fade, false),
    },
    els: {
      mode: oneOf(e.mode, ['effect', 'custom', 'off'] as const, 'effect'),
      shape: oneOf(e.shape, PIECE_SHAPES, 'dot'), count: Math.round(num(e.count, 1, 24, D.els.count)), size: num(e.size, 6, 56, D.els.size, 1), sizeVar: num(e.sizeVar, 0, 1, D.els.sizeVar, 0.05),
      motion: oneOf(e.motion, PIECE_MOTIONS, 'follow'),
      path: oneOf(e.path, ['auto', ...PATHS] as const, 'auto'),
      spread: num(e.spread, 0.4, 2, 1, 0.05), spin: num(e.spin, -3, 3, D.els.spin, 0.25), opacity: num(e.opacity, 0.1, 1, 1, 0.05),
      colors: oneOf(e.colors, ['white', 'accent', 'mix', 'palette'] as const, 'white'),
      palette: pal.length ? pal : D.els.palette, glow: num(e.glow, 0, 30, 0, 1), stagger: num(e.stagger, 0, 1, D.els.stagger, 0.05), pulse: num(e.pulse, 0, 1, 0, 0.05),
    },
    tint: {
      on: bool(t.on, false), kind: oneOf(t.kind, ['solid', 'gradient'] as const, 'gradient'),
      c1: hex(t.c1, D.tint.c1), c2: hex(t.c2, D.tint.c2), c3: t.c3 === '' ? '' : hex(t.c3, ''),
      ang: num(t.ang, 0, 360, D.tint.ang, 1), amount: num(t.amount, 0.05, 0.9, D.tint.amount, 0.05), peak: oneOf(t.peak, ['mid', 'start', 'end'] as const, 'mid'),
    },
  };
}
function structuredCopy<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T; }
export const cloneStudio = (s: StudioStyle): StudioStyle => structuredCopy(s);

const DEFAULT_JSON = JSON.stringify(DEFAULT_STUDIO);
/** True when the style changes nothing (every part is on "auto" / "effect"). */
export const isDefaultStudio = (s?: StudioStyle | null) => !s || JSON.stringify(cleanStudio(s)) === DEFAULT_JSON;
/** The style the engine uses: null when there is none or it changes nothing. */
export const activeStudio = (s?: unknown): StudioStyle | null => { if (s === undefined || s === null) return null; const c = cleanStudio(s); return isDefaultStudio(c) ? null : c; };
/** Stable string of a style ('' = none): the video signature and the stage's change detection use it. */
export const studioKey = (s?: unknown): string => { const a = activeStudio(s); return a ? JSON.stringify(a) : ''; };
export const studioSig = (s?: unknown): string => { const k = studioKey(s); return k ? hash(k) : ''; };

/** True when the style draws something on top of the photos (bar, elements or a colour wash). */
export const studioHasExtras = (s: StudioStyle | null): boolean => !!s && (s.bar.mode === 'custom' || s.els.mode === 'custom' || s.tint.on);
/** True when the style changes how the photos or the window move. */
export const studioMoves = (s: StudioStyle | null): boolean => !!s && (s.ease !== 'auto' || s.motion.dir !== 'auto' || s.motion.sweep !== null || s.motion.origin || s.motion.zoomIn > 0 || s.motion.zoomOut > 0 || s.motion.push > 0);

/* ------------------------------ colours ------------------------------ */
export const accentOf = (s: StudioStyle | null | undefined, theme: string) => (s && s.accent ? s.accent : theme);

/** The two ends of a paint and whether it is a gradient. */
export function paintColors(p: Paint, accent: string): { a: string; b: string; grad: boolean } {
  if (p.kind === 'accent') return { a: accent, b: accent, grad: false };
  if (p.kind === 'custom') return { a: p.c1, b: p.c1, grad: false };
  if (p.kind === 'gradient') return { a: p.c1, b: p.c2, grad: true };
  return { a: WHITE, b: WHITE, grad: false };
}

/** Linear mix of two hex colours (t = 0 -> a, 1 -> b). */
export function mixHex(a: string, b: string, t: number): string {
  const parse = (h: string) => { const m = h.replace('#', ''); const f = m.length === 3 ? m.split('').map((c) => c + c).join('') : m; return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]; };
  const x = parse(a), y = parse(b), k = Math.min(1, Math.max(0, t));
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** expo-linear-gradient start / end points for an angle (0 = left to right, 90 = top to bottom). */
export function gradPoints(ang: number) {
  const r = (ang * Math.PI) / 180, c = Math.cos(r) / 2, s = Math.sin(r) / 2;
  return { start: { x: 0.5 - c, y: 0.5 - s }, end: { x: 0.5 + c, y: 0.5 + s } };
}

/** Colour of piece `i`. */
export function pieceColor(e: StudioEls, i: number, accent: string): string {
  if (e.colors === 'accent') return accent;
  if (e.colors === 'mix') return i % 2 ? accent : WHITE;
  if (e.colors === 'palette') return e.palette[i % e.palette.length] ?? WHITE;
  return WHITE;
}
/** Shape of piece `i` (the `mixed` choice cycles through nine shapes). */
export const pieceShape = (e: StudioEls, i: number): Exclude<PieceShape, 'mixed'> => (e.shape === 'mixed' ? MIXED[i % MIXED.length] : e.shape);
/** Base size of piece `i` (px): sizes vary around the chosen size, always the same for a given seed. */
export const pieceSize = (e: StudioEls, seed: number, i: number) => Math.round(e.size * (1 - e.sizeVar * 0.65 * rnd(seed, i * 3 + 9)));

/** The window that fires and the Deco the `follow` motion draws (classic decoAt maths). */
export function followDeco(e: StudioEls, def: FxDef, seed: number, i: number): Deco {
  const own = def.deco;
  const path: Path = e.path !== 'auto' ? e.path : own ? own.path : def.kind === 'wipe' ? 'tail' : def.kind === 'circle' ? 'rim' : 'corners';
  const shape = pieceShape(e, i);
  return { shape: shape === 'bar' ? 'bar' : 'dot', path, n: e.count, color: 'white', size: pieceSize(e, seed, i) };
}

/* ------------------------------ per-transition overrides ------------------------------ */
/**
 * What the style changes in the window maths of the effect `def` for the transition number `cursor` (direction modes need it:
 * `alternate` flips every other transition, `random` draws a new angle each time from the style's seed).
 */
export function overrideFor(s: StudioStyle, def: FxDef, cursor: number): CfgOverride {
  const m = s.motion;
  const ov: CfgOverride = { zi: m.zoomIn, zo: m.zoomOut, pu: m.push };
  if (s.ease !== 'auto') {
    ov.e = EASE_ID[s.ease];
    ov.ep = s.ease === 'bezier' ? s.bz : s.ease === 'spring' ? s.sp : s.ease === 'steps' ? [s.steps] : [0, 0, 0, 0];
  }
  if (def.kind === 'wipe' || def.kind === 'spin') {
    const own = def.angle ?? (def.kind === 'wipe' ? 0 : 90);
    if (m.dir === 'fixed') ov.angle = m.angle;
    else if (m.dir === 'alternate') ov.angle = own + (cursor % 2 ? 180 : 0);
    else if (m.dir === 'random') ov.angle = Math.floor(rnd(s.seed, cursor * 7 + 3) * 24) * 15 - 180;
    if (def.kind === 'wipe' && m.sweep !== null) ov.sweep = m.sweep;
  }
  if (m.origin && (def.kind === 'rect' || def.kind === 'circle' || def.kind === 'spin')) { ov.ox = m.ox; ov.oy = m.oy; }
  return ov;
}

/* ------------------------------ deterministic randomness ------------------------------ */
/** Same (a, b) -> same number in 0..1, on every device and in the video renderer. */
export function rnd(a: number, b: number): number {
  'worklet';
  const x = Math.sin(a * 127.1 + b * 311.7 + 1.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ------------------------------ element motions (everything except `follow`) ------------------------------ */
const cl = (v: number) => {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
};

/** Where the window edge is at progress `p`: a point on the card's centre line, the unit direction of travel and the card extents along / across it. */
function edgeAt(c: Cfg, W: number, H: number, p: number) {
  'worklet';
  const q = ease(c.e, cl(p), c.ep);
  const R = wipeR(W, H);
  const dist = -R + 2 * R * q;
  const a = (c.a1 * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  return { x: Math.round(W / 2) + dx * dist, y: Math.round(H / 2) + dy * dist, dx, dy, along: Math.abs(dx) * W + Math.abs(dy) * H, across: Math.abs(dy) * W + Math.abs(dx) * H, q };
}

/**
 * Piece `i` of the style's elements at progress `p` for the motions that do not ride the window path (`follow` uses `decoAt`).
 * Pure, UI-thread safe, transform + opacity only. Positions come from the style's seed, so the same style always looks the same.
 */
export function pieceAt(e: StudioEls, seed: number, c: Cfg, W: number, H: number, p: number, i: number, motion?: PieceMotion): Badge {
  'worklet';
  const TAU = 2 * Math.PI;
  const pp = cl(p);
  const r1 = rnd(seed, i * 3 + 1), r2 = rnd(seed, i * 3 + 2), r3 = rnd(seed, i * 3 + 3);
  const env = Math.max(0, Math.min(1, pp / 0.1, (1 - pp) / 0.1));
  const delay = e.stagger * 0.6 * r3;
  const t = cl((pp - delay) / (1 - e.stagger * 0.6));
  const turn = e.spin * 360 * t + r1 * 360;
  const pulse = 1 + e.pulse * 0.45 * Math.sin(TAU * (pp * 3 + r2));
  const wipe = c.k === 1;
  const ox = Math.round(c.ox * W), oy = Math.round(c.oy * H);
  let x = r1 * W, y = r2 * H, s = 1, o = env;
  const m = motion ?? e.motion;
  if (m === 'random') { const pop = Math.sin(Math.PI * t); s = 0.4 + 0.8 * pop; o = pop; y -= t * 14; }
  else if (m === 'twinkle') { o = env * Math.max(0, 0.45 + 0.55 * Math.sin(TAU * (pp * 2 + r3))); s = 0.55 + 0.6 * o; }
  else if (m === 'rain') { x = r1 * W + Math.sin(TAU * (t + r3)) * 4; y = -16 + (H + 32) * t; o = env * (0.55 + 0.45 * r2); }
  else if (m === 'rise') { x = r1 * W + Math.sin(TAU * (t * 1.5 + r3)) * 12; y = H + 16 - (H + 32) * t; s = 0.6 + 0.6 * r2; o = env * (0.55 + 0.45 * r3); }
  else if (m === 'drift') {
    const a = wipe ? (c.a1 * Math.PI) / 180 : 0;
    const dx = Math.cos(a), dy = Math.sin(a);
    const along = Math.abs(dx) * W + Math.abs(dy) * H + 48, across = Math.abs(dy) * W + Math.abs(dx) * H;
    const u = (t - 0.5) * along, v = (r1 - 0.5) * across;
    x = W / 2 + dx * u - dy * v; y = H / 2 + dy * u + dx * v; o = env * (0.5 + 0.5 * r3);
  } else if (m === 'swirl') {
    const cx = wipe ? W / 2 : ox, cy = wipe ? H / 2 : oy;
    const maxR = Math.sqrt(W * W + H * H) * 0.5;
    const th = r1 * TAU + t * (1.2 + r2) * Math.PI * 2, rad = t * maxR * (0.35 + 0.65 * r3);
    x = cx + Math.cos(th) * rad; y = cy + Math.sin(th) * rad; s = 1 - 0.55 * t; o = env * Math.sin(Math.PI * Math.min(1, t * 1.15));
  } else if (m === 'burst') {
    const born = r3 * 0.65;
    const age = cl((pp - born) / 0.35);
    const fly = age * (36 + 70 * r1);
    if (wipe) {
      const ed = edgeAt(c, W, H, born);
      const off = (r2 - 0.5) * ed.across * 0.9;
      const ang = Math.atan2(ed.dy, ed.dx) + (r1 - 0.5) * Math.PI * 1.1;
      x = ed.x - ed.dy * off + Math.cos(ang) * fly; y = ed.y + ed.dx * off + Math.sin(ang) * fly;
    } else {
      const q = ease(c.e, born, c.ep);
      const ring = Math.sqrt(W * W + H * H) * 0.5 * (MIN_SCALE + (1 - MIN_SCALE) * cl(q)) * 0.92;
      // The ring is much larger than the card for most of the transition: use the first angle (deterministic, from r1) whose ring point is on the card.
      let th = r1 * TAU, seen = false;
      for (let k = 0; k < 16 && !seen; k++) {
        th = (r1 + k / 16) * TAU;
        const rx = ox + Math.cos(th) * ring, ry = oy + Math.sin(th) * ring;
        seen = rx > 4 && rx < W - 4 && ry > 4 && ry < H - 4;
      }
      x = ox + Math.cos(th) * (ring + fly); y = oy + Math.sin(th) * (ring + fly);
      if (!seen) { x = -999; y = -999; }
    }
    s = 1 - 0.55 * age; o = Math.sin(Math.PI * Math.min(1, age * 1.05)) * (pp > 0.97 ? (1 - pp) / 0.03 : 1);
  }
  return { x, y, s: s * pulse, o: o * e.opacity, r: turn };
}

/* ------------------------------ colour wash ------------------------------ */
/** Opacity of the colour wash at progress `p`: a smooth bump that is 0 at both ends and peaks early (0.2), in the middle (0.5) or late (0.8), so nothing pops. */
export function tintAlpha(t: StudioTint, p: number): number {
  'worklet';
  const u = cl(p);
  if (u <= 0 || u >= 1) return 0;
  const g = t.peak === 'start' ? 0.43 : t.peak === 'end' ? 3.1 : 1;
  return t.amount * Math.sin(Math.PI * Math.pow(u, g));
}
/** The colours of the wash (empty third colour dropped; a solid wash uses the first colour twice). */
export const tintColors = (t: StudioTint): string[] => (t.kind === 'solid' ? [t.c1, t.c1] : t.c3 ? [t.c1, t.c2, t.c3] : [t.c1, t.c2]);

/* ------------------------------ bar maths shared by the live view and the canvas ------------------------------ */
/**
 * Segments of a dashed / dotted bar along its length: [offset from the bar centre, length]. They always cover `extent` (the visible length), with at
 * most 48 pieces (a very thin bar gets wider gaps rather than hundreds of views).
 */
export function barSegments(look: BarLook, size: number, extent: number): [number, number][] {
  if (look !== 'dashed' && look !== 'dotted') return [];
  const len = look === 'dotted' ? Math.max(3, size) : Math.max(8, size * 3);
  let gap = look === 'dotted' ? len * 1.1 : Math.max(6, size * 2);
  let n = Math.ceil((extent + gap) / (len + gap));
  if (n > 48) { n = 48; gap = (extent - n * len) / (n - 1); }
  const total = n * len + (n - 1) * gap;
  return Array.from({ length: n }, (_, k) => [-total / 2 + k * (len + gap), len] as [number, number]);
}
/** Opacity of the bar at progress `p` (fade option: in over the first 12 %, out over the last 12 %). */
export const barAlpha = (b: StudioBar, p: number) => {
  'worklet';
  const u = cl(p);
  return b.opacity * (b.fade ? Math.max(0, Math.min(1, u / 0.12, (1 - u) / 0.12)) : 1);
};

/** Number of element pieces the style draws for an effect (the `far` path depends on which corners travel). */
export function studioPieceCount(s: StudioStyle, def: FxDef, cfg: Cfg): number {
  const e = s.els;
  if (e.mode !== 'custom') return 0;
  if (e.motion === 'follow' && (e.path === 'far' || (e.path === 'auto' && def.deco?.path === 'far'))) return Math.max(1, farCorners(cfg.ax, cfg.ay, cfg.ox, cfg.oy).length);
  return e.count;
}
/** One piece at progress `p` (`follow` rides the window with the classic maths, every other motion uses `pieceAt`). */
export function studioPiece(s: StudioStyle, def: FxDef, deco: Deco, cfg: Cfg, W: number, H: number, p: number, i: number): Badge {
  'worklet';
  const e = s.els;
  // A plain cross-fade has no window to ride: `follow` twinkles instead.
  if (e.motion === 'follow' && cfg.k === 0) return pieceAt(e, s.seed, cfg, W, H, p, i, 'twinkle');
  if (e.motion === 'follow') {
    const b = decoAt(deco, cfg, W, H, p, i, e.spread, e.spin);
    // A wipe's tail fades piece after piece (1 - 0.22 i): with more than 5 pieces the classic maths goes negative, so the tail ends on a faint, small piece instead of vanishing.
    const wipeTail = cfg.k === 1;
    const bs = wipeTail ? Math.max(b.s, 0.3) : b.s, bo = wipeTail ? Math.max(b.o, 0.15) : b.o;
    return { x: b.x, y: b.y, s: bs * (1 + e.pulse * 0.45 * Math.sin(2 * Math.PI * (Math.min(1, Math.max(0, p)) * 3 + i * 0.37))), o: bo * e.opacity, r: b.r };
  }
  return pieceAt(e, s.seed, cfg, W, H, p, i);
}

/* ------------------------------ presets ------------------------------ */
/** A partial style: any top-level key, and for the grouped parts (motion, bar, els, tint) any subset of their keys. Validated by `cleanStudio` after the merge. */
type Patch = Record<string, unknown>;
export function mergeStudio(base: StudioStyle, patch: Patch): StudioStyle {
  const out = cloneStudio(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(out[k])) out[k] = { ...(out[k] as object), ...v };
    else out[k] = v;
  }
  return cleanStudio(out);
}
export interface StudioPreset { id: string; icon: string; style: StudioStyle }
const preset = (id: string, icon: string, patch: Patch): StudioPreset => ({ id, icon, style: mergeStudio(DEFAULT_STUDIO, patch) });
const P = (kind: PaintKind, c1 = WHITE, c2 = '#FFD60A', ang = 90): Paint => ({ kind, c1, c2, ang });

/** Ready-made looks: one tap, then tweak anything. Every preset is a normal style, nothing is hard-wired. */
export const PRESETS: StudioPreset[] = [
  preset('clean', 'minus', { bar: { mode: 'custom', size: 3, paint: P('white'), glow: 10, trail: 0 }, els: { mode: 'off' }, ease: 'expo' }),
  preset('neon', 'flash-outline', { ease: 'snap', bar: { mode: 'custom', size: 4, paint: P('gradient', '#22D3EE', '#E879F9', 90), glow: 28, trail: 140, trailColor: '#7C3AED', round: true }, els: { mode: 'custom', shape: 'dot', motion: 'follow', path: 'tail', count: 5, size: 12, colors: 'palette', palette: ['#22D3EE', '#E879F9', '#A78BFA'], glow: 10 }, tint: { on: true, kind: 'gradient', c1: '#7C3AED', c2: '#22D3EE', c3: '', ang: 120, amount: 0.25, peak: 'mid' } }),
  preset('confetti', 'creation', { ease: 'back', bar: { mode: 'off' }, els: { mode: 'custom', shape: 'mixed', motion: 'burst', count: 18, size: 16, sizeVar: 0.5, colors: 'palette', palette: ['#FF4D8D', '#FFD60A', '#38BDF8', '#4ADE80', '#FFFFFF'], stagger: 0.5, spin: 2 } }),
  preset('golden', 'weather-sunset', { ease: 'inOut', motion: { zoomIn: 0.12, zoomOut: 0.06 }, bar: { mode: 'custom', size: 2, paint: P('gradient', '#FDE68A', '#F59E0B', 90), glow: 18, trail: 90, trailColor: '#F59E0B' }, els: { mode: 'custom', shape: 'spark', motion: 'rise', count: 12, size: 14, colors: 'palette', palette: ['#FFF7D6', '#FDE68A', '#FBBF24'], glow: 8, stagger: 0.7, spin: 0.5 }, tint: { on: true, kind: 'gradient', c1: '#F59E0B', c2: '#FB7185', c3: '', ang: 160, amount: 0.3, peak: 'mid' } }),
  preset('aurora', 'weather-night', { ease: 'inOut', motion: { dir: 'alternate', zoomIn: 0.08 }, bar: { mode: 'custom', size: 6, paint: P('gradient', '#34D399', '#818CF8', 90), glow: 34, trail: 200, trailColor: '#34D399', round: true, opacity: 0.9 }, els: { mode: 'custom', shape: 'dot', motion: 'twinkle', count: 16, size: 8, sizeVar: 0.6, colors: 'palette', palette: ['#FFFFFF', '#A7F3D0', '#C7D2FE'], glow: 8 }, tint: { on: true, kind: 'gradient', c1: '#0F766E', c2: '#4338CA', c3: '', ang: 90, amount: 0.3, peak: 'mid' } }),
  preset('snow', 'snowflake', { ease: 'inOut', bar: { mode: 'off' }, els: { mode: 'custom', shape: 'dot', motion: 'rain', count: 20, size: 10, sizeVar: 0.7, colors: 'white', stagger: 0.8, opacity: 0.9, glow: 4 }, tint: { on: true, kind: 'solid', c1: '#BFDBFE', c2: '#BFDBFE', c3: '', ang: 90, amount: 0.2, peak: 'mid' } }),
  preset('hearts', 'heart', { ease: 'spring', sp: [3, 3.6], bar: { mode: 'custom', size: 3, paint: P('custom', '#FB7185'), glow: 14, round: true }, els: { mode: 'custom', shape: 'heart', motion: 'rise', count: 10, size: 20, sizeVar: 0.5, colors: 'palette', palette: ['#FB7185', '#F43F5E', '#FDA4AF', '#FFFFFF'], stagger: 0.7, spin: 0.25, pulse: 0.5 } }),
  preset('glitch', 'television-classic', { ease: 'steps', steps: 7, motion: { dir: 'random' }, bar: { mode: 'custom', size: 5, look: 'dashed', paint: P('gradient', '#22D3EE', '#F43F5E', 90), glow: 0 }, els: { mode: 'custom', shape: 'bar', motion: 'random', count: 10, size: 14, colors: 'palette', palette: ['#22D3EE', '#F43F5E', '#FFFFFF'], stagger: 0.4, spin: 0 }, tint: { on: true, kind: 'solid', c1: '#F43F5E', c2: '#F43F5E', c3: '', ang: 0, amount: 0.15, peak: 'mid' } }),
  preset('cinema', 'movie-open-outline', { ease: 'inOut', motion: { zoomIn: 0.18, zoomOut: 0.1, push: 0.6 }, bar: { mode: 'custom', size: 1, paint: P('white'), glow: 6, opacity: 0.85 }, els: { mode: 'off' } }),
  preset('disco', 'party-popper', { ease: 'elastic', motion: { dir: 'alternate' }, bar: { mode: 'custom', size: 8, look: 'dotted', paint: P('gradient', '#F472B6', '#FACC15', 90), glow: 20, round: true }, els: { mode: 'custom', shape: 'star', motion: 'swirl', count: 14, size: 16, sizeVar: 0.4, colors: 'palette', palette: ['#F472B6', '#FACC15', '#38BDF8', '#A3E635', '#FFFFFF'], stagger: 0.5, spin: 2, glow: 8 } }),
  preset('sparkle', 'star-four-points', { ease: 'back', bar: { mode: 'custom', size: 2, paint: P('white'), glow: 22, trail: 60, trailColor: '#FFFFFF' }, els: { mode: 'custom', shape: 'spark', motion: 'follow', path: 'beads', count: 6, size: 18, colors: 'white', glow: 12, spin: 1, pulse: 0.6 } }),
  preset('ocean', 'waves', { ease: 'spring', sp: [2, 3], motion: { dir: 'fixed', angle: 0, sweep: 18 }, bar: { mode: 'custom', size: 10, paint: P('gradient', '#38BDF8', '#0EA5E9', 90), glow: 24, trail: 160, trailColor: '#38BDF8', opacity: 0.85 }, els: { mode: 'custom', shape: 'ring', motion: 'rise', count: 12, size: 16, sizeVar: 0.6, colors: 'palette', palette: ['#FFFFFF', '#BAE6FD', '#7DD3FC'], stagger: 0.8, opacity: 0.85 }, tint: { on: true, kind: 'gradient', c1: '#0EA5E9', c2: '#14B8A6', c3: '', ang: 90, amount: 0.22, peak: 'mid' } }),
];

/** "Surprise me": a coherent random style (same seed = same result). Every part stays inside the ranges the editor offers. */
export function randomStudio(seed: number): StudioStyle {
  const r = (k: number) => rnd(seed, k);
  const pick = <T,>(list: readonly T[], k: number) => list[Math.floor(r(k) * list.length) % list.length];
  const hue = (k: number, l = 58) => { const h = Math.round(r(k) * 360), s = 0.85, a = s * Math.min(l / 100, 1 - l / 100); const f = (n: number) => { const kk = (n + h / 30) % 12; const c = l / 100 - a * Math.max(-1, Math.min(kk - 3, 9 - kk, 1)); return Math.round(255 * c).toString(16).padStart(2, '0'); }; return `#${f(0)}${f(8)}${f(4)}`.toUpperCase(); };
  const c1 = hue(1), c2 = hue(2), c3 = hue(3, 72);
  const ease2 = pick(['inOut', 'expo', 'snap', 'back', 'anticipate', 'elastic', 'spring', 'bounce', 'steps'] as EaseKey[], 4);
  const motion = pick(PIECE_MOTIONS, 5);
  const gradient = r(6) > 0.35;
  return cleanStudio({
    ...DEFAULT_STUDIO, seed: 1 + Math.floor(r(7) * 9000), ease: ease2, steps: 4 + Math.floor(r(8) * 8), sp: [2 + Math.floor(r(9) * 3), 2.4 + r(10) * 2.4],
    motion: { dir: pick(['auto', 'alternate', 'random'] as DirMode[], 11), angle: 0, sweep: r(12) > 0.7 ? Math.round((r(13) - 0.5) * 80) : null, origin: false, ox: 0.5, oy: 0.5, zoomIn: r(14) > 0.5 ? +(r(15) * 0.25).toFixed(2) : 0, zoomOut: r(16) > 0.6 ? +(r(17) * 0.15).toFixed(2) : 0, push: r(18) > 0.7 ? +(0.3 + r(19) * 0.5).toFixed(2) : 0 },
    bar: { mode: 'custom', size: 2 + Math.floor(r(20) * 9), look: pick(['solid', 'solid', 'double', 'dashed', 'dotted'] as BarLook[], 21), paint: gradient ? P('gradient', c1, c2, 90) : P(pick(['white', 'accent', 'custom'] as PaintKind[], 22), c1), opacity: 1, glow: Math.round(r(23) * 32), trail: r(24) > 0.5 ? Math.round(r(25) * 180) : 0, trailColor: c2, round: r(26) > 0.4, fade: false },
    els: { mode: r(27) > 0.12 ? 'custom' : 'off', shape: pick(PIECE_SHAPES, 28), count: 4 + Math.floor(r(29) * 14), size: 10 + Math.floor(r(30) * 14), sizeVar: +(r(31) * 0.7).toFixed(2), motion, path: 'auto', spread: 1, spin: pick([0, 0.5, 1, 2, -1], 32), opacity: 1, colors: pick(['white', 'mix', 'palette', 'palette'] as PieceColors[], 33), palette: [c1, c2, c3, '#FFFFFF'], glow: Math.round(r(34) * 12), stagger: +(r(35) * 0.8).toFixed(2), pulse: r(36) > 0.6 ? 0.5 : 0 },
    tint: { on: r(37) > 0.45, kind: 'gradient', c1, c2, c3: r(38) > 0.6 ? c3 : '', ang: Math.round(r(39) * 360), amount: +(0.15 + r(40) * 0.3).toFixed(2), peak: pick(['mid', 'mid', 'start', 'end'] as const, 41) },
  });
}

/* ------------------------------ share ------------------------------ */
/** The style as pretty JSON (copy / share). */
export const exportStudio = (s: StudioStyle) => JSON.stringify(cleanStudio(s), null, 2);
/** JSON text -> style, or null when the text is not a style. */
export function importStudio(text: string): StudioStyle | null {
  try { const v = JSON.parse(text); return isObj(v) ? cleanStudio(v) : null; } catch { return null; }
}
