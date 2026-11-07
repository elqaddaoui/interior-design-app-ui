import React from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';

/** Small building blocks of Admin > Prompt cards: one look for every control, nothing else to learn. */

export function Tabs<T extends string>({ value, options, onChange, prefix = 'pc' }: { value: T; options: { key: T; label: string; icon: string; dot?: boolean }[]; onChange: (v: T) => void; prefix?: string }) {
  return (
    <View testID={`${prefix}-tabs`} accessibilityRole="tablist" className="flex-row bg-surface2 rounded-2xl p-1 gap-1">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key} testID={`${prefix}-tab-${o.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} className={`flex-1 rounded-xl items-center justify-center py-2 gap-0.5 ${on ? 'bg-surface border border-line' : 'border border-transparent'}`} style={{ minWidth: 0, minHeight: 56 }}>
            <View>
              <Icon name={o.icon} size={21} tone={on ? 'primary' : 'muted'} />
              {o.dot ? <View testID={`${prefix}-tab-${o.key}-dot`} className="absolute w-2 h-2 rounded-full bg-primary" style={{ top: -1, end: -4 }} /> : null}
            </View>
            <Txt className={`text-[11.5px] ${on ? 'font-extrabold' : 'font-semibold text-muted'}`} numberOfLines={1}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <View className="mb-1.5">
      <Txt className="text-[13px] font-bold">{children}</Txt>
      {hint ? <Txt className="text-[12px] text-muted mt-0.5">{hint}</Txt> : null}
    </View>
  );
}

/** Pick one of a few options with a picture and a short line each (clearer than a bare switch or a drop-down). */
export function OptionTiles<T extends string>({ value, options, onChange, testID }: { value: T; options: { key: T; label: string; sub: string; icon: string }[]; onChange: (v: T) => void; testID: string }) {
  return (
    <View testID={testID} accessibilityRole="radiogroup" className="flex-row gap-2">
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key} testID={`${testID}-${o.key}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(o.key)} className={`flex-1 rounded-xl border-2 px-2 py-2.5 items-center gap-1 ${on ? 'border-primary bg-surface2' : 'border-line bg-surface'}`} style={{ minWidth: 0 }}>
            <Icon name={o.icon} size={22} tone={on ? 'primary' : 'muted'} />
            <Txt className="text-[13px] font-extrabold text-center" numberOfLines={1}>{o.label}</Txt>
            <Txt className="text-[11px] text-muted text-center" numberOfLines={2}>{o.sub}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chips<T extends string>({ value, options, onChange, testID }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; testID?: string }) {
  return (
    <View className="flex-row flex-wrap gap-2" testID={testID}>
      {options.map((o) => (
        <Pressable key={o.key} testID={testID ? `${testID}-${o.key || 'none'}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: value === o.key }} onPress={() => onChange(o.key)} className={`px-3.5 h-9 rounded-full items-center justify-center border ${value === o.key ? 'bg-ink border-ink' : 'bg-surface border-line'}`}>
          <Txt className={`text-[13px] font-bold ${value === o.key ? 'text-onink' : ''}`} numberOfLines={1}>{o.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

export function Note({ text, tone, testID }: { text: string; tone: 'info' | 'warn'; testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-start gap-2 bg-surface2 rounded-xl p-2.5 mb-2">
      <Icon name={tone === 'warn' ? 'alert-circle-outline' : 'information-outline'} size={18} tone={tone === 'warn' ? 'danger' : 'primary'} />
      <Txt className="text-[12px] leading-[18px] flex-1">{text}</Txt>
    </View>
  );
}

/**
 * The one place that says where a tool's settings come from. "Same as All tools" (nothing stored for this tool) or "Custom"
 * (this tool has its own values for the section). Switching back never loses the work: the screen keeps what was there.
 */
export function InheritBar({ custom, onCustomize, onInherit }: { custom: boolean; onCustomize: () => void; onInherit: () => void }) {
  const { t } = useT();
  return (
    <Card testID="pc-inherit" className={`p-3 mb-3 flex-row items-center gap-3 ${custom ? 'border-primary' : ''}`}>
      <View className={`w-9 h-9 rounded-full items-center justify-center ${custom ? 'bg-primary' : 'bg-surface2'}`}><Icon name={custom ? 'circle-edit-outline' : 'link-variant'} size={19} tone={custom ? 'onprimary' : 'muted'} /></View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt testID="pc-inherit-state" className="text-[14px] font-extrabold">{t(custom ? 'pc.customTitle' : 'pc.sameTitle')}</Txt>
        <Txt className="text-[12px] text-muted">{t(custom ? 'pc.customBody' : 'pc.sameBody')}</Txt>
      </View>
      {custom
        ? <Button testID="pc-inherit-off" size="sm" variant="soft" icon="link-variant" title={t('pc.backToAll')} onPress={onInherit} />
        : <Button testID="pc-inherit-on" size="sm" icon="circle-edit-outline" title={t('pc.customize')} onPress={onCustomize} />}
    </Card>
  );
}
