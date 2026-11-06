/**
 * Browser check of Admin > Assistant on the production web export served by the backend (build `npm run build:web`, then
 * `PORT=8080 node server/start.js`; the default admin / admin login must be active). Proves, in LTR and RTL, desktop and mobile:
 *  - the page shows the 3-step flow and the four tabs, no model selector, and no save bar before an edit,
 *  - Providers: ranked free cards, a paid zone that stays locked without a key, before/after, a live chain summary,
 *  - Automations: starters, the editor with inline errors, the draft test box, edit / duplicate / reorder / toggle / delete,
 *    and a whole-list save that survives a reload,
 *  - Knowledge: sections open, the "does not guess" rule is shown.
 * Set TEST_URL to change the address, SHOTS=/some/dir to save screenshots.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8080';
const shots = process.env.SHOTS;
let auth;

async function api(path, method, body) {
  if (!auth) {
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dwira-native': '1' }, body: JSON.stringify({ email: 'admin', password: 'admin' }) });
    const data = await login.json().catch(() => ({}));
    assert(data.token, `could not sign in (${login.status})`);
    auth = { 'content-type': 'application/json', 'x-dwira-native': '1', authorization: `Bearer ${data.token}` };
  }
  const r = await fetch(`${base}/api${path}`, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert(r.ok, `${method} ${path} -> ${r.status}`);
  return r.json();
}
const reset = async () => {
  await api('/admin/assistant/automations', 'PUT', { items: [] });
  await api('/admin/chat/config', 'PUT', { position: 'after', freeOff: [], paid: [] });
};

async function run(lang, width, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((l) => localStorage.setItem('dwira:v1:lang', JSON.stringify(l)), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tag = `${lang}/${width}`;
  const shot = async (n) => { if (shots) await page.screenshot({ path: `${shots}/asx-${lang}-${width}-${n}.png` }); };
  const id = (x) => page.getByTestId(x);
  const none = async (x, msg) => { await page.waitForTimeout(200); assert.equal(await id(x).count(), 0, `${tag}: ${msg}`); };
  const gone = (x) => page.waitForFunction((t) => !document.querySelector(`[data-testid="${t}"]`), x, { timeout: 8000 });

  await page.goto(`${base}/admin`);
  await id('admin-email').fill('admin'); await id('admin-password').fill('admin'); await id('admin-signin').click();
  await page.waitForTimeout(1200);
  const saved = await page.evaluate(async (l) => (await fetch('/api/prefs?as=admin', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: l }) })).status, lang);
  assert.equal(saved, 200, `${tag}: could not set the admin language`);
  await page.goto(`${base}/admin/assistant`);
  await id('asx-tabs').waitFor({ timeout: 40000 });

  // 1. Structure: the flow, four tabs, no model selector, nothing to save yet.
  await id('asx-flow').waitFor();
  for (const k of ['behaviour', 'providers', 'knowledge', 'automations']) await id(`asx-tab-${k}`).waitFor();
  await id('asst-prompt').waitFor(); await id('asst-pace').waitFor();
  assert.equal(await page.locator('[data-testid*="modelId"], [data-testid="asst-model"]').count(), 0, `${tag}: the model selector is gone`);
  await none('asx-savebar', 'save bar before any edit');
  await shot('1-behaviour');

  // 2. An edit lights the save bar, Discard puts it back.
  await id('asst-prompt').fill('Be very short.');
  await id('asx-savebar').waitFor({ timeout: 5000 });
  await id('asx-discard').click(); await gone('asx-savebar');
  assert.notEqual(await id('asst-prompt').inputValue(), 'Be very short.', `${tag}: discard restores the prompt`);

  // 3. Providers: ranked free cards, paid zone locked without a key, before/after, chain summary.
  await id('asx-tab-providers').click();
  await id('asst-providers').waitFor();
  for (const p of ['gemini', 'mistral', 'groq', 'openrouter', 'pollinations']) await id(`asst-prov-${p}`).waitFor();
  await id('asst-chain').waitFor();
  assert(/./.test(await id('asst-prov-pollinations-state').innerText()), `${tag}: a state badge`);
  await id('asst-position-before').click();
  await id('asx-savebar').waitFor();
  await id('asst-position-after').click(); await gone('asx-savebar');
  await id('asst-paid-add').click();
  const card = page.locator('[data-testid^="asst-paid-paid"], [data-testid^="asst-paid-new_"]').first();
  await card.waitFor();
  const paidId = (await card.getAttribute('data-testid')).replace('asst-paid-', '');
  assert.equal(await id(`asst-paid-${paidId}-on`).getAttribute('aria-disabled'), 'true', `${tag}: the paid switch is locked until a key exists`);
  await id(`asst-paid-${paidId}-key`).fill('sk-' + 'a'.repeat(30));
  await id('asx-savebar').waitFor();
  assert.notEqual(await id(`asst-paid-${paidId}-on`).getAttribute('aria-disabled'), 'true', `${tag}: a typed key unlocks the paid switch`);
  await shot('2-providers');
  await id('asx-discard').click(); await gone('asx-savebar');
  assert.equal(await page.locator('[data-testid^="asst-paid-new_"]').count(), 0, `${tag}: discard removes the unsaved paid provider`);

  // 4. Knowledge: sections, the rule, opening one.
  await id('asx-tab-knowledge').click();
  await id('asx-k-rule').waitFor();
  await id('asx-k-about').waitFor({ timeout: 15000 });
  await id('asx-k-about-open').click();
  await page.waitForFunction(() => /Dwira/.test(document.querySelector('[data-testid="asx-k-about"]')?.textContent || ''), null, { timeout: 5000 });
  await shot('3-knowledge');

  // 5. Automations: starters, editor errors, draft test box, save, reload.
  await id('asx-tab-automations').click();
  await id('asx-empty').waitFor({ timeout: 15000 });
  await id('asx-add').click();
  await id('asx-editor').waitFor();
  await id('asx-editor-save').click();
  await id('asx-err-name').waitFor({ timeout: 5000 });
  await id('asx-err-keywords').waitFor();
  await id('asx-err-text').waitFor();
  await shot('4-editor-errors');
  await id('asx-name').fill('Delivery question');
  await id('asx-keywords').fill('livraison, delivery, توصيل');
  await id('asx-reply-template').click();
  await id('asx-text').fill('Bonjour {name|ami}, la livraison dépend de votre ville.');
  await id('asx-var-credits').click();
  assert((await id('asx-text').inputValue()).endsWith('{credits}'), `${tag}: a variable chip adds to the text`);
  await id('asx-text').fill('Bonjour {name|ami}, la livraison dépend de votre ville. {nope}');
  await id('asx-unknown-vars').waitFor();
  await id('asx-text').fill('Bonjour {name|ami}, la livraison dépend de votre ville.');
  await gone('asx-unknown-vars');
  await id('asx-draft-test-text').fill('quelle est la livraison ?');
  await id('asx-draft-test-run').click();
  await id('asx-draft-test-reply').waitFor({ timeout: 15000 });
  assert(/Amine/.test(await id('asx-draft-test-reply').innerText()), `${tag}: the draft reply is rendered with the sample client`);
  assert.equal(await id('asx-draft-test-match').count(), 1);
  await id('asx-draft-test-text').fill('bonjour');
  await id('asx-draft-test-run').click();
  await page.waitForFunction(() => /./.test(document.querySelector('[data-testid="asx-draft-test-match"]')?.textContent || ''), null, { timeout: 15000 });
  await shot('5-editor');
  await id('asx-editor-save').click();
  await gone('asx-editor');
  await id('asx-savebar').waitFor();
  await id('asst-save').click(); await gone('asx-savebar');
  await page.reload();
  await id('asx-tabs').waitFor({ timeout: 40000 });
  await id('asx-tab-automations').click();
  await id('asx-list').waitFor({ timeout: 15000 });
  const items = await api('/admin/assistant/automations', 'GET');
  assert.equal(items.items.length, 1, `${tag}: the automation was saved`);
  const a = items.items[0];
  assert.equal(a.name, 'Delivery question');
  assert.deepEqual(a.trigger.keywords, ['livraison', 'delivery', 'توصيل']);
  await id(`asx-item-${a.id}-used`).waitFor();

  // 6. Duplicate, reorder, toggle, delete.
  await id(`asx-item-${a.id}-dup`).click();
  await id('asx-savebar').waitFor();
  const ids = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="asx-item-auto_"]')].map((e) => e.getAttribute('data-testid')).filter((x) => /^asx-item-auto_[0-9a-f]+$/.test(x)).map((x) => x.slice(9)));
  assert.equal(ids.length, 2, `${tag}: duplicate adds an item`);
  const copy = ids.find((x) => x !== a.id);
  assert.equal(ids[0], a.id, `${tag}: the copy sits right after the original`);
  await id(`asx-item-${copy}-up`).click();
  await page.waitForFunction((c) => document.querySelector('[data-testid^="asx-item-auto_"]')?.getAttribute('data-testid') === `asx-item-${c}`, copy, { timeout: 5000 });
  await id(`asx-item-${copy}-on`).click();
  await id(`asx-item-${copy}-delete`).click();
  // ConfirmSheet buttons are plain pressables (no role): the red one carries the same word as the delete button's label.
  const confirm = page.getByText(/^(Supprimer|مسح|حذف|Delete)$/).last();
  await confirm.click();
  await page.waitForFunction((c) => !document.querySelector(`[data-testid="asx-item-${c}"]`), copy, { timeout: 5000 });
  // Back to the saved list: nothing left to save, so the bar goes away by itself.
  await gone('asx-savebar');
  await shot('6-list');

  assert.deepEqual(errors, [], `${tag}: page errors`);
  const dir = await page.evaluate(() => document.documentElement.dir);
  assert.equal(dir, lang === 'fr' ? 'ltr' : 'rtl', `${tag}: text direction`);
  console.log(`  ok  ${tag} (${mobile ? 'mobile' : 'desktop'}, ${dir})`);
  await browser.close();
}

(async () => {
  await reset();
  try {
    for (const [lang, width, mobile] of [['fr', 1440, false], ['ar', 390, true], ['dar', 1280, false]]) { await run(lang, width, mobile); await reset(); }
  } finally { await reset(); }
  console.log('Assistant browser check passed');
})().catch((e) => { console.error(e); process.exit(1); });
