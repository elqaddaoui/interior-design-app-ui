/* global __dirname */
/**
 * Super Admin console translations. Static checks, no browser:
 *  1. every literal text passed to tr('...') in the console has a row in src/superadmin/texts.ts (so no screen stays half English),
 *  2. every row has French, Arabic and Darija text, and the {placeholders} are the same in all four languages,
 *  3. the console translator does not import the tenant's i18n (see check-superadmin-isolation.js).
 * Run: node scripts/check-superadmin-i18n.js
 */
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
})(path.join(root, 'src/superadmin'));
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
})(path.join(root, 'src/app/super-admin'));

const textsSource = fs.readFileSync(path.join(root, 'src/superadmin/texts.ts'), 'utf8');
const body = textsSource.slice(textsSource.indexOf('= {') + 2, textsSource.lastIndexOf('};') + 1);
const TEXTS = JSON.parse(body.replace(/^\s*("(?:[^"\\]|\\.)*"):\s*\[/gm, '$1: [').replace(/,(\s*})\s*$/, '$1'));
const placeholders = text => (text.match(/\{(\w+)\}/g) || []).sort().join(',');

// Texts the console passes to tr() as a literal, plus the messages of api.ts and the labels of the nav (looked up with a variable).
const used = new Map();
const literal = /\btr\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
const stringsIn = (source, from) => { const out = []; const re = /'((?:[^'\\]|\\.)*)'/g; let m; const chunk = source.slice(from); while ((m = re.exec(chunk))) out.push(m[1]); return out; };
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = literal.exec(source))) { const text = (m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'); used.set(text, path.relative(root, file)); }
}
const shell = fs.readFileSync(path.join(root, 'src/superadmin/Shell.tsx'), 'utf8');
for (const m of shell.matchAll(/label: '([^']+)', testID: 'sa-nav-/g)) used.set(m[1], 'src/superadmin/Shell.tsx (menu)');
const api = fs.readFileSync(path.join(root, 'src/superadmin/api.ts'), 'utf8');
const messages = api.slice(api.indexOf('const MESSAGES'), api.indexOf('export const saMessage'));
for (const m of messages.matchAll(/: '((?:[^'\\]|\\.)*)'/g)) used.set(m[1].replace(/\\'/g, "'"), 'src/superadmin/api.ts');
const apis = fs.readFileSync(path.join(root, 'src/app/super-admin/apis.tsx'), 'utf8');
for (const text of stringsIn(apis.slice(apis.indexOf('const KIND_LABEL'), apis.indexOf('/** Add or edit')), 0)) if (/\s|\//.test(text) || /^[A-Z]/.test(text)) used.set(text, 'src/app/super-admin/apis.tsx');
const settings = fs.readFileSync(path.join(root, 'src/app/super-admin/settings.tsx'), 'utf8');
for (const m of settings.matchAll(/group\('([^']+)', '([^']+)'/g)) { used.set(m[1], 'settings.tsx'); used.set(m[2], 'settings.tsx'); }

test('every console text passed to tr() is translated', () => {
  const missing = [...used].filter(([text]) => !TEXTS[text.trim()]).map(([text, file]) => `${file}: ${text}`);
  assert.deepEqual(missing, []);
});

test('every row has Français, العربية and الدارجة with the same placeholders', () => {
  const bad = [];
  for (const [en, row] of Object.entries(TEXTS)) {
    if (!Array.isArray(row) || row.length !== 3 || row.some(t => typeof t !== 'string' || !t.trim())) { bad.push(`incomplete: ${en}`); continue; }
    row.forEach((t, i) => { if (placeholders(t) !== placeholders(en)) bad.push(`placeholders (${['fr', 'ar', 'dar'][i]}): ${en}`); });
  }
  assert.deepEqual(bad, []);
});

test('Arabic and Darija rows are written in Arabic letters', () => {
  const bad = Object.entries(TEXTS).filter(([, row]) => [row[1], row[2]].some(t => !/[\u0600-\u06FF]/.test(t))).map(([en]) => en);
  assert.deepEqual(bad, []);
});

test('the menu uses the new names', () => {
  assert.ok(TEXTS['Client Stores'] && TEXTS['Clone Existing Store']);
  assert.match(shell, /label: 'Client Stores'/);
  assert.match(shell, /label: 'Clone Existing Store'/);
  assert.doesNotMatch(shell, /label: 'Tenants'/);
  assert.doesNotMatch(shell, /label: 'Store themes'/);
});

test('the translator is the console\'s own (no tenant i18n)', () => {
  for (const name of ['i18n.ts', 'texts.ts']) {
    const source = fs.readFileSync(path.join(root, 'src/superadmin', name), 'utf8');
    assert.doesNotMatch(source, /from ['"](@\/i18n|i18next|react-i18next)/);
  }
});

test('the Settings page offers the three app languages (and English)', () => {
  assert.match(settings, /LanguagePicker/);
  const i18n = fs.readFileSync(path.join(root, 'src/superadmin/i18n.ts'), 'utf8');
  for (const id of ["'en'", "'fr'", "'ar'", "'dar'"]) assert.ok(i18n.includes(`id: ${id}`));
});
