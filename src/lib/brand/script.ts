/** Writing-system detection: decides text direction, whether letter-spacing is safe, and which font subsets a name needs. */
export type Subset = 'latin' | 'arabic' | 'hebrew' | 'cyrillic' | 'greek' | 'devanagari' | 'thai' | 'cjk';
const RANGES: [Subset, RegExp][] = [
  ['arabic', /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/],
  ['hebrew', /[\u0590-\u05FF\uFB1D-\uFB4F]/],
  ['cyrillic', /[\u0400-\u052F]/],
  ['greek', /[\u0370-\u03FF\u1F00-\u1FFF]/],
  ['devanagari', /[\u0900-\u097F]/],
  ['thai', /[\u0E00-\u0E7F]/],
  ['cjk', /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/],
  ['latin', /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/],
];
export function subsetsOf(text: string): Subset[] {
  const found = RANGES.filter(([, re]) => re.test(text)).map(([s]) => s);
  return found.length ? found : ['latin'];
}
/** Right-to-left when the first strongly-directional letter belongs to an RTL script. */
export const isRtlText = (text: string) => /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(text.replace(/[^\p{L}]/gu, '').slice(0, 1));
/** Joined (cursive) scripts break when letter-spacing is applied between letters. */
export const needsJoined = (text: string) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0900-\u097F]/.test(text);
/** Letters (graphemes) of a name, never splitting a surrogate pair or a combining sequence. */
export function graphemes(text: string): string[] {
  const Seg = (Intl as any).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (s: any) => s.segment as string);
  return Array.from(text);
}
/** 1-2 initials from a name ("Dwira Home" -> "DH", "دويرة" -> "د"), skipping punctuation. */
export function initialsOf(name: string, max = 2): string {
  const words = name.split(/[\s\-_.·|/]+/).map((w) => graphemes(w.replace(/[^\p{L}\p{N}]/gu, ''))).filter((g) => g.length);
  if (!words.length) return '';
  const letters = words.length === 1 ? [words[0][0]] : words.slice(0, max).map((w) => w[0]);
  return letters.join('').toLocaleUpperCase();
}
