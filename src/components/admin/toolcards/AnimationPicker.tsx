import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { FX_IDS } from '@/lib/toolCards';

/**
 * Popup that lists the 20 effects in one place. It is NOT a modal: it fills the settings area only (its parent is `position: relative`),
 * so the fixed card preview above stays visible and every tick or choice shows up in it immediately.
 *  - Multiple mode: checkboxes + "Select all" / "Clear".
 *  - Single mode: radio buttons, one choice.
 * "Done" only closes the popup; nothing needs confirming.
 */
export function AnimationPicker({ mode, effects, effect, onToggle, onAll, onClear, onPick, onClose }: {
  mode: 'single' | 'multiple'; effects: number[]; effect: number;
  onToggle: (id: number) => void; onAll: () => void; onClear: () => void; onPick: (id: number) => void; onClose: () => void;
}) {
  const { t } = useT();
  const multi = mode === 'multiple';
  return (
    <View testID="fx-popup" style={[StyleSheet.absoluteFill, { zIndex: 20 }]} className="bg-bg">
      <View className="flex-row items-center gap-2 px-3 py-2 border-b border-line">
        <Txt className="flex-1 font-extrabold text-[16px]" numberOfLines={1}>{t('tc.animations')}{multi ? ` (${effects.length}/20)` : ''}</Txt>
        {multi ? <>
          <Button testID="fx-all" size="sm" variant="soft" title={t('tc.selectAll')} onPress={onAll} />
          <Button testID="fx-clear" size="sm" variant="soft" title={t('tc.clear')} onPress={onClear} />
        </> : null}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 4 }}>
        {multi && effects.length === 0 ? <Txt className="text-muted text-[12px] mb-1">{t('tc.noneSelected')}</Txt> : null}
        {FX_IDS.map((id) => {
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
        })}
      </ScrollView>
      <View className="px-3 py-2 border-t border-line"><Button testID="fx-done" title={t('common.done')} onPress={onClose} full /></View>
    </View>
  );
}
