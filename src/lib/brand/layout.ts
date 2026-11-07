import { fixContrast, mix, readable, ratio } from './color';
import { fontFor, snapWeight, FALLBACK_STACK } from './fontData';
import { iconPath } from './icons';
import { graphemes, needsJoined } from './script';
import { applyCase, monoText, textDir, type Align, type Line, type LogoSpec } from './spec';

/* ---------------------------------------------------------------- inputs */
export interface TextFont { family: string; weight: number; italic: boolean; size: number }
export interface TextMetrics { width: number; ascent: number; descent: number }
export type Measure = (text: string, font: TextFont) => TextMetrics;
export interface Ctx { mode: 'light' | 'dark'; bg: string; fg: string; accent: string }
export const CTX: Record<'light' | 'dark', Omit<Ctx, 'accent'>> = {
  light: { mode: 'light', bg: '#FFFFFF', fg: '#111111' },
  dark: { mode: 'dark', bg: '#0E0E10', fg: '#F5F5F5' },
};
export const ctxFor = (mode: 'light' | 'dark', accent = '#FBDD2D', bg?: string, fg?: string): Ctx => ({ ...CTX[mode], accent, ...(bg ? { bg } : {}), ...(fg ? { fg } : {}) });

/** Estimated metrics when no canvas exists (Node tests, native): good enough for layout, never used for export. */
export const estimateMeasure: Measure = (text, f) => ({ width: graphemes(text).length * f.size * 0.56, ascent: f.size * 0.76, descent: f.size * 0.22 });

/* ----------------------------------------------------------------- nodes */
export type Paint = { t: 'solid'; c: string } | { t: 'grad'; c1: string; c2: string; angle: number };
export type Node =
  | { k: 'text'; cx: number; y: number; text: string; f: TextFont; ls: number; dir: 'ltr' | 'rtl'; fill: Paint; stroke?: { c: string; w: number } }
  | { k: 'rect'; x: number; y: number; w: number; h: number; r: number; fill: Paint }
  | { k: 'path'; x: number; y: number; s: number; d: string; fill: Paint }
  | { k: 'image'; x: number; y: number; w: number; h: number; href: string };
export interface Block { w: number; h: number; nodes: Node[] }
export interface Layout { w: number; h: number; nodes: Node[]; pad: number; effects: { shadow?: LogoSpec['shadow']; } }

const solid = (c: string): Paint => ({ t: 'solid', c });
const shift = (n: Node, dx: number, dy: number): Node => (n.k === 'text' ? { ...n, cx: n.cx + dx, y: n.y + dy } : { ...n, x: n.x + dx, y: n.y + dy });
const place = (b: Block, x: number, y: number): Node[] => b.nodes.map((n) => shift(n, x, y));

/* ----------------------------------------------------------- colour logic */
/** The logo's main paint for a background: custom colours are nudged to >= 3:1 when auto-contrast is on. */
export function mainPaint(s: LogoSpec, ctx: Ctx): Paint {
  const fix = (c: string) => (s.autoContrast ? fixContrast(c, ctx.bg, 3) : c);
  if (s.fill.mode === 'gradient' && s.fill.color) return { t: 'grad', c1: fix(s.fill.color), c2: fix(s.fill.color2), angle: s.fill.angle };
  if (s.fill.color) return solid(fix(s.fill.color));
  return solid(ctx.fg);
}
const firstColor = (p: Paint) => (p.t === 'solid' ? p.c : p.c1);
const mutedColor = (ctx: Ctx) => mix(ctx.fg, ctx.bg, 0.4);

