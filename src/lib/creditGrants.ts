/**
 * Pure rules of the admin "Credits" page: the grant log (kept on this device), the monthly total, amounts, the live preview and the user picker's search.
 * No React, no storage: the store (src/store/useCreditLog.ts) persists what these functions return, and `npm run check:credits` tests them.
 */
export interface Grant { id: string; userId: string; name: string; amount: number; before: number; at: number; undone?: boolean }

export const QUICK_AMOUNTS = [5, 10, 20, 50] as const;
export const MAX_AMOUNT = 9999;
export const MAX_LOG = 100;

export const clampAmount = (n: number) => Math.min(MAX_AMOUNT, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
export const parseAmount = (s: string) => clampAmount(parseInt(s.replace(/\D/g, ''), 10) || 0);
/** Stepper: -/+ move by `by`, never below 0 or above the maximum. */
export const stepAmount = (current: number, dir: 1 | -1, by = 1) => clampAmount(current + dir * by);

/** What the picked user's balance becomes. */
export const nextBalance = (balance: number, amount: number) => balance + clampAmount(amount);
export const canGrant = (userId: string | undefined | null, amount: number) => !!userId && clampAmount(amount) > 0;

/** Newest first, bounded. */
export const addGrant = (log: Grant[], g: Grant): Grant[] => [g, ...log].slice(0, MAX_LOG);
export const markUndone = (log: Grant[], id: string): Grant[] => log.map((g) => (g.id === id ? { ...g, undone: true } : g));

/** Credits granted during the calendar month of `now` (undone grants do not count). */
export function monthTotal(log: Grant[], now = Date.now()): number {
  const d = new Date(now), y = d.getFullYear(), m = d.getMonth();
  return log.reduce((sum, g) => { const x = new Date(g.at); return !g.undone && x.getFullYear() === y && x.getMonth() === m ? sum + g.amount : sum; }, 0);
}

/** Balance to restore on undo: take the granted amount back, but never below 0 and never touch credits the user earned or spent since. */
export const undoneBalance = (current: number, g: Pick<Grant, 'amount'>) => Math.max(0, current - g.amount);

export type Ago = { unit: 'now' | 'min' | 'hour' | 'day'; n: number };
export function ago(at: number, now = Date.now()): Ago {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return { unit: 'now', n: 0 };
  if (s < 3600) return { unit: 'min', n: Math.floor(s / 60) };
  if (s < 86400) return { unit: 'hour', n: Math.floor(s / 3600) };
  return { unit: 'day', n: Math.floor(s / 86400) };
}

export interface PickUser { id: string; name: string; whatsapp: string; credits: number; blocked?: boolean }
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ').trim();
/** Search by name or phone number (digits only match anywhere in the number), accents / Arabic diacritics ignored. */
export function searchUsers<T extends PickUser>(users: T[], query: string, limit = 50): T[] {
  const q = norm(query), digits = query.replace(/\D/g, '');
  const hit = !q ? users : users.filter((u) => norm(u.name || '').includes(q) || (digits.length >= 2 && u.whatsapp.replace(/\D/g, '').includes(digits)) || norm(u.whatsapp).includes(q));
  return hit.slice(0, limit);
}
export const initialOf = (u: Pick<PickUser, 'name' | 'whatsapp'>) => (Array.from((u.name || u.whatsapp || '?').trim())[0] ?? '?').toUpperCase();
