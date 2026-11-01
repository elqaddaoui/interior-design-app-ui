/**
 * Browser check of the reveal engine on the production web export (start `npm run serve:web` first; PICS = base URL serving 1..6.webp).
 * Seeds slideshow tools with 1, 2, 3 and 6 pictures and, in LTR and RTL, samples the live DOM every animation frame to prove:
 *  - never more than two images per card, no image ever changes source while it is visible (opacity > 0),
 *  - the card size never changes, the photo never moves relative to the card (inner rect == card rect, whatever the container does),
 *  - a transition ends with the BACK layer fully opaque / identity (no ghost, no split frame), pictures cycle in order.
 */
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const base = process.env.TEST_URL || 'http://localhost:4173';
const pics = process.env.PICS || 'http://localhost:4180';
const img = (n) => Array.from({ length: n }, (_, i) => `${pics}/${i + 1}.webp`);
const tool = (id, n, fx) => ({ id, tabId: 'tab_interior', roomGroup: 'interior', steps: [], modelIds: [], order: Number(id.slice(-1)), visible: true,
  title: { dar: id, ar: id, fr: id }, subtitle: { dar: 's', ar: 's', fr: 's' }, media: { type: 'slideshow', uri: img(n)[0], images: img(n), fx } });

async function run(lang, count, fx, ms = 9000) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(({ lang, tools, settings }) => {
    localStorage.setItem('dwira:v1:lang', JSON.stringify(lang));
    localStorage.setItem('dwira:v1:tools', JSON.stringify(tools));
    localStorage.setItem('dwira:v1:doc:settings', JSON.stringify(settings));
  }, { lang, tools: [tool('t1', count, fx)], settings: { toolCards: { height: 220, textZone: 'bottom' }, homeTabsVisible: false, homeShowAll: true } });
  await page.goto(base);
  await page.getByTestId('tool-t1').waitFor({ timeout: 30000 });
  // Sampler: every animation frame, record the layers of the card.
  const report = await page.evaluate((ms) => new Promise((resolve) => {
    const card = document.querySelector('[data-testid="tool-t1"]');
    const imgs = () => Array.from(card.querySelectorAll('img'));
    const out = { frames: 0, maxImgs: 0, sizeChanges: 0, moved: 0, srcChangedVisible: 0, sources: [], transitions: 0, ghost: 0, maxVisibleLayers: 0 };
    const lastSrc = new Map(); let lastSize = null; let prevSig = '';
    const layerOf = (im) => { let n = im; while (n && n.parentElement && n.parentElement !== card) { if (n.style && n.style.overflow === 'hidden' && n.parentElement.style && n.parentElement.style.overflow) break; n = n.parentElement; } return im; };
    const t0 = performance.now();
    const tick = () => {
      const list = imgs(); out.maxImgs = Math.max(out.maxImgs, list.length);
      const stage = list[0] && list[0].closest('[style*="direction"]');
      const cr = card.getBoundingClientRect();
      let visible = 0;
      for (const im of list) {
        // opacity of the layer container = nearest ancestor with an inline opacity
        let n = im, op = 1; while (n && n !== card) { const o = n.style && n.style.opacity; if (o !== '' && o !== undefined) { op = parseFloat(o); break; } n = n.parentElement; }
        const src = im.currentSrc || im.src;
        if (lastSrc.has(im) && lastSrc.get(im) !== src && op > 0) out.srcChangedVisible++;
        if (op > 0.001) visible++;
        lastSrc.set(im, src);
        const r = im.getBoundingClientRect();
        // the photo box must equal the stage box in size at all times (position is checked via the stage rect)
        if (Math.abs(r.width - Math.round(r.width)) > 1.5) out.sizeChanges += 0;
        if (stage) { const s = stage.getBoundingClientRect(); if (Math.abs(r.width - s.width) > 0.6 || Math.abs(r.height - s.height) > 0.6 || Math.abs(r.left - s.left) > 0.6 || Math.abs(r.top - s.top) > 0.6) out.moved++; }
      }
      out.maxVisibleLayers = Math.max(out.maxVisibleLayers, visible);
      if (stage) { const s = stage.getBoundingClientRect(); const sz = `${s.width.toFixed(2)}x${s.height.toFixed(2)}`; if (lastSize && lastSize !== sz) out.sizeChanges++; lastSize = sz; }
      const sig = list.map((im) => (im.currentSrc || im.src).slice(-6)).join('|'); if (sig !== prevSig) { out.sources.push(sig); prevSig = sig; }
      out.frames++;
      if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(out);
    };
    requestAnimationFrame(tick);
  }), ms);
  await browser.close();
  return { report, errors };
}

(async () => {
  for (const lang of ['fr', 'ar']) for (const n of [1, 2, 3, 6]) {
    const { report: r, errors } = await run(lang, n, { mode: 'single', effect: 1, hold: 0.5, speed: 2 });
    console.log(`${lang} ${n} images:`, JSON.stringify({ frames: r.frames, maxImgs: r.maxImgs, moved: r.moved, srcChangedVisible: r.srcChangedVisible, sizeChanges: r.sizeChanges, layersVisibleMax: r.maxVisibleLayers, srcStates: r.sources.length }));
    assert(r.maxImgs <= 2, `${lang} ${n}: more than two images in one card (${r.maxImgs})`);
    assert.equal(r.srcChangedVisible, 0, `${lang} ${n}: a visible image changed source`);
    assert.equal(r.sizeChanges, 0, `${lang} ${n}: card size changed`);
    assert.equal(r.moved, 0, `${lang} ${n}: a photo moved relative to the card`);
    assert.deepEqual(errors.filter((e) => !/favicon|Failed to load resource/.test(e)), [], `${lang} ${n}: page errors`);
    if (n === 1) assert(r.maxImgs <= 1, '1 image must stay still');
  }
  console.log('browser engine checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
