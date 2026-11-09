/** Checks the pure rules of the page layouts (src/lib/layouts.ts): `npm run check:layouts`. */
// Local helpers (the project has no Node typings): same style as the other check scripts.
import { DEFAULT_DEMO, DEMOS, allowedOn, columnsFor, demosOf, deviceOf, paramsOf, resolveLayout } from '../src/lib/layouts';
import type { LayoutsConfig } from '../src/data/types';

const fail = (m: string): never => { throw new Error(m); };
const assert = {
  equal: (a: unknown, b: unknown) => { if (a !== b) fail(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  deepEqual: (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  ok: (a: unknown) => { if (!a) fail('expected a truthy value'); },
};

// 8 demos per screen (4 classic + 4 wow), ids unique, default demo exists.
assert.equal(demosOf('home').length, 8); assert.equal(demosOf('explore').length, 8);
for (const id of ['flow', 'stories', 'aurora', 'deck']) assert.ok(demosOf('home').some((d) => d.id === id));
for (const id of ['flow', 'polaroid', 'spotlight', 'accordion']) assert.ok(demosOf('explore').some((d) => d.id === id));
assert.equal(new Set(DEMOS.map((d) => `${d.screen}.${d.id}`)).size, DEMOS.length);
for (const s of ['home', 'explore'] as const) assert.ok(demosOf(s).some((d) => d.id === DEFAULT_DEMO[s]));

// Nothing configured: the classic layouts, on both devices.
for (const d of ['mobile', 'desktop'] as const) { assert.equal(resolveLayout(undefined, 'home', d).id, 'grid'); assert.equal(resolveLayout({}, 'explore', d).id, 'rails'); }

// A wow demo works like any other: used on its device only, falls back when limited.
const wow: LayoutsConfig = { home: { mobile: 'deck', desktop: 'aurora' }, explore: { mobile: 'accordion', desktop: 'flow' }, demos: { 'home.aurora': { devices: 'mobile' } } };
assert.equal(resolveLayout(wow, 'home', 'mobile').id, 'deck'); assert.equal(resolveLayout(wow, 'home', 'desktop').id, 'grid');
assert.equal(resolveLayout(wow, 'explore', 'mobile').id, 'accordion'); assert.equal(resolveLayout(wow, 'explore', 'desktop').id, 'flow');

// A pick is used on its device only.
const cfg: LayoutsConfig = { home: { mobile: 'bento', desktop: 'rail' }, explore: { mobile: 'mosaic' } };
assert.equal(resolveLayout(cfg, 'home', 'mobile').id, 'bento'); assert.equal(resolveLayout(cfg, 'home', 'desktop').id, 'rail');
assert.equal(resolveLayout(cfg, 'explore', 'mobile').id, 'mosaic'); assert.equal(resolveLayout(cfg, 'explore', 'desktop').id, 'rails');

// A demo limited to the other device, or switched off, falls back to the default.
const limited: LayoutsConfig = { ...cfg, demos: { 'home.bento': { devices: 'desktop' }, 'home.rail': { enabled: false } } };
assert.equal(allowedOn(limited, 'home', 'bento', 'mobile'), false); assert.equal(allowedOn(limited, 'home', 'bento', 'desktop'), true);
assert.equal(resolveLayout(limited, 'home', 'mobile').id, 'grid'); assert.equal(resolveLayout(limited, 'home', 'desktop').id, 'grid');
// The default demo can never be switched off or limited.
const hostile: LayoutsConfig = { demos: { 'home.grid': { enabled: false, devices: 'mobile' } } };
assert.equal(allowedOn(hostile, 'home', 'grid', 'desktop'), true);
// Garbage ids and garbage values are harmless.
assert.equal(resolveLayout({ home: { mobile: 'nope' } }, 'home', 'mobile').id, 'grid');
assert.equal(resolveLayout({ home: { mobile: 'bento' }, demos: { 'home.bento': { devices: 'tv' as never } } }, 'home', 'mobile').id, 'bento');

// Settings are clamped to the demo's range and snapped to its step; unknown settings are absent.
const edit = (c: object) => paramsOf({ demos: { 'home.hero': c } }, 'home', 'hero');
assert.equal(edit({ gap: 999 }).gap, 32); assert.equal(edit({ gap: -5 }).gap, 0); assert.equal(edit({ gap: 13 }).gap, 14);
assert.equal(edit({ colsM: 9 }).colsM, 2); assert.equal(edit({ heightD: 'x' }).heightD, 380); assert.equal(edit({ gap: NaN }).gap, 12);
assert.equal(paramsOf(undefined, 'home', 'rail').colsM, undefined);
assert.deepEqual(paramsOf(undefined, 'explore', 'rails'), {});

// Columns: phone / tablet / computer.
assert.equal(columnsFor('mobile', false, { colsM: 2 }), 2); assert.equal(columnsFor('mobile', true, { colsM: 2 }), 3); assert.equal(columnsFor('desktop', false, { colsD: 4 }), 4);

// Breakpoint is the app's (1024).
assert.equal(deviceOf(1023), 'mobile'); assert.equal(deviceOf(1024), 'desktop');
console.log('layouts: all checks passed');
