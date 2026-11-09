/**
 * Guard for the settings map (src/lib/settingsMap.ts): `npm run check:settings`.
 * Fails when (1) an AppSettings key is neither in the map nor LEGACY_KEYS (a new setting nobody can find),
 * (2) a map entry has no text in fr / ar / dar, (3) a map entry points at a screen that does not exist,
 * (4) an entry id or key is duplicated, (5) the audience rules or live states are wrong.
 */
import { AUDIENCES, LEGACY_KEYS, SETTINGS_MAP, filterSettings, matchesAudience, sectionOf, stateOf } from '../src/lib/settingsMap';
import { ADMIN_NAV } from '../src/lib/adminNav';
import { settingsMapTexts } from '../src/i18n/locales/settingsmap';

declare const require: (m: string) => any;
declare const process: { cwd(): string };
const fs = require('fs');
const fail = (m: string): never => { throw new Error(m); };
const ok = (c: unknown, m: string) => { if (!c) fail(m); };

// 1. Every AppSettings key is mapped (or deliberately legacy).
const types: string = fs.readFileSync(`${process.cwd()}/src/data/types.ts`, 'utf8');
const block = types.slice(types.indexOf('export interface AppSettings {'));
const body = block.slice(0, block.indexOf('\n}\n'));
const keys = [...body.matchAll(/^  ([a-zA-Z0-9]+)\??:/gm)].map((m) => m[1]);
ok(keys.length > 20, `could not read the AppSettings keys (${keys.length})`);
const owned = new Set(SETTINGS_MAP.flatMap((e) => e.keys.map((k) => k.split('.')[0])));
for (const k of keys) ok(owned.has(k) || LEGACY_KEYS.includes(k), `AppSettings.${k} is not in SETTINGS_MAP (add it, so admins can find it) nor in LEGACY_KEYS`);
for (const k of LEGACY_KEYS) ok(keys.includes(k), `LEGACY_KEYS lists ${k}, which is no longer an AppSettings key`);
for (const e of SETTINGS_MAP) for (const k of e.keys) {
  const root = k.split('.')[0];
  if (/^(doc|pref|user):/.test(root)) continue;
  ok(keys.includes(root), `${e.id} lists the key ${k}, which does not exist in AppSettings`);
}

// 2. Ids and keys are unique; the audience is known.
const ids = SETTINGS_MAP.map((e) => e.id);
ok(new Set(ids).size === ids.length, 'duplicate setting id');
const seen = new Map<string, string>();
for (const e of SETTINGS_MAP) for (const k of e.keys) { ok(!seen.has(k), `key ${k} is claimed by both ${seen.get(k)} and ${e.id}`); seen.set(k, e.id); }
for (const e of SETTINGS_MAP) ok(AUDIENCES.includes(e.audience), `${e.id}: unknown audience ${e.audience}`);

// 3. Texts in all three languages, none empty, same keys everywhere.
for (const lang of ['fr', 'ar', 'dar'] as const) {
  const T = settingsMapTexts[lang] as Record<string, string>;
  for (const e of SETTINGS_MAP) for (const key of [e.id, `${e.id}_d`]) ok(T[key] && T[key].trim(), `sm.${key} is missing in ${lang}`);
  for (const a of AUDIENCES) for (const key of [`aud_${a}`, `aud_${a}_d`]) ok(T[key], `sm.${key} is missing in ${lang}`);
  for (const key of ['title', 'intro', 'search', 'all', 'none', 'legend', 'on', 'off', 'where', 'userPage', 'grp_clients', 'grp_admins', 'grp_personal', 'sec_clients', 'sec_both', 'sec_admins', 'userNote', 'mine', 'app', 'capHint', 'mapLink']) ok(T[key], `sm.${key} is missing in ${lang}`);
  ok(Object.keys(T).length === Object.keys(settingsMapTexts.fr).length, `${lang} has a different number of texts than fr`);
}
ok(/\{\{page\}\}/.test(settingsMapTexts.ar.where) && /\{\{page\}\}/.test(settingsMapTexts.dar.where), 'sm.where lost its {{page}} placeholder');

// 4. Every link points at a real screen: an admin menu entry, or the user Settings page.
const hrefs = new Set(ADMIN_NAV.map((n) => n.href));
for (const e of SETTINGS_MAP) ok(e.href === '/settings' || hrefs.has(e.href), `${e.id} links to ${e.href}, which is not an admin menu screen`);
for (const e of SETTINGS_MAP) ok((e.audience === 'personal') === (e.href === '/settings'), `${e.id}: personal settings live in /settings, and only they do`);
ok(hrefs.has('/admin/settings'), 'the Settings map is missing from the admin menu');

// 5. Filtering and live state.
const count = (f: Parameters<typeof matchesAudience>[1]) => SETTINGS_MAP.filter((e) => matchesAudience(e, f)).length;
ok(count('all') === SETTINGS_MAP.length, 'all must list everything');
ok(count('clients') === SETTINGS_MAP.filter((e) => e.audience === 'clients' || e.audience === 'both').length, 'clients includes the shared ones');
ok(count('personal') === SETTINGS_MAP.filter((e) => e.audience === 'personal').length, 'personal is only personal');
ok(count('admins') >= 5, 'admins section looks too small');
ok(SETTINGS_MAP.every((e) => ['clients', 'admins', 'personal'].includes(sectionOf(e.audience))), 'every audience belongs to a section');
const fr = settingsMapTexts.fr as Record<string, string>;
const text = (e: { id: string }) => `${fr[e.id]} ${fr[`${e.id}_d`]}`;
ok(filterSettings('all', 'whatsapp', text).some((e) => e.id === 'waChat'), 'search "whatsapp" must find the chat setting');
ok(filterSettings('admins', 'recherche', text).every((e) => e.audience === 'admins' || e.audience === 'both'), 'filter + search combine');
ok(filterSettings('all', 'zzzzzz', text).length === 0, 'an unknown word finds nothing');
ok(stateOf('waChat', {}) === 'on' && stateOf('waChat', { waChat: false }) === 'off', 'waChat defaults on');
ok(stateOf('modelPicker', {}) === 'off' && stateOf('modelPicker', { aiModelPicker: true }) === 'on', 'modelPicker defaults off');
ok(stateOf('modelRotation', { aiRotation: { on: true, ids: [] } }) === 'on', 'rotation state');
ok(stateOf('autoWhatsApp', { autoSendWhatsApp: false }) === 'off', 'autoWhatsApp state');
ok(stateOf('brand', {}) === undefined, 'a non-switch has no ON/OFF state');

console.log(`settings: ${SETTINGS_MAP.length} entries cover ${keys.length} AppSettings keys; all checks passed`);
