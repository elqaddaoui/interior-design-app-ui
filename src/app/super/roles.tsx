import React, { useState } from 'react';
import { View } from 'react-native';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Card2, Chips, Label, Loading, PermissionMatrix, Pill, SectionTitle, SuperPage, countLevels, useFail, useLoad } from '@/components/super/ui';
import { Icon } from '@/components/ui/Icon';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { errorKey, useSuper } from '@/store/useSuper';
import { superApi, type Levels, type Role, type Tenant } from '@/lib/superApi';

type Draft = { id?: string; system: boolean; name: string; description: string; tenantId: string; permissions: Levels; accounts: number };

export default function RolesPage() {
  const { t } = useT();
  const fail = useFail();
  const catalog = useSuper((s) => s.catalog);
  const roles = useLoad(() => superApi<Role[]>('/roles'));
  const tenants = useLoad(() => superApi<Tenant[]>('/tenants'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tenantName = (id: string | null) => (id ? tenants.data?.find((x) => x.id === id)?.name || id : t('sx.rl.global'));
  const open = (r: Role) => { setErr(''); setDraft({ id: r.id, system: r.system, name: r.name, description: r.description || '', tenantId: r.tenantId || '', permissions: { ...r.permissions }, accounts: r.accounts || 0 }); };
  const openNew = (from?: Role) => { setErr(''); setDraft({ system: false, name: from ? t('sx.rl.copyOf', { name: from.name }) : '', description: from?.description || '', tenantId: '', permissions: { ...(from?.permissions || {}) }, accounts: 0 }); };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const close = () => { setDraft(null); setErr(''); setConfirmDelete(false); };

  const save = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim()) { setErr(t('sx.err.GENERIC')); return; }
    setBusy(true); setErr('');
    const body: Record<string, unknown> = { name: draft.name.trim(), description: draft.description, permissions: draft.permissions };
    try {
      if (draft.id) await superApi(`/roles/${draft.id}`, { method: 'PATCH', body });
      else await superApi('/roles', { method: 'POST', body: { ...body, tenantId: draft.tenantId || null } });
      toast(t('sx.c.saved')); close(); await roles.reload();
    } catch (e) { const key = errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try { await superApi(`/roles/${draft.id}`, { method: 'DELETE' }); toast(t('sx.c.deleted')); close(); await roles.reload(); }
    catch (e) { const key = errorKey(e); setConfirmDelete(false); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); } finally { setBusy(false); }
  };

  const list = roles.data || [];
  const group = (title: string, items: Role[]) => items.length ? (
    <View style={{ gap: 10 }}>
      <SectionTitle>{title}</SectionTitle>
      {items.map((r) => {
        const c = countLevels(r.permissions);
        return (
          <Card2 key={r.id} testID={`role-row-${r.id}`} onPress={() => open(r)}>
            <View className="flex-row items-center" style={{ gap: 12 }}>
              <View className="w-10 h-10 rounded-2xl bg-soft items-center justify-center"><Icon name={r.system ? 'shield-check-outline' : 'shield-edit-outline'} size={20} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                  <Txt numberOfLines={1} className="font-extrabold text-[15px]">{r.name}</Txt>
                  {r.system ? <Pill label={t('sx.rl.system')} tone="muted" /> : null}
                  {!r.system ? <Pill label={tenantName(r.tenantId)} tone="primary" /> : null}
                </View>
                <Txt numberOfLines={2} className="text-muted text-[12px] mt-0.5">{r.description || t('sx.rl.summary', { e: c.e, v: c.v })}</Txt>
              </View>
              <Txt className="text-muted text-[11px] font-bold">{t('sx.rl.accounts', { n: r.accounts || 0 })}</Txt>
            </View>
          </Card2>
        );
      })}
    </View>
  ) : null;

  return (
    <SuperPage title={t('sx.rl.title')} sub={t('sx.rl.sub')} right={<Button testID="role-new" size="sm" icon="plus" title={t('sx.rl.new')} onPress={() => openNew()} />}>
      {!roles.data ? <Loading error={roles.error} onRetry={roles.reload} /> : (
        <View>
          {group(t('sx.rl.system'), list.filter((r) => r.system))}
          {group(t('sx.rl.custom'), list.filter((r) => !r.system))}
        </View>
      )}

      <Sheet visible={!!draft && !confirmDelete} wide onClose={close} title={draft?.id ? draft.name : t('sx.rl.new')}
        footer={draft ? (
          <View>
            {err ? <Txt testID="role-error" accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
            <View className="flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={close} full /></View>
              {draft.system
                ? <View style={{ flex: 1 }}><Button testID="role-duplicate" icon="content-copy" title={t('sx.rl.duplicate')} onPress={() => { const base = list.find((r) => r.id === draft.id); close(); openNew(base); }} full /></View>
                : <View style={{ flex: 1 }}><Button testID="role-save" title={draft.id ? t('sx.c.save') : t('sx.c.create')} loading={busy} onPress={save} full /></View>}
            </View>
          </View>
        ) : undefined}>
        {draft ? (
          <View>
            {draft.system ? <Txt className="text-muted text-[12px] mb-3">{t('sx.rl.readonly')}</Txt> : null}
            <Input testID="role-name" label={t('sx.rl.name')} value={draft.name} onChangeText={(v) => set('name', v)} editable={!draft.system} />
            <Input testID="role-desc" label={t('sx.rl.desc')} value={draft.description} onChangeText={(v) => set('description', v)} editable={!draft.system} />
            {!draft.id ? (<>
              <Label>{t('sx.rl.scope')}</Label>
              <Chips testID="role-scope" options={[{ key: '', label: t('sx.rl.global') }, ...(tenants.data || []).map((x) => ({ key: x.id, label: x.name }))]} value={draft.tenantId} onChange={(k) => set('tenantId', k)} />
            </>) : null}
            {draft.id && !draft.system ? <Txt className="text-muted text-[12px]">{t('sx.rl.scope')}: {tenantName(draft.tenantId || null)} · {t('sx.rl.accounts', { n: draft.accounts })}</Txt> : null}
            <SectionTitle>{t('sx.rl.perms')}</SectionTitle>
            {catalog ? <PermissionMatrix testID="role-perms" features={catalog.features} groups={catalog.groups} value={draft.permissions} readOnly={draft.system} onChange={(v) => set('permissions', v)} /> : null}
            {draft.id && !draft.system ? (
              <View style={{ marginTop: 18 }}><Button testID="role-delete" size="sm" variant="danger" icon="delete-outline" title={t('sx.c.delete')} onPress={() => setConfirmDelete(true)} /></View>
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={confirmDelete && !!draft} onClose={() => setConfirmDelete(false)}>
        <Txt className="text-[15px] leading-[22px] font-bold text-center mb-3 mt-1">{t('sx.rl.deleteConfirm', { name: draft?.name })}</Txt>
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setConfirmDelete(false)} full /></View>
          <View style={{ flex: 1 }}><Button testID="role-delete-confirm" variant="danger" title={t('sx.c.delete')} loading={busy} onPress={remove} full /></View>
        </View>
      </Sheet>
    </SuperPage>
  );
}
