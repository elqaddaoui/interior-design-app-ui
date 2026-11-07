/* Pure font catalogue helpers (no React / React Native, so they run in Node tests). Loading lives in fonts.ts. */
import { FONT_CATALOG, type CatalogFont, type FontCat } from './fontCatalog';
import { subsetsOf, type Subset } from './script';

export type { CatalogFont, FontCat };
export const FONTS: CatalogFont[] = FONT_CATALOG;
const BY_NAME = new Map(FONTS.map((f) => [f.family, f]));
export const fontMeta = (family: string): CatalogFont | undefined => BY_NAME.get(family);
export const FALLBACK_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Weights a family really ships (variable ranges in steps of 100). */
export function availableWeights(family: string): number[] {
  const f = fontMeta(family);
  if (!f) return [400, 700];
  if (f.weights.includes('..')) {
    const [a, b] = f.weights.split('..').map(Number);
    const out: number[] = [];
    for (let w = Math.ceil(a / 100) * 100; w <= b; w += 100) out.push(w);
    return out.length ? out : [a];
  }
  return f.weights.split(',').map(Number);
}
export const isVariable = (family: string) => !!fontMeta(family)?.weights.includes('..');
export function snapWeight(family: string, weight: number): number {
  const list = availableWeights(family);
  return list.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), list[0]);
}
const SUBSET_TAG: Record<Subset, string> = { latin: 'latin', arabic: 'arabic', hebrew: 'hebrew', cyrillic: 'cyrillic', greek: 'greek', devanagari: 'devanagari', thai: 'thai', cjk: 'cjk' };
/** Does this family ship every writing system the text needs? */
export function supportsText(family: string, text: string): boolean {
  const f = fontMeta(family);
  if (!f) return true;
  const have = f.scripts.split(' ');
  return subsetsOf(text).every((s) => have.includes(SUBSET_TAG[s]));
}
/** The closest family (same category when possible) that can draw the text. */
export function fontFor(family: string, text: string): string {
  if (supportsText(family, text)) return family;
  const cat = fontMeta(family)?.cat ?? 'sans';
  const pool = FONTS.filter((f) => supportsText(f.family, text));
  const prefer: Partial<Record<FontCat, string[]>> = { serif: ['Amiri', 'Noto Naskh Arabic', 'Noto Serif', 'Markazi Text'], script: ['Aref Ruqaa', 'Katibeh', 'Lemonada'], display: ['Lalezar', 'Rakkas', 'Changa', 'Baloo Bhaijaan 2'], mono: ['Cairo'], sans: ['Cairo', 'Tajawal', 'Almarai', 'Noto Sans Arabic', 'Readex Pro'] };
  const chosen = (prefer[cat] ?? []).find((n) => pool.some((p) => p.family === n));
  return chosen ?? pool.find((p) => p.cat === cat)?.family ?? pool[0]?.family ?? family;
}
export function searchFonts(query: string, cat: FontCat | 'all', text: string): CatalogFont[] {
  const q = query.trim().toLowerCase();
  const list = FONTS.filter((f) => (cat === 'all' || f.cat === cat) && (!q || f.family.toLowerCase().includes(q)));
  // Fonts that can draw the brand name come first.
  return [...list].sort((a, b) => Number(supportsText(b.family, text)) - Number(supportsText(a.family, text)));
}

/* ------------------------------ CSS / loading ------------------------------ */
export function cssUrl(family: string, opts: { italic?: boolean; text?: string } = {}): string {
  const f = fontMeta(family);
  const axis = f ? (f.weights.includes('..') ? [f.weights] : f.weights.split(',')) : ['400', '700'];
  const italic = !!opts.italic && !!f?.italic;
  const spec = italic ? `ital,wght@${[...axis.map((w) => `0,${w}`), ...axis.map((w) => `1,${w}`)].join(';')}` : `wght@${axis.join(';')}`;
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${spec}&display=swap${opts.text ? `&text=${encodeURIComponent(opts.text)}` : ''}`;
}

