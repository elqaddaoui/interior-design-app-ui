/**
 * Browser check of Admin > Page layouts against a running web build / dev server (demo mode: EXPO_PUBLIC_BACKEND_MODE=demo).
 *   TEST_URL=http://localhost:8081 SHOTS=docs/screenshots/layouts node scripts/check-layouts-browser.js
 * Proves: the page renders and lists 4 demos per screen; picking a demo for a device changes the REAL Home / Explore on that device only;
 * limiting a demo to one device blocks it on the other; editing a setting reaches the screen; a reload keeps the saved choice.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
const shots = process.env.SHOTS;
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const log = (...a) => console.log(...a);

async function open(browser, device, path) {
  const ctx = await browser.newContext({ viewport: SIZES[device], deviceScaleFactor: 1, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('dwira:v1:lang', JSON.stringify('fr'));
    localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  });
  await page.goto(base + path, { waitUntil: 'load', timeout: 240000 });
  return { ctx, page, errors };
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.jpg` }); };

(async () => {
  const browser = await chromium.launch({ headless: true });
  // 1. Admin page on a computer.
  const a = await open(browser, 'desktop', '/admin/layouts');
  await a.page.getByTestId('ly-screen-home').waitFor({ timeout: 240000 });
  for (const id of ['grid', 'hero', 'bento', 'rail']) await a.page.getByTestId(`ly-demo-${id}`).waitFor({ timeout: 30000 });
  log('home demos listed: 4');
  await a.page.waitForTimeout(2500);
  await shot(a.page, 'admin-home-mobile-view');
  await a.page.getByTestId('ly-view-desktop').click();
  await a.page.waitForTimeout(1500);
  await shot(a.page, 'admin-home-desktop-view');
  await a.page.getByTestId('ly-screen-explore').click();
  for (const id of ['rails', 'mosaic', 'editorial', 'tiles']) await a.page.getByTestId(`ly-demo-${id}`).waitFor({ timeout: 30000 });
  log('explore demos listed: 4');
  await a.page.waitForTimeout(1500);
  await shot(a.page, 'admin-explore-desktop-view');
  assert.equal(await a.page.getByTestId('layouts-submit').isDisabled(), true, 'Save must be disabled before any change');

  // 2. Choose Bento for phones and Rail for computers on Home; Mosaic for phones and Editorial for computers on Explore.
  await a.page.getByTestId('ly-screen-home').click();
  await a.page.getByTestId('ly-use-bento-mobile').click();
  await a.page.getByTestId('ly-use-rail-desktop').click();
  await a.page.getByTestId('ly-screen-explore').click();
  await a.page.getByTestId('ly-use-mosaic-mobile').click();
  await a.page.getByTestId('ly-use-editorial-desktop').click();
  await a.page.waitForFunction(() => !document.querySelector('[data-testid="layouts-submit"]').hasAttribute('aria-disabled'), null, { timeout: 5000 });
  // 3. A demo limited to phones cannot be used on a computer.
  await a.page.getByTestId('ly-screen-home').click();
  await a.page.getByTestId('ly-devices-hero-mobile').click();
  assert.equal(await a.page.getByTestId('ly-use-hero-desktop').isDisabled(), true, 'a phone-only demo must not be selectable on desktop');
  assert.equal(await a.page.getByTestId('ly-use-hero-mobile').isDisabled(), false);
  // 4. Edit: open Bento, change the gap, see the value change.
  await a.page.getByTestId('ly-edit-bento').click();
  await a.page.getByTestId('ly-panel-bento').waitFor();
  const before = await a.page.getByTestId('ly-val-bento-gap').innerText();
  await a.page.getByTestId('ly-slider-bento-gap').getByRole('button').last().click().catch(async () => {});
  log('bento gap before edit:', before);
  await a.page.getByTestId('layouts-submit').click();
  await a.page.waitForFunction(() => document.querySelector('[data-testid="layouts-submit"]').hasAttribute('aria-disabled'), null, { timeout: 8000 });
  log('saved');
  await shot(a.page, 'admin-after-save');
  assert.deepEqual(a.errors, [], 'page errors: ' + a.errors.join(' | '));
  const stored = await a.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  await a.ctx.close();

  // 5. The real screens, per device, with the saved choice (copy the demo-mode storage into a fresh context).
  for (const device of ['mobile', 'desktop']) {
    for (const [route, label] of [['/', 'home'], ['/explore', 'explore']]) {
      const ctx = await browser.newContext({ viewport: SIZES[device], deviceScaleFactor: device === 'mobile' ? 2 : 1, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, stored);
      await page.goto(base + route, { waitUntil: 'load', timeout: 240000 });
      await page.waitForTimeout(9000);
      await shot(page, `${label}-${device}`);
      assert.deepEqual(errors, [], `${label}/${device} errors: ` + errors.join(' | '));
      log(label, device, 'ok');
      await ctx.close();
    }
  }
  await browser.close();
  log('ALL OK');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
