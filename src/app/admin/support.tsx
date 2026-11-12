import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { useT } from '@/i18n';
import { api, backendEnabled } from '@/lib/backend';
import { toast } from '@/store/useToast';

type Kind = 'support' | 'customize' | 'credits' | 'api' | 'manage';
type Instance = { kind: string; credits: { limit: number | null; used: number; left: number | null }; apiMode: 'own' | 'platform' };
type Item = { id: string; kind: string; title: string; body: string; status: 'open' | 'in_progress' | 'done' | 'rejected'; response: string; createdAt: number };
const KINDS: Kind[] = ['support', 'credits', 'api', 'customize'];
const KIND_KEY: Record<string, string> = { support: 'kindSupport', credits: 'kindCredits', api: 'kindApi', customize: 'kindCustomize', manage: 'kindManage' };

/** Credits left + who manages the AI keys + a form to write to the platform team + the history of replies. */
export default function Support() {
  const { t } = useT();
  const [info, setInfo] = useState<Instance | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [kind, setKind] = useState<Kind>('support');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!backendEnabled) { setItems([]); return; }
    const [i, r] = await Promise.all([api<Instance>('/admin/instance').catch(() => null), api<Item[]>('/admin/change-requests').catch(() => [] as Item[])]);
    setInfo(i); setItems(r);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const demo = info?.kind === 'demo';
  const send = async () => {
    setBusy(true);
    try {
      await api('/admin/change-requests', { method: 'POST', body: { kind, title: title.trim(), body: body.trim() } });
      setTitle(''); setBody(''); toast(t('sp.sent')); await load();
    } catch { toast(t('sp.failed')); } finally { setBusy(false); }
  };

  const limit = info?.credits.limit ?? null;
  const used = info?.credits.used ?? 0;
  const ratio = limit == null ? 0 : limit === 0 ? 1 : Math.min(1, used / limit);
  const tone = ratio >= 1 ? 'bg-danger' : 'bg-primary';

  if (!items) return <AdminPage title={t('admin.nav.support')}><AdminLoading /></AdminPage>;
  return (
    <AdminPage title={t('admin.nav.support')} max={760}>
      <Txt className="text-muted mb-4">{t('sp.intro')}</Txt>

      {info && !demo ? (
        <Card className="p-4 mb-4" style={{ gap: 10 }}>
          <View className="flex-row items-center" style={{ gap: 8 }}><Icon name="star-circle-outline" size={20} tone="muted" /><Txt className="font-extrabold">{t('sp.creditsTitle')}</Txt></View>
          <Txt testID="support-credits" className="font-bold">{limit == null ? t('sp.creditsUnlimited', { used }) : t('sp.creditsLine', { used, limit })}</Txt>
          {limit != null ? <View className="bg-surface2 rounded-full overflow-hidden" style={{ height: 8 }}><View className={`${tone} rounded-full`} style={{ height: 8, width: `${Math.round(ratio * 100)}%` }} /></View> : null}
          {ratio >= 1 ? <Txt testID="support-credits-out" className="text-danger text-[13px]">{t('sp.creditsOut')}</Txt> : ratio >= 0.8 ? <Txt className="text-muted text-[13px]">{t('sp.creditsLow')}</Txt> : null}
          <View className="flex-row items-center" style={{ gap: 8, marginTop: 6 }}><Icon name="robot-outline" size={20} tone="muted" /><Txt className="font-extrabold">{t('sp.apiTitle')}</Txt></View>
          <Txt testID="support-api-mode" className="text-muted text-[13px]">{info.apiMode === 'platform' ? t('sp.apiPlatform') : t('sp.apiOwn')}</Txt>
        </Card>
      ) : null}

      {demo ? <Card className="p-4 mb-4"><Txt className="text-muted">{t('sp.demo')}</Txt></Card> : (
        <Card className="p-4 mb-4" style={{ gap: 12 }}>
          <Txt className="font-extrabold">{t('sp.newTitle')}</Txt>
          <Segmented<Kind> testID="support-kind" value={kind} onChange={setKind} options={KINDS.map((k) => ({ key: k, label: t(`sp.${KIND_KEY[k]}`) }))} />
          <Input testID="support-title" label={t('sp.subject')} value={title} onChangeText={setTitle} maxLength={120} />
          <Input testID="support-body" label={t('sp.message')} value={body} onChangeText={setBody} multiline maxLength={4000} style={{ minHeight: 100, textAlignVertical: 'top' }} />
          <Button testID="support-send" title={t('sp.send')} icon="send-outline" loading={busy} disabled={title.trim().length < 3 || body.trim().length < 3} onPress={send} />
        </Card>
      )}

      <Txt className="font-extrabold mb-2">{t('sp.history')}</Txt>
      {!items.length ? <Txt testID="support-empty" className="text-muted">{t('sp.empty')}</Txt> : items.map((r) => (
        <Card key={r.id} testID="support-item" className="p-4 mb-2.5" style={{ gap: 6 }}>
          <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
            <Txt className="font-bold flex-1" numberOfLines={2}>{r.title}</Txt>
            <View className="bg-surface2 rounded-full px-2.5 py-0.5"><Txt className="text-[11px] font-extrabold">{t(`sp.${r.status}`)}</Txt></View>
          </View>
          <Txt className="text-muted text-[12px]">{t(`sp.${KIND_KEY[r.kind] || 'kindSupport'}`)} · {new Date(r.createdAt).toLocaleDateString()}</Txt>
          <Txt className="text-[13px]">{r.body}</Txt>
          {r.response ? <View className="bg-soft rounded-xl p-3"><Txt className="text-[11px] font-extrabold text-primary mb-1">{t('sp.reply')}</Txt><Txt className="text-[13px]">{r.response}</Txt></View> : null}
        </Card>
      ))}
    </AdminPage>
  );
}
