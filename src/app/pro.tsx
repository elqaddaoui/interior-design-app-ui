import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from '@/hooks/useLeaveGuard';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { tArr, useT } from '@/i18n';
import { Button, Icon, Screen, Txt } from '@/components/ui';
import { toast } from '@/store/useToast';
import { useMe } from '@/store/useStore';

const PLANS = [
  { k: 'weekly', price: '49 MAD', per: '/wk' },
  { k: 'monthly', price: '149 MAD', per: '/mo', popular: true },
  { k: 'yearly', price: '999 MAD', per: '/yr' },
] as const;

/** Paywall UI only: no real payment. */
export default function Pro() {
  const { t } = useT();
  const me = useMe();
  const [plan, setPlan] = useState<string>('monthly');
  return (
    <Screen max={520} padded={false} footer={<View className="px-4"><Button testID="pro-cta" title={t('pro.cta')} size="lg" full onPress={() => toast(t('pro.thanks'))} /><Txt className="text-muted text-[11px] text-center mt-2">{t('pro.demoNote')}</Txt></View>}>
      <LinearGradient colors={['#FBDD2D', '#F7B500']} style={{ paddingTop: 20, paddingBottom: 36, paddingHorizontal: 20, borderBottomLeftRadius: 32, borderBottomRightRadius: 32 }}>
        <View className="flex-row justify-between items-center">
          <Pressable testID="pro-close" onPress={() => router.back()} className="w-10 h-10 rounded-full bg-black/10 items-center justify-center"><Icon name="close" size={22} color="#111" /></Pressable>
          <View className="bg-black/80 rounded-lg px-3 py-1 flex-row items-center gap-1"><Icon name="star-four-points" size={13} color="#FBDD2D" /><Txt className="text-white font-extrabold">{me?.credits ?? 0}</Txt></View>
        </View>
        <Animated.View entering={FadeInDown.duration(400)} className="items-center mt-4">
          <View className="w-20 h-20 rounded-3xl bg-black items-center justify-center mb-3"><Icon name="crown" size={42} color="#FBDD2D" /></View>
          <Txt className="text-[30px] font-black text-[#111]" style={{ color: '#111' }}>{t('pro.title')}</Txt>
          <Txt className="text-[16px] mt-1" style={{ color: '#111' }}>{t('pro.subtitle')}</Txt>
        </Animated.View>
      </LinearGradient>
      <View className="px-5 pt-6">
        {tArr(t, 'pro.features').map((f, i) => (
          <Animated.View key={i} entering={FadeInDown.delay(150 + i * 70)} className="flex-row items-center gap-3 mb-3">
            <View className="w-6 h-6 rounded-full bg-primary items-center justify-center"><Icon name="check" size={15} tone="onprimary" /></View>
            <Txt className="text-[15px] font-semibold flex-1">{f}</Txt>
          </Animated.View>
        ))}
        <View className="mt-4 gap-2.5">
          {PLANS.map((p) => {
            const on = plan === p.k;
            return (
              <Pressable key={p.k} testID={`plan-${p.k}`} onPress={() => setPlan(p.k)} className={`flex-row items-center rounded-2xl px-4 py-4 border-2 ${on ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
                <View className={`w-6 h-6 rounded-full border-2 items-center justify-center me-3 ${on ? 'border-ink bg-ink' : 'border-line'}`}>{on ? <Icon name="check" size={14} tone="onink" /> : null}</View>
                <Txt className="font-extrabold text-[16px] flex-1">{t(`pro.${p.k}`)}</Txt>
                {'popular' in p ? <View className="bg-danger rounded-md px-2 py-0.5 me-2"><Txt className="text-white text-[10px] font-black">{t('pro.popular')}</Txt></View> : null}
                <Txt className="font-black text-[16px]">{p.price}<Txt className="text-muted text-[12px] font-semibold">{p.per}</Txt></Txt>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => toast(t('pro.demoNote'))} className="mt-4 items-center"><Txt className="text-muted text-[13px] underline">{t('pro.restore')}</Txt></Pressable>
      </View>
    </Screen>
  );
}
