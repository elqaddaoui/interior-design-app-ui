import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Platform, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { DragLatest } from './DragHandleDetector';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { useVerticalScroller } from '@/hooks/useViewState';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { NO_CONTEXT_MENU, NO_SELECT } from '@/lib/noSelect';

type Rect = { x: number; y: number; w: number; h: number };
type DragState = { id: string; hover: string | null; after: boolean; count: number; ids: string[] } | null;

const EDGE = 96;   // px from the top/bottom of the window where the list starts scrolling
const SPEED = 14;  // px per tick (about 30 ms)

export interface Reorder {
  enabled: boolean;
  drag: DragState;
  /** Shared by every row of the dragged group, so a whole selection visibly travels together. */
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  lift: SharedValue<number>;
  views: React.MutableRefObject<Map<string, View | null>>;
  follow: React.MutableRefObject<(() => void) | null>;
  begin(id: string): Promise<void>;
  update(x: number, y: number): void;
  finish(commit: boolean): void;
  scrollDelta(): number;
}

/**
 * Drag-and-drop ordering shared by every admin list and grid.
 * - The dragged row follows the pointer; the row under the pointer shows an insertion bar.
 * - Dragging a row that belongs to the current selection moves the whole selection together.
 * - The page auto-scrolls near the window edges, and the dragged row keeps following the pointer while it scrolls.
 * `commit(ids, targetId)` is called once on drop; the caller owns the actual ordering.
 */
/** Loaded on demand (own chunk with the gesture library); until it arrives the handle is shown, just not draggable yet. */
const DragHandleDetector = React.lazy(() => import('@/components/GestureKit').then((m) => ({ default: m.DragHandleDetector })));
let lastDragEnd = 0;
/** True for a moment after a drag ends, so the release is not also treated as a tap on the row. */
export function justDragged() { return Date.now() - lastDragEnd < 350; }

export function useReorder(ids: string[], selected: string[], commit: (ids: string[], targetId: string) => void, enabled: boolean): Reorder {
  const scroller = useVerticalScroller();
  const [drag, setDrag] = useState<DragState>(null);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const views = useRef(new Map<string, View | null>());
  const follow = useRef<(() => void) | null>(null);
  const live = useRef({ rects: new Map<string, Rect>(), startOffset: 0, x: 0, y: 0, moving: [] as string[], timer: null as ReturnType<typeof setInterval> | null, ready: false, hover: null as string | null, after: false });
  const latest = useRef({ ids, selected, commit, scroller });
  useEffect(() => { latest.current = { ids, selected, commit, scroller }; });

  const scrollDelta = useCallback(() => (latest.current.scroller?.offset.current ?? 0) - live.current.startOffset, []);

  const hoverAt = useCallback(() => {
    const s = live.current;
    if (!s.ready) return;
    const dy = -scrollDelta(); // rows measured at drag start move up when the page scrolls down
    let found: string | null = null;
    for (const [id, r] of s.rects) {
      if (s.moving.includes(id)) continue;
      if (s.x >= r.x && s.x <= r.x + r.w && s.y >= r.y + dy && s.y <= r.y + dy + r.h) { found = id; break; }
    }
    if (!found) return; // in a gap between rows: keep the previous target
    const order = latest.current.ids;
    const after = order.indexOf(s.moving[0]) < order.indexOf(found);
    if (found === s.hover && after === s.after) return;
    s.hover = found; s.after = after;
    setDrag((old) => old && { ...old, hover: found, after });
  }, [scrollDelta]);

  const stopTimer = () => { if (live.current.timer) clearInterval(live.current.timer); live.current.timer = null; };
  useEffect(() => stopTimer, []);

  const begin = useCallback(async (id: string) => {
    const s = live.current;
    const { ids: order, selected: sel, scroller: sc } = latest.current;
    s.moving = sel.includes(id) ? order.filter((x) => sel.includes(x)) : [id];
    s.rects = new Map(); s.ready = false; s.hover = null; s.after = false;
    s.startOffset = sc?.offset.current ?? 0;
    setDrag({ id, hover: null, after: false, count: s.moving.length, ids: s.moving });
    if (Platform.OS !== 'web') void import('expo-haptics').then((h) => h.selectionAsync()).catch(() => {});
    await Promise.all(order.map((rowId) => new Promise<void>((done) => {
      const node = views.current.get(rowId);
      if (!node) return done();
      node.measureInWindow((x, y, w, h) => { s.rects.set(rowId, { x, y, w, h }); done(); });
    })));
    s.ready = true;
    hoverAt();
    stopTimer();
    // Auto-scroll while the pointer rests near an edge (the pointer may not move for a while).
    s.timer = setInterval(() => {
      const sc2 = latest.current.scroller;
      const height = Dimensions.get('window').height;
      const step = s.y < EDGE ? -SPEED : s.y > height - EDGE ? SPEED : 0;
      if (!step || !sc2) return;
      const next = Math.max(0, sc2.offset.current + step);
      if (next === sc2.offset.current) return;
      sc2.offset.current = next; // set synchronously so the next tick does not repeat the same step
      sc2.ref.current?.scrollTo({ y: next, animated: false });
      follow.current?.();
      hoverAt();
    }, 30);
  }, [hoverAt]);

  const update = useCallback((x: number, y: number) => { live.current.x = x; live.current.y = y; hoverAt(); }, [hoverAt]);

  const finish = useCallback((doCommit: boolean) => {
    const s = live.current;
    stopTimer();
    lastDragEnd = Date.now();
    const target = s.hover; const moving = s.moving;
    s.ready = false; s.hover = null; s.moving = [];
    setDrag(null);
    if (doCommit && target && moving.length) latest.current.commit(moving, target);
  }, []);

  return useMemo(() => ({ enabled, drag, tx, ty, lift, views, follow, begin, update, finish, scrollDelta }), [enabled, drag, tx, ty, lift, begin, update, finish, scrollDelta]);
}

