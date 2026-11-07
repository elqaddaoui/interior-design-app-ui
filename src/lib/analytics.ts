import { DAY, designList, kpis, series, topUsage, type Bucket, type Inputs, type Metric, type Range } from './stats';

/**
 * Business analytics of the admin dashboard, computed from the data the app already has (requests, history, users).
 * Pure functions: `now` is injected so the numbers are testable. Unit-tested by `npm run check:dashboard`.
 */
export const pct = (cur: number, old: number) => (old === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - old) / old) * 100));
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export interface Trend { cur: number; old: number; delta: number; spark: number[]; prev: number[] }
export interface Overview { designs: Trend; requests: Trend; users: Trend; pending: number; buckets: Bucket[]; prevBuckets: Bucket[] }

/** The three headline metrics with their sparkline (this period) and the previous period aligned bucket by bucket. */
export function overview(i: Inputs, range: Range, now = Date.now()): Overview {
  const k = kpis(i, range, now);
  const buckets = series(i, range, now);
  const prevBuckets = series(i, range, now - range * DAY);
  const t = (m: Metric): Trend => ({ cur: k[m].cur, old: k[m].old, delta: k[m].delta, spark: buckets.map((b) => b[m]), prev: prevBuckets.map((b) => b[m]) });
  return { designs: t('designs'), requests: t('requests'), users: t('users'), pending: k.pending, buckets, prevBuckets };
}

export interface Pipeline { pending: number; processing: number; delivered: number; total: number; deliveryRate: number; prevDeliveryRate: number; oldestPendingMs: number; avgPendingMs: number }
/** Where the requests of the period stand, and how long the waiting ones have waited. */
export function pipeline(i: Inputs, range: Range, now = Date.now()): Pipeline {
  const from = now - range * DAY;
  const inRange = i.requests.filter((r) => r.createdAt >= from && r.createdAt <= now);
  const prev = i.requests.filter((r) => r.createdAt >= from - range * DAY && r.createdAt < from);
  const c = (s: string) => inRange.filter((r) => r.status === s).length;
  const rate = (arr: typeof inRange) => (arr.length ? Math.round((arr.filter((r) => r.status === 'delivered').length / arr.length) * 100) : 0);
  const waiting = i.requests.filter((r) => r.status === 'pending').map((r) => Math.max(0, now - r.createdAt));
  return { pending: c('pending'), processing: c('processing'), delivered: c('delivered'), total: inRange.length, deliveryRate: rate(inRange), prevDeliveryRate: rate(prev), oldestPendingMs: waiting.length ? Math.max(...waiting) : 0, avgPendingMs: Math.round(mean(waiting)) };
}

export interface Heat { grid: number[][]; max: number; total: number; peak: { day: number; block: number } | null; dayTotals: number[] }
/** 7 weekdays (Monday = 0) x 6 blocks of 4 hours: when clients are active (requests + generated designs). */
export function heatmap(i: Inputs, range: Range, now = Date.now()): Heat {
  const from = now - range * DAY;
  const grid = Array.from({ length: 7 }, () => Array(6).fill(0) as number[]);
  const at = [...i.requests.map((r) => r.createdAt), ...designList(i).map((d) => d.at)].filter((t) => t >= from && t <= now);
  for (const t of at) { const d = new Date(t); grid[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 4)]++; }
  let max = 0, peak: Heat['peak'] = null;
  grid.forEach((row, day) => row.forEach((v, block) => { if (v > max) { max = v; peak = { day, block }; } }));
  return { grid, max, total: at.length, peak, dayTotals: grid.map((r) => r.reduce((a, b) => a + b, 0)) };
}

export interface Audience { active: number; returning: number; leads: number; clients: number; creditsOut: number; zeroCredits: number; blocked: number; top: { id: string; name: string; count: number }[] }
/** People side: who is active in the period, who comes back, credits still in circulation. */
export function audience(i: Inputs, range: Range, now = Date.now()): Audience {
  const from = now - range * DAY;
  const clients = i.users.filter((u) => u.role === 'user');
  const per = new Map<string, number>();
  const seen = new Set<string>();
  const linked = new Set(i.history.map((h) => h.requestId).filter(Boolean) as string[]);
  for (const h of i.history) if (h.createdAt >= from && h.createdAt <= now) { per.set(h.userId, (per.get(h.userId) ?? 0) + 1); seen.add(h.userId); }
  for (const r of i.requests) if (r.createdAt >= from && r.createdAt <= now) {
    seen.add(r.userId);
    if (!linked.has(r.id) && (r.aiResult || r.finalResult)) per.set(r.userId, (per.get(r.userId) ?? 0) + 1);
  }
  const named = clients.filter((u) => u.name);
  const top = [...per.entries()].map(([id, count]) => ({ id, count, name: clients.find((u) => u.id === id)?.name || '' })).filter((x) => x.name).sort((a, b) => b.count - a.count).slice(0, 4);
  return {
    active: seen.size, returning: [...per.values()].filter((n) => n >= 2).length, leads: clients.filter((u) => u.leadDone).length, clients: named.length,
    creditsOut: clients.reduce((a, u) => a + Math.max(0, u.credits || 0), 0), zeroCredits: named.filter((u) => (u.credits || 0) <= 0 && !u.blocked).length, blocked: clients.filter((u) => u.blocked).length, top,
  };
}