/* ---------------------------------------------------------------- blocks */
interface TextOpts { text: string; f: TextFont; tracking: number; fill: Paint; dir: 'ltr' | 'rtl'; stroke?: { c: string; w: number } }
function textBlock(m: Measure, o: TextOpts): Block {
  const joined = needsJoined(o.text);
  const ls = joined ? 0 : (o.tracking / 100) * o.f.size;
  const met = m(o.text, o.f);
  const n = graphemes(o.text).length;
  const ink = met.width + Math.max(0, n - 1) * ls;
  const ascent = Math.max(met.ascent, o.f.size * 0.72), descent = Math.max(met.descent, o.f.size * 0.2);
  return { w: Math.max(1, ink), h: ascent + descent, nodes: [{ k: 'text', cx: ink / 2 + ls / 2, y: ascent, text: o.text, f: o.f, ls, dir: o.dir, fill: o.fill, stroke: o.stroke }] };
}
const hstack = (parts: { b: Block; dy?: number }[], gap: number): Block => {
  let x = 0; const nodes: Node[] = []; const h = Math.max(...parts.map((p) => p.b.h));
  parts.forEach((p, i) => { nodes.push(...place(p.b, x, (h - p.b.h) / 2 + (p.dy ?? 0))); x += p.b.w + (i < parts.length - 1 ? gap : 0); });
  return { w: x, h, nodes };
};
const vstack = (parts: Block[], gap: number): Block => {
  let y = 0; const nodes: Node[] = []; const w = Math.max(...parts.map((p) => p.w));
  parts.forEach((p, i) => { nodes.push(...place(p, (w - p.w) / 2, y)); y += p.h + (i < parts.length - 1 ? gap : 0); });
  return { w, h: y, nodes };
};

function mainText(s: LogoSpec, m: Measure, ctx: Ctx, paint: Paint, dir: 'ltr' | 'rtl'): Block {
  const text = applyCase(s.name.trim() || ' ', s.case);
  const family = fontFor(s.font, text);
  const f: TextFont = { family, weight: snapWeight(family, s.weight), italic: s.italic, size: s.size };
  const stroke = s.outline.on ? { c: s.outline.color, w: s.outline.width } : undefined;
  let b = textBlock(m, { text, f, tracking: s.tracking, fill: paint, dir, stroke });
  if (s.decor === 'underline') {
    const barH = Math.max(2, s.size * 0.1), barW = Math.min(b.w, Math.max(20, s.size));
    const bar: Node = { k: 'rect', x: dir === 'rtl' ? b.w - barW : 0, y: b.h + s.size * 0.06, w: barW, h: barH, r: barH / 2, fill: solid(ctx.accent) };
    b = { w: b.w, h: b.h + s.size * 0.06 + barH, nodes: [...b.nodes, bar] };
  } else if (s.decor === 'badge') {
    const px = s.size * 0.45, py = s.size * 0.16;
    const rect: Node = { k: 'rect', x: 0, y: 0, w: b.w + px * 2, h: b.h + py * 2, r: (b.h + py * 2) / 3, fill: solid(mix(ctx.bg, ctx.accent, 0.22)) };
    b = { w: b.w + px * 2, h: b.h + py * 2, nodes: [rect, ...place(b, px, py)] };
  }
  return b;
}
function iconBlock(s: LogoSpec, paint: Paint, size: number): Block {
  const side = size;
  const color = s.icon.color ? solid(s.icon.color) : paint;
  return { w: side, h: side, nodes: [{ k: 'path', x: 0, y: 0, s: side / 24, d: iconPath(s.icon.name), fill: color }] };
}
function monoBlock(s: LogoSpec, m: Measure, ctx: Ctx, paint: Paint, dir: 'ltr' | 'rtl'): Block {
  const S = s.size * (s.mono.scale / 100);
  const text = applyCase(monoText(s), s.case === 'lower' ? 'none' : s.case);
  const family = fontFor(s.font, text + s.name);
  const bg: Paint = s.mono.bg ? solid(s.mono.bg) : paint;
  const fg = s.mono.shape === 'none' ? paint : solid(s.mono.fg || readable(firstColor(bg)));
  const k = graphemes(text).length;
  const size = S * (k <= 1 ? 0.56 : k === 2 ? 0.44 : 0.34);
  const f: TextFont = { family, weight: snapWeight(family, s.weight), italic: s.italic, size };
  const t = textBlock(m, { text, f, tracking: Math.max(0, s.tracking) / 2, fill: fg, dir });
  const nodes: Node[] = [];
  if (s.mono.shape !== 'none') nodes.push({ k: 'rect', x: 0, y: 0, w: S, h: S, r: s.mono.shape === 'circle' ? S / 2 : s.mono.shape === 'squircle' ? S * 0.3 : S * 0.08, fill: bg });
  const ox = (S - t.w) / 2, oy = (S - t.h) / 2;
  nodes.push(...place(t, s.mono.shape === 'none' ? 0 : ox, s.mono.shape === 'none' ? 0 : oy));
  return s.mono.shape === 'none' ? { w: t.w, h: t.h, nodes } : { w: S, h: S, nodes };
}
export function imageSource(s: LogoSpec, ctx: Ctx) { return ctx.mode === 'dark' && s.image.dark ? { href: s.image.dark, ratio: s.image.darkRatio } : { href: s.image.light, ratio: s.image.ratio }; }
function imageBlock(s: LogoSpec, ctx: Ctx): Block {
  const src = imageSource(s, ctx);
  const h = s.image.height, w = Math.max(8, h * src.ratio);
  return { w, h, nodes: src.href ? [{ k: 'image', x: 0, y: 0, w, h, href: src.href }] : [{ k: 'rect', x: 0, y: 0, w, h, r: 6, fill: solid(mix(ctx.bg, ctx.fg, 0.1)) }] };
}