/**
 * One draggable row/tile. `children` receives the handle element so each layout decides where it sits.
 * The handle is the ONLY drag surface: the rest of the row keeps scrolling, tapping and long-press selection.
 */
export function DragRow({ id, reorder, layout = 'list', handleStyle, handleTone = 'muted', bare, onMove, children, style }: {
  id: string; reorder: Reorder; layout?: 'list' | 'grid'; handleStyle?: StyleProp<ViewStyle>; handleTone?: 'muted' | 'light';
  /** No icon: the handle is an invisible surface (sized by `handleStyle`) so a whole picture can be grabbed. */
  bare?: boolean;
  onMove?: (direction: -1 | 1) => void; children: (handle: React.ReactNode) => React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const { t } = useT();
  const { tx, ty, lift } = reorder;
  // Mutable holders (not refs): the gesture callbacks below run outside render, long after these are set.
  const [last] = useState(() => ({ x: 0, y: 0 }));
  const [latest] = useState(() => ({ reorder, committed: false }));
  const ref = useRef<View>(null);
  const active = reorder.drag?.id === id;
  // The other checked rows follow the dragged one, so the whole group is seen moving.
  const follower = !active && !!reorder.drag?.ids.includes(id);
  const hovered = reorder.drag?.hover === id;
  const after = reorder.drag?.after ?? false;
  const count = reorder.drag?.count ?? 1;

  useEffect(() => {
    const views = reorder.views.current;
    const node = ref.current;
    views.set(id, node);
    return () => { if (views.get(id) === node) views.delete(id); };
  }, [id, reorder.views]);

  const place = useCallback(() => { ty.set(last.y + latest.reorder.scrollDelta()); }, [latest, last, ty]);
  const reset = useCallback(() => { tx.set(0); ty.set(0); lift.set(withTiming(0, { duration: 120 })); }, [tx, ty, lift]);
  useEffect(() => { latest.reorder = reorder; });

  const motion = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + 0.03 * lift.value }],
    opacity: 1 - 0.06 * lift.value,
  }));

  const keys = Platform.OS === 'web' && onMove ? {
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); onMove(e.key === 'ArrowUp' ? -1 : 1);
    },
  } : {};

  const handleView = (
    <View testID={`drag-${id}`} accessible accessibilityRole="adjustable" accessibilityLabel={t('improve.dragHandle')}
      accessibilityActions={onMove ? [{ name: 'increment', label: t('admin.crud.up') }, { name: 'decrement', label: t('admin.crud.down') }] : undefined}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'increment') onMove?.(-1); else if (e.nativeEvent.actionName === 'decrement') onMove?.(1); }}
      {...(keys as object)} {...NO_CONTEXT_MENU}
      style={[NO_SELECT, { width: 32, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, cursor: active ? 'grabbing' : 'grab', touchAction: 'none' } as unknown as ViewStyle, handleTone === 'light' ? { backgroundColor: 'rgba(0,0,0,0.45)', height: 32, borderRadius: 16 } : null, handleStyle]}>
      {bare ? null : <Icon name="drag" size={22} color={handleTone === 'light' ? '#fff' : undefined} tone="muted" />}
    </View>
  );
  const handle = reorder.enabled ? (
    <Suspense fallback={handleView}>
      <DragHandleDetector id={id} reorder={reorder} place={place} reset={reset} lift={lift} tx={tx} last={last} latest={latest as DragLatest}>{handleView}</DragHandleDetector>
    </Suspense>
  ) : null;

  return (
    <Animated.View ref={ref as never} collapsable={false}
      style={[{ position: 'relative', zIndex: active ? 100 : follower ? 99 : hovered ? 2 : 0 }, active ? { boxShadow: '0 16px 36px rgba(0,0,0,0.28)', borderRadius: 18 } as ViewStyle : follower ? { boxShadow: '0 10px 24px rgba(0,0,0,0.2)', borderRadius: 18 } as ViewStyle : null, active || follower ? motion : null, style]}>
      {children(handle)}
      {active && count > 1 ? <View pointerEvents="none" style={{ position: 'absolute', top: -8, end: -8, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }}><DragCount n={count} /></View> : null}
      {hovered ? <DropMark layout={layout} after={after} /> : null}
    </Animated.View>
  );
}

function DragCount({ n }: { n: number }) {
  // Plain RN text: this badge sits on a fixed dark pill, so it never follows the theme.
  return <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>{n}</Text>;
}

/** Insertion bar: where the dragged row will land (before the target when dragging up, after it when dragging down). */
function DropMark({ layout, after }: { layout: 'list' | 'grid'; after: boolean }) {
  const { colors } = useTheme();
  const common = { position: 'absolute', backgroundColor: colors.primary, borderRadius: 4, zIndex: 5 } as const;
  const bar: ViewStyle = layout === 'list'
    ? { ...common, height: 4, start: 10, end: 10, ...(after ? { bottom: -5 } : { top: -5 }) }
    : { ...common, width: 4, top: 6, bottom: 6, ...(after ? { end: -5 } : { start: -5 }) };
  return <View pointerEvents="none" style={bar} />;
}
