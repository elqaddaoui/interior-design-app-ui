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
  // Live previews grid: four phones per row on a desktop-width screen (fewer on a narrow one), two desktop windows per row; the
  // cards of a row share the container's whole width and line up (same top, same height).
  const demoGrid = async (page, label, mode = 'phone') => {
    const vp = page.viewportSize().width;
    const g = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="sa-live-grid"]').getBoundingClientRect();
      const rows = [...document.querySelectorAll('[data-testid="sa-live-row"]')].map(r => [...r.querySelectorAll('[data-testid="sa-live-card"]')].map(c => { const b = c.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, h: b.height }; }));
      return { gl: grid.left, gr: grid.right, rows };
    });
    const first = g.rows[0];
    const want = mode === 'phone' ? (vp >= 1100 ? 4 : vp >= 800 ? 3 : 1) : (vp >= 1100 ? 2 : 1);
    if (vp >= 800) assert.ok(first.length >= Math.min(want, 1), `${label}/${mode}: first row`);
    for (const row of g.rows.slice(0, -1)) {
      assert.equal(row.length, first.length, `${label}/${mode}: full rows have the same number of cards`);
    }
    if (vp >= 1100 && g.rows.flat().length >= want) assert.equal(first.length, want, `${label}/${mode}: ${want} previews per row at ${vp}px (got ${first.length})`);
    if (first.length === want || g.rows.flat().length >= first.length) {
      assert.ok(Math.abs(first[0].l - g.gl) <= 1, `${label}/${mode}: first card starts at the container's edge`);
      if (g.rows[0].length === first.length && g.rows.flat().length >= want) assert.ok(Math.abs(first[first.length - 1].r - g.gr) <= 2, `${label}/${mode}: last card ends at the container's edge (fills 100%)`);
    }
    assert.ok(first.every(c => Math.abs(c.t - first[0].t) <= 1 && Math.abs(c.h - first[0].h) <= 1), `${label}/${mode}: the cards of a row line up (same top and height)`);
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
    // Two more stores so the live grid has more than four previews (a full row of four phones plus a second row).
    for (const [n, sl] of [['Berber Loft', 'berber'], ['Souk Studio', 'souk']]) { const r = await sa('/tenants', { method: 'POST', body: { name: n, slug: sl, ownerEmail: `owner@${sl}.test` } }); assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body)); }

    // Tenants: quick-access icons.
    await page.getByTestId('sa-nav-tenants').click();
    await page.getByTestId('sa-quick-admin').first().waitFor();
    assert.ok(await page.getByTestId('sa-quick-store').count() >= 3, 'every tenant row has a Store icon');
    assert.ok(await page.getByTestId('sa-quick-manage').count() >= 3, 'every tenant row has a Manage icon');
    await shot(page, '02-tenants-quick-icons');
    // Menu names: "Client Stores" and "Clone Existing Store" (they were Tenants / Store themes).
    assert.equal((await page.getByTestId('sa-nav-tenants').innerText()).trim(), 'Client Stores');
    assert.equal((await page.getByTestId('sa-nav-themes').innerText()).trim(), 'Clone Existing Store');
    assert.equal((await page.getByTestId('sa-title').innerText()).trim(), 'Client Stores');
    // Admin icon: a new tab opens on the tenant admin and lands signed in (hand-off), no password typed.
    const row = page.getByTestId('sa-manage').filter({ hasText: 'Atlas Interiors' });
    const [tab] = await Promise.all([context.waitForEvent('page'), row.getByTestId('sa-quick-admin').click()]);
    tab.setDefaultTimeout(60000);
    await until(() => /\/atlas\/admin/.test(tab.url()) && !/handoff=/.test(tab.url()), 'hand-off redeemed, code removed from the address bar', 60000);
    await until(async () => (await tab.evaluate(async () => (await fetch('/atlas/api/admin/session', { credentials: 'include' })).status)) === 200, 'tenant admin session set by hand-off', 60000);
    assert.equal(await tab.getByTestId('admin-email').count(), 0, 'no login form after the hand-off');
    await shot(tab, '03-admin-after-handoff');
    // Regression: the account row at the bottom of the store admin opens the account popover (it once crashed into an empty page:
    // a hook declared after an early return). The popover shows the name, the credits, the language chips and the exit.
    const crashes = []; tab.on('pageerror', e => crashes.push(e.message));
    await tab.getByTestId('admin-account').waitFor({ timeout: 60000 });
    await tab.getByTestId('admin-account').click();
    await tab.getByTestId('account-menu').waitFor({ timeout: 15000 });
    assert.ok(await tab.getByTestId('account-menu-credits').isVisible(), 'credits row in the account popover');
    assert.equal(await tab.getByTestId('account-menu-lang').locator('[role="radio"]').count(), 3, 'three language chips (Darija, Arabic, French)');
    assert.ok((await tab.getByTestId('admin-account').count()) === 1 && (await tab.locator('body').innerText()).length > 50, 'the page is not empty');
    assert.deepEqual(crashes, [], 'opening the account popover raises no error:\n' + crashes.join('\n'));
    await shot(tab, '03b-admin-account-popover');
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
    // The frame shows the real device layout: the page fills the whole phone screen (390x844), not just the top part.
    const frameOf = () => page.locator('iframe').first().evaluate(f => { const r = f.getBoundingClientRect(); return { w: Math.round(f.offsetWidth), h: Math.round(f.offsetHeight), vis: Math.round(r.height) }; });
    let fr = await frameOf();
    assert.deepEqual([fr.w, fr.h], [390, 844], 'phone preview keeps the real phone size (scaled by CSS only)');
    await page.getByTestId('sa-live-desktop').click(); await page.waitForTimeout(1500);
    fr = await frameOf();
    assert.deepEqual([fr.w, fr.h], [1280, 800], 'desktop preview keeps the real desktop size');
    await shot(page, '09-demos-live-desktop');
    // Stop the previews (every one is a whole app, heavy on a small CI machine), add four more demos through the API so there are five
    // (they also appear with no reload), then check the grid geometry: 2 desktop windows per row; 4 phones then 1 on the second row.
    await page.getByText('Stop previews', { exact: true }).click({ timeout: 120000 });
    for (const n of ['Demo B', 'Demo C', 'Demo D', 'Demo E']) { const r = await sa('/demos', { method: 'POST', body: { name: n } }); assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r.body)); }
    await until(() => page.getByTestId('sa-live-card').count().then(n => n === 5), 'five demo cards appear without a reload (live)', 30000);
    const rowsOf = () => page.getByTestId('sa-live-row').evaluateAll(rows => rows.map(r => r.querySelectorAll('[data-testid="sa-live-card"]').length));
    await demoGrid(page, 'demos', 'desktop');
    assert.deepEqual(await rowsOf(), [2, 2, 1], 'five desktop windows: two per row');
    await page.getByTestId('sa-live-phone').click();
    await demoGrid(page, 'demos');
    assert.deepEqual(await rowsOf(), [4, 1], 'five phones: four on the first row, one on the second');
    // Same switch on Stores and Store themes.
    await page.getByTestId('sa-nav-tenants').click();
    await page.getByTestId('sa-tenant-view').waitFor();
    await page.getByTestId('sa-view-live').click();
    await page.getByTestId('sa-live-card').first().waitFor();
    await page.locator('iframe').first().waitFor();
    await page.waitForTimeout(1500);
    await shot(page, '09b-tenants-live');
    // Stop the previews first (every one is a whole app: five at once is heavy for a small CI machine); the grid layout is the same.
    await page.getByText('Stop previews', { exact: true }).click({ timeout: 120000 });
    await demoGrid(page, 'tenants');
    await page.getByTestId('sa-view-list').click({ timeout: 120000 });
    await page.getByTestId('sa-nav-themes').click();
    await page.getByTestId('sa-theme-view').waitFor();
    await page.getByTestId('sa-view-live').click();
    await page.getByTestId('sa-live-card').first().waitFor();
    await page.waitForTimeout(1000);
    await shot(page, '09c-themes-live');
    await page.getByTestId('sa-view-list').click();
    await page.getByTestId('sa-nav-demos').click();
    // Console identity in the tab: its own icon and title, never the platform's.
    const idn = await page.evaluate(() => ({ title: document.title, icons: [...document.querySelectorAll('link[rel~="icon"]')].map(l => l.getAttribute('href')), manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') }));
    assert.equal(idn.title, 'Platform console');
    assert.deepEqual(idn.icons, ['/icons/superadmin-32.png']);
    assert.equal(idn.manifest, '/icons/superadmin.webmanifest');
    assert.equal((await fetch(base + '/icons/superadmin-32.png')).status, 200);
    assert.ok((await page.getByTestId('sa-logo').count()) >= 1, 'logo mark shown in the console');
    // Customize on a card -> admin of the demo opens signed in.
    await page.getByTestId('sa-view-list').click();
    // Newest first: "Atlas Look" was created before the four extra demos, so it is the last row.
    const [demoTab] = await Promise.all([context.waitForEvent('page'), page.getByTestId('sa-demo-customize').last().click()]);
    await until(async () => (await demoTab.evaluate(async s => (await fetch(`/${s}/api/admin/session`, { credentials: 'include' })).status, demo.slug)) === 200, 'demo admin opened with no login', 60000);
    await demoTab.close();

    // Live updates: a change made elsewhere (here: straight through the API) shows on the open page with no reload.
    await page.getByTestId('sa-nav-tenants').click();
    await page.getByTestId('sa-tenant-name').first().waitFor();
    const before = await page.getByTestId('sa-tenant-name').count();
    const live = await sa('/tenants', { method: 'POST', body: { name: 'Zellige Live', slug: 'zellige-live', ownerEmail: 'owner@zellige.test' } });
    assert.ok(live.status === 200 || live.status === 201, JSON.stringify(live.body));
    await until(() => page.getByTestId('sa-tenant-name').filter({ hasText: 'Zellige Live' }).count().then(n => n === 1), 'new store appears without a reload', 20000);
    assert.equal(await page.getByTestId('sa-tenant-name').count(), before + 1);
    await sa(`/tenants/${live.body.tenant.id}/suspend`, { method: 'POST', body: {} });
    await until(() => page.getByTestId('sa-manage').filter({ hasText: 'Zellige Live' }).innerText().then(t => /suspended/i.test(t)), 'status change appears without a reload', 20000);
    await page.getByTestId('sa-nav-overview').click();
    await page.getByTestId('kpi-tenants').waitFor();
    const kpi = async () => Number(await page.getByTestId('kpi-tenants').innerText());
    const k0 = await kpi();
    const extra = await sa('/tenants', { method: 'POST', body: { name: 'Kpi Live', slug: 'kpi-live', ownerEmail: 'owner@kpi.test' } });
    assert.ok(extra.status === 200 || extra.status === 201);
    await until(async () => (await kpi()) === k0 + 1, 'overview number updates without a reload', 20000);
    await page.getByTestId('sa-nav-audit').click();
    await page.getByTestId('sa-audit-row').first().waitFor();
    const rows0 = await page.getByTestId('sa-audit-row').count();
    await sa(`/tenants/${extra.body.tenant.id}/suspend`, { method: 'POST', body: {} });
    await until(() => page.getByTestId('sa-audit-row').count().then(n => n > rows0), 'activity list grows without a reload', 20000);

    // Language: the three app languages (Darija, Arabic, French) plus English, in Settings; kept in this browser; RTL for Arabic and Darija.
    await page.getByTestId('sa-nav-settings').click();
    for (const id of ['en', 'fr', 'ar', 'dar']) await page.getByTestId(`sa-lang-${id}`).waitFor();
    const navText = () => page.getByTestId('sa-nav-tenants').innerText().then(t => t.trim());
    const dirOf = () => page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    await page.getByTestId('sa-lang-fr').click();
    await until(async () => (await navText()) === 'Boutiques clientes', 'French menu');
    assert.deepEqual(await dirOf(), ['ltr', 'fr']);
    await page.getByTestId('sa-lang-ar').click();
    await until(async () => (await navText()) === 'متاجر العملاء', 'Arabic menu');
    assert.deepEqual(await dirOf(), ['rtl', 'ar']);
    await shot(page, '10a-settings-arabic');
    await page.getByTestId('sa-lang-dar').click();
    await until(async () => (await navText()) === 'متاجر الكليان', 'Darija menu');
    assert.deepEqual(await dirOf(), ['rtl', 'ar-MA']);
    assert.equal(await page.evaluate(() => localStorage.getItem('sa-lang')), 'dar', 'language kept in this browser only');
    await noSideScroll(page, 'darija settings');
    await shot(page, '10b-settings-darija');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(async () => (await navText()) === 'متاجر الكليان', 'Darija survives a reload');
    await page.getByTestId('sa-nav-themes').click();
    assert.equal((await page.getByTestId('sa-title').innerText()).trim(), 'نسخ متجر موجود', 'Clone Existing Store heading in Darija');
    await page.getByTestId('sa-nav-settings').click();
    await page.getByTestId('sa-lang-en').click();
    await until(async () => (await navText()) === 'Client Stores', 'back to English');
    assert.deepEqual(await dirOf(), ['ltr', 'en']);

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
    // Phone: demo rows keep their buttons and credit meter inside the card.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/super-admin/demos`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('sa-demo-name').first().waitFor();
    await noSideScroll(page, 'phone demos list');
    const spill = await page.evaluate(() => { const out = []; document.querySelectorAll('[data-testid="sa-demo-name"]').forEach(n => { let card = n; for (let i = 0; i < 6 && card.parentElement; i++) { card = card.parentElement; if (card.getBoundingClientRect().width > 300) break; } const c = card.getBoundingClientRect(); card.querySelectorAll('button,[role="button"],[data-testid]').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && (r.right > c.right + 1 || r.left < c.left - 1)) out.push(b.getAttribute('data-testid') || b.tagName); }); }); return out; });
    assert.deepEqual(spill, [], 'nothing leaves the demo card on a phone');
    await shot(page, '12a-phone-demos-list');
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
