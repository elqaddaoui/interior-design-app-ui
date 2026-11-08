/**
 * The logo designer behind "Surprise me" and the style demos. Pure (no React), deterministic per seed.
 *
 * A result is never a random shuffle: it starts from a CONCEPT (a small, coherent design brief: type of logo, font family + weight range, case,
 * tracking, icon family, icon position, colour strategies) and then applies explicit rules:
 *  - one family of colour: a base hue and at most one analogous companion (the app's own primary when "match the app" is on),
 *  - contrast: every colour reaches 4.5:1 (wordmark) / 3:1 (icon) on the backgrounds it is drawn on (the app's, or white + near black),
 *  - icon and text are matched: the icon's stroke is scaled to the stem of the chosen font weight (icons are 2/24 outlines, all one style),
 *  - proportional spacing (gap = a fraction of the type size), consistent optical sizes, no tracking on joined (Arabic) scripts,
 *  - small sizes: no hairline weights, no gradient behind an icon, nothing that needs colour to be understood (icon + word stay distinct in one colour).
 */
import { fromHsl } from './color';
import { availableWeights, fontFor, fontMeta, snapWeight, supportsText } from './fontData';
import { ICONS } from './icons';
import { INTERIOR, companion, logoColors, type Strategy, type Tone } from './palette';
import { needsJoined } from './script';
import { cleanSpec, rng, type CaseMode, type Decor, type IconPos, type Locks, type LogoSpec, type LogoType } from './spec';

export interface Concept {
  id: string; type: LogoType;
  latin: string[]; arabic: string[];
  /** Weight range (snapped to what the font ships). */
  weight: [number, number];
  cases: CaseMode[]; tracking: [number, number];
  /** Icon families (see scripts/gen-brand-icons.py); empty = no icon. */
  groups: string[]; pos: IconPos[];
  size: number;
  /** Gap between icon and text, as a fraction of the type size. */
  gap: number;
  strategies: Strategy[]; decor: Decor;
  mono?: { shapes: ('circle' | 'squircle' | 'square')[]; withName: boolean };
}

const SERIF = ['Playfair Display', 'Cormorant Garamond', 'Fraunces', 'Lora', 'Libre Baskerville', 'EB Garamond', 'Crimson Pro'];
const GEO = ['Plus Jakarta Sans', 'Manrope', 'Outfit', 'DM Sans', 'Urbanist', 'Sora', 'Lexend', 'Inter'];
const SOFT = ['Nunito', 'Quicksand', 'Outfit', 'Urbanist', 'Lexend'];
const AR_SANS = ['Cairo', 'Tajawal', 'Almarai', 'IBM Plex Sans Arabic', 'Readex Pro', 'Vazirmatn', 'Alexandria', 'Mada'];
const AR_SERIF = ['Amiri', 'Markazi Text', 'Noto Naskh Arabic', 'El Messiri'];
const AR_DISPLAY = ['Noto Kufi Arabic', 'Reem Kufi', 'El Messiri', 'Alexandria'];