export function mainBlock(s: LogoSpec, m: Measure, ctx: Ctx): Block {
  const dir = textDir(s);
  const paint = mainPaint(s, ctx);
  if (s.type === 'image') return imageBlock(s, ctx);
  if (s.type === 'monogram') {
    const mono = monoBlock(s, m, ctx, paint, dir);
    if (!s.mono.withName) return mono;
    const name = mainText({ ...s, decor: 'none' }, m, ctx, paint, dir);
    return hstack(dir === 'rtl' ? [{ b: name }, { b: mono }] : [{ b: mono }, { b: name }], s.size * 0.3);
  }
  const text = mainText(s, m, ctx, paint, dir);
  if (s.type === 'iconText') {
    const icon = iconBlock(s, paint, s.size * (s.icon.scale / 100));
    const first = s.icon.pos === 'start' || s.icon.pos === 'top';
    if (s.icon.pos === 'top' || s.icon.pos === 'bottom') return vstack(first ? [icon, text] : [text, icon], s.icon.gap);
    const iconLeft = (s.icon.pos === 'start') === (dir === 'ltr');
    return hstack(iconLeft ? [{ b: icon }, { b: text }] : [{ b: text }, { b: icon }], s.icon.gap);
  }
  return text;
}

function lineBlock(s: LogoSpec, l: Line, m: Measure, ctx: Ctx, dir: 'ltr' | 'rtl'): Block {
  const text = applyCase(l.text.trim() || ' ', l.case);
  const family = fontFor(l.font || s.font, text);
  const f: TextFont = { family, weight: snapWeight(family, l.weight), italic: l.italic, size: Math.max(6, (s.size * l.size) / 100) };
  return textBlock(m, { text, f, tracking: l.tracking, fill: solid(l.color ? (s.autoContrast ? fixContrast(l.color, ctx.bg, 3) : l.color) : mutedColor(ctx)), dir });
}

/* --------------------------------------------------------------- compose */
const crossOffset = (align: Align, outer: number, inner: number, dir: 'ltr' | 'rtl', horizontal: boolean) => {
  const a = horizontal && dir === 'rtl' ? (align === 'start' ? 'end' : align === 'end' ? 'start' : 'center') : align;
  return a === 'start' ? 0 : a === 'end' ? outer - inner : (outer - inner) / 2;
};
export function layoutLogo(s: LogoSpec, m: Measure, ctx: Ctx): Layout {
  const dir = textDir(s);
  const main = mainBlock(s, m, ctx);
  const lines = ([['top', s.top], ['bottom', s.bottom]] as const).filter(([, l]) => l.on && l.text.trim()).map(([, l]) => ({ l, b: lineBlock(s, l, m, ctx, dir) }));
  const on = (side: string) => lines.filter((x) => x.l.side === side);
  const stack = (side: string): { b: Block; gap: number; aligns: Align } | null => {
    const list = on(side); if (!list.length) return null;
    const horizontal = side === 'left' || side === 'right';
    const w = Math.max(...list.map((x) => x.b.w));
    let off = 0; const nodes: Node[] = [];
    list.forEach((x, i) => { nodes.push(...place(x.b, horizontal ? (side === 'left' ? w - x.b.w : 0) : 0, off)); off += x.b.h + (i < list.length - 1 ? 4 : 0); });
    return { b: { w, h: off, nodes }, gap: list[0].l.gap, aligns: list[0].l.align };
  };
  // 1) left / right of the main block
  const L = stack('left'), R = stack('right');
  let cluster: Block = main;
  {
    const parts: { n: Node[]; x: number; y: number }[] = [];
    let x = 0; let top = 0, bottom = main.h;
    const yOf = (st: { b: Block; aligns: Align }) => (st.aligns === 'start' ? 0 : st.aligns === 'end' ? main.h - st.b.h : (main.h - st.b.h) / 2);
    if (L) { parts.push({ n: L.b.nodes, x: 0, y: yOf(L) }); x += L.b.w + L.gap; top = Math.min(top, yOf(L)); bottom = Math.max(bottom, yOf(L) + L.b.h); }
    const mainX = x;
    x += main.w;
    if (R) { parts.push({ n: R.b.nodes, x: x + R.gap, y: yOf(R) }); x += R.gap + R.b.w; top = Math.min(top, yOf(R)); bottom = Math.max(bottom, yOf(R) + R.b.h); }
    const nodes = [...place(main, mainX, -top), ...parts.flatMap((p) => p.n.map((n) => shift(n, p.x, p.y - top)))];
    cluster = { w: x, h: bottom - top, nodes };
  }
  // 2) top / bottom of the cluster
  const T = stack('top'), B = stack('bottom');
  const w = Math.max(cluster.w, T?.b.w ?? 0, B?.b.w ?? 0);
  const clusterAlign: Align = (T ?? B)?.aligns ?? 'center';
  const nodes: Node[] = []; let y = 0;
  if (T) { nodes.push(...place(T.b, crossOffset(T.aligns, w, T.b.w, dir, true), y)); y += T.b.h + T.gap; }
  nodes.push(...place(cluster, crossOffset(clusterAlign, w, cluster.w, dir, true), y)); y += cluster.h;
  if (B) { y += B.gap; nodes.push(...place(B.b, crossOffset(B.aligns, w, B.b.w, dir, true), y)); y += B.b.h; }
  const pad = Math.ceil(Math.max(2, s.outline.on ? s.outline.width : 0, s.shadow.on ? s.shadow.blur * 1.5 + Math.max(Math.abs(s.shadow.x), Math.abs(s.shadow.y)) : 0));
  return { w, h: y, nodes, pad, effects: { shadow: s.shadow.on ? s.shadow : undefined } };
}

