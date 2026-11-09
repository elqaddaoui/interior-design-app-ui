import type { LayoutDemoCfg, LayoutDevice, LayoutDevices, LayoutScreen, LayoutsConfig } from '@/data/types';

/**
 * Page layouts: the catalog of demo layouts for the two main screens and the rules that decide which one a device shows.
 * Pure (no React): `scripts/check-layouts.ts` checks it. The components that draw the demos are in components/layouts/.
 *
 *  - 8 demos for Home (tool cards) and 8 for Explore (inspiration categories): 4 classic patterns + 4 "wow" ones with motion and depth, each modelled
 *    on a layout used by well-known products (see docs/UI_LAYOUT_ANALYSIS.md). The wow ones stand still on a low-end device / reduce-motion.
 *  - Each demo can be limited to phones, computers or both (`devices`), switched off (`enabled`) and tuned (`gap`, `radius`, columns, heights).
 *  - Each screen picks one demo per device. A pick that is missing, switched off or not allowed on that device falls back to the screen's default
 *    (the classic layout), so the app can never end up without a layout.
 */
export type ParamKey = 'gap' | 'radius' | 'colsM' | 'colsD' | 'heightM' | 'heightD';
export interface ParamSpec { min: number; max: number; step: number; def: number }
export interface DemoDef {
  id: string;
  screen: LayoutScreen;
  icon: string;
  /** Products whose layout pattern inspired the demo (brand names are not translated). */
  refs: string[];
  /** The editable settings of this demo with their range and default. */
  params: Partial<Record<ParamKey, ParamSpec>>;
}

const gap = (def: number): ParamSpec => ({ min: 0, max: 32, step: 2, def });
const radius = (def: number): ParamSpec => ({ min: 0, max: 36, step: 2, def });

export const DEMOS: DemoDef[] = [
  // ---- Home
  { id: 'grid', screen: 'home', icon: 'view-grid-outline', refs: ['Airbnb', 'Stripe'], params: { gap: gap(16), colsM: { min: 1, max: 2, step: 1, def: 1 }, colsD: { min: 2, max: 4, step: 1, def: 3 } } },
  { id: 'hero', screen: 'home', icon: 'page-layout-header', refs: ['Apple', 'Spotify'], params: { gap: gap(12), radius: radius(20), colsM: { min: 1, max: 2, step: 1, def: 2 }, colsD: { min: 2, max: 4, step: 1, def: 3 }, heightM: { min: 200, max: 380, step: 10, def: 260 }, heightD: { min: 260, max: 520, step: 10, def: 380 } } },
  { id: 'bento', screen: 'home', icon: 'view-dashboard-variant-outline', refs: ['Apple', 'Linear', 'Vercel'], params: { gap: gap(12), radius: radius(24), heightM: { min: 160, max: 320, step: 10, def: 200 }, heightD: { min: 300, max: 560, step: 10, def: 420 } } },
  { id: 'rail', screen: 'home', icon: 'view-carousel-outline', refs: ['Netflix', 'Disney+'], params: { gap: gap(12), radius: radius(16), heightM: { min: 130, max: 300, step: 10, def: 170 }, heightD: { min: 170, max: 360, step: 10, def: 220 } } },
  { id: 'flow', screen: 'home', icon: 'rotate-3d-variant', refs: ['Apple Music', 'Cover Flow'], params: { radius: radius(24), heightM: { min: 260, max: 440, step: 10, def: 340 }, heightD: { min: 300, max: 520, step: 10, def: 420 } } },
  { id: 'stories', screen: 'home', icon: 'movie-open-outline', refs: ['Instagram', 'Snapchat'], params: { radius: radius(28), heightM: { min: 340, max: 600, step: 10, def: 440 }, heightD: { min: 380, max: 640, step: 10, def: 480 } } },
  { id: 'aurora', screen: 'home', icon: 'creation', refs: ['Apple Vision', 'Linear', 'Stripe'], params: { gap: gap(14), radius: radius(26), colsM: { min: 1, max: 2, step: 1, def: 2 }, colsD: { min: 2, max: 4, step: 1, def: 3 }, heightM: { min: 140, max: 300, step: 10, def: 190 }, heightD: { min: 180, max: 360, step: 10, def: 240 } } },
  { id: 'deck', screen: 'home', icon: 'cards-outline', refs: ['Tinder', 'Apple Wallet'], params: { radius: radius(28), heightM: { min: 300, max: 520, step: 10, def: 380 }, heightD: { min: 340, max: 560, step: 10, def: 420 } } },
  // ---- Explore
  { id: 'rails', screen: 'explore', icon: 'view-carousel-outline', refs: ['Netflix', 'Spotify'], params: {} },
  { id: 'mosaic', screen: 'explore', icon: 'view-quilt-outline', refs: ['Pinterest', 'Behance'], params: { gap: gap(10), radius: radius(18), colsM: { min: 2, max: 3, step: 1, def: 2 }, colsD: { min: 3, max: 6, step: 1, def: 4 } } },
  { id: 'editorial', screen: 'explore', icon: 'page-layout-body', refs: ['Medium', 'The Verge', 'Apple News'], params: { gap: gap(12), radius: radius(20), heightM: { min: 180, max: 360, step: 10, def: 240 }, heightD: { min: 280, max: 520, step: 10, def: 400 } } },
  { id: 'tiles', screen: 'explore', icon: 'view-grid-plus-outline', refs: ['Airbnb', 'Houzz'], params: { gap: gap(16), radius: radius(20), colsM: { min: 2, max: 3, step: 1, def: 2 }, colsD: { min: 3, max: 6, step: 1, def: 5 } } },
  { id: 'flow', screen: 'explore', icon: 'rotate-3d-variant', refs: ['Apple Music', 'Cover Flow'], params: { radius: radius(22), heightM: { min: 220, max: 400, step: 10, def: 280 }, heightD: { min: 260, max: 460, step: 10, def: 340 } } },
  { id: 'polaroid', screen: 'explore', icon: 'image-filter-frames', refs: ['Instagram', 'Pinterest boards'], params: { gap: gap(18), colsM: { min: 2, max: 3, step: 1, def: 2 }, colsD: { min: 3, max: 6, step: 1, def: 4 } } },
  { id: 'spotlight', screen: 'explore', icon: 'spotlight-beam', refs: ['Netflix', 'Apple TV+'], params: { radius: radius(28), heightM: { min: 240, max: 460, step: 10, def: 340 }, heightD: { min: 320, max: 600, step: 10, def: 460 } } },
  { id: 'accordion', screen: 'explore', icon: 'view-column-outline', refs: ['Awwwards', 'Apple'], params: { gap: gap(10), radius: radius(22), heightM: { min: 180, max: 360, step: 10, def: 230 }, heightD: { min: 280, max: 520, step: 10, def: 380 } } },
];

