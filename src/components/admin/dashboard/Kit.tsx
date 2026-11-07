import React, { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useCountUp } from '@/hooks/useCountUp';
import { useTheme } from '@/theme/ThemeProvider';
import { Spark } from './Viz';

export const SHADOW = '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px -12px rgba(16,24,40,0.10)';
const HOVER = '0 2px 4px rgba(16,24,40,0.06), 0 16px 36px -14px rgba(16,24,40,0.22)';
const T = { transition: 'box-shadow .18s ease, transform .18s ease, border-color .18s ease, background-color .18s ease' } as any;

/** Web hover state for Pressables (function styles are not applied by the styling layer). */
const useHover = () => { const [h, set] = useState(false); return [h, { onHoverIn: () => set(true), onHoverOut: () => set(false) }] as const; };

/** Staggered entrance (a short fade + rise). */
export function Reveal({ i = 0, children, style }: { i?: number; children: React.ReactNode; style?: ViewStyle }) {
  return <Animated.View entering={FadeInDown.delay(Math.min(i, 8) * 45).duration(360)} style={style}>{children}</Animated.View>;
}

/** Content card: small caps title, optional sub line and right-hand actions. */
export function Panel({ title, sub, right, children, className = '', testID, style }: { title?: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; testID?: string; style?: ViewStyle }) {
  return (
    <View testID={testID} className={`bg-surface border border-line rounded-3xl p-4 ${className}`} style={[{ boxShadow: SHADOW } as any, style]}>
      {title || right ? (
        <View className="flex-row items-start justify-between mb-3.5 gap-3">
          <View className="flex-1" style={{ minWidth: 0 }}>
            {title ? <Txt accessibilityRole="header" className="font-extrabold text-[15px] leading-[20px]" numberOfLines={2}>{title}</Txt> : null}
            {sub ? <Txt className="text-muted text-[12px] leading-[17px] mt-0.5">{sub}</Txt> : null}
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** +12 % / -8 % pill. `flat` hides the arrow when there is no change. */
export function Delta({ v, testID }: { v: number; testID?: string }) {
  const up = v > 0, down = v < 0;
  const tone = up ? 'success' : down ? 'danger' : 'muted';
  return (
    <View testID={testID} className={`flex-row items-center rounded-full px-2 h-[22px] gap-0.5 ${up ? 'bg-success/15' : down ? 'bg-danger/15' : 'bg-surface2'}`}>
      <Icon name={up ? 'trending-up' : down ? 'trending-down' : 'minus'} size={13} tone={tone} />
      <Txt className={`text-[11px] font-extrabold ${up ? 'text-success' : down ? 'text-danger' : 'text-muted'}`}>{up ? '+' : ''}{v}%</Txt>
    </View>
  );
}

/** Headline metric: icon, rolling number, change vs previous period, sparkline. `hot` = dark call-to-action variant. */
export function Kpi({ id, icon, label, value, suffix, delta, spark, sub, active, hot, onPress }: { id: string; icon: string; label: string; value: number; suffix?: string; delta?: number; spark?: number[]; sub?: string; active?: boolean; hot?: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const n = useCountUp(value);
  const [hov, hp] = useHover();
  const fg = hot ? 'text-onink' : '';
  return (
    <Pressable testID={`kpi-${id}`} accessibilityRole="button" accessibilityLabel={`${label}: ${value}${suffix ?? ''}`} accessibilityState={{ selected: !!active }} onPress={onPress} {...hp}
      className={`rounded-3xl border p-4 ${hot ? 'bg-ink border-ink' : active ? 'bg-surface border-ink' : 'bg-surface border-line'}`}
      style={{ flexGrow: 1, flexBasis: 200, minWidth: 0, boxShadow: hov ? HOVER : SHADOW, transform: [{ translateY: hov ? -2 : 0 }], ...T } as any}>
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2 flex-1" style={{ minWidth: 0 }}>
          <View className={`w-8 h-8 rounded-xl items-center justify-center ${hot ? 'bg-primary' : 'bg-soft'}`}><Icon name={icon} size={17} tone={hot ? 'onprimary' : 'fg'} /></View>
          <Txt numberOfLines={1} className={`text-[12px] font-bold flex-1 ${hot ? 'text-onink opacity-80' : 'text-muted'}`}>{label}</Txt>
        </View>
        {delta !== undefined ? <Delta v={delta} /> : null}
      </View>
      <View className="flex-row items-end gap-1">
        <Txt className={`text-[34px] leading-[38px] font-black ${fg}`} style={{ letterSpacing: -1 }}>{n}</Txt>
        {suffix ? <Txt className={`text-[16px] font-extrabold mb-1 ${hot ? 'text-onink opacity-70' : 'text-muted'}`}>{suffix}</Txt> : null}
      </View>
      {spark ? <View style={{ marginTop: 6 }}><Spark values={spark} color={active ? colors.ink : colors.muted} /></View> : null}
      {sub ? <Txt numberOfLines={2} className={`text-[11px] mt-1.5 ${hot ? 'text-onink opacity-70' : 'text-muted'}`}>{sub}</Txt> : null}
    </Pressable>
  );
}

/** Segmented control. */
export function Seg<K extends string | number>({ options, value, onChange, testID, small }: { options: { key: K; label: string; testID?: string }[]; value: K; onChange: (k: K) => void; testID?: string; small?: boolean }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" className="flex-row bg-surface2 rounded-full p-0.5" style={{ gap: 2, alignSelf: 'flex-start' }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={String(o.key)} testID={o.testID} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} onPress={() => onChange(o.key)}
            className={`${small ? 'px-3 h-8' : 'px-3.5 h-9'} rounded-full items-center justify-center ${on ? 'bg-ink' : ''}`} style={T}>
            <Txt className={`${small ? 'text-[12px]' : 'text-[13px]'} font-bold ${on ? 'text-onink' : 'text-muted'}`}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Round icon button used in headers. */
export function IconBtn({ icon, label, onPress, testID, busy, on }: { icon: string; label: string; onPress: () => void; testID?: string; busy?: boolean; on?: boolean }) {
  const [hov, hp] = useHover();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={busy} {...hp}
      className={`w-10 h-10 rounded-full border items-center justify-center ${on ? 'bg-ink border-ink' : 'bg-surface border-line'}`}
      style={{ opacity: busy ? 0.5 : 1, boxShadow: hov ? HOVER : SHADOW, ...T } as any}>
      <Icon name={icon} size={18} tone={on ? 'onink' : 'fg'} />
    </Pressable>
  );
}

/** Avatar with initials (people) or an icon tile. */
export function Initials({ name, size = 34 }: { name: string; size?: number }) {
  const s = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return <View className="bg-soft items-center justify-center" style={{ width: size, height: size, borderRadius: size / 2 }}><Txt className="font-extrabold" style={{ fontSize: size * 0.38 }}>{s}</Txt></View>;
}
