/**
 * Maths checks of the reveal engine (`npm run check:toolcards`). No device needed: it composes the REAL container transform and the REAL inverse
 * photo transform produced by lib/toolCardFx.ts (same functions the worklets run) and proves, for every effect, in LTR and RTL, on several card
 * sizes and at many progress values, that
 *   1. a photo pixel lands exactly on the same card pixel at every frame (the photo never moves, only the clipping window does);
 *   2. at q = 1 the container covers the whole card (BACK fully covers FRONT, no seam / split frame), at q = 0 it shows nothing;
 *   3. the counter-scale never exceeds 5x; the effect resolution (disabled / low-end fallbacks) follows the rules.
 */
import { SPEED_MAX, SPEED_MIN, HOLD_MAX, HOLD_MIN, FX, FX_FADE, FX_IDS, TIERS, DEFAULT_ENABLED, DEFAULT_LOW_END, cropToRatio, effectiveEffect, layerFrame, layerGeometry, makeCfg, nearestSafe, resolveAvail, verdictOf, ease, type Cfg } from '../src/lib/toolCardFx';

import { resolveFx, resolveGlobal, cleanFx } from '../src/lib/toolCards';
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
    const f = layerFrame(cfg, W, H, pr, ease(cfg.e, q));
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
console.log(`photo stays pixel-aligned: ${checked} frames checked (${SIZES.length} sizes x 4 pixel ratios x LTR/RTL x 31 effects)`);

// Catalogue: tiers partition the 30 effects and match the specified defaults.
assert.deepEqual([...TIERS.safe, ...TIERS.medium, ...TIERS.heavy].sort((a, b) => a - b), FX_IDS);
assert.deepEqual(TIERS.safe, [1, 2, 3, 4, 8, 9, 10, 11, 14, 15, 16, 17, 18]);
assert.deepEqual(TIERS.medium, [5, 6, 7, 12, 13, 19, 20, 21]);
assert.deepEqual(TIERS.heavy, [22, 23, 24, 25, 26, 27, 28, 29, 30]);
assert.deepEqual(DEFAULT_ENABLED, [...TIERS.safe, ...TIERS.medium].sort((a, b) => a - b));
assert.deepEqual(DEFAULT_LOW_END, [...TIERS.safe].sort((a, b) => a - b));
for (const [id, a] of [[1, 0], [2, 180], [3, 90], [4, -90], [5, 35], [6, -35], [7, 62], [8, 0], [9, 0], [10, 0], [11, 0], [12, 35], [13, 0], [14, 0], [15, 0]] as const) assert.equal(FX[id].angle, a, `fx ${id} angle`);
assert.equal(FX[13].swingFrom, 28); assert.equal(FX[14].ease, 'back'); assert.equal(FX[15].ease, 'expo');
assert.deepEqual([FX[16].sx, FX[16].sy, FX[17].sx, FX[17].sy], [true, false, false, true]);
assert.deepEqual([FX[20].ox, FX[20].oy, FX[21].ox, FX[21].oy], [0, 1, 1, 0]);
console.log('catalogue: 30 effects, tiers and defaults match the spec');

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
