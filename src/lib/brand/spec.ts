import { normHex, isHex, DARK_BG, LIGHT_BG, ratio, brandPalette, READY_PALETTES, type Harmony, fromHsl } from './color';
import { availableWeights, fontFor, fontMeta, snapWeight, supportsText, FONTS } from './fontData';
import { ICON_NAMES } from './icons';
import { initialsOf, isRtlText } from './script';

/* ------------------------------------------------------------------ model */
export type LogoType = 'text' | 'image' | 'iconText' | 'monogram';
export type CaseMode = 'none' | 'upper' | 'lower' | 'title';
export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';
export type IconPos = 'start' | 'end' | 'top' | 'bottom';
export type Decor = 'none' | 'underline' | 'badge';
export type HeaderAlign = 'left' | 'center' | 'right';
export interface Fill { mode: 'solid' | 'gradient'; /** '' = follows the page (automatic) */ color: string; color2: string; angle: number }
export interface Line { on: boolean; text: string; side: Side; align: Align; gap: number; size: number; font: string; weight: number; tracking: number; case: CaseMode; italic: boolean; color: string }
export interface LogoSpec {
  v: 1; type: LogoType; name: string; dir: 'auto' | 'ltr' | 'rtl';
  font: string; weight: number; italic: boolean; tracking: number; case: CaseMode; size: number;
  fill: Fill;
  shadow: { on: boolean; color: string; opacity: number; blur: number; x: number; y: number };
  outline: { on: boolean; color: string; width: number };
  decor: Decor;
  icon: { name: string; pos: IconPos; scale: number; color: string; gap: number };
  mono: { text: string; shape: 'circle' | 'squircle' | 'square' | 'none'; bg: string; fg: string; scale: number; withName: boolean };
  image: { light: string; dark: string; height: number; ratio: number; darkRatio: number };
  top: Line; bottom: Line;
  align: HeaderAlign;
  autoContrast: boolean;
  palette: { base: string; harmony: Harmony };
  app: { bg: string; fg: string; shape: 'squircle' | 'circle' | 'square'; source: 'auto' | 'icon' | 'monogram' | 'initial' | 'image' };
}

export const LIMITS = { name: 40, line: 80, size: [12, 72], tracking: [-10, 60], gap: [0, 48], iconScale: [60, 220], imageH: [16, 96], lineSize: [25, 100], blur: [0, 40], outline: [0.5, 8] } as const;
const clamp = (n: unknown, [lo, hi]: readonly [number, number] | readonly number[], fallback: number) => { const v = typeof n === 'number' && Number.isFinite(n) ? n : fallback; return Math.min(hi, Math.max(lo, v)); };
const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const str = (v: unknown, max: number, fallback = '') => (typeof v === 'string' ? v.slice(0, max) : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && v === '' ? '' : normHex(String(v ?? ''), fallback));

export const defaultLine = (side: Side): Line => ({ on: false, text: '', side, align: 'center', gap: 6, size: 42, font: '', weight: 500, tracking: 8, case: 'none', italic: false, color: '' });
export const defaultSpec = (name = 'Dwira'): LogoSpec => ({
  v: 1, type: 'text', name, dir: 'auto',
  font: 'Lora', weight: 700, italic: false, tracking: -1, case: 'none', size: 28,
  fill: { mode: 'solid', color: '', color2: '#2563EB', angle: 90 },
  shadow: { on: false, color: '#000000', opacity: 0.35, blur: 8, x: 0, y: 2 },
  outline: { on: false, color: '#000000', width: 1.5 },
  decor: 'underline',
  icon: { name: 'home-variant-outline', pos: 'start', scale: 120, color: '', gap: 8 },
  mono: { text: '', shape: 'squircle', bg: '', fg: '', scale: 150, withName: false },
  image: { light: '', dark: '', height: 40, ratio: 1, darkRatio: 1 },
  top: defaultLine('top'), bottom: defaultLine('bottom'),
  align: 'left', autoContrast: true,
  palette: { base: '#FBDD2D', harmony: 'analogous' },
  app: { bg: '', fg: '', shape: 'squircle', source: 'auto' },
});

