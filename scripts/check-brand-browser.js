/**
 * Browser check of Admin > Branding on the production web export (start `npm run serve:web` first; build with EXPO_PUBLIC_BACKEND_MODE=demo).
 * Proves, in LTR (fr) and RTL (ar), on desktop and phone widths:
 *  - the page renders with the live preview, the preview stays in view while the controls scroll,
 *  - an edit reaches the preview, the "unsaved" state, undo / redo / reset work,
 *  - Surprise me, publish (with confirmation), version history + rollback, export dialog,
 *  - on phones the preview can be collapsed.
 * Set SHOTS=/some/dir to save screenshots.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
const shots = process.env.SHOTS;

async function run(lang, width) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ lang }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
    localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  }, { lang });
  await page.goto(`${base}/admin/branding`);
  await page.getByTestId('brand-preview').waitFor({ timeout: 40000 });
  const shot = async (n) => { if (shots) await page.screenshot({ path: `${shots}/brand-${lang}-${width}-${n}.png` }); };
  const tag = `[${lang} ${width}]`;
  const desktop = width >= 1024;
  await page.waitForTimeout(800);
  await shot('1-initial');

  // 1. Preview scenes exist; direction follows the language.
  assert.equal(await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction), lang === 'fr' ? 'ltr' : 'rtl', `${tag} direction`);
  await page.getByTestId('pv-header').waitFor();
  if (desktop) for (const id of ['pv-sidebar', 'pv-login']) await page.getByTestId(id).waitFor();
  assert.equal(await page.getByTestId('brand-save').isDisabled(), true, `${tag} publish disabled before any change`);

  // 2. Edit -> unsaved, preview changes.
  const before = await page.getByTestId('pv-header').innerHTML();
  await page.getByTestId('brand-name').fill('Atlas Home');
  await page.waitForTimeout(400);
  assert.notEqual(await page.getByTestId('pv-header').innerHTML(), before, `${tag} preview follows the name`);
  await page.getByTestId('pv-dirty').waitFor();
  assert.equal(await page.getByTestId('brand-save').isDisabled(), false);

  // 3. Undo / redo / reset.
  await page.getByTestId('brand-name').blur();
  await page.getByTestId('undo').click();
  await page.waitForTimeout(300);
  assert.notEqual(await page.getByTestId('brand-name').inputValue(), 'Atlas Home', `${tag} undo`);
  await page.getByTestId('redo').click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('brand-name').inputValue(), 'Atlas Home', `${tag} redo`);

  // 4. Preview stays in view while the controls scroll.
  await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 200 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) el.scrollTop = 600; });
  await page.waitForTimeout(300);
  const box = await page.getByTestId('brand-preview').boundingBox();
  assert(box && box.y >= -2 && box.y < 200, `${tag} preview stays pinned (y=${box && box.y})`);
  await shot('2-scrolled');

  // 5. Surprise me changes the logo.
  await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0; });
  const pre = await page.getByTestId('pv-header').innerHTML();
  await page.getByTestId('surprise').click();
  await page.waitForTimeout(600);
  assert.notEqual(await page.getByTestId('pv-header').innerHTML(), pre, `${tag} surprise`);

  // 6. Light / dark + compare + phone collapse.
  await page.getByTestId('pv-mode-dark').click();
  await page.getByTestId('pv-compare').click();
  await page.getByTestId('pv-compare-before').waitFor();
  await shot('3-compare');
  await page.getByTestId('pv-compare').click();
  if (!desktop) { await page.getByTestId('pv-collapse').click(); await page.waitForTimeout(200); await shot('4-collapsed'); await page.getByTestId('pv-collapse').click(); }

  // 7. Reset restores the published logo.
  await page.getByTestId('reset').click();
  await page.getByText(lang === 'fr' ? 'Réinitialiser' : /./, { exact: false }).last().waitFor();
  await page.evaluate(() => { const b = [...document.querySelectorAll('[role=button],div')].filter((e) => /Réinitialiser|إعادة الضبط|رجّع/.test(e.textContent || '') && e.children.length <= 1).pop(); b && b.click(); });
  await page.waitForTimeout(500);
  assert.equal(await page.getByTestId('brand-save').isDisabled(), true, `${tag} reset -> clean`);

  // 8. Publish with confirmation, then roll back.
  await page.getByTestId('brand-name').fill('Atlas Home');
  await page.waitForTimeout(300);
  await page.getByTestId('brand-save').click();
  await page.getByTestId('publish-confirm').waitFor();
  await shot('5-publish');
  await page.getByTestId('publish-confirm').click();
  await page.getByTestId('publish-confirm').waitFor({ state: 'hidden', timeout: 20000 });
  await page.waitForTimeout(500);
  const doc = await page.evaluate(() => JSON.parse(localStorage.getItem('dwira:v1:doc:branding') || 'null'));
  assert.equal(doc && doc.appName, 'Atlas Home', `${tag} published name`);
  assert(doc.versions && doc.versions.length >= 2, `${tag} version history recorded`);
  await page.getByTestId('history').click();
  await page.getByTestId('rollback-1').waitFor();
  await shot('6-history');
  await page.getByTestId('rollback-1').click();
  await page.waitForTimeout(500);
  assert.notEqual(await page.getByTestId('brand-name').inputValue(), 'Atlas Home', `${tag} rollback loaded into the draft`);
  assert.equal(await page.getByTestId('brand-save').isDisabled(), false, `${tag} rollback is a draft`);

  // 9. Export dialog (SVG download).
  await page.getByTestId('export').click();
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.getByTestId('export-logo').click();
  const file = await dl;
  assert.match(file.suggestedFilename(), /\.svg$/, `${tag} svg export`);
  await shot('7-export');

  assert.deepEqual(errors.filter((e) => !/favicon|manifest|net::ERR|Failed to load resource/.test(e)), [], `${tag} no page errors`);
  await browser.close();
  console.log(`ok ${tag}`);
}

(async () => {
  for (const [lang, width] of [['fr', 1440], ['ar', 1440], ['fr', 375], ['ar', 375]]) await run(lang, width);
  console.log('brand browser checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
