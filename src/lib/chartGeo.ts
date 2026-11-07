/** Pure chart geometry (no React): scales, smooth curves, "nice" axis maxima. Unit-tested by `npm run check:dashboard`. */
export type Pt = [number, number];

/** Round `max` up to a readable axis top (1, 2, 5, 10, 20, 50 ...). */
export function niceMax(max: number): number {
  if (!(max > 0)) return 4;
  if (max <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (max <= m * p) return m * p;
  return 10 * p;
}
export const ticksFor = (top: number, n = 3): number[] => Array.from({ length: n + 1 }, (_, k) => Math.round((top / n) * k * 100) / 100);

/** Points of `values` inside a w x h box with `pad` around; x is evenly spread, y is 0..top (top = bottom of the box is 0). */
export function toPoints(values: number[], w: number, h: number, top: number, pad = { l: 0, r: 0, t: 0, b: 0 }): Pt[] {
  const iw = Math.max(1, w - pad.l - pad.r), ih = Math.max(1, h - pad.t - pad.b);
  const n = values.length;
  return values.map((v, i) => [pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw), pad.t + ih - (Math.min(v, top) / (top || 1)) * ih] as Pt);
}

const f = (n: number) => Math.round(n * 100) / 100;
/** Smooth path through the points (monotone-ish cubic: control points never overshoot the neighbouring y values). */
export function smoothPath(p: Pt[]): string {
  if (!p.length) return '';
  if (p.length === 1) return `M${f(p[0][0])},${f(p[0][1])}`;
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    const dx = (b[0] - a[0]) / 2.4;
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    const y1 = Math.min(hi, Math.max(lo, a[1])), y2 = Math.min(hi, Math.max(lo, b[1]));
    d += ` C${f(a[0] + dx)},${f(y1)} ${f(b[0] - dx)},${f(y2)} ${f(b[0])},${f(b[1])}`;
  }
  return d;
}
/** Closed area under a smooth line down to `baseline`. */
export function areaPath(p: Pt[], baseline: number): string {
  if (p.length < 2) return '';
  return `${smoothPath(p)} L${f(p[p.length - 1][0])},${f(baseline)} L${f(p[0][0])},${f(baseline)} Z`;
}
/** Compact number: 1 234 -> 1.2k. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${f(n / 1e6).toString().replace(/(\.\d)\d+/, '$1')}M`;
  if (a >= 1e3) return `${f(n / 1e3).toString().replace(/(\.\d)\d+/, '$1')}k`;
  return String(Math.round(n));
}
/** Segments of a donut as { from, len } fractions with a small gap; zero segments are dropped. */
export function donutArcs(values: number[], gap = 0.012): { i: number; from: number; len: number }[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const live = values.map((v, i) => ({ v, i })).filter((x) => x.v > 0);
  const g = live.length > 1 ? gap : 0;
  let acc = 0;
  return live.map(({ v, i }) => { const share = v / total; const out = { i, from: acc + g / 2, len: Math.max(0, share - g) }; acc += share; return out; });
}
