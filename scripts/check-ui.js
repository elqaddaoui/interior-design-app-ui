/* Production-export regression checks. Start npm run serve:web before running. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { chromium } = require('@playwright/test');

const base = process.env.TEST_URL || 'http://localhost:4173';
const reorder = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/reorder.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, reorder);
const move = (ids, dir) => Array.from(reorder.exports.moveSelection('abcde'.split('').map((id) => ({ id })), ids, dir), (row) => row.id).join('');
assert.equal(move(['b', 'c'], -1), 'bcade');
assert.equal(move(['b', 'c'], 1), 'adbce');
assert.equal(move(['a', 'b'], -1), 'abcde');
assert.equal(move(['d', 'e'], 1), 'abcde');
assert.equal(move(['b', 'd'], -1), 'badce');
assert.equal(move(['b', 'd'], 1), 'acbed');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('test-initialized')) {
      localStorage.setItem('dwira:v1:lang', JSON.stringify('fr'));
      localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
      localStorage.setItem('test-initialized', 'yes');
    }
  });
  const go = async (path, id) => { await page.goto(`${base}${path}`); if (id) await page.getByTestId(id).first().waitFor(); };
  const saved = (key) => page.evaluate((key) => JSON.parse(localStorage.getItem(`dwira:v1:${key}`)), key);
  const seed = async (key, value) => { await page.evaluate(({ key, value }) => localStorage.setItem(`dwira:v1:${key}`, JSON.stringify(value)), { key, value }); };


  // Draft documents, form previews, inline changes, exact search, and history restoration.
  await go('/admin', 'dash-search');
  const originalSettings = await saved('doc:settings');
  await page.getByTestId('nav-interface').click();
  await page.getByTestId('layout-masonry').click();
  assert.deepEqual(await saved('doc:settings'), originalSettings, 'Preview wrote to storage');
  await page.getByTestId('nav-tools').click();
  assert.equal(await page.getByTestId('unsaved-message').innerText(), 'You have unsaved changes. Save or discard?');
  await page.getByTestId('unsaved-cancel').click();
  assert.match(page.url(), /\/admin\/interface$/);
  assert.equal(await page.getByTestId('layout-masonry').getAttribute('aria-checked'), 'true');
  await page.evaluate(() => history.back());
  await page.getByTestId('unsaved-discard').click();
  await page.getByTestId('dash-search').waitFor();
  assert.deepEqual(await saved('doc:settings'), originalSettings);

  await page.getByTestId('nav-interface').click();
  for (const [language, fonts] of [['fr', ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Lato']], ['ar', ['Tajawal', 'Cairo', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Alexandria']]]) {
    for (const font of fonts) {
      await page.getByTestId(`font-dropdown-${language}`).click();
      const specimen = page.getByTestId(`chip-${font}`);
      assert((await specimen.innerText()).includes(font));
      await specimen.click();
      const family = await page.getByTestId(`font-preview-${language}`).locator('div').first().evaluate((el) => getComputedStyle(el).fontFamily);
      assert(family.includes(font));
    }
  }
  await page.getByTestId('interface-submit').click();
  await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
  assert.equal((await saved('doc:settings')).frenchFont, 'Lato');
  assert.equal((await saved('doc:settings')).arabicFont, 'Alexandria');
  await page.getByTestId('layout-editorial').click();
  await page.getByTestId('nav-tools').click();
  await page.getByTestId('unsaved-save').click();
  await page.getByTestId('crud-add').waitFor();
  assert.equal((await saved('doc:settings')).galleryLayout, 'editorial');

  await page.getByTestId('edit-tool_interior').click();
  const toolName = await page.getByTestId('lt-title-fr').inputValue();
  const originalTools = await saved('tools');
  await page.getByTestId('lt-title-fr').fill('Unsubmitted preview');
  assert.match(await page.getByTestId('form-preview').innerText(), /Unsubmitted preview/);
  assert.deepEqual(await saved('tools'), originalTools);
  await page.evaluate(() => history.back());
  await page.getByTestId('unsaved-cancel').click();
  assert.equal(await page.getByTestId('lt-title-fr').inputValue(), 'Unsubmitted preview');
  await page.getByTestId('sheet-close').click();
  await page.getByTestId('unsaved-discard').click();
  await page.getByTestId('form-save').waitFor({ state: 'hidden' });
  await page.getByTestId('edit-tool_interior').click();
  assert.equal(await page.getByTestId('lt-title-fr').inputValue(), toolName);
  await page.getByTestId('lt-title-fr').fill('Saved preview');
  await page.getByTestId('sheet-close').click();
  await page.getByTestId('unsaved-save').click();
  await page.getByTestId('form-save').waitFor({ state: 'hidden' });
  assert.equal((await saved('tools')).find((row) => row.id === 'tool_interior').title.fr, 'Saved preview');
  await page.getByTestId('toggle-tool_interior').click();
  const committedTools = await saved('tools');
  await page.getByTestId('nav-users').click();
  await page.getByTestId('unsaved-cancel').click();
  assert.deepEqual(await saved('tools'), committedTools);
  await page.getByTestId('crud-discard').click();

  await page.getByTestId('nav-dashboard').click();
  await page.getByTestId('dash-search').fill('Japandi');
  await page.getByTestId('range-90').click();
  await page.getByTestId('search-result-pal_japandi').click();
  const target = page.getByTestId('target-pal_japandi');
  await target.waitFor();
  await page.waitForTimeout(500);
  const targetBox = await target.boundingBox();
  assert(targetBox.y >= 0 && targetBox.y + targetBox.height <= 1000);
  assert.match(page.url(), /target=pal_japandi/);
  await page.getByTestId('admin-back').click();
  assert.equal(await page.getByTestId('dash-search').inputValue(), 'Japandi');
  assert.match(await page.getByTestId('range-90').getAttribute('class'), /bg-ink/);
  await page.getByTestId('dash-search').fill('');
  await page.waitForTimeout(300);
  const pageScroll = page.locator('[data-testid^="scroll-"][data-testid$=":page"]').last();
  await pageScroll.evaluate((el) => { el.scrollTop = 100; });
  await page.waitForTimeout(200);
  const previousScroll = await pageScroll.evaluate((el) => el.scrollTop);
  await page.getByTestId('nav-users').click();
  await page.evaluate(() => history.back());
  await page.getByTestId('dash-search').waitFor();
  await page.waitForTimeout(500);
  assert(Math.abs(await pageScroll.evaluate((el) => el.scrollTop) - previousScroll) < 2, 'Page scroll was reset');

  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await go('/admin/interface', 'layout-grid');
    const cards = await Promise.all(['grid', 'masonry', 'editorial', 'carousel'].map((id) => page.getByTestId(`layout-${id}`).boundingBox()));
    assert(Math.abs(cards[0].y - cards[1].y) < 2 && Math.abs(cards[2].y - cards[3].y) < 2);
    assert(cards[2].y > cards[0].y);
    assert(cards.every((box) => box.x >= 0 && box.x + box.width <= width));
    if (width < 1000) {
      await page.getByTestId('admin-menu-btn').click();
      const menu = page.getByTestId('scroll-shared:admin-menu');
      await menu.evaluate((el) => { el.scrollTop = 140; });
      await page.waitForTimeout(200);
      const before = await menu.evaluate((el) => el.scrollTop);
      await page.evaluate(() => history.back());
      await page.getByTestId('admin-drawer').waitFor({ state: 'hidden' });
      assert.match(page.url(), /\/admin\/interface$/);
      await page.getByTestId('admin-menu-btn').click();
      await page.waitForTimeout(500);
      assert(Math.abs(await menu.evaluate((el) => el.scrollTop) - before) < 2, 'Menu scroll was reset');
      await page.getByTestId('admin-menu-close').click();
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  for (const [path, id] of [['/admin', 'dash-search'], ['/admin/?period=30', 'dash-search'], ['/admin/requests', 'req-auto'], ['/admin/palettes', 'crud-add'], ['/tool/tool_interior', 'wizard-continue']]) {
    await go(path, id);
    await page.reload(); await page.getByTestId(id).first().waitFor();
  }
  const fresh = await browser.newPage();
  await fresh.goto(`${base}/admin/requests`);
  await fresh.getByTestId('admin-signin').waitFor();
  await fresh.close();
  await go('/', 'brand-mark');
  assert.match(await page.getByTestId('brand-mark').innerText(), /Dwira/);
  // Check actual muted looping playback on the reported Home staging card.
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await go('/', 'tool-tool_staging');
    await page.getByTestId('tool-tool_staging').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const v = document.querySelector('[data-testid="tool-tool_staging"] video'); return v && !v.paused && v.currentTime > 0.1 && v.muted && v.playsInline && v.loop; }, null, { timeout: 20000 });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/admin/branding', 'brand-save');
  await page.getByTestId('chip-image').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Importer une image', { exact: true }).click();
  await (await chooser).setFiles('assets/favicon.png');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input')).some((el) => el.value === '(uploaded image)'));
  await page.getByTestId('brand-save').click();
  await page.waitForTimeout(300);
  assert.match((await saved('doc:branding')).logoUri, /^data:image\/png;base64,/);
  await go('/', 'brand-mark');
  await page.waitForFunction(() => { const img = document.querySelector('[data-testid="brand-mark"] img'); return img && img.complete && img.naturalWidth > 0; });
  // Check image mode and physical placement on desktop and phones.
  const png = 'data:image/png;base64,' + fs.readFileSync('assets/favicon.png').toString('base64');
  for (const lang of ['fr', 'ar']) {
    await seed('lang', lang);
    for (const width of [1440, 320, 375, 430]) {
    await page.setViewportSize({ width, height: 900 });
    for (const position of ['left', 'center', 'right']) {
      await seed('doc:branding', { appName: 'Dwira', logoMode: 'image', logoUri: png, logoPosition: position });
      await go('/', 'brand-mark');
      const mark = await page.getByTestId('brand-mark').boundingBox();
      const header = await page.getByTestId(`brand-header-${position}`).boundingBox();
      assert(mark && header && mark.width > 0 && mark.height > 0);
      assert(mark.x >= header.x - 1 && mark.x + mark.width <= header.x + header.width + 1);
      if (position === 'center') assert(Math.abs((mark.x + mark.width / 2) - (header.x + header.width / 2)) < 2);
    }
  }
  }
  await seed('lang', 'fr');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await seed('doc:branding', { appName: 'Dwira', logoMode: 'text', logoUri: png, logoPosition: 'left', logoFont: 'Lora', logoColor: '#2563EB' });
  await go('/', 'brand-mark');
  assert.match(await page.getByTestId('brand-mark').innerText(), /Dwira/);
  await go('/admin/interface', 'bulk-enable-tabs');
  await page.getByTestId('font-dropdown-fr').click();
  await page.getByTestId('chip-Inter').click();
  await page.getByTestId('font-dropdown-ar').click();
  await page.getByTestId('chip-Tajawal').click();
  if (await page.getByTestId('bulk-enable-tabs').getAttribute('aria-checked') !== 'true') await page.getByTestId('bulk-enable-tabs').click();
  await page.getByTestId('interface-submit').click();
  await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
  const settings = await saved('doc:settings');
  assert.equal(settings.frenchFont, 'Inter');
  assert.equal(settings.arabicFont, 'Tajawal');
  assert(settings.bulkPanels.includes('tabs'));
  await go('/admin/tabs', 'crud-batch-add');
  await page.getByTestId('crud-batch-add').click();
  await page.getByTestId('batch-titles').waitFor();
  await page.getByTestId('batch-titles').fill('Regression A\n\n- Regression B');
  await page.getByTestId('sw-visible').click();
  await page.getByTestId('batch-save').click();
  await page.getByTestId('batch-save').waitFor({ state: 'hidden' });
  let tabs = await saved('tabs');
  const added = tabs.filter((row) => row.title.fr.startsWith('Regression'));
  assert.equal(added.length, 2);
  assert(added.every((row) => row.visible === false && row.title.fr === row.title.ar && row.title.fr === row.title.dar));
  assert.notEqual(added[0].order, added[1].order);
  assert.equal(await page.getByTestId('bulk-panel').count(), 0);
  const hold = await page.getByTestId(`row-${added[0].id}`).boundingBox();
  await page.mouse.move(hold.x + 100, hold.y + 15);
  await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await page.getByTestId('bulk-panel').waitFor();
  await page.getByTestId(`select-${added[1].id}`).click();
  await page.getByTestId(`edit-${added[0].id}`).click();
  await page.getByTestId('form-save').waitFor();
  await page.getByText('Annuler', { exact: true }).last().click();
  assert.equal(await page.getByTestId(`select-${added[0].id}`).getAttribute('aria-checked'), 'true');
  await page.getByTestId('crud-batch-edit').click();
  await page.getByTestId('batch-field-title').click();
  await page.getByTestId('lt-title-fr').fill('Regression edited');
  await page.getByTestId('batch-save').click();
  await page.getByTestId('batch-save').waitFor({ state: 'hidden' });
  tabs = await saved('tabs');
  assert.equal(tabs.filter((row) => row.title.fr === 'Regression edited').length, 2);
  for (const row of added) await page.getByTestId(`select-${row.id}`).click();
  await page.getByTestId('crud-batch-move--1').click();
  await page.getByTestId('crud-submit').click();
  await page.waitForTimeout(300);
  tabs = (await saved('tabs')).sort((a, b) => a.order - b.order);
  assert.deepEqual(tabs.slice(-3, -1).map((row) => row.id), added.map((row) => row.id));
  await page.getByTestId('crud-batch-delete').click();
  await page.getByText('Supprimer', { exact: true }).last().click();
  await page.waitForTimeout(300);
  assert.equal((await saved('tabs')).filter((row) => added.some((a) => a.id === row.id)).length, 0);

  for (const width of [280, 320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    await go('/admin/theme', 'theme-light');
    const cards = await page.locator('[data-testid^="theme-"][role="radio"]').all();
    const first = await cards[0].boundingBox();
    const second = await cards[1].boundingBox();
    assert(Math.abs(first.y - second.y) < 2, `Theme cards wrapped at ${width}px`);
    assert(first.width > 60 && second.width > 60);
  }
  for (const width of [320, 1440]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const entity of ['tabs', 'tools', 'sections', 'categories', 'inspirations', 'styles', 'roomTypes', 'palettes', 'models']) {
    await go(`/admin/${entity}`, 'crud-add');
    await page.getByTestId('crud-add').click();
    await page.waitForFunction(() => { const button = document.querySelector('[data-testid="form-save"]'); const bounds = button?.getBoundingClientRect(); return bounds && bounds.top >= 0 && bounds.bottom <= window.innerHeight; });
    const header = await page.getByTestId('sheet-header').boundingBox();
    assert(header && header.y >= 0 && header.y + header.height < 1000, `Title hidden in ${entity} form`);
    const inputs = await page.locator('[data-testid^="lt-title-"]').all();
    for (const input of inputs) { const bounds = await input.boundingBox(); assert(bounds.height >= 40 && bounds.height <= 48, `Oversized input in ${entity}`); }
    const save = await page.getByTestId('form-save').boundingBox();
    assert(save && save.y >= 0 && save.y + save.height <= 1000, `Save hidden in ${entity} form`);
    await page.getByText('Annuler', { exact: true }).last().click();
  }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const layout of ['grid', 'masonry', 'editorial', 'carousel']) {
    await seed('doc:settings', { ...settings, galleryLayout: layout });
    await go('/explore');
    const category = page.locator('[data-testid^="cat-"]').first();
    await category.waitFor();
    await category.click();
    await page.locator('[data-testid^="ins-"]').first().waitFor();
    if (layout !== 'carousel') await page.getByTestId(`gallery-${layout}`).waitFor();
    else await page.getByTestId('carousel-next').first().waitFor();
  }
  await go('/explore');
  const next = page.getByTestId('carousel-next').first();
  await next.waitFor();
  await next.click();
  await page.waitForTimeout(500);
  assert.equal(await page.getByTestId('carousel-previous').first().getAttribute('aria-disabled'), null);

  // One-time palette upgrades preserve customized records and deliberate deletions.
  const migration = await browser.newPage();
  await migration.addInitScript(() => {
    if (!localStorage.getItem('migration-test')) {
      localStorage.setItem('dwira:v1:palettes', JSON.stringify([{ id: 'pal_neutral', title: { dar: 'محايد', ar: 'محايد', fr: 'Edited palette' }, colors: ['#123456'], order: 42, visible: false, isSurprise: false }]));
      localStorage.setItem('migration-test', 'yes');
    }
    localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  });
  await migration.goto(`${base}/admin/palettes`); await migration.getByTestId('crud-add').waitFor();
  let migrated = await migration.evaluate(() => JSON.parse(localStorage.getItem('dwira:v1:palettes')));
  assert.equal(migrated.length, 11);
  assert.equal(migrated[0].title.fr, 'Edited palette'); assert.equal(migrated[0].order, 42); assert.equal(migrated[0].visible, false);
  await migration.evaluate(() => localStorage.setItem('dwira:v1:palettes', JSON.stringify(JSON.parse(localStorage.getItem('dwira:v1:palettes')).filter((row) => row.id !== 'pal_linen'))));
  await migration.reload(); await migration.getByTestId('crud-add').waitFor();
  migrated = await migration.evaluate(() => JSON.parse(localStorage.getItem('dwira:v1:palettes')));
  assert.equal(migrated.length, 10);
  assert(!migrated.some((row) => row.id === 'pal_linen'));
  await migration.getByTestId('crud-batch-add').click();
  await migration.getByTestId('batch-titles').fill(Array.from({ length: 51 }, (_, i) => `Title ${i}`).join('\n'));
  assert.equal(await migration.getByTestId('batch-save').getAttribute('aria-disabled'), 'true');
  await migration.close();
  assert.equal((await fetch(`${base}/assets/missing-regression.ttf`)).status, 404);

  // Hiding home filters never hides tools, including those assigned to hidden tabs.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go('/', 'brand-mark');
  const toolCount = await page.locator('[data-testid^="tool-tool_"]').count();
  await page.getByTestId('hometab-tab_interior').click();
  await go('/admin/tabs', 'home-tabs-visible');
  await page.getByTestId('home-tabs-visible').click();
  await page.getByTestId('admin-draft-submit').click();
  await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
  await go('/', 'brand-mark');
  assert.equal(await page.locator('[data-testid^="hometab-"]').count(), 0);
  assert.equal(await page.locator('[data-testid^="tool-tool_"]').count(), toolCount);
  await go('/admin/tabs', 'home-tabs-visible');
  await page.getByTestId('home-tabs-visible').click();
  await page.getByTestId('admin-draft-submit').click();
  await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });

  // Mobile request cards, bulk panel and title-paste creation stay inside the viewport.
  for (const lang of ['fr', 'ar']) {
    await seed('lang', lang);
    await page.setViewportSize({ width: 375, height: 900 });
    await go('/admin/requests', 'req-auto');
    const card = page.getByTestId('req-req_1');
    const box = await card.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= 375 && box.height > 120);
    await go('/admin/tabs', 'crud-add');
    const row = page.getByTestId('row-tab_interior');
    const bounds = await row.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 16);
    await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
    await page.getByTestId('bulk-panel').waitFor();
    const panel = await page.getByTestId('bulk-panel').boundingBox();
    assert(panel.x >= 0 && panel.x + panel.width <= 375 && panel.y + panel.height <= 900);
    await page.getByTestId('bulk-done').click();
    assert.equal(await page.getByTestId('bulk-panel').count(), 0);
    await page.getByTestId('crud-batch-add').click();
    await page.getByTestId('batch-titles').fill('Mobile A\nMobile B');
    await page.waitForFunction(() => document.querySelector('[data-testid="batch-save"]').getBoundingClientRect().bottom <= innerHeight);
    assert.equal(await page.getByTestId('batch-titles').inputValue(), 'Mobile A\nMobile B');
    await page.getByTestId('sheet-header').getByRole('button').click();
    await page.getByTestId('unsaved-discard').click();
    await page.getByTestId('batch-save').waitFor({ state: 'hidden' });
  }
  // Slider origin follows its heading direction; controls sit at the image sides.
  for (const lang of ['fr', 'ar']) {
    await seed('lang', lang);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go('/explore');
    await page.getByTestId('carousel-next').first().waitFor();
    await page.waitForTimeout(700);
    const first = await page.getByTestId('cat-cat_living').boundingBox();
    const second = await page.getByTestId('cat-cat_nursery').boundingBox();
    assert(lang === 'ar' ? first.x > second.x : first.x < second.x);
    const arrow = await page.getByTestId('carousel-next').first().boundingBox();
    assert(arrow.y > first.y && arrow.y + arrow.height < first.y + first.height);
    await page.getByTestId('carousel-next').first().click(); await page.waitForTimeout(500);
    assert.notEqual(await page.getByTestId('carousel-previous').first().getAttribute('aria-disabled'), 'true');
    const before = await page.getByTestId('cat-cat_living').boundingBox();
    assert(lang === 'ar' ? before.x > first.x : before.x < first.x);
  }
  const scrollColor = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--scroll-accent'));
  assert(scrollColor.trim().startsWith('#'));

  assert.deepEqual(errors, []);
  console.log('PASS: preview-only storage, Save/Discard/Cancel on browser/in-app Back, exact search, remembered controls/page/menu scroll, 2x2 exhibition cards, ten font specimens, direct routes/refresh/login, asset 404s, safe palette upgrades, shared text-paste creation/limits, long-press selection, isolated row actions, bulk add/edit/move/delete, home-tab visibility, mobile request spacing, compact dialogs, theme scroll colors, uploaded logos, video autoplay, fonts, galleries and RTL side controls');
  await browser.close();
}
main().catch((error) => { console.error(error); process.exit(1); });
