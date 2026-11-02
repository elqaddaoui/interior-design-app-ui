import { Image as RNImage } from 'react-native';
import * as Manipulator from 'expo-image-manipulator';
import { MAX_ATTEMPTS, MAX_DATA_URL, PRESETS, SHRINK, dataUrlMime, fitSide, isRasterToOptimize, type ImagePurpose } from './imageOptimizeCore';

export type { ImagePurpose } from './imageOptimizeCore';
export { PRESETS } from './imageOptimizeCore';

const dims = (uri: string) => new Promise<{ w: number; h: number }>((resolve) => RNImage.getSize(uri, (w, h) => resolve({ w, h }), () => resolve({ w: 0, h: 0 })));

/**
 * Native: a local picture (file:// URI from the picker or the camera) -> optimised data URL. Longest side capped, WebP (JPEG for the AI-input
 * purpose), shrunk step by step until it fits one request. `crop` (source pixels) is applied first. Throws when it cannot be encoded.
 */
export async function optimizeImage(source: string | Blob, purpose: ImagePurpose, crop?: { originX: number; originY: number; width: number; height: number } | null): Promise<string> {
  // Same signature as the web file (the shared callers type-check against either); a Blob only exists on the web.
  if (typeof source !== 'string') throw new Error('NATIVE_NEEDS_URI');
  const uri = source;
  const preset = PRESETS[purpose];
  const { File } = await import('expo-file-system');
  const { w, h } = await dims(uri);
  const sw = crop ? crop.width : w, sh = crop ? crop.height : h;
  let width = sw > 0 ? fitSide(sw, sh, preset.maxSide).width : preset.maxSide;
  let quality = preset.quality;
  const format = preset.format === 'jpeg' ? Manipulator.SaveFormat.JPEG : Manipulator.SaveFormat.WEBP;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const actions: Manipulator.Action[] = [];
    if (crop) actions.push({ crop });
    if (sw <= 0 || width < sw) actions.push({ resize: { width } });
    const out = await Manipulator.manipulateAsync(uri, actions, { compress: quality, format, base64: false });
    const base64 = await new File(out.uri).base64();
    const data = `data:image/${preset.format};base64,${base64}`;
    if (data.length <= MAX_DATA_URL) return data;
    width = Math.max(256, Math.round(width * SHRINK)); quality = Math.max(0.5, quality - 0.05);
  }
  throw new Error('too large');
}

/** Native data URLs come from `optimizeImage` already; only a foreign raster data URL is written to a temp file and processed. SVG / GIF pass through. */
export async function optimizeDataUrl(dataUrl: string, purpose: ImagePurpose): Promise<string> {
  const mime = dataUrlMime(dataUrl);
  if (!isRasterToOptimize(mime) || dataUrl.length <= 40 * 1024) return dataUrl;
  try {
    const { File, Paths } = await import('expo-file-system');
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const file = new File(Paths.cache, `opt-${Date.now()}.${ext}`);
    file.create({ overwrite: true });
    file.write(dataUrl.slice(dataUrl.indexOf(',') + 1), { encoding: 'base64' });
    try { return await optimizeImage(file.uri, purpose); } finally { try { file.delete(); } catch { /* temp file */ } }
  } catch { return dataUrl; }
}
