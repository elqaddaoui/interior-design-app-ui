/**
 * Pre-rendered card videos (Admin > Performance). Pure functions, no React: the renderer, the Performance page, the card and the checks share them.
 *
 * A card video is ONE seamless loop of the card's animation: for each picture i (in order) the card HOLDS picture i, then plays the next effect
 * of the card's list from picture i to picture i+1 (the last picture goes back to the first). The video starts on a hold of picture 0 and ends
 * on the very frame that shows picture 0 again, so a looping <video> never jumps.
 *
 *   hold        a few identical frames (cheap to encode: they cost almost no bytes)
 *   transition  TR_BASE / speed seconds of real frames, the last one is exactly the new picture (u = 1)
 */
import { TR_BASE } from './toolCardFx';
import type { VideoAdvanced, VideoQuality } from '../data/types';

export const VIDEO_FPS = 30;
/** Frames per second inside a hold (identical frames; a low rate keeps the file tiny and the loop exact). */
export const HOLD_FPS = 10;
export const VIDEO_MAX_WIDTH = 720;

/**
 * Render quality presets (Admin > Performance > Video preview). One choice drives the picture size, the frame rate and the encoder quality:
 *   low       small and light: for slow networks / very old phones (480 px wide, 24 fps)
 *   balanced  the default: sharp on a phone screen, a few hundred KB (720 px, 30 fps)
 *   high      crisper edges and gradients, ~2x bigger file (960 px, 30 fps)
 *   ultra     tablets / big screens: smoothest motion, biggest file (1280 px, 60 fps)
 *   best      the REAL card size (card width x pixel ratio, 1080 px by default), 50 fps, and the encoder is re-run until the file lands between
 *             1 MB and 1.5 MB: the sharpest picture that still loads fast (`real` + `fit`)
 * `bitrate` is the mediabunny quality step the encoder is asked for (not used when the file is fitted to a size window).
 */
export interface QualityPreset { maxWidth: number; fps: number; bitrate: 'low' | 'medium' | 'high' | 'very-high'; /** width = the real card size */ real?: boolean; /** fit the file between [min, max] MB */ fit?: [number, number] }
export const VIDEO_QUALITIES: Record<VideoQuality, QualityPreset> = {
  low: { maxWidth: 480, fps: 24, bitrate: 'low' },
  balanced: { maxWidth: VIDEO_MAX_WIDTH, fps: VIDEO_FPS, bitrate: 'medium' },
  high: { maxWidth: 960, fps: 30, bitrate: 'high' },
  ultra: { maxWidth: 1280, fps: 60, bitrate: 'very-high' },
  best: { maxWidth: 1080, fps: 50, bitrate: 'very-high', real: true, fit: [1, 1.5] },
};
export const VIDEO_QUALITY_ORDER: VideoQuality[] = ['low', 'balanced', 'high', 'ultra', 'best'];
export const VIDEO_QUALITY_DEFAULT: VideoQuality = 'balanced';
/** Any stored value -> a valid quality (unknown / missing = balanced). */
export const cleanVideoQuality = (q: unknown): VideoQuality => (typeof q === 'string' && Object.prototype.hasOwnProperty.call(VIDEO_QUALITIES, q) ? (q as VideoQuality) : VIDEO_QUALITY_DEFAULT);
export const qualityPreset = (q?: unknown): QualityPreset => VIDEO_QUALITIES[cleanVideoQuality(q)];

