/* Exported app + real backend (node server/index.js, PGLITE_DIR=:memory:, STATIC_DIR=dist, default admin/admin).
 * Covers the admin chat inbox (open the right conversation, reply), the notification switches and the Moroccan loader tiles. */
const assert = require('node:assert/strict');
const { chromium, request } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8080';

async function login(page) {
  await page.goto(`${base}/admin`);
  await page.getByTestId('admin-email').fill('admin');
  await page.getByTestId('admin-password').fill('admin');
  await page.getByTestId('admin-signin').click();
  await page.getByTestId('kpi-pending').waitFor();
  await page.goto(`${base}/admin/requests`); // the notifications panel lives on the requests page, not the dashboard
  await page.getByTestId('push-enable').waitFor();
}
async function client(name, phone) {
  const api = await request.newContext({ baseURL: base });
  const res = await api.post('/api/user/login', { data: { name, phone } });
  assert.equal(res.status(), 200);
  return { api, id: (await res.json()).user.id };
}

async function main() {
  const browser = await chromium.launch({ channel: 'chromium' });
  const errors = [];
  const amine = await client('Amine Test', '0611111111'), bouchra = await client('Bouchra Test', '0622222222');
  const post = async (c, text) => (await (await c.api.post('/api/user/conversations', { data: { title: text, messages: [{ id: `m-${text}`, role: 'user', text, createdAt: Date.now() }], updatedAt: Date.now() } })).json()).id;
  const idA = await post(amine, 'Bonjour salon'), idB = await post(bouchra, 'Bonjour cuisine');
  assert.notEqual(idA, idB);

  for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 1000 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => localStorage.setItem('dwira:v1:lang', JSON.stringify('fr')));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await login(page);

    // Deep link from a notification opens the right conversation and the admin can answer it.
    await page.goto(`${base}/admin/chats?target=${idA}&open=${idA}`);
    await page.getByTestId('admin-chat-input').waitFor();
    assert((await page.locator('body').innerText()).includes('Bonjour salon'));
    assert(await page.getByTestId('admin-chat-missing').count() === 0, 'the target conversation exists');
    const reply = `Reponse ${name} ${Date.now()}`;
    await page.getByTestId('admin-chat-input').fill(reply);
    await page.getByTestId('admin-chat-send').click();
    await page.getByTestId('admin-msg-admin').first().waitFor();
    const mine = await (await amine.api.get('/api/user/conversations')).json();
    assert(mine.find(c => c.id === idA).messages.some(m => m.role === 'admin' && m.text === reply), 'the client receives the reply');
    const other = await (await bouchra.api.get('/api/user/conversations')).json();
    assert(!JSON.stringify(other).includes(reply), 'another client never sees it');

    // Notification switches: independent, persisted, reflected in the subscribers panel.
    await page.goto(`${base}/admin/notifications`);
    await page.getByTestId('notify-notifyAdmins').waitFor();
    await page.getByTestId('notify-notifyUsers').click();
    await page.getByTestId('notif-tab-devices').click();
    await page.getByTestId('notify-users-paused').waitFor();
    await page.getByTestId('notifications-submit').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="notifications-submit"]')?.getAttribute('aria-disabled') === 'true', null, { timeout: 15000 });
    await page.reload();
    await page.getByTestId('notif-tab-devices').click();
    await page.getByTestId('notify-users-paused').waitFor();
    assert.equal(await page.getByTestId('notify-notifyAdmins').getAttribute('aria-checked'), 'true', 'the admin switch is independent');
    await page.getByTestId('notify-notifyUsers').click();
    await page.getByTestId('notifications-submit').click();
    await page.getByTestId('notify-users-paused').waitFor({ state: 'hidden' });
    await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });

    // New Moroccan loaders are selectable and render.
    await page.goto(`${base}/admin/interface`);
    // Each pass ends on a different style so the final pick is always a real change from what the previous pass saved.
    for (const style of mobile ? ['mosaic', 'zellige', 'arch', 'lantern'] : ['lantern', 'arch', 'zellige', 'mosaic']) {
      const tile = page.getByTestId(`loader-style-${style}`);
      await tile.scrollIntoViewIfNeeded();
      await tile.click();
      assert.match(await tile.getAttribute('class'), /border-primary/, `${style} tile is selected`);
    }
    await page.getByTestId('admin-draft-bar').waitFor();
    await page.getByTestId('interface-submit').click();
    await page.getByTestId('admin-draft-bar').waitFor({ state: 'hidden' });
    await context.close();
    console.log(`PASS ${name}: chat deep link + reply, notification switches persist, loader styles selectable`);
  }
  await amine.api.dispose(); await bouchra.api.dispose();
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('PASS inbox browser checks');
}
main().catch(error => { console.error(error); process.exit(1); });
