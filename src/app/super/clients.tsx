import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { Toggle } from '@/components/ui/Toggle';
import { Initials } from '@/components/admin/dashboard/Kit';
import { Card2, Chips, Loading, Pill, SuperPage, useFail, usePlainDate } from '@/components/super/ui';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { errorKey } from '@/store/useSuper';
import { superApi, type SuperClient, type Tenant } from '@/lib/superApi';

const PAGE = 25;

export default function ClientsPage() {
  const { t } = useT();
  const fail = useFail();
  const fmt = usePlainDate();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<SuperClient[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);
  const [edit, setEdit] = useState<{ c: SuperClient; credits: string; blocked: boolean } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const seq = useRef(0);

  useEffect(() => { superApi<Tenant[]>('/tenants').then(setTenants).catch(() => undefined); }, []);
  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(id); }, [q]);

  const query = (offset: number) => `/clients?limit=${PAGE}&offset=${offset}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ''}${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`;
  const load = async (reset = true) => {
    const mine = ++seq.current;
    try {
      const r = await superApi<{ total: number; items: SuperClient[] }>(query(reset ? 0 : items?.length || 0));
      if (mine !== seq.current) return;
      setItems((cur) => (reset || !cur ? r.items : [...cur, ...r.items])); setTotal(r.total); setError(null);
    } catch (e) { if (mine === seq.current) setError(e); }
    finally { if (mine === seq.current) setMore(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(true); }, [tenantId, debounced]);

  const tenantName = (id: string) => tenants.find((x) => x.id === id)?.name || id;
  const close = () => { setEdit(null); setConfirm(false); setErr(''); };
  const save = async () => {
    if (!edit || busy) return;
    const credits = Number(edit.credits.replace(/[^\d]/g, '') || 0);
    setBusy(true); setErr('');
    try { await superApi(`/clients/${edit.c.id}`, { method: 'PATCH', body: { credits, blocked: edit.blocked } }); toast(t('sx.c.saved')); close(); await load(true); }
    catch (e) { const key = errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!edit) return;
    setBusy(true);
    try { await superApi(`/clients/${edit.c.id}`, { method: 'DELETE' }); toast(t('sx.c.deleted')); close(); await load(true); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <SuperPage title={t('sx.cl.title')} sub={t('sx.cl.sub')}>
      <View style={{ marginBottom: 12 }}><Input testID="client-search" tight placeholder={t('sx.cl.search')} value={q} onChangeText={setQ} autoCapitalize="none" /></View>
      {tenants.length > 1 ? <View style={{ marginBottom: 14 }}><Chips testID="client-tenant" options={[{ key: '', label: t('sx.ad.allTenants') }, ...tenants.map((x) => ({ key: x.id, label: x.name }))]} value={tenantId} onChange={setTenantId} /></View> : null}

      {!items ? <Loading error={error} onRetry={() => load(true)} /> : items.length === 0 ? (
        <EmptyState icon="account-group-outline" title={debounced || tenantId ? t('sx.c.noResult') : t('sx.cl.empty')} />
      ) : (
        <View style={{ gap: 10 }}>
          <Txt className="text-muted text-[12px] font-bold">{t('sx.c.total', { n: fmt.num(total) })}</Txt>
          {items.map((c) => (
            <Card2 key={c.id} testID={`client-row-${c.id}`} onPress={() => { setErr(''); setEdit({ c, credits: String(c.credits), blocked: c.blocked }); }} dim={c.blocked}>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <Initials name={c.name || '?'} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                    <Txt numberOfLines={1} className="font-extrabold text-[15px]">{c.name}</Txt>
                    {c.blocked ? <Pill label={t('sx.cl.blocked')} tone="danger" /> : null}
                  </View>
                  <Txt numberOfLines={1} className="text-muted text-[12px] mt-0.5">{c.whatsapp} · {tenantName(c.tenantId)}</Txt>
                </View>
                <View className="items-end">
                  <Txt className="font-black text-[16px]">{fmt.num(c.credits)}</Txt>
                  <Txt className="text-muted text-[10px] font-bold uppercase">{t('sx.cl.credits')}</Txt>
                </View>
              </View>
            </Card2>
          ))}
          {items.length < total ? <Button testID="client-more" variant="soft" title={t('sx.c.more')} loading={more} onPress={() => { setMore(true); void load(false); }} full /> : null}
        </View>
      )}

      <Sheet visible={!!edit && !confirm} onClose={close} title={edit?.c.name}
        footer={edit ? (
          <View>
            {err ? <Txt testID="client-error" accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
            <View className="flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={close} full /></View>
              <View style={{ flex: 1 }}><Button testID="client-save" title={t('sx.c.save')} loading={busy} onPress={save} full /></View>
            </View>
          </View>
        ) : undefined}>
        {edit ? (
          <View>
            <Txt className="text-muted text-[12px] mb-3">{edit.c.whatsapp} · {tenantName(edit.c.tenantId)} · {t('sx.cl.seen')}: {fmt.dateTime(edit.c.lastSeen)}</Txt>
            <Input testID="client-credits" label={t('sx.cl.credits')} value={edit.credits} onChangeText={(v) => setEdit({ ...edit, credits: v.replace(/[^\d]/g, '') })} keyboardType="number-pad" />
            <View className="flex-row items-center justify-between mb-4"><Txt className="font-semibold text-[14px]">{t('sx.cl.block')}</Txt><Toggle testID="client-blocked" value={edit.blocked} onValueChange={(v) => setEdit({ ...edit, blocked: v })} label={t('sx.cl.block')} /></View>
            <Button testID="client-delete" size="sm" variant="danger" icon="delete-outline" title={t('sx.c.delete')} onPress={() => setConfirm(true)} />
          </View>
        ) : null}
      </Sheet>
      <Sheet visible={confirm && !!edit} onClose={() => setConfirm(false)}>
        <Txt className="text-[15px] leading-[22px] font-bold text-center mb-3 mt-1">{t('sx.cl.deleteConfirm', { name: edit?.c.name })}</Txt>
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setConfirm(false)} full /></View>
          <View style={{ flex: 1 }}><Button testID="client-delete-confirm" variant="danger" title={t('sx.c.delete')} loading={busy} onPress={remove} full /></View>
        </View>
      </Sheet>
    </SuperPage>
  );
}
