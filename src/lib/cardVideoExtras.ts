/**
 * Canvas drawing of the transition EXTRAS (the small animated elements riding a transition) for the pre-rendered card videos.
 * It mirrors components/toolcard/RevealStack.tsx element by element, from the same pure maths in lib/toolCardFx.ts (container transform,
 * `extraRamp`, `badgeAt`), so a video shows exactly what the live engine shows: edge line, knob, glow, colour bar, shine, sparkles, doors,
 * zoom frame, iris ring, flash, the ribbon and the Creative pieces (dots, rings, diamonds, plus signs, bars, triangles). Extras of a frame are drawn over the transition window, like the live z-order.
 */
import { FX, FX_FADE, MIN_SCALE, circleDiameter, decoAt, decoColor, decoCount, ease, extraRamp, layerFrame, makeCfg, originPx, withAlpha, wipePivot, wipeR, type Cfg, type Deco, type Extra, type FxDef } from './toolCardFx';
import { barAlpha, barSegments, followDeco, gradPoints, mixHex, overrideFor, paintColors, pieceColor, pieceShape, pieceSize, studioHasExtras, studioPiece, studioPieceCount, tintAlpha, tintColors, type PieceShape, type StudioBar, type StudioStyle } from './fxStudio';

const WHITE = '#FFFFFF';
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Rect / circle growth at progress p (same formula as the engine's `grow`). */
function grow(cfg: Cfg, p: number) {
  const e = clamp01(ease(cfg.e, p, cfg.ep));
  return { e, s: MIN_SCALE + (1 - MIN_SCALE) * e };
}

/** A 5-point star centred on (0,0), like the "star" icon glyph of the sparkle extra. */
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

/** One Creative shape centred on (0,0): the canvas twin of `Shape` in RevealStack (same sizes and proportions). */
function drawShape(ctx: CanvasRenderingContext2D, shape: Deco['shape'] | PieceShape, size: number, color: string) {
  const t = Math.max(2, Math.round(size / 7));
  ctx.fillStyle = color; ctx.strokeStyle = color;
  const g = (size * 1.15) / 2; // the studio's glyph shapes are drawn from the icon font live (1.15 x the size box)
  const poly = (pts: number[][]) => { ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x * g, y * g) : ctx.moveTo(x * g, y * g))); ctx.closePath(); ctx.fill(); };
  if (shape === 'star') star(ctx, g * 0.95, color);
  else if (shape === 'spark') { const pts: number[][] = []; for (let k = 0; k < 8; k++) { const r = k % 2 ? 0.2 : 0.95, a = -Math.PI / 2 + (k * Math.PI) / 4; pts.push([Math.cos(a) * r, Math.sin(a) * r]); } poly(pts); }
  else if (shape === 'heart') {
    ctx.beginPath(); ctx.moveTo(0, g * 0.9);
    ctx.bezierCurveTo(-g * 1.25, g * 0.05, -g * 0.85, -g * 0.85, 0, -g * 0.3);
    ctx.bezierCurveTo(g * 0.85, -g * 0.85, g * 1.25, g * 0.05, 0, g * 0.9);
    ctx.fill();
  } else if (shape === 'hex') poly(Array.from({ length: 6 }, (_, k) => [Math.cos(-Math.PI / 2 + (k * Math.PI) / 3) * 0.95, Math.sin(-Math.PI / 2 + (k * Math.PI) / 3) * 0.95]));
  else if (shape === 'bolt') poly([[0.2, -1], [-0.6, 0.1], [-0.05, 0.1], [-0.25, 1], [0.6, -0.25], [0.05, -0.25]]);
  else if (shape === 'moon') {
    const r = g * 0.9;
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.rect(-2 * r, -2 * r, 4 * r, 4 * r); ctx.arc(r * 0.45, -r * 0.2, r * 0.8, 0, Math.PI * 2); ctx.fill('evenodd');
    ctx.restore();
  } else if (shape === 'ring') { ctx.lineWidth = t; ctx.beginPath(); ctx.arc(0, 0, size / 2 - t / 2, 0, Math.PI * 2); ctx.stroke(); }
  else if (shape === 'diamond') { const d = size * 0.72; ctx.rotate(Math.PI / 4); ctx.fillRect(-d / 2, -d / 2, d, d); }
  else if (shape === 'plus') { ctx.fillRect(-size / 2, -(t + 1) / 2, size, t + 1); ctx.fillRect(-(t + 1) / 2, -size / 2, t + 1, size); }
  else if (shape === 'bar') { const w = size * 0.34, h = size * 1.5; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, w / 2); ctx.fill(); }
  else if (shape === 'tri') { const w = size, h = size * 0.86; ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(0, 0, size / 2, 0, Math.PI * 2); ctx.fill(); }
}

