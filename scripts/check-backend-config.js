const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const source = compile('src/lib/backend.ts');
const tenantSource = compile('src/lib/tenant.ts');
// `base`: the tenant slug the HTML shell would have put on window.__DWIRA_BASE__ ('' = default tenant / custom domain).
function load({ os = 'web', env = {}, base = '', transport = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) } = {}) {
  const module = { exports: {} };
  const urls = [];
  const win = { __DWIRA_BASE__: base };
  const sandbox = { module, exports: module.exports, process: { env }, AbortController, setTimeout, clearTimeout, window: win,
    fetch: async (url, options) => { urls.push(url); return transport(url, options); },
    require: name => {
      if (name === 'react-native') return { Platform: { OS: os } };
      if (name === '@/lib/tenant') { // the real module, on the same fake platform and window
        const tenant = { exports: {} };
        vm.runInNewContext(tenantSource, { module: tenant, exports: tenant.exports, window: win, require: inner => inner === 'react-native' ? { Platform: { OS: os } } : inner === './tenantPath' ? require('../src/lib/tenantPath') : (() => { throw new Error(`Unexpected dependency: ${inner}`); })() });
        return tenant.exports;
      }
      if (name.includes('storage')) return { storage: {} };
      if (name.includes('useLocal')) return { useLocal: { getState: () => ({ set() {} }) } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(source, sandbox);
  return { ...module.exports, urls };
}
test('web defaults to same-origin API without an env variable; explicit demo and native remain opt-in', async () => {
  const web = load();
  assert.equal(web.backendEnabled, true);
  await web.api('/user/session');
  assert.deepEqual(web.urls, ['/api/user/session']);
  const remote = load({ env: { EXPO_PUBLIC_API_URL: ' https://api.example.com/api/// ' } });
  await remote.api('/health');
  assert.deepEqual(remote.urls, ['https://api.example.com/api/health']);
  const demo = load({ env: { EXPO_PUBLIC_BACKEND_MODE: 'demo' } });
  assert.equal(demo.backendEnabled, false);
  await assert.rejects(demo.api('/user/login'), error => demo.isBackendUnavailable(error));
  assert.equal(demo.urls.length, 0);
  assert.equal(load({ os: 'android' }).backendEnabled, false);
  assert.equal(load({ os: 'android', env: { EXPO_PUBLIC_API_URL: 'https://api.example.com/api' } }).backendEnabled, true);
});
test('HTML SPA fallbacks, invalid JSON, network failures and timeouts are actionable backend failures', async () => {
  for (const transport of [
    async () => new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response('broken', { headers: { 'Content-Type': 'application/json' } }),
    async () => { throw new TypeError('Failed to fetch'); },
    async () => { throw new DOMException('Timed out', 'AbortError'); },
  ]) {
    const api = load({ transport });
    await assert.rejects(api.api('/user/login', { method: 'POST', body: { name: 'Test', phone: '+212600000001' } }), error => api.isBackendUnavailable(error));
    assert.equal(api.urls.length, 1, 'never automatically replay a write or fall back to local storage');
  }
});
test('JSON business/auth errors preserve their status and code', async () => {
  for (const [status, code] of [[400, 'INVALID_PROFILE'], [401, 'Admin login required'], [409, 'INVALID_CLAIM'], [402, 'PRO_REQUIRED']]) {
    const api = load({ transport: async () => new Response(JSON.stringify({ error: code }), { status, headers: { 'Content-Type': 'application/json' } }) });
    await assert.rejects(api.api('/user/claim'), error => error.status === status && error.code === code && !api.isBackendUnavailable(error));
  }
});
// The code under test runs in a separate vm realm: compare by value (JSON), not by prototype identity.
const plain = value => JSON.parse(JSON.stringify(value));
test('a tenant served under a slug calls ITS API prefix and sees its own media URLs; native apps address a tenant by header', async () => {
  const body = { url: '/api/media/abc.png', nested: [{ image: '/api/media/def.jpg' }, 'https://x.com/a.png'] };
  const json = new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const tenant = load({ base: 'acme', transport: async () => json });
  assert.equal(tenant.backendEnabled, true);
  const seen = await tenant.api('/content');
  assert.deepEqual(tenant.urls, ['/acme/api/content']);
  assert.deepEqual(plain(seen), { url: '/acme/api/media/abc.png', nested: [{ image: '/acme/api/media/def.jpg' }, 'https://x.com/a.png'] });
  // What goes back to the server is canonical again: the stored value never carries a tenant prefix.
  const sent = [];
  const echo = load({ base: 'acme', transport: async (url, options) => { sent.push(JSON.parse(options.body)); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); } });
  await echo.api('/admin/content/tools', { method: 'POST', body: { image: '/acme/api/media/abc.png', other: '/globex/api/media/zzz.png', plain: 'x' } });
  assert.deepEqual(sent[0], { image: '/api/media/abc.png', other: '/globex/api/media/zzz.png', plain: 'x' });
  // The default tenant is byte-for-byte what it was.
  const root = load({ base: '', transport: async () => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } }) });
  assert.deepEqual(plain(await root.api('/content')), body);
  assert.deepEqual(root.urls, ['/api/content']);
  // An explicit absolute API (a white-label web build) is never prefixed; '/api' spelled out behaves like the default.
  const absolute = load({ base: 'acme', env: { EXPO_PUBLIC_API_URL: 'https://api.example.com/api' } });
  await absolute.api('/health');
  assert.deepEqual(absolute.urls, ['https://api.example.com/api/health']);
  const spelled = load({ base: 'acme', env: { EXPO_PUBLIC_API_URL: '/api' } });
  await spelled.api('/health');
  assert.deepEqual(spelled.urls, ['/acme/api/health']);
  // Native: no window path, the tenant travels in X-Dwira-Tenant (set per white-label build).
  const headers = [];
  const native = load({ os: 'android', base: 'ignored', env: { EXPO_PUBLIC_API_URL: 'https://api.example.com/api', EXPO_PUBLIC_TENANT: 'acme' }, transport: async (url, options) => { headers.push(options.headers); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(native.sameOriginApi, false);
  assert.equal(native.resolveMediaUrls('/api/media/a.png'), 'https://api.example.com/api/media/a.png');
});
