/** Contrast report for the 20 presets: `npm run check:themes` (fails when a text/background pair is below WCAG AA). */
import { PRESETS } from '../src/theme/presets';
import { ratio } from '../src/theme/color';

const PAIRS: [string, string, string, number][] = [
  ['fg', 'bg', 'Body text on page', 4.5],
  ['fg', 'surface', 'Body text on card', 4.5],
  ['fg', 'surface2', 'Body text on chips', 4.5],
  ['muted', 'bg', 'Muted text on page', 4.5],
  ['muted', 'surface', 'Muted text on card', 4.5],
  ['muted', 'surface2', 'Muted text on chips', 4.5],
  ['onprimary', 'primary', 'Text on accent buttons', 4.5],
  ['onink', 'ink', 'Text on ink buttons', 4.5],
  ['fg', 'soft', 'Text on soft tint', 4.5],
  ['primary', 'bg', 'Accent vs page (decorative, text on it is checked above)', 1.3],
  ['ink', 'bg', 'Ink vs page (selected states)', 3],
  ['line', 'bg', 'Border vs page', 1.1],
];
let bad = 0;
for (const p of PRESETS) {
  const t = p.tokens as any;
  const fails = PAIRS.filter(([a, b, , min]) => ratio(t[a], t[b]) < min);
  const worst = Math.min(...PAIRS.slice(0, 9).map(([a, b]) => ratio(t[a], t[b])));
  console.log(`${fails.length ? 'FAIL' : ' ok '}  ${p.id.padEnd(11)} ${p.category.padEnd(11)} worst text contrast ${worst.toFixed(1)}`);
  fails.forEach(([a, b, label, min]) => { bad++; console.log(`        - ${label}: ${a} ${t[a]} on ${b} ${t[b]} = ${ratio(t[a], t[b]).toFixed(2)} (< ${min})`); });
}
console.log(`\n${PRESETS.length} presets, ${bad} issue(s)`);

// Admin login screen (src/components/admin/AdminLogin.tsx) uses only theme tokens, so check the pairs it draws in EVERY preset:
// labels/placeholder-ish text (muted) on the surface fields, white text on the danger banner, ink side panel text.
let loginBad = 0;
for (const p of PRESETS) {
  const t = p.tokens as any;
  const pairs: [string, string, string, number][] = [
    [t.muted, t.surface, 'Field label on surface', 4.5], [t.fg, t.surface, 'Typed text on field', 4.5], [t.muted, t.bg, 'Hint on page', 4.5],
    [t.onink, t.ink, 'Side panel text on ink', 4.5], [t.onink, t.ink, 'Language pill on ink', 4.5], ['#FFFFFF', '#B42318', 'Error banner text (ERROR_BG in AdminLogin)', 4.5], [t.line, t.bg, 'Field border on page', 1.1],
  ];
  for (const [a, b, label, min] of pairs) if (ratio(a, b) < min) { loginBad++; console.log(`FAIL login ${p.id}: ${label} ${a} on ${b} = ${ratio(a, b).toFixed(2)} (< ${min})`); }
}
console.log(`admin login: ${PRESETS.length} presets, ${loginBad} issue(s)`);

// Super Admin console palettes: 6 light + 6 dark (4 eye-friendly). Body text needs 7:1, everything else AA.
import { SA_THEMES } from '../src/superadmin/tokens';
let saBad = 0;
const cp = (c: any): [string, string, string, number][] => [
  [c.text, c.bg, 'Text on page', 7], [c.text, c.panel, 'Text on panel', 7], [c.text, c.panel2, 'Text on tinted panel', 7], [c.muted, c.bg, 'Muted on page', 4.5], [c.muted, c.panel, 'Muted on panel', 4.5], [c.muted, c.panel2, 'Muted on tinted panel', 4.5],
  [c.onAccent, c.accent, 'Text on accent button', 4.5], [c.accent, c.panel, 'Accent text on panel', 4.5], [c.accent, c.accentSoft, 'Accent on soft tint', 4.5], [c.accent, c.bg, 'Accent on page', 4.5],
  [c.ok, c.okSoft, 'OK on tint', 4.5], [c.ok, c.panel, 'OK on panel', 4.5], [c.warn, c.warnSoft, 'Warning on tint', 4.5], [c.warn, c.panel, 'Warning on panel', 4.5], [c.danger, c.dangerSoft, 'Danger on tint', 4.5], [c.danger, c.panel, 'Danger on panel', 4.5],
  [c.text, c.accentSoft, 'Text on selected row', 7], [c.text, c.warnSoft, 'Text on notice', 7], [c.line, c.panel, 'Border vs panel', 1.25],
];
for (const th of SA_THEMES) for (const [a, b, label, min] of cp(th.color)) if (ratio(a, b) < min) { saBad++; console.log(`FAIL console ${th.id}: ${label} ${a} on ${b} = ${ratio(a, b).toFixed(2)} (< ${min})`); }
const dark = SA_THEMES.filter(x => x.dark), light = SA_THEMES.filter(x => !x.dark);
if (dark.length !== 6 || light.length !== 6 || dark.filter(x => x.eyeFriendly).length !== 4) { saBad++; console.log(`FAIL console set: ${dark.length} dark (${dark.filter(x => x.eyeFriendly).length} eye-friendly), ${light.length} light; expected 6 (4) and 6`); }
console.log(`console: ${SA_THEMES.length} themes, ${saBad} issue(s)`);
process.exit(bad || loginBad || saBad ? 1 : 0);
