/**
 * Screenshots of the user Settings page and of every admin page that holds settings (analysis input).
 *   TEST_URL=http://localhost:8081 SHOTS=docs/screenshots/settings node scripts/shoot-settings.js
 */
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8081';
const out = process.env.SHOTS || 'docs/screenshots/settings';
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const PAGES = [['user-settings', '/settings', false], ['admin-interface', '/admin/interface', true], ['admin-theme', '/admin/theme', true], ['admin-notifications', '/admin/notifications', true], ['admin-performance', '/admin/performance', true], ['admin-credits', '/admin/credits', true], ['admin-assistant', '/admin/assistant', true], ['admin-dashboard', '/admin', true]];
const only = (process.env.ONLY || '').split(',').filter(Boolean);
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [device, lang] of [['mobile', 'fr'], ['desktop', 'fr'], ['mobile', 'ar']]) {
    const ctx = await browser.newContext({ viewport: SIZES[device], deviceScaleFactor: 1, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
    const page = await ctx.newPage();
    await page.addInitScript((l) => { localStorage.setItem('dwira:v1:lang', JSON.stringify(l)); localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true })); }, lang);
    for (const [name, path] of PAGES) {
      if (only.length && !only.includes(name)) continue;
      await page.goto(base + path, { waitUntil: 'load', timeout: 240000 });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${out}/${name}-${device}-${lang}.jpg`, type: 'jpeg', quality: 62, fullPage: false });
      const h = await page.evaluate(() => Math.max(...[...document.querySelectorAll('*')].map((e) => e.scrollHeight)));
      console.log(name, device, lang, 'scrollH', h);
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
