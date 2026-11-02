import { uploadDataUrl } from '@/lib/media';

const MAX_WIDTH = 640;
const TIMEOUT_MS = 12000;

/** Draws one frame of a video (a blob: or same-origin URL, or any CORS-enabled URL) to a JPEG data URL. Rejects when the browser cannot read it. */
function captureFrame(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const done = (action: () => void) => { clearTimeout(timer); video.removeAttribute('src'); video.load(); action(); };
    const timer = setTimeout(() => done(() => reject(new Error('POSTER_TIMEOUT'))), TIMEOUT_MS);
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.onerror = () => done(() => reject(new Error('POSTER_LOAD')));
    video.onloadedmetadata = () => { video.currentTime = Math.min(0.1, (video.duration || 0.1) / 2); };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, MAX_WIDTH / (video.videoWidth || MAX_WIDTH));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.82); // throws on a cross-origin video without CORS headers
        done(() => data.length > 1000 ? resolve(data) : reject(new Error('POSTER_EMPTY')));
      } catch (error) { done(() => reject(error)); }
    };
    video.src = src;
  });
}

/** First frame of a video file or URL -> stored image URL (`/api/media/...`), or '' when it cannot be captured. Never throws. */
export async function posterForVideo(source: string | Blob): Promise<string> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  try { return await uploadDataUrl(await captureFrame(url), 'poster'); }
  catch { return ''; }
  finally { if (typeof source !== 'string') URL.revokeObjectURL(url); }
}
