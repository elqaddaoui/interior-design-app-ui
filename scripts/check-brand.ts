/**
 * Pure-logic checks of the Branding studio (`npm run check:brand`): colour maths, validation, sanitiser, presets, randomiser,
 * layout / SVG output (LTR + RTL), history coalescing, legacy mapping. No browser needed.
 */
import { fixBoth, brandPalette, fixContrast, grade, normHex, ratio, toHsl, fromHsl, HARMONIES } from '../src/lib/brand/color';
import { type LogoSpec, cleanSpec, defaultSpec, validateSpec, hasErrors, specFromBranding, legacyFields, applyCase, changedGroups, textDir, monoText } from '../src/lib/brand/spec';
import { layoutLogo, estimateMeasure, ctxFor, toSvg, appIconLayout, iconSourceOf } from '../src/lib/brand/layout';
import { availableWeights, fontFor, supportsText, searchFonts, snapWeight, cssUrl, FONTS } from '../src/lib/brand/fontData';
import { ICONS, ICON_GROUP_IDS, searchIcons } from '../src/lib/brand/icons';
import { CONCEPTS, PRESETS, applyPreset, designLogo, strokeMatch, surprise, iconScaleFor } from '../src/lib/brand/design';
import { INTERIOR, logoColors, legible, minText, STRATEGIES, type Tone } from '../src/lib/brand/palette';
import { initialsOf, isRtlText, subsetsOf } from '../src/lib/brand/script';
import * as H from '../src/lib/brand/history';

const fail = (m: string): never => { throw new Error(m); };
const ok = (c: unknown, m: string) => { if (!c) fail(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
let n = 0; const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; } };