/* ------------------------------ advanced rendering ------------------------------ */
/** Card width on a phone (CSS px) and the pixel ratio of a typical phone screen: together they are the "real card size" in pixels. */
export const REAL_CARD_W = 360;
export const REAL_DPR = 3;
export const ADV_LIMITS = {
  width: [240, 1920], fps: [24, 60], cardW: [240, 720], dpr: [1, 4], minMB: [0.1, 5], maxMB: [0.2, 8], kbps: [150, 20000], keyInt: [0.5, 10],
} as const;
const lim = (v: unknown, [lo, hi]: readonly [number, number] | readonly number[], step = 0): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  const c = Math.min(hi, Math.max(lo, v));
  return step ? +(Math.round(c / step) * step).toFixed(4) : c;
};
/** Stored advanced settings -> only the valid keys (every number clamped). Never throws; unknown keys are dropped. */
export function cleanAdvanced(raw: unknown): VideoAdvanced {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: VideoAdvanced = {};
  const set = <K extends keyof VideoAdvanced>(k: K, v: VideoAdvanced[K] | undefined) => { if (v !== undefined) out[k] = v; };
  // width 0 = "the real card size" (a legal, explicit choice)
  set('width', o.width === 0 ? 0 : (() => { const w = lim(o.width, ADV_LIMITS.width); return w === undefined ? undefined : Math.round(w / 2) * 2; })());
  set('fps', (() => { const f = lim(o.fps, ADV_LIMITS.fps); return f === undefined ? undefined : Math.round(f); })());
  set('cardW', (() => { const f = lim(o.cardW, ADV_LIMITS.cardW); return f === undefined ? undefined : Math.round(f); })());
  set('dpr', lim(o.dpr, ADV_LIMITS.dpr, 0.5));
  if (typeof o.fit === 'boolean') out.fit = o.fit;
  set('minMB', lim(o.minMB, ADV_LIMITS.minMB, 0.1));
  set('maxMB', lim(o.maxMB, ADV_LIMITS.maxMB, 0.1));
  set('kbps', (() => { const f = lim(o.kbps, ADV_LIMITS.kbps); return f === undefined ? undefined : Math.round(f / 10) * 10; })());
  set('keyInt', lim(o.keyInt, ADV_LIMITS.keyInt, 0.5));
  if (o.codec === 'auto' || o.codec === 'avc' || o.codec === 'vp9' || o.codec === 'av1') out.codec = o.codec;
  return out;
}
/** Stable string of the advanced settings ('' = none): part of the video signature. */
export const advancedKey = (adv?: unknown): string => { const c = cleanAdvanced(adv); return Object.keys(c).length ? JSON.stringify(c, Object.keys(c).sort()) : ''; };

/** Everything the renderer needs, after the preset and the admin's overrides have been combined. */
export interface RenderSettings {
  quality: VideoQuality; width: number; height: number; fps: number;
  /** The file is fitted between minMB and maxMB (the encoder is re-run until it lands there). */
  fit: boolean; minMB: number; maxMB: number;
  /** Manual bitrate in bit/s (fit off and the admin typed one); null = the preset's quality step. */
  bitrate: number | null; bitrateStep: QualityPreset['bitrate'];
  keyInt: number; codec: 'auto' | 'avc' | 'vp9' | 'av1';
  /** The width is the real card size. */
  real: boolean;
}
/** The real card size in pixels: card width on screen x pixel ratio (even, 240 - 1920). */
export const realWidth = (cardW = REAL_CARD_W, dpr = REAL_DPR) => Math.min(1920, Math.max(240, Math.round((cardW * dpr) / 2) * 2));

/** Combines a quality preset with the admin's advanced overrides. `ratio` = card image width / height. */
export function resolveRender(quality: unknown, advRaw: unknown, ratio: number): RenderSettings {
  const q = cleanVideoQuality(quality), pre = VIDEO_QUALITIES[q], a = cleanAdvanced(advRaw);
  const real = a.width === 0 || (a.width === undefined && !!pre.real);
  const widthPx = a.width && a.width > 0 ? a.width : real ? realWidth(a.cardW, a.dpr) : pre.maxWidth;
  const size = videoSize(ratio, widthPx);
  const fit = a.fit ?? !!pre.fit;
  let minMB = a.minMB ?? pre.fit?.[0] ?? 1, maxMB = a.maxMB ?? pre.fit?.[1] ?? 1.5;
  if (minMB > maxMB) minMB = maxMB;
  return {
    quality: q, width: size.width, height: size.height, fps: a.fps ?? pre.fps, fit, minMB, maxMB,
    bitrate: !fit && a.kbps ? a.kbps * 1000 : null, bitrateStep: pre.bitrate, keyInt: a.keyInt ?? 2, codec: a.codec ?? 'auto', real,
  };
}

