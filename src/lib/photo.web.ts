import type { PickManyOptions, PickManyResult, PickOptions, PickResult } from './photoTypes';

export type { PickManyOptions, PickManyResult, PickOptions, PickResult } from './photoTypes';

/**
 * Web picker. Browsers have no camera/gallery permission API for file inputs: the browser itself asks once
 * for the camera and remembers the answer per site, so we never show our own permission error here.
 * It also does not rely on the file's MIME type (some Android galleries return an empty one), which made
 * the stock expo-image-picker web implementation throw and the app report it as a permission problem.
 *
 * IMPORTANT: input.click() must run synchronously inside the user's tap, so nothing is awaited before it.
 */
function chooseFiles(camera: boolean, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    if (multiple && !camera) input.multiple = true;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px';
    let done = false;
    const finish = (files: File[]) => {
      if (done) return;
      done = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(files);
    };
    // Browsers without the `cancel` event: when the window regains focus and nothing was chosen, treat as cancelled.
    const onFocus = () => setTimeout(() => { if (!input.files?.length) finish([]); }, 1500);
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

const chooseFile = async (camera: boolean): Promise<File | null> => (await chooseFiles(camera, false))[0] ?? null;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode failed'));
      el.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => {} };
  } finally { URL.revokeObjectURL(url); }
}

/** Largest data URL the server accepts inline (JSON body limit is 4 MB; base64 adds a third). */
const MAX_DATA_URL = 3.2 * 1024 * 1024;

/**
 * Downscale to <= 1024px JPEG (or <= 1600px PNG when transparency matters). A picture that is still too big for one request is
 * re-encoded as WebP (keeps transparency) and then shrunk step by step: it must always fit, otherwise the upload is refused
 * and the item ends up saved without its picture.
 */
async function compress(file: File, options: PickOptions): Promise<string> {
  const png = !!options.preserveTransparency;
  const max = png ? 1600 : 1024;
  const image = await decode(file);
  try {
    if (!image.width || !image.height) throw new Error('empty image');
    let scale = Math.min(1, max / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      let out = canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.75);
      if (png && out.length > MAX_DATA_URL) {
        const webp = canvas.toDataURL('image/webp', 0.85);
        out = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.8);
      }
      if (out.length <= MAX_DATA_URL) return out;
      scale *= 0.75;
    }
    throw new Error('too large');
  } finally { image.release(); }
}

export async function pickPhoto(source: 'camera' | 'gallery', options: PickOptions = {}): Promise<PickResult> {
  try {
    if (typeof document === 'undefined') return { error: 'cancelled' };
    const file = await chooseFile(source === 'camera');
    if (!file) return { error: 'cancelled' };
    try {
      return { uri: await compress(file, options) };
    } catch {
      // Undecodable by the canvas (rare format): keep the original only if it is small enough to send.
      if (file.size <= 2 * 1024 * 1024) return { uri: await readAsDataUrl(file) };
      return { error: 'failed' };
    }
  } catch {
    return { error: 'failed' };
  }
}

/** One File -> data URL, with the same fallback as pickPhoto. Resolves '' when the file is not a usable picture. */
async function fileToUri(file: File, options: PickOptions): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) return '';
  try { return await compress(file, options); } catch {
    if (file.size <= 2 * 1024 * 1024) { try { return await readAsDataUrl(file); } catch { return ''; } }
    return '';
  }
}

/** Pictures from a list of files (a drop from the computer, or the picker). Order is kept; unreadable ones are counted in `failed`. */
export async function photosFromFiles(files: File[], options: PickManyOptions = {}): Promise<PickManyResult> {
  const list = files.filter((f) => !f.type || f.type.startsWith('image/')).slice(0, options.limit ?? 50);
  if (!list.length) return { error: 'failed' };
  const uris: string[] = [];
  let failed = 0;
  for (const file of list) { const uri = await fileToUri(file, options); if (uri) uris.push(uri); else failed++; }
  return uris.length ? { uris, failed } : { error: 'failed' };
}

/** Gallery multi-select on the computer / phone browser: the file dialog allows picking several pictures at once. */
export async function pickPhotos(options: PickManyOptions = {}): Promise<PickManyResult> {
  try {
    if (typeof document === 'undefined') return { error: 'cancelled' };
    const files = await chooseFiles(false, true);
    if (!files.length) return { error: 'cancelled' };
    return await photosFromFiles(files, options);
  } catch {
    return { error: 'failed' };
  }
}
