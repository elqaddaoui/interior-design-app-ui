/**
 * scripts/postinstall.js (builds dist/ on Hostinger during `npm install`):
 *  - decides to build only on a positive Hostinger signal, never on Vercel / GitHub Actions / EAS / a plain laptop install;
 *  - skips when dist/index.html exists; honours DWIRA_BUILD_ON_INSTALL and DWIRA_SKIP_BUILD_ON_INSTALL;
 *  - keeps the heap cap; never fails the install (exit code 0, readable message) when the export breaks;
 *  - package.json keeps everything the export needs in "dependencies" (Hostinger may install without devDependencies).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decide, withHeapLimit } = require('./postinstall');

const root = path.join(__dirname, '..');
const HOSTINGER = '/home/u123456789/domains/example.com/hbuilds/abc123/nodejs';
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('postinstall builds on Hostinger signals only', () => {
  assert.equal(decide({ env: {}, dir: HOSTINGER }).run, true);
  assert.equal(decide({ env: {}, dir: '/home/u123456789/app' }).run, true);
  assert.equal(decide({ env: { DWIRA_PLATFORM: 'hostinger' }, dir: '/srv/x' }).run, true);
  assert.equal(decide({ env: { DWIRA_BUILD_ON_INSTALL: '1' }, dir: '/srv/x' }).run, true);
  assert.equal(decide({ env: { INIT_CWD: HOSTINGER }, dir: '/tmp/x' }).run, true);
  for (const dir of ['/home/user/webapp', '/Users/me/dwira', 'C:\\work\\dwira', '/home/runner/work/dwira/dwira']) assert.equal(decide({ env: {}, dir }).run, false, dir);
});

test('postinstall never builds on Vercel, GitHub Actions (Android release), EAS, when dist/ exists or when skipped', () => {
  assert.equal(decide({ env: { VERCEL: '1' }, dir: HOSTINGER }).run, false);
  assert.equal(decide({ env: { GITHUB_ACTIONS: 'true' }, dir: HOSTINGER }).run, false);
  assert.equal(decide({ env: { GITHUB_ACTIONS: 'true', DWIRA_BUILD_ON_INSTALL: '1' } }).run, false);
  assert.equal(decide({ env: { EAS_BUILD: 'true' }, dir: HOSTINGER }).run, false);
  assert.equal(decide({ env: {}, dir: HOSTINGER, distReady: true }).run, false);
  assert.equal(decide({ env: { DWIRA_SKIP_BUILD_ON_INSTALL: '1' }, dir: HOSTINGER }).run, false);
  assert.equal(decide({ env: { DWIRA_BUILD_ON_INSTALL: '0' }, dir: '/srv/x' }).run, false);
});

test('postinstall caps the V8 heap and keeps the host\'s own NODE_OPTIONS', () => {
  assert.equal(withHeapLimit(undefined), '--max-old-space-size=2048');
  assert.equal(withHeapLimit('--v8-pool-size=2'), '--v8-pool-size=2 --max-old-space-size=2048');
  assert.equal(withHeapLimit('--max-old-space-size=1024'), '--max-old-space-size=1024');
});

test('postinstall exits 0 with a clear message when the export fails, and removes a half-built dist/', () => {
  // A copy of the script in a project without expo: require.resolve('expo/bin/cli') fails -> must be reported, not thrown.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dwira-postinstall-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts'));
    fs.copyFileSync(path.join(__dirname, 'postinstall.js'), path.join(tmp, 'scripts', 'postinstall.js'));
    fs.mkdirSync(path.join(tmp, 'dist'));
    fs.writeFileSync(path.join(tmp, 'dist', 'partial.txt'), 'x');
    const env = { ...process.env, DWIRA_BUILD_ON_INSTALL: '1' };
    for (const k of ['VERCEL', 'GITHUB_ACTIONS', 'EAS_BUILD']) delete env[k];
    const result = spawnSync(process.execPath, [path.join(tmp, 'scripts', 'postinstall.js')], { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /web build FAILED, but the install continues/);
    assert.match(result.stderr, /not built yet/);
    assert.equal(fs.existsSync(path.join(tmp, 'dist')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('package.json: postinstall hook and every export dependency in "dependencies"', () => {
  assert.equal(pkg.scripts.postinstall, 'node scripts/postinstall.js');
  for (const name of ['expo', 'expo-router', 'react', 'react-dom', 'react-native', 'react-native-web', '@expo/metro-runtime', 'babel-preset-expo', 'nativewind', 'tailwindcss', 'react-native-css-interop', 'react-native-reanimated', 'react-native-worklets']) {
    assert.ok(pkg.dependencies[name], `${name} must be in dependencies, not devDependencies`);
  }
  assert.ok(!pkg.devDependencies['babel-preset-expo']);
  // metro.config.js / babel.config.js require these at export time.
  const needed = new Set();
  for (const f of ['metro.config.js', 'babel.config.js']) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/require\('([^'./][^']*)'\)|'(nativewind\/babel)'/g)) needed.add((m[1] || m[2]).split('/').slice(0, m[1] && m[1].startsWith('@') ? 2 : 1).join('/'));
  for (const name of needed) assert.ok(pkg.dependencies[name], `${name} (used by the Metro/Babel config) must be in dependencies`);
});
