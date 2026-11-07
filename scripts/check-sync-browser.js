/* Multi-device real-time sync check. Start `PGLITE_DIR=:memory: COOKIE_SECURE=false node server/index.js` (serving dist/) first. */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8787';
const api = (page, path, options = {}) => page.evaluate(async ([path, options]) => {
  const response = await fetch('/api' + path, { method: options.method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json().catch(() => null) };
}, [path, options]);
const until = async (fn, label, ms = 15000) => { const end = Date.now() + ms; for (;;) { const value = await fn(); if (value) return value; if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise(r => setTimeout(r, 250)); } };

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const open = async (name, seed) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['notifications'] });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    await page.addInitScript(([lang, seed]) => { if (!localStorage.getItem('init')) { localStorage.setItem('dwira:v1:lang', JSON.stringify(lang)); if (seed) localStorage.setItem('dwira:v1:local', JSON.stringify(seed)); localStorage.setItem('init', '1'); } }, ['fr', seed]);
    await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
    return { context, page };
  };

  // Admin device signs in through the UI.
  const admin = await open('admin');
  await admin.page.goto(base + '/admin');
  await admin.page.getByTestId('admin-email').fill('admin');
  await admin.page.getByTestId('admin-password').fill('admin');
  await admin.page.getByTestId('admin-signin').click();
  await admin.page.getByTestId('kpi-pending').waitFor({ state: 'attached' }).catch(() => {});
  assert.equal((await api(admin.page, '/admin/session')).status, 200, 'admin session');

  // Client device on the home page; seeded content comes from the database.
  const client = await open('client');
  await client.page.getByTestId('brand-mark').waitFor({ timeout: 30000 });
  const content = await api(client.page, '/content');
  assert.equal(content.status, 200);
  assert.equal(content.body.collections.plans.length, 3, 'plans stored in the database');
  assert.ok(!content.body.collections.models.some(m => m.apiKey), 'provider keys hidden from clients');

  // 1) Admin edits the brand name -> the client device updates without reloading.
  const branding = (await api(admin.page, '/content')).body.docs.branding;
  const name = `Dwira Sync ${Date.now() % 100000}`;
  assert.equal((await api(admin.page, '/admin/doc/branding', { method: 'PATCH', body: { appName: name } })).status, 200);
  await until(() => client.page.getByText(name, { exact: false }).count().then(n => n > 0), 'brand name reaches the other device', 20000);

  // 2) A client signs in (new lead): the admin lists update on their own.
  const lead = await api(client.page, '/user/login', { method: 'POST', body: { name: 'Lead Test', phone: '+212611223344' } });
  assert.equal(lead.status, 200);
  assert.ok(lead.body.prefs, 'preferences returned at login');
  await admin.page.goto(base + '/admin/users');
  await until(() => admin.page.getByText('Lead Test').count().then(n => n > 0), 'new lead listed for the admin', 20000);

  // 3) Preferences follow the person: switch notifications off on device A, see it on a fresh device B.
  assert.equal((await api(client.page, '/prefs', { method: 'PATCH', body: { notifications: false, lang: 'ar' } })).status, 200);
  const second = await open('client-2');
  const again = await api(second.page, '/user/login', { method: 'POST', body: { name: 'Lead Test', phone: '+212611223344' } });
  assert.equal(again.body.prefs.notifications, false);
  assert.equal(again.body.prefs.lang, 'ar');

  // 4) Admin deletes a plan -> gone for clients, permanently.
  assert.equal((await api(admin.page, '/admin/content/plans', { method: 'DELETE', body: { ids: ['plan_weekly'] } })).status, 200);
  await new Promise(r => setTimeout(r, 500));
  assert.equal((await api(client.page, '/content')).body.collections.plans.length, 2);

  await browser.close();
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log('OK: content, leads and preferences sync across devices');
})().catch(e => { console.error(e); process.exit(1); });
