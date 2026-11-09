import React, { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt, useAppFont } from '@/components/ui/Txt';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { DEFAULT_STUDIO, SEED_MAX, SEED_MIN, clampSeed, newSeed, randomAccent, type StudioStyle } from '@/lib/fxStudio';

/** Ready-made accents; the theme colour is always offered first (it is what "Auto" means). */
const SWATCHES = ['#FBDD2D', '#F59E0B', '#EF4444', '#EC4899', '#8B5CF6', '#2563EB', '#06B6D4', '#16A34A', '#111111', '#FFFFFF'];

function Section({ icon, title, hint, onReset, resetLabel, resetId, children }: { icon: string; title: string; hint: string; onReset?: () => void; resetLabel: string; resetId: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Icon name={icon} size={18} tone="muted" />
        <Txt accessibilityRole="header" className="flex-1 text-[13.5px] font-extrabold" numberOfLines={1}>{title}</Txt>
        {onReset ? <Pressable testID={resetId} accessibilityRole="button" accessibilityLabel={resetLabel} onPress={onReset} hitSlop={8} className="flex-row items-center rounded-full bg-surface2 px-2.5 h-8 active:opacity-70" style={{ gap: 5 }}><Icon name="restore" size={15} tone="muted" /><Txt className="text-[12px] font-bold text-muted">{resetLabel}</Txt></Pressable> : null}
      </View>
      <Txt className="text-muted text-[12px] -mt-1.5">{hint}</Txt>
      {children}
    </View>
  );
}

/** One round swatch; the picked one wears a check mark in the colour that stays readable on it. */
function Swatch({ color, on, label, onPress, testID, auto }: { color: string; on: boolean; label: string; onPress: () => void; testID: string; auto?: boolean }) {
  const { colors } = useTheme();
  const light = /^#(?:F|E|D)/i.test(color) && color.toUpperCase() !== '#F59E0B';
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={onPress} hitSlop={4}
      className="items-center justify-center active:opacity-80" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color, borderWidth: on ? 3 : 1, borderColor: on ? colors.fg : colors.line }}>
      {on ? <Icon name="check" size={18} color={light ? '#111111' : '#FFFFFF'} /> : auto ? <Icon name="auto-fix" size={16} color="#FFFFFF" /> : null}
    </Pressable>
  );
}

function RoundBtn({ icon, label, onPress, testID, tone = 'surface2' }: { icon: string; label: string; onPress: () => void; testID: string; tone?: 'surface2' | 'ink' }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className={`w-11 h-11 rounded-full items-center justify-center active:opacity-70 ${tone === 'ink' ? 'bg-ink' : 'bg-surface2 border border-line'}`}>
      <Icon name={icon} size={20} tone={tone === 'ink' ? 'onink' : 'fg'} />
    </Pressable>
  );
}

/**
 * "Colour & randomness" of the Animation Studio, in two small sections:
 *  - Colour: the accent used by every "accent" paint. Auto (the app theme) or one tap on a swatch, a random colour, or an exact #RRGGBB.
 *  - Randomness: the seed. Same seed = same look (piece positions, random directions). A number you can type, step with - / +, or roll.
 * Every control writes one valid value (a seed is always a whole number 1..9999), so nothing here can put the style in a state the player rejects.
 */
