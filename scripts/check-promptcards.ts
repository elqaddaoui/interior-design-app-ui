/** Unit check of the Prompt cards model (src/lib/promptCards.ts): `npm run check:promptcards`. No network, no database. */
import * as M from '../src/lib/promptCards';

const assert: any = require('node:assert/strict');
const { cleanRules, defaultRules } = require('../server/imagegen/rules');
const { DEFAULT_ORDER, BLOCKS, DEFAULT_OFF } = require('../server/imagegen/blocks');

const catalog = { order: DEFAULT_ORDER as string[], blocks: Object.fromEntries(Object.entries(BLOCKS).map(([id, d]: [string, any]) => [id, d.variants])) as Record<string, Record<string, string>>, off: DEFAULT_OFF as string[] };
const fresh = (): any => M.clone(defaultRules());
const textImages = { room: 'text', style: 'text' } as any;
const customize = (r: any, id: string, stash?: any): any => M.customize(r, id, stash);
const copySteps = (r: any, from: string, to: string): any => M.copySteps(r, from, to);
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`  ok  ${name}`); };

ok('visibleSteps: Explorer lists only the Explorer picture step', () => {
  assert.deepEqual(M.visibleSteps(catalog.order, M.EXPLORE, textImages), ['reference']);
});
ok('visibleSteps: a tool never lists picture steps, All tools never lists the Explorer step', () => {
  const tool = M.visibleSteps(catalog.order, 'tool_1', { room: 'both', style: 'both' } as any);
  const all = M.visibleSteps(catalog.order, 'all', { room: 'both', style: 'both' } as any);
  for (const id of M.PICTURE_BLOCKS) assert(!tool.includes(id), `tool shows ${id}`);
  assert(!all.includes('reference'));
  assert(all.includes('styleImage') && all.includes('roomImage'), 'picture steps exist once the picture is sent');
});
ok('visibleSteps: automatic picture steps and the style words follow the picture setting', () => {
  const textOnly = M.visibleSteps(catalog.order, 'all', textImages);
  assert(!textOnly.includes('styleImage') && !textOnly.includes('roomImage') && textOnly.includes('style'));
  assert(!M.visibleSteps(catalog.order, 'all', { room: 'text', style: 'image' } as any).includes('style'));
});
ok('variantsOf: a picture step only has the field of the chosen type', () => {
  assert.deepEqual(M.variantsOf('styleImage', catalog.blocks, { room: 'text', style: 'image' } as any), ['image']);
  assert.deepEqual(M.variantsOf('task', catalog.blocks, textImages), ['photo', 'text']);
});
ok('blockOn mirrors the server (explicit wins, automatic follows the setting)', () => {
  const { blockOn } = require('../server/imagegen/blocks');
  for (const id of ['task', 'styleImage', 'roomImage', 'reference']) for (const on of [undefined, true, false]) for (const room of ['text', 'image', 'both']) {
    const images: any = { room, style: room };
    assert.equal(M.blockOn(id, on === undefined ? undefined : { on }, images), blockOn(id, on === undefined ? undefined : { on }, images), `${id}/${on}/${room}`);
  }
});

ok('customize / inherit round-trip with a stash', () => {
  let r = fresh();
  assert(!M.hasOwnSteps(r, 'a'));
  r = customize(r, 'a');
  assert(M.hasOwnSteps(r, 'a'));
  r.tools.a.blocks.items.task = { texts: { photo: 'My task' } };
  const back = M.inherit(r, 'a');
  assert(!M.hasOwnSteps(back.rules, 'a') && back.removed?.items.task?.texts?.photo === 'My task');
  const again = customize(back.rules, 'a', back.removed);
  assert.equal(again.tools.a.blocks.items.task.texts.photo, 'My task');
  assert.equal(M.inherit(fresh(), 'zzz').removed, undefined);
});
ok('customize copies: editing the tool never touches All tools', () => {
  let r = customize(fresh(), 'a');
  r.tools.a.blocks.items.task = { on: false };
  assert.deepEqual(r.global.blocks.items, {});
});
ok('copySteps: copy from a custom tool, reset from All / a tool without its own steps, same tool = no-op', () => {
  let r = customize(fresh(), 'a'); r.tools.a.blocks.order = [...r.tools.a.blocks.order].reverse();
  const c = copySteps(r, 'a', 'b');
  assert.deepEqual(c.tools.b.blocks.order, r.tools.a.blocks.order);
  c.tools.b.blocks.order.reverse();
  assert.notDeepEqual(c.tools.b.blocks.order, r.tools.a.blocks.order, 'a copy, not a link');
  assert(!M.hasOwnSteps(copySteps(c, 'all', 'b'), 'b'));
  assert(!M.hasOwnSteps(copySteps(c, 'zzz', 'b'), 'b'));
  assert.equal(copySteps(r, 'a', 'a'), r);
});