export const CONCEPTS: Concept[] = [
  { id: 'atelier', type: 'iconText', latin: SERIF, arabic: AR_SERIF, weight: [500, 600], cases: ['none'], tracking: [0, 2], groups: ['furniture', 'decor'], pos: ['start'], size: 28, gap: 0.3, strategies: ['ink', 'deep', 'tonal'], decor: 'none' },
  { id: 'maison', type: 'text', latin: ['Cormorant Garamond', 'Playfair Display', 'Cinzel', 'Bodoni Moda', 'Libre Baskerville'], arabic: AR_SERIF, weight: [500, 600], cases: ['upper'], tracking: [14, 22], groups: [], pos: [], size: 26, gap: 0, strategies: ['ink', 'brand', 'tonal'], decor: 'none' },
  { id: 'studio', type: 'iconText', latin: ['Montserrat', 'Josefin Sans', 'Raleway', 'Syne', ...GEO.slice(0, 3)], arabic: AR_SANS, weight: [500, 600], cases: ['upper'], tracking: [10, 16], groups: ['architecture', 'lighting'], pos: ['top'], size: 22, gap: 0.3, strategies: ['ink', 'brand', 'deep'], decor: 'none' },
  { id: 'modern', type: 'iconText', latin: GEO, arabic: AR_SANS, weight: [600, 700], cases: ['none'], tracking: [-3, -1], groups: ['architecture', 'rooms', 'furniture'], pos: ['start'], size: 28, gap: 0.28, strategies: ['brand', 'deep', 'ink'], decor: 'none' },
  { id: 'monogram', type: 'monogram', latin: [...SERIF.slice(0, 3), ...GEO.slice(0, 4)], arabic: AR_SANS, weight: [600, 700], cases: ['upper', 'none'], tracking: [0, 3], groups: [], pos: [], size: 26, gap: 0, strategies: ['brand', 'deep', 'tonal'], decor: 'none', mono: { shapes: ['squircle', 'circle'], withName: true } },
  { id: 'wordmark', type: 'text', latin: [...GEO, 'Montserrat', 'Poppins'], arabic: AR_DISPLAY, weight: [700, 800], cases: ['none'], tracking: [-4, -2], groups: [], pos: [], size: 30, gap: 0, strategies: ['brand', 'gradient', 'ink'], decor: 'underline' },
  { id: 'minimal', type: 'text', latin: ['Inter', 'DM Sans', 'Manrope', 'Outfit', 'Urbanist', 'Josefin Sans'], arabic: AR_SANS, weight: [400, 500], cases: ['lower'], tracking: [4, 8], groups: [], pos: [], size: 28, gap: 0, strategies: ['ink', 'brand'], decor: 'none' },
  { id: 'lumiere', type: 'iconText', latin: ['Cormorant Garamond', 'Playfair Display', 'Fraunces', 'Lora'], arabic: AR_SERIF, weight: [500, 600], cases: ['none'], tracking: [0, 2], groups: ['lighting'], pos: ['start', 'end'], size: 28, gap: 0.3, strategies: ['deep', 'tonal', 'ink'], decor: 'none' },
  { id: 'nest', type: 'iconText', latin: SOFT, arabic: ['Cairo', 'Tajawal', 'Almarai', 'Readex Pro'], weight: [600, 700], cases: ['none'], tracking: [-1, 0], groups: ['architecture', 'rooms', 'decor'], pos: ['start'], size: 28, gap: 0.3, strategies: ['brand', 'deep'], decor: 'none' },
  { id: 'gallery', type: 'monogram', latin: ['Playfair Display', 'Cormorant Garamond', 'Fraunces', 'Bodoni Moda'], arabic: AR_SERIF, weight: [600, 700], cases: ['upper'], tracking: [0, 2], groups: [], pos: [], size: 26, gap: 0, strategies: ['ink', 'tonal', 'deep'], decor: 'none', mono: { shapes: ['circle', 'square'], withName: false } },
  { id: 'blueprint', type: 'iconText', latin: ['Space Grotesk', 'Sora', 'Work Sans', 'Lexend', 'Inter'], arabic: AR_SANS, weight: [500, 600], cases: ['upper'], tracking: [6, 10], groups: ['architecture'], pos: ['start'], size: 24, gap: 0.34, strategies: ['tonal', 'ink', 'deep'], decor: 'none' },
  { id: 'heritage', type: 'text', latin: ['Libre Baskerville', 'Playfair Display', 'Lora', 'Fraunces'], arabic: AR_SERIF, weight: [600, 700], cases: ['title'], tracking: [0, 1], groups: [], pos: [], size: 26, gap: 0, strategies: ['deep', 'brand'], decor: 'badge' },
];
export const CONCEPT_IDS = CONCEPTS.map((c) => c.id);
export const conceptById = (id: string) => CONCEPTS.find((c) => c.id === id);

/* ---------------------------------------------------------- typography / icon match */
/** Stem thickness of a font at `weight`, as a fraction of its size (an average of real faces: 0.09 at 400, 0.14 at 700). */
export const stemRatio = (family: string, weight: number): number => {
  const cat = fontMeta(family)?.cat;
  const k = cat === 'serif' || cat === 'script' ? 0.9 : cat === 'display' ? 1.1 : 1;
  return (0.045 + ((weight - 100) / 900) * 0.14) * k;
};
/** Icon glyphs are 2/24 outlines: the icon scale (% of the type size) whose stroke equals the font's stem. */
export const ICON_STROKE = 2 / 24;
export const iconScaleFor = (family: string, weight: number): number => Math.min(150, Math.max(105, Math.round((stemRatio(family, weight) / ICON_STROKE) * 100 / 5) * 5));
/** Stroke of the icon vs stem of the text (1 = perfectly matched). */
export const strokeMatch = (s: LogoSpec): number => (s.size * (s.icon.scale / 100) * ICON_STROKE) / (s.size * stemRatio(s.font, s.weight));

/* ---------------------------------------------------------------- the designer */
export interface Design { spec: LogoSpec; concept: string; strategy: Strategy; base: string }
export interface DesignOpts { avoid?: string[]; concept?: string }

const isArabic = (t: string) => /[\u0600-\u06FF]/.test(t);
export const seedOf = (id: string) => [...id].reduce((a, c) => (Math.imul(a, 131) + c.charCodeAt(0)) >>> 0, 7) || 1;

