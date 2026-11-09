/**
 * Browser check of the settings map against a running web build / dev server (demo mode).
 *   TEST_URL=http://localhost:8081 SHOTS=docs/screenshots/settings node scripts/check-settings-browser.js
 * Proves: (1) Admin > Settings map lists every entry with its audience, filters and searches (fr + ar/RTL);
 * (2) a row opens the right page and outlines the right control; (3) the Interface page has the three audience sections and every
 * old control still works; (4) pages carry their audience badge; (5) the notification delay stepper edits and saves
 * `campaignCapHours`; (6) the admin search finds a setting; (7) the user Settings page has "My preferences" / "The app" and still
 * reaches the admin; (8) no page errors, and in Arabic nothing overflows the viewport.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8081';
const shots = process.env.SHOTS;
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const log = (...a) => console.log(...a);
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.jpg`, quality: 62, type: 'jpeg' }); };

async function open(browser, device, lang) {
  const ctx = await browser.newContext({ viewport: SIZES[device], deviceScaleFactor: 1, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((l) => { localStorage.setItem('dwira:v1:lang', JSON.stringify(l)); localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true })); }, lang);
  return { ctx, page, errors };
}
/** Visible label of a badge / chip: the icon glyph is the first line, the words the last. */
const label = async (page, id) => (await page.getByTestId(id).innerText()).trim().split('\n').pop().trim();
const go = async (page, path, testId) => { await page.goto(base + path, { waitUntil: 'load', timeout: 240000 }); await page.getByTestId(testId).first().waitFor({ timeout: 240000 }); };
const noOverflow = async (page, what) => {
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  assert.ok(w.doc <= w.win + 2, `${what}: horizontal overflow (${w.doc} > ${w.win})`);
};