/* ------------------------------------------------------------------ SVG */
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => String(Math.round(n * 100) / 100);
export interface SvgOpts { family?: (f: TextFont) => string | undefined; id: string; pad?: number; background?: string; embedCss?: string; scale?: number; title?: string; round?: number }
export function toSvg(l: Layout, opts: SvgOpts): string {
  const pad = opts.pad ?? l.pad;
  const W = l.w + pad * 2, H = l.h + pad * 2;
  const defs: string[] = []; let gi = 0;
  const paint = (p: Paint): string => {
    if (p.t === 'solid') return p.c;
    const id = `${opts.id}g${gi++}`; const a = (p.angle * Math.PI) / 180; const dx = Math.sin(a) / 2, dy = -Math.cos(a) / 2;
    defs.push(`<linearGradient id="${id}" x1="${num(0.5 - dx)}" y1="${num(0.5 - dy)}" x2="${num(0.5 + dx)}" y2="${num(0.5 + dy)}"><stop offset="0" stop-color="${p.c1}"/><stop offset="1" stop-color="${p.c2}"/></linearGradient>`);
    return `url(#${id})`;
  };
  const body = l.nodes.map((n) => {
    if (n.k === 'text') {
      const own = opts.family?.(n.f);
      const fam = own ? `'${own.replace(/'/g, '')}'` : `'${n.f.family.replace(/'/g, '')}', ${FALLBACK_STACK.replace(/"/g, "'")}`;
      return `<text x="${num(n.cx)}" y="${num(n.y)}" text-anchor="middle" direction="${n.dir}" font-family="${esc(fam)}" font-weight="${n.f.weight}" font-style="${n.f.italic ? 'italic' : 'normal'}" font-size="${num(n.f.size)}"${n.ls ? ` letter-spacing="${num(n.ls)}"` : ''} fill="${paint(n.fill)}"${n.stroke ? ` stroke="${n.stroke.c}" stroke-width="${num(n.stroke.w)}" stroke-linejoin="round" paint-order="stroke"` : ''} xml:space="preserve">${esc(n.text)}</text>`;
    }
    if (n.k === 'rect') return `<rect x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}" rx="${num(n.r)}" fill="${paint(n.fill)}"/>`;
    if (n.k === 'path') return `<path transform="translate(${num(n.x)} ${num(n.y)}) scale(${Math.round(n.s * 1000) / 1000})" d="${n.d}" fill="${paint(n.fill)}"/>`;
    return `<image href="${esc(n.href)}" x="${num(n.x)}" y="${num(n.y)}" width="${num(n.w)}" height="${num(n.h)}" preserveAspectRatio="xMidYMid meet"/>`;
  }).join('');
  const sh = l.effects.shadow;
  let filter = '';
  if (sh) { defs.push(`<filter id="${opts.id}s" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="${sh.x}" dy="${sh.y}" stdDeviation="${num(sh.blur / 2)}" flood-color="${sh.color}" flood-opacity="${sh.opacity}"/></filter>`); filter = ` filter="url(#${opts.id}s)"`; }
  const k = opts.scale ?? 1;
  const bg = opts.background ? `<rect width="${num(W)}" height="${num(H)}" fill="${opts.background}"${opts.round ? ` rx="${opts.round}"` : ''}/>` : '';
  const style = opts.embedCss ? `<style>${opts.embedCss}</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(W)} ${num(H)}" width="${num(W * k)}" height="${num(H * k)}" role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ''}><defs>${style}${defs.join('')}</defs>${bg}<g transform="translate(${pad} ${pad})"${filter}>${body}</g></svg>`;
}

