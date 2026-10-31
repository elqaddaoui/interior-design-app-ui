import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { Easing, FadeInDown, FadeOutUp, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { tArr, useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';

function Ring({ delay, color }: { delay: number; color: string }) {
  const v = useSharedValue(0);
  useEffect(() => { v.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1)); }, [delay, v]);
  const s = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - v.value), transform: [{ scale: 0.7 + v.value * 1.1 }] }));
  return <Animated.View style={[{ position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: color }, s]} />;
}

/** Rendering page: blurred photo + scanning beam + pulsing orb + staged status text + progress bar. */
export function RenderingView({ photo, progress, stage }: { photo: string; progress: number; stage: number }) {
  const { t } = useT();
  const { colors } = useTheme();
  const [h, setH] = useState(0);
  const scan = useSharedValue(0);
  const spin = useSharedValue(0);
  useEffect(() => {
    scan.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.quad) }), -1, true);
    spin.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.linear }), -1);
  }, [scan, spin]);
  const beam = useAnimatedStyle(() => ({ transform: [{ translateY: scan.value * Math.max(h - 90, 0) }] }));
  const orbit = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const bar = useAnimatedStyle(() => ({ width: `${Math.max(4, progress * 100)}%` }));
  const stages = tArr(t, 'render.stages');

  return (
    <View className="items-center w-full">
      <View className="w-full rounded-3xl overflow-hidden bg-surface2" style={{ aspectRatio: 1.05 }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={14} /> : <LinearGradient colors={['#2b2b33', '#4a4338']} style={StyleSheet.absoluteFill} />}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: 90 }, beam]} pointerEvents="none">
          <LinearGradient colors={['rgba(251,221,45,0)', 'rgba(251,221,45,0.55)', 'rgba(251,221,45,0)']} style={{ flex: 1 }} />
          <View style={{ position: 'absolute', left: 0, right: 0, top: 44, height: 2, backgroundColor: colors.primary }} />
        </Animated.View>
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          <Ring delay={0} color={colors.primary} /><Ring delay={800} color={colors.primary} /><Ring delay={1600} color={colors.primary} />
          <View className="w-24 h-24 rounded-full bg-primary items-center justify-center" style={{ shadowColor: colors.primary, shadowOpacity: 0.8, shadowRadius: 24, elevation: 10 }}>
            <Icon name="creation" size={40} tone="onprimary" />
          </View>
          <Animated.View style={[{ position: 'absolute', width: 150, height: 150 }, orbit]}>
            <View style={{ position: 'absolute', top: 0, left: 71, width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />
            <View style={{ position: 'absolute', bottom: 14, right: 14, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
          </Animated.View>
        </View>
      </View>

      <Txt className="text-[22px] font-black mt-7 text-center">{t('render.title')}</Txt>
      <View style={{ height: 28 }} className="mt-2 justify-center">
        <Animated.View key={stage} entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)}>
          <Txt className="text-muted text-[15px] text-center">{stages[stage] ?? ''}</Txt>
        </Animated.View>
      </View>

      <View className="w-full mt-5 h-2.5 rounded-full bg-surface2 overflow-hidden">
        <Animated.View style={[{ height: '100%', borderRadius: 999, backgroundColor: colors.primary }, bar]} />
      </View>
      <View className="flex-row justify-between w-full mt-2">
        <Txt className="text-muted text-[12px]">{t('render.hint')}</Txt>
        <Txt className="font-extrabold text-[13px]">{Math.round(progress * 100)}%</Txt>
      </View>
      <View className="flex-row gap-1.5 mt-5">
        {stages.map((_, i) => <View key={i} className={`h-1.5 rounded-full ${i <= stage ? 'bg-primary w-6' : 'bg-line w-1.5'}`} />)}
      </View>
    </View>
  );
}
