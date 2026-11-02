/**
 * Home "tools card" settings and maths. Pure functions only (no React): the card, the admin preview and the tests share them.
 *
 * Where the settings live
 *  - GLOBAL (one value for every card): `settings.toolCards` = { height, textZone, fxEnabled, fxLowEnd }  (content_docs "settings" row).
 *    fxEnabled / fxLowEnd = the admin's "Transition availability" (see lib/toolCardFx.ts).
 *  - PER CARD: `tool.media.fx` (content_items "tools" row, media of type "slideshow"): animation type / effects / hold / speed / text placement / gradient.
 *    The pictures themselves are `tool.media.images`.
 * Card height and text zone are never read from a card; any old per-card `height` / `textZone` key is ignored.
 * The transition engine itself (catalogue, geometry, easing, timing) lives in lib/toolCardFx.ts.
 */
import type { Media, ToolCardFx, ToolCardGradient, ToolCardsGlobal } from '@/data/types';
import { DEFAULT_ENABLED, DEFAULT_LOW_END, HOLDS, HOLD_DEFAULT, SPEEDS, resolveAvail, type FxAvail } from './toolCardFx';

export { FX_IDS, HOLDS, SPEEDS } from './toolCardFx';

/* ------------------------------ constants ------------------------------ */
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

export const GRADIENT_STRENGTH: Record<ToolCardGradient, number> = { soft: 0.55, medium: 0.75, strong: 0.9 };
/** The middle colour stop is always this share of the chosen strength. */
export const GRADIENT_MID = 0.55;

/* ------------------------------ resolved settings ------------------------------ */
export interface CardGlobal { height: number; textZone: 'top' | 'bottom' }
export interface ResolvedFx {
  mode: 'single' | 'multiple';
  /** Multiple mode: the kept effect ids (0 = cross-fade). `null` = never edited = every ENABLED effect. */
  effects: number[] | null;
  /** Single mode: the chosen effect id (0 = cross-fade). */
  effect: number;
  /** Hold time between two transitions, seconds. */
  hold: number;
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

/**
 * Stable string of the availability settings. A component that selects THIS from the store re-renders only when the
 * availability really changes (not when the height slider moves).
 */
export const availKey = (g?: ToolCardsGlobal): string => {
  const a = resolveAvail(g);
  return `${[...a.enabled].sort((x, y) => x - y).join(',')}|${[...a.lowEnd].sort((x, y) => x - y).join(',')}`;
};
/** Inverse of availKey. */
export function availFromKey(key: string): FxAvail {
  const [en, lo] = key.split('|');
  const ids = (s: string) => (s ? s.split(',').map(Number) : []);
  return { enabled: new Set(ids(en)), lowEnd: new Set(ids(lo)) };
}
/** Keep the defaults reachable for callers that only import this module. */
export { DEFAULT_ENABLED, DEFAULT_LOW_END };

const validFx = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 30;
const nearestOf = <T extends number>(list: readonly T[], v: unknown, fallback: T): T => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);
};

/**
 * Per-card settings with defaults. A card that was never edited plays every enabled effect, hold 0.9s, 1x, text inside, Medium gradient.
 * The old key `pause` is still read (nearest hold value) when `hold` is missing.
 */
export function resolveFx(fx?: ToolCardFx): ResolvedFx {
  return {
    mode: fx?.mode === 'single' ? 'single' : 'multiple',
    // undefined = default (every enabled effect); an explicit empty list = nothing kept (still image).
    effects: fx?.effects ? [...new Set(fx.effects.filter(validFx))].sort((a, b) => a - b) : null,
    effect: validFx(fx?.effect) ? fx!.effect! : 1,
    hold: nearestOf(HOLDS, fx?.hold ?? fx?.pause, HOLD_DEFAULT),
    speed: nearestOf(SPEEDS, fx?.speed, 1),
    textPlacement: fx?.textPlacement === 'outside' ? 'outside' : 'inside',
    gradient: fx?.gradient === 'soft' || fx?.gradient === 'strong' ? fx.gradient : 'medium',
  };
}

/**
 * The effect ids a card asks for, before availability is applied: one in Single mode, the kept ones in Multiple mode
 * (or every enabled one when the card was never edited).
 */
export const requestedEffects = (fx: ResolvedFx, enabled: number[]): number[] => (fx.mode === 'single' ? [fx.effect] : fx.effects ?? enabled);

/** Stored shape for a card: drops any legacy per-card height / text zone / pause (those are global or renamed) and undefined keys. */
export function cleanFx(fx: ToolCardFx): ToolCardFx {
  const { height: _h, textZone: _z, pause, ...rest } = fx as ToolCardFx & { height?: unknown; textZone?: unknown };
  void _h; void _z;
  const out: ToolCardFx = { ...rest };
  if (out.hold === undefined && pause !== undefined) out.hold = resolveFx({ pause }).hold;
  (Object.keys(out) as (keyof ToolCardFx)[]).forEach((k) => { if (out[k] === undefined) delete out[k]; });
  return out;
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
