 
import { Image as RNImage, Platform } from 'react-native';
import { optimizeImage } from '@/lib/imageOptimize';

export interface Rect { originX: number; originY: number; width: number; height: number }
export const canEditImage = Platform.OS === 'web' && typeof document !== 'undefined';

export const imageSize = (uri: string) => new Promise<{ w: number; h: number }>((resolve) => RNImage.getSize(uri, (w, h) => resolve({ w, h }), () => resolve({ w: 0, h: 0 })));
/** width / height, clamped to what the spec accepts. */
export async function ratioOf(uri: string): Promise<number> { const { w, h } = await imageSize(uri); return w && h ? Math.min(12, Math.max(0.1, w / h)) : 1; }
/** Crop in source pixels (shared optimiser: WebP with transparency, size-capped). */
export const cropImage = (uri: string, rect: Rect) => optimizeImage(uri, 'asset', rect);

const load = (uri: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('decode')); i.src = uri; });
const pixels = async (uri: string) => {
  const img = await load(uri);
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0);
  return { c, g, w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
};

/** Bounding box of the visible artwork (transparent or background-coloured margins removed). null = nothing to trim. */
export async function trimRect(uri: string): Promise<Rect | null> {
  if (!canEditImage) return null;
  const { w, h, data } = await pixels(uri);
  const hasAlpha = (() => { for (let i = 3; i < data.length; i += 4 * 17) if (data[i] < 250) return true; return false; })();
  const bg = [data[0], data[1], data[2]];
  const ink = (x: number, y: number) => { const i = (y * w + x) * 4; return hasAlpha ? data[i + 3] > 12 : Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 40; };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const pad = Math.round(Math.max(w, h) * 0.01);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const rect = { originX: x0, originY: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  return rect.width >= w - 2 && rect.height >= h - 2 ? null : rect;
}

/** A white copy of a transparent logo (for dark backgrounds). null when the picture has no transparency to work with. */
export async function whiteVersion(uri: string): Promise<string | null> {
  if (!canEditImage) return null;
  const { c, g, data } = await pixels(uri);
  let clear = false;
  for (let i = 3; i < data.length; i += 4 * 13) if (data[i] < 200) { clear = true; break; }
  if (!clear) return null;
  g.globalCompositeOperation = 'source-in'; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