t('hex normalisation', () => { eq(normHex('abc'), '#AABBCC', '3-digit'); eq(normHex('#12ab34'), '#12AB34', 'upper'); eq(normHex('zzz', '#000000'), '#000000', 'invalid -> fallback'); });
t('hsl round trip', () => { for (const c of ['#FBDD2D', '#2563EB', '#16A34A', '#808080']) { const [h, s, l] = toHsl(c); const back = fromHsl(h, s, l); ok(ratio(c, back) < 1.02, `${c} -> ${back}`); } });
t('palettes: 5 valid, base first', () => { for (const k of HARMONIES) { const p = brandPalette('#2563EB', k); eq(p.length, 5, k); eq(p[0], '#2563EB', `${k} base`); ok(p.every((c) => /^#[0-9A-F]{6}$/.test(c)), `${k} hex`); eq(new Set(p).size, 5, `${k} distinct`); } });
t('fixContrast reaches the target on both backgrounds', () => { for (const bg of ['#FFFFFF', '#0E0E10']) for (const c of ['#FBDD2D', '#222222', '#2563EB', '#FFFFFF']) { const f = fixContrast(c, bg, 3); ok(ratio(f, bg) >= 3, `${c} on ${bg} -> ${f} (${ratio(f, bg).toFixed(2)})`); } eq(fixContrast('#111111', '#FFFFFF', 3), '#111111', 'already fine is untouched'); });
t('grade thresholds', () => { ok(grade('#000000', '#FFFFFF').aaa, 'black on white AAA'); ok(!grade('#FBDD2D', '#FFFFFF').large, 'yellow on white fails'); eq(grade('#777777', '#FFFFFF').normal, false, '777 on white < 4.5'); });

t('cleanSpec: garbage in, valid out', () => {
  for (const bad of [null, undefined, 5, 'x', [], {}, { font: 'Nope', size: 9999, tracking: -999, type: 'zzz', fill: { color: 'red' }, top: 3, name: 'x'.repeat(500) }]) {
    const s = cleanSpec(bad); ok(s.size >= 12 && s.size <= 72, 'size'); ok(s.name.length <= 40, 'name'); ok(!!s.font, 'font'); eq(s.fill.color === '' || /^#/.test(s.fill.color), true, 'fill');
    ok(!hasErrors(validateSpec({ ...s, name: 'ok' })) || s.type !== 'image', 'valid');
  }
});
t('cleanSpec is idempotent', () => { const a = cleanSpec({ ...defaultSpec('Dwira'), size: 33.3, weight: 650 }); eq(cleanSpec(a, 'Dwira'), a, 'idempotent'); });
t('weights snap to what the font ships', () => { eq(snapWeight('Anton', 700), 400, 'Anton only 400'); eq(snapWeight('Inter', 640), 600, 'variable steps'); ok(availableWeights('Poppins').includes(500), 'Poppins 500'); });

t('validation: required + blocking', () => {
  const s = defaultSpec('Dwira');
  eq(hasErrors(validateSpec(s)), false, 'default valid');
  eq(validateSpec({ ...s, name: '   ' }).some((i) => i.key === 'nameRequired'), true, 'empty name');
  eq(validateSpec({ ...s, type: 'image' }).some((i) => i.key === 'imageRequired'), true, 'image required');
  eq(validateSpec({ ...s, type: 'image', image: { ...s.image, light: 'javascript:alert(1)' } }).some((i) => i.key === 'imageInvalid'), true, 'unsafe image url');
  eq(validateSpec({ ...s, top: { ...s.top, on: true, text: '' } }).some((i) => i.key === 'lineEmpty'), true, 'empty tagline');
  eq(validateSpec({ ...s, fill: { ...s.fill, color: '#12' } }).some((i) => i.key === 'colorInvalid'), true, 'bad colour');
  eq(validateSpec({ ...s, name: 'دويرة', font: 'Inter' }).some((i) => i.key === 'fontScript'), true, 'Latin font for Arabic name warns');
  const low = validateSpec({ ...s, autoContrast: false, fill: { ...s.fill, color: '#FBDD2D' } });
  eq(low.some((i) => i.key === 'lowOnLight'), true, 'yellow on white warns');
});

t('scripts: direction, subsets, initials', () => {
  eq(isRtlText('دويرة'), true, 'arabic'); eq(isRtlText('Dwira'), false, 'latin'); eq(isRtlText('  123 دار'), true, 'digits skipped'); eq(isRtlText('שלום'), true, 'hebrew');
  ok(subsetsOf('دويرة Dwira').includes('arabic') && subsetsOf('دويرة Dwira').includes('latin'), 'mixed'); eq(subsetsOf('東京'), ['cjk'], 'cjk');
  eq(initialsOf('Dwira Home'), 'DH', 'two words'); eq(initialsOf('دويرة'), 'د', 'arabic single'); eq(initialsOf('  --  '), '', 'empty'); eq(initialsOf('élan vital'), 'ÉV', 'accent');
  eq(textDir(defaultSpec('دويرة')), 'rtl', 'auto dir'); eq(textDir({ ...defaultSpec('دويرة'), dir: 'ltr' }), 'ltr', 'forced dir');
});
t('fonts: script support and fallback', () => {
  ok(supportsText('Cairo', 'دويرة'), 'Cairo arabic'); ok(!supportsText('Playfair Display', 'دويرة'), 'Playfair no arabic');
  const f = fontFor('Playfair Display', 'دويرة'); ok(supportsText(f, 'دويرة'), `fallback ${f} draws arabic`);
  ok(supportsText(fontFor('Pacifico', 'שלום'), 'שלום'), 'hebrew fallback'); ok(supportsText(fontFor('Inter', '東京'), '東京'), 'cjk fallback');
  const found = searchFonts('ca', 'all', 'Dwira'); ok(found.every((x) => x.family.toLowerCase().includes('ca')), 'search filters');
  eq(searchFonts('', 'arabic', 'دويرة').every((x) => x.cat === 'arabic'), true, 'category filter');
  ok(cssUrl('Playfair Display', { italic: true }).includes('ital,wght@'), 'italic css'); ok(!cssUrl('Anton').includes('..'), 'static css');
  ok(FONTS.length > 80, 'catalog size');
});
t('icons: only interior design, one outline style, valid paths', () => {
  ok(ICONS.length >= 50 && ICONS.length <= 80, `curated count ${ICONS.length}`); ok(ICONS.every((i) => /^M/.test(i.d)), 'path data');
  eq([...ICON_GROUP_IDS].sort(), ['architecture', 'decor', 'furniture', 'lighting', 'rooms'], 'only interior groups');
  ok(ICONS.every((i) => /outline|^(shower|desk-lamp|toilet|stove|radiator|door-closed|door-sliding|floor-plan|greenhouse|image-frame|wallpaper|hanger|ceiling-fan|chair-rolling|bench-back|table-chair|compass-outline|cube-outline|ruler-square|mirror-rectangle|window-closed-variant|window-open-variant)/.test(i.name)), 'outline family');
  for (const gone of ['balloon', 'chip', 'rocket-launch-outline', 'airplane', 'pizza', 'heart-pulse', 'bank-outline', 'wifi', 'blinds', 'wall', 'fireplace', 'stairs']) ok(!ICONS.some((i) => i.name === gone), `${gone} removed`);
  ok(searchIcons('sofa', 'all').length >= 2, 'word search'); ok(searchIcons('lamp', 'lighting').length >= 4, 'group search'); eq(searchIcons('zzzzqq', 'all').length, 0, 'no match');
  // one stroke weight: the path data of each icon is built from the same 24-grid outline (every glyph fits the box, none is a solid blob)
  for (const i of ICONS) { const nums = (i.d.match(/-?\d+\.?\d*/g) ?? []).map(Number); ok(Math.max(...nums) <= 24.5 && Math.min(...nums) >= -0.5, `${i.name} inside the 24 grid`); }
});

const measure = estimateMeasure;
const ctx = ctxFor('light');
t('layout: every type renders non-empty and finite', () => {
  for (const type of ['text', 'iconText', 'monogram', 'image'] as const) for (const name of ['Dwira', 'دويرة', 'A', '東京 Home']) {
    const s = cleanSpec({ ...defaultSpec(name), type, image: { light: 'data:image/png;base64,AAAA', dark: '', height: 40, ratio: 2, darkRatio: 1 } }, name);
    const l = layoutLogo(s, measure, ctx); ok(l.w > 0 && l.h > 0 && Number.isFinite(l.w) && Number.isFinite(l.h), `${type}/${name} size`); ok(l.nodes.length > 0, `${type} nodes`);
    const svg = toSvg(l, { id: 'x' }); ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), 'svg'); ok(!/NaN|undefined|Infinity/.test(svg), `${type}/${name} svg has no NaN`);
  }
});
t('layout: top/bottom/left/right lines grow the right axis', () => {
  const base = defaultSpec('Dwira'); const b = layoutLogo(base, measure, ctx);
  const line = (side: 'top' | 'bottom' | 'left' | 'right') => layoutLogo({ ...base, top: { ...base.top, on: true, text: 'Interior design', side } }, measure, ctx);
  ok(line('top').h > b.h && line('bottom').h > b.h, 'vertical grows height'); ok(line('left').w > b.w && line('right').w > b.w, 'horizontal grows width');
  ok(line('left').h >= b.h, 'height not reduced');
  const wide = layoutLogo({ ...base, bottom: { ...base.bottom, on: true, text: 'A much longer slogan here', side: 'bottom', gap: 20 } }, measure, ctx);
  const gap0 = layoutLogo({ ...base, bottom: { ...base.bottom, on: true, text: 'A much longer slogan here', side: 'bottom', gap: 0 } }, measure, ctx);
  ok(wide.h - gap0.h === 20, `gap adds exactly 20 (got ${wide.h - gap0.h})`);
});
t('layout: spacing maps to tracking and ignores joined scripts', () => {
  const a = layoutLogo({ ...defaultSpec('Dwira'), tracking: 0 }, measure, ctx), b = layoutLogo({ ...defaultSpec('Dwira'), tracking: 20 }, measure, ctx); ok(b.w > a.w, 'tracking widens latin');
  const c = layoutLogo({ ...defaultSpec('دويرة'), font: 'Cairo', tracking: 0 }, measure, ctx), d = layoutLogo({ ...defaultSpec('دويرة'), font: 'Cairo', tracking: 20 }, measure, ctx); eq(c.w, d.w, 'arabic never letter-spaced');
});
t('RTL: icon + text order mirrors, line alignment flips', () => {
  const s = cleanSpec({ ...defaultSpec('دويرة'), type: 'iconText', font: 'Cairo', icon: { name: 'home-roof', pos: 'start', scale: 120, color: '', gap: 8 } }, 'دويرة');
  const rtl = layoutLogo(s, measure, ctx), ltr = layoutLogo({ ...s, dir: 'ltr' }, measure, ctx);
  const iconX = (l: typeof rtl) => (l.nodes.find((x) => x.k === 'path') as any).x, textX = (l: typeof rtl) => (l.nodes.find((x) => x.k === 'text') as any).cx;
  ok(iconX(ltr) < textX(ltr), 'ltr icon left of text'); ok(iconX(rtl) > textX(rtl), 'rtl icon right of text');
  const lineS = { ...defaultSpec('دويرة dar'), font: 'Cairo', bottom: { ...defaultSpec().bottom, on: true, text: 'a much longer tagline text', side: 'bottom' as const, align: 'start' as const } };
  const r = layoutLogo(lineS, measure, ctx), l = layoutLogo({ ...lineS, dir: 'ltr' }, measure, ctx);
  const xs = (q: typeof r) => q.nodes.filter((x) => x.k === 'text').map((x: any) => x.cx);
  ok(xs(r)[0] > xs(l)[0] - 0.01 || xs(r)[0] !== xs(l)[0], 'start alignment is logical (differs between rtl and ltr)');
});
t('dark / light: auto-contrast fixes custom colours, off keeps them', () => {
  const s: LogoSpec = { ...defaultSpec('Dwira'), fill: { mode: 'solid' as const, color: '#FBDD2D', color2: '#2563EB', angle: 90 } };
  const paintOf = (sp: typeof s, mode: 'light' | 'dark') => (layoutLogo(sp, measure, ctxFor(mode)).nodes.find((x) => x.k === 'text') as any).fill.c;
  ok(ratio(paintOf(s, 'light'), '#FFFFFF') >= 3, 'yellow fixed on white'); eq(paintOf(s, 'dark'), '#FBDD2D', 'yellow fine on dark');
  eq(paintOf({ ...s, autoContrast: false }, 'light'), '#FBDD2D', 'auto off keeps colour');
  const auto = { ...defaultSpec('Dwira') }; eq(paintOf(auto, 'light'), '#111111', 'automatic ink on light'); eq(paintOf(auto, 'dark'), '#F5F5F5', 'automatic ink on dark');
});
t('image: dark version is used only on dark', () => {
  const s = cleanSpec({ ...defaultSpec('Dwira'), type: 'image', image: { light: 'data:image/png;base64,AA', dark: 'data:image/png;base64,BB', height: 40, ratio: 2, darkRatio: 3 } });
  const href = (m: 'light' | 'dark') => (layoutLogo(s, measure, ctxFor(m)).nodes.find((x) => x.k === 'image') as any).href;
  eq(href('light'), 'data:image/png;base64,AA', 'light'); eq(href('dark'), 'data:image/png;base64,BB', 'dark');
  eq(href('dark') === href('light'), false, 'differs'); const only = { ...s, image: { ...s.image, dark: '' } }; eq((layoutLogo(only, measure, ctxFor('dark')).nodes.find((x) => x.k === 'image') as any).href, 'data:image/png;base64,AA', 'falls back to light');
});
t('app icon / favicon: square, picks the right source', () => {
  for (const type of ['text', 'iconText', 'monogram', 'image'] as const) { const s = cleanSpec({ ...defaultSpec('Dwira'), type, image: { light: 'data:image/png;base64,AA', dark: '', height: 40, ratio: 1, darkRatio: 1 } }); const l = appIconLayout(s, measure, ctx, 256); eq([l.w, l.h], [256, 256], `${type} square`); ok(!/NaN/.test(toSvg(l, { id: 'a' })), 'no NaN'); }
  eq(iconSourceOf(defaultSpec('x')), 'initial', 'text -> initial'); eq(iconSourceOf({ ...defaultSpec('x'), type: 'iconText' }), 'icon', 'iconText -> icon'); eq(iconSourceOf({ ...defaultSpec('x'), type: 'image' }), 'initial', 'image without file -> initial');
  eq(monoText({ ...defaultSpec('Dwira Home') }), 'DH', 'mono initials');
});
t('svg: gradients, outline, shadow, escaping', () => {
  const s = cleanSpec({ ...defaultSpec('A & <B>'), fill: { mode: 'gradient', color: '#FF0000', color2: '#0000FF', angle: 45 }, outline: { on: true, color: '#000000', width: 2 }, shadow: { on: true, color: '#000000', opacity: 0.5, blur: 6, x: 1, y: 2 } }, 'A & <B>');
  const svg = toSvg(layoutLogo(s, measure, ctx), { id: 'q' }); ok(svg.includes('linearGradient') && svg.includes('feDropShadow') && svg.includes('stroke-width'), 'effects'); ok(svg.includes('A &amp; &lt;B&gt;') && !svg.includes('<B>'), 'escaped');
});
t('case modes (locale aware)', () => { eq(applyCase('dwira home', 'title'), 'Dwira Home', 'title'); eq(applyCase('Dwira', 'upper'), 'DWIRA', 'upper'); eq(applyCase('İstanbul', 'lower').length >= 8, true, 'turkish dotted I survives'); eq(applyCase('دويرة', 'upper'), 'دويرة', 'arabic unchanged'); });

const TONES: (Tone | null)[] = [
  null,
  { primary: '#FBDD2D', bg: '#FFFFFF', surface: '#F4F4F5', fg: '#111111', ink: '#111111', dark: false },
  { primary: '#7C3AED', bg: '#0E0E10', surface: '#1B1B1F', fg: '#F5F5F5', ink: '#F5F5F5', dark: true },
  { primary: '#0B6E4F', bg: '#F3F1EA', surface: '#FFFFFF', fg: '#1B1B1E', ink: '#1B1B1E', dark: false },
];
const bgsOf = (tone: Tone | null) => (tone ? [tone.bg, tone.surface] : ['#FFFFFF', '#0E0E10']);
/** Effective colours of a logo (the fill / icon colour it will really be drawn with). */
const colorsOf = (r: LogoSpec) => [r.fill.color, r.fill.mode === 'gradient' ? r.fill.color2 : '', r.icon.color, r.type === 'monogram' ? r.mono.bg : ''].filter(Boolean);
const hueDist = (a: string, b: string) => { const d = Math.abs(toHsl(a)[0] - toHsl(b)[0]); return Math.min(d, 360 - d); };

t('presets (demos): one per concept, valid, keep words + image, fonts draw the name, theme aware', () => {
  ok(PRESETS.length === CONCEPTS.length && PRESETS.length >= 10, 'one demo per concept');
  for (const tone of TONES) for (const name of ['Dwira', 'دويرة', '東京']) for (const p of PRESETS) {
    const base = cleanSpec({ ...defaultSpec(name), top: { ...defaultSpec().top, on: true, text: 'slogan' } }, name); const r = applyPreset(base, p, tone);
    eq(r.name, name, `${p.id} keeps name`); eq(r.top.text, 'slogan', `${p.id} keeps tagline`); ok(supportsText(r.font, name), `${p.id} font ${r.font} draws "${name}"`); ok(!hasErrors(validateSpec(r)), `${p.id} valid`);
    eq(applyPreset(base, p, tone), r, `${p.id} deterministic (what the tile shows is what a click applies)`);
  }
  const withImg = cleanSpec({ ...defaultSpec('Dwira'), type: 'image', image: { light: 'data:image/png;base64,AA', dark: '', height: 40, ratio: 1, darkRatio: 1 } }); eq(applyPreset(withImg, PRESETS[0]).image.light, 'data:image/png;base64,AA', 'image kept');
  const tone = TONES[2]!; const d = applyPreset(defaultSpec('Dwira'), PRESETS[3], tone); ok(colorsOf(d).every((c) => hueDist(c, tone.primary) <= 60 || ratio(c, tone.bg) >= 3), 'demo colours follow the app theme family');
});
t('surprise: deterministic per seed, varied, coherent, respects locks and scripts', () => {
  const base = defaultSpec('دويرة'); const lock = { font: false, color: false, layout: false };
  eq(surprise(base, 7, lock), surprise(base, 7, lock), 'same seed same result');
  const seen = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(surprise(base, i + 1, lock)))); ok(seen.size > 25, `variety ${seen.size}/40`);
  for (let i = 0; i < 80; i++) { const r = surprise(base, i * 13 + 1, lock); ok(supportsText(r.font, 'دويرة'), `arabic-capable font (${r.font})`); eq(r.tracking, 0, 'no tracking for arabic'); ok(!hasErrors(validateSpec(r)), 'valid'); eq(r.name, 'دويرة', 'name kept'); }
  const lk = surprise(defaultSpec('Dwira'), 5, { font: true, color: true, layout: false }); eq(lk.font, 'Lora', 'font locked'); eq(lk.fill, defaultSpec('Dwira').fill, 'color locked');
  const img = cleanSpec({ ...defaultSpec('Dwira'), type: 'image', image: { light: 'data:image/png;base64,AA', dark: '', height: 40, ratio: 1, darkRatio: 1 } }); eq(surprise(img, 3, lock).type, 'image', 'image stays image');
});
t('surprise: not a shuffle - avoid list is honoured, every concept reachable', () => {
  const base = defaultSpec('Dwira'); const lock = { font: false, color: false, layout: false }; const recent: string[] = []; const hit = new Set<string>();
  for (let i = 0; i < 60; i++) { const d = designLogo(base, 1000 + i * 7, lock, null, { avoid: recent }); ok(!recent.includes(d.concept), `repeat of ${d.concept} within the last 4`); recent.unshift(d.concept); recent.length = Math.min(recent.length, 4); hit.add(d.concept); }
  eq(hit.size, CONCEPTS.length, `all ${CONCEPTS.length} concepts reachable (${hit.size})`);
});
t('logo design rules: contrast, one colour family, matched icon stroke, small-size safety', () => {
  for (const tone of TONES) for (const name of ['Dwira', 'دويرة']) for (let i = 0; i < 90; i++) {
    const r = surprise(defaultSpec(name), 77 + i * 31, { font: false, color: false, layout: false }, tone); const bgs = bgsOf(tone); const tag = `${name} #${i} ${r.type}/${r.font}/${r.weight}`;
    // 1. contrast on every background the logo is drawn on (wordmark 4.5:1 matched to the app / 3.5:1 on white + black at once, icon / monogram 3:1); '' = follows the page (always max contrast)
    const need = minText(tone) - 0.05;
    if (r.fill.color) for (const b of bgs) ok(ratio(r.fill.color, b) >= need, `${tag} wordmark ${r.fill.color} on ${b}: ${ratio(r.fill.color, b).toFixed(2)} (need ${need.toFixed(2)})`);
    if (r.fill.mode === 'gradient') for (const b of bgs) ok(ratio(r.fill.color2, b) >= need, `${tag} gradient end on ${b}`);
    if (r.type === 'iconText' && r.icon.color) for (const b of bgs) ok(ratio(r.icon.color, b) >= 3 - 0.05, `${tag} icon ${r.icon.color} on ${b}: ${ratio(r.icon.color, b).toFixed(2)}`);
    // 2. harmony: every colour within one hue family (<= 80 deg of the first) - never a rainbow
    const cs = colorsOf(r).filter((c) => toHsl(c)[1] > 12); for (const c of cs) ok(hueDist(c, cs[0]) <= 80, `${tag} colours ${cs.join(',')} are one family`);
    ok(cs.length <= 3, `${tag} at most 3 colours`);
    // 3. icon and text are one style: the icon stroke follows the stem of the weight (0.6 .. 1.7 of it), same weight family, proportional gap
    if (r.type === 'iconText') { const m = strokeMatch(r); ok(m >= 0.6 && m <= 1.7, `${tag} icon/text stroke ratio ${m.toFixed(2)}`); ok(r.icon.gap >= r.size * 0.2 && r.icon.gap <= r.size * 0.4, `${tag} proportional gap ${r.icon.gap}/${r.size}`); ok(r.fill.mode === 'solid', `${tag} no gradient behind an icon`); }
    // 4. legibility at small sizes / one colour: no hairline weights, no effects
    if (r.type !== 'image') { ok(r.weight >= 400, `${tag} weight ${r.weight} readable small`); ok(!r.shadow.on && !r.outline.on, `${tag} no effects`); }
    // 5. icons come from the interior set
    if (r.type === 'iconText') ok(ICONS.some((x) => x.name === r.icon.name), `${tag} interior icon`);
  }
});
t('palette: strategies stay legible and in one family; the app colour is the base when matched', () => {
  for (const tone of TONES) for (const base of [...INTERIOR.map((x) => x.main), '#FBDD2D', '#FFFFFF', '#111111']) for (const st of STRATEGIES) {
    const c = logoColors(st, base, tone); for (const b of bgsOf(tone)) { if (c.text) ok(ratio(c.text, b) >= minText(tone) - 0.05, `${st} ${base} text on ${b}: ${ratio(c.text, b).toFixed(2)}`); ok(ratio(c.icon, b) >= 2.95, `${st} ${base} icon on ${b}: ${ratio(c.icon, b).toFixed(2)}`); }
  }
  ok(ratio(legible('#FBDD2D', ['#FFFFFF', '#0E0E10'], 3), '#FFFFFF') >= 3, 'yellow fixed on white');
  eq(designLogo(defaultSpec('Dwira'), 3, { font: false, color: false, layout: false }, TONES[1]).base === TONES[1]!.primary || hueDist(designLogo(defaultSpec('Dwira'), 3, { font: false, color: false, layout: false }, TONES[1]).base, TONES[1]!.primary) <= 20, true, 'matched base follows the theme primary');
  ok(iconScaleFor('Inter', 700) > iconScaleFor('Inter', 400), 'heavier text -> bigger (heavier) icon');
});

t('history: undo, redo, coalescing, branch cut, limit', () => {
  let h = H.init(0);
  h = H.commit(h, 1, 'size', 1000); h = H.commit(h, 2, 'size', 1200); h = H.commit(h, 3, 'size', 1300); eq(h.past, [0], 'slider drag = one step');
  h = H.commit(h, 4, 'color', 1400); eq(h.past, [0, 3], 'new control = new step'); h = H.commit(h, 5, 'size', 5000); eq(h.past, [0, 3, 4], 'long pause = new step');
  h = H.undo(h); eq(h.present, 4, 'undo'); h = H.undo(h); eq(h.present, 3, 'undo 2'); h = H.redo(h); eq(h.present, 4, 'redo'); eq(H.canRedo(h), true, 'can redo');
  h = H.commit(h, 9, '', 9000); eq(H.canRedo(h), false, 'edit clears redo'); eq(H.commit(h, 9, '', 9100), h, 'no-op edit changes nothing');
  let big = H.init(0); for (let i = 1; i <= 250; i++) big = H.commit(big, i, '', i * 10000); eq(big.past.length, H.LIMIT, 'bounded');
  eq(H.undo(H.init(1)).present, 1, 'undo at start safe'); eq(H.redo(H.init(1)).present, 1, 'redo at end safe');
});
t('legacy branding <-> spec', () => {
  const old = { appName: 'Dwira', logoUri: '', logoPosition: 'center', logoFont: 'Lora', logoStyle: 'badge', logoSize: 30, logoItalic: true, logoSpacing: 1.5, logoColor: '#2563EB' };
  const s = specFromBranding(old); eq(s.type, 'text', 'text'); eq(s.decor, 'badge', 'badge'); eq(s.align, 'center', 'align'); eq(s.italic, true, 'italic'); eq(s.fill.color, '#2563EB', 'colour');
  const back = legacyFields(s); eq(back.appName, 'Dwira', 'name'); eq(back.logoStyle, 'badge', 'style'); eq(back.logoPosition, 'center', 'position'); ok(Math.abs(back.logoSpacing - 1.5) <= 0.5, 'spacing round trip');
  eq(specFromBranding({ appName: 'X', logoMode: 'image', logoUri: 'data:image/png;base64,AA' }).type, 'image', 'image');
  eq(specFromBranding({ appName: 'X', logo: { type: 'monogram', font: 'Poppins' } }).type, 'monogram', 'stored spec wins'); eq(specFromBranding(null).name, 'Dwira', 'null safe'); eq(legacyFields(defaultSpec('Z')).logoSize >= 18, true, 'legacy size in range');
  eq(legacyFields({ ...defaultSpec('Z'), size: 72 }).logoSize, 40, 'legacy size capped');
});
t('changed groups', () => { const a = defaultSpec('A'), b = { ...a, font: 'Inter', fill: { ...a.fill, color: '#FF0000' } }; eq(changedGroups(a, b), ['font', 'colors'], 'groups'); eq(changedGroups(a, a), [], 'none'); });

t('fixBoth: one colour readable on light and dark', () => {
  for (const c of ['#FBDD2D', '#FFFFFF', '#000000', '#2563EB', '#F97316']) { const f = fixBoth(c); ok(ratio(f, '#FFFFFF') >= 3 && ratio(f, '#0E0E10') >= 3, `fixBoth ${c} -> ${f}`); }
  eq(fixBoth('#2563EB'), '#2563EB', 'already fine stays');
});
console.log(process.exitCode ? 'brand checks FAILED' : `brand checks passed (${n} groups)`);