ok('normalize == server cleanRules (steps, rules, vocab, tools)', () => {
  const messy: any = fresh();
  messy.global.rules.text = '  keep  the floor \r\n\r\n\r\n\r\n never   curtains  ';
  messy.global.rules.exploreText = 'x'.repeat(2500);
  messy.global.blocks.items = {
    task: { texts: { photo: catalog.blocks.task.photo + '  ' } },
    structure: { on: false, texts: { default: '  new   wording ' } },
    styleImage: { on: true }, roomImage: { on: false }, reference: { on: true },
    style: { on: true },
  };
  messy.vocab = { styles: { st_a: ' zellige \n tiles ', st_b: '   ' }, rooms: { rt_a: 'big room' } };
  messy.tools = { a: customize(fresh(), 'a').tools.a };
  messy.tools.a.blocks.items.task = { texts: { photo: 'Mine ' } };
  assert.deepEqual(M.normalize(messy, catalog), cleanRules(messy));
});
ok('normalize == server cleanRules on the default rules', () => assert.deepEqual(M.normalize(fresh(), catalog), cleanRules(fresh())));
ok('isDirty ignores spaces and re-typed default wording, sees real changes', () => {
  const saved = fresh(); const draft = M.clone(saved);
  assert(!M.isDirty(draft, saved, catalog));
  draft.global.rules.text = '   ';
  draft.global.blocks.items.task = { texts: { photo: catalog.blocks.task.photo } };
  assert(!M.isDirty(draft, saved, catalog));
  draft.global.rules.text = 'Keep the floor';
  assert(M.isDirty(draft, saved, catalog));
  const d2 = customize(saved, 'a');
  assert(M.isDirty(d2, saved, catalog), 'a customised tool is a change');
  const d3 = M.clone(saved); d3.global.blocks.order = M.moveStep(d3.global.blocks.order, 'task', 1);
  assert(M.isDirty(d3, saved, catalog));
});

ok('moveStep / moveVisible keep the hidden steps in place', () => {
  const order = ['a', 'h', 'b', 'c'];
  assert.deepEqual(M.moveStep(order, 'a', -1), order);
  assert.deepEqual(M.moveVisible(order, ['a', 'b', 'c'], 'a', 1), ['b', 'h', 'a', 'c']);
  assert.deepEqual(M.moveVisible(order, ['a', 'b', 'c'], 'c', 1), order);
});
ok('reorderVisible: drag among the shown steps, hidden ones stay put', () => {
  const order = ['a', 'h', 'b', 'c'];
  const out = M.reorderVisible(order, ['a', 'b', 'c'], ['c'], 'a');
  assert.equal(out[1], 'h'); assert.deepEqual([...out].sort(), [...order].sort());
  assert.equal(out.filter((id) => id !== 'h')[0], 'c');
});
ok('canReorder', () => { assert(!M.canReorder(M.EXPLORE, ['reference', 'x'])); assert(!M.canReorder('all', ['a'])); assert(M.canReorder('all', ['a', 'b'])); });

ok('unknownVars / insertVar', () => {
  assert.deepEqual(M.unknownVars('Do {style} in {room} and {nope} {nope}', ['style', 'room']), ['nope']);
  assert.equal(M.insertVar('Hello', 'room'), 'Hello {room}'); assert.equal(M.insertVar('', 'room'), '{room}'); assert.equal(M.insertVar('Hi ', 'room'), 'Hi {room}');
});
ok('stepIsCustom', () => {
  const b: any = { order: [], items: { task: { texts: { photo: catalog.blocks.task.photo + ' ' } }, style: { texts: { default: 'x' } } } };
  assert(!M.stepIsCustom(b, 'task', catalog.blocks)); assert(M.stepIsCustom(b, 'style', catalog.blocks)); assert(!M.stepIsCustom(b, 'room', catalog.blocks));
});

