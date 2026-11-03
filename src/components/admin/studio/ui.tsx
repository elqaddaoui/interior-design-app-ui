import React from 'react';
import { Pressable, View } from 'react-native';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';

/** Small building blocks of the Animation Studio panel (same look on phone and desktop). */

/** A titled block of controls. */
export function Group({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return (
    <View className="bg-surface rounded-2xl border border-line p-3 mb-3" style={{ gap: 10 }}>
      {title ? <Txt className="text-[14px] font-extrabold">{title}</Txt> : null}
      {note ? <Txt className="text-muted text-[12px] -mt-1">{note}</Txt> : null}
      {children}
    </View>
  );
}

/** Label above a control. */
export function Line({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <View className="flex-row items-center justify-between">
        <Txt className="text-[13px] font-semibold text-muted flex-1" numberOfLines={1}>{label}</Txt>
        {value !== undefined ? <Txt className="text-[12px] font-bold">{value}</Txt> : null}
      </View>
      {children}
    </View>
  );
}

/** Slider with its label and current value (`fmt` formats the number shown). */
export function Sld({ label, value, min, max, step, onChange, fmt, testID }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string; testID?: string }) {
  return (
    <Line label={label} value={fmt ? fmt(value) : String(Math.round(value * 100) / 100)}>
      <Slider testID={testID} label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
    </Line>
  );
}

/** Switch row. */
export function Sw({ label, value, onChange, testID }: { label: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Txt className="text-[13px] font-semibold flex-1">{label}</Txt>
      <Toggle testID={testID} label={label} value={value} onValueChange={onChange} />
    </View>
  );
}

/** Wrapping chips: one choice among many (text, or any node, e.g. a drawn shape). */
export function Chips<T extends string | number>({ value, options, onChange, testID }: { value: T; options: { key: T; label?: string; node?: React.ReactNode }[]; onChange: (v: T) => void; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" className="flex-row flex-wrap" style={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={String(o.key)} testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            onPress={() => onChange(o.key)} className={`min-w-[40px] h-9 px-3 rounded-full items-center justify-center border ${on ? 'bg-ink border-ink' : 'bg-surface2 border-line'}`}>
            {o.node ?? <Txt className={`text-[13px] font-bold ${on ? 'text-onink' : ''}`} numberOfLines={1}>{o.label}</Txt>}
          </Pressable>
        );
      })}
    </View>
  );
}
