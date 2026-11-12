import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import type { Assignment, Demo, NewAdmin } from '@/superadmin/types';
import { Badge, Btn, Empty, ErrorLine, Field, Heading, Hint, ListRow, Loading, Row, Secret, Sheet, T, ago, openUrl, statusTone, useLoad } from '@/superadmin/ui';

/** A demo is only a template store. Creating it is one field; the admin login ("admin") is generated. */
function CreateDemo({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [made, setMade] = useState<{ demo: Demo; admin: NewAdmin } | null>(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { setMade(await sa('/demos', { method: 'POST', body: { name } })); onDone(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title="New demo" onClose={onClose} testID="sa-create-demo">
      {made ? (
        <View>
          <T weight="bold" style={{ marginBottom: SA.space.sm }}>Demo created with sample data.</T>
          <Hint>{`Storefront ${made.demo.path} · admin panel ${made.demo.adminPath} · sign in as "${made.admin.username || made.admin.email}".`}</Hint>
          {made.admin.password ? <Secret label="Demo admin password" value={made.admin.password} /> : null}
          <Row><Btn label="Open storefront" kind="ghost" onPress={() => openUrl(made.demo.path)} /><Btn label="Open admin" kind="ghost" onPress={() => openUrl(made.demo.adminPath)} /><Btn label="Done" onPress={onClose} /></Row>
        </View>
      ) : (
        <View>
          <Hint>A demo is a template: storefront, admin panel and sample data. Customise it, then create stores from it. Every store gets its own independent copy.</Hint>
          <Field label="Demo name" value={name} onChangeText={setName} autoCapitalize="words" {...({ testID: 'sa-d-name' } as object)} />
          <ErrorLine error={error} />
          <Btn testID="sa-d-create" label="Create demo" onPress={submit} busy={busy} disabled={name.trim().length < 2} />
        </View>
      )}
    </Sheet>
  );
}

function Instances({ demo, onClose }: { demo: Demo; onClose: () => void }) {
  const { data, error, loading } = useLoad(() => sa<Assignment[]>(`/demos/${demo.id}/assignments`));
  return (
    <Sheet title={`Stores from "${demo.name}"`} onClose={onClose} wide>
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No store created from this demo yet.</Empty> : data.map(a => (
        <ListRow key={a.id} title={`${a.name || '(deleted)'}${a.slug ? ` /${a.slug}` : ''}`} sub={`${a.ownerEmail} · ${ago(a.createdAt)}`}
          meta={<Badge label={a.status || 'deleted'} tone={a.status ? statusTone(a.status) : 'muted'} />}
          right={a.slug ? <Btn small kind="ghost" label="Open admin" onPress={() => openUrl(a.adminPath)} /> : undefined} />
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
      <Hint>{`Only the template is removed. Stores already created from it are independent and stay as they are. Type "${demo.slug}" to confirm.`}</Hint>
      <Field label="Type the address" value={confirm} onChangeText={setConfirm} />
      <ErrorLine error={error} />
      <Btn label="Delete demo" kind="danger" disabled={confirm !== demo.slug} onPress={go} />
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
  const publish = async (d: Demo) => {
    setProblem(null);
    try { await sa(`/demos/${d.id}`, { method: 'PATCH', body: { status: d.status === 'draft' ? 'published' : 'draft' } }); reload(); } catch (e) { setProblem(saMessage(e)); }
  };
  return (
    <View>
      <Heading title="Demos" hint="Template stores. Customise one in its admin panel, then create as many independent stores from it as you like." right={<Btn testID="sa-new-demo" label="New demo" onPress={() => setCreating(true)} />} />
      <ErrorLine error={error || problem} />
      {loading && !data ? <Loading /> : !data?.length ? <Empty>No demo yet. Create one to start stores faster.</Empty> : data.map(d => (
        <ListRow key={d.id} title={d.name} titleTestID="sa-demo-name" meta={<Badge label={d.status} tone={statusTone(d.status)} />}
          sub={`${d.path} · ${d.assignments} store${d.assignments === 1 ? '' : 's'}`}
          right={
            <Row>
              <Btn testID="sa-demo-assign" label="Create store" small onPress={() => router.push(`/super-admin/tenants?demo=${encodeURIComponent(d.id)}`)} />
              <Btn label="Customise" small kind="ghost" onPress={() => openUrl(d.adminPath)} />
              <Btn label="Preview" small kind="ghost" onPress={() => openUrl(d.path)} />
              <Btn label="Stores" small kind="ghost" onPress={() => setList(d)} />
              <Btn label={d.status === 'draft' ? 'Publish' : 'Unpublish'} small kind="ghost" onPress={() => publish(d)} />
              <Btn label="Delete" small kind="danger" onPress={() => setRemove(d)} />
            </Row>
          } />
      ))}
      {creating ? <CreateDemo onClose={() => setCreating(false)} onDone={reload} /> : null}
      {list ? <Instances demo={list} onClose={() => setList(null)} /> : null}
      {remove ? <Remove demo={remove} onClose={() => setRemove(null)} onDone={reload} /> : null}
    </View>
  );
}
