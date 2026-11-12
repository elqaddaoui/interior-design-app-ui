import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parseLimit, sa, saMessage } from '@/superadmin/api';
import { Icon, IconBtn } from '@/superadmin/icons';
import { LivePreviews, ViewSwitch, type ViewMode } from '@/superadmin/LivePreviews';
import { ThemePreview } from '@/superadmin/ThemePreview';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { Assignment, Demo, NewAdmin, StoreTheme } from '@/superadmin/types';
import { Badge, Btn, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Meter, Pair, Row, Sheet, T, ago, openAdminSession, openUrl, statusTone, useLoad } from '@/superadmin/ui';

/** A demo is a template store. Optional: start from a saved store theme (look only, no client data) and set its credit limit. */
function CreateDemo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const themes = useLoad(() => sa<StoreTheme[]>('/themes'));
  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState('');
  const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [made, setMade] = useState<{ demo: Demo; admin: NewAdmin } | null>(null);
  const [opening, setOpening] = useState('');
  const submit = async () => {
    setBusy(true); setError(null);
    try { setMade(await sa('/demos', { method: 'POST', body: { name, ...(themeId ? { themeId } : {}), creditLimit: parseLimit(limit) } })); onDone(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={tr('New demo')} onClose={onClose} testID="sa-create-demo" wide="xl">
      {made ? (
        <View>
          <T weight="bold" style={{ marginBottom: SA.space.sm }}>{themeId ? tr('Demo created with the chosen theme.') : tr('Demo created with sample data.')}</T>
          <Hint>{tr('Storefront {path} · admin panel {admin}.', { path: made.demo.path, admin: made.demo.adminPath })}</Hint>
          <ErrorLine error={opening} />
          <Row><Btn label={tr('Open storefront')} kind="ghost" icon="storefrontOutline" onPress={() => openUrl(made.demo.path)} /><Btn label={tr('Customize')} kind="ghost" icon="brush" onPress={async () => setOpening(await openAdminSession(made.demo.tenantId))} /><Btn label={tr('Done')} onPress={onClose} /></Row>
        </View>
      ) : (
        <View>
          <Hint>{tr('A demo is a template store. Choose a look to start from, or none for the standard sample store. Stores created from it get their own independent copy.')}</Hint>
          <Pair>
            <Field label={tr('Demo name')} value={name} onChangeText={setName} autoCapitalize="words" {...({ testID: 'sa-d-name' } as object)} />
            <Field label={tr('Credit limit (empty = unlimited)')} value={limit} onChangeText={v => setLimit(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder={tr('Unlimited')} {...({ testID: 'sa-d-limit' } as object)} />
          </Pair>
          <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{tr('Theme')}</T>
          {themes.loading && !themes.data ? <Loading /> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md, marginBottom: SA.space.lg }}>
              <ThemeChoice testID="sa-d-theme-none" label={tr('Standard sample store')} sub={tr('No theme')} on={!themeId} onPress={() => setThemeId('')} />
              {(themes.data || []).map(th => <ThemeChoice key={th.id} testID="sa-d-theme" label={th.name} sub={th.sourceName ? tr('from {name}', { name: th.sourceName }) : tr('saved theme')} theme={th} on={themeId === th.id} onPress={() => setThemeId(th.id)} />)}
            </View>
          )}
          {!themes.loading && !(themes.data || []).length ? <Hint>{tr('No saved theme yet. Add some in Clone Existing Store to clone a store look.')}</Hint> : null}
          <ErrorLine error={error || themes.error} />
          <Btn testID="sa-d-create" icon="plus" label={tr('Create demo')} onPress={submit} busy={busy} disabled={name.trim().length < 2} />
        </View>
      )}
    </Sheet>
  );
}

/** One selectable theme card (radio behaviour) with a live miniature. */
function ThemeChoice({ label, sub, theme, on, onPress, testID }: { label: string; sub: string; theme?: StoreTheme; on: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label} onPress={onPress}
      style={{ flexGrow: 1, flexBasis: 200, minWidth: 180, maxWidth: 300, padding: SA.space.sm, borderRadius: SA.radius.lg, borderWidth: 2, borderColor: on ? SA.color.accent : SA.color.line, backgroundColor: on ? SA.color.accentSoft : SA.color.panel }}>
      {theme ? <ThemePreview theme={theme} height={170} /> : <View style={{ height: 170, borderRadius: SA.radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: SA.color.line, alignItems: 'center', justifyContent: 'center', backgroundColor: SA.color.panel2 }}><Icon name="storefrontOutline" size={34} color={SA.color.muted} /></View>}
      <Row style={{ marginTop: SA.space.sm, flexWrap: 'nowrap', justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}><T size="sm" weight="bold" numberOfLines={1}>{label}</T><T size="xs" color={SA.color.muted} numberOfLines={1}>{sub}</T></View>
        {on ? <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: SA.color.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={14} color={SA.color.onAccent} /></View> : null}
      </Row>
    </Pressable>
  );
}

