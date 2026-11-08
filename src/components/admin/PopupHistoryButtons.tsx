import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import type { PopupApi } from '@/lib/popupHistory';

/** Undo / redo icons for the header of a popup (same look as the admin bar, scoped to the popup's own steps). */
export function PopupHistoryButtons({ api, prefix = 'popup' }: { api: PopupApi; prefix?: string }) {
  const { t } = useT();
  const btn = (id: 'undo' | 'redo', on: boolean, run: () => void) => (
    <Pressable key={id} testID={`${prefix}-${id}`} accessibilityRole="button" accessibilityLabel={t(`mx.hist.${id}`)} aria-disabled={!on || undefined} disabled={!on} onPress={run} hitSlop={4}
      {...(Platform.OS === 'web' ? ({ title: t(`mx.hist.${id}`) } as object) : {})}
      className={`w-8 h-8 rounded-full items-center justify-center ${on ? 'active:opacity-70' : ''}`} style={{ opacity: on ? 1 : 0.35 }}>
      <Icon name={id} size={18} flip />
    </Pressable>
  );
  return (
    <View testID={`${prefix}-history`} className="flex-row items-center bg-surface2 rounded-full" style={{ gap: 0 }}>
      {btn('undo', api.canUndo, api.undo)}
      {btn('redo', api.canRedo, api.redo)}
    </View>
  );
}
