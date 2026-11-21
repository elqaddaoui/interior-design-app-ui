import { toJpeg } from 'html-to-image';

/**
 * Picture of the app as visitors see it right now: the home page is loaded in a hidden, same-origin frame (desktop size),
 * given a few seconds to draw, then rendered to a JPEG data URL. Returns null when anything fails (the backup then uses the
 * picture the server draws itself), so a failed screenshot never blocks a backup.
 */
export async function captureApp(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:800px;border:0;visibility:hidden;pointer-events:none';
  frame.src = '/';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 20000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.onerror = () => { clearTimeout(timer); reject(new Error('load')); };
      document.body.appendChild(frame);
    });
    await new Promise(r => setTimeout(r, 3500)); // the app draws after its scripts and data arrive
    const doc = frame.contentDocument;
    if (!doc?.body) return null;
    const url = await toJpeg(doc.documentElement, { width: 1280, height: 800, quality: 0.72, pixelRatio: 0.75, cacheBust: false, backgroundColor: '#ffffff', skipFonts: true, style: { visibility: 'visible' } });
    return typeof url === 'string' && url.startsWith('data:image/jpeg;base64,') && url.length < 3_000_000 ? url : null;
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}
