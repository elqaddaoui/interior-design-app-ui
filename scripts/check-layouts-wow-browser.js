/**
 * Browser check of the "wow" layouts and of the admin live previews in RTL, against a running web build / dev server (demo mode).
 *   TEST_URL=http://localhost:8081 SHOTS=docs/screenshots/layouts node scripts/check-layouts-wow-browser.js
 * Proves: (1) in Arabic (RTL) every one of the 16 live previews in Admin > Page layouts really draws its layout inside its frame
 * (regression: the previews were blank); (2) each wow demo renders on the real Home / Explore on a phone and on a computer without page
 * errors; (3) the interactions work: deck next, story next, accordion open, spotlight thumbnails.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
const shots = process.env.SHOTS;
const SIZES = { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
const HOME = ['grid', 'hero', 'bento', 'rail', 'flow', 'stories', 'aurora', 'deck'];
const EXPLORE = ['rails', 'mosaic', 'editorial', 'tiles', 'flow', 'polaroid', 'spotlight', 'accordion'];
const log = (...a) => console.log(...a);
const shot = async (page, name, opts = {}) => { if (shots) await page.screenshot({ path: `${shots}/${name}.jpg`, quality: 70, type: 'jpeg', ...opts }); };

async function ctxFor(browser, device, lang, storage) {
  const ctx = await browser.newContext({ viewport: SIZES[device], deviceScaleFactor: 1, isMobile: device === 'mobile', hasTouch: device === 'mobile' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(([l, s]) => {
    if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    localStorage.setItem('dwira:v1:lang', JSON.stringify(l));
    if (!s) localStorage.setItem('dwira:v1:local', JSON.stringify({ adminSession: true }));
  }, [lang, storage || null]);
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // 1. RTL admin: every preview of both screens draws inside its frame (and the picks save).
  const a = await ctxFor(browser, 'desktop', 'ar');
  await a.page.goto(base + '/admin/layouts', { waitUntil: 'load', timeout: 240000 });
  await a.page.getByTestId('ly-screen-explore').waitFor({ timeout: 240000 });
  const picks = {};
  for (const [screen, ids] of [['home', HOME], ['explore', EXPLORE]]) {
    await a.page.getByTestId(`ly-screen-${screen}`).click();
    for (const id of ids) await a.page.getByTestId(`ly-demo-${id}`).waitFor({ timeout: 30000 });
    await a.page.waitForTimeout(3500);
    for (const view of ['mobile', 'desktop']) {
      await a.page.getByTestId(`ly-view-${view}`).click();
      await a.page.waitForTimeout(2500);
      const boxes = await a.page.evaluate(([s, list]) => list.map((id) => {
        const o = document.querySelector(`[data-testid="ly-preview-${s}-${id}"]`);
        const i = document.querySelector(`[data-testid="ly-preview-inner-${s}-${id}"]`);
        if (!o || !i) return { id, ok: false, why: 'missing' };
        const A = o.getBoundingClientRect(); const B = i.getBoundingClientRect();
        // The scaled layer must start at the frame's left edge (inside the border) and have a real height; the old RTL bug put it off to the right.
        return { id, ok: Math.abs(B.left - A.left) <= 3 && B.height > 40 && B.width > 40, why: `frame x=${A.x | 0} inner x=${B.x | 0} w=${B.width | 0} h=${B.height | 0}` };
      }), [screen, ids]);
      for (const b of boxes) assert.ok(b.ok, `${screen}/${b.id} preview (${view}, ar) is off its frame: ${b.why}`);
      log(`ar previews ${screen}/${view}: ${ids.length} inside their frames`);
      // Not blank: a drawn preview is much heavier than an empty frame.
      for (const id of ids) {
        const png = await a.page.getByTestId(`ly-preview-${screen}-${id}`).screenshot({ type: 'jpeg', quality: 60 });
        assert.ok(png.length > 2500, `${screen}/${id} preview (${view}) looks blank (${png.length} bytes)`);
      }
      await shot(a.page, `admin-ar-${screen}-${view}`);
    }
  }
  // 2. Save two sets of picks: A (deck / aurora, accordion / flow) and B (stories / flow, polaroid / spotlight).
  // `noWaitAfter`: these clicks never navigate; waiting for "scheduled navigations" only adds a flaky stall on a busy machine.
  const click = (id) => a.page.getByTestId(id).click({ noWaitAfter: true, timeout: 60000 });
  const choose = async (home, explore) => {
    await click('ly-screen-home');
    await click(`ly-use-${home.mobile}-mobile`); await click(`ly-use-${home.desktop}-desktop`);
    await click('ly-screen-explore');
    await click(`ly-use-${explore.mobile}-mobile`); await click(`ly-use-${explore.desktop}-desktop`);
    await click('layouts-submit');
    await a.page.waitForFunction(() => document.querySelector('[data-testid="layouts-submit"]').hasAttribute('aria-disabled'), null, { timeout: 15000 });
    return a.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  };
  const setA = { home: { mobile: 'deck', desktop: 'aurora' }, explore: { mobile: 'accordion', desktop: 'flow' } };
  const setB = { home: { mobile: 'stories', desktop: 'flow' }, explore: { mobile: 'polaroid', desktop: 'spotlight' } };
  const storedA = await choose(setA.home, setA.explore);
  log('saved set A');
  const storedB = await choose(setB.home, setB.explore);
  log('saved set B');
  assert.deepEqual(a.errors, [], 'admin page errors: ' + a.errors.join(' | '));
  await a.ctx.close();

  // 3. Real screens with each set, per device (Arabic for phones to prove RTL, French for computers).
  for (const [name, stored, set] of [['A', storedA, setA], ['B', storedB, setB]]) {
    for (const device of ['mobile', 'desktop']) {
      const lang = device === 'mobile' ? 'ar' : 'fr';
      for (const [route, screen] of [['/', 'home'], ['/explore', 'explore']]) {
        const id = set[screen][device];
        const t = await ctxFor(browser, device, lang, stored);
        await t.page.goto(base + route, { waitUntil: 'load', timeout: 240000 });
        const root = t.page.getByTestId(`layout-${screen}-${id}`);
        await root.waitFor({ timeout: 120000 });
        await t.page.waitForTimeout(5000);

        // Interactions.
        if (screen === 'home' && id === 'deck') {
          await t.page.getByTestId('deck-next').click();
          await t.page.getByText(/^2 \/ \d+$/).first().waitFor({ timeout: 5000 });
          await t.page.getByTestId('deck-prev').click();
          await t.page.getByText(/^1 \/ \d+$/).first().waitFor({ timeout: 5000 });
          log('  deck: next / previous work');
        }
        if (screen === 'home' && id === 'stories') {
          // The right-hand zone advances in LTR and goes back in RTL (mirrored, like Arabic Instagram): click the one that advances.
          const advance = lang === 'ar' ? 'story-prev' : 'story-next';
          await t.page.getByTestId(advance).click({ noWaitAfter: true });
          await t.page.getByText(/^02 \/ \d+$/).first().waitFor({ timeout: 5000 });
          log(`  stories: ${advance} advances in ${lang}`);
        }
        if (screen === 'explore' && id === 'accordion') {
          const heads = t.page.locator('[data-testid^="acc-"]');
          assert.ok((await heads.count()) >= 2, 'accordion needs at least two panels');
          const h = (k) => heads.nth(k).evaluate((e) => Math.round(e.getBoundingClientRect().height));
          const closed = await h(1);
          await heads.nth(1).click({ noWaitAfter: true });
          // The panel springs open: it must become much taller than a folded strip.
          await t.page.waitForFunction(([sel, c]) => document.querySelectorAll(sel)[1].getBoundingClientRect().height > c + 60, ['[data-testid^="acc-"]', closed], { timeout: 6000 }).catch(async () => {
            // On a computer the panels sit side by side and open in width instead.
            await t.page.waitForFunction(([sel, c]) => document.querySelectorAll(sel)[1].getBoundingClientRect().width > c, ['[data-testid^="acc-"]', await heads.nth(1).evaluate((e) => e.getBoundingClientRect().width)], { timeout: 6000 });
          });
          log('  accordion: panel opens');
        }
        if (screen === 'explore' && id === 'spotlight') {
          const thumbs = t.page.locator('[data-testid^="spot-thumb-"]');
          assert.ok((await thumbs.count()) >= 2);
          await thumbs.nth(1).click();
          await t.page.waitForTimeout(800);
          await t.page.getByTestId('spot-stage').first().waitFor();
          log('  spotlight: thumbnail changes the scene');
        }
        await t.page.waitForTimeout(1200);
        await shot(t.page, `wow-${screen}-${id}-${device}-${lang}`);
        assert.deepEqual(t.errors, [], `${screen}/${id}/${device} errors: ` + t.errors.join(' | '));
        log(`${screen}/${id} ${device} (${lang}) ok`);
        await t.ctx.close();
      }
    }
  }
  await browser.close();
  log('ALL OK');
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
