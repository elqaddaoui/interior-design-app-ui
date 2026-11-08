/** Pure checks of the Credits page rules (`npm run check:credits`). */
import { QUICK_AMOUNTS, addGrant, ago, canGrant, clampAmount, initialOf, markUndone, monthTotal, nextBalance, parseAmount, searchUsers, stepAmount, undoneBalance, MAX_LOG, MAX_AMOUNT, type Grant } from '../src/lib/creditGrants';

const fail = (m: string): never => { throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
let n = 0; const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; } };
const g = (id: string, amount: number, at: number, extra: Partial<Grant> = {}): Grant => ({ id, userId: 'u1', name: 'Amina', amount, before: 0, at, ...extra });

t('quick amounts are +5 +10 +20 +50', () => { eq([...QUICK_AMOUNTS], [5, 10, 20, 50], 'quick'); });
t('amounts are whole numbers between 0 and the maximum', () => {
  eq([clampAmount(-3), clampAmount(2.6), clampAmount(1e9), clampAmount(NaN)], [0, 3, MAX_AMOUNT, 0], 'clamp'); eq([parseAmount('١٢'), parseAmount('a7b'), parseAmount('')], [0, 7, 0], 'parse');
  eq([stepAmount(0, -1), stepAmount(5, 1), stepAmount(5, 1, 5), stepAmount(MAX_AMOUNT, 1)], [0, 6, 10, MAX_AMOUNT], 'step');
});
t('the live preview adds the amount to the balance', () => { eq([nextBalance(20, 10), nextBalance(0, 5), nextBalance(7, -4)], [30, 5, 7], 'preview'); });
t('Grant needs a user AND an amount', () => { eq([canGrant('', 5), canGrant('u1', 0), canGrant(undefined, 0), canGrant('u1', 5)], [false, false, false, true], 'canGrant'); });
t('the log is newest first, bounded, and undo keeps the entry but marks it', () => {
  let log: Grant[] = []; for (let i = 0; i < MAX_LOG + 5; i++) log = addGrant(log, g(String(i), 1, i));
  eq([log.length, log[0].id], [MAX_LOG, String(MAX_LOG + 4)], 'bounded'); log = markUndone(log, log[0].id); eq(log[0].undone, true, 'marked');
});
t('the monthly total counts this calendar month only and skips undone grants', () => {
  const now = new Date(2026, 10, 15, 12).getTime();
  const log = [g('a', 10, new Date(2026, 10, 1, 0, 1).getTime()), g('b', 5, new Date(2026, 10, 14).getTime(), { undone: true }), g('c', 20, new Date(2026, 9, 31, 23, 59).getTime()), g('d', 50, new Date(2025, 10, 5).getTime()), g('e', 7, now)];
  eq(monthTotal(log, now), 17, 'november only');
});
t('undo takes the grant back without going below zero', () => { eq([undoneBalance(30, { amount: 10 }), undoneBalance(4, { amount: 10 })], [20, 0], 'undo'); });
t('relative time', () => {
  const now = 1_000_000_000; eq(ago(now - 20_000, now), { unit: 'now', n: 0 }, 'now'); eq(ago(now - 5 * 60_000, now), { unit: 'min', n: 5 }, 'min'); eq(ago(now - 3 * 3600_000, now), { unit: 'hour', n: 3 }, 'hour'); eq(ago(now - 2 * 86400_000, now), { unit: 'day', n: 2 }, 'day'); eq(ago(now + 5000, now).unit, 'now', 'future');
});
t('the picker finds users by name or phone', () => {
  const users = [{ id: '1', name: 'Amina Alaoui', whatsapp: '+212 600 111 222', credits: 3 }, { id: '2', name: 'Youssef', whatsapp: '+212 611 999 000', credits: 0 }, { id: '3', name: 'أمينة', whatsapp: '+212 655 000 111', credits: 1 }];
  eq(searchUsers(users, '').length, 3, 'empty = all'); eq(searchUsers(users, 'amin').map((u) => u.id), ['1'], 'name'); eq(searchUsers(users, '999').map((u) => u.id), ['2'], 'phone digits'); eq(searchUsers(users, '0611').length, 0, 'no match'); eq(searchUsers(users, 'أمينة').map((u) => u.id), ['3'], 'arabic'); eq(searchUsers(users, '', 2).length, 2, 'limit');
});
t('avatar letter', () => { eq([initialOf({ name: 'amina', whatsapp: '' }), initialOf({ name: '', whatsapp: '+212' }), initialOf({ name: '', whatsapp: '' })], ['A', '+', '?'], 'initial'); });
console.log(process.exitCode ? 'credits checks FAILED' : `credits checks passed (${n} groups)`);
