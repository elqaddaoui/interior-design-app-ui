import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { Initials, Panel } from '@/components/admin/dashboard/Kit';
import { saApi, type SaClient } from '@/lib/superadmin';
import { BackendError } from '@/lib/backend';
import { toast } from '@/store/useToast';
import { Choice, Empty, Pill, RowBtn, SaPage, SearchBox, useSa } from './ui';
import { Spinner } from '@/components/ui/Spinner';

type Page = { total: number; page: number; size: number; items: SaClient[] };
type Filter = 'all' | 'active' | 'blocked';
const SIZE = 20;

export function SaClients() {
  const { t, err, ago, date } = useSa();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [credits, setCredits] = useState<{ client: SaClient; value: string } | null>(null);
  const [remove, setRemove] = useState<SaClient | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { const h = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(h); }, [search]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    saApi<Page>(`/clients?q=${encodeURIComponent(query)}&status=${status}&page=${page}&size=${SIZE}`)
      .then((r) => { if (live) { setData(r); setFailed(false); } })
      .catch((e) => { if (live && !(e instanceof BackendError && e.status === 401)) setFailed(true); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, status, page, tick]);
  const reload = () => setTick((n) => n + 1);

  const pages = data ? Math.max(1, Math.ceil(data.total / SIZE)) : 1;
  const patch = async (c: SaClient, body: Record<string, unknown>) => {
    try { await saApi(`/clients/${encodeURIComponent(c.id)}`, { method: 'PATCH', body }); toast(t('saved')); reload(); return true; } catch (e) { toast(err(e)); return false; }
  };
  const saveCredits = async () => {
    if (!credits) return;
    setBusy(true);
    if (await patch(credits.client, { credits: Number(credits.value || 0) })) setCredits(null);
    setBusy(false);
  };
  const doRemove = async () => {
    if (!remove) return;
    try { await saApi(`/clients/${encodeURIComponent(remove.id)}`, { method: 'DELETE' }); toast(t('saved')); reload(); } catch (e) { toast(err(e)); }
    setRemove(null);
  };

  return (
    <SaPage title={t('clientsTitle')} sub={t('clientsSub')} right={data ? <Pill testID="sa-clients-total" icon="account-group-outline" label={t('total', { n: data.total })} /> : undefined}>
      <View className="flex-row flex-wrap items-center" style={{ gap: 10 }}>
        <SearchBox testID="sa-client-search" value={search} onChangeText={setSearch} placeholder={t('clientSearch')} />
      </View>
      <Choice testID="sa-client-filter" value={status} onChange={(s) => { setStatus(s); setPage(1); }} options={[{ key: 'all', label: t('all') }, { key: 'active', label: t('fActive') }, { key: 'blocked', label: t('fBlocked') }]} />

      {!data && loading ? <View className="items-center py-16"><Spinner size={44} /></View> : failed && !data ? (
        <Panel><View className="items-center" style={{ gap: 10 }}><Txt className="text-[14px] font-semibold">{t('loadFailed')}</Txt><Button size="sm" variant="soft" icon="refresh" title={t('retry')} onPress={reload} /></View></Panel>
      ) : data && data.items.length === 0 ? <Empty text={t('empty')} /> : (
        <View style={{ gap: 10, opacity: loading ? 0.6 : 1 }}>
          {data?.items.map((c) => (
            <Panel key={c.id} testID={`sa-client-${c.id}`}>
              <View className="flex-row flex-wrap items-center" style={{ gap: 12 }}>
                <View className="flex-row items-center" style={{ gap: 12, flexGrow: 1, flexBasis: 260, minWidth: 0 }}>
                  <Initials name={c.name || c.whatsapp} size={42} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt className="text-[15px] font-extrabold" numberOfLines={1}>{c.name || c.whatsapp}</Txt>
                    <Txt className="text-muted text-[12.5px]" numberOfLines={1}>{c.whatsapp}</Txt>
                    <Txt className="text-muted text-[12px]" numberOfLines={1}>{t('cJoined', { date: date(c.createdAt) })}{c.lastSeen ? ` · ${t('cSeen', { when: ago(c.lastSeen) })}` : ''}</Txt>
                  </View>
                </View>
                <View className="flex-row flex-wrap items-center" style={{ gap: 6, flexGrow: 1, flexBasis: 160 }}>
                  <Pill tone="primary" icon="ticket-outline" label={t('cCredits', { n: c.credits })} />
                  <Pill label={t('cDesigns', { n: c.designs })} />
                  {c.blocked ? <Pill tone="danger" label={t('blocked')} /> : null}
                </View>
                <View className="flex-row" style={{ gap: 8 }}>
                  <RowBtn testID={`sa-client-credits-${c.id}`} icon="ticket-outline" label={t('setCredits')} onPress={() => setCredits({ client: c, value: String(c.credits) })} />
                  <RowBtn testID={`sa-client-block-${c.id}`} icon={c.blocked ? 'account-check-outline' : 'account-cancel-outline'} label={t(c.blocked ? 'unblock' : 'block')} onPress={() => patch(c, { blocked: !c.blocked })} />
                  <RowBtn testID={`sa-client-delete-${c.id}`} icon="trash-can-outline" tone="danger" label={t('remove')} onPress={() => setRemove(c)} />
                </View>
              </View>
            </Panel>
          ))}
          {pages > 1 ? (
            <View className="flex-row items-center justify-center" style={{ gap: 12 }}>
              <Button size="sm" variant="soft" icon="chevron-left" title={t('prev')} disabled={page <= 1} onPress={() => setPage(page - 1)} testID="sa-clients-prev" />
              <Txt className="text-[13px] font-bold text-muted">{t('pageOf', { p: page, n: pages })}</Txt>
              <Button size="sm" variant="soft" icon="chevron-right" title={t('next')} disabled={page >= pages} onPress={() => setPage(page + 1)} testID="sa-clients-next" />
            </View>
          ) : null}
        </View>
      )}

      <Sheet visible={!!credits} onClose={() => setCredits(null)} title={t('setCredits')}
        footer={<Button full variant="ink" title={t('save')} onPress={saveCredits} loading={busy} testID="sa-credits-save" />}>
        {credits ? <Input testID="sa-credits-input" label={`${credits.client.name || credits.client.whatsapp} · ${t('creditsAmount')}`} value={credits.value} onChangeText={(v) => setCredits({ ...credits, value: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" /> : null}
      </Sheet>
      <ConfirmSheet visible={!!remove} onClose={() => setRemove(null)} onConfirm={doRemove} message={remove ? `${t('deleteClient')} ${t('deleteClientBody', { name: remove.name || remove.whatsapp })}` : ''} confirmLabel={t('remove')} cancelLabel={t('cancel')} />
    </SaPage>
  );
}