/* ------------------------------ size estimate ------------------------------ */
/** Same formula as mediabunny's quality steps (very-low 0 ... very-high 1): bit/s for H.264 at this picture size, before the codec factor. */
const STEP_LEVEL: Record<QualityPreset['bitrate'], number> = { low: 0.25, medium: 0.5, high: 0.75, 'very-high': 1 };
export const CODEC_EFFICIENCY = { avc: 1, vp9: 0.6, av1: 0.4 } as const;
export function presetBitrate(step: QualityPreset['bitrate'], width: number, height: number, codec: keyof typeof CODEC_EFFICIENCY = 'avc'): number {
  const factor = 0.3 * Math.exp(2.5538 * STEP_LEVEL[step]);
  const base = 3e6 * Math.pow((width * height) / (1920 * 1080), 0.95) * CODEC_EFFICIENCY[codec] * factor;
  return Math.ceil(base / 1e3) * 1e3;
}
/** Share of the bit budget that holds and transitions really use (a hold is identical frames: nearly free). Measured on real renders, hence only an estimate. */
const HOLD_COST = 0.06, MOTION_COST = 0.9;
export type QualityLabel = 'low' | 'fair' | 'good' | 'great';
export interface SizeEstimate {
  /** The most likely size in bytes and the range it should land in. */
  bytes: number; lowBytes: number; highBytes: number;
  /** Average bit rate the encoder is given (bit/s) and what it costs per pixel of a MOVING frame. */
  bitrate: number; bpp: number; label: QualityLabel;
  seconds: number; frames: number; moveFrames: number; holdFrames: number; pictures: number;
  /** 'fit' = the renderer re-runs the encoder until the file is inside the window, so the estimate IS the window. */
  mode: 'fit' | 'manual' | 'preset';
  /** Does the estimate respect the maximum (always true in fit mode)? */
  withinMax: boolean;
}
/** Bits per pixel of a moving frame needed for each label (H.264; other codecs are divided by their efficiency factor). */
export const BPP_STEPS: [number, QualityLabel][] = [[0.14, 'great'], [0.08, 'good'], [0.045, 'fair']];
export const qualityLabel = (bpp: number, codec: keyof typeof CODEC_EFFICIENCY = 'avc'): QualityLabel => { const b = bpp / CODEC_EFFICIENCY[codec]; for (const [min, l] of BPP_STEPS) if (b >= min) return l; return 'low'; };

/**
 * How big will the rendered loop be? `pictures` = pictures of the card, `hold` / `speed` = its timing. The calculation, step by step:
 *   1. the loop = for each picture: a hold (hold s, HOLD_FPS) + a transition (0.65 / speed s, `fps` frames per second);
 *   2. fit mode: the file is made to land in [minMB, maxMB] -> the target is the middle of the window (never below what the content needs);
 *      manual: bitrate x duration; preset: mediabunny's own bitrate for the preset at this picture size;
 *   3. a hold costs almost nothing, so a bit rate is only fully used by the moving frames (HOLD_COST / MOTION_COST).
 */
