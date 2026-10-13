import React, { useEffect } from 'react';
import { View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useWizard } from '@/store/useWizard';
import { useT } from '@/i18n';
import { Button, Icon, Screen, Txt } from '@/components/ui';

export default function LeadSuccess() {
  const { t } = useT();
  const s = useSharedValue(0);
  const r = useSharedValue(0);
  useEffect(() => {
    s.value = withSpring(1, { damping: 9, stiffness: 120 });
    r.value = withDelay(200, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
  }, [s, r]);
  const circle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: 0.4 * (1 - r.value), transform: [{ scale: 1 + r.value * 0.9 }] }));
  const home = () => { useWizard.getState().start(''); router.dismissAll(); router.replace('/'); };
  return (
    <Screen max={520} scroll={false}
      footer={<View className="gap-2"><Button testID="success-home" title={t('lead.home')} onPress={home} full size="lg" /></View>}>
      <View className="flex-1 items-center justify-center px-4">
        <View className="items-center justify-center" style={{ width: 150, height: 150 }}>
          <Animated.View style={[{ position: 'absolute', width: 110, height: 110, borderRadius: 55, backgroundColor: '#25D366' }, halo]} />
          <Animated.View style={circle} className="w-[110px] h-[110px] rounded-full bg-[#25D366] items-center justify-center"><Icon name="check-bold" size={56} color="#fff" /></Animated.View>
        </View>
        <Animated.View entering={FadeInDown.delay(350).duration(400)} className="items-center mt-8">
          <Txt className="text-[26px] font-black text-center">{t('lead.successTitle')}</Txt>
          <Txt className="text-muted text-[16px] text-center mt-3 leading-6">{t('lead.successMsg')}</Txt>
          <View className="flex-row items-center gap-2 mt-6 bg-soft rounded-full px-4 py-2"><Icon name="whatsapp" size={18} color="#25D366" /><Txt className="font-bold text-[13px]">{t('result.pending')}</Txt></View>
        </Animated.View>
      </View>
    </Screen>
  );
}
