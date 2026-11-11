import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { Domain, Tenant, TenantAdmin } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Heading, Loading, Row, Secret, Sheet, T, ago, openUrl, statusTone, useLoad } from '@/superadmin/ui';

const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function CreateTenant({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', slug: '', ownerEmail: '', ownerName: '', plan: '' });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ slug: string; email: string; password: string | null } | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm(f => ({ ...f, [key]: value, ...(key === 'name' && !touched ? { slug: slugOf(value) } : {}) }));
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await sa<{ tenant: Tenant; admin: { email: string; password: string | null } }>('/tenants', { method: 'POST', body: form });
      setCreated({ slug: r.tenant.slug, email: r.admin.email, password: r.admin.password }); onDone();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New tenant" onClose={onClose} testID="sa-create-tenant">
      {created ? (
        <View>
          <T weight="bold" style={{ marginBottom: SA.space.md }}>Tenant created.</T>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>Storefront: /{created.slug} - Admin panel: /{created.slug}/admin - Login: {created.email}</T>
          {created.password ? <Secret label="Admin password" value={created.password} /> : null}
          <Btn label="Done" onPress={onClose} />
        </View>
      ) : (
        <View>
          <Field label="Business name" value={form.name} onChangeText={set('name')} autoCapitalize="words" {...({ testID: 'sa-t-name' } as object)} />
          <Field label="Address (app.com/…)" value={form.slug} onChangeText={v => { setTouched(true); set('slug')(v.toLowerCase()); }} {...({ testID: 'sa-t-slug' } as object)} />
          <Field label="Administrator e-mail" value={form.ownerEmail} onChangeText={set('ownerEmail')} keyboardType="email-address" {...({ testID: 'sa-t-email' } as object)} />
          <Field label="Administrator name (optional)" value={form.ownerName} onChangeText={set('ownerName')} autoCapitalize="words" />
          <Field label="Plan label (optional)" value={form.plan} onChangeText={set('plan')} />
          <ErrorLine error={error} />
          <Btn testID="sa-t-create" label="Create tenant" onPress={submit} busy={busy} disabled={!form.name || !form.slug || !form.ownerEmail} />
        </View>
      )}
    </Sheet>
  );
}

