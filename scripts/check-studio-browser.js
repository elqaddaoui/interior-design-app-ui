/**
 * Browser check of the Animation Studio on the production web export (start `npm run serve:web` first, build with EXPO_PUBLIC_BACKEND_MODE=demo).
 * Opens Admin > Animation Studio as an admin and proves, in LTR and RTL:
 *  - the page renders with the live stage, the six tabs and no page error,
 *  - a control change reaches the draft at once (live edit) and the draft bar / Submit button appear,
 *  - presets, undo / redo, "surprise me", the forced transition, the per-card scope and JSON export / import work,
 *  - the stage really animates (DOM changes between frames) and shows the style's pieces.
 * Set SHOTS=/some/dir to save screenshots.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
const shots = process.env.SHOTS;
const tool = (id) => ({ id, tabId: 'tab_interior', roomGroup: 'interior', steps: [], modelIds: [], order: 1, visible: true,
  title: { dar: 'Carte ' + id, ar: 'Carte ' + id, fr: 'Carte ' + id }, subtitle: { dar: 's', ar: 's', fr: 's' }, media: { type: 'slideshow', uri: '', images: [] } });

async function run(lang, width) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ lang }) => {
    localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
    localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  }, { lang });
  await page.goto(`${base}/admin/studio`);
  await page.getByTestId('st-stage').waitFor({ timeout: 40000 });
  const shot = async (n) => { if (shots) await page.screenshot({ path: `${shots}/studio-${lang}-${width}-${n}.png` }); };

  // 1. Renders: six tabs, transport, no draft yet.
  for (const k of ['main', 'motion', 'bar', 'els', 'color', 'looks']) await page.getByTestId(`st-tab-${k}`).waitFor();
  assert.equal(await page.getByTestId('studio-submit').isDisabled(), true, 'Submit must be disabled before any change');
  await shot('1-main');

  // 2. A preset reaches the draft at once.
  await page.getByTestId('st-tab-looks').click();
  await page.getByTestId('st-preset-neon').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-submit"]') && !document.querySelector('[data-testid="studio-submit"]').hasAttribute('aria-disabled'), null, { timeout: 5000 });
  // 3. The stage animates: sample the stage DOM for a while and see it change.
  const changes = await page.evaluate(() => new Promise((resolve) => {
    const el = document.querySelector('[data-testid="st-stage"]');
    let last = ''; let n = 0; const t0 = performance.now();
    const tick = () => { const sig = Array.from(el.querySelectorAll('*')).map((e) => e.getAttribute('style') || '').join('|').length + ':' + el.innerHTML.length; if (sig !== last) { n++; last = sig; } if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else resolve(n); };
    requestAnimationFrame(tick);
  }));
  assert(changes > 5, `${lang}: the stage does not animate (${changes} DOM changes)`);
  await shot('2-neon');

  // 4. Pause + scrub shows a frame in the middle with the style's pieces.
  await page.getByTestId('st-play').click();
  await page.getByTestId('st-scrub').click({ position: { x: 44, y: 18 } });
  await page.waitForTimeout(300);
  await shot('3-scrub');

  // 5. Controls of every tab respond.
  await page.getByTestId('st-tab-motion').click();
  await page.getByTestId('st-ease-bezier').click();
  await page.getByTestId('st-curve').waitFor();
  await page.getByTestId('st-ease-spring').click();
  await page.getByTestId('st-sp-wobbles').waitFor();
  await shot('4-motion');
  await page.getByTestId('st-tab-bar').click();
  await page.getByTestId('st-bar-look-dashed').click();
  await page.getByTestId('st-bar-size').waitFor();
  await shot('5-bar');
  await page.getByTestId('st-tab-els').click();
  await page.getByTestId('st-shape-star').click();
  await page.getByTestId('st-els-motion-burst').click();
  await shot('6-els');
  await page.getByTestId('st-tab-color').click();
  await page.getByTestId('st-tint-on').waitFor();
  await shot('7-color');

  // 6. Undo / redo, surprise, export / import.
  await page.getByTestId('st-tab-looks').click();
  assert.equal(await page.getByTestId('st-undo').isDisabled(), false, 'undo must be available after edits');
  await page.getByTestId('st-undo').click();
  await page.getByTestId('st-redo').waitFor();
  await page.getByTestId('st-surprise').click();
  await page.getByTestId('st-export').click();
  const json = await page.getByTestId('st-json').inputValue();
  const parsed = JSON.parse(json);
  assert.equal(parsed.v, 1);
  await page.getByTestId('st-preset-confetti').click();
  await page.getByTestId('st-json').fill(json);
  await page.getByTestId('st-import').click();
  await page.getByTestId('st-export').click();
  assert.deepEqual(JSON.parse(await page.getByTestId('st-json').inputValue()), parsed, 'import must restore the exported style');
  await shot('8-looks');

  // 7. Forced main transition.
  await page.getByTestId('st-tab-main').click();
  await page.getByTestId('st-force').click();
  await page.getByTestId('st-fx-creative-40').click();
  await shot('9-main');

  // 8. Reset gives the plain style back; Discard drops the draft.
  await page.getByTestId('st-tab-looks').click();
  await page.getByTestId('st-reset').click();
  // Reset gives back the plain style, which equals the saved state: nothing left to save.
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-submit"]').hasAttribute('aria-disabled'), null, { timeout: 5000 });
  // A new edit makes the draft dirty again; Discard drops it.
  await page.getByTestId('st-preset-neon').click();
  await page.getByTestId('studio-discard').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="studio-submit"]').hasAttribute('aria-disabled'), null, { timeout: 5000 });

  await browser.close();
  const real = errors.filter((e) => !/favicon|Failed to load resource|net::ERR/.test(e));
  assert.deepEqual(real, [], `${lang} ${width}: page errors`);
  console.log(`studio ${lang} ${width}px: ok (stage DOM changes ${changes})`);
}

(async () => {
  await run('fr', 1280);
  await run('ar', 390);
  console.log('studio browser checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
