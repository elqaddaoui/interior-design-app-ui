/**
 * Image optimisation rules shared by web and native (pure functions, unit-checked by `npm run check:toolcards`).
 *
 * EVERY image uploaded from a device (admin pictures, logos, card pictures, video posters, client photos, chat photos) is re-encoded
 * here BEFORE it is sent to storage (Cloudflare R2): longest side capped, compressed, WebP whenever the device can encode it.
 * The only images that skip this step are the AI-rendered results: the server generates and stores those itself.
 *
 *   purpose   max side   format                       why
 *   photo     1280       JPEG (alpha not needed)      client photos are INPUT of the AI engines (which resize to <= 1024 anyway); JPEG is accepted everywhere
 *   chat      1024       WebP                         shown small in a bubble
 *   card      800        WebP                         home card pictures (cropped to the card shape first)
 *   poster    640        WebP                         video preview frame
 *   asset     1600       WebP, keeps transparency     admin pictures, logos, loader image
 */
export type ImagePurpose = 'photo' | 'chat' | 'card' | 'poster' | 'asset';
export type OutFormat = 'webp' | 'jpeg' | 'png';
export interface Preset { maxSide: number; quality: number; format: 'webp' | 'jpeg'; alpha: boolean }

export const PRESETS: Record<ImagePurpose, Preset> = {
  photo: { maxSide: 1280, quality: 0.78, format: 'jpeg', alpha: false },
  chat: { maxSide: 1024, quality: 0.75, format: 'webp', alpha: false },
  card: { maxSide: 800, quality: 0.8, format: 'webp', alpha: false },
  poster: { maxSide: 640, quality: 0.8, format: 'webp', alpha: false },
  asset: { maxSide: 1600, quality: 0.85, format: 'webp', alpha: true },
};

/** Largest data URL the server accepts inline (JSON body limit 4 MB, base64 adds a third). */
export const MAX_DATA_URL = 3.2 * 1024 * 1024;
/** Quality / scale steps tried until the result fits one request. */
export const SHRINK = 0.75;
export const MAX_ATTEMPTS = 6;

/** Size after capping the LONGEST side at `max` (never enlarged, whole pixels, at least 1). */
export function fitSide(w: number, h: number, max: number): { width: number; height: number; scale: number } {
  if (!(w > 0 && h > 0)) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

/** Mime type of a data URL ('' when it is not one). */
export const dataUrlMime = (value: string): string => /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i.exec(value)?.[1]?.toLowerCase() ?? '';

/** Types that are re-encoded. SVG (vector) and GIF (may be animated) are left exactly as the admin provided them. */
export const isRasterToOptimize = (mime: string) => mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/avif';

/**
 * The format actually produced: the preset's format, PNG-free. A canvas that cannot encode WebP answers a PNG data URL, so the caller passes
 * what it really got (`produced`); with transparency required a non-WebP answer is kept as PNG, otherwise it becomes JPEG.
 */
export function fallbackFormat(wanted: 'webp' | 'jpeg', alpha: boolean, webpSupported: boolean): OutFormat {
  if (wanted === 'jpeg') return 'jpeg';
  if (webpSupported) return 'webp';
  return alpha ? 'png' : 'jpeg';
}

/** True when an already stored-looking picture needs no second pass (already WebP / JPEG within the size cap and the data limit). */
export function alreadyOptimized(mime: string, w: number, h: number, bytes: number, purpose: ImagePurpose): boolean {
  const p = PRESETS[purpose];
  const okType = mime === 'image/webp' || (mime === 'image/jpeg' && p.format === 'jpeg');
  return okType && Math.max(w, h) <= p.maxSide && bytes <= MAX_DATA_URL;
}

/** Approximate decoded size of a base64 data URL, in bytes. */
export const dataUrlBytes = (value: string): number => Math.max(0, Math.floor(((value.length - (value.indexOf(',') + 1)) * 3) / 4));
