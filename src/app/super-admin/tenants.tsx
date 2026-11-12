import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { loginFields, parseLimit, sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { ApiConn, ApiKind, Demo, NewAdmin, Tenant, TenantAdmin, Domain } from '@/superadmin/types';
import { IconBtn } from '@/superadmin/icons';
import { Badge, Btn, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Meter, Notice, Pair, Row, Secret, Segmented, Sheet, T, Tabs, Toolbar, ago, openAdminSession, openUrl, statusTone, useLoad } from '@/superadmin/ui';

const slugOf = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const enc = (id: string) => encodeURIComponent(id);

/** Credits + API fields shared by "new store" and the store's Credits & APIs tab. */
function Allowance({ limit, setLimit, mode, setMode }: { limit: string; setLimit: (v: string) => void; mode: 'own' | 'platform'; setMode: (v: 'own' | 'platform') => void }) {
  return (
    <View>
      <Field label="Credit limit (empty = unlimited)" value={limit} onChangeText={v => setLimit(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="Unlimited" {...({ testID: 'sa-t-limit' } as object)} />
      <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>AI keys</T>
      <Segmented value={mode} onChange={setMode} testID="sa-t-mode" options={[{ value: 'own', label: 'Store manages its own', testID: 'sa-mode-own' }, { value: 'platform', label: 'Managed by me (API manager)', testID: 'sa-mode-platform' }]} />
      <Hint>{mode === 'platform' ? ' The store cannot see or change AI keys. It uses the connections you set in APIs.' : ' The store administrator adds its own AI keys in its panel.'}</Hint>
    </View>
  );
}

/** One sheet = a complete store: name, address, optional demo to start from, first administrator, credits, API mode. */
function CreateTenant({ onClose, onDone, initialDemo }: { onClose: () => void; onDone: () => void; initialDemo?: string }) {
  const demos = useLoad(() => sa<Demo[]>('/demos'));
  const [form, setForm] = useState({ name: '', slug: '', login: '', ownerName: '', password: '', plan: '' });
  const [demoId, setDemoId] = useState(initialDemo || '');
  const [limit, setLimit] = useState('');
  const [mode, setMode] = useState<'own' | 'platform'>('own');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<{ tenant: Tenant; admin: NewAdmin } | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm(f => ({ ...f, [key]: value, ...(key === 'name' && !touched ? { slug: slugOf(value) } : {}) }));
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const policy = { creditLimit: parseLimit(limit), apiMode: mode };
      const common = { name: form.name, slug: form.slug, plan: form.plan, ...policy };
      const owner = { ...loginFields(form.login), name: form.ownerName, password: form.password || undefined };
      // From a demo: ONE request copies the demo into a new independent store and creates its administrator.
      const r = demoId
        ? await sa<{ tenant: Tenant; admin: NewAdmin }>(`/demos/${demoId}/assign`, { method: 'POST', body: { ...common, owner } })
        : await sa<{ tenant: Tenant; admin: NewAdmin }>('/tenants', { method: 'POST', body: { ...common, ownerUsername: (owner as { username?: string }).username, ownerLogin: (owner as { email?: string }).email, ownerName: form.ownerName, password: form.password || undefined } });
      setCreated(r); onDone();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const published = (demos.data || []);
  return (
    <Sheet title="New store" onClose={onClose} wide testID="sa-create-tenant">
      {created ? (
        <View>
          <T weight="bold" style={{ marginBottom: SA.space.sm }}>Store created.</T>
          <Hint>{`Storefront /${created.tenant.slug} · Admin panel /${created.tenant.slug}/admin · Sign in with "${created.admin.email || created.admin.username}"${created.admin.email && created.admin.username !== created.admin.email ? ` or "${created.admin.username}"` : ''}.`}</Hint>
          {created.admin.password ? <Secret label="Administrator password" value={created.admin.password} /> : <Notice tone="ok">The administrator keeps their existing password.</Notice>}
          <Row><Btn label="Open admin panel" kind="ghost" onPress={() => openUrl(created.tenant.adminPath)} /><Btn label="Done" onPress={onClose} /></Row>
        </View>
      ) : (
        <View>
          <Pair>
            <Field label="Business name" value={form.name} onChangeText={set('name')} autoCapitalize="words" {...({ testID: 'sa-t-name' } as object)} />
            <Field label="Address (app.com/…)" value={form.slug} onChangeText={v => { setTouched(true); set('slug')(v.toLowerCase()); }} {...({ testID: 'sa-t-slug' } as object)} />
          </Pair>
          {published.length ? (
            <View style={{ marginBottom: SA.space.md }}>
              <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>Start from</T>
              <Row>
                <Btn small label="Empty store" kind={!demoId ? 'solid' : 'ghost'} onPress={() => setDemoId('')} />
                {published.map(d => <Btn key={d.id} small label={d.name} kind={demoId === d.id ? 'solid' : 'ghost'} onPress={() => setDemoId(d.id)} />)}
              </Row>
              {demoId ? <Hint>{' A private copy of this demo (content, settings, pictures, sample data). Later edits never reach the demo or other stores.'}</Hint> : null}
            </View>
          ) : null}
          <Pair>
            <Field label="Administrator sign-in (user name or e-mail, optional)" value={form.login} onChangeText={set('login')} placeholder="admin" {...({ testID: 'sa-t-email' } as object)} />
            <Field label="Administrator name (optional)" value={form.ownerName} onChangeText={set('ownerName')} autoCapitalize="words" />
          </Pair>
          <Field label="Password (empty = generated for you)" value={form.password} onChangeText={set('password')} secureTextEntry />
          <Allowance limit={limit} setLimit={setLimit} mode={mode} setMode={setMode} />
          <ErrorLine error={error} />
          <Btn testID="sa-t-create" label="Create store" onPress={submit} busy={busy} disabled={form.name.trim().length < 2 || form.slug.length < 3} />
        </View>
      )}
    </Sheet>
  );
}

function Admins({ tenant }: { tenant: Tenant }) {
  const { data, error, reload } = useLoad(() => sa<TenantAdmin[]>(`/tenants/${tenant.id}/admins`));
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const act = async (work: () => Promise<unknown>) => { setProblem(null); try { await work(); reload(); } catch (e) { setProblem(saMessage(e)); } };
  return (
    <View>
      <Hint>Several administrators can manage the same store. Each one signs in with a user name or an e-mail.</Hint>
      <ErrorLine error={error || problem} />
      {secret ? <Secret label={secret.label} value={secret.value} /> : null}
      {(data || []).map(a => (
        <View key={a.id} style={{ paddingVertical: SA.space.sm, borderTopWidth: 1, borderColor: SA.color.line }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flexShrink: 1 }}>
              <T weight="bold" testID="sa-admin-email">{a.username || a.email}</T>
              <T size="xs" color={SA.color.muted}>{[a.name, a.username && a.email ? a.email : '', `last sign-in ${ago(a.lastLoginAt)}`].filter(Boolean).join(' · ')}</T>
            </View>
            {a.disabled ? <Badge label="disabled" tone="danger" /> : <Badge label="active" tone="ok" />}
          </Row>
          <Row style={{ marginTop: SA.space.sm }}>
            <Btn small kind="ghost" label={a.disabled ? 'Enable' : 'Disable'} onPress={() => act(() => sa(`/tenants/${tenant.id}/admins/${enc(a.id)}`, { method: 'PATCH', body: { disabled: !a.disabled } }))} />
            <Btn small kind="ghost" label="Reset password" onPress={() => act(async () => { const r = await sa<{ password: string }>(`/tenants/${tenant.id}/admins/${enc(a.id)}/password`, { method: 'POST', body: {} }); setSecret({ label: `New password for ${a.username || a.email}`, value: r.password }); })} />
            <Btn small kind="danger" label="Remove" onPress={() => act(() => sa(`/tenants/${tenant.id}/admins/${enc(a.id)}`, { method: 'DELETE' }))} />
          </Row>
        </View>
      ))}
      <View style={{ marginTop: SA.space.lg, borderTopWidth: 1, borderColor: SA.color.line, paddingTop: SA.space.lg }}>
        <T weight="bold" style={{ marginBottom: SA.space.sm }}>Add an administrator</T>
        <Pair>
          <Field label="User name or e-mail" value={login} onChangeText={setLogin} placeholder="sara" {...({ testID: 'sa-admin-login' } as object)} />
          <Field label="Name (optional)" value={name} onChangeText={setName} autoCapitalize="words" />
        </Pair>
        <Btn label="Add administrator" disabled={!login.trim()} onPress={() => act(async () => {
          const r = await sa<{ password: string | null }>(`/tenants/${tenant.id}/admins`, { method: 'POST', body: { ...loginFields(login), name } });
          if (r.password) setSecret({ label: `Password for ${login.trim()}`, value: r.password });
          setLogin(''); setName('');
        })} />
      </View>
    </View>
  );
}

/** Credits and API source for this store: the two "limits" of a store, in one place. */
function Plan({ tenant, onChanged }: { tenant: Tenant; onChanged: () => void }) {
  const apis = useLoad(() => sa<{ apis: ApiConn[] }>('/apis'));
  const [limit, setLimit] = useState(tenant.creditLimit == null ? '' : String(tenant.creditLimit));
  const [mode, setMode] = useState<'own' | 'platform'>(tenant.apiMode);
  const [links, setLinks] = useState<Partial<Record<ApiKind, string>>>(tenant.apiLinks || {});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const run = async (key: string, body: object, message: string) => {
    setBusy(key); setError(null); setNote('');
    try { await sa(`/tenants/${tenant.id}`, { method: 'PATCH', body }); setNote(message); onChanged(); } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };
  const kinds: [ApiKind, string][] = [['image', 'Image AI'], ['text', 'Text AI (assistant)']];
  return (
    <View>
      <T weight="bold" style={{ marginBottom: SA.space.sm }}>Credits</T>
      <Meter used={tenant.creditsUsed} limit={tenant.creditLimit} testID="sa-t-meter" />
      <Hint>{' One AI picture = one credit. When the limit is reached the store cannot create new pictures until you raise it.'}</Hint>
      <Field label="Credit limit (empty = unlimited)" value={limit} onChangeText={v => setLimit(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="Unlimited" {...({ testID: 'sa-t-limit' } as object)} />
      <Row style={{ marginBottom: SA.space.xl }}>
        <Btn testID="sa-t-limit-save" label="Save limit" busy={busy === 'limit'} onPress={() => run('limit', { creditLimit: parseLimit(limit) }, 'Limit saved.')} />
        <Btn label="Reset used to 0" kind="ghost" busy={busy === 'reset'} onPress={() => run('reset', { resetUsed: true }, 'Counter reset.')} />
      </Row>
      <T weight="bold" style={{ marginBottom: SA.space.sm }}>AI keys</T>
      <Segmented value={mode} onChange={setMode} options={[{ value: 'own', label: 'Store manages its own' }, { value: 'platform', label: 'Managed by me', testID: 'sa-mode-platform' }]} />
      <Hint>{mode === 'platform' ? ' API access is removed from the store panel: its administrators cannot see or change keys. Choose which connection it uses below (or leave the shared default).' : ' The store administrator keeps API access in its own panel (AI models, assistant).'}</Hint>
      {mode === 'platform' ? kinds.map(([kind, label]) => {
        const list = (apis.data?.apis || []).filter(a => a.kind === kind && a.enabled);
        return (
          <View key={kind} style={{ marginBottom: SA.space.md }}>
            <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</T>
            {!list.length ? <T size="sm" color={SA.color.warn}>No connection yet. Add one in APIs, or this store will have no AI of this kind.</T> : (
              <Row>
                <Btn small label="Shared default" kind={!links[kind] ? 'solid' : 'ghost'} onPress={() => setLinks(l => ({ ...l, [kind]: '' }))} />
                {list.map(a => <Btn key={a.id} small label={a.label} kind={links[kind] === a.id ? 'solid' : 'ghost'} onPress={() => setLinks(l => ({ ...l, [kind]: a.id }))} />)}
              </Row>
            )}
          </View>
        );
      }) : null}
      <ErrorLine error={error} />
      {note ? <T size="sm" color={SA.color.ok} style={{ marginBottom: SA.space.md }}>{note}</T> : null}
      <Btn testID="sa-t-mode-save" label="Save AI keys" busy={busy === 'mode'} onPress={() => run('mode', { apiMode: mode, ...(mode === 'platform' ? { apiLinks: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v || null])) } : {}) }, 'Saved.')} />
    </View>
  );
}

function Domains({ tenant }: { tenant: Tenant }) {
  const { data, error, reload } = useLoad(() => sa<Domain[]>(`/tenants/${tenant.id}/domains`));
  const [domain, setDomain] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const act = async (work: () => Promise<unknown>) => { setProblem(null); try { await work(); reload(); } catch (e) { setProblem(saMessage(e)); } };
  return (
    <View>
      <Hint>A custom domain only works after its DNS TXT record is found.</Hint>
      <ErrorLine error={error || problem} />
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

function Details({ tenant, onClose, onChanged }: { tenant: Tenant; onClose: () => void; onChanged: () => void }) {
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
    <View>
      <Row style={{ marginBottom: SA.space.lg }}>
        <Btn small kind="ghost" icon="storefrontOutline" label="Open storefront" onPress={() => openUrl(tenant.path)} /><Btn small kind="ghost" icon="shieldAccountOutline" label="Open admin panel (signed in)" onPress={() => { void openAdminSession(tenant.id); }} />
      </Row>
      <Pair>
        <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
        {!isDefault ? <Field label="Address" value={slug} onChangeText={setSlug} /> : <View />}
      </Pair>
      <Field label="Plan label" value={plan} onChangeText={setPlan} />
      <Field label="Internal notes" value={notes} onChangeText={setNotes} multiline />
      <ErrorLine error={error} />
      <Row style={{ marginBottom: SA.space.xl }}>
        <Btn testID="sa-t-save" label="Save changes" busy={busy === 'save'} onPress={() => run('save', () => sa(`/tenants/${tenant.id}`, { method: 'PATCH', body: { name, plan, notes, ...(isDefault ? {} : { slug }) } }))} />
        {saved ? <T size="sm" color={SA.color.ok}>Saved.</T> : null}
        {!isDefault ? <Btn testID="sa-t-suspend" label={tenant.status === 'suspended' ? 'Unsuspend' : 'Suspend'} kind={tenant.status === 'suspended' ? 'ghost' : 'danger'} busy={busy === 'suspend'} onPress={() => run('suspend', () => sa(`/tenants/${tenant.id}/${tenant.status === 'suspended' ? 'unsuspend' : 'suspend'}`, { method: 'POST', body: {} }), true)} /> : null}
      </Row>
      {!isDefault ? (
        <View style={{ borderTopWidth: 1, borderColor: SA.color.dangerSoft, paddingTop: SA.space.lg }}>
          <T weight="bold" color={SA.color.danger}>Delete this store</T>
          <T size="sm" color={SA.color.muted} style={{ marginVertical: SA.space.sm }}>Removes its content, clients, sessions, media and administrators for good. Type {`"${tenant.slug}"`} to confirm.</T>
          <Field label="Type the address" value={confirm} onChangeText={setConfirm} {...({ testID: 'sa-t-confirm' } as object)} />
          <Btn testID="sa-t-delete" label="Delete store" kind="danger" disabled={confirm !== tenant.slug} busy={busy === 'delete'} onPress={() => run('delete', () => sa(`/tenants/${tenant.id}`, { method: 'DELETE', body: { confirmSlug: confirm } }), true)} />
        </View>
      ) : null}
    </View>
  );
}

type TabKey = 'details' | 'admins' | 'plan' | 'domains';
function Manage({ tenant, onClose, onChanged }: { tenant: Tenant; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<TabKey>('admins');
  return (
    <Sheet title={tenant.name} onClose={onClose} wide testID="sa-tenant-sheet">
      <Row style={{ marginBottom: SA.space.md }}><Badge label={tenant.status} tone={statusTone(tenant.status)} />{tenant.kind === 'default' ? <Badge label="default" tone="accent" /> : null}<T size="sm" color={SA.color.muted}>{tenant.path}</T></Row>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'admins', label: 'Administrators', testID: 'sa-tab-admins' }, { value: 'plan', label: 'Credits & APIs', testID: 'sa-tab-plan' }, { value: 'domains', label: 'Domains', testID: 'sa-tab-domains' }, { value: 'details', label: 'Settings', testID: 'sa-tab-details' }]} />
      {tab === 'admins' ? <Admins tenant={tenant} /> : tab === 'plan' ? <Plan tenant={tenant} onChanged={onChanged} /> : tab === 'domains' ? <Domains tenant={tenant} /> : <Details tenant={tenant} onClose={onClose} onChanged={onChanged} />}
    </Sheet>
  );
}

