import * as ImagePicker from 'expo-image-picker';
import * as Manipulator from 'expo-image-manipulator';
import { services } from '@/data/repositories';
import { backendEnabled } from '@/lib/backend';
import type { PickManyOptions, PickManyResult, PickOptions, PickResult } from './photoTypes';

export type { PickManyOptions, PickManyResult, PickOptions, PickResult } from './photoTypes';

/**
 * The camera permission is requested ONCE, the first time it is needed. The OS stores the answer, so afterwards we only
 * read the current status and never prompt again. The gallery needs no permission (system photo picker): it is never gated.
 */
async function cameraAllowed(): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false; // refused for good: only the system settings can change it
  return (await ImagePicker.requestCameraPermissionsAsync()).granted;
}

/** Downscale one picked asset and turn it into what the app stores (a data URL with the backend, an uploaded URL otherwise). */
async function processAsset(asset: ImagePicker.ImagePickerAsset, options: PickOptions): Promise<string> {
  let uri = asset.uri;
  try {
    const out = await Manipulator.manipulateAsync(uri, asset.width > 1024 ? [{ resize: { width: 1024 } }] : [], { compress: 0.6, format: options.preserveTransparency ? Manipulator.SaveFormat.PNG : Manipulator.SaveFormat.JPEG });
    uri = out.uri;
  } catch { /* keep original */ }
  // With the backend, send the (downscaled) bytes: the server stores them in media storage (R2) and keeps only the
  // /api/media URL. A device-local file:// path would mean nothing to the server or to other devices.
  if (backendEnabled) {
    const { File } = await import('expo-file-system');
    const png = !!options.preserveTransparency;
    let base64 = await new File(uri).base64();
    let type = png ? 'png' : 'jpeg';
    // One request carries at most ~4 MB: a bigger picture is re-encoded (WebP keeps transparency) and shrunk until it fits.
    for (let width = 1024; base64.length > 3.2 * 1024 * 1024 && width >= 256; width = Math.round(width * 0.75)) {
      const out = await Manipulator.manipulateAsync(uri, [{ resize: { width } }], { compress: 0.7, format: Manipulator.SaveFormat.WEBP });
      base64 = await new File(out.uri).base64(); type = 'webp';
    }
    return `data:image/${type};base64,${base64}`;
  }
  return services.upload.upload(uri, 'photos');
}

/** Camera or Gallery ONLY. Result is downscaled so it is cheap to store/upload. */
export async function pickPhoto(source: 'camera' | 'gallery', options: PickOptions = {}): Promise<PickResult> {
  try {
    let res: ImagePicker.ImagePickerResult;
    if (source === 'camera') {
      if (!await cameraAllowed()) return { error: 'permission' };
      res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    } else {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: options.preserveTransparency ? 1 : 0.8, allowsMultipleSelection: false });
    }
    if (res.canceled || !res.assets?.[0]) return { error: 'cancelled' };
    return { uri: await processAsset(res.assets[0], options) };
  } catch {
    return { error: 'failed' };
  }
}

/**
 * Gallery multi-select (the system photo picker lets the person tick several pictures). Pictures come back in the order they were
 * ticked; one that cannot be read is skipped and counted in `failed`.
 */
export async function pickPhotos(options: PickManyOptions = {}): Promise<PickManyResult> {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: options.preserveTransparency ? 1 : 0.8, allowsMultipleSelection: true, selectionLimit: options.limit ?? 0, orderedSelection: true });
    if (res.canceled || !res.assets?.length) return { error: 'cancelled' };
    const uris: string[] = [];
    let failed = 0;
    for (const asset of res.assets) { try { uris.push(await processAsset(asset, options)); } catch { failed++; } }
    return uris.length ? { uris, failed } : { error: 'failed' };
  } catch {
    return { error: 'failed' };
  }
}

/** Dropping files from a computer only exists on the web build. */
export async function photosFromFiles(_files: unknown[], _options: PickManyOptions = {}): Promise<PickManyResult> {
  return { error: 'failed' };
}
