import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Href } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Kpi, Panel, Reveal, Seg, IconBtn } from '@/components/admin/dashboard/Kit';
import { AreaChart, Donut } from '@/components/admin/dashboard/Viz';
import { RankBars } from '@/components/admin/dashboard/Charts';
import { Loading, Pill, SuperPage, useFail, useLoad, usePlainDate } from '@/components/super/ui';
import { useRouter } from '@/hooks/useLeaveGuard';
import { useT } from '@/i18n';
import { superApi, type Insight, type Overview } from '@/lib/superApi';
import { useTheme } from '@/theme/ThemeProvider';

const pct = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));

export default function SuperDashboard() {
  const { t } = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const fail = useFail();
  const fmt = usePlainDate();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, error, reload, loading } = useLoad(() => superApi<Overview>(`/overview?days=${days}`), [days]);
  const go = (href: string) => router.push(href as Href);

  const insightText = (i: Insight) => t(`sx.ins.${i.code}`, { name: i.tenantName || '', value: i.value, limit: i.limit, n: i.value });

  if (!data) return <SuperPage title={t('sx.dash.title')}><Loading error={error} onRetry={reload} /></SuperPage>;
  const { totals, period, series, labels } = data;
  const palette = [colors.primary, colors.ink, colors.muted, colors.line, colors.soft];
  const status = data.requestStatus;

  return (
    <SuperPage title={t('sx.dash.title')} sub={t('sx.dash.sub', { days })}
      right={<>
        <Seg testID="super-range" small options={[{ key: 7, label: t('sx.dash.days', { n: 7 }) }, { key: 30, label: t('sx.dash.days', { n: 30 }) }, { key: 90, label: t('sx.dash.days', { n: 90 }) }]} value={days} onChange={(d) => setDays(d as 7 | 30 | 90)} />
        <IconBtn testID="super-refresh" icon="refresh" label={t('sx.c.refresh')} busy={loading} onPress={() => { reload().catch(fail); }} />
      </>}>
      <View className="flex-row flex-wrap" style={{ gap: 12 }}>
        <Reveal i={0} style={{ flexGrow: 1, flexBasis: 220, minWidth: 0 }}><Kpi id="tenants" icon="domain" label={t('sx.dash.tenants')} value={totals.tenants} spark={series.tenants} sub={t('sx.dash.tenantsSub', { n: totals.activeTenants, m: totals.suspendedTenants })} onPress={() => go('/super/tenants')} /></Reveal>
        <Reveal i={1} style={{ flexGrow: 1, flexBasis: 220, minWidth: 0 }}><Kpi id="accounts" icon="account-key-outline" label={t('sx.dash.accounts')} value={totals.accounts} sub={t('sx.dash.accountsSub', { n: totals.activeAccounts })} onPress={() => go('/super/admins')} /></Reveal>
        <Reveal i={2} style={{ flexGrow: 1, flexBasis: 220, minWidth: 0 }}><Kpi id="clients" icon="account-group-outline" label={t('sx.dash.clients')} value={totals.clients} delta={pct(period.clients, period.prevClients)} spark={series.clients} sub={t('sx.dash.clientsSub', { n: totals.blockedClients })} onPress={() => go('/super/clients')} /></Reveal>
        <Reveal i={3} style={{ flexGrow: 1, flexBasis: 220, minWidth: 0 }}><Kpi id="requests" icon="inbox-full-outline" label={t('sx.dash.requests')} value={totals.requests} delta={pct(period.requests, period.prevRequests)} spark={series.requests} sub={t('sx.dash.requestsSub', { n: status.pending })} onPress={() => go('/super/tenants')} /></Reveal>
        <Reveal i={4} style={{ flexGrow: 1, flexBasis: 220, minWidth: 0 }}><Kpi id="mrr" hot icon="cash-multiple" label={t('sx.dash.mrr')} value={totals.mrr} suffix="$" sub={t('sx.dash.mrrSub')} onPress={() => go('/super/access')} /></Reveal>
      </View>

      <View className="flex-row flex-wrap" style={{ gap: 12, marginTop: 12 }}>
        <Reveal i={5} style={{ flexGrow: 3, flexBasis: 420, minWidth: 0 }}>
          <Panel testID="super-growth" title={t('sx.dash.chart')} sub={t('sx.dash.chartSub')}>
            <AreaChart values={series.clients} prev={series.requests} labels={labels} height={220}
              tip={(i) => ({ title: fmt.date(labels[i]), value: `${t('sx.dash.sClients')}: ${fmt.num(series.clients[i] ?? 0)}`, prev: `${t('sx.dash.sRequests')}: ${fmt.num(series.requests[i] ?? 0)}`, prevTitle: '' })} />
            <View className="flex-row flex-wrap mt-2" style={{ gap: 14 }}>
              <View className="flex-row items-center" style={{ gap: 6 }}><View className="w-2.5 h-2.5 rounded-full bg-primary" /><Txt className="text-muted text-[12px]">{t('sx.dash.sClients')}</Txt></View>
              <View className="flex-row items-center" style={{ gap: 6 }}><View className="w-2.5 h-2.5 rounded-full bg-muted" /><Txt className="text-muted text-[12px]">{t('sx.dash.sRequests')}</Txt></View>
            </View>
          </Panel>
        </Reveal>
        <Reveal i={6} style={{ flexGrow: 1, flexBasis: 280, minWidth: 0 }}>
          <Panel testID="super-plans" title={t('sx.dash.plans')} fill>
            <View className="flex-row items-center" style={{ gap: 16 }}>
              <Donut values={data.planMix.map((p) => p.tenants)} colors={palette} size={116} thickness={14} center={<Txt className="font-black text-[22px]">{totals.tenants}</Txt>} />
              <View style={{ flex: 1, gap: 8, minWidth: 0 }}>
                {data.planMix.map((p, i) => (
                  <View key={p.id} className="flex-row items-center" style={{ gap: 8 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: palette[i % palette.length] }} />
                    <Txt numberOfLines={1} className="text-[13px] font-semibold flex-1">{p.name}</Txt>
                    <Txt className="text-[13px] font-extrabold">{p.tenants}</Txt>
                  </View>
                ))}
              </View>
            </View>
            <View style={{ height: 1 }} className="bg-line my-4" />
            <Txt className="font-extrabold text-[13px] mb-2">{t('sx.dash.pipeline')}</Txt>
            <View style={{ gap: 6 }}>
              {([['pending', status.pending, 'bg-danger'], ['processing', status.processing, 'bg-primary'], ['delivered', status.delivered, 'bg-success']] as const).map(([k, n, tone]) => (
                <View key={k} className="flex-row items-center" style={{ gap: 8 }}>
                  <View className={`w-2.5 h-2.5 rounded-full ${tone}`} /><Txt className="flex-1 text-[13px] text-muted">{t(`sx.dash.${k}`)}</Txt><Txt className="font-extrabold text-[13px]">{fmt.num(n)}</Txt>
                </View>
              ))}
            </View>
          </Panel>
        </Reveal>
      </View>

      <View className="flex-row flex-wrap" style={{ gap: 12, marginTop: 12 }}>
        <Reveal i={7} style={{ flexGrow: 1, flexBasis: 360, minWidth: 0 }}>
          <Panel testID="super-top" title={t('sx.dash.top')} sub={t('sx.dash.topSub')}>
            {data.topTenants.length ? <RankBars rows={data.topTenants.map((x) => ({ id: x.id, label: x.name, count: x.designs }))} unit={(n) => t('sx.dash.designs', { n })} /> : <Txt className="text-muted text-[13px]">{t('sx.tn.empty')}</Txt>}
          </Panel>
        </Reveal>
        <Reveal i={8} style={{ flexGrow: 1, flexBasis: 360, minWidth: 0 }}>
          <Panel testID="super-insights" title={t('sx.dash.insights')}>
            {data.insights.length ? (
              <View style={{ gap: 8 }}>
                {data.insights.map((i, n) => (
                  <Pressable key={`${i.code}-${i.tenantId ?? n}`} accessibilityRole="button" onPress={() => go(i.code === 'maintenance_on' || i.code === 'signup_closed' ? '/super/settings' : i.code === 'never_logged_in' || i.code === 'no_admin' ? '/super/admins' : '/super/tenants')}
                    className="flex-row items-center rounded-2xl bg-surface2 active:opacity-80" style={{ gap: 10, padding: 10 }}>
                    <Icon name={i.kind === 'danger' ? 'alert-octagon-outline' : i.kind === 'warning' ? 'alert-outline' : 'information-outline'} size={19} tone={i.kind === 'danger' ? 'danger' : i.kind === 'warning' ? 'fg' : 'muted'} />
                    <Txt className="flex-1 text-[13px] font-semibold">{insightText(i)}</Txt>
                    <Pill label={i.kind === 'danger' ? '!' : i.kind === 'warning' ? '•' : 'i'} tone={i.kind === 'danger' ? 'danger' : i.kind === 'warning' ? 'warning' : 'muted'} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <View className="flex-row items-center" style={{ gap: 10 }}><Icon name="check-circle-outline" size={20} tone="success" /><Txt className="text-[13px] text-muted flex-1">{t('sx.dash.insightsOk')}</Txt></View>
            )}
          </Panel>
        </Reveal>
      </View>
    </SuperPage>
  );
}
