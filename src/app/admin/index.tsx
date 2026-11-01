import { PushNotifications } from '@/components/admin/PushNotifications';
import { useViewState } from '@/hooks/useViewState';
import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Href } from 'expo-router';
import { useRouter } from '@/hooks/useLeaveGuard';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { BarChart, RankBars } from '@/components/admin/dashboard/Charts';
import { useBp } from '@/hooks/useBp';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { ago, kpis, recentEvents, series, topUsage, type EventKind, type Metric, type Range } from '@/lib/stats';

const RANGES: Range[] = [7, 30, 90];
const EV_ICON: Record<EventKind, { icon: string; tone: string }> = {
  request: { icon: 'inbox-arrow-down-outline', tone: 'bg-danger' },
  delivered: { icon: 'check-circle-outline', tone: 'bg-success' },
  design: { icon: 'image-auto-adjust', tone: 'bg-primary' },
  user: { icon: 'account-plus-outline', tone: 'bg-ink' },
};

function Delta({ v }: { v: number }) {
  const up = v >= 0;
  return (
    <View className="flex-row items-center gap-0.5">
      <Icon name={up ? 'trending-up' : 'trending-down'} size={14} tone={up ? 'success' : 'danger'} />
      <Txt className={`text-[12px] font-bold ${up ? 'text-success' : 'text-danger'}`}>{up ? '+' : ''}{v}%</Txt>
    </View>
  );
}

function Kpi({ id, icon, label, value, delta, sub, active, onPress }: { id: string; icon: string; label: string; value: number; delta?: number; sub?: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable testID={`kpi-${id}`} onPress={onPress} className={`rounded-2xl border p-4 ${active ? 'border-ink bg-surface' : 'border-line bg-surface'}`} style={{ flexGrow: 1, flexBasis: 150 }}>
      <View className="flex-row items-center justify-between mb-2">
        <View className="w-9 h-9 rounded-xl bg-soft items-center justify-center"><Icon name={icon} size={19} /></View>
        {delta !== undefined ? <Delta v={delta} /> : null}
      </View>
      <Txt className="text-[30px] font-black leading-[34px]">{value}</Txt>
      <Txt numberOfLines={1} className="text-muted text-[13px] font-semibold">{label}</Txt>
      {sub ? <Txt className="text-muted text-[11px] mt-0.5">{sub}</Txt> : null}
    </Pressable>
  );
}

const Section = ({ title, right, children, className = '' }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) => (
    <Card className={`p-4 ${className}`}>
      <View className="flex-row items-center justify-between mb-3 gap-2"><Txt className="font-extrabold text-[16px] flex-1">{title}</Txt>{right}</View>
      {children}
    </Card>
  );