/** The extras that ride the wipe edge (same container as the wipe window, pivot at the card centre). */
function drawWipeRider(ctx: CanvasRenderingContext2D, x: Extra, cfg: Cfg, W: number, H: number, u: number, accent: string) {
  const f = layerFrame(cfg, W, H, 1, ease(cfg.e, u, cfg.ep));
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
  if (x === 'ribbon') {
    ctx.fillStyle = WHITE; ctx.fillRect(-1, -L, 2, 2 * L);
    const g = ctx.createLinearGradient(-64, 0, 0, 0);
    g.addColorStop(0, withAlpha(accent, 0)); g.addColorStop(0.5, withAlpha(accent, 0.55)); g.addColorStop(1, WHITE);
    ctx.fillStyle = g; ctx.fillRect(-64, -L, 64, 2 * L);
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

/** The effect as the live card draws it with a style: the style's bar replaces the effect's own edge extra, its elements replace the effect's own pieces. */
export const effectiveDef = (def: FxDef, st: StudioStyle | null): FxDef => (st ? { ...def, extra: st.bar.mode === 'effect' ? def.extra : 'none', deco: st.els.mode === 'effect' ? def.deco : undefined } : def);

/** The window maths of transition number `cursor` of `effect`: the effect's own config, changed by the style's overrides (easing, direction, origin, photo zoom). */
export function cfgFor(effect: number, rtl: boolean, st: StudioStyle | null, cursor: number): { def: FxDef; cfg: Cfg } {
  const def = FX[effect] ?? FX[FX_FADE];
  return { def, cfg: makeCfg(def, rtl, st ? overrideFor(st, def, cursor) : null) };
}

/** Draws every extra of the transition (and the style's tint / bar / pieces) at progress `u` (0..1) over the already drawn frame. */
export function drawExtras(ctx: CanvasRenderingContext2D, def: FxDef, cfg: Cfg, W: number, H: number, u: number, accent: string, studio: StudioStyle | null = null) {
  if (studio && studioHasExtras(studio)) drawStudioUnder(ctx, studio, W, H, u);
  drawClassic(ctx, effectiveDef(def, studio), cfg, W, H, u, accent);
  if (studio && studioHasExtras(studio)) drawStudioOver(ctx, studio, def, cfg, W, H, u, accent);
}

function drawClassic(ctx: CanvasRenderingContext2D, def: FxDef, cfg: Cfg, W: number, H: number, u: number, accent: string) {
  const x = def.extra;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (x === 'line' || x === 'knob' || x === 'glow' || x === 'colorbar' || x === 'sparkle' || x === 'shine' || x === 'ribbon') drawWipeRider(ctx, x, cfg, W, H, u, accent);
  else if (x === 'doorsH' || x === 'doorsV') {
    const vertical = x === 'doorsV';
    const half = (vertical ? H : W) / 2;
    const { e, s } = grow(cfg, u);
    ctx.fillStyle = WHITE; ctx.globalAlpha = extraRamp(e);
    for (const sign of [-1, 1]) {
      const t = sign * s * half;
      if (vertical) ctx.fillRect(0, Math.round(H / 2) - 1 + t, W, 2); else ctx.fillRect(Math.round(W / 2) - 1 + t, 0, 2, H);
    }
  } else if (x === 'frame') {
    const { x: ox, y: oy } = originPx(cfg, W, H);
    const { e, s } = grow(cfg, u);
    ctx.globalAlpha = extraRamp(e);
    ctx.translate(ox, oy);
    if (cfg.k === 4) ctx.rotate((cfg.a0 * (1 - e) * Math.PI) / 180); // the frame turns with a spinning window
    ctx.scale(s, s); ctx.translate(-ox, -oy);
    ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, H - 2);
  } else if (x === 'ring') {
    const { x: ox, y: oy } = originPx(cfg, W, H);
    const D = circleDiameter(cfg, W, H);
    const { e, s } = grow(cfg, u);
    ctx.globalAlpha = extraRamp(e);
    ctx.translate(ox, oy); ctx.scale(s, s);
    ctx.strokeStyle = WHITE; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, D / 2 - 1, 0, Math.PI * 2); ctx.stroke();
  } else if (x === 'flash') {
    ctx.globalAlpha = 0.55 * Math.sin(Math.PI * clamp01(u));
    ctx.fillStyle = WHITE; ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
  // Creative pieces: positioned / scaled / turned by the same `decoAt` the live engine uses.
  const d = def.deco;
  if (!d) return;
  for (let i = 0, n = decoCount(def); i < n; i++) {
    const b = decoAt(d, cfg, W, H, u, i);
    if (b.o <= 0 || b.s <= 0) continue;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp01(b.o);
    ctx.translate(b.x, b.y); ctx.rotate((b.r * Math.PI) / 180); ctx.scale(b.s, b.s);
    drawShape(ctx, d.shape, d.size, decoColor(d, i, accent));
    ctx.restore();
  }
}


/* ------------------------------ Animation Studio layer (canvas twin of components/toolcard/StudioExtras.tsx) ------------------------------ */
/** A linear gradient over the box (x, y, w, h) for expo-linear-gradient style start / end points (fractions of the box). */
function boxGradient(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, g: { start: { x: number; y: number }; end: { x: number; y: number } }, c0: string, c1: string) {
  const grad = ctx.createLinearGradient(x + g.start.x * w, y + g.start.y * h, x + g.end.x * w, y + g.end.y * h);
  grad.addColorStop(0, c0); grad.addColorStop(1, c1);
  return grad;
}
const HORIZONTAL = { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } };

/** The colour wash: drawn under the transition's other extras. */
function drawStudioUnder(ctx: CanvasRenderingContext2D, st: StudioStyle, W: number, H: number, u: number) {
  if (!st.tint.on) return;
  const a = tintAlpha(st.tint, u);
  if (a <= 0) return;
  const cols = tintColors(st.tint);
  const g = gradPoints(st.tint.ang);
  const lg = ctx.createLinearGradient(g.start.x * W, g.start.y * H, g.end.x * W, g.end.y * H);
  cols.forEach((c, k) => lg.addColorStop(cols.length > 1 ? k / (cols.length - 1) : 0, c));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp01(a); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** A rounded rectangle path (radius clamped), or a plain rect. */
function boxPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r > 0 && w > 0 && h > 0) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else ctx.rect(x, y, w, h);
}

/** The bar that rides a wipe edge (the container's right edge is x = 0, the bar is centred on it, it spans the whole edge). */
function drawWipeBar(ctx: CanvasRenderingContext2D, bar: StudioBar, cfg: Cfg, W: number, H: number, u: number, accent: string) {
  const f = layerFrame(cfg, W, H, 1, ease(cfg.e, u, cfg.ep));
  const R = wipeR(W, H), len = 2 * R, size = bar.size;
  const { x: px, y: py } = wipePivot(W, H);
  const { a, b, grad } = paintColors(bar.paint, accent);
  const mid = grad ? mixHex(a, b, 0.5) : a;
  const radius = bar.round ? size / 2 : 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp01(barAlpha(bar, u));
  ctx.translate(px, py);
  for (const t of f.ct as Record<string, number | string>[]) {
    if ('rotate' in t) ctx.rotate((parseFloat(String(t.rotate)) * Math.PI) / 180);
    else if ('translateX' in t) ctx.translate(Number(t.translateX), 0);
  }
  const strip = (x: number, w: number, c0: string, c1: string) => { ctx.fillStyle = boxGradient(ctx, x, -R, w, len, HORIZONTAL, c0, c1); ctx.fillRect(x, -R, w, len); };
  const solid = (x: number, w: number) => {
    ctx.fillStyle = grad ? boxGradient(ctx, x, -R, w, len, gradPoints(bar.paint.ang), a, b) : a;
    boxPath(ctx, x, -R, w, len, radius); ctx.fill();
  };
  if (bar.trail > 0) { const c = bar.trailColor || mid; strip(-size / 2 - bar.trail, bar.trail, withAlpha(c, 0), withAlpha(c, 0.6)); }
  if (bar.glow > 0) { strip(-size / 2 - bar.glow, bar.glow, withAlpha(mid, 0), withAlpha(mid, 0.55)); strip(size / 2, bar.glow, withAlpha(mid, 0.55), withAlpha(mid, 0)); }
  if (bar.look === 'double') { const w = Math.max(1, Math.round(size / 3)); solid(-size / 2, w); solid(size / 2 - w, w); }
  else if (bar.look === 'dashed' || bar.look === 'dotted') {
    const segs = barSegments(bar.look, size, len);
    segs.forEach(([off, l], k) => {
      ctx.fillStyle = grad ? mixHex(a, b, segs.length > 1 ? k / (segs.length - 1) : 0) : a;
      boxPath(ctx, -size / 2, off, size, l, bar.look === 'dotted' ? size / 2 : radius); ctx.fill();
    });
  } else solid(-size / 2, size);
  ctx.restore();
}