export function estimateVideo(pictures: number, hold: number, speed: number, rs: RenderSettings, codec: keyof typeof CODEC_EFFICIENCY = 'avc'): SizeEstimate {
  const plan = planTimeline(pictures, [1], hold, speed, rs.fps);
  const holdFrames = plan.segments.filter((x) => x.kind === 'hold').reduce((n, x) => n + x.frames, 0);
  const moveFrames = plan.frames - holdFrames;
  const moveSec = moveFrames / rs.fps, holdSec = holdFrames / HOLD_FPS;
  const px = rs.width * rs.height;
  const MB = 1048576;
  let bytes: number, bitrate: number, mode: SizeEstimate['mode'];
  if (plan.frames === 0) return { bytes: 0, lowBytes: 0, highBytes: 0, bitrate: 0, bpp: 0, label: 'low', seconds: 0, frames: 0, moveFrames: 0, holdFrames: 0, pictures, mode: rs.fit ? 'fit' : rs.bitrate ? 'manual' : 'preset', withinMax: true };
  const util = (moveSec * MOTION_COST + holdSec * HOLD_COST) / Math.max(0.001, plan.duration);
  if (rs.fit) { mode = 'fit'; bytes = ((rs.minMB + rs.maxMB) / 2) * MB; bitrate = (bytes * 8) / (plan.duration * Math.max(0.05, util)); }
  else if (rs.bitrate) { mode = 'manual'; bitrate = rs.bitrate; bytes = (bitrate / 8) * plan.duration * util; }
  else { mode = 'preset'; bitrate = presetBitrate(rs.bitrateStep, rs.width, rs.height, rs.codec === 'auto' ? 'avc' : rs.codec); bytes = (bitrate / 8) * plan.duration * util; }
  // What reaches the moving frames: the bits the encoder spends there.
  const moveBits = mode === 'fit' ? bytes * 8 * ((moveSec * MOTION_COST) / Math.max(0.001, moveSec * MOTION_COST + holdSec * HOLD_COST)) : bitrate * moveSec * MOTION_COST;
  const bpp = moveFrames ? moveBits / (moveFrames * px) : 0;
  const spread = mode === 'fit' ? 0 : 0.3;
  const lowBytes = mode === 'fit' ? rs.minMB * MB : bytes * (1 - spread), highBytes = mode === 'fit' ? rs.maxMB * MB : bytes * (1 + spread);
  return { bytes, lowBytes, highBytes, bitrate, bpp, label: qualityLabel(bpp, rs.codec === 'auto' ? 'avc' : rs.codec), seconds: plan.duration, frames: plan.frames, moveFrames, holdFrames, pictures, mode, withinMax: mode === 'fit' || highBytes <= rs.maxMB * MB };
}
/** Widest picture (even px, 240+) that still reaches the `good` label inside `maxMB` for this card: the answer to "how sharp can it be at 1.5 MB?". */
export function sharpestWidth(pictures: number, hold: number, speed: number, rs: RenderSettings, ratio: number, codec: keyof typeof CODEC_EFFICIENCY = 'avc'): number {
  let best = 240;
  for (let w = 240; w <= 1920; w += 40) {
    const size = videoSize(ratio, w);
    const e = estimateVideo(pictures, hold, speed, { ...rs, width: size.width, height: size.height, fit: true, minMB: Math.min(rs.minMB, rs.maxMB), maxMB: rs.maxMB }, codec);
    if (e.bpp / CODEC_EFFICIENCY[codec] >= BPP_STEPS[1][0]) best = size.width; else break;
  }
  return best;
}

/** Longest loop the renderer accepts (30 pictures x ~1.5 s is already 45 s). */
export const VIDEO_MAX_SECONDS = 60;
/**
 * Direction the videos are rendered in: the app's own default direction (Darija, right-to-left). A video is ONE file for every language, so the
 * signature ignores the viewer's direction (a French viewer sees the same video; only the wipe direction is mirrored compared to the live engine).
 */
export const VIDEO_RTL = true;

export interface Segment { kind: 'hold' | 'transition'; /** picture shown (hold) / picture covered (transition) */ from: number; /** picture revealed (transition) */ to: number; effect: number; t0: number; t1: number; frames: number }
export interface Plan { segments: Segment[]; duration: number; frames: number; /** frames per second of the transitions */ fps: number }
export interface Frame { /** timestamp and duration, seconds */ t: number; dur: number; seg: Segment; /** eased-input progress 0..1 (transition only; 1 = the new picture fully shown) */ u: number }

