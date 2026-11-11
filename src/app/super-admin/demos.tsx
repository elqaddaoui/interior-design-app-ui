import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { Assignment, Demo, Tenant, TenantAdmin } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Heading, Loading, Row, Secret, Sheet, T, ago, openUrl, statusTone, useLoad } from '@/superadmin/ui';

const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

function CreateDemo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [made, setMade] = useState<{ demo: Demo; admin: { email: string; password: string | null } } | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { setMade(await sa('/demos', { method: 'POST', body: { name, description } })); onDone(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New demo" onClose={onClose} testID="sa-create-demo">
      {made ? (
        <View>
          <T weight="bold" style={{ marginBottom: SA.space.sm }}>Demo created with sample data.</T>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>Storefront {made.demo.path} - admin {made.demo.adminPath} - login {made.admin.email}</T>
          {made.admin.password ? <Secret label="Demo admin password" value={made.admin.password} /> : null}
          <Row><Btn label="Open storefront" kind="ghost" onPress={() => openUrl(made.demo.path)} /><Btn label="Open admin" kind="ghost" onPress={() => openUrl(made.demo.adminPath)} /><Btn label="Done" onPress={onClose} /></Row>
        </View>
      ) : (
        <View>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>A demo is a template: a storefront, an admin dashboard and sample data. Customise it as you like, then assign it to any administrator. Each assignment becomes its own independent copy.</T>
          <Field label="Demo name" value={name} onChangeText={setName} autoCapitalize="words" {...({ testID: 'sa-d-name' } as object)} />
          <Field label="Description (optional)" value={description} onChangeText={setDescription} multiline />
          <ErrorLine error={error} />
          <Btn testID="sa-d-create" label="Create demo" onPress={submit} busy={busy} disabled={name.trim().length < 2} />
        </View>
      )}
    </Sheet>
  );
}

