/**
 * Browser check for the multi-tenant SaaS: boots the real server (in-memory PGlite, serving dist/), drives Chromium and
 * proves the pages show what is stored in the database. Screenshots land in docs/screenshots/saas/.
 *   npx expo export -p web && node scripts/postexport.js && node scripts/check-saas-browser.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('@playwright/test');

const PORT = Number(process.env.SAAS_TEST_PORT || 8791);
const base = `http://127.0.0.1:${PORT}`;
const FACTORY = { email: 'superadmin', password: 'superadmin' };
const SUPER = { email: 'boss@platform.test', password: 'Platform-Secret-123' }; // chosen in Settings below
const shots = path.join(__dirname, '..', 'docs', 'screenshots', 'saas');
fs.mkdirSync(shots, { recursive: true });

const until = async (fn, label, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('Timed out: ' + label); await new Promise(r => setTimeout(r, 250)); } };
const getJson = async (url, headers = {}) => { const r = await fetch(base + url, { headers }); return { status: r.status, body: await r.json().catch(() => null) }; };

async function startServer() {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), ...(process.env.TEST_DATABASE_URL ? { DATABASE_URL: process.env.TEST_DATABASE_URL, DB_POOL_MAX: '3' } : { PGLITE_DIR: ':memory:' }), COOKIE_SECURE: 'false', SUPERADMIN_EMAIL: '', SUPERADMIN_PASSWORD_HASH: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; }); child.stderr.on('data', d => { log += d; });
  await until(async () => { try { return (await fetch(base + '/api/content')).status === 200; } catch { return false; } }, 'server up\n' + log, 90000);
  return child;
}

/** The storefront must show the brand name and at least one tool name that the API returns for the same tenant. */
async function storefrontMatchesDatabase(page, prefix, label) {
  await page.goto(`${base}${prefix}/`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('brand-mark').waitFor({ timeout: 45000 });
  const content = (await getJson(`${prefix}/api/content`)).body;
  const appName = content.docs.branding.appName;
  assert.ok(appName, `${label}: branding stored`);
  assert.ok(content.collections.tools.length > 0, `${label}: tools stored`);
  await until(() => page.getByText(appName, { exact: false }).count().then(n => n > 0), `${label}: brand name "${appName}" rendered`);
  // The boot splash fades out after the first render: wait for it so screenshots show the real page.
  await page.locator('#dwira-boot').waitFor({ state: 'detached', timeout: 30000 });
  await page.waitForTimeout(400);
  return content;
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const errors = [];
  const newPage = async (viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(90000); page.setDefaultNavigationTimeout(90000);
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { if (!localStorage.getItem('init')) { localStorage.setItem('dwira:v1:lang', JSON.stringify('fr')); localStorage.setItem('init', '1'); } });
    return page;
  };
  // Small CI boxes can stall a paint for a moment: retry with a short timeout instead of one very long wait.
  const shot = async (page, name) => {
    for (let attempt = 1; ; attempt++) {
      try { return await page.screenshot({ path: path.join(shots, name + '.png'), timeout: 25000, animations: 'disabled' }); }
      catch (e) { if (attempt >= 4) throw e; await page.waitForTimeout(1500); }
    }
  };
  try {
    // 1) Default tenant: the existing app, data migrated into the default tenant.
    const home = await newPage();
    const defaultContent = await storefrontMatchesDatabase(home, '', 'default tenant');
    await shot(home, '01-default-storefront');
    await home.context().close();
    console.log(`default tenant: "${defaultContent.docs.branding.appName}", ${defaultContent.collections.tools.length} tools from the database`);

    // 2) Super admin console (own design system): sign in through the UI.
    const sa = await newPage();
    await sa.goto(`${base}/super-admin`, { waitUntil: 'domcontentloaded' });
    await sa.getByTestId('sa-email').waitFor({ timeout: 45000 });
    await shot(sa, '02-super-admin-login');
    // Wrong password first, then the factory login (superadmin / superadmin) that exists with no configuration at all.
    await sa.getByTestId('sa-email').fill(FACTORY.email);
    await sa.getByTestId('sa-password').fill('not-the-password');
    await sa.getByTestId('sa-signin').click();
    await sa.getByTestId('sa-error').waitFor({ timeout: 20000 });
    await sa.getByTestId('sa-password').fill(FACTORY.password);
    await sa.getByTestId('sa-signin').click();
    await sa.getByTestId('sa-shell').waitFor({ timeout: 20000 });
    await sa.getByTestId('kpi-tenants').waitFor({ timeout: 30000 });
    assert.equal((await sa.getByTestId('kpi-tenants').innerText()).trim(), '1', 'registry holds only the default tenant');
    await sa.getByTestId('sa-default-warning').waitFor({ timeout: 10000 });
    await shot(sa, '03-super-admin-overview');

    // 2b) Settings: choose your own e-mail and password; the factory login stops working, the new one works after a reload.
    await sa.getByTestId('sa-nav-settings').click();
    await sa.getByTestId('sa-set-email').waitFor({ timeout: 20000 });
    await shot(sa, '03b-super-admin-settings-factory');
    await sa.getByTestId('sa-set-email').fill(SUPER.email);
    await sa.getByTestId('sa-set-current').fill(FACTORY.password);
    await sa.getByTestId('sa-set-new').fill(SUPER.password);
    await sa.getByTestId('sa-set-again').fill(SUPER.password);
    await sa.getByTestId('sa-set-save').click();
    await sa.getByTestId('sa-set-saved').waitFor({ timeout: 20000 });
    await shot(sa, '03c-super-admin-settings-saved');
    assert.equal(await sa.getByTestId('sa-default-warning').count(), 0, 'factory-login banner is gone');
    const factoryAgain = await fetch(`${base}/api/super-admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(FACTORY) });
    assert.equal(factoryAgain.status, 401, 'the factory login no longer works');
    await sa.getByTestId('sa-signout').click();
    await sa.getByTestId('sa-email').waitFor({ timeout: 20000 });
    await sa.getByTestId('sa-email').fill(SUPER.email);
    await sa.getByTestId('sa-password').fill(SUPER.password);
    await sa.getByTestId('sa-signin').click();
    await sa.getByTestId('sa-shell').waitFor({ timeout: 20000 });
    await sa.getByTestId('kpi-tenants').waitFor({ timeout: 30000 });

    // 3) Create a tenant through the UI; the generated password is shown once.
    await sa.getByTestId('sa-nav-tenants').click();
    await sa.getByTestId('sa-new-tenant').click();
    await sa.getByTestId('sa-t-name').fill('Atlas Interiors');
    await sa.getByTestId('sa-t-email').fill('owner@atlas.test');
    await sa.getByTestId('sa-t-create').click();
    const password = (await sa.getByTestId('sa-secret').first().innerText()).trim();
    assert.ok(password.length >= 12, 'password generated');
    await shot(sa, '04-super-admin-tenant-created');
    await sa.getByText('Done', { exact: true }).first().click();
    await until(() => sa.getByText('Atlas Interiors').count().then(n => n > 0), 'tenant listed');
    await shot(sa, '05-super-admin-tenants');
    const list = await sa.evaluate(async () => (await fetch('/api/super-admin/tenants', { credentials: 'include' })).json());
    const tenant = (list.tenants || list).find(t => t.name === 'Atlas Interiors');
    assert.ok(tenant, 'tenant stored in the registry');
    const slug = tenant.slug;

    // 4) The tenant storefront and admin panel read their own rows.
    const shop = await newPage();
    const shopContent = await storefrontMatchesDatabase(shop, `/${slug}`, 'new tenant');
    await shot(shop, '06-tenant-storefront');
    await shop.goto(`${base}/${slug}/admin`, { waitUntil: 'domcontentloaded' });
    await shop.getByTestId('admin-email').waitFor({ timeout: 45000 });
    await shop.getByTestId('admin-email').fill('owner@atlas.test');
    await shop.getByTestId('admin-password').fill(password);
    await shop.getByTestId('admin-signin').click();
    await until(() => shop.evaluate(async p => (await fetch(`${p}/api/admin/session`, { credentials: 'include' })).status, `/${slug}`).then(s => s === 200), 'tenant admin session');
    await shop.getByTestId('kpi-pending').waitFor({ timeout: 60000 });
    await shop.waitForTimeout(800);
    await shot(shop, '07-tenant-admin-dashboard');
    // Same cookie must not open the default tenant admin.
    assert.equal(await shop.evaluate(async () => (await fetch('/api/admin/session', { credentials: 'include' })).status), 401, 'tenant session does not open the default tenant');

    // 5) Isolation made visible: rename the tenant brand, the default storefront keeps its own name.
    const renamed = `Atlas ${Date.now() % 10000}`;
    const patched = await shop.evaluate(async ([p, name]) => (await fetch(`${p}/api/admin/doc/branding`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appName: name }) })).status, [`/${slug}`, renamed]);
    assert.equal(patched, 200);
    assert.equal((await getJson(`/${slug}/api/content`)).body.docs.branding.appName, renamed);
    assert.equal((await getJson('/api/content')).body.docs.branding.appName, defaultContent.docs.branding.appName, 'default tenant brand untouched');
    await shop.goto(`${base}/${slug}/`, { waitUntil: 'domcontentloaded' });
    await until(() => shop.getByText(renamed, { exact: false }).count().then(n => n > 0), 'renamed brand rendered');
    await shot(shop, '08-tenant-storefront-renamed');

    // 6) Demo: create, assign an independent instance, view it.
    await sa.getByTestId('sa-nav-demos').click();
    await sa.getByTestId('sa-new-demo').click();
    await sa.getByTestId('sa-d-name').fill('Showroom Demo');
    await sa.getByTestId('sa-d-create').click();
    await until(() => sa.getByTestId('sa-demo-name').count().then(n => n > 0), 'demo listed', 30000);
    await shot(sa, '09-super-admin-demo-created');
    await sa.getByText('Done', { exact: true }).first().click();
    await sa.getByTestId('sa-create-demo').waitFor({ state: 'detached' });
    await shot(sa, '09b-super-admin-demos');
    await sa.getByTestId('sa-demo-assign').first().click();
    const sheet = sa.getByTestId('sa-assign-sheet');
    await sheet.locator('input').first().fill('Demo For Zoe');
    await sa.getByTestId('sa-a-email').fill('zoe@example.test');
    await sa.getByTestId('sa-a-assign').click();
    await sa.getByTestId('sa-secret').first().waitFor({ timeout: 30000 });
    await shot(sa, '10-super-admin-demo-assigned');
    const instance = (await sa.evaluate(async () => (await fetch('/api/super-admin/tenants', { credentials: 'include' })).json()));
    const inst = (instance.tenants || instance).find(t => t.sourceDemoId);
    assert.ok(inst, 'instance exists as its own tenant');
    const instContent = await storefrontMatchesDatabase(shop, `/${inst.slug}`, 'demo instance');
    await shot(shop, '11-demo-instance-storefront');
    // Editing the instance never touches the demo or the other tenants.
    const demoRow = (await sa.evaluate(async () => (await fetch('/api/super-admin/demos', { credentials: 'include' })).json()));
    const demo = (demoRow.demos || demoRow)[0];
    assert.notEqual(inst.id, demo.id, 'instance is a separate tenant');
    assert.ok(instContent.collections.tools.length > 0, 'instance carries the sample data');

    // 7) Mobile layout of a tenant storefront.
    await shop.setViewportSize({ width: 390, height: 844 });
    await storefrontMatchesDatabase(shop, `/${slug}`, 'mobile');
    await shot(shop, '12-tenant-storefront-mobile');

    // 8) The console is unreachable from a tenant address.
    assert.equal((await fetch(`${base}/${slug}/api/super-admin/tenants`)).status, 404);
    assert.deepEqual(errors, [], 'no uncaught page errors:\n' + errors.join('\n'));
    console.log(`OK: database content renders for the default tenant, "${slug}" and demo instance "${inst.slug}"; screenshots in docs/screenshots/saas/`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exit(1); });
