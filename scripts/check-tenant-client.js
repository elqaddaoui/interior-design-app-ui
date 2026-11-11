/**
 * Multi-tenant client plumbing (docs/MULTI_TENANT_PLAN.md section 2, "Client side"): URL base helpers, the Babel plugin that gives
 * expo-router the tenant prefix at run time, the HTML shell script, and the service worker's per-tenant scope.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const babel = require('@babel/core');
const paths = require('../src/lib/tenantPath');
const { RESERVED } = require('../src/lib/reservedSlugs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('base helpers: slug detection, prefixing, stripping, storage namespaces, media URLs', () => {
  assert.equal(paths.baseFromPath('/acme/admin/users'), '/acme');
  assert.equal(paths.baseFromPath('/acme'), '/acme');
  for (const none of ['/', '', '/admin/login', '/lead-success', '/api/health', '/chat/abc', '/super-admin', '/ab/x', '/Acme']) assert.equal(paths.baseFromPath(none), '', none);
  assert.equal(paths.withBase('/acme', '/admin'), '/acme/admin');
  assert.equal(paths.withBase('/acme', '/'), '/acme');
  assert.equal(paths.withBase('', '/admin'), '/admin');
  assert.equal(paths.stripBase('/acme', '/acme/admin/x'), '/admin/x');
  assert.equal(paths.stripBase('/acme', '/acme'), '/');
  assert.equal(paths.stripBase('/acme', '/acmeish/x'), '/acmeish/x', 'only a whole segment is the base');
  assert.equal(paths.stripBase('', '/admin'), '/admin');
  // The default tenant keeps the legacy keys: no existing device loses its saved state.
  assert.equal(paths.storagePrefix(''), 'dwira:v1:');
  assert.equal(paths.storagePrefix('/acme'), 'dwira:v1:t:acme:');
  assert(paths.isForeignKey('', 'dwira:v1:t:acme:lang'));
  assert(!paths.isForeignKey('', 'dwira:v1:lang'));
  assert(!paths.isForeignKey('/acme', 'dwira:v1:t:acme:lang'));
  // Stored media is canonical; the page shows it under the tenant's prefix and sends it back canonical.
  assert.equal(paths.mediaUrl('/acme', '/api/media/abc.png'), '/acme/api/media/abc.png');
  assert.equal(paths.mediaUrl('', '/api/media/abc.png'), '/api/media/abc.png');
  assert.equal(paths.mediaUrl('/acme', 'https://x.com/a.png'), 'https://x.com/a.png');
  assert.equal(paths.canonicalMediaUrl('/acme', '/acme/api/media/abc.png'), '/api/media/abc.png');
  assert.equal(paths.canonicalMediaUrl('/acme', '/globex/api/media/abc.png'), '/globex/api/media/abc.png', "another tenant's URL is not rewritten");
  const doc = { a: '/acme/api/media/x.png', list: [{ b: '/acme/api/media/y.png' }, 'plain'], n: 3 };
  assert.deepEqual(paths.mapStrings(doc, text => paths.canonicalMediaUrl('/acme', text)), { a: '/api/media/x.png', list: [{ b: '/api/media/y.png' }, 'plain'], n: 3 });
  assert.equal(paths.mapStrings(doc, text => text), doc, 'unchanged input is returned as is');
});

test('the Babel plugin gives expo-router the tenant base at run time (and only reads, never assignments)', () => {
  const plugin = require('../scripts/babel-tenant-base');
  const compile = code => babel.transformSync(code, { plugins: [plugin], babelrc: false, configFile: false }).code;
  const out = compile("function appendBaseUrl(path, baseUrl = process.env.EXPO_BASE_URL) { return baseUrl ? '/' + baseUrl + path : path }");
  assert(!out.includes('process.env.EXPO_BASE_URL'), out);
  const run = base => new vm.Script(`${out}; appendBaseUrl('/admin')`).runInNewContext({ window: base === undefined ? undefined : { __DWIRA_BASE__: base } });
  assert.equal(run('acme'), '/acme/admin');
  assert.equal(run(''), '/admin');
  assert.equal(run(undefined), '/admin', 'no window (native / SSR): no base');
  assert.match(compile('process.env.EXPO_BASE_URL = "x"'), /process\.env\.EXPO_BASE_URL = /, 'assignments are left alone');
  assert.match(read('babel.config.js'), /babel-tenant-base/, 'registered in babel.config.js');
  // expo-router must still read EXPO_BASE_URL in the places the plugin replaces.
  const router = read('node_modules/expo-router/build/fork/getPathFromState-forks.js');
  assert.match(router, /process\.env\.EXPO_BASE_URL/);
});

test('the HTML shell script sets base, route and storage prefix before anything else runs', () => {
  const run = pathname => {
    const written = [];
    const window = {};
    vm.runInNewContext(paths.shellScript(), { window, location: { pathname }, document: { write: html => written.push(html) } });
    return { window, written };
  };
  const acme = run('/acme/admin/users');
  assert.equal(acme.window.__DWIRA_BASE__, 'acme');
  assert.equal(acme.window.__DWIRA_ROUTE, '/admin/users');
  assert.equal(acme.window.__DWIRA_PFX, 'dwira:v1:t:acme:');
  assert.match(acme.written[0], /rel="manifest" href="\/acme\/api\/manifest\.webmanifest"/);
  assert.equal(run('/acme').window.__DWIRA_ROUTE, '/');
  for (const root of ['/', '/admin/login', '/lead', '/chat/abc']) {
    const plain = run(root);
    assert.equal(plain.window.__DWIRA_BASE__, '', root);
    assert.equal(plain.window.__DWIRA_ROUTE, root);
    assert.equal(plain.window.__DWIRA_PFX, 'dwira:v1:', 'default tenant keeps the legacy keys');
    assert.equal(plain.written.length, 0);
  }
  // The build injects it first in <head>, ahead of the loader (which reads the storage prefix) and the early content fetch.
  const post = read('scripts/postexport.js');
  assert(post.indexOf('${tenantHead}${loaderHead}') > 0);
  assert.match(post, /fetch\(AB\+'\/api\/content'/);
  assert.match(read('src/lib/loaderShell.js'), /__DWIRA_PFX/);
});

test('service worker: a tenant worker only owns its own windows and opens its own prefixed pages', async () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'push-sw.js'), 'utf8');
  const boot = async (workerUrl, windows) => {
    const handlers = {}, displayed = [], opened = [], messages = [];
    const self = {
      location: new URL(workerUrl), addEventListener: (name, callback) => { handlers[name] = callback; }, skipWaiting: async () => {},
      registration: { showNotification: async (title, options) => displayed.push({ title, ...options }) },
      clients: { claim: async () => {}, matchAll: async () => windows.map(url => ({ url, focus: async () => {}, postMessage: message => messages.push({ ...message, window: url }) })), openWindow: async url => { opened.push(url); return {}; } },
    };
    vm.runInNewContext(code, { self, URL });
    const push = async url => { let pending; handlers.push({ data: { json: () => ({ title: 'T', body: 'B', requestId: 'r1', url, actions: [{ action: 'open', title: 'Open' }] }) }, waitUntil: value => { pending = value; } }); await pending; };
    const click = async () => { let pending; handlers.notificationclick({ action: 'open', notification: { data: displayed.at(-1).data, close() {} }, waitUntil: value => { pending = value; } }); await pending; };
    return { displayed, opened, messages, push, click };
  };
  // Tenant worker (registered as /push-sw.js?b=acme, scope /acme/)
  const acme = await boot('https://app.test/push-sw.js?b=acme', ['https://app.test/globex/admin', 'https://app.test/admin/requests']);
  await acme.push('/admin/requests?target=7');
  assert.equal(acme.displayed[0].data.url, 'https://app.test/acme/admin/requests?target=7');
  await acme.click();
  assert.deepEqual(acme.opened, ['https://app.test/acme/admin/requests?target=7'], "another tenant's (and the default tenant's) window is never reused");
  await acme.push('https://evil.example/x');
  assert.equal(acme.displayed.at(-1).data.url, 'https://app.test/acme/admin/requests', 'unsafe URLs fall back inside the tenant');
  const reuse = await boot('https://app.test/push-sw.js?b=acme', ['https://app.test/globex/admin', 'https://app.test/acme/chat/abc']);
  await reuse.push('/admin/chats?target=9');
  await reuse.click();
  assert.equal(reuse.messages.length, 1);
  assert.equal(reuse.messages[0].type, 'dwira:notification-open');
  assert.equal(reuse.messages[0].window, 'https://app.test/acme/chat/abc', 'the globex window was skipped');
  assert.equal(reuse.messages[0].url, '/admin/chats?target=9', 'the page gets a tenant-relative route: the router adds the prefix itself');
  // The page receives a tenant-relative route (the router strips nothing twice).
  const toPage = await boot('https://app.test/push-sw.js?b=acme', ['https://app.test/acme']);
  await toPage.push('/admin/users?target=1'); await toPage.click();
  assert.equal(toPage.messages[0].type, 'dwira:notification-open');
  assert.equal(toPage.messages[0].url, '/admin/users?target=1');
  // A malicious ?b= value cannot inject a path.
  const forged = await boot('https://app.test/push-sw.js?b=../../evil', []);
  await forged.push('/admin/requests');
  assert.equal(forged.displayed[0].data.url, 'https://app.test/admin/requests');
  // Default tenant worker: unchanged behaviour, owns only windows that are not under a tenant slug.
  const root = await boot('https://app.test/push-sw.js', ['https://app.test/acme/admin', 'https://app.test/admin/requests']);
  await root.push('/admin/requests?target=3'); await root.click();
  assert.equal(root.displayed[0].data.url, 'https://app.test/admin/requests?target=3');
  assert.equal(root.messages.length, 1);
  assert.equal(root.messages[0].window, 'https://app.test/admin/requests', 'the default tenant never steals a tenant window');
});

test('the service worker keeps the same reserved list as the app', () => {
  const code = read('public/push-sw.js');
  const listed = JSON.parse(/const RESERVED = (\[.*?\]);/s.exec(code)[1]);
  assert.deepEqual([...listed].sort(), [...RESERVED].sort(), 'run: node scripts/sync-sw-reserved.js after editing src/lib/reservedSlugs.js');
});

test('client code goes through the tenant helpers (no hard-coded root paths for storage, API or service worker)', () => {
  assert.match(read('src/lib/backend.ts'), /apiBase\(\)\}\$\{path\}/);
  assert.match(read('src/data/mock/storage.ts'), /storagePrefix/);
  assert.match(read('src/lib/route.ts'), /stripBase/);
  const push = read('src/lib/push.web.ts');
  assert(!/getRegistration\('\/'\)/.test(push), 'push.web.ts must look up the tenant-scoped registration');
  assert.match(push, /scope: scopePath\(\)/);
});