export default function Tenants() {
  const params = useLocalSearchParams<{ new?: string; demo?: string }>();
  const { data, error, loading, reload } = useLoad(() => sa<Tenant[]>('/tenants'));
  const [creating, setCreating] = useState(params.new === '1' || !!params.demo); // opened by a link (Overview, Demos)
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState('');
  const quickAdmin = async (t: Tenant) => { setProblem(await openAdminSession(t.id)); };
  const open = (data || []).find(t => t.id === openId) || null; // always the freshest copy after a save
  const shown = useMemo(() => (data || []).filter(t => !query.trim() || `${t.name} ${t.slug} ${t.ownerEmail}`.toLowerCase().includes(query.trim().toLowerCase())), [data, query]);
  return (
    <View>
      <Heading title="Stores" hint="Each store has its own storefront, admin panel, data, credits and AI keys, at /address or on its own domain." right={<Btn testID="sa-new-tenant" label="New store" onPress={() => setCreating(true)} />} />
      <ErrorLine error={error || problem} />
      {(data || []).length > 6 ? <Toolbar><View style={{ flex: 1, minWidth: 200 }}><Field label="Search" value={query} onChangeText={setQuery} placeholder="Name or address" /></View></Toolbar> : null}
      {loading && !data ? <Loading /> : !shown.length ? <Empty>{data?.length ? 'No match.' : 'No store yet.'}</Empty> : shown.map(t => (
        <ListRow key={t.id} testID="sa-manage" titleTestID="sa-tenant-name" title={t.name} onPress={() => setOpenId(t.id)}
          meta={<Row style={{ gap: 4 }}><Badge label={t.status} tone={statusTone(t.status)} />{t.kind === 'default' ? <Badge label="default" tone="accent" /> : null}{t.sourceDemoId ? <Badge label="from demo" tone="accent" /> : null}{t.apiMode === 'platform' ? <Badge label="API managed" tone="accent" /> : null}</Row>}
          sub={`${t.path} · ${t.counts ? `${t.counts.admins} admin${t.counts.admins === 1 ? '' : 's'} · ${t.counts.clients} clients` : ''}`}
          right={
            <Row style={{ gap: SA.space.md, flexWrap: 'wrap' }}>
              <View style={{ minWidth: 140 }}><Meter used={t.creditsUsed} limit={t.creditLimit} /></View>
              <Row style={{ gap: 6, flexWrap: 'nowrap' }}>
                <IconBtn testID="sa-quick-store" icon="storefrontOutline" label={`Open the storefront of ${t.name}`} onPress={() => openUrl(t.path)} />
                <IconBtn testID="sa-quick-admin" icon="shieldAccountOutline" label={`Open the admin dashboard of ${t.name} (signed in)`} disabled={t.status === 'suspended'} tone="accent" onPress={() => { void quickAdmin(t); }} />
                <IconBtn testID="sa-quick-manage" icon="cogOutline" label={`Manage ${t.name}`} onPress={() => setOpenId(t.id)} />
              </Row>
            </Row>} />
      ))}
      {creating ? <CreateTenant initialDemo={params.demo} onClose={() => setCreating(false)} onDone={reload} /> : null}
      {open ? <Manage tenant={open} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
    </View>
  );
}
