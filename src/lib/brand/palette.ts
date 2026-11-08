/* Colour rules of the logo designer. Pure (no React): shared by presets, the Surprise generator and the unit checks. */
import { LIGHT_BG, DARK_BG, fromHsl, ratio, toHsl } from './color';

/** The colours of the running app theme the logo has to live next to (see `useTheme().colors`). */
export interface Tone { primary: string; bg: string; surface: string; fg: string; ink: string; dark: boolean }

/** Curated interior-design palettes (used when the logo is NOT matched to the app): earthy, muted, always one hue family + one neutral. */
export const INTERIOR: { id: string; main: string; accent: string }[] = [
  { id: 'walnut', main: '#7A4E2D', accent: '#C49A5B' },
  { id: 'sage', main: '#4E6B57', accent: '#B9A27A' },
  { id: 'navy', main: '#1F3A5F', accent: '#C8A36B' },
  { id: 'terracotta', main: '#B0502F', accent: '#E0B08A' },
  { id: 'charcoal', main: '#2B2B2E', accent: '#C27C4E' },
  { id: 'plum', main: '#6B3F5E', accent: '#D1A27F' },
  { id: 'teal', main: '#2F6F6D', accent: '#D9B26F' },
  { id: 'olive', main: '#5E6B2E', accent: '#C9B27C' },
];

/**
 * Lowest contrast a colour may have on every background it is drawn on. Logos are large / graphical objects (WCAG bar: 3:1).
 * Matched to the app both backgrounds share one polarity, so the comfortable 4.5:1 is reachable. Generic (white AND near black) it is
 * mathematically impossible (the best single colour reaches 4.39:1 at mid-lightness), so the wordmark asks for 3.5:1 on both instead.
 */
export const MIN_ICON = 3;
export const MIN_TEXT = 4.5;
export const MIN_TEXT_GENERIC = 3.5;
export const minText = (tone: Tone | null) => (tone ? MIN_TEXT : MIN_TEXT_GENERIC);

/** Nearest colour (same hue / saturation) reaching `min`:1 on EVERY background; the colour itself when it already does. */
export function legible(color: string, bgs: string[], min: number): string {
  const ok = (c: string) => bgs.every((b) => ratio(c, b) >= min);
  if (ok(color)) return color;
  const [h, s, l] = toHsl(color);
  for (let step = 1; step <= 100; step++) for (const d of [step, -step]) { const c = fromHsl(h, s, l + d); if (ok(c)) return c; }
  // Nothing in this hue works on all backgrounds at once (a light AND a dark one): fall back to the better neutral for the first one.
  return ratio('#FFFFFF', bgs[0]) >= ratio('#111111', bgs[0]) ? '#FFFFFF' : '#111111';
}

/** Hue-rotated companion (analogous): same family, never a clashing colour. */
export const companion = (c: string, deg = 28, dl = 0, ds = 0) => { const [h, s, l] = toHsl(c); return fromHsl(h + deg, s + ds, l + dl); };
export const deepen = (c: string, by = 14) => { const [h, s, l] = toHsl(c); return fromHsl(h, Math.min(95, s + 4), Math.max(14, l - by)); };
export const soften = (c: string, by = 14) => { const [h, s, l] = toHsl(c); return fromHsl(h, Math.max(18, s - 12), Math.min(86, l + by)); };

/** Backgrounds a logo has to be readable on: the app's own (matched) or white + near black (generic). */
export const backgroundsFor = (tone: Tone | null): string[] => (tone ? [tone.bg, tone.surface] : [LIGHT_BG, DARK_BG]);

export type Strategy = 'ink' | 'brand' | 'deep' | 'tonal' | 'gradient';
export const STRATEGIES: Strategy[] = ['ink', 'brand', 'deep', 'tonal', 'gradient'];

/** What a strategy decides: wordmark colour ('' = follows the page), icon colour, optional two-stop gradient (wordmark only). */
export interface LogoColors { strategy: Strategy; base: string; text: string; icon: string; gradient?: [string, string] }

/**
 * Two hues at most, always one family:
 *  ink      dark / light wordmark of the page, icon in the brand colour (classic, maximum legibility)
 *  brand    wordmark and icon in one deepened brand colour (strongest identity, perfect in one colour)
 *  deep     deep wordmark + analogous icon
 *  tonal    dark and light tones of the same hue
 *  gradient brand -> analogous (only for wordmark-only logos, never with an icon)
 * `base` is the app's primary when matched, else a curated interior colour. Every output colour reaches MIN_TEXT / MIN_ICON on every background.
 */
export function logoColors(strategy: Strategy, base: string, tone: Tone | null): LogoColors {
  const bgs = backgroundsFor(tone);
  const text = (c: string) => legible(c, bgs, minText(tone));
  const icon = (c: string) => legible(c, bgs, MIN_ICON);
  switch (strategy) {
    case 'ink': return { strategy, base, text: '', icon: icon(base) };
    case 'brand': { const c = text(base); return { strategy, base, text: c, icon: c }; }
    case 'deep': return { strategy, base, text: text(deepen(base, 16)), icon: icon(companion(base, 30)) };
    case 'tonal': return { strategy, base, text: text(deepen(base, 22)), icon: icon(soften(base, 6)) };
    case 'gradient': { const a = text(base), b = text(companion(base, 38)); return { strategy, base, text: a, icon: a, gradient: [a, b] }; }
  }
}
