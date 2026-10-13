import React from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { Carousel } from '@/components/ui/Carousel';
import { EmptyState, Icon, MediaView, PageHeader, Screen, Txt } from '@/components/ui';

export default function SectionPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const L = useL();
  const section = useStore((s) => s.sections.find((x) => x.id === id));
  const categories = useStore((s) => s.categories);
  const items = useStore((s) => s.inspirations);
  const cats = sorted(categories).filter((c) => c.visible && c.sectionId === id);

  return (
    <Screen header={<PageHeader title={L(section?.title)} onBack={() => router.back()} />} bottomInset={16}>
      {cats.length === 0 ? <EmptyState title={t('common.empty')} /> : null}
      {cats.map((c) => {
        const list = sorted(items).filter((i) => i.visible && i.categoryId === c.id);
        return (
          <View key={c.id} className="mb-6 mt-2">
            <View className="flex-row items-center justify-between mb-2.5">
              <Txt className="text-[16px] font-extrabold">{L(c.title)}</Txt>
              <Pressable onPress={() => router.push({ pathname: '/explore/category/[id]', params: { id: c.id } })} className="flex-row items-center gap-0.5 active:opacity-60">
                <Txt className="text-muted text-[13px]">{t('common.seeAll')}</Txt>
                <Icon name="chevron-right" size={16} tone="muted" flip />
              </Pressable>
            </View>
            <Carousel gap={10}>
              {list.slice(0, 8).map((it) => (
                <Pressable key={it.id} onPress={() => router.push({ pathname: '/explore/item/[id]', params: { id: it.id } })}>
                  <MediaView uri={it.image} className="rounded-xl" style={{ width: 120, height: 120 }} />
                </Pressable>
              ))}
            </Carousel>
          </View>
        );
      })}
    </Screen>
  );
}
