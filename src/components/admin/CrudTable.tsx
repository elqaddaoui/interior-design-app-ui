import React, { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { useBp } from '@/hooks/useBp';
import { SearchTarget, useViewState } from '@/hooks/useViewState';
import { useT } from '@/i18n';
import type { Chip, RowView } from '@/admin/entities';
import { RevealTarget, useReveal } from '@/hooks/useReveal';
import { DragRow, justDragged, useReorder } from './DragReorder';
import { LangDots } from './LangField';
import type { Lang } from '@/data/types';
import type { LangState } from '@/lib/langStatus';
import { holdPress, PRESS_HOLD } from '@/lib/noSelect';
import { RightClick, type MenuItem } from './ContextMenu';

const TONE: Record<NonNullable<Chip['tone']>, { box: string; text: string; icon: 'muted' | 'primary' | 'success' | 'danger' | 'fg' }> = {
  muted: { box: 'bg-surface2', text: 'text-muted', icon: 'muted' },
  primary: { box: 'bg-soft', text: 'text-fg', icon: 'fg' },
  success: { box: 'bg-surface2', text: 'text-success', icon: 'success' },
  danger: { box: 'bg-surface2', text: 'text-danger', icon: 'danger' },
};
function Pill({ chip }: { chip: Chip }) {
  const tone = TONE[chip.tone ?? 'muted'];
  return (
    <View className={`flex-row items-center gap-1 rounded-full px-2.5 h-6 ${tone.box}`} style={{ maxWidth: '100%' }}>
      {chip.icon ? <Icon name={chip.icon} size={13} tone={tone.icon} /> : null}
      <Txt className={`text-[11.5px] font-semibold ${tone.text}`} numberOfLines={1} style={{ flexShrink: 1 }}>{chip.label}</Txt>
    </View>
  );
}
const Chips = ({ chips }: { chips?: Chip[] }) => chips?.length ? <View className="flex-row flex-wrap gap-1.5 mt-1.5">{chips.map((chip, i) => <Pill key={i} chip={chip} />)}</View> : null;

/**
 * Admin collection view. Lists (rows with a leading visual) and grids (image tiles) are both built from the
 * entity's own `view(row)` description; reordering is always the drag handle, never arrow buttons.
 */
export function CrudTable<T extends { id: string; visible?: boolean }>({ rows, view, onEdit, onDelete, onDuplicate, itemMenu, onReorder, onMove, onToggle, rowTestID, selected, onSelect, onLongPress, visual = false, langs }: {
  /** Translation state of a row (DAR / AR / FR); shown on the row only when something is not complete. */
  langs?: (r: T) => Record<Lang, LangState> | null;
  rows: T[]; view: (r: T, index: number) => RowView; visual?: boolean;
  onEdit?: (r: T) => void; onDelete?: (r: T) => void; onToggle?: (r: T) => void;
  /** Duplicate button on each row. */
  onDuplicate?: (r: T) => void;
  /** Desktop right-click menu of a row. */
  itemMenu?: (r: T) => MenuItem[];
  /** Drag-and-drop: `ids` (one row or the whole selection) were dropped on `targetId`. */
  onReorder?: (ids: string[], targetId: string) => void;
  /** Keyboard / screen-reader alternative to dragging (no visible arrows). */
  onMove?: (r: T, d: -1 | 1) => void;
  rowTestID?: string; selected?: string[]; onSelect?: (id: string) => void; onLongPress?: (id: string) => void;
}) {
  const { desktop, width: windowWidth } = useBp();
  const { t } = useT();
  const { target, focus } = useLocalSearchParams<{ target?: string; focus?: string }>();
  const [width, setWidth] = useState(0);
  const grid = width || windowWidth;
  const [page, setPage] = useViewState('table-page', 0);
  const pageSize = 24;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(pageCount - 1, Math.max(0, page));
  const targetIndex = rows.findIndex((row) => row.id === target);
  useEffect(() => {
    if (targetIndex < 0) return;
    const timer = setTimeout(() => setPage(Math.floor(targetIndex / pageSize)), 0);
    return () => clearTimeout(timer);
  }, [targetIndex, target, focus, setPage]);
  // Something was just added: show the page that holds it (the first of a group) so the highlight has a row to land on.
  const revealed = useReveal((state) => state.current);
  const revealIndex = revealed ? rows.findIndex((row) => row.id === revealed.ids[0]) : -1;
  useEffect(() => {
    if (revealIndex < 0 || !revealed || Date.now() - revealed.at > 8000) return;
    setPage(Math.floor(revealIndex / pageSize));
  }, [revealIndex, revealed, setPage]);
  const visibleRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const reorder = useReorder(rows.map((r) => r.id), selected ?? [], (ids, to) => onReorder?.(ids, to), !!onReorder);
  const measure = (event: import('react-native').LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const pagination = pageCount > 1 ? <View testID="crud-pagination" className="flex-row flex-wrap items-center justify-between gap-2 py-2"><Button testID="page-previous" size="sm" variant="soft" icon="chevron-left" title={t('improve.previous')} disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} /><Txt testID="page-count" className="text-muted text-[12px]">{t('improve.pageCount', { page: currentPage + 1, count: pageCount })}</Txt><Button testID="page-next" size="sm" variant="soft" icon="chevron-right" title={t('improve.next')} disabled={currentPage === pageCount - 1} onPress={() => setPage(currentPage + 1)} /></View> : null;
  if (!rows.length) return <EmptyState icon="database-off-outline" title={t('admin.crud.noItems')} />;

  const isOn = (r: T) => selected?.includes(r.id) ?? false;
  const checkbox = (r: T) => onSelect ? <Pressable testID={`select-${r.id}`} accessibilityRole="checkbox" aria-checked={isOn(r)} accessibilityState={{ checked: isOn(r) }} accessibilityLabel={t('common.select')} onPress={(event) => { event.stopPropagation(); onSelect(r.id); }} hitSlop={4} className="w-9 h-9 items-center justify-center"><Icon name={isOn(r) ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} tone={isOn(r) ? 'primary' : 'muted'} /></Pressable> : null;
  const actions = (r: T) => (
    <View className="flex-row items-center" style={{ flexShrink: 0 }}>
      {onToggle ? <Pressable testID={`toggle-${r.id}`} accessibilityLabel={t('admin.crud.showHide')} onPress={(event) => { event.stopPropagation(); onToggle(r); }} hitSlop={4} className="w-9 h-9 items-center justify-center"><Icon name={r.visible === false ? 'eye-off-outline' : 'eye-outline'} size={19} tone={r.visible === false ? 'muted' : 'fg'} /></Pressable> : null}
      {onEdit ? <Pressable testID={`edit-${r.id}`} accessibilityLabel={t('common.edit')} onPress={(event) => { event.stopPropagation(); onEdit(r); }} hitSlop={4} className="w-9 h-9 items-center justify-center"><Icon name="pencil-outline" size={19} /></Pressable> : null}
      {onDuplicate ? <Pressable testID={`dup-${r.id}`} accessibilityLabel={t('ax.duplicate')} onPress={(event) => { event.stopPropagation(); onDuplicate(r); }} hitSlop={4} className="w-9 h-9 items-center justify-center"><Icon name="content-copy" size={18} /></Pressable> : null}
      {onDelete ? <Pressable testID={`del-${r.id}`} accessibilityLabel={t('common.delete')} onPress={(event) => { event.stopPropagation(); onDelete(r); }} hitSlop={4} className="w-9 h-9 items-center justify-center"><Icon name="trash-can-outline" size={19} tone="danger" /></Pressable> : null}
    </View>
  );
  const press = (r: T) => ({
    ...PRESS_HOLD,
    accessibilityRole: onSelect || onEdit ? 'button' as const : undefined,
    accessibilityLabel: onSelect ? t('improve.holdSelect') : onEdit ? t('common.edit') : undefined,
    delayLongPress: 450,
    onLongPress: onLongPress ? holdPress(() => { if (!justDragged()) onLongPress(r.id); }) : undefined,
    // One press opens the editor. While a selection is active a press toggles the row instead (so several can be picked quickly).
    onPress: onSelect && selected?.length ? () => { if (!justDragged()) onSelect(r.id); } : onEdit ? () => { if (!justDragged()) onEdit(r); } : undefined,
  });
  const langBadge = (r: T) => { const states = langs?.(r); return states && Object.values(states).some((x) => x !== 'complete') ? <LangDots states={states} /> : null; };
  const hiddenBadge = (r: T) => r.visible === false ? <View className="flex-row items-center gap-1 rounded-full px-2 h-5 bg-ink"><Icon name="eye-off-outline" size={11} tone="onink" /><Txt className="text-onink text-[10px] font-bold">{t('admin.crud.hidden')}</Txt></View> : null;

  if (visual) {
    // Phones always get two cards per row (even 320 px wide ones); before the first measure the window width is used so the grid never flashes as one column.
    const columns = grid >= 900 ? 4 : grid >= 640 ? 3 : 2;
    return <View onLayout={measure}><View testID="crud-visual-grid" style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -5 }}>
      {visibleRows.map((r, i) => {
        const v = view(r, currentPage * pageSize + i);
        return <DragRow key={r.id} id={r.id} reorder={reorder} layout="grid" handleTone="light" onMove={onMove ? (d) => onMove(r, d) : undefined} style={{ width: `${100 / columns}%`, padding: 5, minWidth: 0 }}>{(handle) => (
          <SearchTarget id={r.id}><RevealTarget id={r.id}><RightClick items={() => itemMenu?.(r)} disabled={!itemMenu}>
              <Card className={`overflow-hidden rounded-3xl ${isOn(r) ? 'border-primary' : ''}`} style={{ borderWidth: isOn(r) ? 2 : 1 }}>
                <Pressable testID={rowTestID ? `${rowTestID}-${r.id}` : undefined} {...press(r)} className={r.visible === false ? 'opacity-60' : ''}>
                  <MediaView media={v.cover} style={{ height: desktop ? 140 : 116 }} />
                  <View className="p-2.5">
                    <View className="flex-row items-center justify-between gap-2"><Txt className="font-extrabold text-[14px] flex-1" numberOfLines={1}>{v.title}</Txt>{langBadge(r)}</View>
                    {v.subtitle ? <Txt className="text-muted text-[12px] mt-0.5" numberOfLines={1}>{v.subtitle}</Txt> : null}
                    <Chips chips={v.chips} />
                  </View>
                </Pressable>
                <View pointerEvents="box-none" style={{ position: 'absolute', top: 6, left: 6, right: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ direction: 'ltr' } as never}>{handle}</View>
                  <View className="flex-row items-center gap-1">{hiddenBadge(r)}{onSelect ? <View className="rounded-full bg-surface">{checkbox(r)}</View> : null}</View>
                </View>
                <View className="flex-row items-center justify-end px-1 pb-1 border-t border-line">{actions(r)}</View>
              </Card>
          </RightClick></RevealTarget></SearchTarget>
        )}</DragRow>;
      })}
    </View>{pagination}</View>;
  }

  return (
    <View onLayout={measure}>
      <View style={{ gap: 8 }}>
        {visibleRows.map((r, i) => {
          const v = view(r, currentPage * pageSize + i);
          return (
            <DragRow key={r.id} id={r.id} reorder={reorder} layout="list" onMove={onMove ? (d) => onMove(r, d) : undefined}>{(handle) => (
              <SearchTarget id={r.id}><RevealTarget id={r.id}><RightClick items={() => itemMenu?.(r)} disabled={!itemMenu}>
                <Card className={`rounded-3xl ${isOn(r) ? 'border-primary bg-soft' : ''}`} style={{ borderWidth: isOn(r) ? 2 : 1 }}>
                  <Pressable testID={rowTestID ? `${rowTestID}-${r.id}` : undefined} {...press(r)} className={`flex-row items-center gap-2 ps-1.5 pe-2 py-2.5 ${r.visible === false ? 'opacity-60' : ''}`}>
                    {handle}
                    {v.lead ? <View style={{ flexShrink: 0 }}>{v.lead}</View> : null}
                    <View className="flex-1" style={{ minWidth: 0 }}>
                      <View className="flex-row items-center gap-2">
                        <Txt className="font-extrabold text-[16px]" numberOfLines={1} style={{ flexShrink: 1 }}>{v.title}</Txt>
                        {hiddenBadge(r)}
                        {langBadge(r)}
                      </View>
                      {v.subtitle ? <Txt className="text-muted text-[13px] mt-0.5" numberOfLines={1}>{v.subtitle}</Txt> : null}
                      <Chips chips={v.chips} />
                      {v.extra ? <View className="mt-1.5">{v.extra}</View> : null}
                    </View>
                    {desktop ? <View className="flex-row items-center gap-1">{checkbox(r)}{actions(r)}</View> : null}
                  </Pressable>
                  {!desktop ? <View className="flex-row items-center justify-between px-2 pb-1.5 -mt-1"><View className="flex-row items-center">{checkbox(r)}</View>{actions(r)}</View> : null}
                </Card>
              </RightClick></RevealTarget></SearchTarget>
            )}</DragRow>
          );
        })}
      </View>
      {pagination}
    </View>
  );
}
