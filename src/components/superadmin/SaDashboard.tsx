import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Delta, IconBtn, Kpi, Panel, Reveal, Seg } from '@/components/admin/dashboard/Kit';
import { RankBars } from '@/components/admin/dashboard/Charts';
import { AreaChart, Donut, StackBar } from '@/components/admin/dashboard/Viz';
import { useSuperData } from '@/hooks/useSuperData';
import { pct, type SaStats } from '@/lib/superadmin';
import { useTheme } from '@/theme/ThemeProvider';
import { Empty, Loaded, Pill, SaPage, useSa } from './ui';

type Metric = 'clients' | 'requests' | 'designs';
const nice = (id: string) => id.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function SaDashboard() {
  const { t, ago, loc } = useSa();
  const router = useRouter();
  const { colors } = useTheme();
  const q = useSuperData<SaStats>('/stats');
  const [metric, setMetric] = useState<Metric>('requests');

  return (
    <SaPage title={t('dashTitle')} sub={t('dashSub')} right={<IconBtn testID="sa-refresh" icon="refresh" label={t('refresh')} onPress={q.reload} busy={q.loading && !!q.data} />}>
      <Loaded q={q}>
        {(s) => {
          const w = s.windows;
          const series = s.series[metric];
          const labels = series.map((_, i) => new Date(s.series.start + i * 86400000).toLocaleDateString(loc, { day: 'numeric', month: 'short' }));
          const status = s.requestsByStatus;
          const statusColors = [colors.muted, colors.ink, colors.primary];
          const statusRows: [string, number][] = [['pending', status.pending], ['processing', status.processing], ['delivered', status.delivered]];
          const tenantTotal = Object.values(s.tenantsByStatus).reduce((a, b) => a + b, 0);
          const goSecurity = () => router.push('/superadmin/security' as never);
          return (
            <View style={{ gap: 14 }} testID="sa-dashboard">
              {s.security.defaultSuperPassword ? (
                <Alert testID="sa-alert-super" title={t('alertDefaultSuper')} sub={t('alertDefaultSuperSub')} action={t('changeNow')} onPress={goSecurity} />
              ) : null}
              {s.security.defaultAdminPassword ? (
                <Alert testID="sa-alert-admin" title={t('alertDefaultAdmin')} sub={t('alertDefaultAdminSub')} action={t('review')} onPress={() => router.push('/superadmin/admins' as never)} />
              ) : null}

              <Reveal>
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  <Kpi id="clients" icon="account-group-outline" label={t('kClients')} value={s.totals.clients} delta={pct(w.clientsNew7, w.clientsPrev7)} spark={s.series.clients} sub={t('kNew', { n: w.clientsNew7 })} active={metric === 'clients'} onPress={() => setMetric('clients')} />
                  <Kpi id="active" icon="pulse" label={t('kActive')} value={w.active7} sub={t('kTotal', { n: s.totals.clients })} />
                  <Kpi id="requests" icon="clipboard-text-clock-outline" label={t('kRequests')} value={w.requests7} delta={pct(w.requests7, w.requestsPrev7)} spark={s.series.requests} sub={t('kTotal', { n: s.totals.requests })} active={metric === 'requests'} onPress={() => setMetric('requests')} />
                  <Kpi id="designs" icon="palette-outline" label={t('kDesigns')} value={w.designs7} delta={pct(w.designs7, w.designsPrev7)} spark={s.series.designs} sub={t('kTotal', { n: s.totals.designs })} active={metric === 'designs'} onPress={() => setMetric('designs')} />
                </View>
              </Reveal>
              <Reveal i={1}>
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  <Kpi id="admins" icon="account-tie-outline" label={t('kAdmins')} value={s.totals.admins} sub={s.totals.adminsDisabled ? `${t('hDisabled')}: ${s.totals.adminsDisabled}` : undefined} onPress={() => router.push('/superadmin/admins' as never)} basis={240} />
                  <Kpi id="tenants" icon="domain" label={t('kTenants')} value={s.totals.tenants} onPress={() => router.push('/superadmin/tenants' as never)} basis={240} />
                  <Kpi id="roles" icon="shield-account-outline" label={t('nav_roles')} value={s.totals.roles} onPress={() => router.push('/superadmin/roles' as never)} basis={240} />
                </View>
              </Reveal>

              <Reveal i={2}>
                <Panel title={t('activity')} sub={t('activitySub')} testID="sa-activity"
                  right={<Seg small value={metric} onChange={setMetric} testID="sa-metric" options={[{ key: 'clients', label: t('sClients') }, { key: 'requests', label: t('sRequests') }, { key: 'designs', label: t('sDesigns') }]} />}>
                  <AreaChart testID="sa-chart" values={series} labels={labels} height={210}
                    tip={(i) => ({ title: labels[i], value: `${series[i]} ${t(metric === 'clients' ? 'sClients' : metric === 'requests' ? 'sRequests' : 'sDesigns')}` })} />
                </Panel>
              </Reveal>

              <Reveal i={3}>
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  <View style={{ flexGrow: 1, flexBasis: 320, minWidth: 0 }}>
                    <Panel title={t('reqStatus')} fill>
                      <View className="flex-row items-center" style={{ gap: 18 }}>
                        <Donut size={124} thickness={14} values={statusRows.map(([, v]) => v)} colors={statusColors}
                          center={<><Txt className="text-[24px] font-black">{s.totals.requests}</Txt><Txt className="text-muted text-[11px]">{t('sRequests')}</Txt></>} />
                        <View style={{ flex: 1, gap: 10, minWidth: 0 }}>
                          {statusRows.map(([k, v], i) => (
                            <View key={k} className="flex-row items-center" style={{ gap: 8 }}>
                              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColors[i] }} />
                              <Txt className="flex-1 text-[13px] font-semibold" numberOfLines={1}>{t(`st_${k}`)}</Txt>
                              <Txt className="text-[13px] font-extrabold">{v}</Txt>
                            </View>
                          ))}
                        </View>
                      </View>
                    </Panel>
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: 320, minWidth: 0 }}>
                    <Panel title={t('topTools')} fill testID="sa-top-tools">
                      {s.topTools.length ? <RankBars rows={s.topTools.map((r) => ({ id: r.id, label: nice(r.id), count: r.count }))} unit={(n) => t('uses', { n })} /> : <Txt className="text-muted text-[13px] py-6 text-center">{t('empty')}</Txt>}
                    </Panel>
                  </View>
                </View>
              </Reveal>

              <Reveal i={4}>
                <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                  <View style={{ flexGrow: 1, flexBasis: 320, minWidth: 0 }}>
                    <Panel title={t('health')} fill testID="sa-health">
                      <View style={{ gap: 11 }}>
                        {([
                          ['hQueue', s.queue.pendingNotifications, 'bell-outline'],
                          ['hPush', s.totals.pushDevices, 'cellphone'],
                          ['hBlocked', s.totals.clientsBlocked, 'account-cancel-outline'],
                          ['hCredits', s.totals.creditsOutstanding, 'ticket-outline'],
                          ['hChats', s.totals.conversations, 'chat-outline'],
                          ['hDisabled', s.totals.adminsDisabled, 'account-off-outline'],
                        ] as [string, number, string][]).map(([k, v, icon]) => (
                          <View key={k} className="flex-row items-center" style={{ gap: 10 }}>
                            <View className="w-8 h-8 rounded-xl bg-soft items-center justify-center"><Icon name={icon} size={16} tone="fg" /></View>
                            <Txt className="flex-1 text-[13.5px] font-semibold" numberOfLines={1}>{t(k)}</Txt>
                            <Txt testID={`sa-health-${k}`} className="text-[14px] font-black">{v.toLocaleString(loc)}</Txt>
                          </View>
                        ))}
                      </View>
                    </Panel>
                  </View>
                  <View style={{ flexGrow: 1, flexBasis: 320, minWidth: 0, gap: 12 }}>
                    <Panel title={t('tenantsCard')} right={<Pressable accessibilityRole="link" onPress={() => router.push('/superadmin/tenants' as never)}><Txt className="text-[12px] font-bold text-muted">{t('seeAll')}</Txt></Pressable>}>
                      {tenantTotal ? (
                        <>
                          <StackBar parts={[{ key: 'active', v: s.tenantsByStatus.active ?? 0, color: colors.success }, { key: 'trial', v: s.tenantsByStatus.trial ?? 0, color: colors.primary }, { key: 'suspended', v: s.tenantsByStatus.suspended ?? 0, color: colors.danger }]} />
                          <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
                            {(['active', 'trial', 'suspended'] as const).map((k) => <Pill key={k} tone={k === 'active' ? 'success' : k === 'suspended' ? 'danger' : 'primary'} label={`${t(`ts_${k}`)} · ${s.tenantsByStatus[k] ?? 0}`} />)}
                          </View>
                        </>
                      ) : <Txt className="text-muted text-[13px]">{t('empty')}</Txt>}
                    </Panel>
                    <Panel title={t('rolesCard')} right={<Pressable accessibilityRole="link" onPress={() => router.push('/superadmin/roles' as never)}><Txt className="text-[12px] font-bold text-muted">{t('seeAll')}</Txt></Pressable>}>
                      {s.rolesUsage.length ? (
                        <View style={{ gap: 8 }}>
                          {s.rolesUsage.slice(0, 5).map((r) => (
                            <View key={r.id} className="flex-row items-center justify-between" style={{ gap: 8 }}>
                              <Txt className="text-[13.5px] font-semibold flex-1" numberOfLines={1}>{r.name}</Txt>
                              <Pill label={String(r.count)} />
                            </View>
                          ))}
                        </View>
                      ) : <Txt className="text-muted text-[13px]">{t('empty')}</Txt>}
                    </Panel>
                  </View>
                </View>
              </Reveal>

              <Reveal i={5}>
                <Panel title={t('recent')} testID="sa-recent" right={<Pressable accessibilityRole="link" testID="sa-see-audit" onPress={() => router.push('/superadmin/audit' as never)}><Txt className="text-[12px] font-bold text-muted">{t('seeAll')}</Txt></Pressable>}>
                  {s.recent.length === 0 ? <Txt className="text-muted text-[13px] py-3 text-center">{t('empty')}</Txt> : (
                    <View>
                      {s.recent.map((a, i) => (
                        <View key={a.id} className={`flex-row items-center py-2.5 ${i ? 'border-t border-line' : ''}`} style={{ gap: 10 }}>
                          <View className="w-8 h-8 rounded-full bg-soft items-center justify-center"><Icon name="history" size={16} tone="fg" /></View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Txt className="text-[13.5px] font-bold" numberOfLines={1}>{actionLabel(t, a.action)}{a.target ? ` · ${a.target}` : ''}</Txt>
                            <Txt className="text-muted text-[12px]" numberOfLines={1}>{t('by', { actor: a.actor })}</Txt>
                          </View>
                          <Txt className="text-muted text-[12px]">{ago(a.at)}</Txt>
                        </View>
                      ))}
                    </View>
                  )}
                </Panel>
              </Reveal>
            </View>
          );
        }}
      </Loaded>
    </SaPage>
  );
}

/** Readable label for an audit action (`admin.created` → "Administrator created"), falling back to the raw code. */
export function actionLabel(t: (k: string) => string, action: string) {
  const key = `act_${action.replace(/[.]/g, '_')}`;
  const text = t(key);
  return text === `sa.${key}` || text === key ? action : text;
}

function Alert({ title, sub, action, onPress, testID }: { title: string; sub: string; action: string; onPress: () => void; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="alert" className="flex-row flex-wrap items-center bg-danger/10 border border-danger/30 rounded-3xl p-4" style={{ gap: 12 }}>
      <View className="w-10 h-10 rounded-2xl bg-danger/15 items-center justify-center"><Icon name="shield-lock-outline" size={22} tone="danger" /></View>
      <View style={{ flex: 1, minWidth: 220 }}>
        <Txt className="text-[14.5px] font-extrabold">{title}</Txt>
        <Txt className="text-muted text-[12.5px] leading-[18px] mt-0.5">{sub}</Txt>
      </View>
      <Button size="sm" variant="ink" title={action} onPress={onPress} testID={`${testID}-action`} />
    </View>
  );
}
