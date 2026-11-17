import { SearchTarget, useViewState } from '@/hooks/useViewState';
import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { MediaView } from '@/components/ui/MediaView';
import { RequestInfo, RequestViewer, Shot, useRequestShots } from '@/components/admin/RequestDetail';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { SettingAnchor } from '@/components/admin/AudienceBadge';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { RightClick, sep, type MenuItem } from '@/components/admin/ContextMenu';
import { ImageField } from '@/components/admin/ImageField';
import { useBp } from '@/hooks/useBp';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { useCan } from '@/store/useAdminProfile';
import { toast } from '@/store/useToast';
import { waLink } from '@/lib/share';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { requestLeave, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { PushNotifications } from '@/components/admin/PushNotifications';
import { backendEnabled } from '@/lib/backend';
import { markRequest } from '@/lib/requestActions';
import type { RenderRequest, RequestStatus } from '@/data/types';

const STATUSES: RequestStatus[] = ['pending', 'processing', 'delivered'];
const TONE: Record<RequestStatus, string> = { pending: 'bg-danger', processing: 'bg-primary', delivered: 'bg-success' };

function Badge({ s }: { s: RequestStatus }) {
  const { t } = useT();
  return <View className={`self-start rounded-full px-2.5 py-1 ${TONE[s]}`}><Txt className={`text-[12px] font-bold ${s === 'processing' ? 'text-onprimary' : 'text-white'}`}>{t(`admin.enums.${s}`)}</Txt></View>;
}

function Choices({ r }: { r: RenderRequest }) {
  const s = useStore();
  const L = useL();
  const { t } = useT();
  const d = r.draft;
  const run = r.aiRun;
  const showApi = useCan('storeApi'); // no model / provider name for an administrator without API access
  const used = showApi ? run?.used || r.aiModel : undefined;
  const parts = [
    s.tools.find((x) => x.id === d.toolId) && L(s.tools.find((x) => x.id === d.toolId)!.title),
    d.roomTypeId && L(s.roomTypes.find((x) => x.id === d.roomTypeId)?.title),
    d.styleId && L(s.styles.find((x) => x.id === d.styleId)?.title),
    (run ? run.applied?.mode : d.mode) && t(`md.req.mode${(run ? run.applied?.mode : d.mode) === 'renovation' ? 'Renovation' : 'Restyle'}`).replace(/ \(.*\)$/, ''),
    d.paletteId && L(s.palettes.find((x) => x.id === d.paletteId)?.title),
  ].filter(Boolean) as string[];
  const colors = run?.applied?.colors?.map((c) => c.hex) || d.colors || [];
  return (
    <View className="gap-1.5" aria-label={t('admin.f.choices')}>
      <Txt className="text-muted text-[13px] leading-[21px]">{parts.join(' · ') || '—'}</Txt>
      {colors.length || used || d.prompt ? (
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {colors.length ? <View className="flex-row gap-1">{colors.map((hex, i) => <View key={`${hex}${i}`} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: hex, borderWidth: 1, borderColor: 'rgba(128,128,128,0.4)' }} />)}</View> : null}
          {used ? <View className="flex-row items-center gap-1" style={{ maxWidth: '100%' }}><Icon name="creation-outline" size={13} tone="primary" /><Txt className="text-[12px] leading-[18px] text-primary font-semibold" numberOfLines={1} style={{ writingDirection: 'ltr' }}>{used.label || used.model}</Txt></View> : null}
          {d.prompt ? <View className="flex-row items-center gap-1" style={{ maxWidth: '100%' }}><Icon name="text-box-outline" size={13} tone="muted" /><Txt className="text-muted text-[12px] leading-[18px]" numberOfLines={1} style={{ flexShrink: 1 }}>{d.prompt}</Txt></View> : null}
        </View>
      ) : null}
    </View>
  );
}

