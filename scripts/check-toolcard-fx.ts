/**
 * Maths checks of the reveal engine (`npm run check:toolcards`). No device needed: it composes the REAL container transform and the REAL inverse
 * photo transform produced by lib/toolCardFx.ts (same functions the worklets run) and proves, for every effect, in LTR and RTL, on several card
 * sizes and at many progress values, that
 *   1. a photo pixel lands exactly on the same card pixel at every frame (the photo never moves, only the clipping window does);
 *   2. at q = 1 the container covers the whole card (BACK fully covers FRONT, no seam / split frame), at q = 0 it shows nothing;
 *   3. the counter-scale never exceeds 5x; the effect resolution (disabled / low-end fallbacks) follows the rules.
 */
import { TIER_ORDER, tierState, toggleTier } from '../src/lib/toolCardFx';
import { SPEED_MAX, SPEED_MIN, HOLD_MAX, HOLD_MIN, FX, FX_FADE, FX_IDS, TIERS, DEFAULT_ENABLED, DEFAULT_LOW_END, cropToRatio, effectiveEffect, decoAt, decoCount, farCorners, hasExtras, layerFrame, layerGeometry, makeCfg, nearestSafe, resolveAvail, verdictOf, ease, type Cfg } from '../src/lib/toolCardFx';

import { planTimeline, frames, videoSize, videoSignature, videoStatus, shouldPlayVideo, VIDEO_QUALITIES, VIDEO_QUALITY_ORDER, VIDEO_QUALITY_DEFAULT, cleanVideoQuality, qualityPreset, cleanAdvanced, advancedKey, resolveRender, realWidth, estimateVideo, sharpestWidth, presetBitrate } from '../src/lib/cardVideoPlan';
import { fitSide, fallbackFormat, alreadyOptimized, isRasterToOptimize, dataUrlMime, PRESETS } from '../src/lib/imageOptimizeCore';
import { resolveFx, resolveGlobal, cleanFx, cardEffectList, effectiveStudio, patchGlobal, studioKeyOf } from '../src/lib/toolCards';
import { DEFAULT_STUDIO, PRESETS as STUDIO_PRESETS, LIBRARY, LIB_CATS, cleanSavedPresets, makeSavedPreset, activeStudio, cleanStudio, exportStudio, importStudio, isDefaultStudio, overrideFor, pieceAt, randomStudio, rnd, studioHasExtras, studioMoves, studioPiece, studioPieceCount, studioSig, followDeco, tintAlpha, barAlpha, barSegments, EASE_KEYS, type StudioStyle } from '../src/lib/fxStudio';
import { backMotion, frontMotion, motionTransform } from '../src/lib/toolCardFx';
import { EVIDENCE_TTL_MS, JANKY_AVG_MS, WARMUP_FRAMES, addOutcome, classifyDevice, judgeTransition, measuredVerdict, shouldRecord, type DeviceSignals, type Evidence } from '../src/lib/deviceTier';

/** Tiny strict assertions (the project has no Node typings, so `node:assert` is not imported). */
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fail = (msg: string): never => { throw new Error(msg); };
const assert = Object.assign(
  (ok: unknown, msg?: string) => { if (!ok) fail(msg ?? 'assertion failed'); },
  {
    equal: (a: unknown, b: unknown, msg?: string) => { if (a !== b) fail(msg ?? `expected ${String(b)}, got ${String(a)}`); },
    deepEqual: (a: unknown, b: unknown, msg?: string) => { if (!same(a, b)) fail(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  },
);

type M = [number, number, number, number, number, number]; // a b c d e f : x' = a x + c y + e ; y' = b x + d y + f
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const I: M = [1, 0, 0, 1, 0, 0];
const T = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const S = (x: number, y: number): M => [x, 0, 0, y, 0, 0];
const R = (deg: number): M => { const r = (deg * Math.PI) / 180; return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]; };
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/** CSS semantics: transform list applied left to right as a product, about the transform origin. */
function matrixOf(list: any[], ox: number, oy: number): M {
  let m = I;
  for (const t of list) {
    const k = Object.keys(t)[0]; const v = t[k];
    m = mul(m, k === 'rotate' ? R(parseFloat(v)) : k === 'translateX' ? T(v, 0) : k === 'translateY' ? T(0, v) : k === 'scaleX' ? S(v, 1) : S(1, v));
  }
  return mul(mul(T(ox, oy), m), T(-ox, -oy));
}
const origin = (style: any, w: number, h: number) => {
  const o = String(style.transformOrigin ?? '50% 50%').split(' ');
  const p = (s: string, total: number) => (s.endsWith('%') ? (parseFloat(s) / 100) * total : parseFloat(s));
  return { x: p(o[0], w), y: p(o[1], h) };
};

const SIZES = [[360, 220], [411, 182], [320, 140], [768, 420], [390, 260]] as const;
let checked = 0;
for (const [W, H] of SIZES) for (const pr of [1, 2, 2.75, 3]) for (const rtl of [false, true]) for (const id of [0, ...FX_IDS]) {
  const cfg: Cfg = makeCfg(FX[id], rtl);
  const geo = layerGeometry(cfg, W, H) as any;
  const bw = geo.box.width, bh = geo.box.height;
  const bo = origin(geo.box, bw, bh);
  const io = origin(geo.inner, W, H);
  for (let i = 0; i <= 40; i++) {
    const q = i / 40;
    const f = layerFrame(cfg, W, H, pr, ease(cfg.e, q, cfg.ep));
    const cm = matrixOf(f.ct as any[], bo.x, bo.y);
    const im = matrixOf(f.it as any[], io.x, io.y);
    // photo-local -> container-local -> (container transform) -> card
    const toContainer = T(geo.inner.left, geo.inner.top);
    const toCard = T(geo.box.left, geo.box.top);
    const total = mul(toCard, mul(cm, mul(toContainer, im)));
    for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2], [13.7, 91.3]]) {
      const r = apply(total, px, py);
      assert(Math.abs(r.x - px) < 1e-6 && Math.abs(r.y - py) < 1e-6, `fx ${id} ${W}x${H} rtl=${rtl} q=${q}: photo moved (${px},${py}) -> (${r.x.toFixed(4)},${r.y.toFixed(4)})`);
    }
    // counter-scale limit
    for (const t of f.it as any[]) for (const k of ['scaleX', 'scaleY']) if (k in t) assert(t[k] <= 5.0000001, `fx ${id}: counter-scale ${t[k]} > 5`);
    checked++;
  }
  // FULL state covers the whole card; START state is invisible.
  const full = layerFrame(cfg, W, H, pr, 1), start = layerFrame(cfg, W, H, pr, 0);
  assert.equal(full.o, 1, `fx ${id}: FULL must be opaque`);
  // Wipes hide by geometry (window parked off the card, checked below); fade / rect / circle hide by opacity.
  if (cfg.k !== 1) assert.equal(start.o, 0, `fx ${id}: START must be invisible`);
  const cm = matrixOf(full.ct as any[], bo.x, bo.y);
  // The container, mapped to the card, must contain every card corner (with the 2px overscan for rects).
  const inv = (m: M, x: number, y: number) => { const det = m[0] * m[3] - m[1] * m[2]; const dx = x - m[4], dy = y - m[5]; return { x: (m[3] * dx - m[2] * dy) / det, y: (-m[1] * dx + m[0] * dy) / det }; };
  const toCardM = mul(T(geo.box.left, geo.box.top), cm);
  const cx = (x: number, y: number) => inv(toCardM, x, y);
  const bounds = (x: number, y: number) => { const p = cx(x, y); return p.x >= -1e-6 && p.x <= bw + 1e-6 && p.y >= -1e-6 && p.y <= bh + 1e-6 && (cfg.k !== 3 || Math.hypot(p.x - bw / 2, p.y - bh / 2) <= bw / 2 + 1e-6); };
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) assert(bounds(x, y), `fx ${id} ${W}x${H} rtl=${rtl}: FULL does not cover corner (${x},${y})`);
  // START: no card corner may be inside the window (nothing shows).
  const sm = mul(T(geo.box.left, geo.box.top), matrixOf(start.ct as any[], bo.x, bo.y));
  if (cfg.k === 1) for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) { const l = inv(sm, x, y); assert(!(l.x >= 0 && l.x <= bw && l.y >= 0 && l.y <= bh), `fx ${id} ${W}x${H} rtl=${rtl}: START shows corner (${x},${y})`); }
}
console.log(`photo stays pixel-aligned: ${checked} frames checked (${SIZES.length} sizes x 4 pixel ratios x LTR/RTL x 61 effects)`);