/** A well-formed logo for `spec.name`: see the file header for the rules. Locks keep that part of the current logo untouched. */
export function designLogo(spec: LogoSpec, seed: number, locks: Locks, tone: Tone | null = null, opts: DesignOpts = {}): Design {
  const r = rng(seed);
  const pickOne = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const word = spec.name;
  const ar = isArabic(word);

  // 1. Concept: not one of the last few, and (layout locked) of the kind of logo that is kept.
  let pool = CONCEPTS.filter((c) => (!locks.layout || spec.type === 'image' || c.type === spec.type));
  if (!pool.length) pool = CONCEPTS;
  const fresh = pool.filter((c) => !(opts.avoid ?? []).includes(c.id));
  const concept = (opts.concept && conceptById(opts.concept)) || pickOne(fresh.length ? fresh : pool);
  const next: LogoSpec = JSON.parse(JSON.stringify(spec));
  const imageOnly = spec.type === 'image' && !opts.concept;

  // 2. Typography: a font of the concept that can draw the name, a weight in its range, case / tracking by the concept's rules.
  if (!locks.font && !imageOnly) {
    const names = (ar ? concept.arabic : concept.latin).filter((f) => fontMeta(f) && supportsText(f, word));
    const family = names.length ? pickOne(names) : fontFor(concept.latin[0], word);
    const weights = availableWeights(family);
    const wanted = Math.round(between(concept.weight[0], concept.weight[1]) / 100) * 100;
    next.font = family;
    next.weight = snapWeight(family, Math.max(wanted, weights.includes(400) || weights[0] > 400 ? 400 : weights[0]));
    next.case = ar || fontMeta(family)?.cat === 'script' ? 'none' : pickOne(concept.cases);
    next.tracking = ar || needsJoined(word) ? 0 : Math.round(between(concept.tracking[0], concept.tracking[1]));
    next.italic = false;
  }

  // 3. Colour: one family. Base = the app's primary (matched) or a curated interior colour, nudged a little for variety.
  let strategy: Strategy = 'ink';
  let base = tone ? tone.primary : pickOne(INTERIOR).main;
  if (!locks.color) {
    const shift = tone ? pickOne([0, 0, 18, -18]) : 0;
    base = shift ? companion(tone ? tone.primary : base, shift) : base;
    const allowed = concept.strategies.filter((s) => s !== 'gradient' || (concept.type === 'text' && !ar));
    strategy = pickOne(allowed.length ? allowed : (['ink'] as Strategy[]));
    const c = logoColors(strategy, base, tone);
    next.palette = { base, harmony: 'analogous' };
    next.autoContrast = true;
    next.shadow = { ...next.shadow, on: false };
    next.outline = { ...next.outline, on: false };
    if (c.gradient) next.fill = { mode: 'gradient', color: c.gradient[0], color2: c.gradient[1], angle: pickOne([90, 135]) };
    else next.fill = { ...next.fill, mode: 'solid', color: c.text };
    // An icon / monogram in the wordmark's own colour needs no override (it follows the paint, gradients included).
    next.icon.color = c.gradient || c.icon === c.text ? '' : c.icon;
    next.mono.bg = c.icon; next.mono.fg = '';
  }

  // 4. Layout: the concept's logo type, icon family and position, proportional spacing.
  if (!imageOnly) {
    if (!locks.layout) {
      next.type = concept.type;
      next.decor = concept.decor;
      next.size = concept.size;
      if (concept.groups.length) {
        const icons = ICONS.filter((i) => concept.groups.includes(i.group));
        next.icon.name = pickOne(icons).name;
        next.icon.pos = pickOne(concept.pos);
        next.icon.gap = Math.round(concept.size * concept.gap);
      }
      if (concept.mono) { next.mono.shape = pickOne(concept.mono.shapes); next.mono.withName = concept.mono.withName; next.mono.scale = 150; next.mono.text = ''; }
    }
    // The icon's stroke follows the text's stem, whatever font ended up in the logo.
    if (next.type === 'iconText') next.icon.scale = iconScaleFor(next.font, next.weight);
  }
  return { spec: cleanSpec(next, spec.name), concept: concept.id, strategy, base };
}

/** Surprise me: a new, coherent design (kept as a plain function for callers that only need the spec). */
export const surprise = (spec: LogoSpec, seed: number, locks: Locks, tone: Tone | null = null, opts: DesignOpts = {}): LogoSpec => designLogo(spec, seed, locks, tone, opts).spec;

/* ------------------------------------------------------------------- demos */
export interface Preset { id: string }
/** One demo per concept: what the tile shows is exactly what a click applies (fixed seed per concept). */
export const PRESETS: Preset[] = CONCEPTS.map((c) => ({ id: c.id }));
const NONE: Locks = { font: false, color: false, layout: false };
export function applyPreset(spec: LogoSpec, preset: Preset, tone: Tone | null = null): LogoSpec {
  const d = designLogo(spec, seedOf(preset.id), NONE, tone, { concept: preset.id });
  // The person's words, image, lines and header placement always stay.
  return cleanSpec({ ...d.spec, name: spec.name, image: spec.image, top: spec.top, bottom: spec.bottom, align: spec.align, app: spec.app }, spec.name);
}

/** Colours a demo is made of (for the little swatches under a tile). */
export function swatchesOf(s: LogoSpec, tone: Tone | null): string[] {
  const out = [s.fill.mode === 'gradient' ? s.fill.color : s.fill.color || (tone ? tone.fg : '#111111'), s.fill.mode === 'gradient' ? s.fill.color2 : '', s.icon.color, s.type === 'monogram' ? s.mono.bg : ''];
  return [...new Set(out.filter(Boolean))].slice(0, 3);
}
export { fromHsl };
