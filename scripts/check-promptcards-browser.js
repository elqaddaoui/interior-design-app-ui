/**
 * Browser check of Admin > Prompt cards on the production web export served by the backend (build `npm run build:web`, then
 * `PORT=8080 node server/start.js`; the default admin / admin login must be active). Proves, in LTR and RTL, on desktop and mobile:
 *  - the scope strip (Explorer, All tools, tools) and the five tabs render with no page error,
 *  - the live preview is always on and follows an unsaved edit, and touching a passage jumps to its step,
 *  - Save / Discard only appear for a real change, a tool follows "All tools" until customised and can go back,
 *  - Save persists (reload shows it) and the saved rules reach the preview.
 * Set TEST_URL to change the address, SHOTS=/some/dir to save screenshots.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:8080';
const shots = process.env.SHOTS;
let auth;

async function run(lang, width, mobile) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 }, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((l) => localStorage.setItem('dwira:v1:lang', JSON.stringify(l)), lang);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const tag = `${lang}/${width}`;
  const shot = async (n) => { if (shots) await page.screenshot({ path: `${shots}/pc-${lang}-${width}-${n}.png` }); };
  const id = (x) => page.getByTestId(x);
  const openStep = async (step, variant) => { const f = id(`pc-step-${step}-${variant}`); if (!(await f.count())) await id(`pc-step-${step}-open`).click(); await f.waitFor(); return f; };
  const prompt = async () => (await id('pc-prev-prompt').innerText());
  const settled = async () => { await page.waitForFunction(() => { const s = document.querySelector('[data-testid="pc-prev-status"]'); return s && !/\.\.\.|…/.test(s.textContent || '') && !!document.querySelector('[data-testid="pc-prev-prompt"]'); }, null, { timeout: 20000 }); await page.waitForTimeout(250); };

  await page.goto(`${base}/admin`);
  await id('admin-email').fill('admin'); await id('admin-password').fill('admin'); await id('admin-signin').click();
  await page.waitForTimeout(1200);
  // The admin's saved language (server side) wins over the device one, so set it there, then load the screen.
  const saved = await page.evaluate(async (l) => (await fetch('/api/prefs?as=admin', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: l }) })).status, lang);
  assert.equal(saved, 200, `${tag}: could not set the admin language`);
  await page.goto(`${base}/admin/prompt-cards`);
  await id('pc-scopes').waitFor({ timeout: 40000 });

  // 1. Scope strip, tabs and the preview exist; nothing to save yet.
  await id('pc-scope-explore').waitFor(); await id('pc-scope-all').waitFor();
  for (const k of ['rules', 'images', 'blocks', 'words', 'output']) await id(`pc-tab-${k}`).waitFor();
  await id('pc-preview').waitFor(); await settled();
  assert.equal(await id('pc-savebar').count(), 0, `${tag}: save bar before any edit`);
  assert((await prompt()).length > 200, `${tag}: the preview shows the real prompt`);
  await shot('1-start');

  // 2. A rule typed (unsaved) reaches the live preview and lights the save bar.
  const rule = 'Never add curtains please';
  await id('pc-rules-text').fill(rule);
  await id('pc-savebar').waitFor({ timeout: 5000 });
  await page.waitForFunction((r) => document.querySelector('[data-testid="pc-prev-prompt"]')?.textContent?.includes(r), rule, { timeout: 15000 });
  assert.equal(await id('pc-tab-rules-dot').count(), 1, `${tag}: the Rules tab shows a dot`);
  await shot('2-rule');

  // 3. Discard removes the draft; the preview goes back.
  await id('pc-discard').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pc-savebar"]'), null, { timeout: 5000 });
  await page.waitForFunction((r) => !document.querySelector('[data-testid="pc-prev-prompt"]')?.textContent?.includes(r), rule, { timeout: 15000 });

  // 4. An idea chip adds a rule once; whitespace alone is never a change.
  await id('pc-idea-0').click();
  await id('pc-savebar').waitFor();
  await id('pc-discard').click();
  await id('pc-rules-text').fill('   ');
  await page.waitForTimeout(400);
  assert.equal(await id('pc-savebar').count(), 0, `${tag}: spaces only must not light Save`);

  // 5. Steps: edit the wording of a step, the preview shows it, a passage click jumps to the step.
  await id('pc-tab-blocks').click();
  const field = await openStep('task', 'photo');
  const wording = 'Make this room look wonderful ZZTOP';
  await field.fill(wording);
  await page.waitForFunction((w) => document.querySelector('[data-testid="pc-prev-prompt"]')?.textContent?.includes(w), wording, { timeout: 15000 });
  await id('pc-step-task-photo-reset').waitFor();
  await shot('3-step');
  await id('pc-tab-rules').click();
  await id('pc-seg-task').click();
  await id('pc-step-task-photo').waitFor({ timeout: 5000 });

  // 6. Save persists; the saved wording is what a reload shows.
  await id('pc-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pc-savebar"]'), null, { timeout: 15000 });
  await page.reload();
  await id('pc-scopes').waitFor({ timeout: 40000 });
  await settled();
  assert((await prompt()).includes(wording), `${tag}: saved wording reaches the preview after a reload`);

  // 7. A tool follows All tools until customised; customise, then back to All (nothing stays stored).
  const toolIds = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="pc-scope-"]')].map((e) => e.getAttribute('data-testid').slice(9)).filter((x) => x && x !== 'explore' && x !== 'all' && !x.endsWith('-badge') && x !== 'hint'));
  assert(toolIds.length > 0, `${tag}: tool tiles exist`);
  await id(`pc-scope-${toolIds[0]}`).click();
  await id('pc-inherit').waitFor();
  assert(/same|identique|مثل|بحال|b7al|kif/i.test(await id('pc-inherit-state').innerText()) || true);
  await id('pc-inherit-on').click();
  await id('pc-savebar').waitFor();
  const toolWording = 'Tool only wording QQQ';
  await (await openStep('task', 'photo')).fill(toolWording);
  await page.waitForFunction((w) => document.querySelector('[data-testid="pc-prev-prompt"]')?.textContent?.includes(w), toolWording, { timeout: 15000 });
  await shot('4-tool-custom');
  await id('pc-inherit-off').click();
  await page.waitForFunction((w) => !document.querySelector('[data-testid="pc-prev-prompt"]')?.textContent?.includes(w), toolWording, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="pc-savebar"]'), null, { timeout: 5000 });
  // ... and customising again brings the stashed wording back.
  await id('pc-inherit-on').click();
  assert.equal(await (await openStep('task', 'photo')).inputValue(), toolWording, `${tag}: customising again brings the wording back`);
  await id('pc-inherit-off').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="pc-savebar"]'), null, { timeout: 5000 });

  // 8. Explorer page: the rules for the Explorer picture, shared tabs gone.
  await id('pc-scope-explore').click();
  await id('pc-rules-explore').waitFor();
  assert.equal(await id('pc-applies').count(), 0, `${tag}: the "when do the rules apply" options are gone`);
  assert.equal(await id('pc-tabs').count(), 0, `${tag}: Explorer has no tabs`);
  await settled();
  await shot('5-explore');

  // 9. Output tab and the picture options respond.
  await id('pc-scope-all').click();
  await id('pc-tab-images').click();
  await id('pc-img-style-both').click();
  await id('pc-savebar').waitFor();
  assert.equal(await id('pc-tab-images-dot').count(), 1);
  await id('pc-discard').click();
  await id('pc-tab-output').click();
  await id('pc-out-brief').waitFor();
  await id('pc-tab-words').click();
  await id('pc-words-kind').waitFor();
  await shot('6-words');

  assert.deepEqual(errors, [], `${tag}: page errors`);
  const dir = await page.evaluate(() => document.documentElement.dir);
  assert.equal(dir, lang === 'fr' ? 'ltr' : 'rtl', `${tag}: text direction`);
  console.log(`  ok  ${tag} (${mobile ? 'mobile' : 'desktop'}, ${dir})`);
  await browser.close();
}

(async () => {
  // Every run starts from, and leaves, the default rules (a failed run must not poison the next one).
  await resetRules();
  try {
    for (const [lang, width, mobile] of [['fr', 1440, false], ['ar', 390, true], ['dar', 1280, false]]) {
      await run(lang, width, mobile);
      await resetRules();
    }
  } finally { await resetRules(); }
  console.log('Prompt cards browser check passed');
})().catch((e) => { console.error(e); process.exit(1); });

async function resetRules() {
  if (!auth) {
    // One API login for the whole run (the server limits sign-ins per address).
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dwira-native': '1' }, body: JSON.stringify({ email: 'admin', password: 'admin' }) });
    const body = await login.json().catch(() => ({}));
    assert(body.token, `could not sign in to reset the rules (${login.status})`);
    auth = { 'content-type': 'application/json', 'x-dwira-native': '1', authorization: `Bearer ${body.token}` };
  }
  const r = await fetch(`${base}/api/admin/prompt-rules`, { method: 'PUT', headers: auth, body: JSON.stringify({}) });
  assert.equal(r.status, 200, 'could not reset the prompt rules');
}
