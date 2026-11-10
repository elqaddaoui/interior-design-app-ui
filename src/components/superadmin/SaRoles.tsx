import React, { useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Panel } from '@/components/admin/dashboard/Kit';
import { useSuperData } from '@/hooks/useSuperData';
import { AREAS } from '@/lib/access';
import { saApi, type SaRole } from '@/lib/superadmin';
import { toast } from '@/store/useToast';
import { PermissionEditor, type Grant } from './PermissionEditor';
import { Empty, Grid, Loaded, Pill, RowBtn, SaPage, useSa } from './ui';

type Draft = { id?: string; name: string; description: string; grant: Grant; system?: boolean };
const blank = (): Draft => ({ name: '', description: '', grant: { permissions: { requests: 'view', clients: 'view' }, ui: ['dashboard', 'requests', 'users'] } });

export function SaRoles() {
  const { t, err } = useSa();
  const q = useSuperData<{ roles: SaRole[] }>('/roles');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [remove, setRemove] = useState<SaRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = (r?: SaRole) => { setError(''); setDraft(r ? { id: r.id, name: r.name, description: r.description, system: r.system, grant: { permissions: r.permissions, ui: r.ui } } : blank()); };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try {
      const body = { name: draft.name, description: draft.description, permissions: draft.grant.permissions, ui: draft.grant.ui };
      await saApi(draft.id ? `/roles/${encodeURIComponent(draft.id)}` : '/roles', { method: draft.id ? 'PATCH' : 'POST', body });
      toast(t('saved')); setDraft(null); q.reload();
    } catch (e) { setError(err(e)); }
    setBusy(false);
  };
  const doRemove = async () => {
    if (!remove) return;
    try { await saApi(`/roles/${encodeURIComponent(remove.id)}`, { method: 'DELETE' }); toast(t('saved')); q.reload(); } catch (e) { toast(err(e)); }
    setRemove(null);
  };
  const locked = !!draft?.system && draft.id === 'owner';

  return (
    <SaPage title={t('rolesTitle')} sub={t('rolesSub')} right={<Button icon="plus" title={t('addRole')} onPress={() => open()} testID="sa-add-role" />}>
      <Loaded q={q}>
        {(d) => d.roles.length === 0 ? <Empty text={t('empty')} /> : (
          <Grid min={340}>
            {d.roles.map((r) => {
              const full = AREAS.filter((a) => r.permissions[a] === 'manage').length;
              const view = AREAS.filter((a) => r.permissions[a] === 'view').length;
              return (
                <Panel key={r.id} testID={`sa-role-${r.id}`} fill>
                  <View className="flex-row items-start" style={{ gap: 10 }}>
                    <View className="w-10 h-10 rounded-2xl bg-soft items-center justify-center"><Icon name={r.system ? 'shield-key-outline' : 'shield-account-outline'} size={20} tone="fg" /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt className="text-[15.5px] font-extrabold" numberOfLines={1}>{r.name}</Txt>
                      {r.description ? <Txt className="text-muted text-[12.5px] leading-[18px]" numberOfLines={2}>{r.description}</Txt> : null}
                    </View>
                    {r.id === 'owner' ? <Pill tone="ink" icon="lock-outline" label={t('locked')} /> : null}
                  </View>
                  <View className="flex-row flex-wrap mt-3" style={{ gap: 6 }}>
                    <Pill tone="primary" label={`${t('lvManage')} · ${full}`} />
                    <Pill label={`${t('lvView')} · ${view}`} />
                    <Pill label={t('adminsN', { n: r.admins })} icon="account-tie-outline" />
                  </View>
                  <View className="flex-row mt-3" style={{ gap: 8 }}>
                    <RowBtn testID={`sa-role-edit-${r.id}`} icon="pencil-outline" label={t('edit')} onPress={() => open(r)} />
                    {!r.system ? <RowBtn testID={`sa-role-delete-${r.id}`} icon="trash-can-outline" tone="danger" label={t('remove')} onPress={() => setRemove(r)} /> : null}
                  </View>
                </Panel>
              );
            })}
          </Grid>
        )}
      </Loaded>

      <Sheet visible={!!draft} onClose={() => setDraft(null)} wide title={draft?.id ? t('editRole') : t('addRole')}
        footer={<Button full variant="ink" title={t('save')} onPress={save} loading={busy} disabled={locked || draft?.name.trim().length === 0} testID="sa-role-save" />}>
        {draft ? (
          <View testID="sa-role-form">
            <Input testID="sa-role-name" label={t('roleName')} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} editable={!locked} />
            <Input testID="sa-role-desc" label={t('roleDesc')} value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} editable={!locked} />
            <PermissionEditor value={draft.grant} onChange={(grant) => setDraft({ ...draft, grant })} disabled={locked} />
            {locked ? <Txt className="text-muted text-[12.5px] mt-2">{t('locked')}</Txt> : null}
            {error ? <Txt testID="sa-role-error" accessibilityRole="alert" className="text-danger text-[13px] font-semibold mt-3">{error}</Txt> : null}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet visible={!!remove} onClose={() => setRemove(null)} onConfirm={doRemove} message={remove ? `${t('deleteRole')} ${t('deleteRoleBody', { name: remove.name })}` : ''} confirmLabel={t('remove')} cancelLabel={t('cancel')} />
    </SaPage>
  );
}
