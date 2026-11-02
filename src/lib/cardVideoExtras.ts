/**
 * Canvas drawing of the transition EXTRAS (the small animated elements riding a transition) for the pre-rendered card videos.
 * It mirrors components/toolcard/RevealStack.tsx element by element, from the same pure maths in lib/toolCardFx.ts (container transform,
 * `extraRamp`, `badgeAt`), so a video shows exactly what the live engine shows: edge line, knob, glow, colour bar, shine, sparkles, doors,
 * zoom frame, iris ring, flash and the creative star badges. Extras of a frame are drawn over the transition window, like the live z-order.
 */
import { BADGE_D, FX, FX_FADE, MIN_SCALE, badgeAt, badgeCount, circleDiameter, ease, extraBase, extraRamp, layerFrame, makeCfg, originPx, wipePivot, wipeR, type Cfg, type Extra } from './toolCardFx';

const WHITE = '#FFFFFF';
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Rect / circle growth at progress p (same formula as the engine's `grow`). */
function grow(cfg: Cfg, p: number) {
  const e = clamp01(ease(cfg.e, p));
  return { e, s: MIN_SCALE + (1 - MIN_SCALE) * e };
}

/** A 5-point star centred on (0,0), like the "star" icon glyph of the live extras. */
function star(ctx: CanvasRenderingContext2D, outer: number, color: string) {
  const inner = outer * 0.42;
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? inner : outer;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    if (k) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** The extras that ride the wipe edge (same container as the wipe window, pivot at the card centre). */
function drawWipeRider(ctx: CanvasRenderingContext2D, x: Extra, cfg: Cfg, W: number, H: number, u: number, accent: string) {
  const f = layerFrame(cfg, W, H, 1, ease(cfg.e, u));
  const L = 2 * wipeR(W, H);
  const { x: px, y: py } = wipePivot(W, H);
  ctx.save();
  ctx.translate(px, py);
  for (const t of f.ct as Record<string, number | string>[]) {
    if ('rotate' in t) ctx.rotate((parseFloat(String(t.rotate)) * Math.PI) / 180);
    else if ('translateX' in t) ctx.translate(Number(t.translateX), 0);
  }
  // Local frame: the container's right edge is x = 0 (the pivot), it spans y = -L .. L.
  if (x === 'line' || x === 'knob' || x === 'sparkle') { ctx.fillStyle = WHITE; ctx.fillRect(-1, -L, 2, 2 * L); }
  if (x === 'knob') { ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fill(); }
  if (x === 'glow') {
    const g = ctx.createLinearGradient(-32, 0, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.85)');
    ctx.fillStyle = g; ctx.fillRect(-32, -L, 32, 2 * L);
  }
  if (x === 'colorbar') { ctx.fillStyle = accent; ctx.fillRect(-16, -L, 16, 2 * L); }
  if (x === 'shine') {
    ctx.save();
    ctx.transform(1, 0, Math.tan((-20 * Math.PI) / 180), 1, 0, 0);
    const g = ctx.createLinearGradient(-20, 0, 20, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(-20, -L, 40, 2 * L);
    ctx.restore();
  }
  if (x === 'sparkle') {
    ctx.globalAlpha = Math.sin(Math.PI * clamp01(u));
    for (const y of [-H * 0.3 + 7, 0, H * 0.3 - 7]) { ctx.save(); ctx.translate(0, y); star(ctx, 5.8, WHITE); ctx.restore(); }
  }
  ctx.restore();
}

/** Draws every extra of `effect` at progress `u` (0..1) over the already drawn frame. */
export function drawExtras(ctx: CanvasRenderingContext2D, effect: number, rtl: boolean, W: number, H: number, u: number, accent: string) {
  const def = FX[effect] ?? FX[FX_FADE];
  const cfg = makeCfg(def, rtl);
  const base = extraBase(def.extra);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (base === 'line' || base === 'knob' || base === 'glow' || base === 'colorbar' || base === 'sparkle' || base === 'shine') drawWipeRider(ctx, base, cfg, W, H, u, accent);
  else if (base === 'doorsH' || base === 'doorsV') {
    const vertical = base === 'doorsV';
    const half = (vertical ? H : W) / 2;
    const { e, s } = grow(cfg, u);
    ctx.fillStyle = WHITE; ctx.globalAlpha = extraRamp(e);
    for (const sign of [-1, 1]) {
      const t = sign * s * half;
      if (vertical) ctx.fillRect(0, Math.round(H / 2) - 1 + t, W, 2); else ctx.fillRect(Math.round(W / 2) - 1 + t, 0, 2, H);
    }
  } else if (base === 'frame') {
    const { x, y } = originPx(cfg, W, H);
    const { e, s } = grow(cfg, u);
    ctx.globalAlpha = extraRamp(e);
    ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y);
    ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
  } else if (base === 'ring') {
    const { x, y } = originPx(cfg, W, H);
    const D = circleDiameter(cfg, W, H);
    const { e, s } = grow(cfg, u);
    ctx.globalAlpha = extraRamp(e);
    ctx.translate(x, y); ctx.scale(s, s);
    ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, D / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  } else if (base === 'flash') {
    ctx.globalAlpha = 0.55 * Math.sin(Math.PI * clamp01(u));
    ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  // Creative star badges: a white disc with an accent star, positioned / scaled / turned by the same `badgeAt` the live engine uses.
  for (let i = 0, n = badgeCount(def.extra); i < n; i++) {
    const b = badgeAt(def.extra, cfg, W, H, u, i);
    if (b.o <= 0 || b.s <= 0) continue;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp01(b.o);
    ctx.translate(b.x, b.y); ctx.scale(b.s, b.s); ctx.rotate((b.r * Math.PI) / 180);
    ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(0, 0, BADGE_D / 2, 0, Math.PI * 2); ctx.fill();
    star(ctx, 8, accent);
    ctx.restore();
  }
}
