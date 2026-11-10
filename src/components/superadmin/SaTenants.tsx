import React, { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Panel } from '@/components/admin/dashboard/Kit';
import { useSuperData } from '@/hooks/useSuperData';
import { saApi, type SaTenant } from '@/lib/superadmin';
import { toast } from '@/store/useToast';
import { Choice, Empty, Grid, Loaded, Pill, RowBtn, SaPage, useSa } from './ui';

type Plan = SaTenant['plan'];
type Status = SaTenant['status'];
type Draft = { id?: string; name: string; plan: Plan; status: Status; contactEmail: string; notes: string; maxAdmins: string };
const PLANS: Plan[] = ['free', 'starter', 'pro', 'enterprise'];
const STATUSES: Status[] = ['active', 'trial', 'suspended'];
const blank = (): Draft => ({ name: '', plan: 'free', status: 'active', contactEmail: '', notes: '', maxAdmins: '' });

export function SaTenants() {
  const { t, err, date } = useSa();
  const q = useSuperData<{ tenants: SaTenant[] }>('/tenants');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<SaTenant | null>(null);
  const [suspend, setSuspend] = useState<SaTenant | null>(null);

  const open = (x?: SaTenant) => { setError(''); setDraft(x ? { id: x.id, name: x.name, plan: x.plan, status: x.status, contactEmail: x.contactEmail, notes: x.notes, maxAdmins: x.maxAdmins == null ? '' : String(x.maxAdmins) } : blank()); };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const body = { name: draft.name, plan: draft.plan, status: draft.status, contactEmail: draft.contactEmail, notes: draft.notes, maxAdmins: draft.maxAdmins.trim() === '' ? null : Number(draft.maxAdmins) };
      await saApi(draft.id ? `/tenants/${encodeURIComponent(draft.id)}` : '/tenants', { method: draft.id ? 'PATCH' : 'POST', body });
      toast(t('saved')); setDraft(null); q.reload();
    } catch (e) { setError(err(e)); }
    setBusy(false);
  };
  const setStatus = async (x: SaTenant, status: Status) => {
    try { await saApi(`/tenants/${encodeURIComponent(x.id)}`, { method: 'PATCH', body: { status } }); toast(t('saved')); q.reload(); } catch (e) { toast(err(e)); }
  };
  const doRemove = async () => {
    if (!remove) return;
    try { await saApi(`/tenants/${encodeURIComponent(remove.id)}`, { method: 'DELETE' }); toast(t('saved')); q.reload(); } catch (e) { toast(err(e)); }
    setRemove(null);
  };

  return (
    <SaPage title={t('tenantsTitle')} sub={t('tenantsSub')} right={<Button icon="plus" title={t('addTenant')} onPress={() => open()} testID="sa-add-tenant" />}>
      <Loaded q={q}>
        {(d) => d.tenants.length === 0 ? <Empty icon="domain" text={t('empty')} /> : (
          <Grid min={340}>
            {d.tenants.map((x) => (
              <Panel key={x.id} testID={`sa-tenant-${x.id}`} fill>
                <View className="flex-row items-start" style={{ gap: 10 }}>
                  <View className="w-10 h-10 rounded-2xl bg-soft items-center justify-center"><Icon name="domain" size={20} tone="fg" /></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt className="text-[15.5px] font-extrabold" numberOfLines={1}>{x.name}</Txt>
                    <Txt className="text-muted text-[12.5px]" numberOfLines={1}>{x.contactEmail || date(x.createdAt)}</Txt>
                  </View>
                  <Pill tone={x.status === 'active' ? 'success' : x.status === 'suspended' ? 'danger' : 'primary'} label={t(`ts_${x.status}`)} />
                </View>
                <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
                  <Pill tone="ink" label={t(`plan_${x.plan}`)} />
                  <Pill icon="account-tie-outline" label={x.maxAdmins == null ? t('seatsFree', { used: x.admins }) : t('seats', { used: x.admins, max: x.maxAdmins })} />
                </View>
                {x.notes ? <Txt className="text-muted text-[12.5px] leading-[18px] mt-2" numberOfLines={2}>{x.notes}</Txt> : null}
                <View className="flex-row mt-3" style={{ gap: 8 }}>
                  <RowBtn testID={`sa-tenant-edit-${x.id}`} icon="pencil-outline" label={t('edit')} onPress={() => open(x)} />
                  {x.status === 'suspended'
                    ? <RowBtn testID={`sa-tenant-activate-${x.id}`} icon="play-circle-outline" label={t('activate')} onPress={() => setStatus(x, 'active')} />
                    : <RowBtn testID={`sa-tenant-suspend-${x.id}`} icon="pause-circle-outline" label={t('suspend')} onPress={() => setSuspend(x)} />}
                  <RowBtn testID={`sa-tenant-delete-${x.id}`} icon="trash-can-outline" tone="danger" label={t('remove')} onPress={() => setRemove(x)} />
                </View>
              </Panel>
            ))}
          </Grid>
        )}
      </Loaded>

      <Sheet visible={!!draft} onClose={() => setDraft(null)} title={draft?.id ? t('editTenant') : t('addTenant')}
        footer={<Button full variant="ink" title={draft?.id ? t('save') : t('create')} onPress={save} loading={busy} testID="sa-tenant-save" />}>
        {draft ? (
          <View testID="sa-tenant-form">
            <Input testID="sa-tenant-name" label={t('tName')} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <Input testID="sa-tenant-contact" label={t('tContact')} value={draft.contactEmail} onChangeText={(contactEmail) => setDraft({ ...draft, contactEmail })} autoCapitalize="none" keyboardType="email-address" />
            <Choice testID="sa-tenant-plan" label={t('tPlan')} value={draft.plan} onChange={(plan) => setDraft({ ...draft, plan })} options={PLANS.map((k) => ({ key: k, label: t(`plan_${k}`) }))} />
            <Choice testID="sa-tenant-status" label={t('tStatus')} value={draft.status} onChange={(status) => setDraft({ ...draft, status })} options={STATUSES.map((k) => ({ key: k, label: t(`ts_${k}`) }))} />
            <Input testID="sa-tenant-seats" label={`${t('tSeats')} (${t('tSeatsHint')})`} value={draft.maxAdmins} onChangeText={(v) => setDraft({ ...draft, maxAdmins: v.replace(/[^0-9]/g, '') })} keyboardType="number-pad" />
            <Input testID="sa-tenant-notes" label={t('tNotes')} value={draft.notes} onChangeText={(notes) => setDraft({ ...draft, notes })} multiline />
            {error ? <Txt testID="sa-tenant-error" accessibilityRole="alert" className="text-danger text-[13px] font-semibold">{error}</Txt> : null}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet visible={!!suspend} onClose={() => setSuspend(null)} onConfirm={() => { if (suspend) void setStatus(suspend, 'suspended'); }} message={suspend ? t('suspendBody', { name: suspend.name }) : ''} confirmLabel={t('suspend')} cancelLabel={t('cancel')} />
      <ConfirmSheet visible={!!remove} onClose={() => setRemove(null)} onConfirm={doRemove} message={remove ? `${t('deleteTenant')} ${t('deleteTenantBody', { name: remove.name })}` : ''} confirmLabel={t('remove')} cancelLabel={t('cancel')} />
    </SaPage>
  );
}
