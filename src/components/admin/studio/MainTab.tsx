import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { FX_FADE, TIERS, TIER_ORDER } from '@/lib/toolCardFx';
import type { StudioStyle } from '@/lib/fxStudio';
import { Chips } from './ui';
import { ColorRandom } from './ColorRandom';

type Tier = (typeof TIER_ORDER)[number];
const TIER_ICON: Record<Tier, string> = { safe: 'shield-check-outline', medium: 'speedometer-medium', heavy: 'fire', creative: 'creation' };
const tierOf = (id: number): Tier => TIER_ORDER.find((x) => TIERS[x].includes(id)) ?? 'safe';

/**
 * "Transition" tab, minimal: ONE card with the current transition (number + name) and the "same on every card" switch, four icon tabs
 * (one per family) and only the chosen family's chips; accent colour and random seed live behind a single "Colour & randomness" row (see ColorRandom).
 * Same behaviour as before: picking a chip shows it on the stage (`onEffect`) and, when the switch is on, forces it (`onChange({ force })`).
 */
export function MainTab({ style, effect, onEffect, onChange }: { style: StudioStyle; effect: number; onEffect: (id: number) => void; onChange: (patch: Record<string, unknown>) => void }) {
  const { t } = useT();
  // The family being browsed is remembered together with the transition that was current then: once another transition is picked, the view follows it.
  const [browse, setBrowse] = useState<{ tier: Tier; effect: number } | null>(null);
  const [more, setMore] = useState(false);
  const tier = browse && browse.effect === effect ? browse.tier : tierOf(effect);
  const forced = style.force > 0;
  const pick = (id: number) => { onEffect(id); if (forced) onChange({ force: id }); };
  const options = [...(tier === 'safe' ? [FX_FADE] : []), ...TIERS[tier]].map((id) => ({ key: id, label: `${id} · ${t(`tc.fx.${id}`)}` }));

  return (
    <View style={{ gap: 12 }}>
      <View className="bg-surface rounded-2xl border border-line p-3" style={{ gap: 12 }}>
        {/* now playing + "all cards" switch */}
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <View testID="st-now" className="w-11 h-11 rounded-2xl bg-ink items-center justify-center"><Txt className="text-onink font-black text-[16px]">{effect}</Txt></View>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Txt className="text-[15px] font-extrabold" numberOfLines={1}>{t(`tc.fx.${effect}`)}</Txt>
            <Txt className="text-muted text-[12px]" numberOfLines={1}>{t(`st.tierShort.${tierOf(effect)}`)}</Txt>
          </View>
          <View className="flex-row items-center bg-surface2 rounded-full ps-3 pe-1 h-10" style={{ gap: 8 }}>
            <Icon name={forced ? 'link-variant' : 'link-variant-off'} size={18} tone={forced ? 'fg' : 'muted'} />
            <Txt className="text-[12.5px] font-bold">{t('st.forceShort')}</Txt>
            <Toggle testID="st-force" label={`${t('st.sameAll')}. ${t('st.sameAllNote')}`} value={forced} onValueChange={(on) => onChange({ force: on ? effect : 0 })} />
          </View>
        </View>

        {/* four families as icons */}
        <View testID="st-tiers" accessibilityRole="tablist" className="flex-row" style={{ gap: 6 }}>
          {TIER_ORDER.map((x) => {
            const on = x === tier;
            return (
              <Pressable key={x} testID={`st-tier-${x}`} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t(`tc.tier.${x}`)} onPress={() => setBrowse({ tier: x, effect })}
                className={`flex-1 h-11 rounded-xl items-center justify-center border ${on ? 'bg-ink border-ink' : 'bg-surface2 border-line'}`}>
                <Icon name={TIER_ICON[x]} size={21} tone={on ? 'onink' : 'muted'} />
              </Pressable>
            );
          })}
        </View>
        <Txt className="text-muted text-[12px] font-bold -mt-1">{t(`st.tierShort.${tier}`)} · {t('st.fxCount', { n: TIERS[tier].length })}</Txt>

        <Chips testID={`st-fx-${tier}`} value={effect} options={options} onChange={pick} />
      </View>

      {/* secondary options: only when asked for */}
      <View className="bg-surface rounded-2xl border border-line">
        <Pressable testID="st-more" accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => setMore(!more)} className="flex-row items-center px-3 h-12 active:opacity-70" style={{ gap: 10 }}>
          <Icon name="tune-variant" size={19} tone="muted" />
          <Txt className="flex-1 text-[13.5px] font-bold">{t('st.more')}</Txt>
          {style.accent ? <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: style.accent }} className="border border-line" /> : null}
          <Icon name={more ? 'chevron-up' : 'chevron-down'} size={20} tone="muted" />
        </Pressable>
        {more ? (
          <View className="px-3 pb-3 border-t border-line" style={{ paddingTop: 14 }}>
            <ColorRandom style={style} onChange={onChange} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
