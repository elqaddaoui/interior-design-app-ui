import React from 'react';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import type { InspirationCategory, InspirationItem, InspirationSection } from '@/data/types';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useL, useT } from '@/i18n';

export const chunk = <T,>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
export const countOf = (items: InspirationItem[], c: InspirationCategory) => items.filter((i) => i.categoryId === c.id && i.visible).length;
export const openCat = (c: InspirationCategory) => router.push({ pathname: '/explore/category/[id]', params: { id: c.id } });
export const openSection = (s: InspirationSection) => router.push({ pathname: '/explore/section/[id]', params: { id: s.id } });

export function SectionHead({ sec, big }: { sec: InspirationSection; big?: boolean }) {
  const { t } = useT(); const L = useL();
  return (
    <View className="flex-row items-center justify-between mb-3 gap-3">
      <View className="flex-row items-center gap-2 flex-1">
        <Icon name={sec.icon} size={big ? 26 : 22} />
        <Txt className="font-extrabold flex-1" style={{ fontSize: big ? 24 : 18 }} numberOfLines={1}>{L(sec.title)}</Txt>
      </View>
      <Pressable testID={`seeall-${sec.id}`} accessibilityRole="button" onPress={() => openSection(sec)} className="flex-row items-center gap-0.5 active:opacity-60">
        <Txt className="text-muted text-[13px]">{t('common.seeAll')}</Txt>
        <Icon name="chevron-right" size={16} tone="muted" flip />
      </Pressable>
    </View>
  );
}


/** Boot loader contract: the first two Home cards must report "painted". A layout that shows fewer live cards reports both from its first picture. */
export const paintAll = (onPaint?: (i: number) => void) => (onPaint ? () => { onPaint(0); onPaint(1); } : undefined);
