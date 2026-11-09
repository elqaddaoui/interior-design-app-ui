import React, { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { AUDIENCE_ICON, type Audience } from '@/lib/settingsMap';

/** Tint of each audience: the same colour language on the map, on the Interface sections and in the filters. */
export const AUDIENCE_TONE: Record<Audience, { bg: string; fg: 'primary' | 'danger' | 'success' | 'muted' }> = {
  clients: { bg: 'bg-soft', fg: 'primary' },
  both: { bg: 'bg-soft', fg: 'success' },
  admins: { bg: 'bg-surface2', fg: 'danger' },
  personal: { bg: 'bg-surface2', fg: 'muted' },
};

/** Small pill telling WHO a setting affects ("Clients", "Admins"...). `compact` = icon only on very narrow rows. */
export function AudienceBadge({ audience, testID, compact }: { audience: Audience; testID?: string; compact?: boolean }) {
  const { t } = useT();
  const tone = AUDIENCE_TONE[audience];
  return (
    <View testID={testID} accessibilityLabel={`${t('sm.legend')} ${t(`sm.aud_${audience}`)}`} className={`flex-row items-center rounded-full ${tone.bg} border border-line`} style={{ gap: 5, paddingHorizontal: compact ? 7 : 9, height: 24 }}>
      <Icon name={AUDIENCE_ICON[audience]} size={13} tone={tone.fg} />
      {compact ? null : <Txt numberOfLines={1} className="text-[11px] font-extrabold">{t(`sm.aud_${audience}`)}</Txt>}
    </View>
  );
}

/** Section title for a group of settings that share one audience: badge, title and a one-line reason. */
export function AudienceSection({ audience, title, desc, testID, children }: { audience: Audience; title: string; desc: string; testID?: string; children: React.ReactNode }) {
  return (
    <View testID={testID} className="mb-2">
      <View className="flex-row items-center mt-3 mb-2" style={{ gap: 10 }}>
        <View className="w-9 h-9 rounded-full bg-soft items-center justify-center"><Icon name={AUDIENCE_ICON[audience]} size={19} tone={AUDIENCE_TONE[audience].fg} /></View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="font-black text-[17px]" style={{ letterSpacing: -0.3 }} accessibilityRole="header">{title}</Txt>
          <Txt className="text-muted text-[12.5px]">{desc}</Txt>
        </View>
      </View>
      {children}
    </View>
  );
}

/** Legend row: tap an audience to filter. `value` null = all. */
export function AudienceFilter({ value, onChange, counts }: { value: Audience | 'all'; onChange: (v: Audience | 'all') => void; counts: Record<Audience | 'all', number> }) {
  const { t } = useT();
  const items: (Audience | 'all')[] = ['all', 'clients', 'admins', 'personal'];
  return (
    <View testID="sm-filter" accessibilityRole="radiogroup" className="flex-row flex-wrap" style={{ gap: 6 }}>
      {items.map((k) => {
        const active = value === k;
        return (
          <Pressable key={k} testID={`sm-filter-${k}`} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => onChange(k)}
            className={`flex-row items-center justify-center rounded-full border px-2.5 h-10 ${active ? 'bg-ink border-ink' : 'bg-surface border-line active:bg-surface2'}`} style={{ gap: 5, flexGrow: 1 }}>
            {k === 'all' ? null : <Icon name={AUDIENCE_ICON[k]} size={15} tone={active ? 'onink' : AUDIENCE_TONE[k].fg} />}
            <Txt numberOfLines={1} className={`text-[13px] font-bold ${active ? 'text-onink' : ''}`}>{k === 'all' ? t('sm.all') : t(`sm.aud_${k}`)}</Txt>
            <Txt className={`text-[12px] font-bold ${active ? 'text-onink' : 'text-muted'}`}>{counts[k]}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Wraps one setting. Arriving from the Settings map or the admin search (`?target=set-<id>`) scrolls it into view (web) and
 * outlines it for a few seconds, so the admin sees exactly which control the map meant.
 */
export function SettingAnchor({ id, children }: { id: string; children: React.ReactNode }) {
  const { target, focus } = useLocalSearchParams<{ target?: string; focus?: string }>();
  const { colors } = useTheme();
  const hit = target === `set-${id}`;
  const stamp = `${target ?? ''}:${focus ?? ''}`;
  const [done, setDone] = useState('');
  useEffect(() => {
    if (!hit) return;
    const scroll = Platform.OS === 'web' ? setTimeout(() => { document.querySelector(`[data-testid="anchor-${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350) : undefined;
    const end = setTimeout(() => setDone(stamp), 3500);
    return () => { if (scroll) clearTimeout(scroll); clearTimeout(end); };
  }, [hit, id, stamp]);
  const on = hit && done !== stamp;
  return <View testID={`anchor-${id}`} accessibilityLabel={on ? 'highlighted' : undefined} style={{ borderWidth: 2, borderRadius: 18, margin: -2, borderColor: on ? colors.primary : 'transparent' }}>{children}</View>;
}