// Catalogue: tiers partition the 60 effects and match the specified defaults.
assert.deepEqual([...TIERS.safe, ...TIERS.medium, ...TIERS.heavy, ...TIERS.creative].sort((a, b) => a - b), FX_IDS);
assert.deepEqual(TIERS.safe, [1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 16, 17, 18]);
assert.deepEqual(TIERS.medium, [5, 6, 7, 12, 13, 19, 20, 21]);
assert.deepEqual(TIERS.heavy, [22, 23, 24, 25, 26, 27, 28, 29, 30]);
assert.deepEqual(TIERS.creative, Array.from({ length: 30 }, (_, i) => 31 + i));
assert.equal(FX_IDS.length, 60);
assert.deepEqual(DEFAULT_ENABLED, [...TIERS.safe, ...TIERS.medium].sort((a, b) => a - b));
assert.deepEqual(DEFAULT_LOW_END, [...TIERS.safe].sort((a, b) => a - b));
for (const [id, a] of [[1, 0], [2, 180], [3, 90], [4, -90], [5, 35], [6, -35], [7, 62], [8, 0], [9, 0], [10, 0], [11, 0], [12, 35], [13, 0], [14, 0], [15, 0]] as const) assert.equal(FX[id].angle, a, `fx ${id} angle`);
assert.equal(FX[13].swingFrom, 28); assert.equal(FX[14].ease, 'back'); assert.equal(FX[15].ease, 'expo');
assert.deepEqual([FX[16].sx, FX[16].sy, FX[17].sx, FX[17].sy], [true, false, false, true]);
assert.deepEqual([FX[20].ox, FX[20].oy, FX[21].ox, FX[21].oy], [0, 1, 1, 0]);
// Creative tier: 30 star-free effects. Every piece is a pure, finite function of p and is visible on the card for part of the transition.
const D_MARGIN = 40;
for (const id of TIERS.creative) {
  const def = FX[id]; assert.equal(def.tier, 'creative'); assert(hasExtras(def), `fx ${id} has extras`);
  assert(!def.deco || def.deco.n >= 1, `fx ${id} deco size`);
  for (const rtl of [false, true]) for (const [W, H] of [[360, 225], [320, 180], [600, 300]]) {
    const cfg = makeCfg(def, rtl);
    for (let i = 0; i < decoCount(def); i++) {
      let seen = 0;
      for (let k = 0; k <= 40; k++) {
        const p = k / 40, b = decoAt(def.deco!, cfg, W, H, p, i), b2 = decoAt(def.deco!, cfg, W, H, p, i);
        assert.deepEqual(b, b2, 'pure'); assert(Number.isFinite(b.x + b.y + b.s + b.r + b.o) && b.o >= 0 && b.o <= 1 && b.s >= 0, `fx ${id} piece finite`);
        if (b.o > 0.05 && b.s > 0.05 && b.x > -D_MARGIN && b.x < W + D_MARGIN && b.y > -D_MARGIN && b.y < H + D_MARGIN) seen++;
      }
      assert(seen >= 4, `fx ${id} ${W}x${H} rtl=${rtl} piece ${i} is visible on the card for part of the transition (${seen})`);
    }
  }
}
assert.equal(decoCount(FX[1]), 0); assert(!hasExtras(FX[0]));
assert.deepEqual(farCorners(1, 1, 0, 0), [3]); assert.deepEqual(farCorners(1, 1, 0.5, 0.5), [0, 1, 2, 3]); assert.deepEqual(farCorners(0, 1, 0.5, 1), [0, 1]);
// Spin: starts turned by `angle`, is exactly upright at the end; no spin / creative effect uses the old star badges.
for (const id of TIERS.creative) if (FX[id].kind === 'spin') {
  assert(typeof FX[id].angle === 'number' && FX[id].angle !== 0, `fx ${id} spins`);
  const c = makeCfg(FX[id], false), f0 = layerFrame(c, 360, 225, 2, 0), f1 = layerFrame(c, 360, 225, 2, 1);
  assert(JSON.stringify(f0.ct).includes('rotate') && !JSON.stringify(f1.ct).match(/"rotate":"-?[1-9]/), `fx ${id} spin ends upright`);
}
// Eases: exact ends, bounded overshoot.
for (let kind = 0; kind <= 5; kind++) {
  assert.equal(ease(kind, 0), 0); assert.equal(ease(kind, 1), 1);
  for (let k = 1; k < 100; k++) { const v = ease(kind, k / 100); assert(Number.isFinite(v) && v > -0.01 && v <= 1.45, `ease ${kind} @${k / 100} = ${v}`); }
}
console.log('creative tier: 30 star-free effects visible, finite and pure');
console.log('catalogue: 60 effects, tiers and defaults match the spec');

// RTL mirrors every horizontal direction.
assert.equal(makeCfg(FX[1], true).a1, 180); assert.equal(makeCfg(FX[2], true).a1, 0);
assert.equal(makeCfg(FX[3], true).a1, 90); assert.equal(makeCfg(FX[4], true).a1, 270, 'bottom-to-top stays bottom-to-top (270 = -90 mod 360)');
assert.equal(makeCfg(FX[5], true).a1, 145);
assert.equal(makeCfg(FX[20], true).ox, 1); assert.equal(makeCfg(FX[27], true).ox, 1); assert.equal(makeCfg(FX[13], false).a0, 28); assert.equal(makeCfg(FX[13], true).a0, 152);
console.log('rtl: angles and origins mirror');

// Availability rules.
const def = resolveAvail(undefined);
assert.equal(effectiveEffect(1, def, false), 1);
assert.equal(effectiveEffect(22, def, false), nearestSafe(22, def), 'heavy is disabled by default -> nearest enabled Safe');
assert.equal(effectiveEffect(5, def, true), FX_FADE, 'medium is not allowed on low-end -> cross-fade');
assert.equal(effectiveEffect(5, def, false), 5);
assert.equal(effectiveEffect(1, def, true), 1, 'safe is allowed on low-end');
const none = { enabled: new Set<number>(), lowEnd: new Set<number>() };
assert.equal(effectiveEffect(7, none, false), FX_FADE, 'nothing enabled -> cross-fade');
const only3 = { enabled: new Set([3]), lowEnd: new Set([3]) };
assert.equal(effectiveEffect(30, only3, false), 3); assert.equal(nearestSafe(29, only3), 3);
console.log('availability: fallbacks follow the rules');

// Easing endpoints (no jump at the start or the end of a reveal).
for (const k of [0, 1, 2]) { assert.equal(ease(k, 0), 0); assert.equal(ease(k, 1), 1); }
assert(ease(1, 0.7) > 1, 'easeOutBack overshoots');

// Verdicts and image crop.
assert.equal(verdictOf(16.7, 0), 'smooth'); assert.equal(verdictOf(24, 0.1), 'borderline'); assert.equal(verdictOf(40, 0.5), 'slow');
assert.deepEqual(cropToRatio(1000, 1000, 2), { originX: 0, originY: 250, width: 1000, height: 500 });
assert.deepEqual(cropToRatio(2000, 500, 1.5), { originX: 625, originY: 0, width: 750, height: 500 });
console.log('easing, verdicts and crop: ok');

// Pause may be 0, speed may not go under 0.2; stored garbage is clamped, never trusted.
assert.equal(HOLD_MIN, 0); assert.equal(SPEED_MIN, 0.2);
assert.equal(resolveFx({ hold: 0 }).hold, 0, 'a pause of 0 is kept (not replaced by the default)');
assert.equal(resolveFx({ hold: -4 }).hold, 0); assert.equal(resolveFx({ hold: 99 }).hold, HOLD_MAX);
assert.equal(resolveFx({ speed: 0 }).speed, SPEED_MIN); assert.equal(resolveFx({ speed: 0.2 }).speed, 0.2); assert.equal(resolveFx({ speed: 7 }).speed, SPEED_MAX);
assert.equal(resolveFx({ speed: 0.30000000000000004 }).speed, 0.3);
assert.equal(resolveFx({}).hold, 0.9); assert.equal(resolveFx({}).speed, 1); assert.equal(resolveFx({ pause: 0 }).hold, 0, 'the legacy pause key is read too');
assert.equal(resolveFx({ hold: Number.NaN }).hold, 0.9);
console.log('timing: pause min 0, speed min 0.2, clamped');

// Text placement is global: read from settings.toolCards, never from a card; a legacy per-card value is dropped.
assert.equal(resolveGlobal(undefined).textPlacement, 'inside'); assert.equal(resolveGlobal({ textPlacement: 'outside' }).textPlacement, 'outside');
assert.equal(resolveGlobal({ textPlacement: 'x' as never }).textPlacement, 'inside');
assert(!('textPlacement' in cleanFx({ textPlacement: 'outside', hold: 1 } as never)), 'per-card textPlacement is dropped');
assert.equal(('textPlacement' in resolveFx({ textPlacement: 'outside' } as never)), false);
console.log('layout: text placement is global');

// Device classification.
const GB = 1024 ** 3;
const sig = (o: Partial<DeviceSignals>): DeviceSignals => ({ platform: 'android', memoryBytes: 8 * GB, cores: null, apiLevel: 34, is64bit: true, reducedMotion: false, saveData: false, ...o });
const cls = (o: Partial<DeviceSignals>, m: 'janky' | 'smooth' | 'unknown' = 'unknown') => classifyDevice(sig(o), m);
assert.equal(cls({}).low, false, 'a modern Android phone is NOT low-end (the old year-class rule said it was)');
assert.equal(cls({ memoryBytes: 6 * GB, apiLevel: 33 }).low, false);
assert.equal(cls({ memoryBytes: 3.7 * GB, apiLevel: 33 }).low, false, 'a 4 GB phone (reports ~3.7 GB) is a normal phone');
assert.equal(cls({ memoryBytes: 2.8 * GB, apiLevel: 33 }).low, true, '3 GB phone: probation');
assert.equal(cls({ memoryBytes: 2.8 * GB, apiLevel: 33 }, 'smooth').low, false, '... until it proves smooth');
assert.equal(cls({ memoryBytes: 1.8 * GB }, 'smooth').low, true, '2 GB phone stays low whatever is measured');
assert.equal(cls({ memoryBytes: 1.8 * GB }).fixed, true);
assert.equal(cls({ is64bit: false }).low, true); assert.equal(cls({ is64bit: false }, 'smooth').low, false);
assert.equal(cls({ apiLevel: 26 }).low, true);
assert.equal(cls({ reducedMotion: true }, 'smooth').low, true); assert.equal(cls({ reducedMotion: true }).reason, 'reduceMotion');
assert.equal(cls({ saveData: true }).reason, 'saveData');
assert.equal(cls({}, 'janky').low, true); assert.equal(cls({}, 'janky').reason, 'measured');
assert.equal(cls({ platform: 'ios', memoryBytes: 4 * GB, is64bit: true, apiLevel: null }).low, false);
assert.equal(cls({ platform: 'web', memoryBytes: 8 * GB, cores: 8, apiLevel: null, is64bit: null }).low, false);
assert.equal(cls({ platform: 'web', memoryBytes: null, cores: null, apiLevel: null, is64bit: null }).low, false, 'a browser that hides its specs is not condemned');
assert.equal(cls({ platform: 'web', memoryBytes: 2 * GB, cores: 4, apiLevel: null, is64bit: null }).low, true);
assert.equal(cls({ platform: 'web', memoryBytes: 8 * GB, cores: 2, apiLevel: null, is64bit: null }).low, true);
assert.equal(shouldRecord(cls({})), true); assert.equal(shouldRecord(cls({ reducedMotion: true })), false); assert.equal(shouldRecord(cls({}, 'janky')), false);

// Evidence: one bad transition never decides; several do; it expires.
const T0 = 1_000_000_000_000;
const stat = (avg: number, slow = 0, frames = 40) => ({ frames, sumMs: avg * frames, dropped: slow, slow });
assert.equal(judgeTransition(stat(16.7)), 'smooth'); assert.equal(judgeTransition(stat(8.3)), 'smooth', '120 Hz screen');
assert.equal(judgeTransition(stat(JANKY_AVG_MS + 5)), 'janky'); assert.equal(judgeTransition(stat(16.7, 10)), 'janky', '25% slow frames');
assert.equal(judgeTransition(stat(16.7, 2)), 'smooth', 'a couple of slow frames in 40 are fine');
assert.equal(judgeTransition(stat(90, 5, 3)), 'skip', 'too few frames to judge');
assert(WARMUP_FRAMES >= 3);
let ev: Evidence | null = null;
ev = addOutcome(ev, 'janky', T0); assert.equal(measuredVerdict(ev, T0), 'unknown', 'one hiccup (cold start) is not a verdict');
ev = addOutcome(ev, 'janky', T0); assert.equal(measuredVerdict(ev, T0), 'unknown');
ev = addOutcome(ev, 'janky', T0); assert.equal(measuredVerdict(ev, T0), 'janky', 'three janky transitions demote');
ev = addOutcome(ev, 'skip', T0); assert.deepEqual(ev?.runs, [true, true, true]);
let good: Evidence | null = null;
for (let i = 0; i < 3; i++) good = addOutcome(good, 'smooth', T0); assert.equal(measuredVerdict(good, T0), 'unknown');
good = addOutcome(good, 'smooth', T0); assert.equal(measuredVerdict(good, T0), 'smooth', 'four smooth transitions promote');
good = addOutcome(good, 'janky', T0); assert.equal(measuredVerdict(good, T0), 'smooth', 'one stumble after four good ones changes nothing');
assert.equal(measuredVerdict(ev, T0 + EVIDENCE_TTL_MS + 1), 'unknown', 'evidence expires after a week');
assert.equal(measuredVerdict(ev, T0 - 3_600_000), 'unknown', 'a clock that went backwards invalidates it');
assert.deepEqual(addOutcome(ev, 'smooth', T0 + EVIDENCE_TTL_MS + 5)?.runs, [false], 'expired evidence starts over');
console.log('device: hardware, preference and measurement rules ok');

// ---------------------------------------------------------------- tier checkboxes (Admin > Tools > availability)
{
  const base = resolveAvail(undefined);
  assert.equal(tierState('safe', base), 'all'); assert.equal(tierState('medium', base), 'all'); assert.equal(tierState('heavy', base), 'none');
  const heavyOn = toggleTier('heavy', base);
  assert.equal(tierState('heavy', heavyOn), 'all', 'none -> all on');
  assert.equal(tierState('safe', heavyOn), 'all', 'other tiers untouched');
  const heavyOff = toggleTier('heavy', heavyOn);
  assert.equal(tierState('heavy', heavyOff), 'none', 'all -> all off');
  const some = { enabled: new Set(base.enabled), lowEnd: new Set(base.lowEnd) }; some.enabled.delete(TIERS.medium[0]);
  assert.equal(tierState('medium', some), 'some'); assert.equal(tierState('medium', toggleTier('medium', some)), 'all', 'some -> all on');
  const off = toggleTier('safe', base);
  assert(TIERS.safe.every((id) => !off.lowEnd.has(id)), 'switching a tier off removes its low-end permission');
  assert.equal(TIER_ORDER.length, 4); assert.equal(tierState('creative', base), 'none', 'creative is off by default');
  console.log('tiers: tri-state checkbox rules ok');
}

// ---------------------------------------------------------------- pre-rendered card video
{
  const effects = [1, 5, 22];
  const plan = planTimeline(3, effects, 0.9, 1);
  assert.equal(plan.segments.length, 6, 'hold + transition per picture');
  assert.equal(plan.segments[plan.segments.length - 1].to, 0, 'the loop ends on picture 0 (seamless)');
  assert.equal(plan.segments[0].kind, 'hold'); assert.equal(plan.segments[0].from, 0, 'starts on a hold of picture 0');
  assert.deepEqual(plan.segments.filter((x) => x.kind === 'transition').map((x) => x.effect), effects, 'one effect per picture, in order');
  const all = [...frames(plan)];
  assert.equal(all.length, plan.frames);
  const last = all[all.length - 1];
  assert(last.seg.kind === 'transition' && last.u === 1, 'the last frame is the new picture exactly');
  assert(all.every((f, i) => i === 0 || f.t >= all[i - 1].t), 'timestamps never go backwards');
  assert(Math.abs(last.t + last.dur - plan.duration) < 1e-6, 'frames fill the whole duration');
  assert.equal(planTimeline(1, effects, 0.9, 1).frames, 0, 'one picture cannot animate'); assert.equal(planTimeline(3, [], 0.9, 1).frames, 0);
  assert.equal(planTimeline(2, [1], 0, 1).segments.every((x) => x.kind === 'transition'), true, 'hold 0 = no hold segments');
  for (const r of [0.4, 1, 1.6, 2.2, 9, NaN]) { const v = videoSize(r); assert(v.width % 2 === 0 && v.height % 2 === 0, `even size for ${r}`); }
  const sig = videoSignature(['a', 'b'], [1, 2], 0.9, 1);
  assert.equal(sig, videoSignature(['a', 'b'], [1, 2], 0.9, 1)); 
  for (const other of [videoSignature(['b', 'a'], [1, 2], 0.9, 1), videoSignature(['a', 'b'], [1, 3], 0.9, 1), videoSignature(['a', 'b'], [1, 2], 1.0, 1), videoSignature(['a', 'b'], [1, 2], 0.9, 1.5)]) assert(other !== sig, 'any change outdates the video');
  // Quality presets: monotonic size / fps, valid even sizes, default keeps the old signature, any other quality outdates the video.
  assert.deepEqual(VIDEO_QUALITY_ORDER, ['low', 'balanced', 'high', 'ultra', 'best']); assert.equal(VIDEO_QUALITY_DEFAULT, 'balanced');
  for (let k = 1; k < VIDEO_QUALITY_ORDER.length - 1; k++) assert(VIDEO_QUALITIES[VIDEO_QUALITY_ORDER[k]].maxWidth > VIDEO_QUALITIES[VIDEO_QUALITY_ORDER[k - 1]].maxWidth, 'width grows with quality');
  assert.equal(cleanVideoQuality('nope'), 'balanced'); assert.equal(cleanVideoQuality(undefined), 'balanced'); assert.equal(cleanVideoQuality('ultra'), 'ultra'); assert.equal(cleanVideoQuality('__proto__'), 'balanced');
  assert.equal(resolveGlobal({ videoQuality: 'high' } as any).videoQuality, 'high'); assert.equal(resolveGlobal(undefined).videoQuality, 'balanced'); assert.equal(resolveGlobal({ videoQuality: 'x' } as any).videoQuality, 'balanced');
  for (const q of VIDEO_QUALITY_ORDER) { const v = videoSize(1.6, qualityPreset(q).maxWidth); assert(v.width === qualityPreset(q).maxWidth && v.height % 2 === 0, `size ${q}`); }
  assert.equal(videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'balanced'), sig, 'default quality keeps the old signature');
  const qs = VIDEO_QUALITY_ORDER.map((q) => videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, q)); assert.equal(new Set(qs).size, 5, 'each quality has its own signature');
  { const lo = planTimeline(3, [1, 2], 0.9, 1, 24), hi = planTimeline(3, [1, 2], 0.9, 1, 60);
    assert.equal(lo.fps, 24); assert.equal(hi.fps, 60); assert(hi.frames > lo.frames, 'more fps = more frames');
    assert(Math.abs(lo.duration - hi.duration) < 0.05, `the loop lasts the same whatever the fps (${lo.duration} vs ${hi.duration})`);
    const last = [...frames(hi)].pop()!; assert.equal(last.u, 1, 'last frame is the new picture at 60 fps');
    assert.equal(planTimeline(3, [1], 0.9, 1, NaN).fps, 30, 'bad fps falls back to 30'); }
  assert(videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, true) !== sig, 'turning the extras option on outdates the video'); assert.equal(videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false), sig, 'extras off keeps the old signature');
  assert.equal(resolveGlobal(undefined).videoExtras, false); assert.equal(resolveGlobal({ videoExtras: true }).videoExtras, true);
  assert.equal(videoStatus(undefined, undefined, sig), 'none'); assert.equal(videoStatus('v', sig, sig), 'ready'); assert.equal(videoStatus('v', 'x', sig), 'outdated');
  assert.equal(shouldPlayVideo('lowEnd', true, true), true); assert.equal(shouldPlayVideo('lowEnd', false, true), false, 'high-end keeps the live animation');
  assert.equal(shouldPlayVideo('always', false, true), true); assert.equal(shouldPlayVideo('off', true, true), false); assert.equal(shouldPlayVideo('always', true, false), false, 'no valid video: live engine');
  assert.equal(resolveGlobal(undefined).videoMode, 'lowEnd'); assert.equal(resolveGlobal({ videoMode: 'always' }).videoMode, 'always'); assert.equal(resolveGlobal({ videoMode: 'nope' as never }).videoMode, 'lowEnd');
  console.log('video: timeline, loop, signature and playback rules ok');
}