function Instances({ demo, onClose }: { demo: Demo; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => sa<Assignment[]>(`/demos/${demo.id}/assignments`));
  return (
    <Sheet title={tr('Stores from "{name}"', { name: demo.name })} onClose={onClose} wide>
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>{tr('No store created from this demo yet.')}</Empty> : data.map(a => (
        <ListRow key={a.id} title={`${a.name || tr('(deleted)')}${a.slug ? ` /${a.slug}` : ''}`} sub={`${a.ownerEmail} · ${ago(a.createdAt)}`}
          meta={<Badge label={tr(a.status || 'deleted')} tone={a.status ? statusTone(a.status) : 'muted'} />}
          right={a.slug ? <Btn small kind="ghost" icon="shieldAccountOutline" label={tr('Open admin')} onPress={() => { void openAdminSession(a.tenantId); }} /> : undefined} />
      ))}
    </Sheet>
  );
}

function Remove({ demo, onClose, onDone }: { demo: Demo; onClose: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const go = async () => { try { await sa(`/demos/${demo.id}`, { method: 'DELETE', body: { confirmSlug: confirm } }); onDone(); onClose(); } catch (e) { setError(saMessage(e)); } };
  return (
    <Sheet title={tr('Delete "{name}"', { name: demo.name })} onClose={onClose}>
      <Hint>{tr('Only the template is removed. Stores already created from it are independent and stay as they are. Type "{slug}" to confirm.', { slug: demo.slug })}</Hint>
      <Field label={tr('Type the address')} value={confirm} onChangeText={setConfirm} />
      <ErrorLine error={error} />
      <Btn label={tr('Delete demo')} kind="danger" disabled={confirm !== demo.slug} onPress={go} />
    </Sheet>
  );
}

export default function Demos() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const { data, error, loading, reload } = useLoad(() => sa<Demo[]>('/demos'));
  const [creating, setCreating] = useState(params.new === '1'); // opened by a link such as /super-admin/demos?new=1
  const [list, setList] = useState<Demo | null>(null);
  const [remove, setRemove] = useState<Demo | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [view, setView] = useState<ViewMode>('list');
  const publish = async (d: Demo) => {
    setProblem(null);
    try { await sa(`/demos/${d.id}`, { method: 'PATCH', body: { status: d.status === 'draft' ? 'published' : 'draft' } }); reload(); } catch (e) { setProblem(saMessage(e)); }
  };
  // "Customize" opens the demo's admin panel already signed in (one-time hand-off): no separate login.
  const customize = async (d: Demo) => { setProblem(null); const message = await openAdminSession(d.tenantId); if (message) setProblem(message); };
  return (
    <View>
      <Heading title={tr('Demos')} hint={tr('Template stores. Customize one in its admin panel, then create as many independent stores from it as you like.')}
        right={<Row><ViewSwitch value={view} onChange={setView} testID="sa-demo-view" /><Btn testID="sa-new-demo" icon="plus" label={tr('New demo')} onPress={() => setCreating(true)} /></Row>} />
      <ErrorLine error={error || problem} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>{tr('No demo yet. Create one to start stores faster.')}</Empty> : view === 'live' ? (
        <LivePreviews testID="sa-demo-live" items={data.map(d => ({
          id: d.id, name: d.name, path: d.path, badge: <Badge label={tr(d.status)} tone={statusTone(d.status)} />, sub: d.creditLimit == null ? tr('{used} used · unlimited', { used: d.creditsUsed }) : tr('{used} / {limit} credits', { used: d.creditsUsed, limit: d.creditLimit }),
          actions: <><IconBtn icon="openInNew" label={tr('Open {name} full size', { name: d.name })} onPress={() => openUrl(d.path)} /><IconBtn icon="brush" label={tr('Customize {name}', { name: d.name })} tone="accent" onPress={() => { void customize(d); }} /></>,
        }))} />
      ) : data.map(d => (
        <ListRow key={d.id} title={d.name} titleTestID="sa-demo-name" meta={<Badge label={tr(d.status)} tone={statusTone(d.status)} />}
          sub={`${d.path} · ${tr(d.assignments === 1 ? '{n} store' : '{n} stores', { n: d.assignments })}`}
          right={
            <View style={{ gap: SA.space.md, alignItems: 'flex-start' }}>
              <View style={{ minWidth: 150, alignSelf: 'stretch' }}><Meter used={d.creditsUsed} limit={d.creditLimit} testID="sa-demo-credits" /></View>
              <Row>
                <Btn testID="sa-demo-assign" label={tr('Create store')} small icon="storePlusOutline" onPress={() => router.push(`/super-admin/tenants?demo=${encodeURIComponent(d.id)}`)} />
                <Btn testID="sa-demo-customize" label={tr('Customize')} small kind="ghost" icon="brush" onPress={() => { void customize(d); }} />
                <Btn label={tr('Preview')} small kind="ghost" icon="openInNew" onPress={() => openUrl(d.path)} />
                <Btn label={tr('Stores')} small kind="ghost" onPress={() => setList(d)} />
                <Btn label={d.status === 'draft' ? tr('Publish') : tr('Unpublish')} small kind="ghost" icon={d.status === 'draft' ? 'publish' : 'publishOff'} onPress={() => publish(d)} />
                <Btn label={tr('Delete')} small kind="danger" icon="trashCanOutline" onPress={() => setRemove(d)} />
              </Row>
            </View>
          } />
      ))}
      {creating ? <CreateDemo onClose={() => setCreating(false)} onDone={reload} /> : null}
      {list ? <Instances demo={list} onClose={() => setList(null)} /> : null}
      {remove ? <Remove demo={remove} onClose={() => setRemove(null)} onDone={reload} /> : null}
    </View>
  );
}
