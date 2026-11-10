import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Card2, Chips, Loading, Pill, SuperPage, usePlainDate } from '@/components/super/ui';
import { useT } from '@/i18n';
import { superApi, type AuditEntry, type Tenant } from '@/lib/superApi';

const PAGE = 50;
const GROUPS = ['', 'tenant', 'account', 'role', 'plans', 'config', 'client', 'super'] as const;
const GROUP_LABEL: Record<string, string> = { tenant: 'sx.nav.tenants', account: 'sx.nav.admins', role: 'sx.nav.roles', plans: 'sx.nav.access', config: 'sx.nav.settings', client: 'sx.nav.clients', super: 'sx.title' };
const ICON: Record<string, string> = { tenant: 'domain', account: 'account-key-outline', role: 'shield-account-outline', plans: 'shield-lock-outline', config: 'cog-outline', client: 'account-outline', super: 'shield-crown-outline' };

/** Compact one-line summary of the detail payload (never the raw JSON dump of secrets: the server only stores safe fields). */
const brief = (d: AuditEntry['detail']) => (d ? Object.entries(d).filter(([, v]) => v != null && typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '');

export default function AuditPage() {
  const { t } = useT();
  const fmt = usePlainDate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const seq = useRef(0);

  useEffect(() => { superApi<Tenant[]>('/tenants').then(setTenants).catch(() => undefined); }, []);
  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(id); }, [q]);

  const load = async (reset = true) => {
    const mine = ++seq.current;
    const before = !reset && items?.length ? items[items.length - 1].at : '';
    const qs = `limit=${PAGE}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}${group ? `&action=${group}.` : ''}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}${before ? `&before=${before}` : ''}`;
    try {
      const rows = await superApi<AuditEntry[]>(`/audit?${qs}`);
      if (mine !== seq.current) return;
      setItems((cur) => (reset || !cur ? rows : [...cur, ...rows])); setHasMore(rows.length >= PAGE); setError(null);
    } catch (e) { if (mine === seq.current) setError(e); }
    finally { if (mine === seq.current) setMore(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true); }, [tenantId, group, debounced]);

  const tenantName = (id: string | null) => (id ? tenants.find((x) => x.id === id)?.name || id : '');
  const label = (a: string) => { const k = `sx.act.${a}`; const v = t(k); return v === k ? a : v; };

  return (
    <SuperPage title={t('sx.au.title')} sub={t('sx.au.sub')} right={<Button testID="audit-refresh" size="sm" variant="soft" icon="refresh" title={t('sx.c.refresh')} onPress={() => load(true)} />}>
      <View style={{ marginBottom: 12 }}><Input testID="audit-search" tight placeholder={t('sx.au.search')} value={q} onChangeText={setQ} autoCapitalize="none" /></View>
      <View style={{ marginBottom: 10 }}>
        <Chips testID="audit-group" options={GROUPS.map((g) => ({ key: g, label: g ? t(GROUP_LABEL[g]) : t('sx.au.all') }))} value={group} onChange={setGroup} />
      </View>
      {tenants.length > 1 ? <View style={{ marginBottom: 14 }}><Chips testID="audit-tenant" options={[{ key: '', label: t('sx.ad.allTenants') }, ...tenants.map((x) => ({ key: x.id, label: x.name }))]} value={tenantId} onChange={setTenantId} /></View> : null}

      {!items ? <Loading error={error} onRetry={() => load(true)} /> : items.length === 0 ? <EmptyState icon="history" title={t('sx.au.empty')} /> : (
        <View style={{ gap: 8 }}>
          {items.map((e) => (
            <Card2 key={e.id} testID={`audit-row-${e.id}`}>
              <View className="flex-row items-start" style={{ gap: 12 }}>
                <View className="w-9 h-9 rounded-xl bg-soft items-center justify-center"><Icon name={ICON[e.action.split('.')[0]] || 'history'} size={18} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                    <Txt className="font-extrabold text-[14px]">{label(e.action)}</Txt>
                    {e.tenantId ? <Pill label={tenantName(e.tenantId)} tone="primary" /> : null}
                  </View>
                  <Txt numberOfLines={2} className="text-muted text-[12px] mt-0.5">{t('sx.au.actor')}: {e.actor}{e.targetId ? ` · ${t('sx.au.target')}: ${e.targetType}/${e.targetId.slice(0, 18)}` : ''}</Txt>
                  {brief(e.detail) ? <Txt numberOfLines={2} className="text-muted text-[11px] mt-0.5">{brief(e.detail)}</Txt> : null}
                </View>
                <Txt className="text-muted text-[11px] font-semibold" style={{ maxWidth: 110, textAlign: 'right' }}>{fmt.dateTime(e.at)}</Txt>
              </View>
            </Card2>
          ))}
          {hasMore ? <Button testID="audit-more" variant="soft" title={t('sx.c.more')} loading={more} onPress={() => { setMore(true); void load(false); }} full /> : null}
        </View>
      )}
    </SuperPage>
  );
}
