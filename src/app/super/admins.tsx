import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { Initials } from '@/components/admin/dashboard/Kit';
import { Card2, Chips, Label, Loading, PermissionMatrix, Pill, SectionTitle, SuperPage, useFail, useLoad, usePlainDate } from '@/components/super/ui';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { errorKey, useSuper } from '@/store/useSuper';
import { superApi, type Account, type Levels, type Role, type Tenant } from '@/lib/superApi';

type Draft = { id?: string; tenantId: string; username: string; name: string; email: string; password: string; roleId: string; status: 'active' | 'suspended'; overrides: Levels };

export default function AdminsPage() {
  const { t } = useT();
  const fail = useFail();
  const fmt = usePlainDate();
  const catalog = useSuper((s) => s.catalog);
  const params = useLocalSearchParams<{ tenantId?: string }>();
  const [tenantFilter, setTenantFilter] = useState<string>(typeof params.tenantId === 'string' ? params.tenantId : '');
  const accounts = useLoad(() => superApi<Account[]>(`/accounts${tenantFilter ? `?tenantId=${encodeURIComponent(tenantFilter)}` : ''}`), [tenantFilter]);
  const tenants = useLoad(() => superApi<Tenant[]>('/tenants'));
  const roles = useLoad(() => superApi<Role[]>('/roles'));
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState<null | 'delete' | 'reset'>(null);
  const [newPass, setNewPass] = useState('');

  const tenantList = tenants.data || [];
  const rows = useMemo(() => (accounts.data || []).filter((a) => !q.trim() || `${a.username} ${a.name} ${a.email} ${a.tenantName}`.toLowerCase().includes(q.trim().toLowerCase())), [accounts.data, q]);
  const rolesFor = (tenantId: string) => (roles.data || []).filter((r) => !r.tenantId || r.tenantId === tenantId);
  const roleOf = (id: string) => roles.data?.find((r) => r.id === id);

  const openNew = () => {
    const tenantId = tenantFilter || tenantList.find((x) => x.status === 'active')?.id || tenantList[0]?.id || '';
    setErr(''); setDraft({ tenantId, username: '', name: '', email: '', password: '', roleId: 'role_admin', status: 'active', overrides: {} });
  };
  const openEdit = (a: Account) => { setErr(''); setDraft({ id: a.id, tenantId: a.tenantId, username: a.username, name: a.name, email: a.email, password: '', roleId: a.roleId, status: a.status, overrides: a.overrides || {} }); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const close = () => { setDraft(null); setErr(''); setConfirm(null); setNewPass(''); };

  const save = async () => {
    if (!draft || busy) return;
    if (!draft.tenantId) { setErr(t('sx.ad.pickTenant')); return; }
    setBusy(true); setErr('');
    try {
      if (draft.id) {
        await superApi(`/accounts/${draft.id}`, { method: 'PATCH', body: { name: draft.name, email: draft.email, roleId: draft.roleId, tenantId: draft.tenantId, status: draft.status, overrides: draft.overrides } });
        toast(t('sx.c.saved'));
      } else {
        await superApi('/accounts', { method: 'POST', body: { tenantId: draft.tenantId, username: draft.username.trim().toLowerCase(), name: draft.name.trim() || draft.username.trim(), email: draft.email.trim(), password: draft.password, roleId: draft.roleId } });
        toast(t('sx.c.created'));
      }
      close(); await Promise.all([accounts.reload(), tenants.reload(), roles.reload()]);
    } catch (e) { const key = errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); }
    finally { setBusy(false); }
  };
  const toggle = async (a: Draft) => {
    if (!a.id) return;
    setBusy(true);
    try { await superApi(`/accounts/${a.id}`, { method: 'PATCH', body: { status: a.status === 'active' ? 'suspended' : 'active' } }); toast(t('sx.c.updated')); close(); await accounts.reload(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try { await superApi(`/accounts/${id}`, { method: 'DELETE' }); toast(t('sx.c.deleted')); close(); await Promise.all([accounts.reload(), roles.reload(), tenants.reload()]); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const reset = async (id: string) => {
    setBusy(true); setErr('');
    try { await superApi(`/accounts/${id}/password`, { method: 'POST', body: { password: newPass } }); toast(t('sx.ad.resetDone')); setConfirm(null); setNewPass(''); }
    catch (e) { const key = errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); } finally { setBusy(false); }
  };

  const isNew = draft && !draft.id;
  const role = draft ? roleOf(draft.roleId) : undefined;

  return (
    <SuperPage title={t('sx.ad.title')} sub={t('sx.ad.sub')} right={<Button testID="admin-new" size="sm" icon="plus" title={t('sx.ad.new')} onPress={openNew} disabled={!tenantList.length} />}>
      <View className="flex-row flex-wrap items-center" style={{ gap: 10, marginBottom: 12 }}>
        <View style={{ flex: 1, flexBasis: 240, minWidth: 200 }}><Input testID="admin-search" tight placeholder={t('sx.ad.search')} value={q} onChangeText={setQ} autoCapitalize="none" /></View>
      </View>
      {tenantList.length > 1 ? (
        <View style={{ marginBottom: 14 }}>
          <Chips testID="admin-tenant-filter" options={[{ key: '', label: t('sx.ad.allTenants') }, ...tenantList.map((x) => ({ key: x.id, label: x.name }))]} value={tenantFilter} onChange={setTenantFilter} />
        </View>
      ) : null}

      {!accounts.data ? <Loading error={accounts.error} onRetry={accounts.reload} /> : rows.length === 0 ? (
        <EmptyState icon="account-key-outline" title={accounts.data.length ? t('sx.c.noResult') : t('sx.ad.empty')} subtitle={accounts.data.length ? undefined : t('sx.ad.emptySub')} action={accounts.data.length || !tenantList.length ? undefined : t('sx.ad.new')} onAction={accounts.data.length ? undefined : openNew} />
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map((a) => (
            <Card2 key={a.id} testID={`admin-row-${a.username}`} onPress={() => openEdit(a)} dim={a.status !== 'active'}>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <Initials name={a.name || a.username} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                    <Txt numberOfLines={1} className="font-extrabold text-[15px]">{a.name || a.username}</Txt>
                    <Pill label={a.roleName} tone="primary" />
                    {a.status !== 'active' ? <Pill label={t('sx.c.disabled')} tone="danger" /> : null}
                  </View>
                  <Txt numberOfLines={1} className="text-muted text-[12px] mt-0.5">@{a.username} · {a.tenantName}</Txt>
                </View>
                <View className="items-end" style={{ minWidth: 70 }}>
                  <Txt className="text-muted text-[10px] font-bold uppercase">{t('sx.ad.lastLogin')}</Txt>
                  <Txt numberOfLines={1} className="text-[12px] font-semibold">{fmt.dateTime(a.lastLogin)}</Txt>
                </View>
              </View>
            </Card2>
          ))}
        </View>
      )}

      <Sheet visible={!!draft && !confirm} wide onClose={close} title={isNew ? t('sx.ad.new') : draft?.name || draft?.username}
        footer={draft ? (
          <View>
            {err ? <Txt testID="admin-error" accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
            <View className="flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={close} full /></View>
              <View style={{ flex: 1 }}><Button testID="admin-save" title={isNew ? t('sx.c.create') : t('sx.c.save')} loading={busy} onPress={save} full /></View>
            </View>
          </View>
        ) : undefined}>
        {draft ? (
          <View>
            <Label>{t('sx.ad.tenant')}</Label>
            <Chips testID="admin-tenant" options={tenantList.filter((x) => x.status === 'active' || x.id === draft.tenantId).map((x) => ({ key: x.id, label: x.name }))} value={draft.tenantId}
              onChange={(k) => { set('tenantId', k); if (!rolesFor(k).some((r) => r.id === draft.roleId)) set('roleId', 'role_admin'); }} />
            <View style={{ height: 12 }} />
            <Input testID="admin-username" label={t('sx.ad.username')} value={draft.username} onChangeText={(v) => set('username', v.toLowerCase().replace(/\s/g, ''))} editable={!!isNew} autoCapitalize="none" autoCorrect={false} />
            {isNew ? <Txt className="text-muted text-[11px]" style={{ marginTop: -6, marginBottom: 10 }}>{t('sx.ad.loginHint')}</Txt> : null}
            <Input testID="admin-name" label={t('sx.ad.name')} value={draft.name} onChangeText={(v) => set('name', v)} />
            <Input testID="admin-email" label={`${t('sx.ad.email')} (${t('sx.c.optional')})`} value={draft.email} onChangeText={(v) => set('email', v)} autoCapitalize="none" keyboardType="email-address" />
            {isNew ? (<>
              <Input testID="admin-password" label={t('sx.ad.password')} value={draft.password} onChangeText={(v) => set('password', v)} secureTextEntry autoCapitalize="none" />
              <Txt className="text-muted text-[11px]" style={{ marginTop: -6, marginBottom: 10 }}>{t('sx.ad.passwordHint')}</Txt>
            </>) : null}
            <Label>{t('sx.ad.role')}</Label>
            <Chips testID="admin-role" options={rolesFor(draft.tenantId).map((r) => ({ key: r.id, label: r.name }))} value={draft.roleId} onChange={(k) => set('roleId', k)} />

            {!isNew ? (<>
              <SectionTitle>{t('sx.ad.status')}</SectionTitle>
              <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
                <Pill label={draft.status === 'active' ? t('sx.c.active') : t('sx.c.disabled')} tone={draft.status === 'active' ? 'success' : 'danger'} />
                <Button testID="admin-toggle" size="sm" variant="soft" title={draft.status === 'active' ? t('sx.ad.disable') : t('sx.ad.enable')} loading={busy} onPress={() => toggle(draft)} />
                <Button testID="admin-reset" size="sm" variant="soft" icon="lock-reset" title={t('sx.ad.reset')} onPress={() => { setErr(''); setNewPass(''); setConfirm('reset'); }} />
                <Button testID="admin-delete" size="sm" variant="danger" icon="delete-outline" title={t('sx.c.delete')} onPress={() => setConfirm('delete')} />
              </View>
            </>) : null}

            {catalog && role ? (<>
              <SectionTitle>{t('sx.ad.overrides')}</SectionTitle>
              <Txt className="text-muted text-[12px] mb-3">{t('sx.ad.overridesHint')}</Txt>
              <PermissionMatrix testID="admin-overrides" features={catalog.features} groups={catalog.groups} value={draft.overrides} inherit base={role.permissions} onChange={(v) => set('overrides', v)} />
            </>) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={confirm === 'delete' && !!draft} onClose={() => setConfirm(null)}>
        <Txt className="text-[15px] leading-[22px] font-bold text-center mb-1 mt-1">{t('sx.ad.deleteConfirm', { name: draft?.name || draft?.username })}</Txt>
        <Txt className="text-muted text-[12px] text-center mb-3">{t('sx.c.confirmDelete')}</Txt>
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setConfirm(null)} full /></View>
          <View style={{ flex: 1 }}><Button testID="admin-delete-confirm" variant="danger" title={t('sx.c.delete')} loading={busy} onPress={() => draft?.id && remove(draft.id)} full /></View>
        </View>
      </Sheet>
      <Sheet visible={confirm === 'reset' && !!draft} onClose={() => setConfirm(null)} title={t('sx.ad.reset')}>
        <Input testID="admin-reset-input" label={t('sx.ad.password')} value={newPass} onChangeText={setNewPass} secureTextEntry autoCapitalize="none" />
        <Txt className="text-muted text-[11px]" style={{ marginTop: -6, marginBottom: 10 }}>{t('sx.ad.passwordHint')}</Txt>
        {err ? <Txt accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setConfirm(null)} full /></View>
          <View style={{ flex: 1 }}><Button testID="admin-reset-confirm" title={t('sx.c.save')} loading={busy} onPress={() => draft?.id && reset(draft.id)} full /></View>
        </View>
      </Sheet>
    </SuperPage>
  );
}
