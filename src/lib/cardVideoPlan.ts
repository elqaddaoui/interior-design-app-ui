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

export const VIDEO_FPS = 30;
/** Frames per second inside a hold (identical frames; a low rate keeps the file tiny and the loop exact). */
export const HOLD_FPS = 10;
export const VIDEO_MAX_WIDTH = 720;
/** Longest loop the renderer accepts (30 pictures x ~1.5 s is already 45 s). */
export const VIDEO_MAX_SECONDS = 60;
/**
 * Direction the videos are rendered in: the app's own default direction (Darija, right-to-left). A video is ONE file for every language, so the
 * signature ignores the viewer's direction (a French viewer sees the same video; only the wipe direction is mirrored compared to the live engine).
 */
export const VIDEO_RTL = true;

export interface Segment { kind: 'hold' | 'transition'; /** picture shown (hold) / picture covered (transition) */ from: number; /** picture revealed (transition) */ to: number; effect: number; t0: number; t1: number; frames: number }
export interface Plan { segments: Segment[]; duration: number; frames: number }
export interface Frame { /** timestamp and duration, seconds */ t: number; dur: number; seg: Segment; /** eased-input progress 0..1 (transition only; 1 = the new picture fully shown) */ u: number }

/** The loop of `n` pictures with the card's effect list (cycled) and timing. Empty plan when it cannot animate (fewer than 2 pictures or no effect). */
export function planTimeline(n: number, effects: number[], hold: number, speed: number): Plan {
  if (n < 2 || effects.length === 0) return { segments: [], duration: 0, frames: 0 };
  const trFrames = Math.max(2, Math.round((TR_BASE / Math.max(0.1, speed)) * VIDEO_FPS));
  const holdFrames = hold > 0 ? Math.max(1, Math.round(hold * HOLD_FPS)) : 0;
  const segments: Segment[] = [];
  let t = 0, frames = 0;
  for (let i = 0; i < n; i++) {
    if (holdFrames) { const d = holdFrames / HOLD_FPS; segments.push({ kind: 'hold', from: i, to: i, effect: -1, t0: t, t1: t + d, frames: holdFrames }); t += d; frames += holdFrames; }
    const d = trFrames / VIDEO_FPS;
    segments.push({ kind: 'transition', from: i, to: (i + 1) % n, effect: effects[i % effects.length], t0: t, t1: t + d, frames: trFrames });
    t += d; frames += trFrames;
  }
  return { segments, duration: t, frames };
}

/** Every frame of the plan, in order. */
export function* frames(plan: Plan): Generator<Frame> {
  for (const seg of plan.segments) {
    const rate = seg.kind === 'hold' ? HOLD_FPS : VIDEO_FPS;
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
 * Signature of everything the video shows: the pictures, the effect list, hold, speed, direction and whether the animated extras are drawn. A video whose stored signature differs
 * from the card's current one is OUTDATED: the app does not play it (the live animation runs instead) and the Performance page offers to re-render it.
 */
export const videoSignature = (images: string[], effects: number[], hold: number, speed: number, rtl: boolean = VIDEO_RTL, extras = false): string =>
  // The extras flag is only part of the hash when on, so videos rendered before the option existed stay valid.
  hash(JSON.stringify(extras ? [images, effects, hold, speed, rtl ? 1 : 0, 'extras'] : [images, effects, hold, speed, rtl ? 1 : 0]));

/** Which animation the app plays on this phone: the pre-rendered video or the live engine. */
export function shouldPlayVideo(mode: 'lowEnd' | 'always' | 'off', lowEnd: boolean, hasValidVideo: boolean): boolean {
  if (!hasValidVideo || mode === 'off') return false;
  return mode === 'always' || lowEnd;
}

export type VideoStatus = 'none' | 'ready' | 'outdated';
export const videoStatus = (video: string | undefined, storedSig: string | undefined, currentSig: string): VideoStatus => (!video ? 'none' : storedSig === currentSig ? 'ready' : 'outdated');