ok('rule lines: add once, remove, bullets ignored, length limit', () => {
  let t = M.addRuleLine('', 'Never add curtains');
  assert.equal(t, 'Never add curtains');
  assert.equal(M.addRuleLine(t, 'never add curtains'), t, 'already there');
  assert.equal(M.addRuleLine('- Never add curtains', 'Never add curtains'), '- Never add curtains');
  t = M.addRuleLine(t, 'Keep the floor');
  assert.equal(t, 'Never add curtains\nKeep the floor');
  assert.equal(M.removeRuleLine(t, 'Never add curtains'), 'Keep the floor');
  const full = 'x'.repeat(M.RULES_MAX - 3);
  assert.equal(M.addRuleLine(full, 'Keep the floor'), full);
  assert(M.RULE_IDEAS.every((i) => i.length < 80));
});

ok('touched: a fresh install has no dot, each change lights only its tab', () => {
  const base = fresh();
  for (const k of [...M.ALL_TABS, 'explore'] as const) assert(!M.touched(base, k, catalog), `fresh ${k}`);
  const r = fresh(); r.global.rules.text = 'a'; assert(M.touched(r, 'rules', catalog) && !M.touched(r, 'output', catalog));
  const i = fresh(); i.global.images.style = 'both'; assert(M.touched(i, 'images', catalog));
  const o = fresh(); o.global.output.maxSide = 1024; assert(M.touched(o, 'output', catalog));
  const w = fresh(); w.vocab.styles.st_a = 'x'; assert(M.touched(w, 'words', catalog));
  const b = fresh(); b.global.blocks.order = M.moveStep(b.global.blocks.order, 'task', 1); assert(M.touched(b, 'blocks', catalog));
  const e = fresh(); e.global.rules.exploreText = 'x'; assert(M.touched(e, 'explore', catalog) && !M.touched(e, 'rules', catalog));
  const s = fresh(); s.global.blocks.items.task = { texts: { photo: catalog.blocks.task.photo } }; assert(!M.touched(s, 'blocks', catalog), 're-typed default is no change');
});

ok('stepTarget: where a passage of the preview is edited', () => {
  assert.deepEqual(M.stepTarget('a', 'reference'), { scope: M.EXPLORE, focus: 'reference' });
  assert.deepEqual(M.stepTarget('a', 'rules'), { scope: 'all', tab: 'rules' });
  assert.deepEqual(M.stepTarget('a', 'styleImage'), { scope: 'all', tab: 'blocks', focus: 'styleImage' });
  assert.deepEqual(M.stepTarget('a', 'task'), { scope: 'a', focus: 'task' });
  assert.deepEqual(M.stepTarget('all', 'task'), { scope: 'all', tab: 'blocks', focus: 'task' });
});

const tools: any[] = [{ id: 't1', roomGroup: 'indoor' }, { id: 't2', roomGroup: 'outdoor' }];
const rooms: any[] = [{ id: 'r1', group: 'indoor' }, { id: 'r2', group: 'outdoor' }, { id: 'r3' }];
ok('effectiveCase: tool card previews its own tool, rooms follow the tool group, None is kept', () => {
  const tc = M.startCase(tools, [{ id: 's1' }], rooms);
  assert.equal(M.effectiveCase(tc, 't2', tools, rooms).toolId, 't2');
  assert.equal(M.effectiveCase(tc, 't2', tools, rooms).roomId, 'r2');
  assert.equal(M.effectiveCase({ ...tc, toolId: 'gone' }, 'all', tools, rooms).toolId, 't1');
  assert.equal(M.effectiveCase({ ...tc, roomId: '' }, 'all', tools, rooms).roomId, '');
  assert.equal(M.effectiveCase({ ...tc, roomId: 'r3' }, 't2', tools, rooms).roomId, 'r3');
  assert.equal(M.effectiveCase({ ...tc, roomId: 'r1' }, 't2', tools, rooms).roomId, 'r2', 'a room of another group is swapped');
});
ok('effectiveCase / startCase: Explorer starts from an Explorer picture and no style / room', () => {
  const tc = M.startCase(tools, [{ id: 's1' }], rooms, true);
  assert(tc.styleId === '' && tc.roomId === '');
  assert.equal(M.effectiveCase(tc, M.EXPLORE, tools, rooms, [{ id: 'i1' }]).insId, 'i1');
});
ok('toolThumb', () => {
  assert.equal(M.toolThumb({ media: { type: 'video', poster: 'p.jpg', uri: 'v.mp4' } }), 'p.jpg');
  assert.equal(M.toolThumb({ media: { type: 'slideshow', images: ['', 'b.jpg'] } }), 'b.jpg');
  assert.equal(M.toolThumb({ media: { type: 'image', uri: 'i.jpg' } }), 'i.jpg');
  assert.equal(M.toolThumb(undefined), '');
});

console.log(`\n${n} checks passed`);
