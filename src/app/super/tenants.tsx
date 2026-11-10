import React, { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { EmptyState } from '@/components/ui/EmptyState';
import { Initials, Seg } from '@/components/admin/dashboard/Kit';
import { Card2, Chips, Label, Loading, Pill, PermissionMatrix, SectionTitle, SuperPage, numText, parseNum, useFail, useLoad, usePlainDate } from '@/components/super/ui';
import { useT } from '@/i18n';
import { toast } from '@/store/useToast';
import { useSuper } from '@/store/useSuper';
import { superApi, type Levels, type Plan, type Role, type Tenant } from '@/lib/superApi';

type Draft = { id?: string; name: string; slug: string; planId: string; contactName: string; email: string; phone: string; notes: string; maxClients: string; maxAdmins: string; monthlyDesigns: string; startCredits: string; overrides: Levels; ownerOn: boolean; ownerUser: string; ownerName: string; ownerPass: string; ownerRole: string };
const blank = (planId: string): Draft => ({ name: '', slug: '', planId, contactName: '', email: '', phone: '', notes: '', maxClients: '', maxAdmins: '', monthlyDesigns: '', startCredits: '', overrides: {}, ownerOn: true, ownerUser: '', ownerName: '', ownerPass: '', ownerRole: 'role_owner' });
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '');
const fromTenant = (x: Tenant): Draft => ({ id: x.id, name: x.name, slug: x.slug, planId: x.planId, contactName: x.contact.name, email: x.contact.email, phone: x.contact.phone, notes: x.notes, overrides: x.overrides || {}, ownerOn: false, ownerUser: '', ownerName: '', ownerPass: '', ownerRole: 'role_owner',
  maxClients: numText(x.ownLimits?.maxClients), maxAdmins: numText(x.ownLimits?.maxAdmins), monthlyDesigns: numText(x.ownLimits?.monthlyDesigns), startCredits: numText(x.ownLimits?.startCredits) });