export function ColorRandom({ style, onChange }: { style: StudioStyle; onChange: (patch: Record<string, unknown>) => void }) {
  const { t } = useT();
  const { colors } = useTheme();
  const fontFamily = useAppFont();
  const auto = !style.accent;
  const current = (style.accent || colors.primary).toUpperCase();
  const [custom, setCustom] = useState(false);
  // What is being typed (null = not editing: the field shows the style's own seed, so steps, dice and undo always show through).
  const [typed, setTyped] = useState<string | null>(null);
  const draft = typed ?? String(style.seed);
  const commitSeed = (value: string) => { const n = clampSeed(parseInt(value.replace(/\D/g, ''), 10)); setTyped(null); if (n !== style.seed) onChange({ seed: n }); };
  const step = (by: number) => onChange({ seed: style.seed + by > SEED_MAX ? SEED_MIN : style.seed + by < SEED_MIN ? SEED_MAX : style.seed + by });
  const isSwatch = SWATCHES.includes(current);
  const showPicker = custom || (!auto && !isSwatch);

  return (
    <View testID="st-colorrandom" style={{ gap: 18 }}>
      <Section icon="palette-outline" title={t('st.cr.colorTitle')} hint={t('st.cr.colorHint')} resetId="st-accent-reset" resetLabel={t('st.cr.reset')} onReset={auto ? undefined : () => { setCustom(false); onChange({ accent: '' }); }}>
        <View className="flex-row items-center bg-surface2 rounded-2xl border border-line p-2.5" style={{ gap: 10 }}>
          <View testID="st-accent-preview" style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: current }} className="border border-line" />
          <View className="flex-1" style={{ minWidth: 0 }}>
            <Txt className="text-[14px] font-extrabold" numberOfLines={1}>{auto ? t('st.accentAuto') : t('st.cr.chosen')}</Txt>
            <Txt testID="st-accent-hex" className="text-muted text-[12px]" style={{ fontVariant: ['tabular-nums'] }}>{current}</Txt>
          </View>
          <RoundBtn testID="st-accent-random" icon="shuffle-variant" label={t('st.cr.randomColor')} onPress={() => { setCustom(false); onChange({ accent: randomAccent() }); }} />
        </View>
        <View testID="st-accent-swatches" accessibilityRole="radiogroup" className="flex-row flex-wrap items-center" style={{ gap: 10 }}>
          <Swatch testID="st-accent-auto" auto color={colors.primary} on={auto} label={t('st.accentAuto')} onPress={() => { setCustom(false); onChange({ accent: '' }); }} />
          {SWATCHES.map((c) => <Swatch key={c} testID={`st-accent-${c.slice(1)}`} color={c} on={!auto && current === c} label={c} onPress={() => { setCustom(false); onChange({ accent: c }); }} />)}
          <Pressable testID="st-accent-custom" accessibilityRole="button" accessibilityState={{ expanded: showPicker }} accessibilityLabel={t('st.cr.custom')} onPress={() => { setCustom(!showPicker); if (auto) onChange({ accent: current }); }}
            className={`h-9 px-3 rounded-full flex-row items-center border ${showPicker ? 'bg-ink border-ink' : 'bg-surface2 border-line'}`} style={{ gap: 6 }}>
            <Icon name="eyedropper-variant" size={16} tone={showPicker ? 'onink' : 'muted'} />
            <Txt className={`text-[12.5px] font-bold ${showPicker ? 'text-onink' : ''}`}>{t('st.cr.custom')}</Txt>
          </Pressable>
        </View>
        {showPicker ? <ColorPicker compact value={style.accent || current} onChange={(accent) => onChange({ accent })} /> : null}
      </Section>

      <View className="border-t border-line" />

      <Section icon="dice-multiple-outline" title={t('st.cr.randTitle')} hint={t('st.cr.randHint')} resetId="st-seed-reset" resetLabel={t('st.cr.reset')} onReset={style.seed === DEFAULT_STUDIO.seed ? undefined : () => onChange({ seed: DEFAULT_STUDIO.seed })}>
        {/* the stepper is LTR-locked: "-" on the left, "+" on the right, in every language */}
        <View className="flex-row items-center justify-between" style={{ gap: 10, direction: 'ltr' }}>
          <RoundBtn testID="st-seed-prev" icon="minus" label={t('st.cr.prev')} onPress={() => step(-1)} />
          <View className="flex-1 flex-row items-center justify-center bg-surface2 rounded-2xl border border-line h-11" style={{ gap: 4 }}>
            <Txt className="text-muted text-[15px] font-bold">#</Txt>
            <TextInput testID="st-seed" accessibilityLabel={t('st.seed')} value={draft} onChangeText={(v) => setTyped(v.replace(/\D/g, '').slice(0, 4))} onBlur={() => commitSeed(draft)} onSubmitEditing={() => commitSeed(draft)}
              keyboardType="number-pad" inputMode="numeric" maxLength={4} selectTextOnFocus
              style={{ fontFamily, color: colors.fg, fontSize: 18, fontWeight: '800', minWidth: 56, textAlign: 'center', padding: 0, outlineStyle: 'none', fontVariant: ['tabular-nums'] } as any} />
          </View>
          <RoundBtn testID="st-seed-next" icon="plus" label={t('st.cr.next')} onPress={() => step(1)} />
          <RoundBtn testID="st-seed-dice" tone="ink" icon="dice-multiple-outline" label={t('st.cr.newSeed')} onPress={() => onChange({ seed: newSeed(style.seed) })} />
        </View>
        <Txt className="text-muted text-[11.5px]">{t('st.cr.range', { min: SEED_MIN, max: SEED_MAX })}</Txt>
      </Section>
    </View>
  );
}
