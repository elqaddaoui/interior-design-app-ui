import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useAdminHistory } from '@/store/adminHistory';

/**
 * Undo / redo as ONE direction-stable pair. Undo is always the ↶ arrow on the left, redo the ↷ arrow on the right, in every language:
 * these two glyphs are read as shapes ("turn back" / "turn forward"), not as text, so mirroring them (or their order) in Arabic / Darija
 * made the left button look like Undo while it ran Redo. Only the tooltip / spoken label changes with the language.
 */
export function HistoryPair({ prefix, undo, redo, size = 'md', filled = true }: {
  prefix: string;
  undo: { on: boolean; run: () => void };
  redo: { on: boolean; run: () => void };
  size?: 'sm' | 'md';
  /** A tile behind the enabled button (the draft bar) or a bare icon (a popup header). */
  filled?: boolean;
}) {
  const { t } = useT();
  const box = size === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const btn = (id: 'undo' | 'redo', c: { on: boolean; run: () => void }) => (
    <Pressable key={id} testID={`${prefix}-${id}`} accessibilityRole="button" accessibilityLabel={t(`mx.hist.${id}`)} aria-disabled={!c.on || undefined} disabled={!c.on} onPress={c.run} hitSlop={4}
      {...(Platform.OS === 'web' ? ({ title: t(`mx.hist.${id}`) } as object) : {})}
      className={`${box} rounded-full items-center justify-center ${c.on ? `active:opacity-70 ${filled ? 'bg-surface hover:bg-bg' : ''}` : ''}`} style={{ opacity: c.on ? 1 : 0.35 }}>
      <Icon name={id} size={size === 'sm' ? 18 : 19} />
    </Pressable>
  );
  return (
    <View testID={`${prefix}-history`} className={`flex-row items-center bg-surface2 rounded-full ${filled ? 'p-0.5' : ''}`} style={{ gap: filled ? 2 : 0, direction: 'ltr' } as object}>
      {btn('undo', undo)}
      {btn('redo', redo)}
    </View>
  );
}

/** Back / forward icons for the unsaved edits (the same steps Ctrl+Z / Ctrl+Y walk). `prefix` keeps the test ids of several bars apart. */
export function HistoryButtons({ prefix = 'admin' }: { prefix?: string }) {
  const h = useAdminHistory();
  return <HistoryPair prefix={prefix} undo={{ on: h.canUndo, run: h.undo }} redo={{ on: h.canRedo, run: h.redo }} />;
}
