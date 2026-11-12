/**
 * Browser check for the Super Admin console features: store themes, New Demo with theme previews, live demo grid, quick-access
 * icons, one-click admin hand-off, 12 console themes (persisted in the browser only) and responsive layout (no sideways scroll).
 * Boots the real server (in-memory PGlite, serving dist/). Screenshots: docs/screenshots/superadmin/.
 *   npm run build:web && node scripts/check-superadmin-browser.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');

const PORT = Number(process.env.SA_TEST_PORT || 8793);
const base = `http://127.0.0.1:${PORT}`;
const shots = path.join(__dirname, '..', 'docs', 'screenshots', 'superadmin');
fs.mkdirSync(shots, { recursive: true });
const until = async (fn, label, ms = 30000) => { const end = Date.now() + ms; for (;;) { let v = false; try { v = await fn(); } catch (e) { if (!/context was destroyed|Failed to fetch|navigation|Target (page|closed)/i.test(String(e.message))) throw e; } if (v) return v; if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise(r => setTimeout(r, 250)); } };

async function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), PGLITE_DIR: ':memory:', COOKIE_SECURE: 'false', SUPERADMIN_EMAIL: '', SUPERADMIN_PASSWORD_HASH: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  await until(async () => { try { return (await fetch(base + '/api/content')).status === 200; } catch { return false; } }, 'server up\n' + log, 90000);
  return child;
}

(async () => {
  const server = await startServer();
  let browser;
  try { browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] }); } catch (e) { server.kill(); throw e; }
  const errors = [];
  const shot = async (page, name) => { for (let i = 1; ; i++) { try { return await page.screenshot({ path: path.join(shots, name + '.png'), timeout: 25000, animations: 'disabled' }); } catch (e) { if (i >= 4) throw e; await page.waitForTimeout(1500); } } };
  const noSideScroll = async (page, label) => {
    const over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
    assert.ok(over <= 1, `${label}: page scrolls sideways by ${over}px`);
  };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(90000);
    page.on('pageerror', e => errors.push(e.message));
    const sa = async (p, o = {}) => page.evaluate(async ([p, o]) => { const r = await fetch('/api/super-admin' + p, { method: o.method || 'GET', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: o.body ? JSON.stringify(o.body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [p, o]);

    // Sign in (factory login) in the Daylight theme.
    await page.goto(`${base}/super-admin`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('sa-email').waitFor({ timeout: 60000 });
    await page.getByTestId('sa-email').fill('superadmin'); await page.getByTestId('sa-password').fill('superadmin');
    await page.getByTestId('sa-signin').click();
    await page.getByTestId('kpi-tenants').waitFor();
    assert.equal(await page.getByTestId('sa-nav-requests').count(), 0, 'Requests page is gone from the navigation');
    assert.equal(await page.getByTestId('kpi-requests').count(), 0, 'Requests tile is gone');
    assert.equal((await page.goto(`${base}/super-admin/requests`, { waitUntil: 'domcontentloaded' }), await page.getByTestId('sa-nav-requests').count()), 0);
    await page.goto(`${base}/super-admin`, { waitUntil: 'domcontentloaded' }); await page.getByTestId('kpi-tenants').waitFor();
    await shot(page, '01-overview-light');

    // A store with admin "owner" so it can be a theme source and a hand-off target.
    const made = await sa('/tenants', { method: 'POST', body: { name: 'Atlas Interiors', slug: 'atlas', ownerEmail: 'owner@atlas.test' } });
    assert.ok(made.status === 200 || made.status === 201, JSON.stringify(made.body));
    const pw = made.body.admin && made.body.admin.password;
    const second = await sa('/tenants', { method: 'POST', body: { name: 'Oasis Home', slug: 'oasis', ownerEmail: 'owner@oasis.test' } });
    assert.ok(second.status === 200 || second.status === 201);

    // Tenants: quick-access icons.
    await page.getByTestId('sa-nav-tenants').click();
    await page.getByTestId('sa-quick-admin').first().waitFor();
    assert.ok(await page.getByTestId('sa-quick-store').count() >= 3, 'every tenant row has a Store icon');
    assert.ok(await page.getByTestId('sa-quick-manage').count() >= 3, 'every tenant row has a Manage icon');
    await shot(page, '02-tenants-quick-icons');
    // Admin icon: a new tab opens on the tenant admin and lands signed in (hand-off), no password typed.
    const row = page.getByTestId('sa-manage').filter({ hasText: 'Atlas Interiors' });
    const [tab] = await Promise.all([context.waitForEvent('page'), row.getByTestId('sa-quick-admin').click()]);
    tab.setDefaultTimeout(60000);
    await until(() => /\/atlas\/admin/.test(tab.url()) && !/handoff=/.test(tab.url()), 'hand-off redeemed, code removed from the address bar', 60000);
    await until(async () => (await tab.evaluate(async () => (await fetch('/atlas/api/admin/session', { credentials: 'include' })).status)) === 200, 'tenant admin session set by hand-off', 60000);
    assert.equal(await tab.getByTestId('admin-email').count(), 0, 'no login form after the hand-off');
    await shot(tab, '03-admin-after-handoff');
    await tab.close();
    void pw;

    // Store themes page: pick two stores, create two themes, previews render.
    await page.getByTestId('sa-nav-themes').click();
    await page.getByTestId('sa-theme-add').click();
    await page.getByTestId('sa-theme-store').first().waitFor();
    await page.getByTestId('sa-theme-store').filter({ hasText: 'Atlas Interiors' }).click();
    await page.getByTestId('sa-theme-store').filter({ hasText: 'Oasis Home' }).click();
    await shot(page, '04-theme-pick');
    await page.getByTestId('sa-theme-create').click();
    await until(() => page.getByTestId('sa-theme-card').count().then(n => n === 2), 'two theme cards');
    await shot(page, '05-themes');

    // New Demo popup shows theme previews + credit limit; create with a theme.
    await page.getByTestId('sa-nav-demos').click();
    await page.getByTestId('sa-new-demo').click();
    await page.getByTestId('sa-d-theme').first().waitFor();
    assert.equal(await page.getByTestId('sa-d-theme').count(), 2, 'both themes offered as previews');
    await page.getByTestId('sa-d-name').fill('Atlas Look');
    await page.getByTestId('sa-d-limit').fill('50');
    await page.getByTestId('sa-d-theme').filter({ hasText: 'Atlas Interiors' }).click();
    await shot(page, '06-new-demo-popup');
    await page.getByTestId('sa-d-create').click();
    await until(() => page.getByTestId('sa-demo-name').count().then(n => n > 0), 'demo listed');
    const demos = (await sa('/demos')).body;
    const demo = demos.find(d => d.name === 'Atlas Look');
    assert.ok(demo, 'demo stored'); assert.equal(demo.creditLimit, 50, 'demo credit limit stored');
    await page.getByText('Done', { exact: true }).first().click();
    await page.getByTestId('sa-create-demo').waitFor({ state: 'detached' });
    assert.match(await page.getByTestId('sa-demo-credits').first().innerText(), /50/, 'credit limit shown in the demo list');
    await shot(page, '07-demos-list');

    // Live previews grid.
    await page.getByTestId('sa-view-live').click();
    await page.getByTestId('sa-live-card').first().waitFor();
    await page.locator('iframe').first().waitFor();
    await page.waitForTimeout(2500);
    await shot(page, '08-demos-live-phone');
    await page.getByTestId('sa-live-desktop').click(); await page.waitForTimeout(1500);
    await shot(page, '09-demos-live-desktop');
    // Customize on a card -> admin of the demo opens signed in.
    await page.getByTestId('sa-view-list').click();
    const [demoTab] = await Promise.all([context.waitForEvent('page'), page.getByTestId('sa-demo-customize').first().click()]);
    await until(async () => (await demoTab.evaluate(async s => (await fetch(`/${s}/api/admin/session`, { credentials: 'include' })).status, demo.slug)) === 200, 'demo admin opened with no login', 60000);
    await demoTab.close();

    // Console themes: 12 in Settings, persisted in localStorage only.
    await page.getByTestId('sa-nav-settings').click();
    await page.getByTestId('sa-theme-graphite').waitFor();
    for (const id of ['daylight', 'paper', 'mint', 'sky', 'rose', 'contrast-light', 'midnight', 'graphite', 'forest', 'ember', 'ocean', 'contrast-dark']) assert.equal(await page.getByTestId(`sa-theme-${id}`).count(), 1, id);
    await page.getByTestId('sa-theme-graphite').click();
    await until(() => page.evaluate(() => localStorage.getItem('sa-theme')).then(v => v === 'graphite'), 'choice saved in this browser');
    assert.equal((await sa('/account')).status, 200);
    await shot(page, '10-settings-dark-graphite');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('sa-theme-graphite').waitFor();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(28, 29, 31)', 'dark theme survives a reload');

    // Every theme x every page x phone/desktop: no sideways scroll; screenshots for a few.
    const ids = ['daylight', 'paper', 'mint', 'sky', 'rose', 'contrast-light', 'midnight', 'graphite', 'forest', 'ember', 'ocean', 'contrast-dark'];
    for (const [vp, w, h] of [['desktop', 1280, 900], ['tablet', 820, 1100], ['phone', 360, 740]].filter(([v]) => !process.env.SA_VIEWPORT || process.env.SA_VIEWPORT === v)) {
      await page.setViewportSize({ width: w, height: h });
      for (const id of ids) {
        await page.evaluate(i => localStorage.setItem('sa-theme', i), id);
        for (const route of ['', '/tenants', '/demos', '/themes', '/apis', '/audit', '/settings']) {
          await page.goto(`${base}/super-admin${route}`, { waitUntil: 'domcontentloaded' });
          try { await page.getByTestId('sa-shell').waitFor({ timeout: 30000 }); } catch (e) { await shot(page, `fail-${vp}-${id}`); throw new Error(`console did not render at ${vp}/${id}/${route || 'overview'} (url ${page.url()})`); }
          await page.waitForTimeout(vp === 'phone' && (id === 'ember' || id === 'contrast-light') ? 700 : 150);
          await noSideScroll(page, `${vp}/${id}/${route || 'overview'}`);
        }
        if (id === 'ember' || id === 'contrast-light') { await page.goto(`${base}/super-admin/tenants`, { waitUntil: 'domcontentloaded' }); await page.getByTestId('sa-quick-admin').first().waitFor(); await shot(page, `11-${vp}-${id}-tenants`); }
      }
    }
    // Phone: New Demo sheet fits.
    await page.evaluate(() => localStorage.setItem('sa-theme', 'midnight'));
    await page.goto(`${base}/super-admin/demos?new=1`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('sa-d-theme').first().waitFor();
    await noSideScroll(page, 'phone new demo');
    await shot(page, '12-phone-new-demo-midnight');
    await context.close();

    // Tenant admin login: readable in a dark tenant theme, LTR and RTL (screenshots reviewed manually / by contrast script).
    for (const [lang, name] of [['fr', 'fr'], ['ar', 'ar']]) {
      const c2 = await browser.newContext({ viewport: { width: 1100, height: 800 } });
      const p2 = await c2.newPage(); p2.setDefaultTimeout(60000); p2.setDefaultNavigationTimeout(90000);
      p2.on('pageerror', e => errors.push(e.message));
      await p2.addInitScript(l => { localStorage.setItem('dwira:v1:lang', JSON.stringify(l)); }, lang);
      await p2.goto(`${base}/atlas/admin/login`, { waitUntil: 'domcontentloaded' });
      await p2.getByTestId('admin-email').waitFor({ timeout: 60000 });
      await p2.locator('#dwira-boot').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
      await p2.getByTestId('admin-signin').click(); // empty submit -> error banner
      await p2.waitForTimeout(600);
      await shot(p2, `13-admin-login-${name}`);
      await c2.close();
    }
    assert.deepEqual(errors, [], 'no uncaught page errors:\n' + errors.join('\n'));
    console.log('OK: console themes, store themes, demo picker, live grid, quick icons and hand-off work; screenshots in docs/screenshots/superadmin/');
  } finally { await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
