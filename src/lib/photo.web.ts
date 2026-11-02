import { optimizeImage } from './imageOptimize';
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

/** Every picked picture goes through the shared optimiser (longest side capped, WebP / JPEG, shrunk until it fits one request). */
const compress = (file: File, options: PickOptions) => optimizeImage(file, options.purpose ?? (options.preserveTransparency ? 'asset' : 'photo'));

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