// ---------------------------------------------------------------- Best quality, advanced render settings, size estimate
{
  const best = qualityPreset('best');
  assert.equal(best.fps, 50, 'best = 50 fps'); assert.equal(best.real, true, 'best uses the real card size'); assert.deepEqual(best.fit, [1, 1.5], 'best fits 1 - 1.5 MB'); assert.equal(best.bitrate, 'very-high');
  assert.equal(cleanVideoQuality('best'), 'best');
  assert.equal(realWidth(360, 3), 1080, 'real card width = 360 css px x 3'); assert.equal(realWidth(100, 1), 240); assert.equal(realWidth(720, 4), 1920);
  const rs = resolveRender('best', {}, 1.6);
  assert.equal(rs.width, 1080); assert.equal(rs.fps, 50); assert.equal(rs.fit, true); assert.equal(rs.minMB, 1); assert.equal(rs.maxMB, 1.5); assert.equal(rs.real, true); assert(rs.width % 2 === 0 && rs.height % 2 === 0);
  const bal = resolveRender('balanced', {}, 1.6); assert.equal(bal.fit, false); assert.equal(bal.width, 720); assert.equal(bal.fps, 30); assert.equal(bal.real, false);
  // Overrides win over the preset, and only the touched keys are stored.
  assert.deepEqual(cleanAdvanced({}), {}); assert.deepEqual(cleanAdvanced(null), {}); assert.deepEqual(cleanAdvanced({ junk: 1, fps: 'x' }), {}, 'unknown / bad keys are dropped');
  assert.equal(cleanAdvanced({ fps: 500 }).fps, 60, 'fps is clamped'); assert.equal(cleanAdvanced({ maxMB: 99 }).maxMB, 8); assert.equal(cleanAdvanced({ codec: 'nope' }).codec, undefined); assert.equal(cleanAdvanced({ codec: 'vp9' }).codec, 'vp9');
  assert.equal(cleanAdvanced({ width: 0 }).width, 0, 'width 0 = real card size'); assert.equal(cleanAdvanced({ width: 801 }).width! % 2, 0);
  assert.equal(resolveRender('best', { fps: 40, maxMB: 1.2 }, 1.6).fps, 40); assert.equal(resolveRender('best', { fps: 40, maxMB: 1.2 }, 1.6).maxMB, 1.2);
  assert.equal(resolveRender('best', { minMB: 3, maxMB: 2 }, 1.6).minMB, 2, 'min never exceeds max');
  assert.equal(resolveRender('balanced', { width: 0 }, 1.6).width, 1080, 'any quality can use the real size'); assert.equal(resolveRender('best', { width: 640 }, 1.6).width, 640);
  assert.equal(resolveRender('balanced', { fit: true }, 1.6).fit, true); assert.equal(resolveRender('best', { fit: false, kbps: 3000 }, 1.6).bitrate, 3_000_000); assert.equal(resolveRender('best', { kbps: 3000 }, 1.6).bitrate, null, 'manual bitrate only without fit');
  assert.equal(advancedKey({}), ''); assert.equal(advancedKey(undefined), ''); assert.equal(advancedKey({ fps: 40, junk: 1 }), advancedKey({ fps: 40 })); assert(advancedKey({ fps: 40 }) !== advancedKey({ fps: 41 }));
  assert.equal(resolveGlobal({ videoAdv: { fps: 99 } as any }).videoAdv.fps, 60); assert.deepEqual(resolveGlobal(undefined).videoAdv, {});
  // Signature: no advanced settings keeps old videos valid; a change outdates them.
  const base = videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'best', '', '');
  assert.equal(videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'best'), base); assert(videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'best', '', advancedKey({ fps: 40 })) !== base);
  // The estimate.
  const e = estimateVideo(3, 0.9, 1, rs);
  assert.equal(e.mode, 'fit'); assert.equal(e.lowBytes, 1048576); assert.equal(e.highBytes, 1.5 * 1048576); assert(e.bytes >= e.lowBytes && e.bytes <= e.highBytes && e.withinMax, 'fit estimate lands inside the window');
  assert(e.seconds > 0 && e.frames === e.moveFrames + e.holdFrames && e.pictures === 3 && e.moveFrames > 0);
  assert(estimateVideo(6, 0.9, 1, rs).seconds > e.seconds, 'more pictures = longer loop'); assert(estimateVideo(3, 0.9, 1, rs).moveFrames === estimateVideo(3, 2, 1, rs).moveFrames, 'hold does not change moving frames');
  const p1 = estimateVideo(3, 0.9, 1, bal), p2 = estimateVideo(3, 0.9, 1, resolveRender('high', {}, 1.6)), p3 = estimateVideo(3, 0.9, 1, resolveRender('ultra', {}, 1.6));
  assert.equal(p1.mode, 'preset'); assert(p1.bytes < p2.bytes && p2.bytes < p3.bytes, 'preset sizes grow with quality');
  assert(estimateVideo(3, 0.9, 1, { ...bal, bitrate: 4_000_000 }).bytes > estimateVideo(3, 0.9, 1, { ...bal, bitrate: 1_000_000 }).bytes, 'manual bit rate drives the size'); assert.equal(estimateVideo(3, 0.9, 1, { ...bal, bitrate: 1_000_000 }).mode, 'manual');
  assert.equal(estimateVideo(1, 0.9, 1, rs).bytes, 0, 'one picture cannot animate: nothing to render');
  assert(presetBitrate('very-high', 1080, 675) > presetBitrate('medium', 1080, 675) && presetBitrate('very-high', 1080, 675, 'av1') < presetBitrate('very-high', 1080, 675), 'bitrate: quality up, better codec down');
  assert(sharpestWidth(3, 0.9, 1, rs, 1.6) >= 240 && sharpestWidth(3, 0.9, 1, rs, 1.6) <= 1920);
  assert(sharpestWidth(3, 0.9, 1, { ...rs, maxMB: 0.3, minMB: 0.2 }, 1.6) <= sharpestWidth(3, 0.9, 1, rs, 1.6), 'a smaller budget never allows a bigger picture');
  console.log('video: best quality, advanced settings and size estimate ok');
}

