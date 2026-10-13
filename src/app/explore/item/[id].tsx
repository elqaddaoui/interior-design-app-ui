import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { router } from '@/hooks/useLeaveGuard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useStore } from '@/store/useStore';
import { useWizard } from '@/store/useWizard';
import { useL, useT } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { Button, Icon, Txt } from '@/components/ui';

/** Full-screen image viewer + "Use this style". */
export default function ItemViewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const L = useL();
  const insets = useSafeAreaInsets();
  const { tablet } = useBp();
  const item = useStore((s) => s.inspirations.find((x) => x.id === id));
  const cat = useStore((s) => s.categories.find((x) => x.id === item?.categoryId));
  const section = useStore((s) => s.sections.find((x) => x.id === cat?.sectionId));
  const style = useStore((s) => s.styles.find((x) => x.id === item?.styleId));

  const use = () => {
    if (!section) return;
    useWizard.getState().start(section.toolId, { styleId: item?.styleId, roomTypeId: cat?.roomTypeId });
    router.replace({ pathname: '/tool/[id]', params: { id: section.toolId } });
  };

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }}>
      <View className="flex-row items-center justify-between px-4 h-14">
        <Pressable testID="viewer-close" onPress={() => router.back()} className="w-10 h-10 rounded-full bg-white/15 items-center justify-center"><Icon name="close" size={22} color="#fff" /></Pressable>
        <View className="items-center">
          <Txt className="text-white font-extrabold text-[16px]">{L(cat?.title)}</Txt>
          {style ? <Txt className="text-white/70 text-[12px]">{L(style.title)}</Txt> : null}
        </View>
        <View className="w-10" />
      </View>
      <View className="flex-1 items-center justify-center">
        <Image source={{ uri: item?.image }} style={{ width: '100%', height: '100%', maxWidth: tablet ? 900 : undefined }} contentFit="contain" transition={Platform.OS === 'web' ? 0 : 250} />
      </View>
      <View className="px-5 pt-3 self-center w-full" style={{ maxWidth: 520 }}>
        <Button testID="use-style" title={t('explore.useStyle')} icon="creation" onPress={use} full size="lg" />
      </View>
    </View>
  );
}