/** The loop of `n` pictures with the card's effect list (cycled) and timing. Empty plan when it cannot animate (fewer than 2 pictures or no effect). */
export function planTimeline(n: number, effects: number[], hold: number, speed: number, fps: number = VIDEO_FPS): Plan {
  const rate = Number.isFinite(fps) && fps >= 1 ? Math.min(120, Math.round(fps)) : VIDEO_FPS;
  if (n < 2 || effects.length === 0) return { segments: [], duration: 0, frames: 0, fps: rate };
  const trFrames = Math.max(2, Math.round((TR_BASE / Math.max(0.1, speed)) * rate));
  const holdFrames = hold > 0 ? Math.max(1, Math.round(hold * HOLD_FPS)) : 0;
  const segments: Segment[] = [];
  let t = 0, frames = 0;
  for (let i = 0; i < n; i++) {
    if (holdFrames) { const d = holdFrames / HOLD_FPS; segments.push({ kind: 'hold', from: i, to: i, effect: -1, t0: t, t1: t + d, frames: holdFrames }); t += d; frames += holdFrames; }
    const d = trFrames / rate;
    segments.push({ kind: 'transition', from: i, to: (i + 1) % n, effect: effects[i % effects.length], t0: t, t1: t + d, frames: trFrames });
    t += d; frames += trFrames;
  }
  return { segments, duration: t, frames, fps: rate };
}

/** Every frame of the plan, in order. */
export function* frames(plan: Plan): Generator<Frame> {
  for (const seg of plan.segments) {
    const rate = seg.kind === 'hold' ? HOLD_FPS : plan.fps;
    for (let k = 0; k < seg.frames; k++) {
      // hold: k = 0..m-1 (identical frames); transition: k = 1..n so the last frame is u = 1 (the new picture, exactly)
      yield { t: seg.t0 + k / rate, dur: 1 / rate, seg, u: seg.kind === 'hold' ? 0 : (k + 1) / seg.frames };
    }
  }
}

/** Even output size (H.264 needs even numbers) for a card image zone of aspect ratio `ratio` (width / height). */
export function videoSize(ratio: number, maxWidth = VIDEO_MAX_WIDTH): { width: number; height: number } {
  const r = Math.min(3, Math.max(0.5, Number.isFinite(ratio) && ratio > 0 ? ratio : 1.6));
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(maxWidth);
  return { width, height: even(width / r) };
}

/** Short stable hash (FNV-1a, 32 bit, hex). */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/**
 * Signature of everything the video shows: the pictures, the effect list, hold, speed, direction, whether the animated extras are drawn and the render quality. A video whose stored signature differs
 * from the card's current one is OUTDATED: the app does not play it (the live animation runs instead) and the Performance page offers to re-render it.
 */
export const videoSignature = (images: string[], effects: number[], hold: number, speed: number, rtl: boolean = VIDEO_RTL, extras = false, quality: VideoQuality = VIDEO_QUALITY_DEFAULT, studio = '', adv = ''): string => {
  // The extras flag and the quality are only part of the hash when they differ from the defaults, so videos rendered before the options existed stay valid.
  const parts: unknown[] = [images, effects, hold, speed, rtl ? 1 : 0];
  if (extras) parts.push('extras');
  if (cleanVideoQuality(quality) !== VIDEO_QUALITY_DEFAULT) parts.push(`q:${quality}`);
  // The Animation Studio style (its signature, '' = none) outdates a video only when there is one.
  if (studio) parts.push(`s:${studio}`);
  // The advanced render settings (size, fps, size window ...) outdate a video only when the admin changed some.
  if (adv) parts.push(`a:${adv}`);
  return hash(JSON.stringify(parts));
};

/** Which animation the app plays on this phone: the pre-rendered video or the live engine. */
export function shouldPlayVideo(mode: 'lowEnd' | 'always' | 'off', lowEnd: boolean, hasValidVideo: boolean): boolean {
  if (!hasValidVideo || mode === 'off') return false;
  return mode === 'always' || lowEnd;
}

export type VideoStatus = 'none' | 'ready' | 'outdated';
export const videoStatus = (video: string | undefined, storedSig: string | undefined, currentSig: string): VideoStatus => (!video ? 'none' : storedSig === currentSig ? 'ready' : 'outdated');
