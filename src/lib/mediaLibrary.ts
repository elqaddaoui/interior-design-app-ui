import { Platform } from 'react-native';
import { api, backendEnabled, BackendError } from '@/lib/backend';
import { optimizeImage } from '@/lib/imageOptimize';
import { uploadBlob, uploadDataUrl, uploadLocalFile } from '@/lib/media';

/**
 * The store's media library (WordPress-like): every picture and video the store holds or shows. The server lists and edits ONLY this store's files;
 * a file several stores share is one stored object with one entry per store, so deleting it here never touches the others.
 */
export type LibKind = '' | 'image' | 'video';
/** `used`: content of the store shows it. `linked`: hosted elsewhere (an external address the content points at), listed read-only. */
export type LibItem = { id: string; url: string; mime: string; kind: 'image' | 'video' | 'audio'; size: number | null; title: string; alt: string; storage: string; createdAt: number; used?: boolean; linked?: boolean };
export type LibUse = { type: 'item'; coll: string; id: string } | { type: 'doc'; name: string } | { type: 'avatar'; id: string };
export type LibPage = { items: LibItem[]; more: boolean; total: number };

/** The library exists for every store that talks to a server (the offline demo keeps the plain "upload" buttons). */
export const useLibraryEnabled = () => backendEnabled;

export const listLibrary = (o: { kind?: LibKind; q?: string; offset?: number; limit?: number } = {}) => {
  const p = new URLSearchParams();
  if (o.kind) p.set('kind', o.kind);
  if (o.q) p.set('q', o.q);
  p.set('limit', String(o.limit ?? 48));
  p.set('offset', String(o.offset ?? 0));
  return api<LibPage>(`/admin/library?${p.toString()}`);
};
export const getLibraryItem = (id: string) => api<LibItem & { usedIn: LibUse[] }>(`/admin/library/${id}`);
export const updateLibraryItem = (id: string, patch: { title?: string; alt?: string }) => api<LibItem & { usedIn: LibUse[] }>(`/admin/library/${id}`, { method: 'PATCH', body: patch });
export const removeLibraryItems = (ids: string[], force = false) => api<{ removed: string[]; blocked: { id: string; reason: string }[] }>('/admin/library', { method: 'DELETE', body: { ids, force } });

export const errorCodeOf = (error: unknown) => (error instanceof BackendError ? error.code || `HTTP_${error.status}` : error instanceof Error ? error.message : '');
/** Translation key (in `admin.f` / `improve`) for an upload error, same wording as the other upload buttons. */
export const uploadErrorKey = (error: unknown) => {
  const code = errorCodeOf(error);
  return /TOO_LARGE/.test(code) ? 'admin.f.videoTooLarge' : code === 'R2_REQUIRED' ? 'improve.videoNeedsR2' : /^UPLOAD_(BLOCKED|FAILED_403)$/.test(code) ? 'improve.uploadBlocked' : 'admin.f.uploadFailed';
};

const ACCEPT: Record<LibKind, string> = { '': 'image/*,video/mp4,video/webm,video/quicktime', image: 'image/*', video: 'video/mp4,video/webm,video/quicktime' };
export type DeviceUpload = { urls: string[]; failed: number; error?: unknown; cancelled?: boolean };

/** Web: the file dialog. `click()` must run inside the tap itself (Safari), so nothing is awaited before it. */
function chooseWebFiles(kind: LibKind, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve([]);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT[kind];
    input.multiple = multiple;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;width:1px;height:1px';
    input.addEventListener('change', () => { resolve(Array.from(input.files ?? [])); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * "Upload new": the person picks one or several files on the device; each is optimised / stored through the normal upload routes
 * (the server adds it to this store's library). Stops at the first hard error (same message as the other upload buttons).
 */
export async function uploadFromDevice(o: { kind?: LibKind; multiple?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<DeviceUpload> {
  const kind = o.kind ?? '', multiple = !!o.multiple;
  const urls: string[] = [];
  let failed = 0;
  try {
    if (Platform.OS === 'web') {
      const files = await chooseWebFiles(kind, multiple);
      if (!files.length) return { urls, failed, cancelled: true };
      for (let i = 0; i < files.length; i++) {
        o.onProgress?.(i, files.length);
        const type = (files[i].type || '').toLowerCase();
        if ((kind === 'image' && !type.startsWith('image/')) || (kind === 'video' && !type.startsWith('video/'))) { failed++; continue; }
        try { urls.push(await uploadBlob(files[i])); } catch (error) { if (/TOO_LARGE|R2_REQUIRED|UPLOAD_BLOCKED|UPLOAD_FAILED_403/.test(errorCodeOf(error))) return { urls, failed: failed + 1, error }; failed++; }
      }
      o.onProgress?.(files.length, files.length);
      return { urls, failed };
    }
    const ImagePicker = await import('expo-image-picker');
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === 'image' ? ['images'] : kind === 'video' ? ['videos'] : ['images', 'videos'], allowsMultipleSelection: multiple, quality: 1 });
    if (res.canceled || !res.assets?.length) return { urls, failed, cancelled: true };
    for (let i = 0; i < res.assets.length; i++) {
      const asset = res.assets[i];
      o.onProgress?.(i, res.assets.length);
      try {
        if (asset.type === 'video') {
          let size = asset.fileSize;
          if (!size) { const { File } = await import('expo-file-system'); size = new File(asset.uri).size ?? 0; }
          const lower = asset.uri.toLowerCase();
          const type = asset.mimeType || (lower.endsWith('.mov') ? 'video/quicktime' : lower.endsWith('.webm') ? 'video/webm' : 'video/mp4');
          urls.push(await uploadLocalFile(asset.uri, type, size));
        } else urls.push(await uploadDataUrl(await optimizeImage(asset.uri, 'asset', null), 'asset'));
      } catch (error) { if (/TOO_LARGE|R2_REQUIRED|UPLOAD_BLOCKED|UPLOAD_FAILED_403/.test(errorCodeOf(error))) return { urls, failed: failed + 1, error }; failed++; }
    }
    o.onProgress?.(res.assets.length, res.assets.length);
    return { urls, failed };
  } catch (error) {
    return { urls, failed: failed + 1, error };
  }
}