// ---------------------------------------------------------------- Animation Studio library + saved presets, instant first card
{
  assert.equal(LIB_CATS.length, 6); assert.equal(LIBRARY.length, 30, '30 ready-made looks');
  for (const c of LIB_CATS) assert.equal(LIBRARY.filter((p) => p.cat === c.key).length, 5, `5 looks in ${c.key}`);
  assert.equal(new Set(LIBRARY.map((p) => p.id)).size, 30, 'unique ids');
  for (const p of LIBRARY) {
    assert(Number.isInteger(p.fx) && p.fx >= 1 && p.fx <= 60 && FX[p.fx], `${p.id}: a real transition`); assert.equal(p.style.force, p.fx, `${p.id}: forces its transition`);
    const st = cleanStudio(p.style); assert.deepEqual(cleanStudio(st), st, `${p.id} is a valid style`); assert(!isDefaultStudio(st), `${p.id} does something`);
    assert(st.els.mode === 'off' || st.els.count <= 18, `${p.id} stays clean (few pieces)`);
  }
  assert(new Set(LIBRARY.map((p) => studioSig(p.style))).size >= 29, 'the looks are really different from each other');
  // Saved presets: sanitised on the way in and out, newest first, capped.
  const a = makeSavedPreset('  My look  ', 5, LIBRARY[0].style, 1000, 0.5), b = makeSavedPreset('Second', 9, LIBRARY[1].style, 2000, 0.25);
  assert.equal(a.name, 'My look'); assert.equal(a.fx, 5); assert(/^[A-Za-z0-9_-]{1,64}$/.test(a.id)); assert(a.id !== b.id);
  assert.deepEqual(cleanSavedPresets([a, b]).map((x) => x.name), ['Second', 'My look'], 'newest first');
  assert.deepEqual(cleanSavedPresets([a, a]).length, 1, 'duplicate ids dropped'); assert.deepEqual(cleanSavedPresets('x'), []); assert.deepEqual(cleanSavedPresets([{ id: 'x y', name: 'n', style: {} }, { id: 'ok', name: '   ', style: {} }, null, 5]), [], 'bad entries dropped');
  assert.equal(cleanSavedPresets([{ id: 'k', name: 'n', fx: 999, style: { junk: 1 }, at: 1 }])[0].fx, 0, 'bad fx falls back to 0');
  assert.equal(cleanSavedPresets(Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: `n${i}`, fx: 1, style: {}, at: i }))).length, 60, 'capped at 60');
  assert.equal(makeSavedPreset('x'.repeat(200), 1, DEFAULT_STUDIO, 1, 0).name.length, 60);
  // instantFirst defaults to ON, only an explicit false turns it off; it never touches the other settings.
  assert.equal(resolveGlobal(undefined).instantFirst, true); assert.equal(resolveGlobal({ instantFirst: false }).instantFirst, false); assert.equal(resolveGlobal({ instantFirst: true }).instantFirst, true);
  assert.equal(patchGlobal({ height: 300 }, { instantFirst: false }).height, 300);
  console.log('studio: 30-look library, saved presets and instant-first setting ok');
}