export default function Dashboard() {
  const { t, lang } = useT();
  const L = useL();
  const { desktop, tablet, width } = useBp();
  const compact = width < 600;
  const router = useRouter();
  const s = useStore();
  const [range, setRange] = useViewState<Range>('range', 30);
  const [metric, setMetric] = useViewState<Metric>('metric', 'designs');
  const go = (h: string) => router.push(h as Href);

  const inp = useMemo(() => ({ requests: s.requests, history: s.history, users: s.users }), [s.requests, s.history, s.users]);
  const k = useMemo(() => kpis(inp, range), [inp, range]);
  const data = useMemo(() => series(inp, range), [inp, range]);
  const total = data.reduce((a, b) => a + b[metric], 0);
  const peak = Math.max(0, ...data.map((b) => b[metric]));
  const events = useMemo(() => recentEvents(inp, 8), [inp]);

  const rank = (pick: (d: any) => string | undefined, list: { id: string; title: any }[]) =>
    topUsage(inp, range, pick).map((r) => ({ id: r.id, count: r.count, label: L(list.find((x) => x.id === r.id)?.title) || r.id }));
  const tops = useMemo(() => ({
    tools: rank((d) => d.toolId, s.tools), styles: rank((d) => d.styleId, s.styles), rooms: rank((d) => d.roomTypeId, s.roomTypes),
    models: topUsage(inp, range, (d) => d.modelId).map((r) => ({ id: r.id, count: r.count, label: s.models.find((m) => m.id === r.id)?.name ?? r.id })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [inp, range, s.tools, s.styles, s.roomTypes, s.models, lang]);
  const [topTab, setTopTab] = useViewState<'tools' | 'styles' | 'rooms' | 'models'>('topTab', 'tools');
  const best = tops.tools[0];

  const dayLabel = (b: { start: number }) => new Date(b.start).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short' });
  const evText = (e: ReturnType<typeof recentEvents>[number]) => {
    const name = e.name || t('admin.dash.anonymous');
    const tool = L(s.tools.find((x) => x.id === e.toolId)?.title);
    return e.kind === 'request' ? t('admin.dash.evRequest', { name }) : e.kind === 'delivered' ? t('admin.dash.evDelivered', { name }) : e.kind === 'design' ? t('admin.dash.evDesign', { tool }) : t('admin.dash.evUser', { name });
  };
  const agoText = (at: number) => { const a = ago(at); return a.key === 'now' ? t('admin.dash.now') : t(`admin.dash.${a.key}`, { n: a.n }); };

  const pill = (on: boolean) => `px-3.5 h-9 rounded-full items-center justify-center ${on ? 'bg-ink' : 'bg-surface2'}`;
  const metricLabel = (m: Metric) => t(`admin.dash.m${m[0].toUpperCase()}${m.slice(1)}`);

  if (!s.adminLoaded) return <AdminPage title={t('admin.dash.hello')} max={1200}><AdminLoading /></AdminPage>;
  return (
    <AdminPage title={t('admin.dash.hello')} max={1200}>
      <Txt className="text-muted text-[14px] -mt-3 mb-4">{t('admin.dash.subtitle')}</Txt>

      <PushNotifications />
      {/* Attention banner */}
      {k.pending > 0 ? (
        // Narrow screens: the call to action moves under the text instead of squeezing it into a thin column.
        <Pressable testID="dash-attention" onPress={() => go('/admin/requests')} className="rounded-2xl p-4 mb-4 bg-primary" style={{ flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: 12 }}>
          <View className="flex-row items-center gap-3" style={{ flex: compact ? undefined : 1, minWidth: 0 }}>
            <View className="w-10 h-10 rounded-full bg-ink items-center justify-center" style={{ flexShrink: 0 }}><Icon name="bell-ring-outline" size={20} tone="onink" /></View>
            <View style={{ flex: 1, minWidth: 0 }}><Txt className="text-onprimary font-extrabold text-[15px] leading-[21px]">{t('admin.dash.attention', { count: k.pending })}</Txt><Txt className="text-onprimary text-[12px] leading-[18px] opacity-80">{t('admin.dash.attentionSub')}</Txt></View>
          </View>
          <View testID="dash-attention-cta" className={compact ? 'flex-row items-center justify-center gap-1 rounded-full bg-ink h-10 px-4' : 'flex-row items-center gap-1'} style={{ flexShrink: 0 }}>
            <Txt className={`font-bold text-[13px] ${compact ? 'text-onink' : 'text-onprimary'}`}>{t('admin.dash.attentionCta')}</Txt><Icon name="chevron-right" size={18} tone={compact ? 'onink' : 'onprimary'} flip />
          </View>
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-3 rounded-2xl p-4 mb-4 bg-soft" testID="dash-allclear">
          <Icon name="check-decagram-outline" size={24} tone="success" />
          <View className="flex-1"><Txt className="font-extrabold text-[15px]">{t('admin.dash.allClear')}</Txt><Txt className="text-muted text-[12px]">{t('admin.dash.allClearSub')}</Txt></View>
        </View>
      )}

      {/* Range */}
      <View className="flex-row items-center justify-between mb-3 gap-2">
        <Txt className="text-muted text-[12px] flex-1">{t('admin.dash.vsPrev')}</Txt>
        <View className="flex-row gap-2">{RANGES.map((r) => <Pressable key={r} testID={`range-${r}`} onPress={() => setRange(r)} className={pill(range === r)}><Txt className={`text-[13px] font-semibold ${range === r ? 'text-onink' : ''}`}>{t(`admin.dash.r${r}`)}</Txt></Pressable>)}</View>
      </View>

      {/* KPIs */}
      <View className="flex-row flex-wrap mb-4" style={{ gap: 12 }}>
        <Kpi id="designs" icon="image-auto-adjust" label={t('admin.dash.kDesigns')} value={k.designs.cur} delta={k.designs.delta} active={metric === 'designs'} onPress={() => setMetric('designs')} />
        <Kpi id="requests" icon="inbox-full-outline" label={t('admin.dash.kRequests')} value={k.requests.cur} delta={k.requests.delta} active={metric === 'requests'} onPress={() => setMetric('requests')} />
        <Kpi id="users" icon="account-plus-outline" label={t('admin.dash.kUsers')} value={k.users.cur} delta={k.users.delta} active={metric === 'users'} onPress={() => setMetric('users')} />
        <Kpi id="pending" icon="clock-outline" label={t('admin.dash.kPending')} value={k.pending} onPress={() => go('/admin/requests')} />
      </View>

      <View className={desktop ? 'flex-row gap-4 items-start' : ''} style={{ gap: desktop ? 16 : 16 }}>
        <View style={{ flex: desktop ? 1.6 : undefined, width: desktop ? undefined : '100%', gap: 16, minWidth: 0 }}>
          <Section title={`${t('admin.dash.chartTitle')} · ${metricLabel(metric)}`}
            right={<View className="items-end"><Txt className="text-[12px] text-muted">{t('admin.dash.total')} <Txt className="font-extrabold text-fg">{total}</Txt>  ·  {t('admin.dash.peak')} <Txt className="font-extrabold text-fg">{peak}</Txt></Txt></View>}>
            {total === 0 ? <Txt className="text-muted text-[13px] py-10 text-center">{t('admin.dash.noData')}</Txt> : <BarChart data={data} metric={metric} label={dayLabel} />}
          </Section>

          <Section title={t('admin.dash.topTitle')}>
            {best ? (
              <View className="flex-row items-center gap-3 bg-soft rounded-xl p-3 mb-4" testID="dash-best">
                <View className="w-10 h-10 rounded-full bg-primary items-center justify-center"><Icon name="trophy-outline" size={20} tone="onprimary" /></View>
                <View className="flex-1"><Txt className="text-muted text-[11px] font-bold uppercase">{t('admin.dash.best')}</Txt><Txt numberOfLines={1} className="font-extrabold text-[16px]">{best.label}</Txt></View>
                <Txt className="text-muted text-[12px]">{t('admin.dash.uses', { count: best.count })}</Txt>
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-2 mb-4">
              {(['tools', 'styles', 'rooms', 'models'] as const).map((x) => (
                <Pressable key={x} testID={`top-${x}`} onPress={() => setTopTab(x)} className={pill(topTab === x)}><Txt className={`text-[13px] font-semibold ${topTab === x ? 'text-onink' : ''}`}>{t(`admin.dash.top${x[0].toUpperCase()}${x.slice(1)}`)}</Txt></Pressable>
              ))}
            </View>
            {tops[topTab].length ? <RankBars rows={tops[topTab]} unit={(n) => t('admin.dash.uses', { count: n })} /> : <Txt className="text-muted text-[13px] py-4 text-center">{t('admin.dash.noUsage')}</Txt>}
          </Section>
        </View>

        <View style={{ flex: desktop ? 1 : undefined, width: desktop ? undefined : '100%', gap: 16, minWidth: 0 }}>
          <Section title={t('admin.dash.recentTitle')} right={<Pressable onPress={() => go('/admin/requests')}><Txt className="text-[12px] font-bold underline">{t('admin.dash.viewAll')}</Txt></Pressable>}>
            <View testID="dash-recent" style={{ gap: 4 }}>
              {events.map((e) => (
                <Pressable key={e.id} onPress={() => go(e.href)} className="flex-row items-center gap-3 py-2">
                  <View className={`w-9 h-9 rounded-full items-center justify-center ${EV_ICON[e.kind].tone}`}><Icon name={EV_ICON[e.kind].icon} size={18} color="#fff" /></View>
                  <View className="flex-1"><Txt numberOfLines={2} className="text-[13px] font-semibold">{evText(e)}</Txt><Txt className="text-muted text-[11px]">{agoText(e.at)}</Txt></View>
                </Pressable>
              ))}
            </View>
          </Section>

          <Section title={t('admin.dash.quickTitle')}>
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {[
                { k: 'qAddTool', icon: 'plus-circle-outline', href: '/admin/tools' },
                { k: 'qRequests', icon: 'inbox-full-outline', href: '/admin/requests' },
                { k: 'qTheme', icon: 'palette-outline', href: '/admin/theme' },
                { k: 'qApp', icon: 'open-in-new', href: '/' },
              ].map((a) => (
                <Pressable key={a.k} testID={`quick-${a.k}`} onPress={() => (a.href === '/' ? router.push('/') : go(a.href))} className="flex-row items-center gap-2 bg-surface2 rounded-xl px-3 h-11" style={{ flexGrow: 1, flexBasis: tablet ? 150 : 140 }}>
                  <Icon name={a.icon} size={18} /><Txt numberOfLines={1} className="font-semibold text-[13px] flex-1">{t(`admin.dash.${a.k}`)}</Txt>
                </Pressable>
              ))}
            </View>
          </Section>
        </View>
      </View>
    </AdminPage>
  );
}