/* --------------------------------------------------------------- sanitise */
const CASES = ['none', 'upper', 'lower', 'title'] as const;
const SIDES = ['top', 'bottom', 'left', 'right'] as const;
const ALIGNS = ['start', 'center', 'end'] as const;
function cleanLine(v: any, side: Side): Line {
  const d = defaultLine(side);
  const o = v && typeof v === 'object' ? v : {};
  const font = typeof o.font === 'string' && (o.font === '' || fontMeta(o.font)) ? o.font : '';
  return {
    on: bool(o.on, d.on), text: str(o.text, LIMITS.line), side: pick(o.side, SIDES, d.side), align: pick(o.align, ALIGNS, d.align),
    gap: clamp(o.gap, LIMITS.gap, d.gap), size: clamp(o.size, LIMITS.lineSize, d.size), font,
    weight: clamp(o.weight, [100, 1000], d.weight), tracking: clamp(o.tracking, LIMITS.tracking, d.tracking),
    case: pick(o.case, CASES, d.case), italic: bool(o.italic, d.italic), color: color(o.color, ''),
  };
}
/** Any stored value -> a complete, in-range spec. Never throws. */
export function cleanSpec(input: unknown, name?: string): LogoSpec {
  const o: any = input && typeof input === 'object' ? input : {};
  const d = defaultSpec(name ?? 'Dwira');
  const font = typeof o.font === 'string' && fontMeta(o.font) ? o.font : d.font;
  const f = o.fill ?? {}, sh = o.shadow ?? {}, ol = o.outline ?? {}, ic = o.icon ?? {}, mo = o.mono ?? {}, im = o.image ?? {}, ap = o.app ?? {}, pa = o.palette ?? {};
  return {
    v: 1, type: pick(o.type, ['text', 'image', 'iconText', 'monogram'] as const, d.type), name: str(o.name, LIMITS.name, d.name), dir: pick(o.dir, ['auto', 'ltr', 'rtl'] as const, 'auto'),
    font, weight: snapWeight(font, clamp(o.weight, [100, 1000], d.weight)), italic: bool(o.italic, d.italic), tracking: clamp(o.tracking, LIMITS.tracking, d.tracking),
    case: pick(o.case, CASES, d.case), size: clamp(o.size, LIMITS.size, d.size),
    fill: { mode: pick(f.mode, ['solid', 'gradient'] as const, 'solid'), color: color(f.color, ''), color2: color(f.color2, d.fill.color2) || d.fill.color2, angle: clamp(f.angle, [0, 360], d.fill.angle) },
    shadow: { on: bool(sh.on, false), color: color(sh.color, d.shadow.color) || d.shadow.color, opacity: clamp(sh.opacity, [0, 1], d.shadow.opacity), blur: clamp(sh.blur, LIMITS.blur, d.shadow.blur), x: clamp(sh.x, [-24, 24], 0), y: clamp(sh.y, [-24, 24], d.shadow.y) },
    outline: { on: bool(ol.on, false), color: color(ol.color, d.outline.color) || d.outline.color, width: clamp(ol.width, LIMITS.outline, d.outline.width) },
    decor: pick(o.decor, ['none', 'underline', 'badge'] as const, d.decor),
    icon: { name: typeof ic.name === 'string' && ICON_NAMES.has(ic.name) ? ic.name : d.icon.name, pos: pick(ic.pos, ['start', 'end', 'top', 'bottom'] as const, 'start'), scale: clamp(ic.scale, LIMITS.iconScale, d.icon.scale), color: color(ic.color, ''), gap: clamp(ic.gap, LIMITS.gap, d.icon.gap) },
    mono: { text: str(mo.text, 3), shape: pick(mo.shape, ['circle', 'squircle', 'square', 'none'] as const, 'squircle'), bg: color(mo.bg, ''), fg: color(mo.fg, ''), scale: clamp(mo.scale, [100, 260], d.mono.scale), withName: bool(mo.withName, false) },
    image: { light: str(im.light, 3_500_000), dark: str(im.dark, 3_500_000), height: clamp(im.height, LIMITS.imageH, d.image.height), ratio: clamp(im.ratio, [0.1, 12], 1), darkRatio: clamp(im.darkRatio, [0.1, 12], 1) },
    top: cleanLine(o.top, 'top'), bottom: cleanLine(o.bottom, 'bottom'),
    align: pick(o.align, ['left', 'center', 'right'] as const, 'left'), autoContrast: bool(o.autoContrast, true),
    palette: { base: normHex(pa.base, d.palette.base), harmony: pick(pa.harmony, ['mono', 'analogous', 'complementary', 'triad', 'split'] as const, 'analogous') },
    app: { bg: color(ap.bg, ''), fg: color(ap.fg, ''), shape: pick(ap.shape, ['squircle', 'circle', 'square'] as const, 'squircle'), source: pick(ap.source, ['auto', 'icon', 'monogram', 'initial', 'image'] as const, 'auto') },
  };
}

