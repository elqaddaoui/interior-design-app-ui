/** Unit check of the Admin > Assistant model (src/lib/assistantAdmin.ts) and its texts: `npm run check:assistant`. No network, no database. */
import * as M from '../src/lib/assistantAdmin';
import { assistantAdminTexts } from '../src/i18n/locales/assistantadmin';

const assert: any = require('node:assert/strict');
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ok  ${name}`); };

const presets = { openai: { label: 'OpenAI', model: 'gpt-4o-mini' }, custom: { label: 'Custom', model: '' } };
const status = (): M.ChatStatus => ({
  free: [
    { id: 'gemini', label: 'Gemini', rank: 1, configured: true, source: 'db', enabled: true, needsKey: true, models: [], state: 'ready', last: null, resting: '' },
    { id: 'groq', label: 'Groq', rank: 2, configured: false, source: 'none', enabled: true, needsKey: true, models: [], state: 'off', last: null, resting: '' },
    { id: 'pollinations', label: 'Pollinations', rank: 3, configured: true, source: 'none', enabled: true, needsKey: false, models: [], state: 'ready', last: null, resting: '' },
  ],
  paid: { position: 'after', providers: [{ id: 'paid_aaaaaaaa', label: 'OpenAI', preset: 'openai', baseUrl: '', model: 'gpt-4o-mini', enabled: true, hasKey: true, state: 'ready', last: null, resting: '', url: '' }] },
  presets, maxPaid: 6,
});

ok('configOf mirrors the server status and is not dirty against itself', () => {
  const c = M.configOf(status());
  assert.equal(c.position, 'after'); assert.deepEqual(c.freeOff, []); assert.equal(c.paid.length, 1);
  assert.equal(M.configDirty(c, M.clone(c)), false);
});
ok('configDirty sees a position change, a free switch, a typed key', () => {
  const base = M.configOf(status());
  assert(M.configDirty({ ...base, position: 'before' }, base));
  assert(M.configDirty({ ...base, freeOff: ['groq'] }, base));
  assert(M.configDirty({ ...base, paid: [{ ...base.paid[0], key: 'x'.repeat(20) }] }, base));
});
ok('a paid provider cannot be enabled without a key', () => {
  const p = M.newPaid('openai', presets);
  assert.equal(M.canEnable(p), false); assert.equal(M.paidUsable({ ...p, enabled: true }), false);
  assert.equal(M.canEnable({ ...p, key: 'k'.repeat(20) }), true);
  assert.equal(M.canEnable({ ...p, hasKey: true }), true, 'a saved key counts');
  assert.equal(M.canEnable({ ...p, hasKey: true, key: '' }), false, 'a removed key does not');
});
ok('configBody: new providers have no id, off without key, keys only when typed', () => {
  const base = M.configOf(status());
  const fresh = { ...M.newPaid('openai', presets), enabled: true };
  const body = M.configBody({ ...base, paid: [...base.paid, fresh] });
  assert.equal(body.paid[0].id, 'paid_aaaaaaaa'); assert.equal('key' in body.paid[0], false);
  assert.equal('id' in body.paid[1], false); assert.equal(body.paid[1].enabled, false);
  const typed = M.configBody({ ...base, paid: [{ ...base.paid[0], key: 'k'.repeat(20) }] });
  assert.equal(typed.paid[0].key, 'k'.repeat(20));
  const removed = M.configBody({ ...base, paid: [{ ...base.paid[0], key: '', enabled: true }] });
  assert.equal(removed.paid[0].key, ''); assert.equal(removed.paid[0].enabled, false);
});
ok('paidErrors: custom needs https, model required, key shape', () => {
  const p = { ...M.newPaid('custom', presets) };
  assert.deepEqual(M.paidErrors(p).sort(), ['model', 'url']);
  assert.deepEqual(M.paidErrors({ ...p, baseUrl: 'http://x.com/v1', model: 'm' }), ['url']);
  assert.deepEqual(M.paidErrors({ ...p, baseUrl: 'https://api.example.com/v1/chat/completions', model: 'm' }), []);
  assert.deepEqual(M.paidErrors({ ...M.newPaid('openai', presets), key: 'short' }), ['key']);
});
ok('orderedChain follows the before/after choice and skips what cannot run', () => {
  const s = status(), c = M.configOf(s);
  assert.deepEqual(M.orderedChain(s, c).map((x) => x.id), ['gemini', 'pollinations', 'paid_aaaaaaaa']);
  assert.deepEqual(M.orderedChain(s, { ...c, position: 'before' }).map((x) => x.id), ['paid_aaaaaaaa', 'gemini', 'pollinations']);
  assert.deepEqual(M.orderedChain(s, { ...c, freeOff: ['gemini'] }).map((x) => x.id), ['pollinations', 'paid_aaaaaaaa']);
  assert.deepEqual(M.orderedChain(s, { ...c, paid: [{ ...c.paid[0], enabled: false }] }).map((x) => x.id), ['gemini', 'pollinations']);
});

const filled = (type: M.TriggerType = 'keyword'): M.Automation => { const a = M.blankAutomation(type); a.name = 'A'; a.trigger.keywords = ['prix']; a.trigger.intents = ['pricing']; a.trigger.buttonLabel = 'Prix'; a.reply.text = 'Salut {name}'; return a; };
ok('blankAutomation: once-per-chat defaults follow the trigger', () => {
  assert.equal(M.blankAutomation('keyword').oncePerChat, false);
  assert.equal(M.blankAutomation('first_visit').oncePerChat, true);
  assert.equal(M.blankAutomation('schedule').oncePerChat, true);
});
ok('automationErrors lists what is missing for each trigger and reply', () => {
  assert.deepEqual(M.automationErrors(M.blankAutomation()), ['name', 'keywords', 'text']);
  assert.deepEqual(M.automationErrors(M.blankAutomation('intent')), ['name', 'intents', 'text']);
  assert.deepEqual(M.automationErrors(M.blankAutomation('button')), ['name', 'buttonLabel', 'text']);
  assert.deepEqual(M.automationErrors(M.blankAutomation('first_visit')), ['name', 'text']);
  const ai = M.blankAutomation('schedule'); ai.name = 'x'; ai.reply.type = 'ai';
  assert.deepEqual(M.automationErrors(ai), ['instructions']);
  assert.deepEqual(M.automationErrors(filled()), []);
});
ok('unknownVars, insertVar, parseKeywords, timeOk', () => {
  assert.deepEqual(M.unknownVars('Hi {name} {foo} {bar|x} {NAME|y}'), ['foo', 'bar']);
  assert.equal(M.insertVar('Salut', 'name'), 'Salut {name}'); assert.equal(M.insertVar('', 'app'), '{app}'); assert.equal(M.insertVar('a ', 'app'), 'a {app}');
  assert.deepEqual(M.parseKeywords('prix, taman ; ثمن،  prix\nbch7al'), ['prix', 'taman', 'ثمن', 'bch7al']);
  assert.equal(M.timeOk('09:05'), true); assert.equal(M.timeOk('9:05'), true); assert.equal(M.timeOk('24:00'), false); assert.equal(M.timeOk('12:60'), false);
});
ok('duplicateOf gives a new id, a suffixed name and no counters', () => {
  const a = { ...filled(), used: 7, lastUsedAt: 5 }, d = M.duplicateOf(a, '(copy)');
  assert.notEqual(d.id, a.id); assert.equal(d.name, 'A (copy)'); assert.equal(d.used, undefined); assert.equal(d.lastUsedAt, undefined);
  d.trigger.keywords.push('z'); assert.deepEqual(a.trigger.keywords, ['prix'], 'deep copy');
});
ok('moveAutomation and dropAutomation reorder, listDirty ignores counters', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((id) => ({ ...filled(), id }));
  assert.deepEqual(M.moveAutomation([a, b, c], 'a', 1).map((x) => x.id), ['b', 'a', 'c']);
  assert.deepEqual(M.moveAutomation([a, b, c], 'a', -1).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(M.moveAutomation([a, b, c], 'c', 1).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(M.dropAutomation([a, b, c], ['a'], 'c').map((x) => x.id), ['b', 'c', 'a']);
  assert.equal(M.listDirty([a, b], [a, b]), false);
  assert.equal(M.listDirty([{ ...a, used: 9 }, b], [a, b]), false, 'counters are not edits');
  assert.equal(M.listDirty([b, a], [a, b]), true); assert.equal(M.listDirty([a], [a, b]), true);
  assert.equal(M.listDirty([{ ...a, enabled: false }, b], [a, b]), true);
});
ok('starters are valid once named, and triggerSummary is short', () => {
  for (const id of ['welcome', 'hours', 'prices'] as M.StarterId[]) assert.deepEqual(M.automationErrors(M.starter(id, { name: 'N', text: 'T' })), [], id);
  const k = filled(); k.trigger.keywords = ['a', 'b', 'c', 'd'];
  assert.equal(M.triggerSummary(k), 'a · b · c …');
  const s = M.blankAutomation('schedule'); assert.equal(M.triggerSummary(s), '18:00–09:00');
});

ok('texts: fr, ar and dar have exactly the same keys, and no empty text', () => {
  const keys = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => Array.isArray(v) ? [`${p}${k}[${v.length}]`] : v && typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]);
  const fr = keys(assistantAdminTexts.fr).sort();
  assert.deepEqual(keys(assistantAdminTexts.ar).sort(), fr); assert.deepEqual(keys(assistantAdminTexts.dar).sort(), fr);
  const empty = (o: any, p = ''): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === 'string' ? (v.trim() ? [] : [`${p}${k}`]) : Array.isArray(v) ? v.filter((x) => !String(x).trim()).map(() => `${p}${k}`) : empty(v, `${p}${k}.`));
  for (const l of ['fr', 'ar', 'dar'] as const) assert.deepEqual(empty(assistantAdminTexts[l]), [], l);
});
ok('texts: every provider, preset, intent, variable and reason the server can send has a label', () => {
  const fr: any = assistantAdminTexts.fr;
  for (const id of ['gemini', 'mistral', 'groq', 'openrouter', 'pollinations']) assert(fr.p.why[id], id);
  for (const id of ['openai', 'anthropic', 'deepseek', 'mistral', 'openrouter', 'custom']) assert(fr.p.presets[id], id);
  for (const id of ['greeting', 'thanks', 'goodbye', 'pricing', 'human', 'howto', 'problem']) assert(fr.a.intent[id], id);
  for (const id of M.VARS) assert(fr.a.varName[id], id);
  for (const id of ['rate_limit', 'auth', 'timeout', 'model', 'server', 'empty', 'network', 'cooling']) assert(fr.p.reason[id], id);
  for (const id of ['automation', 'active', 'fallback', 'paid', 'local']) assert(fr.m.status[id], id);
  for (const id of ['off', 'cooling', 'ready', 'active', 'failed']) assert(fr.p.state[id], id);
});
console.log(`\n${n} checks passed`);
