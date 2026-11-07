/* Production regression tests for exit safety, search scope/settings, draft details and RTL. */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
async function main() {
  const browser = await chromium.launch();
  const errors = [];
  for (const lang of ['fr', 'ar', 'dar']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(lang => {
      if (localStorage.getItem('safety-test')) return;
      localStorage.setItem('safety-test', '1');
      localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
      localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
      localStorage.setItem('dwira:v1:users', JSON.stringify([{ id: 'usr_admin', name: 'Admin', whatsapp: '', credits: 0, role: 'admin', createdAt: Date.now() }, { id: 'private-admin-record', name: 'PrivateSearchSentinel', whatsapp: '000000000', credits: 2, role: 'user', createdAt: Date.now() }]));
    }, lang);
    const go = async (path, id) => { await page.goto(`${base}${path}`); await page.getByTestId(id).first().waitFor(); };
    const search = async query => { await page.getByTestId('global-search-open').click(); await page.getByTestId('global-search-input').fill(query); };
    const message = { fr: 'Offre spéciale à conserver', ar: 'العرض الحالي مهم', dar: 'حافظ على العرض ديالك' };
    await go('/admin/interface', 'interface-submit');
    assert.equal(await page.getByTestId('exit-message').count(), 0);
    assert.equal(await page.getByTestId('exit-edit-panel').count(), 0, 'the exit message editor is hidden until clicked');
    await page.getByTestId('exit-edit-toggle').click();
    for (const locale of ['fr', 'ar', 'dar']) await page.getByTestId(`lt-exitMessage-${locale}`).fill(message[locale]);
    await page.getByTestId('interface-submit').click();
    await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
    await search('PrivateSearchSentinel');
    await page.getByTestId('global-result-private-admin-record').waitFor();
    await page.getByTestId('sheet-close').click();
    await go('/', 'brand-mark');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const box = await page.getByTestId('global-search-open').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 1000);
      assert(lang === 'fr' ? box.x > width / 2 : box.x < width / 2, `Wrong search corner for ${lang}`);
    }
    await search('PrivateSearchSentinel');
    await page.waitForTimeout(150);
    assert.equal(await page.getByTestId('global-result-private-admin-record').count(), 0, 'Private admin content leaked into app search');
    await page.getByTestId('sheet-close').click();
    await page.evaluate(() => history.back());
    await page.getByTestId('exit-message').waitFor();
    assert.equal(await page.getByTestId('exit-message').innerText(), message[lang]);
    await page.getByTestId('exit-stay').click();
    assert.equal(new URL(page.url()).pathname, '/');
    await page.evaluate(() => history.back());
    await page.getByTestId('exit-leave').click();
    await page.getByTestId('interface-submit').waitFor();
    assert.equal(await page.getByTestId('exit-message').count(), 0, 'Offer exit dialog appeared in admin');
    await search('PrivateSearchSentinel');
    await page.getByTestId('sheet-close').click();
    // App setting cannot disable admin search, and vice versa; each persists independently.
    await page.getByTestId('setting-appSearchEnabled').click();
    await page.getByTestId('interface-submit').click();
    await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('global-search-open').count(), 1);
    await go('/', 'brand-mark');
    assert.equal(await page.getByTestId('global-search-open').count(), 0);
    await go('/admin/interface', 'interface-submit');
    await page.getByTestId('setting-appSearchEnabled').click();
    await page.getByTestId('setting-adminSearchEnabled').click();
    await page.getByTestId('interface-submit').click();
    await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('global-search-open').count(), 0);
    await go('/', 'brand-mark');
    assert.equal(await page.getByTestId('global-search-open').count(), 1);
    await go('/admin/tools', 'crud-add');
    await page.getByTestId('edit-tool_interior').click();
    const oldValue = await page.getByTestId(`lt-title-${lang}`).inputValue();
    const newValue = `${oldValue} 123`;
    await page.getByTestId(`lt-title-${lang}`).fill(newValue);
    await page.getByTestId('sheet-close').click();
    await page.getByTestId('unsaved-differences').waitFor();
    assert((await page.getByTestId('change-old-0').innerText()).includes(oldValue));
    assert((await page.getByTestId('change-new-0').innerText()).includes(newValue));
    assert.equal(await page.getByTestId('unsaved-differences').locator('[data-testid^="change-old-"]').count(), 1, 'Unchanged values were listed');
    const dir = await page.getByTestId('unsaved-differences').evaluate(el => getComputedStyle(el).direction);
    assert.equal(dir, lang === 'fr' ? 'ltr' : 'rtl');
    const saveText = await page.getByTestId('unsaved-save').innerText();
    assert.equal(saveText, { fr: 'Enregistrer les modifications', ar: 'حفظ التغييرات', dar: 'حفظ التغييرات' }[lang]);
    await page.getByTestId('unsaved-cancel').click();
    assert.equal(await page.getByTestId(`lt-title-${lang}`).inputValue(), newValue);
    await page.getByTestId('sheet-close').click();
    await page.getByTestId('unsaved-discard').click();
    await page.getByTestId('form-save').waitFor({ state: 'hidden' });
    await page.getByTestId('edit-tool_interior').click();
    assert.equal(await page.getByTestId(`lt-title-${lang}`).inputValue(), oldValue);
    await page.getByTestId(`lt-title-${lang}`).fill(newValue);
    await page.getByTestId('sheet-close').click();
    await page.getByTestId('unsaved-save').click();
    await page.getByTestId('form-save').waitFor({ state: 'hidden' });
    await page.reload();
    await page.getByTestId('edit-tool_interior').click();
    assert.equal(await page.getByTestId(`lt-title-${lang}`).inputValue(), newValue);
    await page.getByTestId('sheet-close').click();
    for (const entity of ['tabs', 'tools', 'sections', 'roomTypes', 'palettes', 'models']) {
      await go(`/admin/${entity}`, 'crud-add');
      const edit = page.locator('[data-testid^="edit-"]').first();
      const id = (await edit.getAttribute('data-testid')).slice(5);
      const boxes = await Promise.all(['edit', 'del', 'toggle'].map(prefix => page.getByTestId(`${prefix}-${id}`).boundingBox()));
      assert(boxes.every(box => Math.abs(box.y - boxes[0].y) < 1), `Action row wrapped on ${entity} (${lang})`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS: all three languages, exact changes, Save/Discard/Cancel, app-only Stay/Leave, persisted custom offer messages, isolated search/settings, responsive LTR/RTL corners and six compact admin action rows');
}
main().catch(error => { console.error(error); process.exit(1); });
