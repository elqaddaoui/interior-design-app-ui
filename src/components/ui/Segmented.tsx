import React from 'react';
import { Pressable, View } from 'react-native';
import { Txt } from './Txt';

/** Segmented control: same look on phone and desktop. `optionPrefix` gives each option a `${prefix}-${key}` testID. */
export function Segmented<T extends string>({ value, options, onChange, testID, optionPrefix, compact, disabled, fit }: { fit?: boolean; disabled?: boolean; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; testID?: string; optionPrefix?: string; compact?: boolean }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" accessibilityState={{ disabled: !!disabled }} className="flex-row bg-surface2 rounded-full p-1" style={disabled ? { opacity: 0.6 } : undefined}>
      {options.map((o) => (
        <Pressable key={o.key} testID={optionPrefix ? `${optionPrefix}-${o.key}` : `${testID}-${o.key}`} accessibilityRole="radio" accessibilityState={{ selected: value === o.key, disabled: !!disabled }} disabled={disabled} style={fit ? { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' } : undefined} onPress={() => onChange(o.key)} className={`${fit ? '' : 'flex-1'} ${compact ? 'h-8' : 'h-10'} rounded-full items-center justify-center px-2 ${value === o.key ? 'bg-ink' : ''}`}>
          <Txt className={`text-[13px] font-bold ${value === o.key ? 'text-onink' : ''}`} numberOfLines={1}>{o.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}
