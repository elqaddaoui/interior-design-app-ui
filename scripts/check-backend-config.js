const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/lib/backend.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load({ os = 'web', env = {}, transport = async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) } = {}) {
  const module = { exports: {} };
  const urls = [];
  const sandbox = { module, exports: module.exports, process: { env }, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { urls.push(url); return transport(url, options); },
    require: name => {
      if (name === 'react-native') return { Platform: { OS: os } };
      if (name.includes('storage')) return { storage: {} };
      if (name.includes('useLocal')) return { useLocal: { getState: () => ({ set() {} }) } };
      if (name.includes('useAccess')) return { useAccess: { getState: () => ({ set() {}, clear() {} }) } };
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
