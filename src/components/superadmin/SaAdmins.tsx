import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Initials, Panel } from '@/components/admin/dashboard/Kit';
import { useSuperData } from '@/hooks/useSuperData';
import type { Permissions } from '@/lib/access';
import { canCopy, copyText, saApi, suggestPassword, type SaAdmin, type SaRole, type SaTenant } from '@/lib/superadmin';
import { toast } from '@/store/useToast';
import { PermissionEditor, type Grant } from './PermissionEditor';
import { Choice, Empty, Loaded, PasswordField, PasswordRules, Pill, RowBtn, SaPage, SearchBox, useSa } from './ui';

type Draft = {
  id?: string; username: string; password: string; name: string; email: string; phone: string; title: string; credits: string;
  roleId: string; tenantId: string; custom: boolean; grant: Grant;
};
const blank = (roleId: string): Draft => ({ username: '', password: '', name: '', email: '', phone: '', title: '', credits: '', roleId, tenantId: '', custom: false, grant: { permissions: {}, ui: ['dashboard'] } });

export function SaAdmins() {
  const { t, err, ago } = useSa();
  const q = useSuperData<{ admins: SaAdmin[] }>('/admins');
  const roles = useSuperData<{ roles: SaRole[] }>('/roles');
  const tenants = useSuperData<{ tenants: SaTenant[] }>('/tenants');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reset, setReset] = useState<{ admin: SaAdmin; password: string; done: boolean } | null>(null);
  const [resetError, setResetError] = useState('');
  const [remove, setRemove] = useState<SaAdmin | null>(null);

  const roleList = roles.data?.roles ?? [];
  const tenantList = tenants.data?.tenants ?? [];
  const list = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data?.admins ?? []).filter((a) => (roleFilter === 'all' || a.role?.id === roleFilter) && (!needle || [a.username, a.name, a.email, a.title].some((v) => v?.toLowerCase().includes(needle))));
  }, [q.data, search, roleFilter]);

  const open = (a?: SaAdmin) => {
    setError('');
    if (!a) { setDraft({ ...blank(roleList.find((r) => r.id !== 'owner')?.id ?? roleList[0]?.id ?? ''), password: suggestPassword() }); return; }
    const o = a.override;
    setDraft({
      id: a.id, username: a.username, password: '', name: a.name, email: a.email, phone: a.phone, title: a.title, credits: a.credits == null ? '' : String(a.credits),
      roleId: a.role?.id ?? '', tenantId: a.tenant?.id ?? '', custom: !!o,
      grant: { permissions: (o?.permissions ?? a.access.permissions ?? {}) as Permissions, ui: o?.ui ?? a.access.ui ?? ['dashboard'] },
    });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const credits = draft.credits.trim() === '' ? null : Number(draft.credits);
      const common = {
        name: draft.name, email: draft.email, phone: draft.phone, title: draft.title, credits,
        roleId: draft.roleId || null, tenantId: draft.tenantId || null,
        override: draft.custom ? { permissions: draft.grant.permissions, ui: draft.grant.ui } : null,
      };
      if (draft.id) await saApi(`/admins/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: common });
      else await saApi('/admins', { method: 'POST', body: { ...common, username: draft.username, password: draft.password } });
      toast(draft.id ? t('saved') : t('createdAdmin'));
      setDraft(null); q.reload(); roles.reload(); tenants.reload();
    } catch (e) { setError(err(e)); }
    setBusy(false);
  };

  const toggleDisabled = async (a: SaAdmin) => {
    try { await saApi(`/admins/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { disabled: !a.disabled } }); toast(t(a.disabled ? 'enabledDone' : 'disabledDone')); q.reload(); } catch (e) { toast(err(e)); }
  };
  const signOut = async (a: SaAdmin) => {
    try { await saApi(`/admins/${encodeURIComponent(a.id)}/signout`, { method: 'POST' }); toast(t('signedOut')); q.reload(); } catch (e) { toast(err(e)); }
  };
  const doReset = async () => {
    if (!reset) return;
    setBusy(true); setResetError('');
    try { await saApi(`/admins/${encodeURIComponent(reset.admin.id)}/password`, { method: 'POST', body: { password: reset.password } }); setReset({ ...reset, done: true }); q.reload(); } catch (e) { setResetError(err(e)); }
    setBusy(false);
  };
  const doRemove = async () => {
    if (!remove) return;
    try { await saApi(`/admins/${encodeURIComponent(remove.id)}`, { method: 'DELETE' }); toast(t('saved')); q.reload(); roles.reload(); tenants.reload(); } catch (e) { toast(err(e)); }
    setRemove(null);
  };
  const copy = async (text: string) => { if (await copyText(text)) toast(t('copied')); };
  const roleOf = (id: string) => roleList.find((r) => r.id === id);

  return (
    <SaPage title={t('adminsTitle')} sub={t('adminsSub')} right={<Button icon="plus" title={t('addAdmin')} onPress={() => open()} disabled={!roleList.length} testID="sa-add-admin" />}>
      <View className="flex-row flex-wrap items-center" style={{ gap: 10 }}>
        <SearchBox testID="sa-admin-search" value={search} onChangeText={setSearch} placeholder={t('adminSearch')} />
      </View>
      {roleList.length ? (
        <Choice testID="sa-role-filter" value={roleFilter} onChange={setRoleFilter} options={[{ key: 'all', label: t('filterAllRoles') }, ...roleList.map((r) => ({ key: r.id, label: r.name }))]} />
      ) : null}

      <Loaded q={q}>
        {() => list.length === 0 ? <Empty text={t('empty')} /> : (
          <View style={{ gap: 10 }}>
            {list.map((a) => (
              <Panel key={a.id} testID={`sa-admin-${a.id}`}>
                <View className="flex-row flex-wrap items-center" style={{ gap: 12 }}>
                  <View className="flex-row items-center" style={{ gap: 12, flexGrow: 1, flexBasis: 260, minWidth: 0 }}>
                    <Initials name={a.name || a.username} size={44} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt className="text-[15px] font-extrabold" numberOfLines={1}>{a.name || a.username}</Txt>
                      <Txt className="text-muted text-[12.5px]" numberOfLines={1}>@{a.username}{a.email ? ` · ${a.email}` : ''}</Txt>
                      <Txt className="text-muted text-[12px] mt-0.5" numberOfLines={1}>{t('lastLogin')}: {ago(a.lastLoginAt)} · {t('devicesCount', { n: a.sessions })}</Txt>
                    </View>
                  </View>
                  <View className="flex-row flex-wrap items-center" style={{ gap: 6, flexGrow: 1, flexBasis: 200 }}>
                    <Pill tone={a.access.full ? 'ink' : 'primary'} icon="shield-account-outline" label={a.role?.name ?? t('noRole')} />
                    {a.override ? <Pill label={t('custom')} icon="tune-variant" /> : null}
                    {a.tenant ? <Pill label={a.tenant.name} icon="domain" /> : null}
                    {a.builtIn ? <Pill label={t('builtIn')} icon="lock-outline" /> : null}
                    <Pill tone={a.disabled ? 'danger' : 'success'} label={a.disabled ? t('statusDisabled') : t('statusActive')} />
                  </View>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <RowBtn testID={`sa-admin-edit-${a.id}`} icon="pencil-outline" label={t('edit')} onPress={() => open(a)} />
                    <RowBtn testID={`sa-admin-reset-${a.id}`} icon="key-outline" label={t('resetPw')} onPress={() => { setResetError(''); setReset({ admin: a, password: suggestPassword(), done: false }); }} />
                    <RowBtn testID={`sa-admin-signout-${a.id}`} icon="logout" label={t('signOutAdmin')} onPress={() => signOut(a)} disabled={!a.sessions} />
                    <RowBtn testID={`sa-admin-toggle-${a.id}`} icon={a.disabled ? 'account-check-outline' : 'account-off-outline'} label={t(a.disabled ? 'enable' : 'disable')} onPress={() => toggleDisabled(a)} />
                    {!a.builtIn ? <RowBtn testID={`sa-admin-delete-${a.id}`} icon="trash-can-outline" tone="danger" label={t('remove')} onPress={() => setRemove(a)} /> : null}
                  </View>
                </View>
              </Panel>
            ))}
          </View>
        )}
      </Loaded>

      <Sheet visible={!!draft} onClose={() => setDraft(null)} wide title={draft?.id ? t('editAdmin') : t('addAdmin')}
        footer={<Button full variant="ink" title={draft?.id ? t('save') : t('create')} onPress={save} loading={busy} testID="sa-admin-save" />}>
        {draft ? (
          <View testID="sa-admin-form">
            <Input testID="sa-admin-username" label={t('username')} value={draft.username} onChangeText={(username) => setDraft({ ...draft, username })} editable={!draft.id} autoCapitalize="none" autoCorrect={false} />
            {!draft.id ? (
              <>
                <PasswordField testID="sa-admin-password" label={t('password')} value={draft.password} onChangeText={(password) => setDraft({ ...draft, password })} />
                <PasswordRules value={draft.password} username={draft.username} />
                <View className="flex-row mb-3" style={{ gap: 8 }}>
                  <Button size="sm" variant="soft" icon="auto-fix" title={t('generate')} onPress={() => setDraft({ ...draft, password: suggestPassword() })} testID="sa-admin-generate" />
                  {canCopy ? <Button size="sm" variant="soft" icon="content-copy" title={t('copy')} onPress={() => copy(draft.password)} /> : null}
                </View>
              </>
            ) : null}
            <Input testID="sa-admin-name" label={t('fName')} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
            <Input testID="sa-admin-email" label={t('fEmail')} value={draft.email} onChangeText={(email) => setDraft({ ...draft, email })} autoCapitalize="none" keyboardType="email-address" />
            <Input testID="sa-admin-phone" label={t('fPhone')} value={draft.phone} onChangeText={(phone) => setDraft({ ...draft, phone })} keyboardType="phone-pad" />
            <Input testID="sa-admin-title" label={t('fTitle')} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
            <Input testID="sa-admin-credits" label={`${t('fCredits')} (${t('fCreditsHint')})`} value={draft.credits} onChangeText={(credits) => setDraft({ ...draft, credits: credits.replace(/[^0-9]/g, '') })} keyboardType="number-pad" />
            <Choice testID="sa-admin-role" label={t('fRole')} value={draft.roleId} onChange={(roleId) => setDraft({ ...draft, roleId })}
              options={[...(draft.id ? [{ key: '', label: t('noRole') }] : []), ...roleList.map((r) => ({ key: r.id, label: r.name }))]} />
            {tenantList.length > 0 ? (
              <Choice testID="sa-admin-tenant" label={t('fTenant')} value={draft.tenantId} onChange={(tenantId) => setDraft({ ...draft, tenantId })}
                options={[{ key: '', label: t('noTenant') }, ...tenantList.map((x) => ({ key: x.id, label: x.name }))]} />
            ) : null}
            <View className="bg-surface border border-line rounded-2xl p-3 mb-2">
              <Checkbox testID="sa-admin-custom" state={draft.custom} label={t('customAccess')}
                onPress={() => setDraft({ ...draft, custom: !draft.custom, grant: draft.custom ? draft.grant : { permissions: roleOf(draft.roleId)?.permissions ?? draft.grant.permissions, ui: roleOf(draft.roleId)?.ui ?? draft.grant.ui } })} />
              <Txt className="text-muted text-[12px] mt-1 mb-1">{t('customAccessHint')}</Txt>
              {draft.custom ? <View className="mt-2"><PermissionEditor value={draft.grant} onChange={(grant) => setDraft({ ...draft, grant })} /></View> : null}
            </View>
            {error ? <Txt testID="sa-admin-error" accessibilityRole="alert" className="text-danger text-[13px] font-semibold mt-2">{error}</Txt> : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={!!reset} onClose={() => setReset(null)} title={t('resetPw')}
        footer={reset?.done ? <Button full variant="ink" title={t('close')} onPress={() => setReset(null)} /> : <Button full variant="ink" icon="key-outline" title={t('resetPw')} onPress={doReset} loading={busy} testID="sa-reset-submit" />}>
        {reset ? (
          <View testID="sa-reset-form">
            <Txt className="text-muted text-[13.5px] leading-[20px] mb-3">{t('resetPwBody', { name: reset.admin.name || reset.admin.username })}</Txt>
            <PasswordField testID="sa-reset-password" label={t('newPw')} value={reset.password} onChangeText={(password) => setReset({ ...reset, password })} />
            <PasswordRules value={reset.password} username={reset.admin.username} />
            <View className="flex-row mb-3" style={{ gap: 8 }}>
              <Button size="sm" variant="soft" icon="auto-fix" title={t('generate')} onPress={() => setReset({ ...reset, password: suggestPassword() })} />
              {canCopy ? <Button size="sm" variant="soft" icon="content-copy" title={t('copy')} onPress={() => copy(reset.password)} /> : null}
            </View>
            {reset.done ? (
              <View testID="sa-reset-done" className="flex-row items-center bg-success/15 rounded-2xl p-3" style={{ gap: 8 }}>
                <Icon name="check-circle-outline" size={20} tone="success" /><Txt className="flex-1 text-[13px] font-bold text-success">{t('pwSet')}</Txt>
              </View>
            ) : null}
            {resetError ? <Txt testID="sa-reset-error" accessibilityRole="alert" className="text-danger text-[13px] font-semibold">{resetError}</Txt> : null}
          </View>
        ) : null}
      </Sheet>

      <ConfirmSheet visible={!!remove} onClose={() => setRemove(null)} onConfirm={doRemove} message={remove ? `${t('deleteAdmin')} ${t('deleteAdminBody', { name: remove.name || remove.username })}` : ''} confirmLabel={t('remove')} cancelLabel={t('cancel')} />
    </SaPage>
  );
}
