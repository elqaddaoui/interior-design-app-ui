import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { ApiCatalog, ApiConn, ApiKind, FoundKeys } from '@/superadmin/types';
import { ApiAlerts } from '@/superadmin/ApiAlerts';
import { ApiUsage } from '@/superadmin/ApiUsage';
import { OnlineApis } from '@/superadmin/OnlineApis';
import { Badge, Btn, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Notice, Row, Segmented, Sheet, T, Tabs, useLoad } from '@/superadmin/ui';

const KIND_LABEL: Record<ApiKind, string> = { image: 'Images', text: 'Text / chat', other: 'Other' };
const KIND_HINT: Record<ApiKind, string> = {
  image: 'Generates pictures for stores whose AI keys are managed by you.',
  text: 'Writes texts and answers chats for those stores.',
  other: 'Any future service. Stored safely; wire it in when you need it.',
};

/** Add or edit one connection. The key is write-only: it is never shown again, only a hint of its end. */
function Editor({ kind, conn, catalog, onClose, onDone }: { kind: ApiKind; conn: ApiConn | null; catalog: ApiCatalog; onClose: () => void; onDone: () => void }) {
  const providers = catalog[kind];
  const [provider, setProvider] = useState(conn?.provider || providers[0]?.id || 'other');
  const [label, setLabel] = useState(conn?.label || '');
  const [baseUrl, setBaseUrl] = useState(conn?.baseUrl || '');
  const [model, setModel] = useState(conn?.model || '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const meta = providers.find(p => p.id === provider);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const body = { label, provider, baseUrl: meta?.needsUrl || kind === 'other' ? baseUrl : '', model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      if (conn) await sa(`/apis/${conn.id}`, { method: 'PATCH', body }); else await sa('/apis', { method: 'POST', body: { kind, ...body } });
      onDone(); onClose();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const ready = (conn ? true : apiKey.trim().length >= 4) && (!meta?.needsModel || model.trim().length > 0) && (!meta?.needsUrl || baseUrl.trim().length > 0);
  return (
    <Sheet title={conn ? tr('Edit {name}', { name: conn.label }) : tr('Add a {kind} connection', { kind: tr(KIND_LABEL[kind]).toLowerCase() })} onClose={onClose} testID="sa-api-sheet">
      {kind !== 'other' && providers.length > 1 && !conn ? (
        <View style={{ marginBottom: SA.space.md }}>
          <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{tr('Provider')}</T>
          <Segmented value={provider} onChange={setProvider} options={providers.map(p => ({ value: p.id, label: p.label }))} />
        </View>
      ) : null}
      <Field label={tr('Name (optional)')} value={label} onChangeText={setLabel} placeholder={meta?.label} autoCapitalize="words" {...({ testID: 'sa-api-label' } as object)} />
      {meta?.needsUrl || kind === 'other' ? <Field label={meta?.needsUrl ? tr('Base URL') : tr('Base URL (optional)')} value={baseUrl} onChangeText={setBaseUrl} placeholder="https://api.example.com/v1" keyboardType="url" /> : null}
      {meta?.needsModel || kind === 'text' ? <Field label={meta?.needsModel ? tr('Model') : tr('Model (optional)')} value={model} onChangeText={setModel} placeholder="model name" /> : null}
      <Field label={conn ? tr('New key (empty keeps {hint})', { hint: conn.keyHint || tr('the current one') }) : tr('API key')} value={apiKey} onChangeText={setApiKey} secureTextEntry {...({ testID: 'sa-api-key' } as object)} />
      <Hint>{tr('The key is stored on the server and can never be read back, not even by you. Stores never see it.')}</Hint>
      <ErrorLine error={error} />
      <Btn testID="sa-api-save" label={conn ? tr('Save') : tr('Add connection')} onPress={submit} busy={busy} disabled={!ready} />
    </Sheet>
  );
}

function Connection({ conn, onEdit, onChanged }: { conn: ApiConn; onEdit: () => void; onChanged: () => void }) {
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const act = async (work: () => Promise<unknown>) => { setError(null); try { await work(); setConfirm(false); onChanged(); } catch (e) { setError(saMessage(e)); } };
  return (
    <View>
      <ListRow title={conn.label} testID="sa-api-row"
        meta={<Row style={{ gap: 4 }}>{conn.isDefault ? <Badge label={tr('shared default')} tone="accent" /> : null}{!conn.enabled ? <Badge label={tr('off')} tone="muted" /> : null}</Row>}
        sub={`${conn.provider}${conn.model ? ` · ${conn.model}` : ''} · ${tr(conn.stores === 1 ? 'key {hint} · used by {n} store' : 'key {hint} · used by {n} stores', { hint: conn.keyHint || tr('saved'), n: conn.stores })}`}
        right={
          <Row>
            {!conn.isDefault ? <Btn small kind="ghost" label={tr('Make default')} onPress={() => act(() => sa(`/apis/${conn.id}`, { method: 'PATCH', body: { isDefault: true } }))} /> : null}
            <Btn small kind="ghost" label={conn.enabled ? tr('Turn off') : tr('Turn on')} onPress={() => act(() => sa(`/apis/${conn.id}`, { method: 'PATCH', body: { enabled: !conn.enabled } }))} />
            <Btn small kind="ghost" label={tr('Edit')} onPress={onEdit} />
            {confirm ? <Btn small kind="danger" label={tr('Confirm delete')} onPress={() => act(() => sa(`/apis/${conn.id}`, { method: 'DELETE', body: {} }))} /> : <Btn small kind="danger" label={tr('Delete')} onPress={() => setConfirm(true)} />}
          </Row>
        } />
      <ErrorLine error={error} />
    </View>
  );
}

/**
 * Keys the backend holds outside the manager: host variables (only the host can remove them) and the keys store administrators typed into their own
 * screens (they can be moved in and cleared from the store, so the manager is the only holder). Only the last four characters are ever shown.
 */
function Found({ onChanged }: { onChanged: () => void }) {
  const { data, error, reload } = useLoad(() => sa<FoundKeys>('/apis/discover'));
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const todo = (data?.env || []).filter(e => !e.added).length + (data?.stores || []).length;
  if (!data || (!data.env.length && !data.stores.length)) return <ErrorLine error={error} />;
  const run = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setProblem(null);
    try { await sa('/apis/import', { method: 'POST', body }); reload(); onChanged(); } catch (e) { setProblem(saMessage(e)); } finally { setBusy(''); }
  };
  return (
    <View style={{ marginBottom: SA.space.xl }} testID="sa-api-found">
      <T size="lg" weight="bold">{tr('Found on the server')}</T>
      <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{tr('Keys that live outside the API manager. Move them in to see and control every API from here.')}</T>
      <ErrorLine error={problem} />
      {data.env.map(e => (
        <ListRow key={e.variable} title={e.label} testID="sa-api-found-env"
          meta={<Badge label={e.added ? tr('in the manager') : tr('host setting')} tone={e.added ? 'ok' : 'warn'} />}
          sub={tr('{variable} · key {hint}. Only your host can remove this setting.', { variable: e.variable, hint: e.hint })}
          right={e.added ? null : <Btn small label={tr('Add to manager')} busy={busy === e.variable} onPress={() => run(e.variable, { source: 'env', kind: e.kind, provider: e.provider })} />} />
      ))}
      {data.stores.map(k => {
        const key = `${k.tenantId}:${k.kind}:${k.provider}`;
        return (
          <ListRow key={key} title={`${k.label} · ${k.store}`} testID="sa-api-found-store"
            meta={<Badge label={k.storeKind === 'demo' ? tr('Demo') : tr('Store key')} tone="muted" />}
            sub={tr('Typed in by the store administrator · key {hint}', { hint: k.hint })}
            right={<Row>
              <Btn small label={tr('Move to manager')} busy={busy === key} onPress={() => run(key, { source: 'store', tenantId: k.tenantId, kind: k.kind, provider: k.provider, clear: true })} />
              {!k.added ? <Btn small kind="ghost" label={tr('Copy only')} disabled={busy !== ''} onPress={() => run(key, { source: 'store', tenantId: k.tenantId, kind: k.kind, provider: k.provider })} /> : null}
            </Row>} />
        );
      })}
      {todo ? <Hint>{tr('Moving a key copies it into the manager and removes it from the store. The store keeps working through the manager only if it is set to “Managed by me”.')}</Hint> : null}
    </View>
  );
}

