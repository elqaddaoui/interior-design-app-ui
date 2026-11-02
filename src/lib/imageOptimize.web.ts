import { MAX_ATTEMPTS, MAX_DATA_URL, PRESETS, SHRINK, alreadyOptimized, dataUrlBytes, dataUrlMime, fallbackFormat, fitSide, isRasterToOptimize, type ImagePurpose } from './imageOptimizeCore';

export type { ImagePurpose } from './imageOptimizeCore';
export { PRESETS } from './imageOptimizeCore';

/** A decoded picture (EXIF rotation applied by the browser). */
async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error('decode failed')); el.src = url; });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
  } finally { URL.revokeObjectURL(url); }
}

const toBlob = async (src: Blob | string): Promise<Blob> => (typeof src === 'string' ? (await fetch(src)).blob() : src);

/**
 * Optimises a picture (File / Blob / data URL / blob: URL) for upload: longest side capped, re-encoded (WebP, or JPEG for the AI-input
 * purpose), shrunk step by step until it fits one request. Resolves a data URL. Throws when the picture cannot be decoded.
 * `crop` (optional, source pixels) is applied first (card pictures are cropped to the card's shape).
 */
export async function optimizeImage(src: Blob | string, purpose: ImagePurpose, crop?: { originX: number; originY: number; width: number; height: number } | null): Promise<string> {
  const preset = PRESETS[purpose];
  const blob = await toBlob(src);
  const image = await decode(blob);
  try {
    if (!image.width || !image.height) throw new Error('empty image');
    const sw = crop ? crop.width : image.width, sh = crop ? crop.height : image.height;
    let scale = fitSide(sw, sh, preset.maxSide).scale;
    let quality = preset.quality;
    let webpOk = true;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const format = fallbackFormat(preset.format, preset.alpha, webpOk);
      if (!preset.alpha || format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
      if (crop) ctx.drawImage(image.source, crop.originX, crop.originY, crop.width, crop.height, 0, 0, width, height);
      else ctx.drawImage(image.source, 0, 0, width, height);
      let out = canvas.toDataURL(`image/${format}`, quality);
      // A browser that cannot encode WebP answers a PNG: retry once with the fallback format.
      if (format === 'webp' && !out.startsWith('data:image/webp')) { webpOk = false; attempt--; continue; }
      if (out.length <= MAX_DATA_URL) return out;
      scale *= SHRINK; quality = Math.max(0.5, quality - 0.05);
      out = '';
    }
    throw new Error('too large');
  } finally { image.release(); }
}

/**
 * Data URL -> optimised data URL. A picture that is already small WebP (or JPEG for `photo`), SVG and GIF pass through untouched,
 * so a second call never degrades quality. If the picture cannot be decoded it is returned as it was (the server still checks it).
 */
export async function optimizeDataUrl(dataUrl: string, purpose: ImagePurpose): Promise<string> {
  const mime = dataUrlMime(dataUrl);
  if (!isRasterToOptimize(mime)) return dataUrl;
  try {
    const blob = await toBlob(dataUrl);
    const probe = await decode(blob);
    const [w, h] = [probe.width, probe.height];
    probe.release();
    if (alreadyOptimized(mime, w, h, dataUrlBytes(dataUrl), purpose)) return dataUrl;
    return await optimizeImage(blob, purpose);
  } catch { return dataUrl; }
}
