import type { AppUser, HistoryItem, RenderRequest, Draft, Id } from '@/data/types';

export const DAY = 86400000;
export type Range = 7 | 30 | 90;
export type Metric = 'designs' | 'requests' | 'users';

export interface Bucket { start: number; designs: number; requests: number; users: number }
export interface Inputs { requests: RenderRequest[]; history: HistoryItem[]; users: AppUser[] }

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** A "design" = a delivered/processed render: history entries plus requests that have an AI result and are not already in history. */
export function designList({ requests, history }: Pick<Inputs, 'requests' | 'history'>): { at: number; draft: Draft }[] {
  const linked = new Set(history.map((h) => h.requestId).filter(Boolean) as Id[]);
  return [
    ...history.map((h) => ({ at: h.createdAt, draft: h.draft })),
    ...requests.filter((r) => !linked.has(r.id) && (r.aiResult || r.finalResult)).map((r) => ({ at: r.createdAt, draft: r.draft })),
  ];
}

const inWin = (t: number, from: number, to: number) => t >= from && t < to;

export function kpis(i: Inputs, range: Range, now = Date.now()) {
  const to = now + 1;
  const from = now - range * DAY;
  const prev = from - range * DAY;
  const designs = designList(i);
  const count = (arr: { at: number }[], a: number, b: number) => arr.filter((x) => inWin(x.at, a, b)).length;
  const reqs = i.requests.map((r) => ({ at: r.createdAt }));
  const users = i.users.filter((u) => u.role === 'user' && u.name).map((u) => ({ at: u.createdAt }));
  const mk = (arr: { at: number }[]) => { const cur = count(arr, from, to); const old = count(arr, prev, from); return { cur, old, delta: old === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - old) / old) * 100) }; };
  return { designs: mk(designs), requests: mk(reqs), users: mk(users), pending: i.requests.filter((r) => r.status === 'pending').length };
}

/** Daily buckets (weekly for 90 days) for the activity chart. */
export function series(i: Inputs, range: Range, now = Date.now()): Bucket[] {
  const step = range === 90 ? 7 : 1;
  const n = Math.ceil(range / step);
  const end = startOfDay(now) + DAY;
  const buckets: Bucket[] = Array.from({ length: n }, (_, k) => ({ start: end - (n - k) * step * DAY, designs: 0, requests: 0, users: 0 }));
  const put = (t: number, key: Metric) => {
    const k = buckets.findIndex((b) => t >= b.start && t < b.start + step * DAY);
    if (k >= 0) buckets[k][key] += 1;
  };
  designList(i).forEach((d) => put(d.at, 'designs'));
  i.requests.forEach((r) => put(r.createdAt, 'requests'));
  i.users.filter((u) => u.role === 'user' && u.name).forEach((u) => put(u.createdAt, 'users'));
  return buckets;
}

export interface Top { id: string; count: number }
export function topUsage(i: Inputs, range: Range, pick: (d: Draft) => string | undefined, now = Date.now()): Top[] {
  const from = now - range * DAY;
  const map = new Map<string, number>();
  designList(i).filter((d) => d.at >= from).forEach((d) => { const k = pick(d.draft); if (k) map.set(k, (map.get(k) ?? 0) + 1); });
  return [...map.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 5);
}

export type EventKind = 'request' | 'delivered' | 'design' | 'user';
/** `refId` = the record the event is about (request / history item / user), so a tap can open exactly that record. */
export interface Ev { id: string; kind: EventKind; at: number; name: string; toolId?: Id; href: string; refId?: Id; userId?: Id }
export function recentEvents(i: Inputs, limit = 8): Ev[] {
  const ev: Ev[] = [];
  i.requests.forEach((r) => {
    ev.push({ id: `rq-${r.id}`, kind: r.status === 'delivered' ? 'delivered' : 'request', at: r.createdAt, name: r.name, toolId: r.draft.toolId, href: '/admin/requests', refId: r.id, userId: r.userId });
  });
  i.history.forEach((h) => { if (!h.requestId) ev.push({ id: `h-${h.id}`, kind: 'design', at: h.createdAt, name: '', toolId: h.draft.toolId, href: '/admin/requests', refId: h.id, userId: h.userId }); });
  i.users.filter((u) => u.role === 'user' && u.name).forEach((u) => ev.push({ id: `u-${u.id}`, kind: 'user', at: u.createdAt, name: u.name, href: '/admin/users', refId: u.id, userId: u.id }));
  return ev.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function ago(at: number, now = Date.now()): { key: 'now' | 'min' | 'hour' | 'day'; n: number } {
  const m = Math.max(0, Math.round((now - at) / 60000));
  if (m < 1) return { key: 'now', n: 0 };
  if (m < 60) return { key: 'min', n: m };
  if (m < 1440) return { key: 'hour', n: Math.round(m / 60) };
  return { key: 'day', n: Math.round(m / 1440) };
}
