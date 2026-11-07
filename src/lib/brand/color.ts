import { hex2rgb, rgb2hex, ratio, mix, luminance } from '../../theme/color';

export { ratio, mix, luminance, hex2rgb, rgb2hex };
export const LIGHT_BG = '#FFFFFF';
export const DARK_BG = '#0E0E10';
export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
/** '#abc' / 'abc' / '#AABBCC' -> '#AABBCC'; anything else -> fallback. */
export function normHex(v: string, fallback = ''): string {
  let s = String(v ?? '').trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  return isHex(s) ? s.toUpperCase() : fallback;
}

export function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}
export function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360; s = Math.min(100, Math.max(0, s)) / 100; l = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgb2hex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export type Harmony = 'mono' | 'analogous' | 'complementary' | 'triad' | 'split';
export const HARMONIES: Harmony[] = ['analogous', 'complementary', 'triad', 'split', 'mono'];
/** Five coordinated colours from ONE colour: [base, 4 companions]. Pure and deterministic. */
export function brandPalette(base: string, kind: Harmony): string[] {
  const [h, s, l] = toHsl(base);
  const at = (dh: number, ds = 0, dl = 0) => fromHsl(h + dh, s + ds, l + dl);
  switch (kind) {
    case 'mono': return [base, at(0, -10, 22), at(0, 0, -18), at(0, -35, 38), at(0, -5, -32)];
    case 'analogous': return [base, at(-30), at(30), at(-60, -5, 6), at(60, -5, 6)];
    case 'complementary': return [base, at(180), at(180, -10, 18), at(0, -10, 24), at(0, 0, -22)];
    case 'triad': return [base, at(120), at(240), at(120, -10, 20), at(240, -10, 20)];
    case 'split': return [base, at(150), at(210), at(0, -10, 24), at(0, 0, -22)];
  }
}

/** Ready-made palettes (one row each, 6 colours). */
export const READY_PALETTES: { id: string; colors: string[] }[] = [
  { id: 'fresh', colors: ['#0B6E4F', '#08A045', '#6BBF59', '#DDDF00', '#F4F1BB', '#1B1B1E'] },
  { id: 'sunset', colors: ['#6A0572', '#AB83A1', '#E4572E', '#F3A712', '#FFD166', '#2E1F27'] },
  { id: 'ocean', colors: ['#03045E', '#0077B6', '#00B4D8', '#90E0EF', '#CAF0F8', '#023047'] },
  { id: 'earth', colors: ['#5F0F40', '#9A031E', '#CB793A', '#FCDC4D', '#8A9A5B', '#3A2E2A'] },
  { id: 'royal', colors: ['#2B2D42', '#5E548E', '#9F86C0', '#C8B6FF', '#D4AF37', '#14213D'] },
  { id: 'mono', colors: ['#111111', '#343A40', '#6C757D', '#ADB5BD', '#E9ECEF', '#FFFFFF'] },
];

/** Nearest colour to `color` (same hue / saturation) whose contrast against `bg` is at least `min`. */
export function fixContrast(color: string, bg: string, min: number): string {
  if (ratio(color, bg) >= min) return color;
  const [h, s, l] = toHsl(color);
  const lighten = luminance(bg) < 0.4;
  for (let step = 1; step <= 100; step++) {
    const c = fromHsl(h, s, l + (lighten ? step : -step));
    if (ratio(c, bg) >= min) return c;
  }
  return lighten ? '#FFFFFF' : '#000000';
}
/** Black or white, whichever reads better on `bg`. */
export const readable = (bg: string) => (ratio(bg, '#FFFFFF') >= ratio(bg, '#111111') ? '#FFFFFF' : '#111111');

export interface Grade { ratio: number; large: boolean; normal: boolean; aaa: boolean }
/** WCAG grade of a colour on a background. Logos are "large / graphical" objects: 3:1 is the bar, 4.5:1 is the comfortable one. */
export function grade(fg: string, bg: string): Grade {
  const r = Math.round(ratio(fg, bg) * 100) / 100;
  return { ratio: r, large: r >= 3, normal: r >= 4.5, aaa: r >= 7 };
}

/** Nearest colour (same hue / saturation) that keeps at least `min`:1 on BOTH the light and the dark background. */
export function fixBoth(color: string, min = 3): string {
  const ok = (c: string) => ratio(c, LIGHT_BG) >= min && ratio(c, DARK_BG) >= min;
  if (ok(color)) return color;
  const [h, s, l] = toHsl(color);
  for (let step = 1; step <= 100; step++) for (const d of [step, -step]) { const c = fromHsl(h, s, l + d); if (ok(c)) return c; }
  return color;
}
