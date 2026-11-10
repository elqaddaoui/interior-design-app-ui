import React, { useMemo, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageViewer } from '@/components/ui/ImageViewer';
import { MediaView } from '@/components/ui/MediaView';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { RequestViewer, Shot, useRequestShots } from '@/components/admin/RequestDetail';
import { RankBars } from './Charts';
import { Delta, Initials } from './Kit';
import { Spark } from './Viz';
import { useDashFormat } from './format';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { overview, heatmap, type Insight } from '@/lib/analytics';
import { AUD_KINDS, audienceClients, clientProfile, failedRuns, pendingQueue, type AudKind, type ClientRow } from '@/lib/dashDetail';
import { topUsage, type Inputs, type Range } from '@/lib/stats';
import { applyBulk } from '@/lib/userAdmin';
import { markRequest } from '@/lib/requestActions';
import { waLink } from '@/lib/share';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppUser, HistoryItem, RenderRequest, RequestStatus } from '@/data/types';

/** What the popup can show. The popup keeps a stack of these: tap a row to go deeper, the back arrow to come back. */
export type QV =
  | { kind: 'request'; id: string }
  | { kind: 'client'; id: string }
  | { kind: 'design'; id: string }
  | { kind: 'aud'; aud: AudKind }
  | { kind: 'insight'; insight: Insight };

const LIST_MAX = 30;
const STATUS_TONE: Record<RequestStatus, string> = { pending: 'bg-danger', processing: 'bg-primary', delivered: 'bg-success' };
const phoneOf = (p: string) => p.replace(/[^\d+]/g, '');
const call = (p: string) => Linking.openURL(`tel:${phoneOf(p)}`);

function StatusBadge({ s }: { s: RequestStatus }) {
  const { t } = useT();
  return <View className={`self-start rounded-full px-2.5 py-1 ${STATUS_TONE[s]}`}><Txt className={`text-[11px] font-bold ${s === 'processing' ? 'text-onprimary' : 'text-white'}`}>{t(`admin.enums.${s}`)}</Txt></View>;
}

function Block({ title, right, children }: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View className="mt-4">
      {title ? <View className="flex-row items-center justify-between mb-2 gap-2"><Txt className="text-muted text-[11px] font-extrabold uppercase flex-1" style={{ letterSpacing: 0.6 }}>{title}</Txt>{right}</View> : null}
      {children}
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' }) {
  return (
    <View className="flex-1 bg-surface2 rounded-2xl p-3" style={{ minWidth: 0 }}>
      <Txt numberOfLines={1} className="text-muted text-[11px] font-bold">{label}</Txt>
      <Txt numberOfLines={1} className={`font-black text-[22px] leading-[28px] ${tone === 'danger' ? 'text-danger' : ''}`} style={{ letterSpacing: -0.5 }}>{value}</Txt>
    </View>
  );
}

function Row({ lead, title, sub, right, onPress, testID, last }: { lead: React.ReactNode; title: string; sub?: string; right?: React.ReactNode; onPress?: () => void; testID?: string; last?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} className={`flex-row items-center gap-3 py-2.5 px-1 active:opacity-70 ${last ? '' : 'border-b border-line'}`}>
      {lead}
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt numberOfLines={1} className="text-[14px] leading-[20px] font-bold">{title}</Txt>
        {sub ? <Txt numberOfLines={1} className="text-muted text-[12px] leading-[17px]">{sub}</Txt> : null}
      </View>
      {right}
      <Icon name="chevron-right" size={16} tone="muted" flip />
    </Pressable>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return <View className="items-center py-10 gap-2"><View className="w-14 h-14 rounded-full bg-soft items-center justify-center"><Icon name={icon} size={26} /></View><Txt className="text-muted text-[13px] text-center">{text}</Txt></View>;
}

function Thumb({ uri, size = 44 }: { uri?: string; size?: number }) {
  return uri
    ? <MediaView uri={uri} className="rounded-xl" style={{ width: size, height: size }} />
    : <View className="rounded-xl bg-surface2 items-center justify-center" style={{ width: size, height: size }}><Icon name="image-outline" size={size * 0.45} tone="muted" /></View>;
}

