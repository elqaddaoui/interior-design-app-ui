 
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { cssUrl, fontMeta, availableWeights, snapWeight, FONTS, FALLBACK_STACK } from './fontData';

export * from './fontData';

let revision = 0;
const listeners = new Set<() => void>();
const notify = () => { revision++; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const done = new Map<string, Promise<void>>();

const webLink = (url: string): Promise<void> => new Promise((resolve) => {
  if (typeof document === 'undefined') return resolve();
  if (document.querySelector(`link[data-brand-font="${url}"]`)) return resolve();
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = url; link.setAttribute('data-brand-font', url);
  link.onload = () => resolve(); link.onerror = () => resolve();
  document.head.appendChild(link);
});

/** Native: the CSS API answers a single .ttf for one weight; expo-font registers it under a per-weight family key. */
const nativeKey = (family: string, weight: number, italic: boolean) => `bf_${family.replace(/\W/g, '')}_${weight}${italic ? 'i' : ''}`;
async function nativeLoad(family: string, weight: number, italic: boolean) {
  const Font = await import('expo-font');
  const key = nativeKey(family, weight, italic);
  if (Font.isLoaded(key)) return;
  const f = fontMeta(family);
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${italic && f?.italic ? 'ital,wght@1,' : 'wght@'}${weight}`;
  const css = await (await fetch(url, { headers: { 'User-Agent': 'okhttp/4.12.0' } })).text();
  const src = /url\((https:[^)]+)\)/.exec(css)?.[1];
  if (src) await Font.loadAsync(key, { uri: src });
}

/** Loads one family (all its weights on web, the exact weight on native). `text` = tiny subset for list previews. */
export function loadFont(family: string, weight = 400, italic = false, text?: string): Promise<void> {
  const k = Platform.OS === 'web' ? `${family}|${italic}|${text ?? ''}` : `${family}|${weight}|${italic}`;
  // A tiny list-preview subset must never be declared after the full family (it would replace it).
  if (text && Platform.OS === 'web') { const full = done.get(`${family}|${italic}|`); if (full) return full; }
  const known = done.get(k);
  if (known) return known;
  const job = (async () => {
    try {
      if (Platform.OS === 'web') {
        await webLink(cssUrl(family, { italic, text }));
        await (document as any).fonts?.load?.(`${italic ? 'italic ' : ''}${weight} 16px "${family}"`, text ?? 'Aa\u0627');
      } else await nativeLoad(family, weight, italic);
    } catch { /* offline or blocked: the fallback stack stays readable */ }
    notify();
  })();
  done.set(k, job);
  return job;
}

export interface FontStyle { fontFamily: string; fontWeight: any; fontStyle: 'normal' | 'italic' }
/** Style props for a family / weight, identical on web and native. */
export function fontStyle(family: string, weight: number, italic: boolean): FontStyle {
  const w = snapWeight(family, weight);
  const it = italic ? 'italic' : 'normal';
  if (Platform.OS === 'web') return { fontFamily: `"${family}", ${FALLBACK_STACK}`, fontWeight: String(w), fontStyle: it };
  const key = nativeKey(family, w, italic && !!fontMeta(family)?.italic);
  return { fontFamily: loadedNative.has(key) ? key : undefined as any, fontWeight: 'normal', fontStyle: italic && !fontMeta(family)?.italic ? 'italic' : 'normal' };
}
const loadedNative = new Set<string>();
if (Platform.OS !== 'web') listeners.add(() => { import('expo-font').then((Font) => { for (const f of FONTS) for (const it of [false, true]) for (const w of availableWeights(f.family)) { const k = nativeKey(f.family, w, it); if (Font.isLoaded(k)) loadedNative.add(k); } }).catch(() => {}); });

export interface FontNeed { family: string; weight: number; italic: boolean }
/** Loads the fonts a logo needs and re-renders when they arrive. */
export const useFontRevision = () => useSyncExternalStore(subscribe, () => revision, () => 0);
export function useBrandFonts(needs: FontNeed[]): void {
  useSyncExternalStore(subscribe, () => revision, () => 0);
  const key = needs.map((n) => `${n.family}|${n.weight}|${n.italic}`).join(',');
  useEffect(() => { for (const n of needs) void loadFont(n.family, snapWeight(n.family, n.weight), n.italic); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** Current font-load revision (non-hook, for async export code). */
export const fontRevision = () => revision;
