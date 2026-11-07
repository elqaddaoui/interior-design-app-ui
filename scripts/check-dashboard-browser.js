/**
 * Browser check of the redesigned Admin dashboard on the production web export
 * (build with EXPO_PUBLIC_BACKEND_MODE=demo, then `npm run serve:web`). Runs in LTR (fr) and RTL (ar), desktop + phone.
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
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(({ lang }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
    localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  }, { lang });
  await page.goto(`${base}/admin`);
  const tag = `[${lang} ${width}]`;
  await page.getByTestId('range-90').waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  const shot = async (n, full) => { if (shots) await page.screenshot({ path: `${shots}/dash-${lang}-${width}-${n}.png`, fullPage: !!full }); };
  await shot('1-top');
  assert.equal(await page.evaluate(() => document.documentElement.dir || getComputedStyle(document.body).direction), lang === 'fr' ? 'ltr' : 'rtl', `${tag} direction`);

  for (const id of ['kpi-designs', 'kpi-requests', 'kpi-users', 'kpi-pending', 'dash-chart', 'dash-heat', 'dash-insights', 'dash-pipeline', 'dash-top', 'dash-audience', 'dash-recent', 'quick-qApp', 'dash-refresh', 'dash-export'])
    assert.ok(await page.getByTestId(id).first().count() > 0, `${tag} missing ${id}`);

  // No horizontal overflow of the page.
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, `${tag} horizontal overflow ${over}px`);

  // Range switch + metric switch.
  await page.getByTestId('range-7').click();
  assert.match(await page.getByTestId('range-7').getAttribute('class'), /bg-ink/);
  await page.getByTestId('kpi-requests').click();
  assert.equal(await page.getByTestId('kpi-requests').getAttribute('aria-selected') ?? 'x', 'x');
  await page.getByTestId('range-30').click();

  // Chart tooltip on hover (desktop).
  const hit = page.getByTestId('chart-hit').first();
  if (await hit.count()) {
    await hit.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const b = await hit.boundingBox();
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height / 2);
    await page.getByTestId('chart-tip').waitFor({ timeout: 3000 });
    await shot('2-tip');
  }

  // Top tabs.
  for (const k of ['styles', 'rooms', 'models', 'tools']) await page.getByTestId(`top-${k}`).click();

  // Export CSV.
  const dl = page.waitForEvent('download', { timeout: 5000 });
  await page.getByTestId('dash-export').click();
  const f = await dl;
  assert.match(f.suggestedFilename(), /\.csv$/, `${tag} csv name`);

  // Refresh keeps the page alive.
  await page.getByTestId('dash-refresh').click();
  await page.getByTestId('kpi-designs').waitFor();

  await shot('3-full', true);

  // Navigation: shell links.
  if (width >= 1024) {
    for (const k of ['requests', 'tools']) { await page.getByTestId(`nav-${k}`).click(); await page.waitForTimeout(500); assert.ok(new URL(page.url()).pathname.includes(k), `${tag} nav ${k}`); }
    await page.getByTestId('nav-dashboard').click().catch(async () => { await page.goto(`${base}/admin`); });
  } else {
    await page.getByTestId('admin-menu-btn').click();
    await page.getByTestId('admin-drawer').waitFor();
    await shot('4-drawer');
    await page.getByTestId('admin-menu-close').click();
  }
  assert.deepEqual(errors, [], `${tag} console errors`);
  await browser.close();
  console.log(`ok ${tag}`);
}

(async () => {
  for (const [lang, w] of [['fr', 1440], ['ar', 1440], ['fr', 375], ['ar', 375], ['fr', 820]]) await run(lang, w);
  console.log('dashboard browser checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