(async () => {
  const browser = await chromium.launch({ headless: true });

  // 1-2. The map in French on a computer: all rows, audiences, filters, search, open + highlight.
  {
    const { ctx, page, errors } = await open(browser, 'desktop', 'fr');
    await go(page, '/admin/settings', 'sm-search');
    const total = await page.locator('[data-testid^="sm-row-"]').count();
    assert.ok(total >= 30, `the map lists ${total} rows`);
    for (const g of ['clients', 'admins', 'personal']) await page.getByTestId(`sm-group-${g}`).waitFor();
    assert.equal(await label(page, 'sm-aud-waChat'), 'Clients');
    assert.equal(await label(page, 'sm-aud-adminSearch'), 'Admins');
    assert.equal(await label(page, 'sm-aud-brand'), 'Tout le monde');
    assert.equal(await label(page, 'sm-state-waChat'), 'Activé');
    assert.equal(await label(page, 'sm-state-modelPicker'), 'Désactivé');
    await shot(page, 'after-admin-settings-map-desktop-fr');
    await page.getByTestId('sm-filter-admins').click();
    assert.equal(await page.getByTestId('sm-group-clients').count(), 1, 'admins filter still lists the shared (everyone) settings');
    assert.equal(await page.getByTestId('sm-row-waChat').count(), 0, 'admins filter hides client-only settings');
    assert.equal(await page.getByTestId('sm-row-menuDesign').count(), 1);
    await page.getByTestId('sm-filter-personal').click();
    assert.equal(await page.getByTestId('sm-row-language').count(), 1);
    assert.equal(await page.getByTestId('sm-row-menuDesign').count(), 0);
    await page.getByTestId('sm-filter-all').click();
    await page.getByTestId('sm-search').fill('whatsapp');
    await page.getByTestId('sm-row-waChat').waitFor();
    assert.ok(await page.getByTestId('sm-row-autoWhatsApp').count() === 1, 'search matches descriptions too');
    assert.equal(await page.getByTestId('sm-row-appSearch').count(), 0);
    await page.getByTestId('sm-search').fill('zzzzzzz');
    await page.getByTestId('sm-none').waitFor();
    await page.getByTestId('sm-search').fill('chat');
    await page.getByTestId('sm-row-waChat').click();
    await page.waitForURL(/\/admin\/interface/);
    await page.getByTestId('setting-waChat').waitFor();
    await page.waitForTimeout(800);
    assert.equal(await page.getByTestId('anchor-waChat').getAttribute('aria-label'), 'highlighted', 'the opened control is outlined');
    const vis = await page.getByTestId('anchor-waChat').evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert.ok(vis, 'the opened control was scrolled into view');
    await shot(page, 'after-admin-interface-desktop-fr');
    assert.deepEqual(errors, [], 'page errors on the map: ' + errors.join(' | '));
    log('map fr desktop ok, rows:', total);
    await ctx.close();
  }

  // 3-5. Interface page: the three sections, controls still work, badges, notification delay.
  {
    const { ctx, page, errors } = await open(browser, 'desktop', 'fr');
    await go(page, '/admin/interface', 'interface-submit');
    for (const g of ['clients', 'both', 'admins']) await page.getByTestId(`iface-sec-${g}`).waitFor();
    const order = await page.evaluate(() => ['clients', 'both', 'admins'].map((g) => document.querySelector(`[data-testid="iface-sec-${g}"]`).getBoundingClientRect().top));
    assert.ok(order[0] < order[1] && order[1] < order[2], 'sections are ordered clients, everyone, admins');
    const inSection = async (sec, id) => page.getByTestId(`iface-sec-${sec}`).getByTestId(id).count();
    assert.equal(await inSection('clients', 'setting-appSearchEnabled'), 1);
    assert.equal(await inSection('clients', 'setting-waChat'), 1);
    assert.equal(await inSection('clients', 'usernav-floating'), 1);
    assert.equal(await inSection('clients', 'loader-enabled'), 1);
    assert.equal(await inSection('admins', 'setting-adminSearchEnabled'), 1);
    assert.equal(await inSection('admins', 'menudesign-glide'), 1);
    assert.equal(await inSection('admins', 'bulk-enable-tabs'), 1);
    assert.equal(await inSection('admins', 'setting-autoTranslate'), 1);
    assert.equal(await page.getByTestId('setting-exitConfirmationEnabled').count(), 1, 'exit switch exists once (the duplicate row is gone)');
    // a control still edits and saves
    await page.getByTestId('setting-waChat').click();
    assert.match(await page.getByTestId('setting-waChat-state').innerText(), /désactiv|Désactiv|ancien/i);
    await page.getByTestId('interface-submit').click();
    await page.waitForTimeout(800);
    await page.getByTestId('setting-waChat').click();
    await page.getByTestId('interface-submit').click();
    await page.waitForTimeout(500);
    await page.getByTestId('iface-map-link').click();
    await page.waitForURL(/\/admin\/settings/);
    log('interface sections ok');

    // badges on the other pages
    for (const [path, wait, who] of [['/admin/credits', 'credits-default', 'Clients'], ['/admin/theme', 'theme-save', 'Tout le monde'], ['/admin/layouts', 'layouts-submit', 'Clients'], ['/admin/performance', 'performance-submit', 'Clients']]) {
      await go(page, path, wait);
      assert.equal(await label(page, 'page-audience'), who, `${path} audience badge`);
    }
    log('page badges ok');

    // notification delay
    await go(page, '/admin/notifications', 'cap-value');
    assert.equal(await page.getByTestId('cap-value').innerText(), '24 h');
    await page.getByTestId('cap-plus').click();
    assert.equal(await page.getByTestId('cap-value').innerText(), '36 h');
    // 36 -> 24 -> 18 -> 12 -> 6 (steps: 12 h above 24, 6 h above 6, then 1 h)
    for (let i = 0; i < 4; i++) await page.getByTestId('cap-minus').click();
    assert.equal(await page.getByTestId('cap-value').innerText(), '6 h');
    for (let i = 0; i < 7; i++) await page.getByTestId('cap-minus').click();
    assert.equal(await page.getByTestId('cap-value').innerText(), 'Sans limite');
    await page.getByTestId('cap-plus').click();
    assert.equal(await page.getByTestId('cap-value').innerText(), '1 h');
    for (let i = 0; i < 5; i++) await page.getByTestId('cap-plus').click();
    await page.getByTestId('notifications-submit').click();
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'load' });
    await page.getByTestId('cap-value').waitFor({ timeout: 120000 });
    assert.equal(await page.getByTestId('cap-value').innerText(), '6 h', 'the delay is saved');
    // restore the default
    for (let i = 0; i < 3; i++) await page.getByTestId('cap-plus').click(); // 6 -> 12 -> 18 -> 24
    assert.equal(await page.getByTestId('cap-value').innerText(), '24 h');
    await page.getByTestId('notifications-submit').click();
    await page.waitForTimeout(500);
    log('notification delay ok');

    // admin search finds a setting and opens its page
    await go(page, '/admin/credits', 'credits-default');
    await page.getByTestId('global-search-open').click();
    await page.getByTestId('global-search-input').fill('Rotation des modèles');
    await page.getByTestId('global-result-set-modelRotation').click();
    await page.waitForURL(/\/admin\/models/);
    log('admin search ok');
    assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // 7. User Settings page (phone, French) and the way into the admin.
  {
    const { ctx, page, errors } = await open(browser, 'mobile', 'fr');
    await go(page, '/settings', 'settings-note');
    const y = await page.evaluate(() => ['switch-notif', 'row-about'].map((id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect().top));
    assert.ok(y[0] < y[1], 'personal preferences come before the app rows');
    assert.ok((await page.getByText('Mes préférences', { exact: true }).count()) === 1 && (await page.getByText('L’application', { exact: true }).count()) === 1, 'two titled groups');
    for (const id of ['lang-fr', 'lang-ar', 'lang-dar', 'row-credits', 'row-about', 'row-privacy', 'row-admin']) assert.equal(await page.getByTestId(id).count(), 1, id);
    await shot(page, 'after-user-settings-mobile-fr');
    await page.getByTestId('row-admin').click();
    await page.waitForURL(/\/admin/);
    assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
    log('user settings ok');
    await ctx.close();
  }

  // 8. Arabic / RTL on a phone: the map, the Interface page and the user page.
  {
    const { ctx, page, errors } = await open(browser, 'mobile', 'ar');
    await go(page, '/admin/settings', 'sm-search');
    assert.equal(await label(page, 'sm-aud-waChat'), 'العملاء');
    assert.equal(await label(page, 'sm-aud-adminSearch'), 'المسؤولون');
    await noOverflow(page, 'map ar');
    await shot(page, 'after-admin-settings-map-mobile-ar');
    await page.getByTestId('sm-filter-admins').click();
    await page.getByTestId('sm-row-menuDesign').waitFor();
    await page.getByTestId('sm-row-menuDesign').click();
    await page.waitForURL(/\/admin\/interface/);
    await page.getByTestId('menudesign-glide').waitFor();
    await page.waitForTimeout(600);
    assert.equal(await page.getByTestId('anchor-menuDesign').getAttribute('aria-label'), 'highlighted');
    await noOverflow(page, 'interface ar');
    await shot(page, 'after-admin-interface-mobile-ar');
    await go(page, '/settings', 'settings-note');
    await noOverflow(page, 'user settings ar');
    await shot(page, 'after-user-settings-mobile-ar');
    assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
    log('rtl ok');
    await ctx.close();
  }

  // Drawer menu on a phone lists the map.
  {
    const { ctx, page } = await open(browser, 'mobile', 'fr');
    await go(page, '/admin', 'admin-menu-btn');
    await page.getByTestId('admin-menu-btn').click();
    await page.getByTestId('nav-settingsMap').waitFor();
    await page.getByTestId('nav-settingsMap').click();
    await page.waitForURL(/\/admin\/settings/);
    await shot(page, 'after-admin-settings-map-mobile-fr');
    log('menu entry ok');
    await ctx.close();
  }

  await browser.close();
  console.log('ALL OK');
})().catch((e) => { console.error(e); process.exit(1); });