/* -------------------------------------------------------- app icon / favicon */
export type IconSource = 'icon' | 'monogram' | 'initial' | 'image';
export function iconSourceOf(s: LogoSpec): IconSource {
  if (s.app.source !== 'auto') return s.app.source === 'image' && !s.image.light ? 'initial' : s.app.source;
  return s.type === 'image' && s.image.light ? 'image' : s.type === 'iconText' ? 'icon' : s.type === 'monogram' ? 'monogram' : 'initial';
}
/** Square app icon / favicon as a Layout of `size` x `size` (the shape is part of the artwork unless `fullBleed`). */
export function appIconLayout(s: LogoSpec, m: Measure, ctx: Ctx, size = 512, fullBleed = false): Layout {
  const light = { ...ctx, mode: 'light' as const, bg: '#FFFFFF' };
  const paint = mainPaint(s, light);
  const bgPaint: Paint = s.app.bg ? solid(s.app.bg) : s.fill.color ? paint : solid(ctx.accent);
  const fgColor = s.app.fg || readable(firstColor(bgPaint));
  const src = iconSourceOf(s);
  const radius = fullBleed ? 0 : s.app.shape === 'circle' ? size / 2 : s.app.shape === 'squircle' ? size * 0.225 : size * 0.06;
  const nodes: Node[] = [{ k: 'rect', x: 0, y: 0, w: size, h: size, r: radius, fill: bgPaint }];
  if (src === 'image') {
    const im = imageSource(s, { ...ctx, mode: 'light' });
    const box = size * 0.68; const w = im.ratio >= 1 ? box : box * im.ratio, h = im.ratio >= 1 ? box / im.ratio : box;
    nodes.push({ k: 'image', x: (size - w) / 2, y: (size - h) / 2, w, h, href: im.href });
  } else if (src === 'icon') {
    const g = size * 0.58; nodes.push({ k: 'path', x: (size - g) / 2, y: (size - g) / 2, s: g / 24, d: iconPath(s.icon.name), fill: solid(fgColor) });
  } else {
    const text = src === 'monogram' ? monoText(s) : graphemes(s.name.trim())[0]?.toLocaleUpperCase() ?? '?';
    const k = graphemes(text).length; const fs = size * (k <= 1 ? 0.56 : k === 2 ? 0.42 : 0.32);
    const family = fontFor(s.font, text);
    const t = textBlock(m, { text, f: { family, weight: snapWeight(family, Math.max(600, s.weight)), italic: false, size: fs }, tracking: 0, fill: solid(fgColor), dir: textDir(s) });
    nodes.push(...place(t, (size - t.w) / 2, (size - t.h) / 2));
  }
  return { w: size, h: size, nodes, pad: 0, effects: {} };
}

/** Distinct fonts a layout draws (to load before measuring / embed in an export). */
export function fontsIn(l: Layout): TextFont[] {
  const seen = new Map<string, TextFont>();
  for (const n of l.nodes) if (n.k === 'text') seen.set(`${n.f.family}|${n.f.weight}|${n.f.italic}`, n.f);
  return [...seen.values()];
}
export const textsIn = (l: Layout, family: string) => l.nodes.filter((n): n is Extract<Node, { k: 'text' }> => n.k === 'text' && n.f.family === family).map((n) => n.text).join('');
export { ratio };
