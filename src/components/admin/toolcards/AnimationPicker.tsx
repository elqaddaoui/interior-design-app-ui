import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { FX_FADE, TIERS, TIER_ORDER } from '@/lib/toolCardFx';

/**
 * Popup that lists the effects the admin ENABLED (Transition availability decides what exists). It is NOT a modal: it fills the settings
 * area only (its parent is `position: relative`), so the fixed card preview above stays visible and every tick shows up in it at once.
 *  - Multiple mode: checkboxes + "Select all" / "Clear" (they act on the enabled effects only).
 *  - Single mode: radio buttons, one choice.
 * The cross-fade (0) is always listed first: it is always enabled and cannot be turned off.
 * "Done" only closes the popup; nothing needs confirming.
 */
export function AnimationPicker({ mode, effects, effect, enabled, onToggle, onAll, onClear, onPick, onClose }: {
  mode: 'single' | 'multiple'; effects: number[]; effect: number; enabled: number[];
  onToggle: (id: number) => void; onAll: () => void; onClear: () => void; onPick: (id: number) => void; onClose: () => void;
}) {
  const { t } = useT();
  const multi = mode === 'multiple';
  const total = enabled.length + 1;
  const row = (id: number) => {
    const on = multi ? effects.includes(id) : effect === id;
    return (
      <Pressable key={id} testID={`fx-${id}`} accessibilityRole={multi ? 'checkbox' : 'radio'} accessibilityState={multi ? { checked: on } : { selected: on }}
        onPress={() => (multi ? onToggle(id) : onPick(id))}
        className={`flex-row items-center gap-3 px-3 h-11 rounded-xl ${on ? 'bg-soft' : 'bg-surface2'}`}>
        <Icon name={multi ? (on ? 'checkbox-marked' : 'checkbox-blank-outline') : on ? 'radiobox-marked' : 'radiobox-blank'} size={22} tone={on ? 'primary' : 'muted'} />
        <Txt className="w-6 text-muted text-[12px] font-bold">{id}</Txt>
        <Txt className="flex-1 text-[14px] font-semibold" numberOfLines={1}>{t(`tc.fx.${id}`)}</Txt>
      </Pressable>
    );
  };
  return (
    <View testID="fx-popup" style={[StyleSheet.absoluteFill, { zIndex: 20 }]} className="bg-bg">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-line">
        <Txt className="flex-1 font-extrabold text-[16px]" numberOfLines={1}>{t('tc.animations')}{multi ? ` (${effects.length}/${total})` : ''}</Txt>
        {multi ? <>
          <Button testID="fx-all" size="sm" variant="soft" title={t('tc.selectAll')} onPress={onAll} />
          <Button testID="fx-clear" size="sm" variant="soft" title={t('tc.clear')} onPress={onClear} />
        </> : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 4 }}>
        <Txt className="text-muted text-[12px] mb-1">{t('tc.pickerNote')}</Txt>
        {multi && effects.length === 0 ? <Txt className="text-muted text-[12px] mb-1">{t('tc.noneSelected')}</Txt> : null}
        {row(FX_FADE)}
        {TIER_ORDER.map((tier) => {
          const ids = TIERS[tier].filter((id) => enabled.includes(id)).sort((a, b) => a - b);
          if (ids.length === 0) return null;
          return (
            <View key={tier} style={{ gap: 4 }}>
              <Txt className="text-muted text-[12px] font-bold mt-2">{t(`tc.tier.${tier}`)}</Txt>
              {ids.map(row)}
            </View>
          );
        })}
      </ScrollView>
      <View className="px-3 py-2 border-t border-line"><Button testID="fx-done" title={t('common.done')} onPress={onClose} full /></View>
    </View>
  );
}
