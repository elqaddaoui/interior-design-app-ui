import React, { useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n';
import { useReadOnly } from './ReadOnly';

const W = 48, H = 28, PAD = 3, KNOB = H - PAD * 2;

/**
 * Direction-safe switch. The platform <Switch> mirrors inconsistently when the UI language flips to RTL
 * (thumb on the wrong side, track colour not matching the state). This one always renders LTR geometry
 * and mirrors the "on" side explicitly, so ON is unmistakable (coloured track + thumb at the end side).
 */
export function Toggle({ value, onValueChange, disabled: off, testID, label, safe }: { value: boolean; onValueChange?: (v: boolean) => void; disabled?: boolean; testID?: string; label?: string; safe?: boolean }) {
  const disabled = off || (useReadOnly() && !safe);
  const { colors } = useTheme();
  const { rtl } = useT();
  const p = useSharedValue(value ? 1 : 0);
  useEffect(() => { p.value = withTiming(value ? 1 : 0, { duration: 160 }); }, [value, p]);
  // distance travelled by the thumb; the "on" end is the logical end of the row (right in LTR, left in RTL)
  const knob = useAnimatedStyle(() => {
    const travel = W - KNOB - PAD * 2;
    const x = rtl ? travel * (1 - p.value) : travel * p.value;
    return { transform: [{ translateX: x }] };
  });
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      hitSlop={6}
      style={{ width: W, height: H, borderRadius: H / 2, padding: PAD, direction: 'ltr', backgroundColor: value ? colors.primary : colors.line, opacity: disabled ? 0.5 : 1, justifyContent: 'center' } as any}
    >
      <Animated.View style={[{ width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: value ? colors.onprimary : '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }, knob]} />
    </Pressable>
  );
}
