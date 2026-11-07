 
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Slider } from '@/components/ui/Slider';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';

/** Accordion card: basic panels start open, advanced ones closed. Keyboard / screen-reader friendly (button + expanded state). */
export function Panel({ id, icon, title, hint, open: initial = true, children, right }: { id: string; icon: string; title: string; hint?: string; open?: boolean; children: React.ReactNode; right?: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <View testID={`panel-${id}`} className="bg-surface rounded-2xl border border-line mb-3 overflow-hidden">
      <Pressable testID={`panel-${id}-toggle`} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title} onPress={() => setOpen(!open)} className="flex-row items-center gap-2.5 px-3.5 py-3 active:opacity-80">
        <View className="w-8 h-8 rounded-lg bg-soft items-center justify-center"><Icon name={icon} size={18} tone="primary" /></View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-extrabold text-[15px]" accessibilityRole="header" numberOfLines={1}>{title}</Txt>
          {hint && !open ? <Txt className="text-[11px] text-muted" numberOfLines={1}>{hint}</Txt> : null}
        </View>
        {right}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} tone="muted" />
      </Pressable>
      {open ? <View className="px-3.5 pb-3.5">{children}</View> : null}
    </View>
  );
}

/** "Advanced options" disclosure inside a panel. */
export function Advanced({ id, children, label }: { id: string; children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const { t } = useT();
  return (
    <View className="mt-1">
      <Pressable testID={`adv-${id}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} className="flex-row items-center gap-1.5 h-9 active:opacity-70">
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={18} tone="muted" flip />
        <Txt className="text-[12px] font-bold text-muted">{label ?? t('br.advanced')}</Txt>
      </Pressable>
      {open ? <View className="pt-1">{children}</View> : null}
    </View>
  );
}

export const Label = ({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) => (
  <View className="flex-row items-center justify-between mb-1.5 gap-2"><Txt className="text-[12px] font-bold text-muted flex-1">{children}</Txt>{right}</View>
);

/** Single-choice pills; `wrap` lets long lists flow onto several rows. */
export function Chips<T extends string | number>({ value, options, onChange, testID, wrap = true, small }: { value: T; options: { key: T; label: string; icon?: string }[]; onChange: (v: T) => void; testID?: string; wrap?: boolean; small?: boolean }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" className={`flex-row gap-1.5 mb-3 ${wrap ? 'flex-wrap' : ''}`}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={String(o.key)} testID={testID ? `${testID}-${o.key}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o.label} onPress={() => onChange(o.key)}
            className={`flex-row items-center justify-center gap-1.5 rounded-full border px-3 ${small ? 'h-8' : 'h-9'} active:opacity-80 ${on ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
            {o.icon ? <Icon name={o.icon} size={16} tone={on ? 'primary' : 'muted'} /> : null}
            <Txt className={`text-[12px] font-bold ${on ? '' : 'text-muted'}`} numberOfLines={1}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Large icon tile (logo type). */
export function Tile({ on, label, icon, visual, onPress, testID }: { on: boolean; label: string; icon?: string; visual?: React.ReactNode; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={onPress}
      className={`items-center justify-center rounded-xl border px-1.5 py-2.5 gap-1 active:opacity-80 ${on ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ flexBasis: '23%', flexGrow: 1, minWidth: 68 }}>
      {visual ?? (icon ? <Icon name={icon} size={22} tone={on ? 'primary' : 'muted'} /> : null)}
      <Txt className={`text-[11px] font-bold text-center ${on ? '' : 'text-muted'}`} numberOfLines={2}>{label}</Txt>
    </Pressable>
  );
}

export function SliderRow({ label, value, min, max, step = 1, onChange, format, testID }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; testID?: string }) {
  return (
    <View className="mb-2.5">
      <Label right={<Txt className="text-[12px] font-extrabold">{format ? format(value) : String(value)}</Txt>}>{label}</Label>
      <Slider testID={testID} label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
    </View>
  );
}

export function SwitchRow({ label, hint, value, onChange, testID }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  return (
    <View className="flex-row items-center justify-between bg-surface2 rounded-xl px-3 py-2 mb-2.5 gap-3" style={{ minHeight: 44 }}>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt className="font-semibold text-[14px]">{label}</Txt>
        {hint ? <Txt className="text-[11px] text-muted">{hint}</Txt> : null}
      </View>
      <Toggle testID={testID} label={label} value={value} onValueChange={onChange} />
    </View>
  );
}

export const Hint = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'danger' | 'success' }) => (
  <Txt className={`text-[11px] leading-[16px] mb-2 ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-muted'}`}>{children}</Txt>
);

export const Row = ({ children, gap = 8, style }: { children: React.ReactNode; gap?: number; style?: any }) => <View style={[{ flexDirection: 'row', gap, alignItems: 'center' }, style]}>{children}</View>;
