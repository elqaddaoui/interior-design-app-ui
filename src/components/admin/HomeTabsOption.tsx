import React from 'react';
import { View } from 'react-native';
import { Card, Icon, Toggle, Txt } from '@/components/ui';
import { useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { useDraftDoc } from '@/hooks/useDraftDoc';

/** Admin switch: show/hide home filters without changing card visibility. */
export function HomeTabsOption() {
  const { t } = useT();
  const { patch } = useDraftDoc('settings');
  const on = useStore((s) => s.doc.settings.homeTabsVisible) !== false;
  return (
    <Card className="p-4 mb-4 flex-row items-center gap-3">
      <View className="w-10 h-10 rounded-xl bg-soft items-center justify-center"><Icon name="view-grid-outline" size={20} /></View>
      <View className="flex-1">
        <Txt className="font-bold text-[14px]">{t('admin.tabsOpt.showAllTitle')}</Txt>
        <Txt className="text-muted text-[12px] mt-0.5">{t('admin.tabsOpt.showAllDesc')}</Txt>
      </View>
      <Toggle testID="home-tabs-visible" label={t('admin.tabsOpt.showAllTitle')} value={on}
        onValueChange={(v) => patch({ homeTabsVisible: v })} />
    </Card>
  );
}
