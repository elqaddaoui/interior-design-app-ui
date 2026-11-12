 
import { Platform, Share } from 'react-native';
import { appIconLayout, ctxFor, fontsIn, layoutLogo, textsIn, toSvg, type Ctx, type Layout } from './layout';
import { cssUrl } from './fontData';
import { loadFont } from './fonts';
import { measureNow } from './measure';
import type { LogoSpec } from './spec';

export const canExport = Platform.OS === 'web' && typeof document !== 'undefined';

const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
const toDataUrl = async (url: string) => blobToDataUrl(await (await fetch(url)).blob());

/** Loads the fonts a layout uses, then lays it out again with real metrics. */
export async function settle(build: () => Layout): Promise<Layout> {
  const first = build();
  await Promise.all(fontsIn(first).map((f) => loadFont(f.family, f.weight, f.italic)));
  return build();
}
export const logoLayout = (spec: LogoSpec, ctx: Ctx) => settle(() => layoutLogo(spec, measureNow(), ctx));

/** @font-face rules with the font files inlined (only the glyphs the logo uses), so the SVG renders anywhere. */
export async function embeddedFontCss(l: Layout): Promise<string> {
  const rules: string[] = [];
  const jobs = new Map<string, { family: string; italic: boolean; text: string }>();
  for (const f of fontsIn(l)) {
    const k = `${f.family}|${f.italic}`;
    jobs.set(k, { family: f.family, italic: f.italic, text: (jobs.get(k)?.text ?? '') + textsIn(l, f.family) });
  }
  await Promise.all([...jobs.values()].map(async (j) => {
    try {
      let css = await (await fetch(cssUrl(j.family, { italic: j.italic, text: [...new Set(j.text + ' ')].join('') }))).text();
      const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
      for (const u of new Set(urls)) css = css.split(u).join(await toDataUrl(u));
      rules.push(css);
    } catch { /* offline: the SVG keeps the family name; the font must be installed */ }
  }));
  return rules.join('\n');
}
/** Remote images become data URLs so a standalone SVG / PNG keeps them. */
export async function inlineImages(l: Layout): Promise<Layout> {
  const nodes = await Promise.all(l.nodes.map(async (n) => (n.k === 'image' && n.href && !n.href.startsWith('data:') ? { ...n, href: await toDataUrl(n.href).catch(() => n.href) } : n)));
  return { ...l, nodes };
}

export interface ExportOpts { mode: 'light' | 'dark'; transparent: boolean; accent: string }
export async function logoSvgFile(spec: LogoSpec, o: ExportOpts): Promise<{ svg: string; w: number; h: number }> {
  const ctx = ctxFor(o.mode, o.accent);
  const layout = await inlineImages(await logoLayout(spec, ctx));
  const embedCss = await embeddedFontCss(layout);
  const pad = Math.max(layout.pad, 8);
  const svg = toSvg(layout, { id: 'logo', pad, embedCss, background: o.transparent ? undefined : ctx.bg, title: spec.name });
  return { svg, w: layout.w + pad * 2, h: layout.h + pad * 2 };
}
export async function svgToPng(svg: string, w: number, h: number, scale: number): Promise<Blob> {
  const img = new Image();
  const loaded = new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('svg decode')); });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}
export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const slug = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'logo';
export async function exportLogo(spec: LogoSpec, o: ExportOpts & { format: 'svg' | 'png'; scale: number }) {
  const { svg, w, h } = await logoSvgFile(spec, o);
  const base = `${slug(spec.name)}-${o.mode}`;
  if (!canExport) { await Share.share({ message: svg }); return; }
  if (o.format === 'svg') download(new Blob([svg], { type: 'image/svg+xml' }), `${base}.svg`);
  else download(await svgToPng(svg, w, h, o.scale), `${base}@${o.scale}x.png`);
}
export async function appIconSvg(spec: LogoSpec, size: number, accent: string, fullBleed = false): Promise<string> {
  const ctx = ctxFor('light', accent);
  const layout = await inlineImages(await settle(() => appIconLayout(spec, measureNow(), ctx, size, fullBleed)));
  return toSvg(layout, { id: 'ai', pad: 0, embedCss: await embeddedFontCss(layout), title: spec.name });
}
export async function exportAppIcon(spec: LogoSpec, size: number, accent: string, format: 'png' | 'svg' = 'png') {
  const fullBleed = size === 180;
  const svg = await appIconSvg(spec, size, accent, fullBleed);
  if (format === 'svg') download(new Blob([svg], { type: 'image/svg+xml' }), `${slug(spec.name)}-icon.svg`);
  else download(await svgToPng(svg, size, size, 1), `${slug(spec.name)}-icon-${size}.png`);
}
/** PNG data URL of the favicon (stored on publish so every visitor gets it without computing anything). '' off the web. */
export async function faviconDataUrl(spec: LogoSpec, accent: string, size = 64): Promise<string> {
  if (!canExport) return '';
  try { return await blobToDataUrl(await svgToPng(await appIconSvg(spec, size, accent), size, size, 1)); } catch { return ''; }
}
export function applyFavicon(href: string) {
  if (!canExport || !href) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.type = 'image/png'; link.href = href;
  // iOS / Android home-screen icon follows the same artwork.
  let touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (!touch) { touch = document.createElement('link'); touch.rel = 'apple-touch-icon'; document.head.appendChild(touch); }
  touch.href = href;
}
/** A store's identity in the browser tab: its own favicon and name (the platform default stays when it has none). */
export function applyStoreIdentity(b: { appName?: string; favicon?: string }) {
  if (!canExport) return;
  const name = (b.appName ?? '').trim();
  if (name) {
    document.title = name;
    const t = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (t) t.content = name.slice(0, 12);
  }
  if (b.favicon) applyFavicon(b.favicon);
}
