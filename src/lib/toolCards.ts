/**
 * Home "tools card" settings and maths. Pure functions only (no React): the card, the admin preview and the tests share them.
 *
 * Where the settings live
 *  - GLOBAL (one value for every card): `settings.toolCards` = { height, textZone }  (content_docs "settings" row).
 *  - PER CARD: `tool.media.fx` (content_items "tools" row, media of type "slideshow"): animation type / effects / pause / speed / text placement / gradient.
 *    The pictures themselves are `tool.media.images`.
 * Card height and text zone are never read from a card; any old per-card `height` / `textZone` key is ignored.
 */
import type { Media, ToolCardFx, ToolCardGradient, ToolCardsGlobal } from '@/data/types';

/* ------------------------------ constants ------------------------------ */
export const FX_IDS = Array.from({ length: 20 }, (_, i) => i + 1);
/** Effect 20 moves back and forth with no holds. */
export const FX_PING_PONG = 20;
/** Effect 14 (camera flash) is the low-end / reduced-motion fallback, played without its flash. */
export const FX_FADE = 14;

export const HEIGHT_MIN = 140;
export const HEIGHT_MAX = 420;
export const HEIGHT_STEP = 2;
export const HEIGHT_DEFAULT = 220;
/** Outside text mode: the picture never gets shorter than this. */
export const IMAGE_MIN_HEIGHT = 80;
/** Extra fade room above the text zone, on the image side (inside text mode). */
export const GRADIENT_PAD = 44;
/** Corner radius used when the app has no other card radius (the existing tool card is `rounded-2xl` = 16). */
export const CARD_RADIUS = 16;

export const PAUSES = [0, 0.4, 0.7, 1.2, 2] as const;
export const SPEEDS = [0.5, 1, 1.5, 2] as const;
/** One move (reveal or reverse) lasts TR_BASE / speed seconds. */
export const TR_BASE = 1.6;
export const GRADIENT_STRENGTH: Record<ToolCardGradient, number> = { soft: 0.55, medium: 0.75, strong: 0.9 };
/** The middle colour stop is always this share of the chosen strength. */
export const GRADIENT_MID = 0.55;

export const FX_COLORS = { coral: '#F0997B', teal: '#1D9E75', purple: '#7F77DD', amber: '#EF9F27', gold: '#FAC775', pink: '#ED93B1', blue: '#378ADD', white: '#FFFFFF' } as const;

/* ------------------------------ resolved settings ------------------------------ */
export interface CardGlobal { height: number; textZone: 'top' | 'bottom' }
export interface ResolvedFx {
  mode: 'single' | 'multiple';
  effects: number[];
  effect: number;
  pause: number;
  speed: number;
  textPlacement: 'inside' | 'outside';
  gradient: ToolCardGradient;
}

const snap = (v: number) => Math.round(v / HEIGHT_STEP) * HEIGHT_STEP;
export const clampHeight = (v: unknown) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : HEIGHT_DEFAULT;
  return Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, snap(n)));
};

/** The one global layout. Missing or invalid values fall back to 220px / bottom. */
export function resolveGlobal(g?: ToolCardsGlobal): CardGlobal {
  return { height: clampHeight(g?.height), textZone: g?.textZone === 'top' ? 'top' : 'bottom' };
}

const validFx = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 20;
const nearest = <T extends number>(list: readonly T[], v: unknown, fallback: T): T =>
  typeof v === 'number' && list.includes(v as T) ? (v as T) : fallback;

/** Per-card settings with defaults. A card that was never edited plays all 20 effects, pause 0.7s, 1x, text inside, Medium gradient. */
export function resolveFx(fx?: ToolCardFx): ResolvedFx {
  return {
    mode: fx?.mode === 'single' ? 'single' : 'multiple',
    // undefined = default (all 20); an explicit empty list = nothing kept (static AFTER image).
    effects: fx?.effects ? [...new Set(fx.effects.filter(validFx))].sort((a, b) => a - b) : [...FX_IDS],
    effect: validFx(fx?.effect) ? fx!.effect! : 1,
    pause: nearest(PAUSES, fx?.pause, 0.7),
    speed: nearest(SPEEDS, fx?.speed, 1),
    textPlacement: fx?.textPlacement === 'outside' ? 'outside' : 'inside',
    gradient: fx?.gradient === 'soft' || fx?.gradient === 'strong' ? fx.gradient : 'medium',
  };
}

/** The effects the card cycles through: one in Single mode, the kept ones (ascending) in Multiple mode. */
export const activeEffects = (fx: ResolvedFx): number[] => (fx.mode === 'single' ? [fx.effect] : fx.effects);

/** Stored shape for a card: drops any legacy per-card height / text zone (those are global now). */
export function cleanFx(fx: ToolCardFx): ToolCardFx {
  const { height: _h, textZone: _z, ...rest } = fx as ToolCardFx & { height?: unknown; textZone?: unknown };
  void _h; void _z;
  return rest;
}

