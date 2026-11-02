import React from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './Icon';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Clean checkbox with a third "mixed" state (a dash: some children are on). Direction-safe, 44px touch target around a 22px box.
 * `state` = true / false / 'mixed'. The parent decides what a tap does (a parent checkbox usually turns every child on or off).
 */
export function Checkbox({ state, onPress, label, testID, disabled }: { state: boolean | 'mixed'; onPress?: () => void; label: string; testID?: string; disabled?: boolean }) {
  const { colors } = useTheme();
  const on = state !== false;
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: state, disabled }} aria-checked={state} disabled={disabled} onPress={onPress} hitSlop={10}
      style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: on ? colors.primary : colors.muted, backgroundColor: on ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
      {on ? <View pointerEvents="none"><Icon name={state === 'mixed' ? 'minus' : 'check'} size={16} tone="onprimary" /></View> : null}
    </Pressable>
  );
}
