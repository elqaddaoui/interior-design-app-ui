/** Pure checks of the "leave?" dialog texts (`npm run check:leave`): Arabic labels instead of raw keys, readable values, summary wording. */
import { labelOf, valueOf, describeChange, summaryKey, uniqueChanges, clip, type Ctx } from '../src/lib/changeLabels';
import { leaveTexts } from '../src/i18n/locales/leave';

const fail = (m: string): never => { throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
let n = 0; const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; } };

const mk = (lang: 'fr' | 'ar' | 'dar'): Ctx => ({
  lang,
  t: (k, o) => {
    if (k.startsWith('lv.')) { const s = (leaveTexts[lang] as Record<string, string>)[k.slice(3)] ?? k; return s.replace(/\{\{(\w+)\}\}/g, (_, x) => String(o?.[x] ?? '')); }
    return k;
  },
  has: (k) => k.startsWith('lv.'),
});
const ar = mk('ar');

t('raw keys become Arabic words', () => {
  eq(labelOf('font', ar), 'الخط', 'font'); eq(labelOf('weight', ar), 'السماكة', 'weight'); eq(labelOf('tracking', ar), 'تباعد الحروف', 'tracking');
  eq(labelOf('case', ar), 'حالة الأحرف', 'case'); eq(labelOf('fill.color', ar), 'اللون', 'fill.color'); eq(labelOf('icon.name', ar), 'الأيقونة', 'icon.name'); eq(labelOf('mono.bg', ar), 'خلفية الأحرف', 'mono.bg');
});
t('no label ever shows a latin key', () => {
  for (const p of ['font', 'weight', 'tracking', 'case', 'fill.color', 'icon.name', 'mono.bg', 'shadow.blur', 'x.y.z']) { const l = labelOf(p, ar); if (/[a-z]/i.test(l)) fail(`${p} -> ${l}`); }
});
t('french labels work too', () => { eq(labelOf('font', mk('fr')), 'Police', 'fr font'); });
t('an explicit label wins and a language suffix is appended', () => { eq(labelOf('title.fr', ar, 'العنوان'), 'العنوان · الفرنسية', 'lang'); });
t('indexes are not shown', () => { if (/\d/.test(labelOf('items.0.title', ar))) fail('index leaked'); });
t('values are words, units and colours', () => {
  eq(valueOf('case', 'upper', ar).text, 'أحرف كبيرة', 'case'); eq(valueOf('tracking', 6, ar).text, '6%', 'tracking');
  eq(valueOf('fill.color', '#ff0000', ar), { text: '#FF0000', color: '#ff0000' }, 'hex'); eq(valueOf('x', true, ar).text, 'مفعّل', 'bool'); eq(valueOf('fill.color', '', ar).text, 'تلقائي', 'empty colour');
  eq(valueOf('x', 'data:image/png;base64,AAA', ar).text, 'ملف', 'file'); eq(valueOf('x', [1, 2, 3], ar).text, '3 عناصر', 'list');
});
t('user text is never translated', () => { eq(valueOf('title.fr', 'upper', ar).text, 'upper', 'free text'); });
t('secrets stay hidden', () => { eq(valueOf('key', 'abc', ar, true).text, 'improve.protectedValue', 'secret'); });
t('describeChange gives label + before + after', () => {
  const d = describeChange({ path: 'case', before: 'none', after: 'upper' } as never, ar);
  eq([d.label, d.before.text, d.after.text], ['حالة الأحرف', 'بلا'.length ? 'بدون' : '', 'أحرف كبيرة'], 'described');
});
t('summary wording follows the Arabic plural forms', () => {
  eq(summaryKey(1), 'lv.sum1', '1'); eq(summaryKey(2), 'lv.sum2', '2'); eq(summaryKey(5), 'lv.sumFew', '5'); eq(summaryKey(11), 'lv.sumMany', '11');
  eq(ar.t('lv.sumFew', { n: 5 }), '5 تغييرات غير محفوظة', 'sentence');
});
t('dialog texts exist in every language', () => {
  const keys = Object.keys(leaveTexts.fr); for (const l of ['ar', 'dar'] as const) eq(Object.keys(leaveTexts[l]), keys, `keys ${l}`);
  eq([leaveTexts.ar.details, leaveTexts.ar.discard, leaveTexts.ar.stay], ['عرض التفاصيل', 'تجاهل', 'البقاء'], 'ar actions');
});
t('duplicates collapse and long text is clipped', () => {
  const c = { path: 'a', before: 1, after: 2 } as never; eq(uniqueChanges([c, { ...(c as object) } as never]).length, 1, 'dedupe'); eq(clip('x'.repeat(30), 10).length, 10, 'clip');
});
console.log(process.exitCode ? 'leave checks FAILED' : `leave checks passed (${n} groups)`);