/** The pictures of a slideshow media (empty strings dropped). Any other media type has none. */
export const slideshowImages = (media?: Media): string[] => (media?.type === 'slideshow' ? (media.images ?? []).filter((u) => typeof u === 'string' && u) : []);

/** Settings of a card: only a slideshow carries them; every other media uses the defaults (text inside, Medium gradient). */
export const mediaFx = (media?: Media): ResolvedFx => resolveFx(media?.type === 'slideshow' ? media.fx : undefined);

/* ------------------------------ layout ------------------------------ */
/**
 * Image height inside a card of total height `height`.
 * Inside text mode the picture fills the card. Outside mode it is the card minus the measured text zone, never below 80px.
 */
export const imageHeight = (height: number, inside: boolean, zoneHeight: number) => (inside ? height : Math.max(IMAGE_MIN_HEIGHT, height - Math.max(0, zoneHeight)));

/**
 * Transparent gradient behind inside text. `zone` = where the text sits. Stops run from the image side to the card edge:
 * transparent -> 55% of the strength -> the strength. Never a solid strip: the image-side stop is fully transparent.
 */
export function gradientFor(strength: ToolCardGradient, zone: 'top' | 'bottom') {
  const s = GRADIENT_STRENGTH[strength];
  const a = (v: number) => `rgba(0,0,0,${+v.toFixed(4)})`;
  const stops: [string, string, string] = [a(0), a(s * GRADIENT_MID), a(s)];
  return { colors: zone === 'bottom' ? stops : ([stops[2], stops[1], stops[0]] as [string, string, string]), locations: [0, 0.5, 1] as const, start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } };
}

/* ------------------------------ animation timeline ------------------------------ */
/**
 * Seconds of one loop.
 *  - Normal (2 images): hold before, reveal, hold after, reverse  = 2 x pause + 2 x tr.
 *  - Ping-pong (effect 20): no holds, the pause is added once   = 2 x tr + pause (exactly the reference HTML).
 *  - Chain (3+ images): hold, reveal. The next loop starts on the image just revealed, so the picture never jumps = pause + tr.
 */
export function loopSeconds(tr: number, pause: number, ping: boolean, chain = false) {
  'worklet';
  if (chain) return pause + tr;
  return ping ? 2 * tr + pause : 2 * pause + 2 * tr;
}

/** CSS `ease-in-out` = cubic-bezier(.42, 0, .58, 1), solved with a few Newton steps (the same curve as the reference HTML). */
export function easeInOut(u: number): number {
  'worklet';
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  let t = u;
  for (let i = 0; i < 8; i++) {
    const x = 3 * (1 - t) * (1 - t) * t * 0.42 + 3 * (1 - t) * t * t * 0.58 + t * t * t - u;
    const dx = 3 * (1 - t) * (1 - t) * 0.42 + 6 * (1 - t) * t * 0.16 + 3 * t * t * 0.42;
    if (Math.abs(dx) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - x / dx));
  }
  return 3 * (1 - t) * t * t + t * t * t;
}

/**
 * Progress of a loop. Returns [p, b], the two animated values of the reference HTML:
 *  p = reveal progress 0..1 (ease-in-out on each move).
 *  b = sparkle bump: 0 -> 1 -> 0 over the reveal, 0 -> 0.6 -> 0 over the reverse, 0 in the holds (each half eased, peak in the middle of the move).
 *  Ping-pong: p goes 0 -> 1 -> 0 in two equal eased halves, no holds, b stays 0.
 *  Chain: hold (p = 0), then the reveal; the loop ends on p = 1 (the next loop starts from that picture).
 */
export function timeline(phase: number, tr: number, pause: number, ping: boolean, chain = false): [number, number] {
  'worklet';
  const bump = (u: number, peak: number) => peak * (u < 0.5 ? easeInOut(u * 2) : 1 - easeInOut(u * 2 - 1));
  if (chain) {
    const t = phase * (pause + tr);
    if (t < pause) return [0, 0];
    const u = Math.min(1, (t - pause) / tr);
    return [easeInOut(u), bump(u, 1)];
  }
  if (ping) {
    const u = phase * 2;
    return [u < 1 ? easeInOut(u) : 1 - easeInOut(u - 1), 0];
  }
  const t = phase * (2 * pause + 2 * tr);
  if (t < pause) return [0, 0];
  if (t < pause + tr) { const u = (t - pause) / tr; return [easeInOut(u), bump(u, 1)]; }
  if (t < pause + tr + pause) return [1, 0];
  const u = Math.min(1, (t - pause - tr - pause) / tr);
  return [1 - easeInOut(u), bump(u, 0.6)];
}
