import { useViewState } from '@/hooks/useViewState';
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Href } from 'expo-router';
import { useRouter } from '@/hooks/useLeaveGuard';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { RankBars } from '@/components/admin/dashboard/Charts';
import { QuickActions } from '@/components/admin/dashboard/QuickActions';
import { QuickView, type QV } from '@/components/admin/dashboard/QuickView';
import { EV_ICON, useDashFormat } from '@/components/admin/dashboard/format';
import { Delta, IconBtn, Initials, Kpi, Panel, Reveal, Seg } from '@/components/admin/dashboard/Kit';
import { AreaChart, Donut, Heatmap, Ring, StackBar } from '@/components/admin/dashboard/Viz';
import { useBp } from '@/hooks/useBp';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';
import { toast } from '@/store/useToast';
import { canExport, download } from '@/lib/brand/export';
import { audience, aiHealth, daypart, heatmap, insights, overview, pipeline, sourceMix, type Insight } from '@/lib/analytics';
import { recentEvents, topUsage, type Ev, type Metric, type Range } from '@/lib/stats';
import { AUD_KINDS } from '@/lib/dashDetail';

const RANGES: Range[] = [7, 30, 90];
const LEVEL: Record<Insight['level'], { icon: string; tone: string }> = {
  warn: { icon: 'alert-outline', tone: 'bg-danger/15' },
  good: { icon: 'trending-up', tone: 'bg-success/15' },
  info: { icon: 'lightbulb-on-outline', tone: 'bg-soft' },
};
const BLOCKS = [0, 1, 2, 3, 4, 5];

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

