import React, { useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { ChangeRequest } from '@/superadmin/types';
import { Badge, Btn, Empty, ErrorLine, Field, Heading, ListRow, Loading, Notice, Row, Sheet, T, Tabs, ago, openUrl, statusTone, useLoad } from '@/superadmin/ui';

const FILTERS = ['open', 'in_progress', 'done', 'rejected', ''] as const;
const KIND_LABEL: Record<string, string> = { customize: 'Customisation', manage: 'Management', support: 'Support', credits: 'More credits', api: 'API access' };

function Detail({ item, onClose, onChanged }: { item: ChangeRequest; onClose: () => void; onChanged: () => void }) {
  const [response, setResponse] = useState(item.response);
  const [docs, setDocs] = useState('');
  const [markDone, setMarkDone] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const run = async (key: string, work: () => Promise<unknown>, message: string) => {
    setBusy(key); setError(null); setNote('');
    try { await work(); setNote(message); onChanged(); } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  };
  const status = (value: string) => run(value, () => sa(`/requests/${item.id}`, { method: 'PATCH', body: { status: value, response } }), 'Saved.');
  const apply = () => {
    let patch: unknown;
    try { patch = JSON.parse(docs); } catch { setError('The change must be valid JSON, e.g. {"branding":{"appName":"New name"}}.'); return; }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { setError('The change must be a JSON object of documents.'); return; }
    return run('apply', () => sa(`/requests/${item.id}/apply`, { method: 'POST', body: { docs: patch, markDone } }), `Applied to ${item.tenantSlug} only.`);
  };
  const demo = item.tenantKind === 'demo';
  return (
    <Sheet title={item.title} onClose={onClose} wide testID="sa-request-sheet">
      <Row style={{ marginBottom: SA.space.md }}><Badge label={item.status} tone={statusTone(item.status)} /><Badge label={KIND_LABEL[item.kind] || item.kind} tone="accent" /><T size="sm" color={SA.color.muted}>{item.tenantName} /{item.tenantSlug} · {item.adminId} · {ago(item.createdAt)}</T></Row>
      <T style={{ marginBottom: SA.space.lg }} selectable>{item.body}</T>
      {item.kind === 'credits' || item.kind === 'api' ? <Notice tone="accent">{item.kind === 'credits' ? 'To grant credits, open the store in Stores, then Credits & APIs, and raise its limit.' : 'To change API access, open the store in Stores, then Credits & APIs, and choose who manages the AI keys.'}</Notice> : null}
      <Field label="Reply to the administrator" value={response} onChangeText={setResponse} multiline />
      <Row style={{ marginBottom: SA.space.lg }}>
        <Btn label="Save reply" kind="ghost" busy={busy === item.status} onPress={() => status(item.status)} />
        <Btn label="In progress" kind="ghost" busy={busy === 'in_progress'} onPress={() => status('in_progress')} />
        <Btn label="Done" busy={busy === 'done'} onPress={() => status('done')} />
        <Btn label="Reject" kind="danger" busy={busy === 'rejected'} onPress={() => status('rejected')} />
      </Row>
      <View style={{ borderTopWidth: 1, borderColor: SA.color.line, paddingTop: SA.space.lg }}>
        <T weight="bold">Apply a change to {item.tenantName ? `"${item.tenantSlug}"` : 'this tenant'} only</T>
        <T size="sm" color={SA.color.muted} style={{ marginVertical: SA.space.sm }}>{demo ? 'Demo templates cannot be changed from a request.' : 'The change is written to the tenant that filed this request. The original demo and every other tenant are never touched.'}</T>
        <Field label="Documents (JSON)" value={docs} onChangeText={setDocs} multiline placeholder='{"branding":{"appName":"New name"}}' {...({ testID: 'sa-apply-json' } as object)} />
        <Row>
          <Btn testID="sa-apply" label="Apply to this tenant" disabled={demo || !docs.trim()} busy={busy === 'apply'} onPress={apply} />
          <Btn label={markDone ? 'Marks the request done' : 'Keeps the request open'} kind="ghost" small onPress={() => setMarkDone(v => !v)} />
          {item.tenantSlug ? <Btn label="Open its admin" kind="ghost" small onPress={() => openUrl(`/${item.tenantSlug}/admin`)} /> : null}
        </Row>
      </View>
      <View style={{ marginTop: SA.space.md }}><ErrorLine error={error} />{note ? <T size="sm" color={SA.color.ok} testID="sa-note">{note}</T> : null}</View>
    </Sheet>
  );
}

export default function Requests() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('open');
  const [open, setOpen] = useState<ChangeRequest | null>(null);
  const { data, error, loading, reload } = useLoad(() => sa<ChangeRequest[]>(`/requests${filter ? `?status=${filter}` : ''}`), [filter]);
  return (
    <View>
      <Heading title="Requests" hint="Messages sent by store administrators from their panel: customisation, support, more credits, API access. Changes you apply go to that store only." />
      <Tabs value={filter} onChange={setFilter} tabs={FILTERS.map(value => ({ value, label: value ? value.replace('_', ' ') : 'all', testID: `sa-filter-${value || 'all'}` }))} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No request here.</Empty> : data.map(item => (
        <ListRow key={item.id} title={item.title} titleTestID="sa-request-title" onPress={() => setOpen(item)}
          meta={<Row style={{ gap: 4 }}><Badge label={item.status} tone={statusTone(item.status)} /><Badge label={KIND_LABEL[item.kind] || item.kind} /></Row>}
          sub={`${item.tenantName} /${item.tenantSlug} · ${ago(item.createdAt)}`} />
      ))}
      {open ? <Detail item={open} onClose={() => setOpen(null)} onChanged={() => { reload(); }} /> : null}
    </View>
  );
}
