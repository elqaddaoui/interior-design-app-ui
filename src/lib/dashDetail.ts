import type { AppUser, RenderRequest } from '../data/types';
import { DAY, designList, type Inputs, type Range } from './stats';

/**
 * The real records behind every dashboard number (the data of the quick-view popups).
 * Pure functions, `now` injected; the definitions mirror `audience()` / `insights()` in analytics.ts, so a count on the
 * dashboard always equals the length of the list that opens when it is tapped. Checked by `npm run check:dashboard`.
 */
export type AudKind = 'active' | 'returning' | 'leads' | 'credits' | 'zero' | 'blocked';
export const AUD_KINDS: AudKind[] = ['active', 'returning', 'leads', 'credits', 'zero', 'blocked'];

export interface ClientRow { user: AppUser; designs: number; requests: number; last: number }

/** Activity per user inside the period (same rules as `audience()`). */
function activity(i: Inputs, range: Range, now: number) {
  const from = now - range * DAY;
  const per = new Map<string, number>();
  const reqs = new Map<string, number>();
  const last = new Map<string, number>();
  const seen = new Set<string>();
  const linked = new Set(i.history.map((h) => h.requestId).filter(Boolean) as string[]);
  const touch = (id: string, at: number) => last.set(id, Math.max(last.get(id) ?? 0, at));
  for (const h of i.history) if (h.createdAt >= from && h.createdAt <= now) { per.set(h.userId, (per.get(h.userId) ?? 0) + 1); seen.add(h.userId); touch(h.userId, h.createdAt); }
  for (const r of i.requests) if (r.createdAt >= from && r.createdAt <= now) {
    seen.add(r.userId); reqs.set(r.userId, (reqs.get(r.userId) ?? 0) + 1); touch(r.userId, r.createdAt);
    if (!linked.has(r.id) && (r.aiResult || r.finalResult)) per.set(r.userId, (per.get(r.userId) ?? 0) + 1);
  }
  return { per, reqs, last, seen };
}

/** The clients behind one tile of the "Clients" panel. */
export function audienceClients(i: Inputs, range: Range, kind: AudKind, now = Date.now()): ClientRow[] {
  const a = activity(i, range, now);
  const clients = i.users.filter((u) => u.role === 'user');
  const byId = new Map(i.users.map((u) => [u.id, u]));
  const row = (u: AppUser): ClientRow => ({ user: u, designs: a.per.get(u.id) ?? 0, requests: a.reqs.get(u.id) ?? 0, last: a.last.get(u.id) ?? 0 });
  // Someone who ordered but has no account record any more is still shown (name and number come from the request).
  const known = (id: string): AppUser => byId.get(id) ?? (() => {
    const r = i.requests.find((x) => x.userId === id);
    return { id, name: r?.name ?? '', whatsapp: r?.whatsapp ?? '', credits: 0, leadDone: false, role: 'user', createdAt: r?.createdAt ?? 0 } as AppUser;
  })();
  const busiest = (x: ClientRow, y: ClientRow) => y.designs - x.designs || y.last - x.last;
  switch (kind) {
    case 'active': return [...a.seen].map((id) => row(known(id))).sort(busiest);
    case 'returning': return [...a.per.entries()].filter(([, n]) => n >= 2).map(([id]) => row(known(id))).sort(busiest);
    case 'leads': return clients.filter((u) => u.leadDone).map(row).sort((x, y) => y.user.createdAt - x.user.createdAt);
    case 'credits': return clients.filter((u) => (u.credits || 0) > 0).map(row).sort((x, y) => y.user.credits - x.user.credits);
    case 'zero': return clients.filter((u) => u.name && (u.credits || 0) <= 0 && !u.blocked).map(row).sort((x, y) => y.user.createdAt - x.user.createdAt);
    case 'blocked': return clients.filter((u) => u.blocked).map(row).sort((x, y) => y.user.createdAt - x.user.createdAt);
  }
}

export interface Profile { designs: number; requests: RenderRequest[]; last: number }
/** Everything one client did, all time (the client card). */
export function clientProfile(i: Inputs, userId: string): Profile {
  const requests = i.requests.filter((r) => r.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
  const history = i.history.filter((h) => h.userId === userId);
  const user = i.users.find((u) => u.id === userId);
  return { designs: designList({ requests, history }).length, requests, last: Math.max(user?.createdAt ?? 0, requests[0]?.createdAt ?? 0, ...history.map((h) => h.createdAt)) };
}

export interface Waiting { request: RenderRequest; waitMs: number }
/** Requests nobody has started on, longest wait first (what the "oldest request" insight is about). */
export function pendingQueue(i: Inputs, now = Date.now()): Waiting[] {
  return i.requests.filter((r) => r.status === 'pending').map((request) => ({ request, waitMs: Math.max(0, now - request.createdAt) })).sort((a, b) => b.waitMs - a.waitMs);
}

/** Image generations that failed in the period, newest first (what the "AI failures" insight is about). */
export function failedRuns(i: Inputs, range: Range, now = Date.now()): RenderRequest[] {
  const from = now - range * DAY;
  return i.requests.filter((r) => r.aiRun?.failed && (r.aiRun.at ?? r.createdAt) >= from && (r.aiRun.at ?? r.createdAt) <= now).sort((a, b) => (b.aiRun?.at ?? b.createdAt) - (a.aiRun?.at ?? a.createdAt));
}