// ---------------------------------------------------------------- Animation Studio
{
  // New easings: exact ends, finite, plausible ranges; the named ones behave as documented.
  for (const [kind, ep] of [[6, [0.4, 0, 0.2, 1]], [6, [0.7, -0.6, 0.3, 1.6]], [7, [3, 3.6]], [7, [1, 1.5]], [7, [6, 8]], [8, undefined], [9, undefined], [10, [4]], [10, [16]]] as [number, number[] | undefined][]) {
    assert.equal(ease(kind, 0, ep), 0, `ease ${kind} start`); assert.equal(ease(kind, 1, ep), 1, `ease ${kind} end`);
    for (let k = 1; k < 100; k++) { const v = ease(kind, k / 100, ep); assert(Number.isFinite(v) && v > -1.1 && v < 2.1, `ease ${kind} ${JSON.stringify(ep)} @${k / 100} = ${v}`); }
  }
  assert(Math.abs(ease(8, 0.3) - 0.3) < 1e-12, 'linear is the identity');
  assert(ease(9, 0.15) < 0, 'anticipate dips below 0 before it goes');
  assert(Math.abs(ease(6, 0.5, [0.25, 0.25, 0.75, 0.75]) - 0.5) < 1e-3, 'a bezier on the diagonal is linear');
  { const st = [1, 2, 3, 4, 5, 6, 7].map((i) => ease(10, i / 8, [4])); assert(st.every((v) => [0.25, 0.5, 0.75, 1].includes(v)), 'steps(4) only takes 4 values'); }
  { let over = 0; for (let k = 1; k < 100; k++) over = Math.max(over, ease(7, k / 100, [3, 3.6])); assert(over > 1.05, 'a spring overshoots'); }

  // Cfg overrides: no override = the effect as it was; overrides replace only what they name.
  for (const id of FX_IDS) {
    for (const rtl of [false, true]) {
      const a = makeCfg(FX[id], rtl), b = makeCfg(FX[id], rtl, {});
      assert.deepEqual(a, b, `fx ${id}: an empty override changes nothing`);
      assert(a.zi === 0 && a.zo === 0 && a.pu === 0, `fx ${id}: no photo motion by default`);
    }
  }
  { const c = makeCfg(FX[1], false, { e: 6, ep: [0.1, 0.2, 0.3, 0.4], angle: 45, zi: 0.2, zo: 0.1, pu: 0.5 });
    assert.equal(c.e, 6); assert.deepEqual(c.ep, [0.1, 0.2, 0.3, 0.4]); assert.equal(c.a1, 45); assert(c.zi === 0.2 && c.zo === 0.1 && c.pu === 0.5); }
  // Photo motion: never below 1x (the photo always covers its window), identity at rest, the push never exceeds the covered part.
  for (const id of FX_IDS) {
    const c = makeCfg(FX[id], false, { zi: 0.4, zo: 0.3, pu: 1 });
    for (const [W, H] of [[360, 225], [720, 450], [300, 300]]) for (let k = 0; k <= 20; k++) {
      const q = k / 20, b = backMotion(c, q), f = frontMotion(c, W, H, q);
      assert(b.s >= 1 - 1e-9 && b.s <= 1.4 + 1e-9, `fx ${id} back zoom ${b.s}`); assert(f.s >= 1 - 1e-9 && f.s <= 1.3 + 1e-9, `fx ${id} front zoom ${f.s}`);
      assert(Number.isFinite(f.tx) && Number.isFinite(f.ty), `fx ${id} front push finite`);
      assert(Math.hypot(f.tx, f.ty) <= Math.abs(Math.cos((c.a1 * Math.PI) / 180)) * W + Math.abs(Math.sin((c.a1 * Math.PI) / 180)) * H + 1e-6, `fx ${id} push stays within the travel`);
    }
    const end = backMotion(c, 1); assert(end.s === 1 && end.tx === 0 && end.ty === 0, `fx ${id} back photo rests at 1x`);
    assert.deepEqual(motionTransform({ s: 1, tx: 0, ty: 0 }), [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }]);
  }

  // The style model: sanitiser (idempotent, never throws), default = plain, presets valid, random valid, export / import round trip.
  assert(isDefaultStudio(DEFAULT_STUDIO) && activeStudio(DEFAULT_STUDIO) === null, 'the default style is plain');
  assert.equal(studioSig(DEFAULT_STUDIO), ''); assert.equal(studioKeyOf({ studio: DEFAULT_STUDIO }), ''); assert.equal(studioKeyOf(undefined), '');
  for (const junk of [undefined, null, 1, 'x', [], {}, { bar: 5, els: [], tint: null, motion: 'zz', ease: 'nope', force: -3, seed: 'a' }, { els: { count: 9999, size: -5, palette: ['red', 12, '#fff'] }, bz: ['a', 99], steps: 1e9 }]) {
    const c = cleanStudio(junk); assert.deepEqual(cleanStudio(c), c, 'cleanStudio is idempotent');
    assert(c.v === 1 && c.els.count >= 1 && c.els.count <= 24 && c.bz[0] >= 0 && c.bz[0] <= 1 && c.steps >= 2 && c.steps <= 16 && c.force >= 0 && EASE_KEYS.includes(c.ease), 'cleanStudio clamps');
  }
  assert.equal(cleanStudio({ force: 12.5 }).force, 0, 'a non-integer force is dropped');
  assert(STUDIO_PRESETS.length >= 12, 'presets present');
  for (const pr of STUDIO_PRESETS) { const st = cleanStudio(pr.style); assert.deepEqual(cleanStudio(st), st, `preset ${pr.id} is valid`); assert(!isDefaultStudio(st), `preset ${pr.id} does something`); }
  for (let seed = 1; seed <= 40; seed++) { const r = randomStudio(seed); assert.deepEqual(cleanStudio(r), r, `random style ${seed} is valid`); assert.deepEqual(randomStudio(seed), r, 'random style is deterministic'); }
  for (const pr of STUDIO_PRESETS) { const st = cleanStudio(pr.style); assert.deepEqual(importStudio(exportStudio(st)), st, `export / import round trip ${pr.id}`); }
  assert.equal(importStudio('not json'), null); assert.equal(importStudio('[1]'), null);
  assert(studioSig(randomStudio(3)) !== studioSig(randomStudio(4)), 'different styles have different signatures'); assert.equal(studioSig(randomStudio(3)), studioSig(randomStudio(3)));
  assert(rnd(5, 9) === rnd(5, 9) && rnd(5, 9) >= 0 && rnd(5, 9) < 1 && rnd(5, 9) !== rnd(5, 10), 'rnd is deterministic in [0,1)');

  // overrideFor: only what the style asks for; `random` direction is deterministic and changes per transition.
  { const plain = cleanStudio({}); const o = overrideFor(plain, FX[1], 0); assert(o.angle === undefined && o.e === undefined && o.ox === undefined, 'a plain style overrides nothing');
    const alt = cleanStudio({ motion: { dir: 'alternate' } }); assert.equal(overrideFor(alt, FX[1], 1).angle, 180); assert.equal(overrideFor(alt, FX[1], 2).angle, 0);
    const ran = cleanStudio({ motion: { dir: 'random' }, seed: 7 }); assert.equal(overrideFor(ran, FX[1], 3).angle, overrideFor(ran, FX[1], 3).angle); assert(new Set([0, 1, 2, 3, 4, 5].map((i) => overrideFor(ran, FX[1], i).angle)).size > 2, 'random directions vary');
    assert.equal(overrideFor(cleanStudio({ ease: 'bezier', bz: [0.1, 0.2, 0.3, 0.4] }), FX[1], 0).e, 6); assert.equal(overrideFor(cleanStudio({ ease: 'linear' }), FX[1], 0).e, 8);
    const og = overrideFor(cleanStudio({ motion: { origin: true, ox: 0.2, oy: 0.8 } }), FX[20], 0); assert(og.ox === 0.2 && og.oy === 0.8);
    assert(studioMoves(alt) && !studioMoves(plain) && !studioHasExtras(plain) && studioHasExtras(cleanStudio({ tint: { on: true } }))); }

  // Pieces: finite and bounded for every motion x every effect x several sizes; opacity 0 at both ends (nothing pops); bar / tint ramps.
  for (const motion of ['follow', 'random', 'burst', 'rain', 'rise', 'drift', 'swirl', 'twinkle']) {
    const st = cleanStudio({ els: { mode: 'custom', motion, count: 12, shape: 'mixed', spin: 1 } });
    for (const id of FX_IDS) {
      const def = FX[id], cfg = makeCfg(def, false, overrideFor(st, def, 0));
      for (const [W, H] of [[360, 225], [720, 450]]) {
        const n = studioPieceCount(st, def, cfg); assert(n >= 1 && n <= 24, `fx ${id} ${motion} count ${n}`);
        for (let i = 0; i < n; i++) for (let k = 0; k <= 40; k++) {
          const b = studioPiece(st, def, followDeco(st.els, def, st.seed, i), cfg, W, H, k / 40, i);
          assert([b.x, b.y, b.s, b.o, b.r].every(Number.isFinite), `fx ${id} ${motion} piece ${i} finite @${k / 40}`);
          assert(b.o >= -1e-9 && b.o <= 1 + 1e-9 && b.s >= -1e-9 && b.s < 4, `fx ${id} ${motion} piece ${i} opacity / scale in range`);
          if (k === 0 || k === 40) assert(b.o <= 1e-9 || motion === 'follow', `fx ${id} ${motion} piece ${i} invisible at the ends (${b.o})`);
        }
      }
    }
  }
  { // burst pieces ride the visible part of an iris (the old ring maths put every piece outside the card)
    const st = cleanStudio({ els: { mode: 'custom', motion: 'burst', count: 18 } }), def = FX[23], cfg = makeCfg(def, false, null);
    let seen = 0; for (let k = 5; k <= 35; k++) for (let i = 0; i < 18; i++) { const b = studioPiece(st, def, followDeco(st.els, def, st.seed, i), cfg, 360, 225, k / 40, i); if (b.o > 0.2 && b.x > -20 && b.x < 380 && b.y > -20 && b.y < 245) seen++; }
    assert(seen > 40, `iris bursts are visible on the card (${seen})`); }
  { const tn = cleanStudio({ tint: { on: true, amount: 0.4, peak: 'mid' } }).tint; assert(tintAlpha(tn, 0) === 0 && tintAlpha(tn, 1) === 0 && Math.abs(tintAlpha(tn, 0.5) - 0.4) < 1e-9, 'tint blooms and fades');
    const br = cleanStudio({ bar: { fade: true, opacity: 0.8 } }).bar; assert(barAlpha(br, 0) === 0 && barAlpha(br, 1) === 0 && Math.abs(barAlpha(br, 0.5) - 0.8) < 1e-9, 'bar fades in and out');
    for (const look of ['dashed', 'dotted'] as const) for (const size of [1, 4, 40]) { const sg = barSegments(look, size, 600); assert(sg.length >= 1 && sg.length <= 48, `bar segments ${look} ${size}`); assert(sg[0][0] <= -280 && sg[sg.length - 1][0] + sg[sg.length - 1][1] >= 280, 'segments cover the bar'); }
    assert.equal(barSegments('solid', 4, 600).length, 0); }
  // pieceAt is pure (same inputs, same output).
  { const st = cleanStudio({ els: { mode: 'custom', motion: 'swirl' } }), cfg = makeCfg(FX[23], false); assert.deepEqual(pieceAt(st.els, 3, cfg, 360, 225, 0.4, 2), pieceAt(st.els, 3, cfg, 360, 225, 0.4, 2)); }

  // Settings plumbing: force replaces the list, a plain style changes nothing, patchGlobal never drops keys, effective style = own > global.
  { const fx = resolveFx(undefined);
    const av = resolveAvail(undefined), base = cardEffectList(fx, av, false);
    assert.deepEqual(cardEffectList(fx, av, false, null), base); assert.deepEqual(cardEffectList(fx, av, false, cleanStudio({})), base);
    assert.deepEqual(cardEffectList(fx, av, false, cleanStudio({ force: 5 })), [5], 'force = one transition on every card'); }
  { const stored = { height: 200, textZone: 'top' as const, studio: cleanStudio({ force: 3 }), enabled: [1, 2] } as never; const out = patchGlobal(stored, { videoMode: 'always' });
    assert(out.studio && out.videoMode === 'always' && (out as never as { enabled: number[] }).enabled.length === 2 && out.height === 200, 'patchGlobal keeps every stored key'); assert.deepEqual(patchGlobal(undefined, { height: 180 }), { height: 180 }); }
  { const g = activeStudio(cleanStudio({ force: 2 })), own = cleanStudio({ force: 9 });
    const rf = (studio: unknown) => ({ studio }) as never;
    assert.equal(effectiveStudio(g, rf(undefined)), g, 'no own style = the global one'); assert.equal(effectiveStudio(g, rf(own))?.force, 9, 'own style wins'); assert.equal(effectiveStudio(g, rf(DEFAULT_STUDIO)), null, 'a default own style means plain'); }
  // Videos: a style outdates the video, no style keeps the old signature.
  { const sig0 = videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'balanced'); assert.equal(videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'balanced', ''), sig0, 'no style keeps the old signature');
    const s1 = videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'balanced', studioSig(randomStudio(1))), s2 = videoSignature(['a', 'b'], [1, 2], 0.9, 1, true, false, 'balanced', studioSig(randomStudio(2)));
    assert(s1 !== sig0 && s2 !== sig0 && s1 !== s2, 'each style has its own video signature'); }
  const _unused: StudioStyle | null = null; void _unused;
  console.log(`studio: ${STUDIO_PRESETS.length} presets, easings, overrides, photo motion, pieces x ${FX_IDS.length} effects, plumbing and signatures ok`);
}

