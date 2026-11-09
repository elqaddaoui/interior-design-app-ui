import React from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { sorted, useStore } from '@/store/useStore';
import { useT } from '@/i18n';
import { CreditsBadge } from '@/components/ui/CreditsBadge';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Txt } from '@/components/ui/Txt';
import { ExploreLayout } from '@/components/layouts/ExploreLayouts';
import { deviceOf, resolveLayout } from '@/lib/layouts';
import { useBp } from '@/hooks/useBp';

export default function Explore() {
  const { t } = useT();
  const { desktop } = useBp();
  const sections = useStore((s) => s.sections);
  const categories = useStore((s) => s.categories);
  const items = useStore((s) => s.inspirations);

  const header = !desktop ? (
    <View className="flex-row items-center justify-between h-14">
      <Txt className="text-[26px] font-black">{t('explore.title')}</Txt>
      <CreditsBadge />
    </View>
  ) : <View className="pt-6 pb-3 gap-2"><View className="flex-row items-center gap-3"><View className="w-12 h-12 rounded-2xl bg-soft items-center justify-center"><Icon name="compass-outline" size={28} tone="primary" /></View><Txt className="text-[34px] font-black">{t('explore.title')}</Txt></View><Txt className="text-muted text-[15px] leading-[24px]">{t('improve.exploreIntro')}</Txt></View>;

  const { tablet, width } = useBp();
  const layoutsCfg = useStore((s) => s.doc.settings.layouts);
  const device = deviceOf(width);
  const layout = React.useMemo(() => resolveLayout(layoutsCfg, 'explore', device), [layoutsCfg, device]);
  const visibleSections = sorted(sections).filter((x) => x.visible);
  const visibleCategories = sorted(categories).filter((x) => x.visible);
  const visibleItems = items.filter((x) => x.visible);

  // The classic layout keeps its original entrance animation; the demo layouts share one fade-in.
  return (
    <Screen header={header} bottomInset={16}>
      <Animated.View key={`${layout.id}-${device}`} entering={FadeInDown.duration(300)}>
        <ExploreLayout id={layout.id} params={layout.params} device={device} tablet={tablet} sections={visibleSections} categories={visibleCategories} items={visibleItems} />
      </Animated.View>
    </Screen>
  );
}
