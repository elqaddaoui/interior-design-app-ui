/* Exported app + real backend (node server/index.js, PGLITE_DIR=:memory:, STATIC_DIR=dist, default admin/admin).
 * The browser subscription is a test double (the sandbox cannot reach Google/Apple push services), so this proves
 * the admin button flow end-to-end on desktop and mobile viewports, NOT delivery to a physical device.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8080';
const fakeSubscribe = fake => {
  const construct = value => ({ endpoint: value.endpoint, options: { applicationServerKey: new Uint8Array(value.key || []).buffer }, toJSON: () => ({ endpoint: value.endpoint, keys: value.keys }), unsubscribe: async () => { localStorage.removeItem('test-subscription'); return true; } });
  PushManager.prototype.subscribe = async function(options) { const value = { ...fake, key: Array.from(new Uint8Array(options.applicationServerKey)) }; localStorage.setItem('test-subscription', JSON.stringify(value)); return construct(value); };
  PushManager.prototype.getSubscription = async function() { const value = localStorage.getItem('test-subscription'); return value ? construct(JSON.parse(value)) : null; };
};
async function login(page) {
  await page.goto(`${base}/admin`);
  await page.getByTestId('admin-email').fill('admin');
  await page.getByTestId('admin-password').fill('admin');
  await page.getByTestId('admin-signin').click();
  await page.getByTestId('kpi-pending').waitFor();
  await page.goto(`${base}/admin/requests`); // the notifications panel lives on the requests page, not the dashboard
  await page.getByTestId('push-enable').waitFor();
}
async function main() {
  const browser = await chromium.launch({ channel: 'chromium' });
  const errors = [];
  for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    for (const lang of ['fr', 'ar', 'dar']) {
      const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
      await context.grantPermissions(['notifications'], { origin: base });
      const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
      const fake = { endpoint: `https://fcm.googleapis.com/fcm/send/test-${crypto.randomUUID()}`, keys: { p256dh: ec.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
      await context.addInitScript(({ lang }) => localStorage.setItem('dwira:v1:lang', JSON.stringify(lang)), { lang });
      await context.addInitScript(fakeSubscribe, fake);
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await login(page);
      // No stored subscription yet: a test notification is refused with a clear 409.
      assert.equal((await context.request.post(`${base}/api/push/test`, { data: {} })).status(), 409);
      await page.getByTestId('push-enable').click();
      await page.getByTestId('push-disable').waitFor();
      await page.getByTestId('push-test').waitFor();
      assert.notEqual((await context.request.post(`${base}/api/push/test`, { data: {} })).status(), 409, 'subscription must be stored');
      // The service worker is registered and the web app manifest is served for iOS "Add to Home Screen".
      assert((await page.evaluate(() => navigator.serviceWorker.ready.then(w => w.scope))).endsWith('/'));
      assert.equal((await context.request.get(`${base}/manifest.webmanifest`)).status(), 200);
      await page.getByTestId('push-test').click();
      await page.waitForTimeout(800);
      // Menu has no removed entries (desktop rail or mobile drawer).
      if (mobile) await page.getByTestId('admin-menu-btn').click();
      for (const gone of ['spam', 'returning']) assert.equal(await page.getByTestId(`nav-${gone}`).count(), 0);
      if (mobile) await page.keyboard.press('Escape');
      await page.reload();
      await page.getByTestId('push-disable').waitFor();
      await page.getByTestId('push-disable').click();
      await page.getByTestId('push-disable').waitFor({ state: 'hidden' });
      await context.close();
      console.log(`PASS ${name}/${lang}: enable -> stored -> test -> persists after reload -> disable`);
    }
  }
  // iPhone Safari outside the installed web app cannot subscribe: the page must say so instead of failing silently.
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' });
  await ios.addInitScript(() => { localStorage.setItem('dwira:v1:lang', JSON.stringify('fr')); delete window.PushManager; });
  const page = await ios.newPage();
  await page.goto(`${base}/admin`);
  await page.getByTestId('admin-email').fill('admin'); await page.getByTestId('admin-password').fill('admin'); await page.getByTestId('admin-signin').click();
  await page.getByTestId('kpi-pending').waitFor();
  await page.goto(`${base}/admin/requests`);
  await page.getByTestId('push-status').waitFor();
  const text = await page.getByTestId('push-status').innerText();
  assert(/accueil/i.test(text), `iOS must explain Add to Home Screen, got: ${text}`);
  await ios.close();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS push browser checks (desktop + mobile, fr/ar/dar, iOS install hint). Physical-device delivery remains manual.');
}
main().catch(error => { console.error(error); process.exit(1); });
