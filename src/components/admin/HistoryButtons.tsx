import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { useAdminHistory } from '@/store/adminHistory';

/** Back / forward icons for the unsaved edits (the same steps Ctrl+Z / Ctrl+Y walk). `prefix` keeps the test ids of several bars apart. */
export function HistoryButtons({ prefix = 'admin' }: { prefix?: string }) {
  const { t } = useT();
  const h = useAdminHistory();
  const btn = (id: 'undo' | 'redo', on: boolean, run: () => void) => (
    <Pressable testID={`${prefix}-${id}`} accessibilityRole="button" accessibilityLabel={t(`mx.hist.${id}`)} aria-disabled={!on || undefined} disabled={!on} onPress={run}
      {...(Platform.OS === 'web' ? ({ title: t(`mx.hist.${id}`) } as object) : {})}
      className={`w-9 h-9 rounded-full items-center justify-center ${on ? 'bg-surface active:opacity-70 hover:bg-bg' : ''}`} style={{ opacity: on ? 1 : 0.35 }}>
      <Icon name={id} size={19} flip />
    </Pressable>
  );
  return (
    <View testID={`${prefix}-history`} className="flex-row items-center bg-surface2 rounded-full p-0.5" style={{ gap: 2 }}>
      {btn('undo', h.canUndo, h.undo)}
      {btn('redo', h.canRedo, h.redo)}
    </View>
  );
}
