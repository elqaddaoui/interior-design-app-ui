/** Pure-logic checks of the dashboard analytics + chart geometry (`npm run check:dashboard`). */
import { aiHealth, audience, daypart, heatmap, insights, overview, pct, pipeline, sourceMix } from '../src/lib/analytics';
import { areaPath, compact, donutArcs, niceMax, smoothPath, ticksFor, toPoints } from '../src/lib/chartGeo';
import { DAY } from '../src/lib/stats';

const fail = (m: string): never => { throw new Error(m); };
const ok = (c: unknown, m: string) => { if (!c) fail(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
let n = 0; const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; } };

// Wednesday 2025-06-11 15:00 local time.
const NOW = new Date(2025, 5, 11, 15, 0, 0).getTime();
const at = (daysAgo: number, hour = 10) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(hour, 0, 0, 0); return d.getTime(); };
const draft = (toolId = 'tool_a', source?: 'photo' | 'text') => ({ toolId, source }) as any;
const req = (id: string, daysAgo: number, status: string, extra: any = {}) => ({ id, userId: extra.userId ?? 'u1', name: 'N', whatsapp: '', photoUri: '', draft: draft(extra.tool), status, createdAt: at(daysAgo, extra.hour ?? 10), ...extra }) as any;
const user = (id: string, daysAgo: number, extra: any = {}) => ({ id, name: id, whatsapp: '', credits: 3, leadDone: false, role: 'user', createdAt: at(daysAgo), ...extra }) as any;
const hist = (id: string, daysAgo: number, userId = 'u1', tool = 'tool_a', source?: any) => ({ id, userId, before: '', status: 'done', draft: draft(tool, source), createdAt: at(daysAgo) }) as any;
const empty = { requests: [], history: [], users: [] };

t('pct', () => { eq(pct(5, 0), 100, 'from zero'); eq(pct(0, 0), 0, 'zero zero'); eq(pct(15, 10), 50, 'up'); eq(pct(5, 10), -50, 'down'); });
t('empty data never crashes or divides by zero', () => {
  const o = overview(empty, 30, NOW);
  eq([o.designs.cur, o.requests.cur, o.users.cur, o.pending], [0, 0, 0, 0], 'zeros');
  eq(o.buckets.length, 30, '30 daily buckets'); eq(o.prevBuckets.length, 30, 'prev buckets');
  eq(pipeline(empty, 30, NOW).deliveryRate, 0, 'rate'); eq(heatmap(empty, 7, NOW).peak, null, 'no peak'); eq(aiHealth(empty, 7, NOW).successRate, 0, 'ai'); eq(audience(empty, 7, NOW).active, 0, 'audience');
  eq(insights(empty, 30, NOW).map((x) => x.key), ['steady'], 'steady');
});
t('overview: current vs previous window, sparkline lengths', () => {
  const i = { ...empty, history: [hist('a', 1), hist('b', 2), hist('c', 3), hist('d', 40), hist('e', 41)] };
  const o = overview(i, 30, NOW);
  eq([o.designs.cur, o.designs.old, o.designs.delta], [3, 2, 50], 'designs');
  eq(o.designs.spark.reduce((a, b) => a + b, 0), 3, 'spark sums to current'); eq(o.designs.prev.reduce((a, b) => a + b, 0), 2, 'prev sums to previous');
  eq(overview(i, 90, NOW).buckets.length, Math.ceil(90 / 7), 'weekly buckets for 90 days');
});
t('pipeline: status counts, rate, waiting time', () => {
  const i = { ...empty, requests: [req('1', 1, 'pending'), req('2', 2, 'processing'), req('3', 3, 'delivered'), req('4', 4, 'delivered'), req('5', 40, 'delivered'), req('6', 35, 'pending')] };
  const p = pipeline(i, 30, NOW);
  eq([p.pending, p.processing, p.delivered, p.total, p.deliveryRate], [1, 1, 2, 4, 50], 'counts');
  ok(p.oldestPendingMs >= 35 * DAY - DAY, 'oldest pending counts requests of any age'); ok(p.avgPendingMs > 0, 'avg wait');
});
t('heatmap: weekday (Monday first) and 4-hour blocks', () => {
  // NOW is Wednesday => Monday-first index 2; 10:00 => block 2.
  const h = heatmap({ ...empty, requests: [req('1', 0, 'pending', { hour: 10 }), req('2', 0, 'pending', { hour: 11 }), req('3', 0, 'pending', { hour: 2 })] }, 7, NOW);
  eq(h.grid[2][2], 2, 'wed morning'); eq(h.grid[2][0], 1, 'wed night'); eq(h.peak, { day: 2, block: 2 }, 'peak'); eq(h.total, 3, 'total'); eq(h.dayTotals[2], 3, 'day total');
});
t('audience: active, returning, credits, blocked, top clients', () => {
  const i = { ...empty, users: [user('u1', 50, { credits: 5 }), user('u2', 50, { credits: 0 }), user('u3', 50, { credits: 0, blocked: true }), { ...user('adm', 50), role: 'admin' }], history: [hist('a', 1, 'u1'), hist('b', 2, 'u1'), hist('c', 3, 'u2')], requests: [req('r', 1, 'pending', { userId: 'u3' })] };
  const a = audience(i, 30, NOW);
  eq([a.active, a.returning, a.creditsOut, a.zeroCredits, a.blocked], [3, 1, 5, 1, 1], 'figures'); eq(a.top[0], { id: 'u1', count: 2, name: 'u1' }, 'top');
});
t('aiHealth: success rate, average time of successful runs, model ranking', () => {
  const run = (id: string, failed: boolean, ms: number, label: string) => req(id, 1, 'delivered', { aiRun: { failed, durationMs: ms }, aiModel: { label } });
  const a = aiHealth({ ...empty, requests: [run('1', false, 4000, 'M1'), run('2', false, 6000, 'M1'), run('3', true, 100, 'M2'), run('4', false, 5000, 'M2')] }, 30, NOW);
  eq([a.runs, a.failed, a.successRate, a.avgMs], [4, 1, 75, 5000], 'figures'); eq(a.models[0], { label: 'M1', count: 2 }, 'ranking');
});
t('sourceMix', () => { eq(sourceMix({ ...empty, history: [hist('a', 1, 'u', 't', 'text'), hist('b', 1), hist('c', 2, 'u', 't', 'photo')] }, 30, NOW), { photo: 2, text: 1, total: 3 }, 'mix'); });
t('insights: urgent first, capped at 4, localisable parameters', () => {
  const i = { ...empty, requests: [req('p', 3, 'pending')], history: [hist('a', 1), hist('b', 1), hist('c', 2), hist('d', 2), hist('e', 3), hist('f', 3)] };
  const k = insights(i, 30, NOW);
  eq(k[0].key, 'backlog', 'backlog first'); ok(k[0].n! >= 72, 'hours waiting'); ok(k.length <= 4, 'cap');
  ok(k.some((x) => x.key === 'topTool' && x.id === 'tool_a' && x.pct === 100), 'top tool share');
  const drop = insights({ ...empty, history: [hist('a', 1), ...[40, 41, 42, 43].map((d, j) => hist(`o${j}`, d))] }, 30, NOW);
  ok(drop.some((x) => x.key === 'drop'), 'drop detected');
});
t('daypart', () => { eq([daypart(6), daypart(13), daypart(21)], ['morning', 'afternoon', 'evening'], 'parts'); });

