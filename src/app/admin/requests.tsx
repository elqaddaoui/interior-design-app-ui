import { SearchTarget, useViewState } from '@/hooks/useViewState';
import React from 'react';
import { Linking, Pressable, View } from 'react-native';
import { Button, Card, EmptyState, Icon, MediaView, Sheet, Toggle, Txt } from '@/components/ui';
import { AdminPage } from '@/components/admin/AdminShell';
import { ImageField } from '@/components/admin/ImageField';
import { useBp } from '@/hooks/useBp';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import { waLink } from '@/lib/share';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { requestLeave, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useLocalSearchParams } from 'expo-router';
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
  const parts = [
    s.tools.find((x) => x.id === d.toolId) && L(s.tools.find((x) => x.id === d.toolId)!.title),
    d.roomTypeId && L(s.roomTypes.find((x) => x.id === d.roomTypeId)?.title),
    d.styleId && L(s.styles.find((x) => x.id === d.styleId)?.title),
    d.mode, d.paletteId && L(s.palettes.find((x) => x.id === d.paletteId)?.title),
    d.modelId && s.models.find((x) => x.id === d.modelId)?.name,
  ].filter(Boolean) as string[];
  return <Txt className="text-muted text-[13px] leading-[21px]" aria-label={t('admin.f.choices')}>{parts.join(' · ') || '—'}</Txt>;
}

function Detail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const s = useStore();
  const { t } = useT();
  const r = s.requests.find((x) => x.id === id);
  const [final, setFinal] = useViewState('final', '');
  const record = React.useRef(id);
  React.useEffect(() => { if (record.current !== id) { record.current = id; setFinal(r?.finalResult ?? ''); } }, [id, r?.finalResult, setFinal]);
  const dirty = !!r && final !== (r.finalResult ?? '');
  const saveDraft = async () => { if (r) await s.update('requests', r.id, { finalResult: final }); };
  useLeaveGuard(dirty, saveDraft, () => { setFinal(r?.finalResult ?? ''); onClose(); });
  const close = () => requestLeave(onClose);
  if (!r) return <Sheet visible={false} onClose={onClose}><View /></Sheet>;
  const set = async (status: RequestStatus, extra: Partial<RenderRequest> = {}) => {
    await s.update('requests', r.id, { status, ...extra });
    if (status === 'delivered') {
      const out = extra.finalResult ?? r.finalResult ?? r.aiResult;
      if (r.historyId && out) await s.update('history', r.historyId, { after: out, status: 'done' });
      toast(t('admin.req.deliveredToast'));
    }
  };
  const saveFinal = async () => { await s.update('requests', r.id, { finalResult: final }); toast(t('admin.crud.saved')); };
  const open = () => Linking.openURL(waLink(r.whatsapp, t('admin.req.waMsg', { name: r.name })));
  return (
    <Sheet visible={!!id} onClose={close} title={t('admin.req.details')} wide>
      <View className="flex-row items-center justify-between mb-3"><View><Txt className="text-[18px] font-extrabold">{r.name}</Txt><Txt className="text-muted">{r.whatsapp}</Txt></View><Badge s={r.status} /></View>
      <Choices r={r} />
      <View className="flex-row gap-3 mt-4">
        <View className="flex-1"><Txt className="text-[12px] font-semibold text-muted mb-1.5">{t('admin.f.photo')}</Txt><MediaView uri={r.photoUri} className="rounded-xl" style={{ aspectRatio: 1 }} /></View>
        <View className="flex-1"><Txt className="text-[12px] font-semibold text-muted mb-1.5">{t('admin.f.aiResult')}</Txt><MediaView uri={r.aiResult} className="rounded-xl" style={{ aspectRatio: 1 }} /></View>
      </View>
      <View className="mt-4"><ImageField label={t('admin.req.uploadFinal')} value={final} onChange={setFinal} /></View>
      <Button title={t('common.save')} variant="soft" size="sm" onPress={saveFinal} className="self-start mb-4" />
      <Button testID="req-wa" icon="whatsapp" title={t('admin.req.openWa')} variant="ink" onPress={open} className="mb-3" />
      <View className="flex-row gap-3">
        <Button testID="req-processing" title={t('admin.req.markProcessing')} variant="soft" className="flex-1" disabled={r.status === 'processing'} onPress={() => set('processing')} />
        <Button testID="req-delivered" title={t('admin.req.markDelivered')} className="flex-1" disabled={r.status === 'delivered'} onPress={() => set('delivered', final ? { finalResult: final } : {})} />
      </View>
    </Sheet>
  );
}

export default function Requests() {
  const { t } = useT();
  const { desktop } = useBp();
  const s = useStore();
  const [open, setOpen] = useViewState<string | null>('open', null);
  const [filter, setFilter] = useViewState<RequestStatus | 'all'>('filter', 'all');
  const { target } = useLocalSearchParams<{ target?: string }>();
  const rows = [...s.requests].sort((a, b) => b.createdAt - a.createdAt).filter((r) => r.id === target || filter === 'all' || r.status === filter);
  const { draft: settings, patch } = useDraftDoc('settings');
  const auto = settings.autoSendWhatsApp;
  return (
    <AdminPage title={t('admin.req.title')}>
      <Card className="p-4 mb-4 flex-row items-center gap-3">
        <View className="flex-1"><Txt className="font-bold text-[14px]">{t('admin.req.autoSend')}</Txt><Txt className="text-muted text-[12px] leading-[20px] mt-2">{t('admin.req.autoSendNote')}</Txt></View>
        <Toggle testID="req-auto" label={t('admin.req.autoSend')} value={auto} onValueChange={(v) => patch({ autoSendWhatsApp: v })} />
      </Card>
      <View className="flex-row flex-wrap gap-2 mb-4">
        {(['all', ...STATUSES] as const).map((k) => (
          <Pressable key={k} testID={`filter-${k}`} onPress={() => setFilter(k)} className={`px-3.5 h-9 rounded-full justify-center ${filter === k ? 'bg-primary' : 'bg-surface2'}`}>
            <Txt className={`text-[13px] font-semibold ${filter === k ? 'text-onprimary' : ''}`}>{k === 'all' ? t('common.select') : t(`admin.enums.${k}`)}{k !== 'all' ? ` · ${s.requests.filter((r) => r.status === k).length}` : ''}</Txt>
          </Pressable>
        ))}
      </View>
      {!rows.length ? <EmptyState icon="inbox-outline" title={t('admin.crud.noItems')} /> : (
        <Card className="overflow-hidden">
          {desktop ? (
            <View className="flex-row items-center px-4 h-10 bg-surface2">
              {[['photo', 0.6], ['name', 1.2], ['whatsapp', 1.1], ['choices', 2], ['date', 0.9], ['status', 0.9]].map(([k, f]) => <Txt key={k as string} className="text-muted text-[12px] font-bold uppercase" style={{ flex: f as number }}>{t(`admin.f.${k}`)}</Txt>)}
              <View style={{ width: 90 }} />
            </View>
          ) : null}
          {rows.map((r) => (
            <SearchTarget key={r.id} id={r.id}><Pressable testID={`req-${r.id}`} onPress={() => setOpen(r.id)} className="px-4 py-3 border-t border-line active:bg-surface2 flex-row items-center gap-3">
              <MediaView uri={r.aiResult || r.photoUri} className="rounded-lg" style={{ width: 48, height: 48 }} />
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
            </Pressable></SearchTarget>
          ))}
        </Card>
      )}
      <Detail id={open} onClose={() => setOpen(null)} />
    </AdminPage>
  );
}