/** The request's pictures side by side (client photo / AI result / delivered design). A tap opens the viewer; the button opens it as before/after. */
function Shots({ r, onOpen }: { r: RenderRequest; onOpen: (index: number) => void }) {
  const { t } = useT();
  const shots = useRequestShots(r);
  const at = (uri?: string) => Math.max(0, shots.findIndex((x) => x.uri === uri));
  return (
    <View testID="req-shots" className="mt-1">
      <View className="flex-row flex-wrap gap-2.5">
        <Shot testID="req-shot-photo" uri={r.photoUri} label={t('md.viewer.before')} onOpen={() => onOpen(at(r.photoUri))} />
        <Shot testID="req-shot-ai" uri={r.aiResult} label={t('md.viewer.after')} onOpen={() => onOpen(at(r.aiResult))} />
        {r.finalResult ? <Shot testID="req-shot-final" uri={r.finalResult} label={t('md.viewer.final')} onOpen={() => onOpen(at(r.finalResult))} /> : null}
      </View>
      {r.photoUri && r.aiResult ? <Button testID="req-compare" icon="compare" title={t('md.viewer.compare')} variant="soft" size="sm" className="self-start mt-2.5" onPress={() => onOpen(at(r.photoUri))} /> : null}
    </View>
  );
}

/** List thumbnail: result (or photo) with a tap target of its own that opens the same before/after viewer as the details. */
function Thumb({ r, onOpen }: { r: RenderRequest; onOpen: () => void }) {
  const { t } = useT();
  return (
    <Pressable testID={`req-thumb-${r.id}`} onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={t('md.viewer.compare')} hitSlop={4} className="active:opacity-80">
      <MediaView uri={r.aiResult || r.photoUri} className="rounded-lg" style={{ width: 52, height: 52 }} />
      {r.aiResult && r.photoUri ? <View className="absolute -bottom-1 -end-1 w-5 h-5 rounded-full bg-primary items-center justify-center"><Icon name="compare" size={12} tone="onprimary" /></View> : null}
    </Pressable>
  );
}

function Detail({ id, onClose, onDelete }: { id: string | null; onClose: () => void; onDelete: (id: string) => void }) {
  const s = useStore();
  const { t } = useT();
  const r = s.requests.find((x) => x.id === id);
  const [final, setFinal] = useViewState('final', '');
  const [shot, setShot] = React.useState<number | null>(null);
  const record = React.useRef(id);
  React.useEffect(() => { if (record.current !== id) { record.current = id; setFinal(r?.finalResult ?? ''); } }, [id, r?.finalResult, setFinal]);
  const dirty = !!r && final !== (r.finalResult ?? '');
  const saveDraft = async () => { if (r) await s.update('requests', r.id, { finalResult: final }); };
  useLeaveGuard(dirty, saveDraft, () => { setFinal(r?.finalResult ?? ''); onClose(); }, { before: { finalResult: r?.finalResult ?? '' }, after: { finalResult: final }, labels: { finalResult: t('admin.f.finalResult') } });
  const close = () => requestLeave(onClose);
  if (!r) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;
  const set = async (status: RequestStatus, extra: Partial<RenderRequest> = {}) => {
    await markRequest(r, status, extra);
    if (status === 'delivered') toast(t('admin.req.deliveredToast'));
  };
  const saveFinal = async () => { await s.update('requests', r.id, { finalResult: final }); toast(t('admin.crud.saved')); };
  const open = () => Linking.openURL(waLink(r.whatsapp, t('admin.req.waMsg', { name: r.name })));
  return (
    <Sheet visible={!!id} onClose={close} title={t('admin.req.details')} wide>
      <View className="flex-row items-center justify-between mb-2"><View><Txt className="text-[16px] font-extrabold">{r.name}</Txt><Txt className="text-muted">{r.whatsapp}</Txt></View><Badge s={r.status} /></View>
      <Shots r={r} onOpen={setShot} />
      <RequestInfo r={r} onOpenShot={setShot} />
      <View className="mt-4"><ImageField label={t('admin.req.uploadFinal')} value={final} onChange={setFinal} /></View>
      <Button title={t('common.save')} variant="soft" size="sm" onPress={saveFinal} className="self-start mb-3" />
      <Button testID="req-call" icon="phone" title={t('push.call')} variant="soft" onPress={() => Linking.openURL(`tel:${r.whatsapp.replace(/[^\d+]/g, '')}`)} className="mb-2" />
      <Button testID="req-wa" icon="whatsapp" title={t('admin.req.openWa')} variant="ink" onPress={open} className="mb-2" />
      <View className="flex-row gap-2.5">
        <Button testID="req-processing" title={t('admin.req.markProcessing')} variant="soft" className="flex-1" disabled={r.status === 'processing'} onPress={() => set('processing')} />
        <Button testID="req-delivered" title={t('admin.req.markDelivered')} className="flex-1" disabled={r.status === 'delivered'} onPress={() => set('delivered', final ? { finalResult: final } : {})} />
      </View>
      <Button testID="req-delete" icon="trash-can-outline" title={t('common.delete')} variant="ghost" className="mt-3" onPress={() => onDelete(r.id)} />
      <RequestViewer r={r} index={shot} onIndex={setShot} onClose={() => setShot(null)} />
    </Sheet>
  );
}