/* ------------------------------------------------------------ validation */
export interface Issue { path: string; key: string; level: 'error' | 'warn'; params?: Record<string, string | number> }
const DATA_OK = /^(data:image\/(png|jpe?g|webp|gif|svg\+xml|avif);base64,|https?:\/\/|\/api\/media\/)/i;
/** Blocking errors keep Publish disabled; warnings are advice only. */
export function validateSpec(s: LogoSpec): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, key: string, params?: Issue['params']) => out.push({ path, key, level: 'error', params });
  const warn = (path: string, key: string, params?: Issue['params']) => out.push({ path, key, level: 'warn', params });
  if (!s.name.trim()) err('name', 'nameRequired');
  if (s.name.length > LIMITS.name) err('name', 'nameLong', { max: LIMITS.name });
  if (s.type === 'image') {
    if (!s.image.light) err('image.light', 'imageRequired');
    for (const k of ['light', 'dark'] as const) if (s.image[k] && !DATA_OK.test(s.image[k])) err(`image.${k}`, 'imageInvalid');
    if (s.image.light && !s.image.dark) warn('image.dark', 'noDarkImage');
  }
  if (s.type === 'iconText' && !ICON_NAMES.has(s.icon.name)) err('icon.name', 'iconRequired');
  for (const [path, v] of [['fill.color2', s.fill.color2], ['shadow.color', s.shadow.color], ['outline.color', s.outline.color]] as const) if (!isHex(v)) err(path, 'colorInvalid');
  for (const [path, v] of [['fill.color', s.fill.color], ['icon.color', s.icon.color], ['mono.bg', s.mono.bg], ['mono.fg', s.mono.fg], ['app.bg', s.app.bg], ['app.fg', s.app.fg]] as const) if (v !== '' && !isHex(v)) err(path, 'colorInvalid');
  for (const k of ['top', 'bottom'] as const) {
    if (s[k].on && !s[k].text.trim()) err(`${k}.text`, 'lineEmpty');
    if (s[k].text.length > LIMITS.line) err(`${k}.text`, 'lineLong', { max: LIMITS.line });
  }
  const text = [s.name, s.mono.text, s.top.on ? s.top.text : '', s.bottom.on ? s.bottom.text : ''].join(' ');
  const main = s.type === 'image' ? '' : s.name;
  if (main && !supportsText(s.font, main)) warn('font', 'fontScript', { font: s.font });
  for (const k of ['top', 'bottom'] as const) if (s[k].on && s[k].font && !supportsText(s[k].font, s[k].text)) warn(`${k}.font`, 'fontScript', { font: s[k].font });
  if (s.fill.mode === 'solid' || s.type === 'image') {
    const c = s.fill.color;
    if (s.type !== 'image' && c && isHex(c) && !s.autoContrast) {
      const lo = ratio(c, LIGHT_BG), hi = ratio(c, DARK_BG);
      if (lo < 3) warn('fill.color', 'lowOnLight', { ratio: Math.round(lo * 10) / 10 });
      if (hi < 3) warn('fill.color', 'lowOnDark', { ratio: Math.round(hi * 10) / 10 });
    }
  }
  void text;
  return out;
}
export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');