export const DEFAULT_DEMO: Record<LayoutScreen, string> = { home: 'grid', explore: 'rails' };
export const SCREENS: LayoutScreen[] = ['home', 'explore'];
export const DEVICES: LayoutDevice[] = ['mobile', 'desktop'];
export const demosOf = (screen: LayoutScreen) => DEMOS.filter((d) => d.screen === screen);
export const demoDef = (screen: LayoutScreen, id: string | undefined) => DEMOS.find((d) => d.screen === screen && d.id === id);
export const demoKey = (screen: LayoutScreen, id: string) => `${screen}.${id}`;
export const PARAM_KEYS: ParamKey[] = ['gap', 'radius', 'colsM', 'colsD', 'heightM', 'heightD'];

const clamp = (v: unknown, s: ParamSpec) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : s.def;
  return Math.min(s.max, Math.max(s.min, Math.round(n / s.step) * s.step));
};
export const normalizeDevices = (v: unknown): LayoutDevices => (v === 'mobile' || v === 'desktop' ? v : 'both');

/** The edits stored for a demo (empty when none). */
export const cfgOf = (cfg: LayoutsConfig | undefined, screen: LayoutScreen, id: string): LayoutDemoCfg => cfg?.demos?.[demoKey(screen, id)] ?? {};

/** The effective numbers of a demo: stored edits clamped to the demo's range, defaults for the rest (a setting a demo does not have is absent). */
export function paramsOf(cfg: LayoutsConfig | undefined, screen: LayoutScreen, id: string): Partial<Record<ParamKey, number>> {
  const def = demoDef(screen, id);
  const stored = cfgOf(cfg, screen, id);
  const out: Partial<Record<ParamKey, number>> = {};
  if (!def) return out;
  for (const k of PARAM_KEYS) { const spec = def.params[k]; if (spec) out[k] = clamp(stored[k], spec); }
  return out;
}

/** Can this demo be used on this device? Switched off or limited to the other device = no (the screen's default demo is always allowed). */
export function allowedOn(cfg: LayoutsConfig | undefined, screen: LayoutScreen, id: string, device: LayoutDevice): boolean {
  if (!demoDef(screen, id)) return false;
  if (id === DEFAULT_DEMO[screen]) return true;
  const c = cfgOf(cfg, screen, id);
  if (c.enabled === false) return false;
  const d = normalizeDevices(c.devices);
  return d === 'both' || d === device;
}

/** The demo a device really shows: the admin's pick when it exists and is allowed there, else the screen's default. */
export function resolveLayout(cfg: LayoutsConfig | undefined, screen: LayoutScreen, device: LayoutDevice): { id: string; params: Partial<Record<ParamKey, number>> } {
  const pick = cfg?.[screen]?.[device];
  const id = pick && allowedOn(cfg, screen, pick, device) ? pick : DEFAULT_DEMO[screen];
  return { id, params: paramsOf(cfg, screen, id) };
}

/** Number of columns for a device: phones use `colsM` (one more on a tablet), computers use `colsD`. */
export const columnsFor = (device: LayoutDevice, tablet: boolean, p: Partial<Record<ParamKey, number>>, fallbackM = 1, fallbackD = 3) =>
  device === 'desktop' ? (p.colsD ?? fallbackD) : tablet ? (p.colsM ?? fallbackM) + 1 : (p.colsM ?? fallbackM);

/** The device class of a screen width (same breakpoint as `useBp`: 1024 px and more = computer). */
export const deviceOf = (width: number): LayoutDevice => (width >= 1024 ? 'desktop' : 'mobile');
