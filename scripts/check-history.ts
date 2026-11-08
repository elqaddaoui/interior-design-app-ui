/** Pure-logic checks of the admin undo / redo stack and of the menu geometry (`npm run check:history`). */
import { createHistory, historyKeyAction, HISTORY_GAP_MS } from '../src/lib/draftHistory';
import { createSourceLog, registerPopup, popupKeyAction, openPopups } from '../src/lib/popupHistory';
import { MENU_GEO, activeKey, menuPositions } from '../src/lib/menuLayout';

const fail = (m: string): never => { throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
let n = 0; const t = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error(`FAIL ${name}: ${(e as Error).message}`); process.exitCode = 1; } };

/** A tiny fake store + clock. `edit` mimics what useDraftDoc does: record the old value, then write the new one. */
function rig(opts?: { gap?: number; max?: number }) {
  const vals: Record<string, unknown> = {}; const live = new Set<string>(); let clock = 1000;
  const h = createHistory({ read: (k) => vals[k], write: (k, v) => { vals[k] = v; }, alive: (k) => live.has(k), now: () => clock }, opts);
  const edit = (k: string, v: unknown, wait = HISTORY_GAP_MS + 100) => { clock += wait; live.add(k); h.record(k, vals[k]); vals[k] = v; };
  return { vals, live, h, edit, tick: (ms: number) => { clock += ms; } };
}

t('empty history has nothing to undo or redo', () => {
  const r = rig(); eq([r.h.canUndo(), r.h.canRedo(), r.h.undo(), r.h.redo()], [false, false, false, false], 'empty');
});

t('one edit = one step; undo then redo restores the same values', () => {
  const r = rig(); r.vals.a = 1; r.edit('a', 2);
  eq([r.h.canUndo(), r.h.canRedo()], [true, false], 'after edit');
  r.h.undo(); eq(r.vals.a, 1, 'undo'); eq([r.h.canUndo(), r.h.canRedo()], [false, true], 'flags after undo');
  r.h.redo(); eq(r.vals.a, 2, 'redo');
});

t('edits of one key inside the gap are a single step (slider drag)', () => {
  const r = rig(); r.vals.a = 0; r.edit('a', 1); r.edit('a', 2, 100); r.edit('a', 3, 100);
  eq(r.h.size().past, 1, 'a drag is one step');
  r.h.undo(); eq(r.vals.a, 0, 'back to the value before the drag');
  r.edit('a', 4); r.edit('a', 5);
  eq(r.h.size().past, 2, 'a pause starts a new step');
});

t('edits of different keys never merge, undo walks back in the order they were made', () => {
  const r = rig(); r.vals.a = 'a0'; r.vals.b = 'b0';
  r.edit('a', 'a1', 50); r.edit('b', 'b1', 50); r.edit('a', 'a2', 50);
  eq(r.h.size().past, 3, 'three steps');
  r.h.undo(); eq([r.vals.a, r.vals.b], ['a1', 'b1'], 'undo 1');
  r.h.undo(); eq([r.vals.a, r.vals.b], ['a1', 'b0'], 'undo 2');
  r.h.undo(); eq([r.vals.a, r.vals.b], ['a0', 'b0'], 'undo 3');
  r.h.redo(); r.h.redo(); r.h.redo(); eq([r.vals.a, r.vals.b], ['a2', 'b1'], 'redo all');
});

t('a new edit clears the redo stack', () => {
  const r = rig(); r.vals.a = 0; r.edit('a', 1); r.h.undo();
  eq(r.h.canRedo(), true, 'redo ready');
  r.edit('a', 9); eq(r.h.canRedo(), false, 'redo dropped by a new edit');
});

t('breakGroup makes the next edit its own step (preset, reset, import)', () => {
  const r = rig(); r.vals.a = 0; r.edit('a', 1); r.h.breakGroup(); r.h.record('a', r.vals.a); r.vals.a = 2;
  eq(r.h.size().past, 2, 'two steps');
});

t('saving or discarding a draft forgets its steps', () => {
  const r = rig(); r.vals.a = 0; r.vals.b = 0; r.edit('a', 1); r.edit('b', 1);
  r.live.delete('a'); r.h.forget('a');
  eq([r.h.canUndo('a'), r.h.canUndo('b'), r.h.size().past], [false, true, 1], 'only b is left');
  r.h.undo(); eq([r.vals.a, r.vals.b], [1, 0], 'a stays saved, b is undone');
});

t('a stale step (draft already saved) is skipped, not replayed', () => {
  const r = rig(); r.vals.a = 0; r.vals.b = 0; r.edit('b', 1); r.edit('a', 1);
  r.live.delete('a'); // saved without forget(): alive() protects us anyway
  eq(r.h.canUndo(), true, 'b is still undoable');
  r.h.undo(); eq([r.vals.a, r.vals.b], [1, 0], 'skips a, undoes b');
});

t('history is capped to the newest steps', () => {
  const r = rig({ max: 5 }); r.vals.a = 0; for (let i = 1; i <= 12; i++) r.edit('a', i);
  eq(r.h.size().past, 5, 'capped');
  for (let i = 0; i < 9; i++) r.h.undo(); eq(r.vals.a, 7, 'oldest kept step restores the value before step 8');
});