/** Contact buttons: WhatsApp (primary, ink) and call. */
function Contact({ phone, message, id }: { phone: string; message?: string; id: string }) {
  const { t } = useT();
  if (!phoneOf(phone)) return null;
  return (
    <View className="flex-row gap-2.5 mt-4">
      <Button safe testID={`qv-wa-${id}`} icon="whatsapp" title={t('admin.req.openWa')} variant="ink" size="sm" className="flex-1" onPress={() => Linking.openURL(waLink(phone, message))} />
      <Button safe testID={`qv-call-${id}`} icon="phone" title={t('push.call')} variant="soft" size="sm" className="flex-1" onPress={() => call(phone)} />
    </View>
  );
}

/* ----------------------------- one request ----------------------------- */
function RequestView({ r, push }: { r: RenderRequest; push: (v: QV) => void }) {
  const s = useStore();
  const L = useL();
  const { t } = useT();
  const f = useDashFormat();
  const shots = useRequestShots(r);
  const [shot, setShot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const at = (uri?: string) => Math.max(0, shots.findIndex((x) => x.uri === uri));
  const d = r.draft;
  const used = r.aiRun?.used || r.aiModel;
  const parts = [f.toolName(d.toolId), L(s.roomTypes.find((x) => x.id === d.roomTypeId)?.title), L(s.styles.find((x) => x.id === d.styleId)?.title), L(s.palettes.find((x) => x.id === d.paletteId)?.title)].filter(Boolean);
  const set = async (status: RequestStatus) => {
    if (busy) return;
    setBusy(true);
    try { await markRequest(r, status); toast(t(status === 'delivered' ? 'admin.req.deliveredToast' : 'admin.crud.saved')); }
    catch { toast(t('admin.um.error')); }
    finally { setBusy(false); }
  };
  return (
    <View testID="qv-request">
      <View className="flex-row items-center gap-3">
        <Initials name={r.name || '?'} size={44} />
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt numberOfLines={1} className="text-[17px] leading-[24px] font-extrabold">{r.name || t('admin.dash.anonymous')}</Txt>
          <Txt className="text-muted text-[13px]" style={{ writingDirection: 'ltr', textAlign: 'left' }}>{r.whatsapp}</Txt>
        </View>
        <StatusBadge s={r.status} />
      </View>

      <View className="flex-row gap-2.5 mt-4">
        <Shot testID="qv-shot-photo" uri={r.photoUri} label={t('md.viewer.before')} onOpen={() => setShot(at(r.photoUri))} ratio={1} />
        <Shot testID="qv-shot-ai" uri={r.finalResult || r.aiResult} label={r.finalResult ? t('md.viewer.final') : t('md.viewer.after')} onOpen={() => setShot(at(r.finalResult || r.aiResult))} ratio={1} />
      </View>

      <View className="bg-surface2 rounded-2xl p-3 mt-3 gap-1.5">
        <Txt className="text-[13px] leading-[20px] font-semibold">{parts.join(' · ') || '—'}</Txt>
        {d.prompt ? <Txt numberOfLines={3} className="text-muted text-[12px] leading-[18px]">{d.prompt}</Txt> : null}
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Txt className="text-muted text-[11px]">{f.agoText(r.createdAt)} · {f.date(r.createdAt)}</Txt>
          {used ? <View className="flex-row items-center gap-1"><Icon name="creation-outline" size={12} tone="primary" /><Txt className="text-primary text-[11px] font-semibold" numberOfLines={1} style={{ writingDirection: 'ltr' }}>{used.label || used.model}</Txt></View> : null}
          {r.aiRun?.failed ? <Txt className="text-danger text-[11px] font-bold">{t('md.req.failed')}</Txt> : null}
        </View>
      </View>

      {r.status !== 'delivered' ? (
        <View className="flex-row gap-2.5 mt-4">
          {r.status === 'pending' ? <Button testID="qv-processing" title={t('admin.req.markProcessing')} variant="soft" size="sm" className="flex-1" loading={busy} onPress={() => set('processing')} /> : null}
          <Button testID="qv-delivered" icon="check" title={t('admin.req.markDelivered')} size="sm" className="flex-1" loading={busy} onPress={() => set('delivered')} />
        </View>
      ) : null}
      <Contact id={r.id} phone={r.whatsapp} message={t('admin.req.waMsg', { name: r.name })} />
      {r.userId ? <Button safe testID="qv-to-client" icon="account-outline" title={t('dx.qv.client')} variant="outline" size="sm" className="mt-2.5" onPress={() => push({ kind: 'client', id: r.userId })} /> : null}
      <RequestViewer r={r} index={shot} onIndex={setShot} onClose={() => setShot(null)} />
    </View>
  );
}

/* ----------------------------- one design ----------------------------- */
function DesignView({ h, push }: { h: HistoryItem; push: (v: QV) => void }) {
  const s = useStore();
  const L = useL();
  const { t } = useT();
  const f = useDashFormat();
  const [shot, setShot] = useState<number | null>(null);
  const items = [h.before && { uri: h.before, label: t('md.viewer.before') }, h.after && { uri: h.after, label: t('md.viewer.after') }].filter(Boolean) as { uri: string; label: string }[];
  const d = h.draft;
  const user = s.users.find((u) => u.id === h.userId);
  const parts = [f.toolName(d.toolId), L(s.roomTypes.find((x) => x.id === d.roomTypeId)?.title), L(s.styles.find((x) => x.id === d.styleId)?.title)].filter(Boolean);
  return (
    <View testID="qv-design">
      <View className="flex-row gap-2.5">
        <Shot uri={h.before} label={t('md.viewer.before')} onOpen={() => setShot(0)} ratio={1} />
        <Shot uri={h.after} label={t('md.viewer.after')} onOpen={() => setShot(Math.max(0, items.findIndex((x) => x.uri === h.after)))} ratio={1} />
      </View>
      <View className="bg-surface2 rounded-2xl p-3 mt-3 gap-1">
        <Txt className="text-[13px] leading-[20px] font-semibold">{parts.join(' · ') || '—'}</Txt>
        {d.prompt ? <Txt numberOfLines={3} className="text-muted text-[12px] leading-[18px]">{d.prompt}</Txt> : null}
        <Txt className="text-muted text-[11px]">{f.agoText(h.createdAt)} · {f.date(h.createdAt)}</Txt>
      </View>
      {user ? <Button safe testID="qv-to-client" icon="account-outline" title={user.name || t('dx.qv.client')} variant="outline" size="sm" className="mt-3" onPress={() => push({ kind: 'client', id: user.id })} /> : null}
      <ImageViewer items={items} index={shot} onIndexChange={setShot} onClose={() => setShot(null)} />
    </View>
  );
}

/* ----------------------------- one client ----------------------------- */
function ClientView({ id, inp, push }: { id: string; inp: Inputs; push: (v: QV) => void }) {
  const { t } = useT();
  const f = useDashFormat();
  const [busy, setBusy] = useState(false);
  const profile = useMemo(() => clientProfile(inp, id), [inp, id]);
  const fromRequest = profile.requests[0];
  const user: AppUser | undefined = inp.users.find((u) => u.id === id);
  const name = user?.name || fromRequest?.name || '';
  const phone = user?.whatsapp || fromRequest?.whatsapp || '';
  const addCredits = async (amount: number) => {
    if (busy || !user) return;
    setBusy(true);
    try { await applyBulk([user.id], { type: 'credits', mode: 'add', amount }); toast(t('dx.qv.creditsAdded', { n: amount })); }
    catch { toast(t('admin.um.error')); }
    finally { setBusy(false); }
  };
  return (
    <View testID="qv-client">
      <View className="flex-row items-center gap-3">
        <Initials name={name || '?'} size={48} />
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt numberOfLines={1} className="text-[18px] leading-[24px] font-extrabold">{name || t('admin.dash.anonymous')}</Txt>
          {phone ? <Txt className="text-muted text-[13px]" style={{ writingDirection: 'ltr', textAlign: 'left' }}>{phone}</Txt> : null}
        </View>
      </View>
      {user && (user.blocked || user.leadDone || user.role === 'admin') ? (
        <View className="flex-row flex-wrap gap-1.5 mt-3">
          {user.blocked ? <View className="bg-danger/15 rounded-full px-2.5 h-6 items-center justify-center"><Txt className="text-danger text-[11px] font-bold">{t('admin.um.blocked')}</Txt></View> : null}
          {user.leadDone ? <View className="bg-surface2 rounded-full px-2.5 h-6 items-center justify-center flex-row gap-1"><Icon name="whatsapp" size={12} tone="muted" /><Txt className="text-[11px] font-bold">{t('dx.aud.leads')}</Txt></View> : null}
          {user.role === 'admin' ? <View className="bg-soft rounded-full px-2.5 h-6 items-center justify-center"><Txt className="text-[11px] font-bold">{t('dx.shell.admin')}</Txt></View> : null}
        </View>
      ) : null}

      <View className="flex-row gap-2.5 mt-4">
        <Stat label={t('admin.um.credits')} value={user ? user.credits : '—'} tone={user && user.credits <= 0 ? 'danger' : undefined} />
        <Stat label={t('dx.qv.designs')} value={profile.designs} />
        <Stat label={t('dx.qv.requests')} value={profile.requests.length} />
      </View>
      <Txt className="text-muted text-[12px] mt-2.5">{t('dx.qv.lastSeen')}: <Txt className="font-bold text-fg">{profile.last ? `${f.agoText(profile.last)} · ${f.date(profile.last)}` : '—'}</Txt></Txt>

      {user ? (
        <Block title={t('dx.qv.addCredits')}>
          <View className="flex-row gap-2">
            {[1, 5, 10].map((n) => (
              <Pressable key={n} testID={`qv-credit-${n}`} accessibilityRole="button" disabled={busy} onPress={() => addCredits(n)} className="flex-1 h-10 rounded-full bg-surface2 items-center justify-center flex-row gap-1 active:opacity-70" style={{ opacity: busy ? 0.5 : 1 }}>
                <Icon name="plus" size={14} /><Txt className="font-extrabold text-[14px]">{n}</Txt>
              </Pressable>
            ))}
          </View>
        </Block>
      ) : null}

      <Contact id={id} phone={phone} />

      <Block title={t('dx.qv.recentRequests')}>
        {profile.requests.length === 0 ? <Txt className="text-muted text-[13px] py-3">{t('dx.qv.noRequests')}</Txt> : profile.requests.slice(0, 5).map((r, i, a) => (
          <Row key={r.id} testID={`qv-req-${r.id}`} last={i === a.length - 1} lead={<Thumb uri={r.aiResult || r.photoUri} size={40} />} title={f.toolName(r.draft.toolId) || r.name} sub={f.agoText(r.createdAt)} right={<StatusBadge s={r.status} />} onPress={() => push({ kind: 'request', id: r.id })} />
        ))}
      </Block>
    </View>
  );
}

/* ------------------------- a list of clients ------------------------- */
function ClientList({ rows, kind, push }: { rows: ClientRow[]; kind?: AudKind; push: (v: QV) => void }) {
  const { t } = useT();
  const f = useDashFormat();
  if (!rows.length) return <Empty icon="account-search-outline" text={t('dx.qv.noClients')} />;
  return (
    <View testID="qv-clients">
      {rows.slice(0, LIST_MAX).map((c, i, a) => {
        const name = c.user.name || t('admin.dash.anonymous');
        const sub = kind === 'credits' || kind === 'zero' ? c.user.whatsapp : [c.designs ? t('dx.aud.designsN', { n: c.designs }) : '', c.last ? f.agoText(c.last) : ''].filter(Boolean).join(' · ') || c.user.whatsapp;
        return (
          <Row key={c.user.id} testID={`qv-client-${c.user.id}`} last={i === a.length - 1} lead={<Initials name={name} size={40} />} title={name} sub={sub}
            right={kind === 'credits' || kind === 'zero' ? <View className={`rounded-full px-2.5 h-6 items-center justify-center ${c.user.credits > 0 ? 'bg-soft' : 'bg-danger/15'}`}><Txt className={`text-[12px] font-extrabold ${c.user.credits > 0 ? '' : 'text-danger'}`}>{c.user.credits}</Txt></View> : undefined}
            onPress={() => push({ kind: 'client', id: c.user.id })} />
        );
      })}
      {rows.length > LIST_MAX ? <Txt className="text-muted text-[12px] text-center pt-3">{t('dx.qv.more', { n: rows.length - LIST_MAX })}</Txt> : null}
    </View>
  );
}

function RequestList({ rows, push, wait }: { rows: { r: RenderRequest; waitMs?: number }[]; push: (v: QV) => void; wait?: boolean }) {
  const { t } = useT();
  const f = useDashFormat();
  if (!rows.length) return <Empty icon="inbox-outline" text={t('dx.qv.noRequests')} />;
  return (
    <View testID="qv-requests">
      {rows.slice(0, LIST_MAX).map(({ r, waitMs }, i, a) => (
        <Row key={r.id} testID={`qv-req-${r.id}`} last={i === a.length - 1} lead={<Thumb uri={r.aiResult || r.photoUri} />} title={r.name || t('admin.dash.anonymous')}
          sub={wait && waitMs !== undefined ? t('dx.qv.waiting', { wait: f.waitText(waitMs) }) : [f.toolName(r.draft.toolId), f.agoText(r.createdAt)].filter(Boolean).join(' · ')}
          right={wait ? undefined : <StatusBadge s={r.status} />} onPress={() => push({ kind: 'request', id: r.id })} />
      ))}
      {rows.length > LIST_MAX ? <Txt className="text-muted text-[12px] text-center pt-3">{t('dx.qv.more', { n: rows.length - LIST_MAX })}</Txt> : null}
    </View>
  );
}

/* ------------------------------ an insight ------------------------------ */
const LEVEL_ICON = { warn: 'alert-outline', good: 'trending-up', info: 'lightbulb-on-outline' } as const;
const LEVEL_BG = { warn: 'bg-danger/15', good: 'bg-success/15', info: 'bg-soft' } as const;

function InsightView({ insight, inp, range, push }: { insight: Insight; inp: Inputs; range: Range; push: (v: QV) => void }) {
  const { t } = useT();
  const L = useL();
  const f = useDashFormat();
  const { colors } = useTheme();
  const tools = useStore((s) => s.tools);
  const o = useMemo(() => overview(inp, range), [inp, range]);
  const heat = useMemo(() => heatmap(inp, range), [inp, range]);
  const k = insight.key;
  let body: React.ReactNode = null;
  if (k === 'backlog') body = <RequestList wait push={push} rows={pendingQueue(inp).map((w) => ({ r: w.request, waitMs: w.waitMs }))} />;
  else if (k === 'aiFail') body = <RequestList push={push} rows={failedRuns(inp, range).map((r) => ({ r }))} />;
  else if (k === 'zeroCredits') body = <ClientList kind="zero" push={push} rows={audienceClients(inp, range, 'zero')} />;
  else if (k === 'growth' || k === 'drop') {
    const d = o.designs;
    body = (
      <View className="gap-3">
        <View className="flex-row gap-2.5">
          <Stat label={t('dx.qv.thisPeriod')} value={d.cur} />
          <Stat label={t('dx.qv.prevPeriod')} value={d.old} />
          <View className="flex-1 bg-surface2 rounded-2xl p-3 justify-center items-start"><Delta v={d.delta} /></View>
        </View>
        <View className="bg-surface2 rounded-2xl p-3"><Spark values={d.spark} height={64} color={colors.ink} /></View>
      </View>
    );
  } else if (k === 'topTool') {
    const rows = topUsage(inp, range, (x) => x.toolId).map((x) => ({ id: x.id, count: x.count, label: L(tools.find((tl) => tl.id === x.id)?.title) || x.id }));
    body = rows.length ? <RankBars rows={rows} unit={(n) => t('admin.dash.uses', { count: n })} /> : null;
  } else if (k === 'peakDay') {
    const max = Math.max(1, ...heat.dayTotals);
    const best = heat.dayTotals.indexOf(Math.max(...heat.dayTotals));
    body = (
      <View className="flex-row items-end gap-2" style={{ height: 120 }}>
        {heat.dayTotals.map((v, i) => (
          <View key={i} className="flex-1 items-center justify-end gap-1" style={{ height: '100%' }}>
            <Txt className="text-[11px] font-extrabold">{v}</Txt>
            <View style={{ width: '100%', height: Math.max(4, (v / max) * 76), borderRadius: 8, backgroundColor: i === best ? colors.primary : colors.surface2, borderWidth: i === best ? 1.5 : 0, borderColor: colors.ink }} />
            <Txt className="text-[10px] text-muted" numberOfLines={1}>{t(`dx.d${i}`)}</Txt>
          </View>
        ))}
      </View>
    );
  }
  return (
    <View testID="qv-insight">
      <View className="flex-row items-center gap-3 bg-surface2 rounded-2xl p-3">
        <View className={`w-10 h-10 rounded-xl items-center justify-center ${LEVEL_BG[insight.level]}`}><Icon name={LEVEL_ICON[insight.level]} size={20} tone={insight.level === 'warn' ? 'danger' : insight.level === 'good' ? 'success' : 'fg'} /></View>
        <Txt className="flex-1 text-[14px] leading-[21px] font-bold">{f.insightText(insight)}</Txt>
      </View>
      {body ? <Block>{body}</Block> : null}
    </View>
  );
}

/* --------------------------------- popup --------------------------------- */
export function QuickView({ stack, push, back, close, inp, range, go }: {
  stack: QV[]; push: (v: QV) => void; back: () => void; close: () => void; inp: Inputs; range: Range; go: (href: string) => void;
}) {
  const { t } = useT();
  const top = stack[stack.length - 1];
  const open = (href: string) => { close(); go(href); };
  let title = '', body: React.ReactNode = null, href: string | null = null, hrefLabel = t('dx.qv.openPage');

  if (top?.kind === 'request') {
    const r = inp.requests.find((x) => x.id === top.id);
    title = t('admin.req.details'); href = `/admin/requests?open=${top.id}&target=${top.id}`; hrefLabel = t('dx.qv.openFull');
    body = r ? <RequestView r={r} push={push} /> : <Empty icon="inbox-remove-outline" text={t('dx.qv.gone')} />;
  } else if (top?.kind === 'client') {
    title = t('dx.qv.client'); href = `/admin/users?target=${top.id}`;
    body = <ClientView id={top.id} inp={inp} push={push} />;
  } else if (top?.kind === 'design') {
    const h = inp.history.find((x) => x.id === top.id);
    title = t('dx.qv.design'); href = '/admin/requests';
    body = h ? <DesignView h={h} push={push} /> : <Empty icon="image-off-outline" text={t('dx.qv.gone')} />;
  } else if (top?.kind === 'aud') {
    const rows = audienceClients(inp, range, top.aud);
    title = t(`dx.aud.${top.aud}`); href = '/admin/users'; hrefLabel = t('dx.qv.allClients');
    body = <View><Txt className="text-muted text-[12px] mb-1.5">{t('dx.qv.count', { count: rows.length })}</Txt><ClientList rows={rows} kind={top.aud} push={push} /></View>;
  } else if (top?.kind === 'insight') {
    title = t('dx.insight.title'); href = top.insight.key === 'steady' ? null : top.insight.href;
    body = <InsightView insight={top.insight} inp={inp} range={range} push={push} />;
  }

  return (
    <Sheet visible={!!top} onClose={close} title={title} onBack={stack.length > 1 ? back : undefined}
      footer={href ? <Button safe testID="qv-open-page" title={hrefLabel} icon="open-in-new" variant="soft" size="sm" full onPress={() => open(href!)} /> : undefined}>
      {body}
    </Sheet>
  );
}

export { AUD_KINDS };