/* ------------------------------------------------------------ text tools */
export function applyCase(text: string, mode: CaseMode): string {
  if (mode === 'upper') return text.toLocaleUpperCase();
  if (mode === 'lower') return text.toLocaleLowerCase();
  if (mode === 'title') return text.toLocaleLowerCase().replace(/(^|[\s\-_])(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase());
  return text;
}
export const textDir = (s: LogoSpec): 'ltr' | 'rtl' => (s.dir === 'auto' ? (isRtlText(s.name) ? 'rtl' : 'ltr') : s.dir);
export const monoText = (s: LogoSpec) => (s.mono.text.trim() || initialsOf(s.name)).slice(0, 3);

/* ------------------------------------------------------- legacy mapping */
const LEGACY_FONT: Record<string, string> = { NotoNaskhArabic: 'Noto Naskh Arabic', system: 'Inter', 'IBM Plex Sans Arabic': 'IBM Plex Sans Arabic' };
/** What the old branding page stored (appName, logoUri, logoFont...) -> a spec. A stored `logo` wins. */
export function specFromBranding(b: any): LogoSpec {
  const name = str(b?.appName, LIMITS.name, 'Dwira') || 'Dwira';
  if (b?.logo && typeof b.logo === 'object') return cleanSpec({ ...b.logo, name }, name);
  const legacyFont = typeof b?.logoFont === 'string' ? (LEGACY_FONT[b.logoFont] ?? b.logoFont) : 'Lora';
  const size = clamp(b?.logoSize, LIMITS.size, 28);
  const image = (b?.logoMode ?? (b?.logoUri ? 'image' : 'text')) === 'image' && b?.logoUri;
  return cleanSpec({
    ...defaultSpec(name), name, type: image ? 'image' : 'text', font: fontMeta(legacyFont) ? legacyFont : 'Lora', weight: 800, italic: !!b?.logoItalic, size,
    tracking: Math.round(((typeof b?.logoSpacing === 'number' ? b.logoSpacing : -0.5) / size) * 100),
    fill: { ...defaultSpec().fill, color: typeof b?.logoColor === 'string' ? b.logoColor : '' },
    decor: b?.logoStyle === 'badge' ? 'badge' : b?.logoStyle === 'minimal' ? 'none' : 'underline',
    align: b?.logoPosition === 'center' || b?.logoPosition === 'right' ? b.logoPosition : 'left',
    image: { ...defaultSpec().image, light: image ? b.logoUri : '' },
  }, name);
}
/** Fields the rest of the app (and older builds) read; derived from the spec at publish time. */
export function legacyFields(s: LogoSpec) {
  return {
    appName: s.name.trim(), logoMode: s.type === 'image' ? 'image' : 'text', logoUri: s.image.light, logoPosition: s.align,
    logoFont: s.font, logoColor: s.fill.color, logoSize: Math.min(40, Math.max(18, s.size)), logoItalic: s.italic,
    logoSpacing: Math.round(((s.tracking / 100) * s.size) * 2) / 2, logoStyle: s.decor === 'badge' ? 'badge' : s.decor === 'none' ? 'minimal' : 'signature',
  } as const;
}

/* ---------------------------------------------------------------- presets */
export interface Preset { id: string; patch: Partial<Omit<LogoSpec, 'v' | 'name'>> | Record<string, any> }
const solid = (c = '') => ({ mode: 'solid' as const, color: c, color2: '#2563EB', angle: 90 });
const grad = (a: string, b: string, angle = 90) => ({ mode: 'gradient' as const, color: a, color2: b, angle });
export const PRESETS: Preset[] = [
  { id: 'classic', patch: { type: 'text', font: 'Playfair Display', weight: 700, tracking: -1, case: 'none', decor: 'underline', italic: false, fill: solid(), shadow: { on: false }, outline: { on: false } } },
  { id: 'modern', patch: { type: 'text', font: 'Plus Jakarta Sans', weight: 800, tracking: -3, case: 'none', decor: 'none', italic: false, fill: solid(), shadow: { on: false }, outline: { on: false } } },
  { id: 'elegant', patch: { type: 'text', font: 'Cormorant Garamond', weight: 600, tracking: 18, case: 'upper', decor: 'none', italic: false, fill: solid(), shadow: { on: false }, outline: { on: false } } },
  { id: 'script', patch: { type: 'text', font: 'Pacifico', weight: 400, tracking: 0, case: 'none', decor: 'none', fill: grad('#F97316', '#DB2777', 100), shadow: { on: false }, outline: { on: false } } },
  { id: 'bold', patch: { type: 'text', font: 'Anton', weight: 400, tracking: 6, case: 'upper', decor: 'none', italic: false, fill: solid('#E11D48'), shadow: { on: false }, outline: { on: false } } },
  { id: 'tech', patch: { type: 'iconText', font: 'Space Grotesk', weight: 700, tracking: -2, case: 'none', decor: 'none', italic: false, icon: { name: 'chip', pos: 'start', scale: 120, gap: 8, color: '' }, fill: solid('#2563EB'), shadow: { on: false }, outline: { on: false } } },
  { id: 'luxury', patch: { type: 'text', font: 'Cinzel', weight: 600, tracking: 14, case: 'upper', decor: 'none', italic: false, fill: grad('#B8860B', '#F5D76E', 90), shadow: { on: true, color: '#000000', opacity: 0.35, blur: 6, x: 0, y: 2 }, outline: { on: false } } },
  { id: 'playful', patch: { type: 'iconText', font: 'Fredoka', weight: 600, tracking: 0, case: 'none', decor: 'none', italic: false, icon: { name: 'balloon', pos: 'start', scale: 120, gap: 8, color: '#F97316' }, fill: solid('#7C3AED'), shadow: { on: false }, outline: { on: false } } },
  { id: 'neon', patch: { type: 'text', font: 'Righteous', weight: 400, tracking: 4, case: 'upper', decor: 'none', italic: false, fill: grad('#22D3EE', '#E879F9', 90), shadow: { on: true, color: '#22D3EE', opacity: 0.9, blur: 14, x: 0, y: 0 }, outline: { on: false } } },
  { id: 'retro', patch: { type: 'text', font: 'Alfa Slab One', weight: 400, tracking: 2, case: 'none', decor: 'none', italic: false, fill: solid('#FACC15'), shadow: { on: true, color: '#7C2D12', opacity: 1, blur: 0, x: 3, y: 3 }, outline: { on: true, color: '#7C2D12', width: 2 } } },
  { id: 'minimal', patch: { type: 'text', font: 'Inter', weight: 500, tracking: 4, case: 'lower', decor: 'none', italic: false, fill: solid(), shadow: { on: false }, outline: { on: false } } },
  { id: 'badge', patch: { type: 'monogram', font: 'Poppins', weight: 700, tracking: 0, case: 'upper', decor: 'none', italic: false, mono: { shape: 'squircle', bg: '', fg: '', scale: 150, text: '', withName: true }, fill: solid(), shadow: { on: false }, outline: { on: false } } },
  { id: 'home', patch: { type: 'iconText', font: 'Lora', weight: 700, tracking: -1, case: 'none', decor: 'none', italic: false, icon: { name: 'home-variant-outline', pos: 'start', scale: 125, gap: 8, color: '' }, fill: solid(), shadow: { on: false }, outline: { on: false } } },
  { id: 'calligraphy', patch: { type: 'text', font: 'Aref Ruqaa', weight: 700, tracking: 0, case: 'none', decor: 'none', italic: false, fill: grad('#0F766E', '#0EA5E9', 90), shadow: { on: false }, outline: { on: false } } },
];
const deepMerge = (a: any, b: any): any => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = a && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deepMerge(a[k], b[k]) : b[k];
  return out;
};
/** Applies a style over the current logo; the person's words, image and header placement stay. Fonts that cannot draw the name are swapped. */
export function applyPreset(spec: LogoSpec, preset: Preset): LogoSpec {
  const merged = deepMerge(spec, preset.patch) as LogoSpec;
  const keep = { ...merged, name: spec.name, image: spec.image, top: spec.top, bottom: spec.bottom, align: spec.align, app: spec.app, palette: spec.palette };
  const type = keep.type === 'image' ? spec.type : keep.type;
  const next = { ...keep, type: spec.type === 'image' && preset.patch.type ? type : keep.type };
  const word = spec.name + (spec.type === 'monogram' ? monoText(spec) : '');
  next.font = fontFor(next.font, word);
  return cleanSpec(next, spec.name);
}