export interface Ai { runs: number; failed: number; successRate: number; avgMs: number; models: { label: string; count: number }[] }
/** Health of the image generation: success rate, average duration, which models did the work. */
export function aiHealth(i: Inputs, range: Range, now = Date.now()): Ai {
  const from = now - range * DAY;
  const runs = i.requests.filter((r) => r.aiRun && (r.aiRun.at ?? r.createdAt) >= from && (r.aiRun.at ?? r.createdAt) <= now);
  const ok = runs.filter((r) => !r.aiRun!.failed);
  const map = new Map<string, number>();
  for (const r of ok) { const l = r.aiModel?.label || r.aiRun?.used?.label || r.aiRun?.used?.model || ''; if (l) map.set(l, (map.get(l) ?? 0) + 1); }
  return {
    runs: runs.length, failed: runs.length - ok.length, successRate: runs.length ? Math.round((ok.length / runs.length) * 100) : 0,
    avgMs: Math.round(mean(ok.map((r) => r.aiRun?.durationMs ?? 0).filter((n) => n > 0))), models: [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 3),
  };
}

/** Photo vs text-only designs of the period. */
export function sourceMix(i: Inputs, range: Range, now = Date.now()) {
  const from = now - range * DAY;
  const d = designList(i).filter((x) => x.at >= from && x.at <= now);
  const text = d.filter((x) => x.draft?.source === 'text').length;
  return { photo: d.length - text, text, total: d.length };
}

export type InsightKey = 'backlog' | 'growth' | 'drop' | 'topTool' | 'peakDay' | 'aiFail' | 'zeroCredits' | 'steady';
export interface Insight { key: InsightKey; level: 'warn' | 'good' | 'info'; href: string; n?: number; pct?: number; id?: string; day?: number }
const RANK = { warn: 0, good: 1, info: 2 } as const;
/** Plain-language, rule-based findings. At most 4, most urgent first; `steady` when there is nothing to say. */
export function insights(i: Inputs, range: Range, now = Date.now()): Insight[] {
  const o = overview(i, range, now), p = pipeline(i, range, now), h = heatmap(i, range, now), a = audience(i, range, now), ai = aiHealth(i, range, now);
  const out: Insight[] = [];
  if (p.oldestPendingMs >= DAY) out.push({ key: 'backlog', level: 'warn', href: '/admin/requests', n: Math.round(p.oldestPendingMs / 3600000) });
  if (ai.runs >= 5 && 100 - ai.successRate >= 10) out.push({ key: 'aiFail', level: 'warn', href: '/admin/models', pct: 100 - ai.successRate });
  if (o.designs.old >= 3 && o.designs.delta <= -20) out.push({ key: 'drop', level: 'warn', href: '/admin/tools', pct: Math.abs(o.designs.delta) });
  if (a.zeroCredits >= 3) out.push({ key: 'zeroCredits', level: 'info', href: '/admin/users', n: a.zeroCredits });
  if (o.designs.cur >= 3 && o.designs.delta >= 20) out.push({ key: 'growth', level: 'good', href: '/admin/tools', pct: o.designs.delta });
  const top = topUsage(i, range, (d) => d.toolId, now)[0];
  const total = designList(i).filter((d) => d.at >= now - range * DAY && d.at <= now).length;
  if (top && total >= 5 && top.count / total >= 0.4) out.push({ key: 'topTool', level: 'good', href: '/admin/tools', id: top.id, pct: Math.round((top.count / total) * 100) });
  if (h.peak && h.total >= 8) out.push({ key: 'peakDay', level: 'info', href: '/admin/notifications', day: h.dayTotals.indexOf(Math.max(...h.dayTotals)) });
  out.sort((x, y) => RANK[x.level] - RANK[y.level]);
  return out.length ? out.slice(0, 4) : [{ key: 'steady', level: 'good', href: '/admin' }];
}

export type Daypart = 'morning' | 'afternoon' | 'evening';
export const daypart = (hour: number): Daypart => (hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening');
