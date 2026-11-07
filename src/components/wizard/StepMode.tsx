import React from 'react';
import { Pressable, View } from 'react-native';
import { sorted, useStore } from '@/store/useStore';
import { useL, useT } from '@/i18n';
import { GridSelector } from '@/components/ui/GridSelector';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import type { RenderMode } from '@/data/types';

export function StepMode({ mode, paletteId, onMode, onPalette }: { mode?: RenderMode; paletteId?: string; onMode: (m: RenderMode) => void; onPalette: (id?: string) => void }) {
  const { t } = useT();
  const L = useL();
  const palettes = sorted(useStore((s) => s.palettes)).filter((p) => p.visible);
  // Admin > Interface: the Relooking / Renovation choice can be hidden (every generation is then a Relooking).
  const choice = useStore((s) => s.doc.settings.modeChoice) !== false;
  const cards: { k: RenderMode; title: string; desc: string; icon: string }[] = [
    { k: 'restyle', title: t('wizard.modeRestyle'), desc: t('wizard.modeRestyleDesc'), icon: 'palette-swatch-outline' },
    { k: 'renovation', title: t('wizard.modeRenovation'), desc: t('wizard.modeRenovationDesc'), icon: 'hammer-wrench' },
  ];
  return (
    <View>
      {choice ? <><Txt className="text-[16px] font-bold mb-3">{t('wizard.modeTitle')}</Txt>
      <View className="flex-row gap-3 mb-6">
        {cards.map((c) => {
          const on = (mode ?? 'restyle') === c.k;
          return (
            <Pressable key={c.k} testID={`mode-${c.k}`} onPress={() => onMode(c.k)} className={`flex-1 rounded-xl p-3.5 border-2 ${on ? 'border-primary bg-soft' : 'border-transparent bg-surface2'} active:opacity-80`}>
              <Icon name={c.icon} size={22} tone={on ? 'fg' : 'muted'} />
              <Txt className="font-extrabold text-[14px] mt-2">{c.title}</Txt>
              <Txt className="text-muted text-[12px] mt-1 leading-4">{c.desc}</Txt>
            </Pressable>
          );
        })}
      </View></> : null}
      <Txt className="text-[16px] font-bold mb-3">{t('wizard.palette')}</Txt>
      <GridSelector items={palettes} cols={{ m: 2, t: 3, d: 4 }} gap={10} renderItem={(p) => {
        const on = paletteId === p.id;
        return (
          <Pressable testID={`pal-${p.id}`} onPress={() => onPalette(on ? undefined : p.id)} className={`rounded-xl border-2 overflow-hidden ${on ? 'border-primary bg-soft' : 'border-transparent bg-surface2'} active:opacity-80`} style={{ height: 76 }}>
            <View className="flex-1 items-center justify-center gap-1.5 px-2">
              {p.isSurprise ? <Icon name="auto-fix" size={24} /> : (
                <View className="flex-row rounded-full overflow-hidden" style={{ height: 22, width: '80%' }}>
                  {p.colors.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}
                </View>
              )}
              <Txt className="text-[11.5px] font-semibold text-center" numberOfLines={1}>{L(p.title)}</Txt>
            </View>
          </Pressable>
        );
      }} />
    </View>
  );
}