t('niceMax / ticks', () => { eq([niceMax(0), niceMax(3), niceMax(7), niceMax(23), niceMax(101), niceMax(4200)], [4, 4, 10, 25, 200, 5000], 'nice'); eq(ticksFor(10, 2), [0, 5, 10], 'ticks'); });
t('toPoints: y grows upward, x evenly spread, clamps to top', () => {
  const p = toPoints([0, 5, 10, 99], 300, 100, 10);
  eq(p[0], [0, 100], 'zero at bottom'); eq(p[2][1], 0, 'top'); eq(p[3][1], 0, 'clamped'); eq(p[3][0], 300, 'last x'); eq(toPoints([4], 100, 50, 4)[0][0], 50, 'single point centred');
});
t('smoothPath never overshoots; area closes', () => {
  const p = toPoints([0, 10, 0, 10, 0], 400, 100, 10);
  const d = smoothPath(p); ok(d.startsWith('M0,100'), 'start'); ok((d.match(/C/g) || []).length === 4, 'segments');
  const ys = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2])); ok(ys.every((y) => y >= 0 && y <= 100), 'inside the box');
  ok(areaPath(p, 100).endsWith('Z'), 'closed'); eq(areaPath([[0, 0]], 10), '', 'no area for one point'); eq(smoothPath([]), '', 'empty');
});
t('compact', () => { eq([compact(7), compact(1234), compact(15500), compact(2500000)], ['7', '1.2k', '15.5k', '2.5M'], 'compact'); });
t('donutArcs: fractions sum to ~1, zero segments dropped', () => {
  const a = donutArcs([3, 0, 1]); eq(a.map((x) => x.i), [0, 2], 'zero dropped'); ok(Math.abs(a.reduce((s, x) => s + x.len, 0) - (1 - 0.012 * 2)) < 1e-9, 'gaps'); eq(donutArcs([0, 0]), [], 'all zero'); eq(donutArcs([5])[0].len, 1, 'single full circle');
});
console.log(process.exitCode ? 'dashboard checks FAILED' : `dashboard checks passed (${n} groups)`);
