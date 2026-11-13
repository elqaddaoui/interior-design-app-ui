/* eslint-disable react-hooks/refs -- the tooltip hook returns a ref that is only read in event handlers. */
import React, { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { sa, saMessage } from '@/superadmin/api';
import { CloneStoresSheet } from '@/superadmin/CloneStores';
import { Icon, IconBtn, useTip } from '@/superadmin/icons';
import { LivePreviews, ViewSwitch, type ViewMode } from '@/superadmin/LivePreviews';
import { ThemePreview } from '@/superadmin/ThemePreview';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { Assignment, Demo, NewAdmin, StoreTheme } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Row, Sheet, T, ago, openAdminSession, openUrl, statusTone, useLoad } from '@/superadmin/ui';

/** A demo is a template store. Optional: start from a saved store theme (look only, no client data). A demo has no credit limit: it uses no API until its "Use API" switch is on. */
function CreateDemo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const themes = useLoad(() => sa<StoreTheme[]>('/themes'));
  const [name, setName] = useState('');
  const [themeId, setThemeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [made, setMade] = useState<{ demo: Demo; admin: NewAdmin } | null>(null);
  const [opening, setOpening] = useState('');
  const submit = async () => {
    setBusy(true); setError(null);
    try { setMade(await sa('/demos', { method: 'POST', body: { name, ...(themeId ? { themeId } : {}) } })); onDone(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
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
          <Field label={tr('Demo name')} value={name} onChangeText={setName} autoCapitalize="words" {...({ testID: 'sa-d-name' } as object)} />
          <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{tr('Theme')}</T>
          {themes.loading && !themes.data ? <Loading /> : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md, marginBottom: SA.space.lg }}>
              <ThemeChoice testID="sa-d-theme-none" label={tr('Standard sample store')} sub={tr('No theme')} on={!themeId} onPress={() => setThemeId('')} />
              {(themes.data || []).map(th => <ThemeChoice key={th.id} testID="sa-d-theme" label={th.name} sub={th.sourceName ? tr('from {name}', { name: th.sourceName }) : tr('saved theme')} theme={th} on={themeId === th.id} onPress={() => setThemeId(th.id)} />)}
            </View>
          )}
          {!themes.loading && !(themes.data || []).length ? <Hint>{tr('No saved theme yet. Use the Clone Existing Store button to copy a store look.')}</Hint> : null}
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

/** The demo's "Use API" switch. A demo calls no API at all until it is on; it switches itself off after a quiet period (and must be turned on again by hand). */
function AiSwitch({ demo, onChanged, onProblem }: { demo: Demo; onChanged: () => void; onProblem: (m: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const tip = useTip(tr('This demo calls no API until the switch is on. It turns itself off after a quiet period.'));
  // eslint-disable-next-line react-hooks/purity -- a countdown label; the list reloads every few seconds
  const left = demo.aiUntil ? Math.max(0, Math.ceil((demo.aiUntil - Date.now()) / 60000)) : 0;
  const toggle = async () => {
    setBusy(true); onProblem(null);
    try { await sa(`/demos/${demo.id}/ai`, { method: 'POST', body: { enabled: !demo.aiOn } }); onChanged(); } catch (e) { onProblem(saMessage(e)); } finally { setBusy(false); }
  };
  const tone = demo.aiPaused ? SA.color.danger : demo.aiOn ? SA.color.ok : SA.color.muted;
  return (
    <View testID="sa-demo-ai" style={{ alignSelf: 'flex-start' }}>
      <Pressable ref={tip.ref} testID="sa-demo-ai-toggle" accessibilityRole="switch" accessibilityState={{ checked: demo.aiOn, busy }} accessibilityLabel={demo.aiOn ? tr('Turn API off') : tr('Use API')}
        disabled={busy} onPress={toggle} {...(tip.handlers as object)}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, minHeight: 36, opacity: busy ? 0.6 : pressed ? 0.8 : 1 })}>
        <View style={{ width: 34, height: 20, borderRadius: 10, padding: 2, backgroundColor: demo.aiOn ? SA.color.ok : SA.color.line, justifyContent: 'center' }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: SA.color.panel, alignSelf: demo.aiOn ? 'flex-end' : 'flex-start' }} />
        </View>
        <T size="xs" weight="bold" color={tone}>{demo.aiPaused ? tr('API paused') : demo.aiOn ? tr('API on · {n} min left', { n: left }) : tr('API off')}</T>
        {tip.node}
      </Pressable>
    </View>
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

/** One demo: name + status + address on top; the API switch, the main action and compact icon buttons (tooltips) below or beside. */
function DemoCard({ demo: d, phone, onChanged, onProblem, onCreateStore, onCustomize, onStores, onPublish, onRemove }: {
  demo: Demo; phone: boolean; onChanged: () => void; onProblem: (m: unknown) => void;
  onCreateStore: () => void; onCustomize: () => void; onStores: () => void; onPublish: () => void; onRemove: () => void;
}) {
  const draft = d.status === 'draft';
  const info = (
    <View style={{ flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 2 }}>
      <Row style={{ flexWrap: 'nowrap', gap: SA.space.sm }}><T weight="bold" testID="sa-demo-name" numberOfLines={1} style={{ flexShrink: 1 }}>{d.name}</T><Badge label={tr(d.status)} tone={statusTone(d.status)} /></Row>
      <T size="sm" color={SA.color.muted} numberOfLines={1}>{`${d.path} · ${tr(d.assignments === 1 ? '{n} store' : '{n} stores', { n: d.assignments })}`}</T>
    </View>
  );
  const icons = (
    <Row style={{ gap: 6, flexWrap: 'nowrap' }}>
      <IconBtn testID="sa-demo-customize" icon="brush" label={tr('Customize {name}', { name: d.name })} onPress={onCustomize} />
      <IconBtn icon="openInNew" label={tr('Open {name} full size', { name: d.name })} onPress={() => openUrl(d.path)} />
      <IconBtn testID="sa-demo-stores" icon="domain" label={tr('Stores created from {name}', { name: d.name })} onPress={onStores} />
      <IconBtn testID="sa-demo-publish" icon={draft ? 'publish' : 'publishOff'} label={draft ? tr('Publish {name}', { name: d.name }) : tr('Unpublish {name}', { name: d.name })} onPress={onPublish} />
      <IconBtn testID="sa-demo-delete" icon="trashCanOutline" tone="danger" label={tr('Delete {name}', { name: d.name })} onPress={onRemove} />
    </Row>
  );
  const create = <Btn testID="sa-demo-assign" label={tr('Create store')} small icon="storePlusOutline" onPress={onCreateStore} />;
  const ai = <AiSwitch demo={d} onChanged={onChanged} onProblem={onProblem} />;
  return (
    <Card style={{ padding: phone ? SA.space.md : SA.space.lg, overflow: 'hidden' }}>
      {phone ? (
        <View style={{ gap: SA.space.md }}>
          {info}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SA.space.sm, flexWrap: 'wrap' }}>{ai}{create}</View>
          <View style={{ borderTopWidth: 1, borderColor: SA.color.line, paddingTop: SA.space.md }}>{icons}</View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.lg }}>
          {info}
          {ai}
          {create}
          {icons}
        </View>
      )}
    </Card>
  );
}

