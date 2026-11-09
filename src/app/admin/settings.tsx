import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Href } from 'expo-router';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { AudienceBadge, AudienceFilter, AudienceSection } from '@/components/admin/AudienceBadge';
import { useT } from '@/i18n';
import { useRouter } from '@/hooks/useLeaveGuard';
import { ADMIN_NAV } from '@/lib/adminNav';
import { SETTINGS_MAP, filterSettings, matchesAudience, sectionOf, stateOf, type Audience, type SettingEntry } from '@/lib/settingsMap';
import { useStore } from '@/store/useStore';

/** Name of the screen an entry lives on, in the current language ("Interface & menus", "Crédits"...). */
function useWhere() {
  const { t } = useT();
  return (href: string) => {
    if (href === '/settings') return t('sm.userPage');
    const nav = ADMIN_NAV.find((n) => n.href === href);
    return nav ? t(`admin.nav.${nav.key}`) : href;
  };
}

function Row({ e, state, where, last, onOpen }: { e: SettingEntry; state?: 'on' | 'off'; where: string; last: boolean; onOpen: () => void }) {
  const { t } = useT();
  return (
    <Pressable testID={`sm-row-${e.id}`} accessibilityRole="link" accessibilityLabel={`${t(`sm.${e.id}`)}. ${t('sm.where', { page: where })}`} onPress={onOpen}
      className={`flex-row items-center px-3.5 py-3 active:bg-surface2 ${last ? '' : 'border-b border-line'}`} style={{ gap: 12 }}>
      <View className="w-10 h-10 rounded-full bg-soft items-center justify-center"><Icon name={e.icon} size={20} tone="primary" /></View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-start" style={{ gap: 8 }}>
          <Txt className="font-bold text-[15px] flex-1">{t(`sm.${e.id}`)}</Txt>
          {state ? (
            <View testID={`sm-state-${e.id}`} className="flex-row items-center" style={{ gap: 5, height: 22 }}>
              <View className={`w-2 h-2 rounded-full ${state === 'on' ? 'bg-success' : 'bg-muted'}`} />
              <Txt className="text-[11px] font-bold">{t(`sm.${state}`)}</Txt>
            </View>
          ) : null}
        </View>
        <Txt className="text-muted text-[12.5px] leading-[18px]">{t(`sm.${e.id}_d`)}</Txt>
        <View className="flex-row flex-wrap items-center mt-1.5" style={{ gap: 6 }}>
          <AudienceBadge audience={e.audience} testID={`sm-aud-${e.id}`} />
          <View className="flex-row items-center rounded-full bg-surface2 px-2.5" style={{ height: 24, gap: 5, maxWidth: '100%' }}>
            <Icon name="map-marker-path" size={13} tone="muted" />
            <Txt numberOfLines={1} className="text-[11px] font-bold text-muted" style={{ flexShrink: 1 }}>{where}</Txt>
          </View>
        </View>
      </View>
      <Icon name="chevron-right" size={20} tone="muted" flip />
    </Pressable>
  );
}

/** Admin > Settings map: every setting of the product, who it affects, where it is edited and whether it is on. */
export default function SettingsMap() {
  const { t } = useT();
  const router = useRouter();
  const where = useWhere();
  const contentReady = useStore((s) => s.contentReady);
  const settings = useStore((s) => s.doc.settings) as unknown as Record<string, unknown>;
  const [filter, setFilter] = useState<Audience | 'all'>('all');
  const [query, setQuery] = useState('');
  const text = (e: SettingEntry) => `${t(`sm.${e.id}`)} ${t(`sm.${e.id}_d`)} ${where(e.href)} ${t(`sm.aud_${e.audience}`)}`;
  const counts = useMemo(() => ({
    all: SETTINGS_MAP.length,
    clients: SETTINGS_MAP.filter((e) => matchesAudience(e, 'clients')).length,
    admins: SETTINGS_MAP.filter((e) => matchesAudience(e, 'admins')).length,
    both: SETTINGS_MAP.filter((e) => e.audience === 'both').length,
    personal: SETTINGS_MAP.filter((e) => e.audience === 'personal').length,
  }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => filterSettings(filter, query, text), [filter, query, t]);
  const open = (e: SettingEntry) => router.push((e.href === '/settings' ? e.href : `${e.href}?target=set-${e.id}`) as Href);
  if (!contentReady) return <AdminPage title={t('sm.title')}><AdminLoading /></AdminPage>;
  const groups: ('clients' | 'admins' | 'personal')[] = ['clients', 'admins', 'personal'];
  return (
    <AdminPage title={t('sm.title')} max={900}>
      <Txt className="text-muted text-[13px] leading-[20px] mb-3">{t('sm.intro')}</Txt>
      <Input testID="sm-search" value={query} onChangeText={setQuery} placeholder={t('sm.search')} accessibilityLabel={t('sm.search')} />
      <View className="mt-3 mb-1"><AudienceFilter value={filter} onChange={setFilter} counts={counts} /></View>
      {filter !== 'all' ? <Txt testID="sm-filter-desc" className="text-muted text-[12.5px] mt-2">{t(`sm.aud_${filter}_d`)}</Txt> : null}
      {!shown.length ? <Txt testID="sm-none" className="text-muted text-center py-10">{t('sm.none')}</Txt> : null}
      {groups.map((g) => {
        const rows = shown.filter((e) => sectionOf(e.audience) === g);
        if (!rows.length) return null;
        return (
          <AudienceSection key={g} testID={`sm-group-${g}`} audience={g} title={t(`sm.grp_${g}`)} desc={t(`sm.aud_${g}_d`)}>
            <Card className="overflow-hidden">
              {rows.map((e, i) => <Row key={e.id} e={e} state={stateOf(e.id, settings)} where={where(e.href)} last={i === rows.length - 1} onOpen={() => open(e)} />)}
            </Card>
          </AudienceSection>
        );
      })}
    </AdminPage>
  );
}
