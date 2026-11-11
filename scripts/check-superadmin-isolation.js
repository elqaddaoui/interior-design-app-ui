/**
 * Style isolation of the Super Admin console (docs/MULTI_TENANT_PLAN.md section 5), enforced by the build.
 * Everything under src/superadmin/ and src/app/super-admin/ must be styled by src/superadmin/tokens.ts only: no tenant theme, store,
 * branding, translations, seed data or themed (NativeWind) components, and no tenant API writes the console's style.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const DIRS = ['src/superadmin', 'src/app/super-admin'];
// Imports that carry tenant style, tenant data or tenant language.
const FORBIDDEN_IMPORT = /from\s+['"](@\/(?:theme|store|i18n|data|components|hooks|lib\/(?:fonts|boot|interop|sync|backend)|admin)(?:\/[^'"]*)?|nativewind|react-native-css-interop|react-i18next|i18next)['"]/;
const files = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
  const rel = path.join(dir, entry.name);
  return entry.isDirectory() ? files(rel) : /\.(tsx?|jsx?)$/.test(entry.name) ? [rel] : [];
});
const sources = DIRS.flatMap(files);

test('the console has files to check', () => { assert.ok(sources.length >= 10, `found ${sources.length}`); });

test('console code imports no tenant theme, store, branding, translations, seed data or themed components', () => {
  for (const file of sources) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    const hit = FORBIDDEN_IMPORT.exec(code);
    assert.equal(hit, null, `${file} imports ${hit && hit[1]}: the console must stay independent of tenant styling`);
  }
});

test('console code never uses NativeWind classes (they resolve against tenant theme variables) or reads tenant style documents', () => {
  for (const file of sources) {
    const code = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /\bclassName\s*=/, `${file} uses className`);
    assert.doesNotMatch(code, /\bdoc\.(?:theme|branding)\b|useTheme|ThemeProvider|resolveTokens|useStore\b/, `${file} touches tenant style data`);
    assert.doesNotMatch(code, /\/api\/(?!super-admin)/, `${file} calls a tenant API`);
  }
});

test('the console palette is hard-coded literals (tokens.ts imports nothing)', () => {
  const tokens = fs.readFileSync(path.join(root, 'src/superadmin/tokens.ts'), 'utf8');
  assert.doesNotMatch(tokens, /^\s*import\s/m, 'tokens.ts must not import anything');
  assert.match(tokens, /bg:\s*'#[0-9A-Fa-f]{6}'/);
  assert.match(tokens, /accent:\s*'#[0-9A-Fa-f]{6}'/);
});

test('nothing that a tenant can write is able to reach the console style: no server route, table or document stores one', () => {
  const server = ['index.js', 'superadmin.js', 'content.js'].map(f => fs.readFileSync(path.join(root, 'server', f), 'utf8')).join('\n');
  assert.doesNotMatch(server, /super[-_ ]?admin[-_ ]?(?:theme|style|branding|tokens)/i, 'no server code stores a console style');
  const content = fs.readFileSync(path.join(root, 'server/content.js'), 'utf8');
  assert.doesNotMatch(content, /saas_/, 'tenant content code never touches platform tables');
  // Only superadmin.js, tenants.js, bundle.js (tenant discovery) and db.js (schema) may mention platform tables.
  const tenantModules = fs.readdirSync(path.join(root, 'server'), { recursive: true }).filter(f => /\.js$/.test(String(f)) && !/^(superadmin|tenants|bundle|db|index)\.js$/.test(String(f)));
  for (const file of tenantModules) assert.doesNotMatch(fs.readFileSync(path.join(root, 'server', String(file)), 'utf8'), /\bsaas_/, `server/${file} must not read platform tables`);
});

test('the console route is reserved, so no tenant slug can shadow it', () => {
  const { slugProblem } = require('../src/lib/reservedSlugs');
  assert.equal(slugProblem('super-admin'), 'reserved');
  assert.equal(slugProblem('superadmin'), 'reserved');
});