export default function Requests() {
  const { t } = useT();
  const { desktop } = useBp();
  const s = useStore();
  const [open, setOpen] = useViewState<string | null>('open', null);
  const [filter, setFilter] = useViewState<RequestStatus | 'all'>('filter', 'all');
  const [preview, setPreview] = React.useState<string | null>(null);
  // Select mode: off by default so the list stays clean; one button turns it on, a bar at the bottom does the rest.
  const [picking, setPicking] = React.useState(false);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [toDelete, setToDelete] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const previewRow = s.requests.find((x) => x.id === preview);
  const { target, open: requestedOpen, call } = useLocalSearchParams<{ target?: string; open?: string; call?: string }>();
  useFocusEffect(React.useCallback(() => {
    if (backendEnabled) void useStore.getState().reload('requests');
  }, []));
  const openedNotification = React.useRef('');
  React.useEffect(() => {
    if (requestedOpen && openedNotification.current !== requestedOpen && s.requests.some(row => row.id === requestedOpen)) { openedNotification.current = requestedOpen; setOpen(requestedOpen); }
  }, [requestedOpen, s.requests, setOpen]);
  const rows = [...s.requests].sort((a, b) => b.createdAt - a.createdAt).filter((r) => r.id === target || filter === 'all' || r.status === filter);
  const togglePick = (id: string) => setPicked((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  const stopPicking = () => { setPicking(false); setPicked([]); };
  const confirmDelete = async () => {
    const ids = toDelete || [];
    setToDelete(null);
    if (!ids.length) return;
    setBusy(true);
    try {
      await s.removeMany('requests', ids);
      setPicked((old) => old.filter((x) => !ids.includes(x)));
      if (open && ids.includes(open)) setOpen(null);
      toast(t('admin.req.deletedToast', { count: ids.length }));
    } catch { toast(t('admin.crud.error')); } finally { setBusy(false); }
  };
  const menuOf = (r: RenderRequest): MenuItem[] => {
    const mark = async (status: RequestStatus) => {
      await s.update('requests', r.id, { status });
      if (status === 'delivered') toast(t('admin.req.deliveredToast')); else toast(t('admin.crud.saved'));
    };
    const copy = () => { try { void (globalThis as any).navigator?.clipboard?.writeText(r.whatsapp); toast(t('ax.copied')); } catch { /* clipboard unavailable */ } };
    return [
      { key: 'open', label: t('admin.req.details'), icon: 'pencil-outline', onPress: () => setOpen(r.id) },
      { key: 'processing', label: t('admin.req.markProcessing'), icon: 'progress-clock', disabled: r.status === 'processing', onPress: () => mark('processing') },
      { key: 'delivered', label: t('admin.req.markDelivered'), icon: 'check-circle-outline', disabled: r.status === 'delivered', onPress: () => mark('delivered') },
      sep('s1'),
      { key: 'wa', label: t('admin.req.openWa'), icon: 'whatsapp', onPress: () => Linking.openURL(waLink(r.whatsapp, t('admin.req.waMsg', { name: r.name }))) },
      { key: 'call', label: t('push.call'), icon: 'phone', onPress: () => Linking.openURL(`tel:${r.whatsapp.replace(/[^\d+]/g, '')}`) },
      { key: 'copy', label: t('ax.copyNumber'), icon: 'content-copy', onPress: copy },
      sep('s2'),
      { key: 'select', label: t('common.select'), icon: 'checkbox-marked-circle-outline', onPress: () => { setPicking(true); setPicked([r.id]); } },
      { key: 'delete', label: t('common.delete'), icon: 'trash-can-outline', danger: true, onPress: () => setToDelete([r.id]) },
    ];
  };
  const { draft: settings, patch } = useDraftDoc('settings');
  const auto = settings.autoSendWhatsApp;
  return (
    <AdminPage title={t('admin.req.title')}
      floating={picking ? (
        <Card testID="req-bulk-bar" className="px-3 py-2.5 rounded-full flex-row items-center gap-2" style={{ boxShadow: '0 8px 30px rgba(0,0,0,0.18)' } as any}>
          <View className="bg-primary rounded-full min-w-[28px] h-7 px-2 items-center justify-center"><Txt className="text-onprimary font-bold text-[13px]">{picked.length}</Txt></View>
          <Pressable testID="req-select-all" accessibilityRole="button" onPress={() => setPicked(picked.length === rows.length ? [] : rows.map((r) => r.id))} className="px-2 h-9 justify-center"><Txt className="font-semibold text-[13px]">{picked.length === rows.length && rows.length ? t('ax.deselect') : t('common.all')}</Txt></Pressable>
          <View className="flex-1" />
          <Button testID="req-bulk-delete" size="sm" icon="trash-can-outline" title={t('common.delete')} variant="ghost" disabled={!picked.length || busy} onPress={() => setToDelete(picked)} />
          <Button testID="req-bulk-done" size="sm" title={t('common.done')} variant="soft" onPress={stopPicking} />
        </Card>
      ) : undefined}>
      <PushNotifications />
      {typeof call === 'string' && /^\+?\d{6,20}$/.test(call) ? <Button testID="push-call-fallback" title={t('push.call')} icon="phone" onPress={() => Linking.openURL(`tel:${call}`)} className="mb-3" /> : null}
      <SettingAnchor id="autoWhatsApp"><Card className="p-4 mb-4 flex-row items-center gap-3">
        <View className="flex-1"><Txt className="font-bold text-[14px]">{t('admin.req.autoSend')}</Txt><Txt className="text-muted text-[12px] leading-[20px] mt-2">{t('admin.req.autoSendNote')}</Txt></View>
        <Toggle testID="req-auto" label={t('admin.req.autoSend')} value={auto} onValueChange={(v) => patch({ autoSendWhatsApp: v })} />
      </Card></SettingAnchor>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {(['all', ...STATUSES] as const).map((k) => (
          <Pressable key={k} testID={`filter-${k}`} onPress={() => setFilter(k)} className={`px-3.5 h-9 rounded-full justify-center ${filter === k ? 'bg-primary' : 'bg-surface2'}`}>
            <Txt className={`text-[13px] font-semibold ${filter === k ? 'text-onprimary' : ''}`}>{k === 'all' ? t('common.select') : t(`admin.enums.${k}`)}{k !== 'all' ? ` · ${s.requests.filter((r) => r.status === k).length}` : ''}</Txt>
          </Pressable>
        ))}
        {rows.length ? <Pressable testID="req-select-mode" accessibilityRole="button" accessibilityState={{ selected: picking }} onPress={() => (picking ? stopPicking() : setPicking(true))} className={`px-3.5 h-9 rounded-full justify-center flex-row items-center gap-1.5 ms-auto border ${picking ? 'border-primary' : 'border-line'}`}><Icon name="checkbox-marked-circle-outline" size={16} tone={picking ? 'primary' : 'muted'} /><Txt className="text-[13px] font-semibold">{t('common.select')}</Txt></Pressable> : null}
      </View>
      {!s.adminLoaded && !rows.length ? <AdminLoading /> : !rows.length ? <EmptyState icon="inbox-outline" title={t('admin.crud.noItems')} /> : (
        <Card className="overflow-hidden">
          {desktop ? (
            <View className="flex-row items-center px-4 h-10 bg-surface2">
              {[['photo', 0.6], ['name', 1.2], ['whatsapp', 1.1], ['choices', 2], ['date', 0.9], ['status', 0.9]].map(([k, f]) => <Txt key={k as string} className="text-muted text-[12px] font-bold uppercase" style={{ flex: f as number }}>{t(`admin.f.${k}`)}</Txt>)}
              <View style={{ width: 90 }} />
            </View>
          ) : null}
          {rows.map((r) => (
            <SearchTarget key={r.id} id={r.id}><RightClick items={() => menuOf(r)}><Pressable testID={`req-${r.id}`} onPress={() => (picking ? togglePick(r.id) : setOpen(r.id))} className={`px-4 py-3 border-t border-line active:bg-surface2 flex-row items-center gap-3 ${picked.includes(r.id) ? 'bg-surface2' : ''}`}>
              {picking ? <Icon name={picked.includes(r.id) ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} tone={picked.includes(r.id) ? 'primary' : 'muted'} /> : null}
              <Thumb r={r} onOpen={() => setPreview(r.id)} />
              {desktop ? (<>
                <Txt className="font-bold" style={{ flex: 1.2 }} numberOfLines={1}>{r.name}</Txt>
                <Txt className="text-muted text-[13px]" style={{ flex: 1.1 }}>{r.whatsapp}</Txt>
                <View style={{ flex: 2 }} className="pe-3"><Choices r={r} /></View>
                <Txt className="text-muted text-[13px]" style={{ flex: 0.9 }}>{new Date(r.createdAt).toLocaleDateString()}</Txt>
                <View style={{ flex: 0.9 }}><Badge s={r.status} /></View>
                <View style={{ width: 90 }} className="items-end"><Icon name="chevron-right" flip /></View>
              </>) : (
                <View className="flex-1 gap-2" style={{ minWidth: 0 }}>
                  <Txt className="font-bold text-[15px] leading-[23px]">{r.name}</Txt>
                  <Txt className="text-muted text-[13px] leading-[20px]" style={{ writingDirection: 'ltr', textAlign: 'left' }}>{r.whatsapp}</Txt>
                  <View className="flex-row flex-wrap items-center gap-3"><Badge s={r.status} /><Txt className="text-muted text-[12px] leading-[18px]">{new Date(r.createdAt).toLocaleDateString()}</Txt></View>
                  <Choices r={r} />
                </View>
              )}
            </Pressable></RightClick></SearchTarget>
          ))}
        </Card>
      )}
      <Detail id={open} onClose={() => setOpen(null)} onDelete={(id) => setToDelete([id])} />
      <ConfirmSheet visible={!!toDelete} onClose={() => setToDelete(null)} message={t('admin.req.deleteConfirm', { count: toDelete?.length || 0 })} confirmLabel={t('common.delete')} cancelLabel={t('common.cancel')} onConfirm={() => { void confirmDelete(); }} />
      {previewRow ? <RequestViewer r={previewRow} index={previewRow.photoUri ? 0 : 0} onClose={() => setPreview(null)} /> : null}
    </AdminPage>
  );
}