export default function Demos() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const phone = width < SA.wide;
  const params = useLocalSearchParams<{ new?: string; clone?: string }>();
  const { data, error, loading, reload } = useLoad(() => sa<Demo[]>('/demos'));
  const [creating, setCreating] = useState(params.new === '1'); // opened by a link such as /super-admin/demos?new=1
  const [cloning, setCloning] = useState(params.clone === '1'); // ... or /super-admin/demos?clone=1 (the old Clone Existing Store page redirects here)
  const [list, setList] = useState<Demo | null>(null);
  const [remove, setRemove] = useState<Demo | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [query, setQuery] = useState('');
  const publish = async (d: Demo) => {
    setProblem(null);
    try { await sa(`/demos/${d.id}`, { method: 'PATCH', body: { status: d.status === 'draft' ? 'published' : 'draft' } }); reload(); } catch (e) { setProblem(saMessage(e)); }
  };
  // "Customize" opens the demo's admin panel already signed in (one-time hand-off): no separate login.
  const customize = async (d: Demo) => { setProblem(null); const message = await openAdminSession(d.tenantId); if (message) setProblem(message); };
  const q = query.trim().toLowerCase();
  const shown = (data || []).filter(d => !q || `${d.name} ${d.path}`.toLowerCase().includes(q));
  return (
    <View>
      <Heading title={tr('Demos')} hint={tr('Template stores. Customize one in its admin panel, then create as many independent stores from it as you like.')} />
      {/* One toolbar: view switch on the left, actions on the right; on a phone the actions drop under the switch and share the row. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: SA.space.sm, marginBottom: SA.space.lg }}>
        <ViewSwitch value={view} onChange={setView} testID="sa-demo-view" />
        <Row style={{ gap: SA.space.sm, flexWrap: 'nowrap' }}>
          {phone
            ? <IconBtn testID="sa-clone-store" icon="contentCopyClone" label={tr('Clone Existing Store')} onPress={() => setCloning(true)} />
            : <Btn testID="sa-clone-store" kind="ghost" small icon="contentCopyClone" label={tr('Clone Existing Store')} onPress={() => setCloning(true)} />}
          <Btn testID="sa-new-demo" small icon="plus" label={tr('New demo')} onPress={() => setCreating(true)} />
        </Row>
      </View>
      {(data || []).length > 5 ? <View style={{ marginBottom: SA.space.sm }}><Field label={tr('Search')} value={query} onChangeText={setQuery} placeholder={tr('Name or address')} /></View> : null}
      <ErrorLine error={error || problem} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>{tr('No demo yet. Create one to start stores faster.')}</Empty> : !shown.length ? <Empty>{tr('No demo matches your search.')}</Empty> : view === 'live' ? (
        <LivePreviews testID="sa-demo-live" items={shown.map(d => ({
          id: d.id, name: d.name, path: d.path, badge: <Badge label={tr(d.status)} tone={statusTone(d.status)} />, sub: d.aiPaused ? tr('API paused') : d.aiOn ? tr('API on') : tr('API off'),
          actions: <><IconBtn icon="openInNew" label={tr('Open {name} full size', { name: d.name })} onPress={() => openUrl(d.path)} /><IconBtn icon="brush" label={tr('Customize {name}', { name: d.name })} tone="accent" onPress={() => { void customize(d); }} /></>,
        }))} />
      ) : shown.map(d => (
        <DemoCard key={d.id} demo={d} phone={phone} onChanged={reload} onProblem={setProblem}
          onCreateStore={() => router.push(`/super-admin/tenants?demo=${encodeURIComponent(d.id)}`)} onCustomize={() => { void customize(d); }}
          onStores={() => setList(d)} onPublish={() => { void publish(d); }} onRemove={() => setRemove(d)} />
      ))}
      {creating ? <CreateDemo onClose={() => setCreating(false)} onDone={reload} /> : null}
      {cloning ? <CloneStoresSheet onClose={() => setCloning(false)} /> : null}
      {list ? <Instances demo={list} onClose={() => setList(null)} /> : null}
      {remove ? <Remove demo={remove} onClose={() => setRemove(null)} onDone={reload} /> : null}
    </View>
  );
}
