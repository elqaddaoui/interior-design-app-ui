/* Real exported app + backend. Physical native back gestures remain a device test. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { chromium, expect } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8080';
const languages = ['fr', 'ar', 'dar'];
const dictionaries = Object.fromEntries(languages.map(lang => {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(`src/i18n/locales/${lang}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports });
  return [lang, module.exports.default];
}));
for (const lang of languages) for (const group of ['leaveConfirm', 'account']) {
  assert.deepEqual(Object.keys(dictionaries[lang][group]).sort(), Object.keys(dictionaries.fr[group]).sort());
  for (const value of Object.values(dictionaries[lang][group])) assert.equal(typeof value, 'string');
}
const visible = (page, id) => page.locator(`[data-testid="${id}"]:visible`).last();
async function photo(page) {
  await visible(page, 'add-photo').click();
  const chooser = page.waitForEvent('filechooser');
  await visible(page, 'pick-gallery').click();
  await (await chooser).setFiles('assets/favicon.png');
  await visible(page, 'remove-photo').waitFor();
}
async function wizard(page) {
  await visible(page, 'tool-tool_interior').click();
  await photo(page);
  for (let i = 0; i < 4; i++) {
    if (!new URL(page.url()).pathname.startsWith('/tool/')) break;
    const room = page.locator('[data-testid^="room-"]:visible').first();
    const style = page.locator('[data-testid^="style-"]:visible').first();
    if (await room.count()) await room.click();
    if (await style.count()) await style.click();
    await visible(page, 'wizard-continue').click();
    await page.waitForTimeout(180);
  }
}
async function navigateAdmin(page, key) {
  await expect.poll(async () => await visible(page, `nav-${key}`).isVisible() || await visible(page, 'admin-menu-btn').isVisible()).toBe(true);
  if (!await visible(page, `nav-${key}`).isVisible()) await visible(page, 'admin-menu-btn').click();
  await visible(page, `nav-${key}`).click();
}
async function main() {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const runId = Date.now().toString().slice(-6);
  let count = 0;
  try {
    for (const lang of languages) for (const size of ['desktop', 'mobile']) for (const theme of ['light', 'dark']) {
      if (process.env.MATRIX_LANG && lang !== process.env.MATRIX_LANG || process.env.MATRIX_THEME && theme !== process.env.MATRIX_THEME || process.env.MATRIX_SIZE && size !== process.env.MATRIX_SIZE) continue;
      if (process.env.MATRIX_LIMIT && count >= Number(process.env.MATRIX_LIMIT)) continue;
      const context = await browser.newContext({ viewport: size === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: size === 'mobile', hasTouch: size === 'mobile' });
      await context.addInitScript(({ lang, theme }) => {
        if (localStorage.getItem('client-test-seeded')) return;
        localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
        localStorage.setItem('dwira:v1:doc:theme', JSON.stringify({ active: theme, custom: {} }));
        localStorage.setItem('client-test-seeded', 'yes');
      }, { lang, theme });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.dismiss());
      try {
        await page.goto(base);
        await visible(page, 'tool-tool_interior').waitFor();
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(theme === 'dark' ? 'rgb(14, 14, 16)' : 'rgb(255, 255, 255)');
        assert.equal(await page.getByTestId('lead-name').count(), 0, 'no upfront login');
        // Clean wizard closes immediately. Dirty wizard uses one translated reusable dialog.
        await visible(page, 'tool-tool_interior').click();
        await visible(page, 'step-close').click();
        await expect(page).toHaveURL(base + '/');
        assert.equal(await page.getByTestId('unsaved-message').count(), 0);
        await visible(page, 'tool-tool_interior').click();
        await photo(page);
        await visible(page, 'step-close').click();
        await expect(page.getByTestId('unsaved-message')).toHaveText(dictionaries[lang].leaveConfirm.message);
        await expect(page.getByTestId('unsaved-cancel')).toHaveText(dictionaries[lang].leaveConfirm.no);
        await expect(page.getByTestId('unsaved-discard')).toHaveText(dictionaries[lang].leaveConfirm.yes);
        assert.equal(await page.getByTestId('unsaved-message').evaluate(el => getComputedStyle(el).direction), lang === 'fr' ? 'ltr' : 'rtl');
        await page.getByTestId('unsaved-cancel').click();
        await visible(page, 'remove-photo').waitFor();
        await page.evaluate(() => history.back());
        await page.getByTestId('unsaved-message').waitFor();
        await page.getByTestId('unsaved-cancel').click();
        await visible(page, 'remove-photo').waitFor();
        await visible(page, 'step-close').click();
        await page.getByTestId('unsaved-discard').click();
        await expect(page).toHaveURL(base + '/');
        await page.waitForTimeout(250);
        assert.equal(await page.getByTestId('unsaved-message').count(), 0, 'Yes must leave without looping');
        await wizard(page);
        await visible(page, 'lead-name').fill(`Test ${lang} ${size} ${theme}`);
        const phone = `+2127${runId}${String(count).padStart(2, '0')}`;
        await visible(page, 'lead-phone').fill(phone);
        // A static host may answer API writes with HTML. Preserve the draft and allow a deliberate retry.
        await page.route('**/api/user/login', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>SPA fallback</html>' }));
        await visible(page, 'lead-submit').click();
        await page.getByText(dictionaries[lang].account.unavailable, { exact: true }).waitFor();
        await expect(visible(page, 'lead-phone')).toHaveValue(phone);
        assert.equal((await context.request.get(base + '/api/user/session')).status(), 401);
        await page.unroute('**/api/user/login');
        await visible(page, 'lead-submit').click();
        await page.waitForURL('**/lead-success', { timeout: 25000 });
        assert.equal(await page.getByTestId('pro-cta').count(), 0, 'first generation must not show Pro');
        const profile = await context.request.get(base + '/api/user/session');
        const user = (await profile.json()).user;
        assert.equal(user.freeUsed, 1);
        const space = await (await context.request.get(base + '/api/user/history')).json();
        assert.equal(space.length, 1);
        await visible(page, 'success-home').click();
        await wizard(page);
        await visible(page, 'pro-cta').waitFor();
        assert.equal(await page.getByTestId('lead-name').count(), 0, 'persistent login on second generation');
        await visible(page, 'pro-close').click();
        await page.getByTestId('unsaved-cancel').click();
        await visible(page, 'pro-close').click();
        await page.getByTestId('unsaved-discard').click();
        await page.waitForTimeout(300);
        // A reload verifies the HttpOnly persistent user session and server-owned image space.
        await page.goto(base + '/settings');
        await visible(page, 'user-logout').waitFor();
        await visible(page, 'row-admin').click();
        await visible(page, 'admin-email').fill('admin');
        await visible(page, 'admin-password').fill('admin');
        await visible(page, 'admin-signin').click();
        for (const gone of ['spam', 'returning']) assert.equal(await page.getByTestId(`nav-${gone}`).count(), 0, `${gone} menu entry removed`);
        await visible(page, 'kpi-pending').waitFor();
        assert.equal(await page.getByTestId('push-enable').count(), 0, 'notifications panel is no longer on the dashboard');
        await navigateAdmin(page, 'interface');
        await visible(page, 'layout-masonry').click();
        await navigateAdmin(page, 'tools');
        await page.getByTestId('unsaved-cancel').click();
        await navigateAdmin(page, 'tools');
        await page.getByTestId('unsaved-discard').click();
        await visible(page, 'edit-tool_interior').waitFor();
        await visible(page, 'edit-tool_interior').click();
        await visible(page, 'lt-title-fr').fill('Unsaved title');
        await visible(page, 'sheet-close').click();
        await page.getByTestId('unsaved-cancel').click();
        await expect(visible(page, 'lt-title-fr')).toHaveValue('Unsaved title');
        await visible(page, 'sheet-close').click();
        await page.getByTestId('unsaved-discard').click();
        await page.waitForTimeout(250);
        assert.equal(await page.getByTestId('unsaved-message').count(), 0);
        // User logout must not revoke the concurrently active admin session.
        await page.goto(base + '/settings');
        const deviceBefore = await page.evaluate(() => localStorage.getItem('dwira:v1:demand-client-token'));
        await visible(page, 'user-logout').click();
        await expect(page).toHaveURL(base + '/');
        assert.equal((await context.request.get(base + '/api/user/session')).status(), 401);
        assert.equal((await context.request.get(base + '/api/admin/session')).status(), 200);
        assert.equal(await page.evaluate(() => localStorage.getItem('dwira:v1:demand-client-token')), deviceBefore);
        await wizard(page);
        await visible(page, 'lead-name').fill(`Restored ${lang}`);
        await visible(page, 'lead-phone').fill(phone);
        await visible(page, 'lead-submit').click();
        await visible(page, 'pro-cta').waitFor();
        const restored = (await (await context.request.get(base + '/api/user/session')).json()).user;
        assert.equal(restored.id, user.id); assert.equal(restored.freeUsed, 1);
        assert.equal((await (await context.request.get(base + '/api/user/history')).json())[0].id, space[0].id);
        await visible(page, 'pro-close').click();
        await page.getByTestId('unsaved-discard').click();
        await page.waitForTimeout(300);
        await context.request.post(base + '/api/admin/logout', { data: {} });
        assert.equal((await context.request.get(base + '/api/user/session')).status(), 200);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `.pw/client-${lang}-${size}-${theme}.png` });
        console.log(`PASS ${lang}/${size}/${theme}: generation, session restore/logout isolation, admin menu without spam/returning, shared back/close guards`);
        count++;
      } catch (error) {
        await page.screenshot({ path: '.pw/client-failure.png' });
        console.error('FAILED', { lang, size, theme, url: page.url(), body: (await page.locator('body').innerText()).slice(-2200) });
        throw error;
      } finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${count} browser combinations and complete locale key coverage. Native devices remain manual.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