function Manager() {
  const { data, error, loading, reload } = useLoad(() => sa<{ apis: ApiConn[]; catalog: ApiCatalog }>('/apis'));
  const [editor, setEditor] = useState<{ kind: ApiKind; conn: ApiConn | null } | null>(null);
  const kinds: ApiKind[] = ['image', 'text', 'other'];
  return (
    <View>
      <Heading title={tr('API manager')} hint={tr('Your AI connections. A store set to “Managed by me” uses the shared default of each kind, or a connection you link to it in its Credits & APIs tab. Stores that keep their own keys are not affected.')} />
      <ErrorLine error={error} />
      <Notice tone="accent">{tr('Each store can have its own connection, or all can share one: leave stores on the default, or link a store to a specific connection.')}</Notice>
      <Found onChanged={reload} />
      {loading && !data ? <Loading /> : kinds.map(kind => {
        const rows = (data?.apis || []).filter(a => a.kind === kind);
        return (
          <View key={kind} style={{ marginBottom: SA.space.xl }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: SA.space.sm }}>
              <View style={{ flexShrink: 1 }}><T size="lg" weight="bold">{tr(KIND_LABEL[kind])}</T><T size="sm" color={SA.color.muted}>{tr(KIND_HINT[kind])}</T></View>
              {data ? <Btn testID={`sa-api-add-${kind}`} small label={tr('Add')} onPress={() => setEditor({ kind, conn: null })} /> : null}
            </Row>
            {rows.length ? rows.map(c => <Connection key={c.id} conn={c} onEdit={() => setEditor({ kind, conn: c })} onChanged={reload} />) : <Empty>{tr('None yet.')}</Empty>}
          </View>
        );
      })}
      {editor && data ? <Editor kind={editor.kind} conn={editor.conn} catalog={data.catalog} onClose={() => setEditor(null)} onDone={reload} /> : null}
    </View>
  );
}

type Tab = 'manager' | 'usage' | 'alerts' | 'online_api';

export default function Apis() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab: Tab = params.tab === 'usage' || params.tab === 'alerts' || params.tab === 'online_api' ? params.tab : 'manager';
  const open = useLoad(() => sa<{ alerts: unknown[]; open: number }>('/alerts?status=open'));
  const warnings = open.data?.open || 0;
  return (
    <View>
      <Tabs<Tab> value={tab} onChange={v => router.setParams({ tab: v === 'manager' ? undefined : v })}
        tabs={[
          { value: 'manager', label: tr('API manager'), testID: 'sa-apitab-manager' },
          { value: 'online_api', label: tr('Online APIs'), testID: 'sa-apitab-online' },
          { value: 'usage', label: tr('Consumption'), testID: 'sa-apitab-usage' },
          { value: 'alerts', label: warnings ? tr('Warnings ({n})', { n: warnings }) : tr('Warnings'), testID: 'sa-apitab-alerts' },
        ]} />
      {tab === 'online_api' ? <OnlineApis /> : tab === 'usage' ? <ApiUsage /> : tab === 'alerts' ? <ApiAlerts /> : <Manager />}
    </View>
  );
}