export default function Dashboard() {
  const { t, lang } = useT();
  const L = useL();
  const { colors } = useTheme();
  const { desktop, width } = useBp();
  const compact = width < 600;
  const router = useRouter();
  const s = useStore();
  const appName = s.doc.branding.appName || '';
  const [range, setRange] = useViewState<Range>('range', 30);
  const [metric, setMetric] = useViewState<Metric>('metric', 'designs');
  const [topTab, setTopTab] = useViewState<'tools' | 'styles' | 'rooms' | 'models'>('topTab', 'tools');
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState(true);
  const go = (h: string) => router.push(h as Href);
  const f = useDashFormat();
  const [qv, setQv] = useState<QV[]>([]);
  const openQv = (v: QV) => setQv([v]);
  const pushQv = (v: QV) => setQv((old) => [...old, v]);
  const backQv = () => setQv((old) => old.slice(0, -1));
  const closeQv = () => setQv([]);

  const inp = useMemo(() => ({ requests: s.requests, history: s.history, users: s.users }), [s.requests, s.history, s.users]);
  const [hour] = useState(() => new Date().getHours());
  // Recomputed when the data or the period changes.
  const o = useMemo(() => overview(inp, range), [inp, range]);
  const pipe = useMemo(() => pipeline(inp, range), [inp, range]);
  const heat = useMemo(() => heatmap(inp, range), [inp, range]);
  const aud = useMemo(() => audience(inp, range), [inp, range]);
  const ai = useMemo(() => aiHealth(inp, range), [inp, range]);
  const mix = useMemo(() => sourceMix(inp, range), [inp, range]);
  const tips = useMemo(() => insights(inp, range), [inp, range]);
  const events = useMemo(() => recentEvents(inp, 7), [inp]);

  const rank = (pick: (d: any) => string | undefined, list: { id: string; title: any }[]) =>
    topUsage(inp, range, pick).map((r) => ({ id: r.id, count: r.count, label: L(list.find((x) => x.id === r.id)?.title) || r.id }));
  const tops = useMemo(() => ({
    tools: rank((d) => d.toolId, s.tools), styles: rank((d) => d.styleId, s.styles), rooms: rank((d) => d.roomTypeId, s.roomTypes),
    models: topUsage(inp, range, (d) => d.modelId).map((r) => ({ id: r.id, count: r.count, label: s.models.find((m) => m.id === r.id)?.name ?? r.id })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [inp, range, s.tools, s.styles, s.roomTypes, s.models, lang]);
  const best = tops.tools[0];

  const { dayLabel, evText, agoText, waitText, insightText } = f;
  const metricLabel = (m: Metric) => t(`admin.dash.m${m[0].toUpperCase()}${m.slice(1)}`);

  const refresh = async () => {
    setBusy(true);
    try { await s.loadAdminData(); toast(t('dx.refreshed')); } finally { setBusy(false); }
  };
  const exportCsv = () => {
    if (!canExport) { toast(t('dx.reportWebOnly')); return; }
    const rows = [['date', 'designs', 'requests', 'new_users'], ...o.buckets.map((b) => [new Date(b.start).toISOString().slice(0, 10), b.designs, b.requests, b.users])];
    rows.push([], ['pending', pipe.pending], ['processing', pipe.processing], ['delivered', pipe.delivered], ['delivery_rate_pct', pipe.deliveryRate], ['ai_success_pct', ai.successRate]);
    download(new Blob([`\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' }), `${(appName || 'dashboard').toLowerCase().replace(/\W+/g, '-')}-${range}d.csv`);
    toast(t('dx.reportDone'));
  };

  const title = t('admin.dash.hello');
  if (!s.adminLoaded) return <AdminPage title={title} max={1280}><AdminLoading /></AdminPage>;

  const trend = o[metric];
  const total = trend.cur;
  const peak = Math.max(0, ...trend.spark);
  const dayNames = [0, 1, 2, 3, 4, 5, 6].map((d) => t(`dx.d${d}`));
  const colLabels = BLOCKS.map((b) => `${b * 4}h`);
  const pending = o.pending;

  // Two columns of EQUAL height: the last panel of each column grows (`fill`), so no row ever leaves a hole beside a taller neighbour.
  const cols = (a: React.ReactNode, b: React.ReactNode, ratio = 1.6) => (
    <View style={{ flexDirection: desktop ? 'row' : 'column', gap: 16, alignItems: desktop ? 'stretch' : 'flex-start' }}>
      <View style={{ flex: desktop ? ratio : undefined, width: desktop ? undefined : '100%', gap: 16, minWidth: 0 }}>{a}</View>
      <View style={{ flex: desktop ? 1 : undefined, width: desktop ? undefined : '100%', gap: 16, minWidth: 0 }}>{b}</View>
    </View>
  );
  const evOpen = (e: Ev) => {
    if (e.kind === 'request' || e.kind === 'delivered') openQv({ kind: 'request', id: e.refId! });
    else if (e.kind === 'design') openQv({ kind: 'design', id: e.refId! });
    else openQv({ kind: 'client', id: e.refId! });
  };

  return (
    <AdminPage title={title} max={1280}>
      <View style={{ gap: 16 }}>
        {/* Hero: greeting + the one thing that needs attention */}
        <Reveal i={0}>
          {pending > 0 ? (
            <Pressable testID="dash-attention" accessibilityRole="button" onPress={() => go('/admin/requests')} className="rounded-[28px] bg-ink overflow-hidden"
              style={{ padding: compact ? 18 : 24, boxShadow: '0 18px 40px -18px rgba(16,24,40,0.45)' } as any}>
              <View style={{ position: 'absolute', end: -40, top: -50, width: 220, height: 220, borderRadius: 110, backgroundColor: colors.primary, opacity: 0.22 }} />
              <View style={{ position: 'absolute', end: 60, bottom: -90, width: 180, height: 180, borderRadius: 90, backgroundColor: colors.primary, opacity: 0.12 }} />
              <Txt className="text-onink text-[12px] font-bold opacity-70 mb-1">{t(`dx.greet.${daypart(hour)}`)} · {t('dx.welcomeSub', { app: appName, days: range })}</Txt>
              <View style={{ flexDirection: compact ? 'column' : 'row', alignItems: compact ? 'stretch' : 'center', gap: 14 }}>
                <View className="flex-row items-center gap-3" style={{ flex: compact ? undefined : 1, minWidth: 0 }}>
                  <View className="w-12 h-12 rounded-2xl bg-primary items-center justify-center" style={{ flexShrink: 0 }}><Icon name="bell-ring-outline" size={24} tone="onprimary" /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt className="text-onink font-black text-[19px] leading-[26px]" style={{ letterSpacing: -0.3 }}>{t('admin.dash.attention', { count: pending })}</Txt>
                    <Txt className="text-onink text-[12px] leading-[18px] opacity-70">{t('admin.dash.attentionSub')}</Txt>
                  </View>
                </View>
                <View testID="dash-attention-cta" className="flex-row items-center justify-center gap-1 rounded-full bg-primary h-11 px-5" style={{ flexShrink: 0 }}>
                  <Txt className="font-extrabold text-[13px] text-onprimary">{t('admin.dash.attentionCta')}</Txt><Icon name="chevron-right" size={18} tone="onprimary" flip />
                </View>
              </View>
            </Pressable>
          ) : (
            <View testID="dash-allclear" className="rounded-[28px] bg-soft border border-line overflow-hidden" style={{ padding: compact ? 18 : 24 }}>
              <View style={{ position: 'absolute', end: -30, top: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: colors.primary, opacity: 0.25 }} />
              <Txt className="text-muted text-[12px] font-bold mb-1">{t(`dx.greet.${daypart(hour)}`)} · {t('dx.welcomeSub', { app: appName, days: range })}</Txt>
              <View className="flex-row items-center gap-3">
                <View className="w-12 h-12 rounded-2xl bg-surface items-center justify-center"><Icon name="check-decagram-outline" size={26} tone="success" /></View>
                <View className="flex-1"><Txt className="font-black text-[19px] leading-[26px]" style={{ letterSpacing: -0.3 }}>{t('dx.clearHero')}</Txt><Txt className="text-muted text-[12px]">{t('dx.clearSub')}</Txt></View>
              </View>
            </View>
          )}
        </Reveal>

        {/* Control centre (the new-request notification switch lives on Admin > Requests) */}
        <Reveal i={1}>
          <QuickActions pending={pending} noCredits={aud.zeroCredits} onNoCredits={() => openQv({ kind: 'aud', aud: 'zero' })} go={go} />
        </Reveal>

        {/* Toolbar */}
        <Reveal i={2}>
          <View className="flex-row items-center gap-3" style={{ flexWrap: 'wrap' }}>
            <Seg testID="range-seg" value={range} onChange={setRange} options={RANGES.map((r) => ({ key: r, label: t(`admin.dash.r${r}`), testID: `range-${r}` }))} />
            {compact ? <View style={{ flex: 1 }} /> : <Txt className="text-muted text-[12px] flex-1" style={{ minWidth: 140 }}>{t('dx.vsPrev', { days: range })}</Txt>}
            <View className="flex-row gap-2">
              <IconBtn testID="dash-refresh" icon="refresh" label={t('dx.refresh')} onPress={refresh} busy={busy} />
              <IconBtn testID="dash-export" icon="download-outline" label={t('dx.report')} onPress={exportCsv} />
            </View>
          </View>
        </Reveal>

        {/* KPIs: four in a row on desktop, 2 x 2 on phones */}
        <Reveal i={3}>
          <View className="flex-row flex-wrap" style={{ gap: 12 }}>
            <Kpi id="designs" basis={compact ? 150 : 200} icon="image-auto-adjust" label={t('admin.dash.kDesigns')} value={o.designs.cur} delta={o.designs.delta} spark={o.designs.spark} active={metric === 'designs'} onPress={() => setMetric('designs')} />
            <Kpi id="requests" basis={compact ? 150 : 200} icon="inbox-full-outline" label={t('admin.dash.kRequests')} value={o.requests.cur} delta={o.requests.delta} spark={o.requests.spark} active={metric === 'requests'} onPress={() => setMetric('requests')} />
            <Kpi id="users" basis={compact ? 150 : 200} icon="account-plus-outline" label={t('admin.dash.kUsers')} value={o.users.cur} delta={o.users.delta} spark={o.users.spark} active={metric === 'users'} onPress={() => setMetric('users')} />
            <Kpi id="pending" basis={compact ? 150 : 200} hot icon="clock-outline" label={t('admin.dash.kPending')} value={pending} sub={pending ? t('dx.kPendingSub', { wait: waitText(pipe.oldestPendingMs) }) : t('dx.kPendingNone')} onPress={() => go('/admin/requests')} />
          </View>
        </Reveal>

        {/* Trend | what to know */}
        <Reveal i={4}>
          {cols(
            <Panel fill testID="dash-chart" title={`${t('admin.dash.chartTitle')} · ${metricLabel(metric)}`} sub={t('dx.chartSub')}
              right={<View className="items-end gap-1.5">
                <Txt className="text-[12px] text-muted">{t('admin.dash.total')} <Txt className="font-extrabold text-fg">{total}</Txt>  ·  {t('admin.dash.peak')} <Txt className="font-extrabold text-fg">{peak}</Txt></Txt>
                <View className="flex-row items-center gap-2"><Delta v={trend.delta} testID="chart-delta" />
                  <Pressable testID="chart-compare" accessibilityRole="switch" accessibilityState={{ checked: compare }} onPress={() => setCompare(!compare)} className={`px-2.5 h-[22px] rounded-full items-center justify-center border ${compare ? 'border-ink' : 'border-line'}`}><Txt className="text-[10px] font-bold">{t('dx.comparePrev')}</Txt></Pressable></View>
              </View>}>
              {total === 0 && trend.old === 0 ? <Txt className="text-muted text-[13px] py-12 text-center">{t('admin.dash.noData')}</Txt> : (
                <AreaChart testID="chart-area" height={compact ? 170 : 220} values={trend.spark} prev={compare ? trend.prev : undefined}
                  labels={o.buckets.map((b) => dayLabel(b.start))}
                  tip={(i) => ({ title: dayLabel(o.buckets[i].start), value: `${trend.spark[i]} ${metricLabel(metric).toLowerCase()}`, prev: compare ? String(trend.prev[i] ?? 0) : undefined, prevTitle: compare && o.prevBuckets[i] ? dayLabel(o.prevBuckets[i].start) : undefined })} />
              )}
            </Panel>,
            <Panel fill testID="dash-insights" title={t('dx.insight.title')}>
              <View style={{ gap: 8 }}>
                {tips.map((i) => (
                  <Pressable key={i.key} testID={`insight-${i.key}`} accessibilityRole="button" onPress={() => openQv({ kind: 'insight', insight: i })} className="flex-row items-center gap-3 rounded-2xl bg-surface2 p-3 hover:opacity-80 active:opacity-70">
                    <View className={`w-9 h-9 rounded-xl items-center justify-center ${LEVEL[i.level].tone}`}><Icon name={LEVEL[i.level].icon} size={18} tone={i.level === 'warn' ? 'danger' : i.level === 'good' ? 'success' : 'fg'} /></View>
                    <Txt className="flex-1 text-[13px] font-semibold leading-[19px]">{insightText(i)}</Txt>
                    <Icon name="chevron-right" size={16} tone="muted" flip />
                  </Pressable>
                ))}
              </View>
            </Panel>,
          )}
        </Reveal>

        {/* When clients are active | requests pipeline */}
        <Reveal i={5}>
          {cols(
            <Panel fill title={t('dx.heat.title')} sub={t('dx.heat.sub')}
              right={heat.peak ? <View className="bg-soft rounded-full px-3 h-7 items-center justify-center"><Txt className="text-[11px] font-bold" numberOfLines={1}>{t('dx.heat.peak', { day: dayNames[heat.peak.day], from: heat.peak.block * 4, to: heat.peak.block * 4 + 4 })}</Txt></View> : null}>
              {heat.total === 0 ? <Txt className="text-muted text-[13px] py-8 text-center">{t('dx.heat.empty')}</Txt> : (
                <Heatmap testID="dash-heat" grid={heat.grid} max={heat.max} rows={dayNames.map((d) => d.slice(0, 3))} cols={colLabels}
                  label={(r, c, v) => t('dx.heat.cell', { day: dayNames[r], from: c * 4, to: c * 4 + 4, n: v })} />
              )}
            </Panel>,
            <Panel fill testID="dash-pipeline" title={t('dx.pipe.title')}>
              {pipe.total === 0 ? <Txt className="text-muted text-[13px] py-4 text-center">{t('dx.pipe.empty')}</Txt> : (
                <View style={{ gap: 14 }}>
                  <View className="flex-row items-center gap-4">
                    <Ring value={pipe.deliveryRate} size={84} thickness={10} color={colors.success}>
                      <Txt className="font-black text-[18px]" style={{ letterSpacing: -0.5 }}>{pipe.deliveryRate}%</Txt>
                    </Ring>
                    <View className="flex-1" style={{ gap: 6 }}>
                      <View className="flex-row items-center gap-2"><Txt className="text-[12px] text-muted flex-1">{t('dx.kRate')}</Txt><Delta v={pipe.deliveryRate - pipe.prevDeliveryRate} /></View>
                      <Txt className="text-[12px] text-muted">{t('dx.kWait')} <Txt className="font-extrabold text-fg">{waitText(pipe.avgPendingMs)}</Txt></Txt>
                    </View>
                  </View>
                  <StackBar parts={[{ key: 'p', v: pipe.pending, color: colors.danger }, { key: 'r', v: pipe.processing, color: colors.primary }, { key: 'd', v: pipe.delivered, color: colors.success }]} />
                  <View className="flex-row justify-between">
                    {([['pending', colors.danger], ['processing', colors.primary], ['delivered', colors.success]] as const).map(([k, c]) => (
                      <View key={k} className="flex-row items-center gap-1.5"><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} /><Txt className="text-[11px] text-muted">{t(`dx.pipe.${k}`)}</Txt><Txt className="text-[12px] font-extrabold">{pipe[k]}</Txt></View>
                    ))}
                  </View>
                </View>
              )}
            </Panel>,
          )}
        </Reveal>

        {/* Usage | AI + source mix */}
        <Reveal i={6}>
          {cols(
            <Panel fill testID="dash-top" title={t('admin.dash.topTitle')} right={<Seg small value={topTab} onChange={setTopTab} options={(['tools', 'styles', 'rooms', 'models'] as const).map((x) => ({ key: x, label: t(`admin.dash.top${x[0].toUpperCase()}${x.slice(1)}`), testID: `top-${x}` }))} />}>
              {best && topTab === 'tools' ? (
                <View className="flex-row items-center gap-3 bg-soft rounded-2xl p-3 mb-4" testID="dash-best">
                  <View className="w-10 h-10 rounded-full bg-primary items-center justify-center"><Icon name="trophy-outline" size={20} tone="onprimary" /></View>
                  <View className="flex-1"><Txt className="text-muted text-[11px] font-bold uppercase">{t('admin.dash.best')}</Txt><Txt numberOfLines={1} className="font-extrabold text-[16px]">{best.label}</Txt></View>
                  <Txt className="text-muted text-[12px]">{t('admin.dash.uses', { count: best.count })}</Txt>
                </View>
              ) : null}
              {tops[topTab].length ? <RankBars rows={tops[topTab]} unit={(n) => t('admin.dash.uses', { count: n })} /> : <Txt className="text-muted text-[13px] py-6 text-center">{t('admin.dash.noUsage')}</Txt>}
            </Panel>,
            <>
              <Panel testID="dash-ai" title={t('dx.ai.title')} sub={ai.runs ? t('dx.ai.runs', { n: ai.runs }) : undefined}>
                {ai.runs === 0 ? <Txt className="text-muted text-[13px] py-4 text-center">{t('dx.ai.none')}</Txt> : (
                  <View style={{ gap: 12 }}>
                    <View className="flex-row items-center gap-4">
                      <Ring value={ai.successRate} size={76} thickness={9} color={ai.successRate >= 90 ? colors.success : ai.successRate >= 70 ? colors.primary : colors.danger}>
                        <Txt className="font-black text-[16px]">{ai.successRate}%</Txt>
                      </Ring>
                      <View className="flex-1" style={{ gap: 4 }}>
                        <Txt className="text-[12px] text-muted">{t('dx.ai.success')}</Txt>
                        <Txt className="text-[12px] text-muted">{t('dx.ai.avg')} <Txt className="font-extrabold text-fg">{t('dx.ai.seconds', { n: Math.round(ai.avgMs / 1000) })}</Txt></Txt>
                        {ai.failed ? <Txt className="text-[12px] font-bold text-danger">{t('dx.ai.failed', { n: ai.failed })}</Txt> : null}
                      </View>
                    </View>
                    {ai.models.length ? <View className="flex-row flex-wrap gap-1.5">{ai.models.map((m) => <View key={m.label} className="bg-surface2 rounded-full px-2.5 h-6 items-center justify-center"><Txt className="text-[11px] font-semibold" numberOfLines={1}>{m.label} · {m.count}</Txt></View>)}</View> : null}
                  </View>
                )}
              </Panel>
              <Panel fill title={t('dx.mix.title')}>
                {mix.total === 0 ? <Txt className="text-muted text-[13px] py-4 text-center">{t('admin.dash.noUsage')}</Txt> : (
                  <View className="flex-row items-center gap-5">
                    <Donut testID="dash-mix" values={[mix.photo, mix.text]} colors={[colors.ink, colors.primary]} size={104} thickness={14}
                      center={<><Txt className="font-black text-[22px] leading-[24px]">{mix.total}</Txt><Txt className="text-muted text-[10px]">{t('dx.mix.designs')}</Txt></>} />
                    <View className="flex-1" style={{ gap: 10 }}>
                      {([['photo', mix.photo, colors.ink], ['text', mix.text, colors.primary]] as const).map(([k, v, c]) => (
                        <View key={k} className="flex-row items-center gap-2"><View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c }} /><Txt className="flex-1 text-[13px] font-semibold">{t(`dx.mix.${k}`)}</Txt><Txt className="text-[13px] font-extrabold">{Math.round((v / mix.total) * 100)}%</Txt></View>
                      ))}
                    </View>
                  </View>
                )}
              </Panel>
            </>, 1.6,
          )}
        </Reveal>

        {/* Clients | recent activity: every row opens the quick view */}
        <Reveal i={7}>
          {cols(
            <Panel fill testID="dash-audience" title={t('dx.aud.title')} right={<Pressable testID="aud-all" onPress={() => go('/admin/users')} hitSlop={6}><Txt className="text-[12px] font-bold underline">{t('admin.dash.viewAll')}</Txt></Pressable>}>
              <View className="flex-row flex-wrap" style={{ gap: 10 }}>
                {AUD_KINDS.map((k) => {
                  const v = k === 'credits' ? aud.creditsOut : aud[k === 'zero' ? 'zeroCredits' : k];
                  const icon = { active: 'account-check-outline', returning: 'account-heart-outline', leads: 'whatsapp', credits: 'wallet-outline', zero: 'battery-alert-variant-outline', blocked: 'account-cancel-outline' }[k];
                  return (
                    <Pressable key={k} testID={`aud-${k}`} accessibilityRole="button" onPress={() => openQv({ kind: 'aud', aud: k })} className="bg-surface2 rounded-2xl p-3 active:opacity-70 hover:opacity-80" style={{ flexGrow: 1, flexBasis: compact ? 140 : 150, minWidth: 0 }}>
                      <View className="flex-row items-center gap-1.5 mb-1"><Icon name={icon} size={15} tone="muted" /><Txt numberOfLines={1} className="text-muted text-[11px] font-bold flex-1">{t(`dx.aud.${k}`)}</Txt><Icon name="chevron-right" size={13} tone="muted" flip /></View>
                      <Txt className="font-black text-[22px] leading-[26px]" style={{ letterSpacing: -0.5 }}>{v}</Txt>
                    </Pressable>
                  );
                })}
              </View>
              {aud.top.length ? (
                <View className="mt-4" style={{ gap: 2 }}>
                  <Txt className="text-muted text-[11px] font-bold uppercase mb-1">{t('dx.aud.top')}</Txt>
                  {aud.top.map((u) => (
                    <Pressable key={u.id} testID={`aud-top-${u.id}`} accessibilityRole="button" onPress={() => openQv({ kind: 'client', id: u.id })} className="flex-row items-center gap-3 py-2 px-1 rounded-xl active:opacity-70 hover:bg-surface2">
                      <Initials name={u.name} /><Txt numberOfLines={1} className="flex-1 text-[13px] font-semibold">{u.name}</Txt>
                      <Txt className="text-muted text-[12px]">{t('dx.aud.designsN', { n: u.count })}</Txt>
                      <Icon name="chevron-right" size={14} tone="muted" flip />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Panel>,
            <Panel fill testID="dash-recent-card" title={t('admin.dash.recentTitle')} right={<Pressable onPress={() => go('/admin/requests')} hitSlop={6}><Txt className="text-[12px] font-bold underline">{t('admin.dash.viewAll')}</Txt></Pressable>}>
              <View testID="dash-recent" style={{ gap: 2 }}>
                {events.map((e) => (
                  <Pressable key={e.id} testID={`ev-${e.id}`} accessibilityRole="button" onPress={() => evOpen(e)} className="flex-row items-center gap-3 py-2 px-1 rounded-xl hover:bg-surface2 active:opacity-70">
                    <View className={`w-9 h-9 rounded-full items-center justify-center ${EV_ICON[e.kind].tone}`}><Icon name={EV_ICON[e.kind].icon} size={18} color="#fff" /></View>
                    <View className="flex-1"><Txt numberOfLines={2} className="text-[13px] font-semibold">{evText(e)}</Txt><Txt className="text-muted text-[11px]">{agoText(e.at)}</Txt></View>
                    <Icon name="chevron-right" size={14} tone="muted" flip />
                  </Pressable>
                ))}
              </View>
            </Panel>, 1.6,
          )}
        </Reveal>
      </View>
      <QuickView stack={qv} push={pushQv} back={backQv} close={closeQv} inp={inp} range={range} go={go} />
    </AdminPage>
  );
}
