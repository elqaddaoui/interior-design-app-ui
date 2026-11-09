import React from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { CTA_ICON, ctaHref, demoItems, pickText } from '@/lib/demoMessages';
import type { DemoConfig, DemoMessage } from '@/data/types';

/**
 * The suggestions of an empty assistant chat (owner: Admin > Assistant > Demo messages). A tap runs the item: a written answer
 * appears at once, a "write" item drops a starter sentence in the message box, the rest goes to the normal assistant.
 * `preview` renders the same thing inside the admin editor (taps do nothing there).
 */
export function DemoCards({ config, onPick, disabled, preview }: { config: DemoConfig; onPick: (item: DemoMessage) => void; disabled?: boolean; preview?: boolean }) {
  const { t, lang } = useT();
  const items = demoItems(config, lang);
  if (!items.length) return null;
  const title = pickText(config.title, lang), subtitle = pickText(config.subtitle, lang);
  const chips = config.layout === 'chips';
  return (
    <View testID="demo-cards" accessibilityLabel={title || t('dm.list')} style={{ width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 8, gap: 12 }}>
      {title || subtitle ? (
        <View style={{ gap: 2 }}>
          {title ? <Txt accessibilityRole="header" className="text-[13px] font-extrabold text-muted text-center">{title}</Txt> : null}
          {subtitle ? <Txt className="text-[12px] text-muted text-center">{subtitle}</Txt> : null}
        </View>
      ) : null}
      <View className="flex-row flex-wrap justify-center" style={{ gap: 10 }}>
        {items.map((item, i) => {
          const label = pickText(item.label, lang);
          const write = item.mode === 'write';
          return (
            <Animated.View key={item.id} entering={preview ? undefined : FadeInDown.delay(60 + i * 50).duration(260)} style={chips ? undefined : { width: '48%', flexGrow: 1, minWidth: 150 }}>
              <Pressable testID={`demo-card-${item.id}`} accessibilityRole="button" accessibilityLabel={write ? `${label} — ${t('dm.writeHint')}` : label} disabled={disabled || preview} onPress={() => onPick(item)}
                className={chips ? 'flex-row items-center rounded-full border border-primary/40 bg-surface active:opacity-70' : 'flex-row items-center rounded-2xl border border-line bg-surface active:opacity-70'}
                style={chips ? { gap: 8, paddingHorizontal: 14, paddingVertical: 10, opacity: disabled ? 0.5 : 1 } : { gap: 10, padding: 12, minHeight: 64, opacity: disabled ? 0.5 : 1 }}>
                <View className="bg-soft items-center justify-center" style={{ width: chips ? 26 : 38, height: chips ? 26 : 38, borderRadius: 19 }}><Icon name={item.icon} size={chips ? 16 : 21} tone="primary" /></View>
                <Txt numberOfLines={chips ? 2 : 3} className={`flex-1 font-semibold ${chips ? 'text-[13px] leading-[18px]' : 'text-[14px] leading-[19px]'}`}>{label}</Txt>
                {write ? <Icon name="pencil-outline" size={14} tone="muted" /> : null}
              </Pressable>
            </Animated.View>
          );
        })}
      </View>
    </View>
  );
}

/** Under an answer: what the person may pick next (owner's follow-ups) and the answer's action button. */
export function DemoNext({ item, options, onPick, onCta, disabled }: { item: DemoMessage; options: DemoMessage[]; onPick: (item: DemoMessage) => void; onCta: (href: string) => void; disabled?: boolean }) {
  const { t, lang } = useT();
  const href = ctaHref(item.cta);
  if (!options.length && !href) return null;
  return (
    <Animated.View entering={FadeInDown.duration(220)} testID="demo-next" style={{ gap: 8, marginTop: 4, marginBottom: 6 }}>
      {href ? (
        <Pressable testID={`demo-cta-${item.cta}`} accessibilityRole="link" onPress={() => onCta(href)} className="self-start flex-row items-center rounded-full bg-primary active:opacity-80" style={{ gap: 8, paddingHorizontal: 16, height: 40 }}>
          <Icon name={CTA_ICON[item.cta]} size={18} tone="onprimary" />
          <Txt className="text-onprimary font-bold text-[13px]">{t(`dm.cta${item.cta[0].toUpperCase()}${item.cta.slice(1)}`)}</Txt>
        </Pressable>
      ) : null}
      {options.length ? (
        <View style={{ gap: 6 }}>
          <Txt className="text-muted text-[11px] font-bold uppercase" style={{ letterSpacing: 0.8 }}>{t('dm.next')}</Txt>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {options.map((o) => (
              <Pressable key={o.id} testID={`demo-next-${o.id}`} accessibilityRole="button" disabled={disabled} onPress={() => onPick(o)} className="flex-row items-center rounded-full border border-primary/50 bg-surface active:opacity-70" style={{ gap: 6, paddingHorizontal: 12, paddingVertical: 8, opacity: disabled ? 0.5 : 1 }}>
                <Icon name={o.icon} size={15} tone="primary" />
                <Txt className="text-[13px] leading-[18px] font-semibold text-primary" numberOfLines={2}>{pickText(o.label, lang)}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}