/** The border lines of a box (frame) or a circle (ring): the canvas twin of `Lines`. `r` > 0 = rounded box, `circle` = a ring of diameter w. */
function drawLines(ctx: CanvasRenderingContext2D, bar: StudioBar, accent: string, x: number, y: number, w: number, h: number, r: number, circle: boolean) {
  const { a, b, grad } = paintColors(bar.paint, accent);
  const size = bar.size;
  const line = (inset: number, lw: number, c1: string, c2: string) => {
    ctx.lineWidth = lw;
    ctx.setLineDash(bar.look === 'dashed' ? [lw * 3, lw * 2] : bar.look === 'dotted' ? [lw, lw * 1.5] : []);
    ctx.lineCap = bar.look === 'dotted' ? 'round' : 'butt';
    ctx.strokeStyle = grad && r === 0 && bar.look !== 'dashed' && bar.look !== 'dotted' ? boxGradient(ctx, x, y, w, h, HORIZONTAL, c1, c2) : c1;
    const o = inset + lw / 2;
    if (circle) { ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, Math.max(0.5, w / 2 - o), 0, Math.PI * 2); ctx.stroke(); }
    else { boxPath(ctx, x + o, y + o, Math.max(0, w - 2 * o), Math.max(0, h - 2 * o), Math.max(0, r - inset)); ctx.stroke(); }
  };
  if (bar.look === 'double') { const lw = Math.max(1, Math.round(size / 3)); line(0, lw, a, b); line(size - lw, lw, b, a); return; }
  line(0, size, a, b);
  if (grad && r > 0) line(size * 1.7, Math.max(1, size * 0.7), b, a);
}

/** The Studio's bar (wipe bar, frame, ring) and pieces, drawn over the classic extras. */
function drawStudioOver(ctx: CanvasRenderingContext2D, st: StudioStyle, def: FxDef, cfg: Cfg, W: number, H: number, u: number, accent: string) {
  const bar = st.bar;
  if (bar.mode === 'custom') {
    if (cfg.k === 1) drawWipeBar(ctx, bar, cfg, W, H, u, accent);
    else if (cfg.k === 2 || cfg.k === 4 || cfg.k === 3) {
      const { x: ox, y: oy } = originPx(cfg, W, H);
      const { e, s } = grow(cfg, u);
      const alpha = clamp01(barAlpha(bar, u) * extraRamp(e));
      const { a, b, grad } = paintColors(bar.paint, accent);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
      if (bar.glow > 0) { ctx.shadowColor = grad ? mixHex(a, b, 0.5) : a; ctx.shadowBlur = bar.glow; }
      if (cfg.k === 3) {
        const d = circleDiameter(cfg, W, H) * s;
        drawLines(ctx, bar, accent, ox - d / 2, oy - d / 2, d, d, d, true);
      } else {
        ctx.translate(ox, oy);
        if (cfg.k === 4) ctx.rotate((cfg.a0 * (1 - e) * Math.PI) / 180);
        ctx.translate(-ox, -oy);
        const sx = cfg.ax ? s : 1, sy = cfg.ay ? s : 1;
        drawLines(ctx, bar, accent, ox - ox * sx, oy - oy * sy, W * sx, H * sy, bar.round ? Math.min(28, bar.size * 4 + 8) : 0, false);
      }
      ctx.restore();
    }
  }
  const e = st.els;
  for (let i = 0, n = studioPieceCount(st, def, cfg); i < n; i++) {
    const b = studioPiece(st, def, followDeco(e, def, st.seed, i), cfg, W, H, u, i);
    if (b.o <= 0 || b.s <= 0) continue;
    const color = pieceColor(e, i, accent);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = clamp01(b.o);
    if (e.glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = e.glow * b.s; }
    ctx.translate(b.x, b.y); ctx.rotate((b.r * Math.PI) / 180); ctx.scale(b.s, b.s);
    drawShape(ctx, pieceShape(e, i), pieceSize(e, st.seed, i), color);
    ctx.restore();
  }
}
