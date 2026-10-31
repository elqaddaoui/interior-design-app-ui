import React, { useRef, useState } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from './Icon';

const KNOB = 24;

/**
 * Continuous slider: `onChange` fires on every move while dragging (not only on release), snapped to `step`.
 * Geometry is always LTR (min on the left) so it behaves the same in RTL; the - / + buttons allow exact steps.
 */
export function Slider({ value, min, max, step = 1, onChange, testID, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; testID?: string; label?: string }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  // Page x of the track's left edge, captured when a drag starts (only touched inside event handlers).
  const origin = useRef(0);
  const at = (pageX: number) => {
    if (width <= KNOB) return;
    const t = Math.min(1, Math.max(0, (pageX - origin.current - KNOB / 2) / (width - KNOB)));
    onChange(Math.min(max, Math.max(min, Math.round((min + t * (max - min)) / step) * step)));
  };
  const responder = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    // A drag must never turn into a page scroll.
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => { origin.current = e.nativeEvent.pageX - e.nativeEvent.locationX; at(e.nativeEvent.pageX); },
    onResponderMove: (e: GestureResponderEvent) => at(e.nativeEvent.pageX),
  };
  const bump = (d: number) => onChange(Math.min(max, Math.max(min, value + d * step)));
  const pct = max > min ? (value - min) / (max - min) : 0;
  const x = pct * Math.max(0, width - KNOB);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, direction: 'ltr' } as object}>
      <Pressable accessibilityRole="button" accessibilityLabel="-" onPress={() => bump(-1)} hitSlop={6} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="minus" size={16} /></Pressable>
      <View
        testID={testID} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => bump(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ flex: 1, height: 36, justifyContent: 'center', touchAction: 'none', cursor: 'pointer' } as object}
        {...responder}
      >
        <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: colors.line }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: KNOB / 2, height: 6, borderRadius: 3, width: x, backgroundColor: colors.primary }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: x, width: KNOB, height: KNOB, borderRadius: KNOB / 2, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.bg, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 }} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="+" onPress={() => bump(1)} hitSlop={6} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="plus" size={16} /></Pressable>
    </View>
  );
}