t('subscribers hear every change', () => {
  const r = rig(); let calls = 0; const off = r.h.subscribe(() => { calls++; });
  r.vals.a = 0; r.edit('a', 1); r.h.undo(); r.h.redo(); off(); r.edit('a', 2);
  eq(calls, 3, 'record, undo, redo');
});

t('keyboard shortcuts', () => {
  eq(historyKeyAction({ key: 'z', ctrlKey: true }), 'undo', 'Ctrl+Z');
  eq(historyKeyAction({ key: 'Z', metaKey: true }), 'undo', 'Cmd+Z');
  eq(historyKeyAction({ key: 'y', ctrlKey: true }), 'redo', 'Ctrl+Y');
  eq(historyKeyAction({ key: 'z', ctrlKey: true, shiftKey: true }), 'redo', 'Ctrl+Shift+Z');
  eq(historyKeyAction({ key: 'z' }), null, 'plain Z');
  eq(historyKeyAction({ key: 'z', ctrlKey: true, altKey: true }), null, 'AltGr combos are left alone');
  eq(historyKeyAction({ key: 'y', ctrlKey: true, shiftKey: true }), null, 'Ctrl+Shift+Y is not redo');
});

t('menu geometry: rows are where the indicator expects them', () => {
  const groups = [{ key: 'g1', items: [{ key: 'a' }, { key: 'b' }] }, { key: 'g2', items: [{ key: 'c' }] }];
  const { y, height } = menuPositions(groups);
  const { row, gap, head, groupGap } = MENU_GEO;
  eq(y.a, head, 'first row under the first title');
  eq(y.b, head + row + gap, 'second row');
  eq(y.c, head + row + gap + row + groupGap + head, 'first row of the second group');
  eq(height, y.c + row, 'total height');
});

t('active menu entry', () => {
  const items = [{ key: 'dashboard', href: '/admin' }, { key: 'users', href: '/admin/users' }];
  eq(activeKey(items, '/admin'), 'dashboard', 'dashboard'); eq(activeKey(items, '/admin/'), 'dashboard', 'trailing slash');
  eq(activeKey(items, '/admin/users'), 'users', 'users'); eq(activeKey(items, '/admin/unknown'), undefined, 'unknown path has no entry');
});


/* ---------------- popup history ---------------- */
function fakeSource() {
  const st = { past: [] as string[], future: [] as string[], now: 'start' };
  return { st, edit: (v: string) => { st.past.push(st.now); st.now = v; st.future = []; }, src: { canUndo: () => st.past.length > 0, canRedo: () => st.future.length > 0, undo: () => { st.future.push(st.now); st.now = st.past.pop() as string; }, redo: () => { st.past.push(st.now); st.now = st.future.pop() as string; }, breakGroup: () => {} } };
}
t('two sources are walked back in the order the edits were made', () => {
  const a = fakeSource(), b = fakeSource(); let clock = 0;
  const log = createSourceLog({ a: a.src, b: b.src }, { now: () => clock });
  clock += 1000; log.note('a'); a.edit('a1'); clock += 1000; log.note('b'); b.edit('b1'); clock += 1000; log.note('a'); a.edit('a2');
  log.undo(); eq([a.st.now, b.st.now], ['a1', 'b1'], 'undo 1'); log.undo(); eq([a.st.now, b.st.now], ['a1', 'start'], 'undo 2'); log.undo(); eq([a.st.now, b.st.now], ['start', 'start'], 'undo 3');
  eq([log.canUndo(), log.canRedo()], [false, true], 'flags'); log.redo(); log.redo(); log.redo(); eq([a.st.now, b.st.now], ['a2', 'b1'], 'redo all');
});
t('a new edit clears the redo steps; a burst on one source is one step', () => {
  const a = fakeSource(); let clock = 0; const log = createSourceLog({ a: a.src }, { now: () => clock });
  clock += 1000; log.note('a'); a.edit('1'); clock += 100; log.note('a'); eq(log.size().past, 1, 'burst'); clock += 1000; log.note('a'); a.edit('2'); log.undo(); log.note('a'); eq(log.size().future, 0, 'redo cleared');
});
t('the topmost popup owns the keyboard', () => {
  let ran = ''; const mk = (n: string, can: boolean) => ({ canUndo: can, canRedo: can, undo() { ran += `u${n}`; }, redo() { ran += `r${n}`; } });
  eq(popupKeyAction('undo'), false, 'no popup: key is not ours');
  const off1 = registerPopup(() => mk('1', true)), off2 = registerPopup(() => mk('2', true));
  eq(openPopups(), 2, 'two open'); popupKeyAction('undo'); eq(ran, 'u2', 'top popup'); off2(); popupKeyAction('redo'); eq(ran, 'u2r1', 'next popup after close'); off1();
  const off3 = registerPopup(() => mk('3', false)); eq(popupKeyAction('undo'), true, 'consumed even with nothing to undo'); eq(ran, 'u2r1', 'nothing ran'); off3();
});

console.log(`history checks passed (${n} groups)`);
