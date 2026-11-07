 
import { Platform } from 'react-native';
import { FALLBACK_STACK } from './fontData';
import { estimateMeasure, type Measure } from './layout';
import { fontRevision, useFontRevision } from './fonts';

let ctx2d: any = null;
let cacheRev = -1;
const cache = new Map<string, { width: number; ascent: number; descent: number }>();

/** Real text metrics from a canvas (web). Cached per font-load revision, so a font arriving re-measures. Native / Node: estimate. */
export function measureFor(rev: number): Measure {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return estimateMeasure;
  if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
  if (!ctx2d) return estimateMeasure;
  if (cacheRev !== rev) { cache.clear(); cacheRev = rev; }
  return (text, f) => {
    const key = `${f.family}|${f.weight}|${f.italic}|${f.size}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    ctx2d.font = `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px "${f.family}", ${FALLBACK_STACK}`;
    const m = ctx2d.measureText(text);
    const out = {
      width: m.width,
      ascent: Math.min(f.size * 0.95, m.fontBoundingBoxAscent ?? f.size * 0.76),
      descent: Math.min(f.size * 0.35, m.fontBoundingBoxDescent ?? f.size * 0.22),
    };
    cache.set(key, out);
    return out;
  };
}
/** React hook: the measurer for the fonts loaded right now (changes identity when a font finishes loading). */
export function useMeasure(): Measure {
  const rev = useFontRevision();
  return measureFor(rev);
}
export const measureNow = () => measureFor(fontRevision());