/* -------------------------------------------------------------- randomise */
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export interface Locks { font: boolean; color: boolean; layout: boolean }
export function surprise(spec: LogoSpec, seed: number, locks: Locks): LogoSpec {
  const r = rng(seed);
  const pickOne = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const next: LogoSpec = JSON.parse(JSON.stringify(spec));
  const word = spec.name;
  if (!locks.font) {
    const pool = FONTS.filter((f) => supportsText(f.family, word) && (spec.type !== 'monogram' || f.cat !== 'script'));
    const f = pickOne(pool.length ? pool : FONTS);
    next.font = f.family;
    const weights = availableWeights(f.family).filter((w) => w >= 400);
    next.weight = pickOne(weights.length ? weights : availableWeights(f.family));
    next.case = f.cat === 'script' || /[\u0600-\u06FF]/.test(word) ? 'none' : pickOne(['none', 'none', 'upper', 'lower', 'title'] as const);
    next.tracking = /[\u0600-\u06FF]/.test(word) ? 0 : f.cat === 'script' ? 0 : next.case === 'upper' ? Math.round(r() * 22) : Math.round(r() * 8 - 4);
    next.italic = f.italic && f.cat !== 'script' && r() < 0.12;
  }
  if (!locks.color) {
    const palette = pickOne(READY_PALETTES).colors;
    const harmony = pickOne(['analogous', 'complementary', 'triad', 'split', 'mono'] as const);
    const base = fromHsl(Math.round(r() * 360), 55 + Math.round(r() * 35), 38 + Math.round(r() * 14));
    const gen = brandPalette(base, harmony);
    next.palette = { base, harmony };
    const c1 = pickOne([...palette.slice(0, 3), gen[0]]), c2 = pickOne(gen.slice(1, 4));
    next.fill = r() < 0.3 ? { mode: 'gradient', color: c1, color2: c2, angle: pickOne([0, 45, 90, 135]) } : { mode: 'solid', color: r() < 0.25 ? '' : c1, color2: c2, angle: 90 };
    next.icon.color = r() < 0.4 ? c2 : '';
    next.mono.bg = pickOne([c1, gen[0], '']);
    next.shadow = r() < 0.15 ? { on: true, color: c1, opacity: 0.4, blur: 10, x: 0, y: 3 } : { ...next.shadow, on: false };
    next.outline = { ...next.outline, on: false };
    next.autoContrast = true;
  }
  if (!locks.layout) {
    next.type = spec.type === 'image' ? 'image' : pickOne(['text', 'iconText', 'iconText', 'monogram'] as const);
    next.decor = next.type === 'text' ? pickOne(['none', 'none', 'underline'] as const) : 'none';
    next.icon.name = pickOne([...ICON_NAMES]);
    next.icon.pos = pickOne(['start', 'start', 'top', 'end'] as const);
    next.mono.shape = pickOne(['circle', 'squircle', 'square'] as const);
    next.mono.withName = r() < 0.5;
  }
  return cleanSpec(next, spec.name);
}

/* ------------------------------------------------------------ diff labels */
/** Groups the leaf changes between two specs into short group ids (translated in the UI). */
export function changedGroups(a: LogoSpec, b: LogoSpec): string[] {
  const groups: [string, (s: LogoSpec) => unknown][] = [
    ['type', (s) => s.type], ['name', (s) => s.name], ['font', (s) => [s.font, s.weight, s.italic, s.tracking, s.case, s.size]],
    ['colors', (s) => [s.fill, s.icon.color, s.mono.bg, s.mono.fg, s.autoContrast]], ['effects', (s) => [s.shadow, s.outline, s.decor]],
    ['icon', (s) => s.icon.name + s.icon.pos + s.icon.scale], ['image', (s) => [s.image.light, s.image.dark, s.image.height]],
    ['lines', (s) => [s.top, s.bottom]], ['layout', (s) => [s.align, s.dir]], ['appIcon', (s) => s.app], ['monogram', (s) => s.mono],
  ];
  return groups.filter(([, f]) => JSON.stringify(f(a)) !== JSON.stringify(f(b))).map(([id]) => id);
}
export const sameSpec = (a: LogoSpec, b: LogoSpec) => JSON.stringify(a) === JSON.stringify(b);