export default function TenantsPage() {
  const { t } = useT();
  const fail = useFail();
  const fmt = usePlainDate();
  const catalog = useSuper((s) => s.catalog);
  const list = useLoad(() => superApi<Tenant[]>('/tenants'));
  const plans = useLoad(() => superApi<Plan[]>('/plans'));
  const roles = useLoad(() => superApi<Role[]>('/roles'));
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detail, setDetail] = useState<Tenant | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | 'delete' | 'suspend'>(null);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');

  const rows = useMemo(() => (list.data || []).filter((x) => (filter === 'all' || x.status === filter) && (!q.trim() || `${x.name} ${x.slug} ${x.contact.email} ${x.contact.name}`.toLowerCase().includes(q.trim().toLowerCase()))), [list.data, q, filter]);
  const planName = (id: string) => plans.data?.find((p) => p.id === id)?.name || id;
  const defaultPlan = plans.data?.find((p) => p.id === 'starter')?.id || plans.data?.[0]?.id || 'starter';
  const limitText = (n: number | null) => (n == null ? t('sx.c.unlimited') : fmt.num(n));

  const openNew = () => { setErr(''); setDraft(blank(defaultPlan)); };
  const openEdit = async (x: Tenant) => {
    setErr('');
    try {
      const full = await superApi<Tenant>(`/tenants/${x.id}`);
      setDetail(full); setDraft(fromTenant(full));
    } catch (e) { fail(e); }
  };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft || busy) return;
    if (!draft.name.trim()) { setErr(t('sx.err.GENERIC')); return; }
    setBusy(true); setErr('');
    const limits: Record<string, number | null> = {};
    for (const k of ['maxClients', 'maxAdmins', 'monthlyDesigns', 'startCredits'] as const) { const v = parseNum(draft[k]); if (v !== null) limits[k] = v; }
    const body: Record<string, unknown> = { name: draft.name.trim(), planId: draft.planId, contact: { name: draft.contactName.trim(), email: draft.email.trim(), phone: draft.phone.trim() }, notes: draft.notes, overrides: draft.overrides, limits };
    try {
      if (draft.id) { await superApi(`/tenants/${draft.id}`, { method: 'PATCH', body }); toast(t('sx.c.saved')); }
      else {
        body.slug = draft.slug || slugify(draft.name);
        if (draft.ownerOn && draft.ownerUser.trim()) body.owner = { username: draft.ownerUser.trim().toLowerCase(), name: draft.ownerName.trim() || draft.name.trim(), password: draft.ownerPass, roleId: draft.ownerRole };
        await superApi('/tenants', { method: 'POST', body }); toast(t('sx.c.created'));
      }
      setDraft(null); setDetail(null); await list.reload();
    } catch (e) { const key = (await import('@/store/useSuper')).errorKey(e); setErr(t(key)); if (key === 'sx.err.SESSION') fail(e); }
    finally { setBusy(false); }
  };

  const setStatus = async (x: Tenant, status: 'active' | 'suspended') => {
    setBusy(true);
    try { await superApi(`/tenants/${x.id}`, { method: 'PATCH', body: { status } }); toast(t('sx.c.updated')); setConfirm(null); setDraft(null); setDetail(null); await list.reload(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = async (x: Tenant) => {
    setBusy(true);
    try { await superApi(`/tenants/${x.id}`, { method: 'DELETE', body: { confirm: typed } }); toast(t('sx.c.deleted')); setConfirm(null); setTyped(''); setDraft(null); setDetail(null); await list.reload(); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };
  const openPanel = async (x: Tenant) => {
    setBusy(true);
    try {
      const r = await superApi<{ token?: string }>(`/tenants/${x.id}/impersonate`, { method: 'POST', body: {} });
      if (Platform.OS === 'web') { (globalThis as any).window?.open?.('/admin', '_blank'); }
      else if (r.token) { const store = await import('expo-secure-store'); await store.setItemAsync('dwira-backend-session', r.token); const { useLocal } = await import('@/store/useLocal'); useLocal.getState().set({ adminSession: true }); const { router } = await import('@/hooks/useLeaveGuard'); router.push('/admin'); }
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const ownerRoles = (roles.data || []).filter((r) => !r.tenantId);
  const isNew = draft && !draft.id;
  const isDefault = detail?.id === 'default';

  return (
    <SuperPage title={t('sx.tn.title')} sub={t('sx.tn.sub')} right={<Button testID="tenant-new" size="sm" icon="plus" title={t('sx.tn.new')} onPress={openNew} />}>
      <View className="flex-row flex-wrap items-center" style={{ gap: 10, marginBottom: 14 }}>
        <View style={{ flex: 1, flexBasis: 240, minWidth: 200 }}><Input testID="tenant-search" tight placeholder={t('sx.tn.search')} value={q} onChangeText={setQ} autoCapitalize="none" /></View>
        <Seg testID="tenant-filter" small options={[{ key: 'all', label: t('sx.c.all') }, { key: 'active', label: t('sx.c.active') }, { key: 'suspended', label: t('sx.c.suspended') }]} value={filter} onChange={setFilter} />
      </View>

      {!list.data ? <Loading error={list.error} onRetry={list.reload} /> : rows.length === 0 ? (
        <EmptyState icon="domain" title={list.data.length ? t('sx.c.noResult') : t('sx.tn.empty')} subtitle={list.data.length ? undefined : t('sx.tn.emptySub')} action={list.data.length ? undefined : t('sx.tn.new')} onAction={list.data.length ? undefined : openNew} />
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map((x) => (
            <Card2 key={x.id} testID={`tenant-row-${x.slug}`} onPress={() => openEdit(x)} dim={x.status === 'suspended'}>
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <Initials name={x.name} size={42} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                    <Txt numberOfLines={1} className="font-extrabold text-[15px]">{x.name}</Txt>
                    <Pill label={planName(x.planId)} tone="primary" />
                    {x.status === 'suspended' ? <Pill label={t('sx.c.suspended')} tone="danger" /> : null}
                    {x.id === 'default' ? <Pill label={t('sx.tn.defaultTag')} tone="muted" /> : null}
                  </View>
                  <Txt numberOfLines={1} className="text-muted text-[12px] mt-0.5">/{x.slug}{x.contact.email ? ` · ${x.contact.email}` : ''}</Txt>
                </View>
                <Icon name="chevron-right" size={20} tone="muted" flip />
              </View>
              <View className="flex-row flex-wrap mt-3" style={{ gap: 8 }}>
                {[[t('sx.tn.users'), `${fmt.num(x.usage.clients)} / ${limitText(x.limits.maxClients)}`], [t('sx.tn.admins'), `${x.usage.activeAccounts} / ${limitText(x.limits.maxAdmins)}`], [t('sx.tn.designs'), `${fmt.num(x.usage.designsThisMonth)} / ${limitText(x.limits.monthlyDesigns)}`], [t('sx.tn.last'), fmt.date(x.usage.lastRequestAt)]].map(([k, v]) => (
                  <View key={k} className="bg-surface2 rounded-xl px-3 py-1.5" style={{ flexGrow: 1, flexBasis: 120 }}><Txt className="text-muted text-[10px] font-bold uppercase" style={{ letterSpacing: 0.6 }}>{k}</Txt><Txt numberOfLines={1} className="font-extrabold text-[13px]">{v}</Txt></View>
                ))}
              </View>
            </Card2>
          ))}
        </View>
      )}

      <Sheet visible={!!draft} wide onClose={() => { setDraft(null); setDetail(null); setErr(''); }} title={isNew ? t('sx.tn.new') : draft?.name}
        footer={draft ? (
          <View>
            {err ? <Txt testID="tenant-error" accessibilityRole="alert" className="text-danger text-[13px] mb-2">{err}</Txt> : null}
            <View className="flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}><Button testID="tenant-cancel" variant="soft" title={t('sx.c.cancel')} onPress={() => { setDraft(null); setDetail(null); setErr(''); }} full /></View>
              <View style={{ flex: 1 }}><Button testID="tenant-save" title={isNew ? t('sx.c.create') : t('sx.c.save')} loading={busy} onPress={save} full /></View>
            </View>
          </View>
        ) : undefined}>
        {draft ? (
          <View>
            {detail ? <Txt className="text-muted text-[12px] mb-2">{t('sx.tn.created', { date: fmt.date(detail.createdAt) })} · /{detail.slug}</Txt> : null}
            <Input testID="tenant-name" label={t('sx.tn.name')} value={draft.name} onChangeText={(v) => { set('name', v); if (isNew && (!draft.slug || draft.slug === slugify(draft.name))) set('slug', slugify(v)); }} />
            {isNew ? <Input testID="tenant-slug" label={t('sx.tn.slug')} value={draft.slug} onChangeText={(v) => set('slug', slugify(v))} autoCapitalize="none" autoCorrect={false} /> : null}
            {isNew ? <Txt className="text-muted text-[11px]" style={{ marginTop: -6, marginBottom: 10 }}>{t('sx.tn.slugHint')}</Txt> : null}
            {!isDefault ? (<><Label>{t('sx.tn.plan')}</Label>
              <Chips testID="tenant-plan" options={(plans.data || []).map((p) => ({ key: p.id, label: p.name }))} value={draft.planId} onChange={(k) => set('planId', k)} /></>) : null}

            <SectionTitle>{t('sx.tn.contact')}</SectionTitle>
            <Input label={t('sx.tn.contactName')} value={draft.contactName} onChangeText={(v) => set('contactName', v)} />
            <View className="flex-row flex-wrap" style={{ columnGap: 10 }}>
              <View style={{ flexGrow: 1, flexBasis: 200 }}><Input label={t('sx.tn.email')} value={draft.email} onChangeText={(v) => set('email', v)} autoCapitalize="none" keyboardType="email-address" /></View>
              <View style={{ flexGrow: 1, flexBasis: 160 }}><Input label={t('sx.tn.phone')} value={draft.phone} onChangeText={(v) => set('phone', v)} keyboardType="phone-pad" /></View>
            </View>
            <Input label={t('sx.tn.notes')} value={draft.notes} onChangeText={(v) => set('notes', v)} multiline style={{ height: 70, textAlignVertical: 'top' }} />

            {!isDefault ? (<>
              <SectionTitle>{t('sx.tn.limits')}</SectionTitle>
              <Txt className="text-muted text-[12px] mb-2">{t('sx.tn.limitsHint')}</Txt>
              <View className="flex-row flex-wrap" style={{ columnGap: 10 }}>
                {(['maxClients', 'maxAdmins', 'monthlyDesigns', 'startCredits'] as const).map((k) => (
                  <View key={k} style={{ flexGrow: 1, flexBasis: 180 }}><Input testID={`tenant-${k}`} label={t(`sx.tn.${k}`)} value={draft[k]} onChangeText={(v) => set(k, v.replace(/[^\d]/g, ''))} keyboardType="number-pad" placeholder={detail ? limitText(detail.limits[k] ?? null) : t('sx.c.unlimited')} /></View>
                ))}
              </View>
              {catalog ? (<>
                <SectionTitle>{t('sx.tn.overrides')}</SectionTitle>
                <Txt className="text-muted text-[12px] mb-3">{t('sx.tn.overridesHint')}</Txt>
                <PermissionMatrix testID="tenant-overrides" features={catalog.features} groups={catalog.groups} value={draft.overrides} inherit base={plans.data?.find((p) => p.id === draft.planId)?.features} onChange={(v) => set('overrides', v)} />
              </>) : null}
            </>) : null}

            {isNew ? (<>
              <SectionTitle>{t('sx.tn.owner')}</SectionTitle>
              <Pressable testID="tenant-owner-toggle" accessibilityRole="switch" accessibilityState={{ checked: draft.ownerOn }} onPress={() => set('ownerOn', !draft.ownerOn)} className="flex-row items-center mb-2" style={{ gap: 10 }}>
                <Icon name={draft.ownerOn ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} tone={draft.ownerOn ? 'fg' : 'muted'} /><Txt className="text-[14px] font-semibold flex-1">{t('sx.tn.ownerSkip')}</Txt>
              </Pressable>
              <Txt className="text-muted text-[12px] mb-2">{t('sx.tn.ownerHint')}</Txt>
              {draft.ownerOn ? (<>
                <View className="flex-row flex-wrap" style={{ columnGap: 10 }}>
                  <View style={{ flexGrow: 1, flexBasis: 180 }}><Input testID="tenant-owner-user" label={t('sx.ad.username')} value={draft.ownerUser} onChangeText={(v) => set('ownerUser', v.toLowerCase().replace(/\s/g, ''))} autoCapitalize="none" autoCorrect={false} /></View>
                  <View style={{ flexGrow: 1, flexBasis: 180 }}><Input label={t('sx.ad.name')} value={draft.ownerName} onChangeText={(v) => set('ownerName', v)} /></View>
                </View>
                <Input testID="tenant-owner-pass" label={t('sx.ad.password')} value={draft.ownerPass} onChangeText={(v) => set('ownerPass', v)} secureTextEntry autoCapitalize="none" />
                <Txt className="text-muted text-[11px]" style={{ marginTop: -6, marginBottom: 8 }}>{t('sx.ad.passwordHint')}</Txt>
                <Label>{t('sx.ad.role')}</Label>
                <Chips options={ownerRoles.map((r) => ({ key: r.id, label: r.name }))} value={draft.ownerRole} onChange={(k) => set('ownerRole', k)} />
              </>) : null}
            </>) : detail ? (<>
              <SectionTitle>{t('sx.tn.usage')}</SectionTitle>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {[[t('sx.tn.users'), fmt.num(detail.usage.clients)], [t('sx.tn.accounts'), fmt.num(detail.usage.accounts)], [t('sx.dash.requests'), fmt.num(detail.usage.requests)], [t('sx.tn.designs'), fmt.num(detail.usage.designsThisMonth)]].map(([k, v]) => (
                  <View key={k} className="bg-surface2 rounded-xl px-3 py-2" style={{ flexGrow: 1, flexBasis: 130 }}><Txt className="text-muted text-[10px] font-bold uppercase">{k}</Txt><Txt className="font-black text-[18px]">{v}</Txt></View>
                ))}
              </View>
              <SectionTitle>{t('sx.nav.admins')}</SectionTitle>
              <View style={{ gap: 8 }}>
                {detail.status === 'active' ? (
                  <View><Button testID="tenant-open-panel" variant="outline" icon="open-in-new" title={t('sx.tn.openPanel')} loading={busy} onPress={() => openPanel(detail)} /><Txt className="text-muted text-[11px] mt-1">{t('sx.tn.openHint')}</Txt></View>
                ) : null}
                {!isDefault ? (
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {detail.status === 'active'
                      ? <Button testID="tenant-suspend" size="sm" variant="soft" icon="pause-circle-outline" title={t('sx.tn.suspend')} onPress={() => setConfirm('suspend')} />
                      : <Button testID="tenant-activate" size="sm" variant="soft" icon="play-circle-outline" title={t('sx.tn.activate')} loading={busy} onPress={() => setStatus(detail, 'active')} />}
                    <Button testID="tenant-delete" size="sm" variant="danger" icon="delete-outline" title={t('sx.tn.delete')} onPress={() => { setTyped(''); setConfirm('delete'); }} />
                  </View>
                ) : null}
              </View>
            </>) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={confirm === 'suspend' && !!detail} onClose={() => setConfirm(null)}>
        <Txt className="text-[15px] leading-[22px] font-bold text-center mb-3 mt-1">{t('sx.tn.suspendConfirm', { name: detail?.name })}</Txt>
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setConfirm(null)} full /></View>
          <View style={{ flex: 1 }}><Button testID="tenant-suspend-confirm" variant="danger" title={t('sx.tn.suspend')} loading={busy} onPress={() => detail && setStatus(detail, 'suspended')} full /></View>
        </View>
      </Sheet>
      <Sheet visible={confirm === 'delete' && !!detail} onClose={() => setConfirm(null)} title={t('sx.tn.delete')}>
        <Txt className="text-danger text-[13px] font-bold mb-3">{t('sx.tn.deleteWarn')}</Txt>
        <Input testID="tenant-delete-confirm-input" label={t('sx.tn.typeSlug', { slug: detail?.slug })} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} />
        <View className="flex-row gap-2.5">
          <View style={{ flex: 1 }}><Button variant="soft" title={t('sx.c.cancel')} onPress={() => setConfirm(null)} full /></View>
          <View style={{ flex: 1 }}><Button testID="tenant-delete-confirm" variant="danger" disabled={!detail || typed !== detail.slug} title={t('sx.c.delete')} loading={busy} onPress={() => detail && remove(detail)} full /></View>
        </View>
      </Sheet>
    </SuperPage>
  );
}