function Admins({ tenant }: { tenant: Tenant }) {
  const { data, error, reload } = useLoad(() => sa<TenantAdmin[]>(`/tenants/${tenant.id}/admins`));
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const act = async (work: () => Promise<unknown>) => { setProblem(null); try { await work(); reload(); } catch (e) { setProblem(saMessage(e)); } };
  const enc = (id: string) => encodeURIComponent(id);
  return (
    <View>
      <T weight="bold" style={{ marginBottom: SA.space.sm }}>Administrators</T>
      <ErrorLine error={error || problem} />
      {secret ? <Secret label={secret.label} value={secret.value} /> : null}
      {(data || []).map(a => (
        <View key={a.id} style={{ paddingVertical: SA.space.sm, borderTopWidth: 1, borderColor: SA.color.line }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View><T weight="bold" testID="sa-admin-email">{a.email}</T><T size="xs" color={SA.color.muted}>last sign-in {ago(a.lastLoginAt)}</T></View>
            {a.disabled ? <Badge label="disabled" tone="danger" /> : <Badge label="active" tone="ok" />}
          </Row>
          <Row style={{ marginTop: SA.space.sm }}>
            <Btn small kind="ghost" label={a.disabled ? 'Enable' : 'Disable'} onPress={() => act(() => sa(`/tenants/${tenant.id}/admins/${enc(a.id)}`, { method: 'PATCH', body: { disabled: !a.disabled } }))} />
            <Btn small kind="ghost" label="Reset password" onPress={() => act(async () => { const r = await sa<{ password: string }>(`/tenants/${tenant.id}/admins/${enc(a.id)}/password`, { method: 'POST', body: {} }); setSecret({ label: `New password for ${a.email}`, value: r.password }); })} />
            <Btn small kind="danger" label="Remove" onPress={() => act(() => sa(`/tenants/${tenant.id}/admins/${enc(a.id)}`, { method: 'DELETE' }))} />
          </Row>
        </View>
      ))}
      <Row style={{ marginTop: SA.space.md, alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 200 }}><Field label="Add an administrator (e-mail)" value={email} onChangeText={setEmail} keyboardType="email-address" /></View>
        <View style={{ marginBottom: SA.space.md }}><Btn label="Add" disabled={!email} onPress={() => act(async () => { const r = await sa<{ password: string | null }>(`/tenants/${tenant.id}/admins`, { method: 'POST', body: { email } }); setEmail(''); if (r.password) setSecret({ label: `Password for ${email}`, value: r.password }); })} /></View>
      </Row>
    </View>
  );
}

function Domains({ tenant }: { tenant: Tenant }) {
  const { data, error, reload } = useLoad(() => sa<Domain[]>(`/tenants/${tenant.id}/domains`));
  const [domain, setDomain] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const act = async (work: () => Promise<unknown>) => { setProblem(null); try { await work(); reload(); } catch (e) { setProblem(saMessage(e)); } };
  return (
    <View style={{ marginTop: SA.space.lg }}>
      <T weight="bold" style={{ marginBottom: SA.space.sm }}>Custom domains</T>
      <ErrorLine error={error || problem} />
      {!(data || []).length ? <T size="sm" color={SA.color.muted}>None. A domain only works after its DNS TXT record is found.</T> : null}
      {(data || []).map(d => (
        <View key={d.domain} style={{ paddingVertical: SA.space.sm, borderTopWidth: 1, borderColor: SA.color.line }}>
          <Row style={{ justifyContent: 'space-between' }}><T weight="bold">{d.domain}</T><Badge label={d.verified ? 'verified' : 'pending'} tone={d.verified ? 'ok' : 'warn'} /></Row>
          {!d.verified ? <T size="xs" color={SA.color.muted} selectable style={{ marginTop: 4 }}>TXT {d.txtName} = {d.txtValue}</T> : null}
          <Row style={{ marginTop: SA.space.sm }}>
            {!d.verified ? <Btn small label="Check DNS" onPress={() => act(() => sa(`/tenants/${tenant.id}/domains/verify`, { method: 'POST', body: { domain: d.domain } }))} /> : null}
            {!d.verified ? <Btn small kind="ghost" label="Mark verified" onPress={() => act(() => sa(`/tenants/${tenant.id}/domains/verify`, { method: 'POST', body: { domain: d.domain, force: true } }))} /> : null}
            <Btn small kind="danger" label="Remove" onPress={() => act(() => sa(`/tenants/${tenant.id}/domains/remove`, { method: 'POST', body: { domain: d.domain } }))} />
          </Row>
        </View>
      ))}
      <Row style={{ marginTop: SA.space.md, alignItems: 'flex-end' }}>
        <View style={{ flex: 1, minWidth: 200 }}><Field label="Add a domain" value={domain} onChangeText={setDomain} placeholder="brand.com" /></View>
        <View style={{ marginBottom: SA.space.md }}><Btn label="Add" disabled={!domain} onPress={() => act(async () => { await sa(`/tenants/${tenant.id}/domains`, { method: 'POST', body: { domain } }); setDomain(''); })} /></View>
      </Row>
    </View>
  );
}

function Manage({ tenant, onClose, onChanged }: { tenant: Tenant; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(tenant.name);
  const [plan, setPlan] = useState(tenant.plan);
  const [notes, setNotes] = useState(tenant.notes);
  const [slug, setSlug] = useState(tenant.slug);
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState('');
  const run = async (key: string, work: () => Promise<unknown>, close = false) => {
    setBusy(key); setError(null); setSaved(false);
    try { await work(); onChanged(); if (close) onClose(); else setSaved(true); } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };
  const isDefault = tenant.kind === 'default';
  return (
    <Sheet title={tenant.name} onClose={onClose} wide testID="sa-tenant-sheet">
      <Row style={{ marginBottom: SA.space.lg }}>
        <Badge label={tenant.status} tone={statusTone(tenant.status)} /><Badge label={tenant.kind} />
        <Btn small kind="ghost" label="Open storefront" onPress={() => openUrl(tenant.path)} /><Btn small kind="ghost" label="Open admin panel" onPress={() => openUrl(tenant.adminPath)} />
      </Row>
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      {!isDefault ? <Field label="Address" value={slug} onChangeText={setSlug} /> : null}
      <Field label="Plan label" value={plan} onChangeText={setPlan} />
      <Field label="Internal notes" value={notes} onChangeText={setNotes} multiline />
      <ErrorLine error={error} />
      <Row style={{ marginBottom: SA.space.xl }}>
        <Btn testID="sa-t-save" label="Save changes" busy={busy === 'save'} onPress={() => run('save', () => sa(`/tenants/${tenant.id}`, { method: 'PATCH', body: { name, plan, notes, ...(isDefault ? {} : { slug }) } }))} />
        {saved ? <T size="sm" color={SA.color.ok}>Saved.</T> : null}
        {!isDefault ? <Btn testID="sa-t-suspend" label={tenant.status === 'suspended' ? 'Unsuspend' : 'Suspend'} kind={tenant.status === 'suspended' ? 'ghost' : 'danger'} busy={busy === 'suspend'} onPress={() => run('suspend', () => sa(`/tenants/${tenant.id}/${tenant.status === 'suspended' ? 'unsuspend' : 'suspend'}`, { method: 'POST', body: {} }), true)} /> : null}
      </Row>
      <Admins tenant={tenant} />
      <Domains tenant={tenant} />
      {!isDefault ? (
        <View style={{ marginTop: SA.space.xl, borderTopWidth: 1, borderColor: SA.color.danger, paddingTop: SA.space.lg }}>
          <T weight="bold" color={SA.color.danger}>Delete this tenant</T>
          <T size="sm" color={SA.color.muted} style={{ marginVertical: SA.space.sm }}>Removes its content, clients, requests, sessions, media and administrators for good. Type {`"${tenant.slug}"`} to confirm.</T>
          <Field label="Type the address" value={confirm} onChangeText={setConfirm} {...({ testID: 'sa-t-confirm' } as object)} />
          <Btn testID="sa-t-delete" label="Delete tenant" kind="danger" disabled={confirm !== tenant.slug} busy={busy === 'delete'} onPress={() => run('delete', () => sa(`/tenants/${tenant.id}`, { method: 'DELETE', body: { confirmSlug: confirm } }), true)} />
        </View>
      ) : null}
    </Sheet>
  );
}

export default function Tenants() {
  const { data, error, loading, reload } = useLoad(() => sa<Tenant[]>('/tenants'));
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Tenant | null>(null);
  return (
    <View>
      <Heading title="Tenants" hint="Each tenant has its own storefront, admin panel and data at /address, or on its own domain." right={<Btn testID="sa-new-tenant" label="New tenant" onPress={() => setCreating(true)} />} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No tenant yet.</Empty> : data.map(t => (
        <Card key={t.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Row><T weight="bold" testID="sa-tenant-name">{t.name}</T><Badge label={t.status} tone={statusTone(t.status)} />{t.kind === 'default' ? <Badge label="default" tone="accent" /> : null}{t.sourceDemoId ? <Badge label="from demo" tone="accent" /> : null}</Row>
              <T size="sm" color={SA.color.muted}>{t.path} · {t.ownerEmail || 'no owner'}{t.plan ? ` · ${t.plan}` : ''}</T>
              {t.counts ? <T size="xs" color={SA.color.muted}>{t.counts.clients} clients · {t.counts.requests} requests · {t.counts.admins} admins{t.counts.openRequests ? ` · ${t.counts.openRequests} open change requests` : ''}</T> : null}
            </View>
            <Btn testID="sa-manage" label="Manage" kind="ghost" small onPress={() => setOpen(t)} />
          </Row>
        </Card>
      ))}
      {creating ? <CreateTenant onClose={() => setCreating(false)} onDone={reload} /> : null}
      {open ? <Manage tenant={open} onClose={() => setOpen(null)} onChanged={reload} /> : null}
    </View>
  );
}
