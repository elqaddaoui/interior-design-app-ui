/** Unit check of the assistant demo messages (src/lib/demoMessages.ts) and the login return paths: `npm run check:demo`. No network, no database. */
import * as D from '../src/lib/demoMessages';
import { safeNext, loginHref } from '../src/lib/loginRoutes';
import { passwordStrength, agoParts, deviceName } from '../src/lib/adminAccount';
import type { ChatMessage } from '../src/data/types';

const assert: any = require('node:assert/strict');
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ok  ${name}`); };
const cfg = D.STARTER_DEMO;
const msg = (role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m${Math.random()}`, role, text, createdAt: 1, ...extra });

ok('starter set: every id is unique, follow-ups exist and never point at themselves', () => {
  const ids = cfg.items.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const item of cfg.items) {
    assert(item.followUps.length <= D.MAX_FOLLOW_UPS);
    for (const f of item.followUps) { assert(ids.includes(f)); assert.notEqual(f, item.id); }
    for (const l of ['dar', 'ar', 'fr'] as const) assert(item.label[l].trim(), `${item.id} label ${l}`);
  }
});
ok('starter set: a click item with a written answer has it in all three languages', () => {
  for (const item of cfg.items.filter((x) => x.mode === 'click' && x.reply.type === 'text')) for (const l of ['dar', 'ar', 'fr'] as const) assert(item.reply.text[l].trim(), `${item.id} ${l}`);
});
ok('demoConfigOf falls back to the starter set; an owner config wins', () => {
  assert.equal(D.demoConfigOf({}), cfg);
  const mine = { enabled: true, items: [] };
  assert.equal(D.demoConfigOf({ demo: mine }), mine);
});
ok('demoItems hides disabled items, items without a label and everything when the section is off', () => {
  const items = [{ ...cfg.items[0], enabled: false }, { ...cfg.items[1], label: { dar: '', ar: '', fr: '' } }, cfg.items[2]];
  assert.deepEqual(D.demoItems({ ...cfg, items }, 'fr').map((x) => x.id), [cfg.items[2].id]);
  assert.equal(D.demoItems({ ...cfg, enabled: false }, 'fr').length, 0);
});
ok('pickText follows the language, then falls back', () => {
  assert.equal(D.pickText({ dar: 'a', ar: '', fr: 'c' }, 'ar'), 'c');
  assert.equal(D.pickText({ dar: '', ar: '', fr: '' }, 'fr'), '');
});
ok('demoAction: write fills the box, a text answer is instant, an empty answer or AI asks the pipeline', () => {
  const price = cfg.items.find((x) => x.id === 'price')!, styles = cfg.items.find((x) => x.id === 'styles')!;
  assert.equal(D.demoAction(styles, 'fr').kind, 'fill');
  const a = D.demoAction(price, 'fr');
  assert.equal(a.kind, 'answer'); if (a.kind === 'answer') { assert.equal(a.question, 'Combien ça coûte ?'); assert(a.answer.includes('crédit')); }
  assert.equal(D.demoAction({ ...price, reply: { type: 'text', text: { dar: '', ar: '', fr: '' } } }, 'fr').kind, 'ask');
  assert.equal(D.demoAction({ ...price, reply: { type: 'ai', text: price.reply.text } }, 'fr').kind, 'ask');
});
ok('demoMeta ties the saved answer to the item and stays within the server limits', () => {
  const meta = D.demoMeta(cfg.items[0], 'fr');
  assert.equal(meta.status, 'automation'); assert(meta.automationId!.length <= 40);
  assert.equal(D.demoIdOf(msg('assistant', 'x', { meta })), 'price');
  assert.equal(D.demoIdOf(msg('user', 'x', { meta })), undefined);
  assert.equal(D.demoIdOf(msg('assistant', 'x')), undefined);
});
ok('nextOptions: owner follow-ups first; else unused items; nothing after a user message or a non-demo answer', () => {
  const price = cfg.items[0];
  const thread = [msg('user', 'q'), msg('assistant', 'a', { meta: D.demoMeta(price, 'fr') })];
  assert.deepEqual(D.nextOptions(cfg, 'fr', thread).options.map((x) => x.id), ['start', 'team']);
  const noFollow = { ...cfg, items: cfg.items.map((x) => (x.id === 'price' ? { ...x, followUps: [] } : x)) };
  const rest = D.nextOptions(noFollow, 'fr', thread).options.map((x) => x.id);
  assert(!rest.includes('price')); assert(rest.length <= D.MAX_NEXT);
  assert.equal(D.nextOptions(cfg, 'fr', [msg('user', 'q')]).options.length, 0);
  assert.equal(D.nextOptions(cfg, 'fr', [msg('user', 'q'), msg('assistant', 'a')]).options.length, 0);
  assert.deepEqual(D.nextOptions(cfg, 'fr', [msg('user', 'q'), msg('assistant', 'a')], 'price').options.map((x) => x.id), ['start', 'team']);
});
ok('ctaHref maps the three buttons and nothing else', () => {
  assert.deepEqual(['none', 'tools', 'explore', 'pro'].map((c) => D.ctaHref(c as any)), [null, '/', '/explore', '/pro']);
});
ok('uniqueDemoId stays valid for the server and never repeats', () => {
  const items = [{ id: 'demo' }, { id: 'demo-2' }];
  assert.equal(D.uniqueDemoId(items), 'demo-3');
  assert.match(D.uniqueDemoId([], 'Prix & Taxes !!'), /^[a-z0-9_-]{1,64}$/);
  assert.equal(D.uniqueDemoId([], '###'), 'demo');
});
ok('newDemoItem / demoFromQuestion / duplicateDemoItem produce unique, valid items', () => {
  const a = D.newDemoItem(cfg.items); assert(!cfg.items.some((x) => x.id === a.id));
  const q = D.demoFromQuestion(cfg.items, '  chhal taman ?  ', 'dar');
  assert.equal(q.label.dar, 'chhal taman ?'); assert.equal(q.reply.type, 'ai');
  const copy = D.duplicateDemoItem(cfg.items, 'price')!;
  assert.notEqual(copy.id, 'price'); assert.deepEqual(copy.followUps, []); assert.deepEqual(copy.label, cfg.items[0].label);
  assert.equal(D.duplicateDemoItem(cfg.items, 'nope'), undefined);
});
ok('removeDemoItem also drops the follow-ups that pointed at it', () => {
  const left = D.removeDemoItem(cfg.items, 'start');
  assert(!left.some((x) => x.id === 'start')); assert(left.every((x) => !x.followUps.includes('start')));
});
ok('toggleFollowUp: add, remove, cap at four, never itself', () => {
  let item = { ...cfg.items[3], followUps: [] as string[] };
  for (const id of ['a', 'b', 'c', 'd', 'e']) item = D.toggleFollowUp(item, id);
  assert.equal(item.followUps.length, 4);
  assert.deepEqual(D.toggleFollowUp(item, 'a').followUps, ['b', 'c', 'd']);
  assert.equal(D.toggleFollowUp(item, item.id), item);
});
ok('demoIssues flags a missing label, answer or starter sentence', () => {
  const blank = D.newDemoItem([]);
  assert.deepEqual(D.demoIssues(blank).sort(), ['noAnswer', 'noLabel']);
  assert.deepEqual(D.demoIssues({ ...blank, mode: 'write' }).sort(), ['noLabel', 'noPrompt']);
  assert.deepEqual(D.demoIssues(cfg.items[0]), []);
});
ok('demoUsage counts only existing items and finds the favourite', () => {
  const u = D.demoUsage({ price: { used: 5, last: 1 }, start: { used: 9, last: 2 }, gone: { used: 100, last: 3 } }, cfg.items);
  assert.deepEqual(u, { total: 14, top: 'start', best: 9 });
});
ok('safeNext only follows in-app paths of the right scope', () => {
  assert.equal(safeNext('/admin/users', 'admin'), '/admin/users');
  assert.equal(safeNext('https://evil.com', 'admin'), '/admin');
  assert.equal(safeNext('//evil.com', 'user'), '/');
  assert.equal(safeNext('/admin/users', 'user'), '/');
  assert.equal(safeNext('/explore', 'admin'), '/admin');
  assert.equal(safeNext('/admin/login', 'admin'), '/admin');
  assert.equal(safeNext(['/explore'], 'user'), '/explore');
  assert.equal(safeNext(undefined, 'user'), '/');
  assert.equal(safeNext('%E0%A4%A', 'admin'), '/admin');
  assert.equal(loginHref('admin', '/admin/users'), '/admin/login?next=%2Fadmin%2Fusers');
  assert.equal(loginHref('admin', '/admin'), '/admin/login');
  assert.equal(loginHref('user'), '/login');
});
ok('password strength mirrors the server floor', () => {
  assert.deepEqual(['', 'admin', 'short1', 'abcdefgh', 'abcdefg1', 'Abcdefg1!x9'].map(passwordStrength), [0, 1, 1, 1, 2, 3]);
});
ok('agoParts and deviceName', () => {
  const now = 10 * 86400000;
  assert.deepEqual(agoParts(0, now), { key: 'never', n: 0 }); assert.deepEqual(agoParts(now - 30000, now), { key: 'now', n: 0 });
  assert.deepEqual(agoParts(now - 5 * 60000, now), { key: 'min', n: 5 }); assert.deepEqual(agoParts(now - 3 * 3600000, now), { key: 'hour', n: 3 }); assert.deepEqual(agoParts(now - 2 * 86400000, now), { key: 'day', n: 2 });
  assert.equal(deviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120 Safari/537'), 'Chrome · Windows');
  assert.equal(deviceName(''), '');
});
console.log(`${n} checks passed`);