// ---------------------------------------------------------------- image optimiser rules
{
  assert.deepEqual(fitSide(4000, 3000, 1280), { width: 1280, height: 960, scale: 0.32 });
  assert.deepEqual(fitSide(500, 300, 1280), { width: 500, height: 300, scale: 1 }); // never enlarged
  assert.deepEqual(fitSide(0, 10, 100), { width: 0, height: 0, scale: 1 });
  assert.equal(fallbackFormat('webp', false, true), 'webp'); assert.equal(fallbackFormat('webp', true, false), 'png'); assert.equal(fallbackFormat('webp', false, false), 'jpeg'); assert.equal(fallbackFormat('jpeg', false, true), 'jpeg');
  assert.equal(alreadyOptimized('image/webp', 800, 500, 90_000, 'card'), true); assert.equal(alreadyOptimized('image/webp', 3000, 2000, 90_000, 'card'), false, 'too large');
  assert.equal(alreadyOptimized('image/png', 100, 100, 1000, 'card'), false, 'PNG is always re-encoded'); assert.equal(isRasterToOptimize('image/gif'), false); assert.equal(isRasterToOptimize('image/svg+xml'), false); assert.equal(isRasterToOptimize('image/png'), true);
  assert.equal(dataUrlMime('data:image/PNG;base64,AAA'), 'image/png');
  for (const p of Object.values(PRESETS)) assert(p.maxSide >= 512 && p.quality > 0.5 && p.quality <= 1);
  console.log('images: optimiser rules ok');
}