function Assign({ demo, onClose, onDone }: { demo: Demo; onClose: () => void; onDone: () => void }) {
  const tenants = useLoad(() => sa<Tenant[]>('/tenants'));
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState(demo.name);
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [fromTenant, setFromTenant] = useState('');
  const admins = useLoad(() => (fromTenant ? sa<TenantAdmin[]>(`/tenants/${fromTenant}/admins`) : Promise.resolve([] as TenantAdmin[])), [fromTenant]);
  const [fromAdmin, setFromAdmin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [made, setMade] = useState<{ tenant: Tenant; admin: { email: string; password: string | null } } | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const owner = mode === 'new' ? { email } : { tenantId: fromTenant, adminId: fromAdmin };
      setMade(await sa(`/demos/${demo.id}/assign`, { method: 'POST', body: { name, slug, owner } })); onDone();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const ready = name.trim().length >= 2 && slug.length >= 3 && (mode === 'new' ? email.includes('@') : !!fromAdmin);
  return (
    <Sheet title={`Assign "${demo.name}"`} onClose={onClose} wide testID="sa-assign-sheet">
      {made ? (
        <View>
          <T weight="bold" style={{ marginBottom: SA.space.sm }}>Independent instance created.</T>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>Storefront {made.tenant.path} - admin {made.tenant.adminPath} - login {made.admin.email}. The original demo was not changed.</T>
          {made.admin.password ? <Secret label="Administrator password" value={made.admin.password} /> : <T size="sm" color={SA.color.ok} style={{ marginBottom: SA.space.md }}>The administrator keeps their existing password.</T>}
          <Row><Btn label="Open storefront" kind="ghost" onPress={() => openUrl(made.tenant.path)} /><Btn label="Done" onPress={onClose} /></Row>
        </View>
      ) : (
        <View>
          <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>This copies the demo (content, settings, media and sample data) into a brand-new tenant. After that the copy and the demo share nothing: edits on either side never reach the other.</T>
          <Row style={{ marginBottom: SA.space.md }}>
            <Btn small label="New administrator" kind={mode === 'new' ? 'solid' : 'ghost'} onPress={() => setMode('new')} />
            <Btn small label="Existing administrator" kind={mode === 'existing' ? 'solid' : 'ghost'} onPress={() => setMode('existing')} />
          </Row>
          <Field label="Instance name" value={name} onChangeText={v => { setName(v); if (!touched) setSlug(slugOf(v)); }} autoCapitalize="words" />
          <Field label="Address (app.com/…)" value={slug} onChangeText={v => { setTouched(true); setSlug(v.toLowerCase()); }} {...({ testID: 'sa-a-slug' } as object)} />
          {mode === 'new' ? <Field label="Administrator e-mail" value={email} onChangeText={setEmail} keyboardType="email-address" {...({ testID: 'sa-a-email' } as object)} /> : (
            <View style={{ marginBottom: SA.space.md }}>
              <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>Pick the administrator</T>
              <Row>{(tenants.data || []).map(t => <Btn key={t.id} small label={t.name} kind={fromTenant === t.id ? 'solid' : 'ghost'} onPress={() => { setFromTenant(t.id); setFromAdmin(''); }} />)}</Row>
              <Row style={{ marginTop: SA.space.sm }}>{(admins.data || []).map(a => <Btn key={a.id} small label={a.email} kind={fromAdmin === a.id ? 'solid' : 'ghost'} onPress={() => setFromAdmin(a.id)} />)}</Row>
            </View>
          )}
          <ErrorLine error={error} />
          <Btn testID="sa-a-assign" label="Create independent instance" onPress={submit} busy={busy} disabled={!ready} />
        </View>
      )}
    </Sheet>
  );
}

function Assignments({ demo, onClose }: { demo: Demo; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => sa<Assignment[]>(`/demos/${demo.id}/assignments`));
  return (
    <Sheet title={`Instances of "${demo.name}"`} onClose={onClose} wide>
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>Not assigned yet.</Empty> : data.map(a => (
        <View key={a.id} style={{ paddingVertical: SA.space.sm, borderTopWidth: 1, borderColor: SA.color.line }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View><T weight="bold">{a.name || '(deleted)'} {a.slug ? `/${a.slug}` : ''}</T><T size="xs" color={SA.color.muted}>{a.ownerEmail} · {ago(a.createdAt)}</T></View>
            <Row>{a.status ? <Badge label={a.status} tone={statusTone(a.status)} /> : <Badge label="deleted" tone="muted" />}{a.slug ? <Btn small kind="ghost" label="Open admin" onPress={() => openUrl(a.adminPath)} /> : null}</Row>
          </Row>
        </View>
      ))}
    </Sheet>
  );
}

function Remove({ demo, onClose, onDone }: { demo: Demo; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const go = async () => { try { await sa(`/demos/${demo.id}`, { method: 'DELETE', body: { confirmSlug: confirm } }); onDone(); onClose(); } catch (e) { setError(saMessage(e)); } };
  return (
    <Sheet title={`Delete "${demo.name}"`} onClose={onClose}>
      <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>Only the demo template is removed. Instances already assigned from it are independent and stay as they are. Type {`"${demo.slug}"`} to confirm.</T>
      <Field label="Type the address" value={confirm} onChangeText={setConfirm} />
      <ErrorLine error={error} />
      <Btn label="Delete demo" kind="danger" disabled={confirm !== demo.slug} onPress={go} />
    </Sheet>
  );
}

export default function Demos() {
  const { data, error, loading, reload } = useLoad(() => sa<Demo[]>('/demos'));
  const [creating, setCreating] = useState(false);
  const [assign, setAssign] = useState<Demo | null>(null);
  const [list, setList] = useState<Demo | null>(null);
  const [remove, setRemove] = useState<Demo | null>(null);
  const publish = async (d: Demo) => { try { await sa(`/demos/${d.id}`, { method: 'PATCH', body: { status: d.status === 'draft' ? 'published' : 'draft' } }); reload(); } catch { /* shown on reload */ } };
  return (
    <View>
      <Heading title="Demos" hint="Template storefronts with an admin dashboard and sample data. Assign one to any administrator: each assignment is an independent copy, so the original and every other instance stay untouched." right={<Btn testID="sa-new-demo" label="New demo" onPress={() => setCreating(true)} />} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No demo yet. Create one, customise it, then assign it.</Empty> : data.map(d => (
        <Card key={d.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <Row><T weight="bold" testID="sa-demo-name">{d.name}</T><Badge label={d.status} tone={statusTone(d.status)} /></Row>
              <T size="sm" color={SA.color.muted}>{d.path} · {d.assignments} assigned{d.description ? ` · ${d.description}` : ''}</T>
            </View>
            <Row>
              <Btn testID="sa-demo-assign" label="Assign" small onPress={() => setAssign(d)} />
              <Btn label="Instances" small kind="ghost" onPress={() => setList(d)} />
              <Btn label="Storefront" small kind="ghost" onPress={() => openUrl(d.path)} />
              <Btn label="Admin" small kind="ghost" onPress={() => openUrl(d.adminPath)} />
              <Btn label={d.status === 'draft' ? 'Publish' : 'Unpublish'} small kind="ghost" onPress={() => publish(d)} />
              <Btn label="Delete" small kind="danger" onPress={() => setRemove(d)} />
            </Row>
          </Row>
        </Card>
      ))}
      {creating ? <CreateDemo onClose={() => setCreating(false)} onDone={reload} /> : null}
      {assign ? <Assign demo={assign} onClose={() => setAssign(null)} onDone={reload} /> : null}
      {list ? <Assignments demo={list} onClose={() => setList(null)} /> : null}
      {remove ? <Remove demo={remove} onClose={() => setRemove(null)} onDone={reload} /> : null}
    </View>
  );
}
