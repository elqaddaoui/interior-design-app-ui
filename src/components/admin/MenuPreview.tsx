import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n';
import type { AdminMenuDesign } from '@/data/types';

const ROWS = 5, ROW_H = 17, GAP = 4;
const y = (i: number) => 8 + i * (ROW_H + GAP);
const STEPS = [0, 2, 4, 1, 3];

/**
 * A miniature of the admin menu that PLAYS the chosen design: the current-entry layer jumps between rows with the same spring family the real
 * menu uses (glide: pill, beam: tint + trailing beam, spotlight: framed page + a halo that wanders). `animated=false` shows one still frame.
 */
export function MenuPreview({ design, animated }: { design: AdminMenuDesign; animated: boolean }) {
  const { colors } = useTheme();
  const { rtl } = useT();
  const [step, setStep] = useState(0);
  const cur = useSharedValue(y(STEPS[0])), beam = useSharedValue(y(STEPS[0])), halo = useSharedValue(y(STEPS[2])), haloOn = useSharedValue(0);
  useEffect(() => {
    if (!animated) { setStep(0); return; }
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1300);
    return () => clearInterval(id);
  }, [animated]);
  useEffect(() => {
    const to = y(STEPS[step]);
    if (!animated) { cur.value = to; beam.value = to; haloOn.value = 0; return; }
    cur.value = withSpring(to, design === 'glide' ? { damping: 21, stiffness: 270, mass: 0.7 } : { damping: 22, stiffness: 240, mass: 0.75 });
    beam.value = withSpring(to, { damping: 13, stiffness: 150, mass: 0.9 });
    if (design === 'spotlight') {
      halo.value = withTiming(y(STEPS[(step + 2) % STEPS.length]), { duration: 700, easing: Easing.out(Easing.cubic) });
      haloOn.value = withSequence(withTiming(1, { duration: 150 }), withDelay(800, withTiming(0.0, { duration: 250 })));
    }
    return () => { cancelAnimation(haloOn); };
  }, [step, animated, design, cur, beam, halo, haloOn]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateY: cur.value }] }));
  const bm = useAnimatedStyle(() => ({ transform: [{ translateY: beam.value + 3 }] }));
  const hl = useAnimatedStyle(() => ({ opacity: haloOn.value, transform: [{ translateY: halo.value }] }));
  const layer = { position: 'absolute' as const, left: 6, right: 6, top: 0, height: ROW_H, borderRadius: 8 };
  return (
    <View testID={`menu-preview-${design}`} className="flex-row w-full h-full" style={{ direction: rtl ? 'rtl' : 'ltr' }}>
      <View className="bg-surface border-e border-line" style={{ width: 118, overflow: 'hidden' }}>
        <Animated.View pointerEvents="none" style={[layer, design === 'glide' ? { backgroundColor: colors.ink } : design === 'beam' ? { backgroundColor: colors.soft } : { backgroundColor: colors.soft, borderWidth: 1, borderColor: colors.primary }, pill]} />
        {design === 'beam' ? <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, width: 3, height: ROW_H - 6, borderRadius: 2, backgroundColor: colors.primary }, rtl ? { right: 0 } : { left: 0 }, bm]} /> : null}
        {design === 'spotlight' ? <Animated.View pointerEvents="none" style={[layer, { backgroundColor: colors.surface2 }, hl]} /> : null}
        {Array.from({ length: ROWS }, (_, i) => {
          const on = STEPS[step] === i;
          return (
            <View key={i} style={{ position: 'absolute', left: 12, right: 12, top: y(i), height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 3, backgroundColor: on ? (design === 'glide' ? colors.primary : colors.fg) : colors.line }} />
              <View style={{ height: 4, borderRadius: 2, width: 40 + ((i * 11) % 22), backgroundColor: on && design === 'glide' ? colors.onink : on ? colors.fg : colors.line, opacity: on ? 0.9 : 0.8 }} />
            </View>
          );
        })}
      </View>
      <View className="flex-1 p-3" style={{ gap: 6 }}>
        <View className="h-2.5 w-16 rounded bg-line" />
        <View className="flex-row" style={{ gap: 6 }}><View className="flex-1 h-9 rounded-md bg-line" style={{ opacity: 0.6 }} /><View className="flex-1 h-9 rounded-md bg-line" style={{ opacity: 0.6 }} /></View>
        <View className="flex-1 rounded-md bg-line" style={{ opacity: 0.4 }} />
      </View>
    </View>
  );
}
