import React, { useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import { captureApp } from '@/superadmin/screenshot';
import { Terminal, fmtBytes } from '@/superadmin/BackupTerminal';
import type { BackupCaps, BackupJob, BackupSettings, RestorePlan, VaultInfo, VaultItem, VaultKind } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Heading, Hint, Loading, Notice, Row, Segmented, Sheet, T, ago, openUrl, useLoad } from '@/superadmin/ui';

const KINDS: VaultKind[] = ['all', 'db', 'code', 'media'];
const kindLabel = (k: VaultKind) => (k === 'all' ? tr('Full app') : k === 'db' ? tr('Database') : k === 'code' ? tr('Code') : tr('Media'));
const kindHint = (k: VaultKind) => (k === 'all' ? tr('Database, code and every uploaded file in one archive.') : k === 'db' ? tr('Only the database: content, stores, requests, clients.') : k === 'code' ? tr('Only the application code, the whole project: with it you can create a new GitHub repository.') : tr('Only the uploaded pictures, videos and files.'));
const when = (at: number) => new Date(at).toLocaleString();
const API = '/api/super-admin/backup';

function warnText(w: { code: string } & Record<string, unknown>): string {
  const s = (k: string) => String(w[k] ?? '');
  switch (w.code) {
    case 'SCHEMA_VERSION_DIFFERS': return tr('The database layout of this backup differs from the current one. Missing columns are filled in and tables that no longer exist are skipped.');
    case 'VERSION_DIFFERS': return tr('This backup comes from app version {from}; the app is now at {to}.', { from: s('from'), to: s('to') });
    case 'TABLES_SKIPPED': return tr('{count} tables of the backup no longer exist and are skipped: {tables}', { count: Number(w.count) || 0, tables: s('tables') });
    case 'PROVIDER_DIFFERS': return tr('The backup comes from another database provider ({from}); the data is loaded into {to}.', { from: s('from'), to: s('to') });
    case 'PASSWORDS_NOT_IN_BACKUP': return tr('Passwords and secret keys are never stored in a backup.');
    case 'WILL_EMPTY_DATABASE': return tr('This backup holds no data: restoring it empties the database.');
    case 'APP_RESTART_REQUIRED': return tr('The code is replaced: restart the server afterwards.');
    case 'MEDIA_MISSING': return tr('{count} media files were already missing when this backup was made.', { count: Number(w.count) || 0 });
    default: return tr('Something went wrong.');
  }
}

function Thumb({ item, onPress }: { item: VaultItem; onPress: () => void }) {
  if (Platform.OS !== 'web') return null;
  return (
    <Pressable testID="sa-backup-thumb" accessibilityRole="button" accessibilityLabel={tr('Preview')} onPress={onPress}
      style={{ width: 112, height: 70, borderRadius: SA.radius.sm, overflow: 'hidden', backgroundColor: SA.color.panel2, borderWidth: 1, borderColor: SA.color.line }}>
      {item.preview ? <Image source={{ uri: `${API}/vault/${item.id}/preview` }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
    </Pressable>
  );
}

function ItemRow({ item, current, onRestore, onDelete, onPreview }: { item: VaultItem; current: boolean; onRestore: () => void; onDelete: () => void; onPreview: () => void }) {
  return (
    <View testID="sa-backup-item" style={{ flexDirection: 'row', gap: SA.space.md, flexWrap: 'wrap', padding: SA.space.md, borderTopWidth: 1, borderColor: SA.color.line }}>
      <Thumb item={item} onPress={onPreview} />
      <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 200 }}>
        <Row style={{ gap: 6 }}>
          <Badge label={kindLabel(item.kind)} tone="accent" />
          {item.createdBy === 'schedule' ? <Badge label={tr('Daily')} tone="muted" /> : item.createdBy === 'pre-restore' ? <Badge label={tr('Before a restore')} tone="warn" /> : item.createdBy === 'limit' ? <Badge label={tr('Limit reached')} tone="warn" /> : null}
          {item.encrypted ? <Badge label={tr('Encrypted')} tone="ok" /> : null}
          {current ? null : <Badge label={tr('Older version')} tone="muted" />}
        </Row>
        <T size="sm" weight="bold" style={{ marginTop: 4 }}>{when(item.createdAt)}</T>
        <T size="xs" color={SA.color.muted}>
          {[fmtBytes(item.size), item.rows != null ? tr('{n} rows', { n: item.rows }) : '', item.mediaFiles ? tr('{n} media files', { n: item.mediaFiles }) : '', item.appFiles ? tr('{n} code files', { n: item.appFiles }) : ''].filter(Boolean).join(' · ')}
        </T>
      </View>
      <Row style={{ alignSelf: 'center' }}>
        <Btn testID="sa-backup-restore" small icon="restore" label={tr('Restore')} onPress={onRestore} />
        <Btn testID="sa-backup-download" small kind="ghost" icon="download" label={tr('Download')} onPress={() => openUrl(`${API}/vault/${item.id}/download`)} />
        {item.includes.app ? <Btn testID="sa-backup-repo" small kind="ghost" icon="download" label={tr('Git repository')} onPress={() => openUrl(`${API}/vault/${item.id}/repo`)} /> : null}
        <Btn testID="sa-backup-delete" small kind="ghost" icon="trashCanOutline" label={tr('Delete')} onPress={onDelete} />
      </Row>
    </View>
  );
}

/** Screenshot first, then the person confirms what is going to be backed up. */
function StartSheet({ kind, onClose, onStarted }: { kind: VaultKind; onClose: () => void; onStarted: (job: BackupJob) => void }) {
  const [shot, setShot] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const taken = React.useRef(false);
  React.useEffect(() => {
    if (taken.current) return;
    taken.current = true;
    captureApp().then(setShot, () => setShot(null));
  }, []);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      let previewId: string | undefined;
      if (shot) { try { previewId = (await sa<{ previewId: string }>('/backup/previews', { method: 'POST', body: { data: shot } })).previewId; } catch { previewId = undefined; } }
      const r = await sa<{ job: BackupJob }>('/backup/jobs', { method: 'POST', body: { kind, destination: 'vault', createdBy: 'manual', ...(previewId ? { previewId } : {}) } });
      onStarted(r.job);
    } catch (e) { setError(saMessage(e)); setBusy(false); }
  };
  return (
    <Sheet title={tr('Back up: {kind}', { kind: kindLabel(kind) })} onClose={onClose} wide testID="sa-backup-start">
      <T size="sm" weight="bold" color={SA.color.muted} style={{ marginBottom: 6 }}>{tr('This is how the app will look when this backup is restored:')}</T>
      <View style={{ aspectRatio: 16 / 10, backgroundColor: SA.color.panel2, borderRadius: SA.radius.md, borderWidth: 1, borderColor: SA.color.line, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: SA.space.md }}>
        {shot === undefined ? <Loading /> : shot ? <Image testID="sa-backup-shot" source={{ uri: shot }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : (
          <T size="sm" color={SA.color.muted} style={{ padding: SA.space.lg, textAlign: 'center' }}>{tr('No screenshot could be taken here. A snapshot drawn from the data is saved instead.')}</T>
        )}
      </View>
      <Hint>{kindHint(kind)}</Hint>
      <ErrorLine error={error} />
      <Row>
        <Btn testID="sa-backup-go" icon="shieldCheckOutline" label={tr('Start the backup')} onPress={go} busy={busy} disabled={shot === undefined} />
        <Btn kind="ghost" label={tr('Cancel')} onPress={onClose} />
      </Row>
    </Sheet>
  );
}

function RunSheet({ job, onClose, onDone }: { job: BackupJob; onClose: () => void; onDone: () => void }) {
  return (
    <Sheet title={tr('Backup in progress')} onClose={onClose} wide testID="sa-backup-run">
      <Terminal jobId={job.id} heading={`backup --kind ${job.options.kind || ''} --to vault`} onFinished={onDone} />
      <Hint>{tr('You can close this window: the backup keeps running on the server and appears in the list when it is done.')}</Hint>
    </Sheet>
  );
}

function Toggle({ on, label, onChange, testID, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={() => onChange(!on)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: on ? SA.color.accent : SA.color.muted, backgroundColor: on ? SA.color.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on ? <T size="xs" weight="bold" color={SA.color.onAccent}>✓</T> : null}
      </View>
      <T size="sm">{label}</T>
    </Pressable>
  );
}

type Stage = { name: 'prepare'; job: BackupJob } | { name: 'plan'; plan: RestorePlan; uploadId: string } | { name: 'run'; job: BackupJob; done: boolean };

function RestoreSheet({ item, onClose, onChanged }: { item: VaultItem; onClose: () => void; onChanged: () => void }) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [parts, setParts] = useState<{ app: boolean; db: boolean; media: boolean }>({ app: false, db: false, media: false });
  const [safety, setSafety] = useState(true);
  const started = React.useRef(false);
  const begin = async () => {
    setBusy(true); setError(null);
    try { const r = await sa<{ job: BackupJob }>(`/backup/vault/${item.id}/prepare`, { method: 'POST', body: {} }); setStage({ name: 'prepare', job: r.job }); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  React.useEffect(() => { if (!started.current) { started.current = true; void begin(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const prepared = (job: BackupJob) => {
    if (job.status === 'done' && job.result?.plan && job.result.uploadId) { setParts({ ...job.result.plan.restorable }); setStage({ name: 'plan', plan: job.result.plan, uploadId: job.result.uploadId }); }
  };
  const run = async () => {
    if (stage?.name !== 'plan') return;
    setBusy(true); setError(null);
    try {
      const r = await sa<{ job: BackupJob }>('/backup/restores', { method: 'POST', body: { uploadId: stage.uploadId, confirm: true, parts, safetyBackup: safety, ...(parts.media ? { mediaTarget: stage.plan.defaultMediaTarget } : {}) } });
      setStage({ name: 'run', job: r.job, done: false });
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const plan = stage?.name === 'plan' ? stage.plan : null;
  const rows = plan ? Object.values(plan.willReplace).reduce((a, b) => a + b, 0) : 0;
  const any = parts.app || parts.db || parts.media;
  return (
    <Sheet title={tr('Restore the backup of {date}', { date: when(item.createdAt) })} onClose={onClose} wide testID="sa-backup-restore-sheet">
      <ErrorLine error={error} />
      {stage?.name === 'prepare' ? (
        <View>
          <Terminal testID="sa-terminal-prepare" jobId={stage.job.id} heading={`restore --check ${item.name}`} onFinished={prepared} />
          <Hint>{tr('The backup is downloaded and every file is checked first. Nothing is changed yet.')}</Hint>
          <Btn kind="ghost" label={tr('Close')} onPress={onClose} />
        </View>
      ) : null}
      {plan ? (
        <View>
          <Notice tone="ok">{tr('The backup is valid. Choose what to bring back.')}</Notice>
          <Card>
            <T weight="bold" style={{ marginBottom: 6 }}>{tr('What to restore')}</T>
            <Toggle testID="sa-restore-db" on={parts.db} disabled={!plan.restorable.db} label={tr('Database')} onChange={v => setParts({ ...parts, db: v })} />
            <Toggle testID="sa-restore-media" on={parts.media} disabled={!plan.restorable.media} label={tr('Media files')} onChange={v => setParts({ ...parts, media: v })} />
            <Toggle testID="sa-restore-app" on={parts.app} disabled={!plan.restorable.app} label={tr('Code')} onChange={v => setParts({ ...parts, app: v })} />
            {parts.db ? <Toggle testID="sa-restore-safety" on={safety} label={tr('Save a safety copy of the current data first')} onChange={setSafety} /> : null}
            {parts.db && rows ? <Hint>{tr('About {rows} rows of the current database are replaced.', { rows })}</Hint> : null}
          </Card>
          {plan.warnings.map(w => <Notice key={w.code} tone={w.code === 'WILL_EMPTY_DATABASE' ? 'danger' : 'warn'}>{warnText(w)}</Notice>)}
          <Notice tone="danger">{tr('Restoring replaces the current data. This cannot be undone, except with the safety copy.')}</Notice>
          <Row style={{ marginTop: SA.space.md }}>
            <Btn testID="sa-restore-confirm" kind="danger" icon="restore" label={tr('Restore now')} onPress={run} busy={busy} disabled={!any} />
            <Btn kind="ghost" label={tr('Cancel')} onPress={onClose} />
          </Row>
        </View>
      ) : null}
      {stage?.name === 'run' ? (
        <View>
          <Terminal testID="sa-terminal-restore" jobId={stage.job.id} heading={`restore ${item.name}`} onFinished={j => { setStage({ name: 'run', job: stage.job, done: true }); if (j.result?.restartRequired) setError(null); onChanged(); }} />
          {stage.done ? <Notice tone="ok">{tr('Finished. Reload the page if something looks out of date.')}</Notice> : null}
          <Btn kind="ghost" label={tr('Close')} onPress={onClose} />
        </View>
      ) : null}
    </Sheet>
  );
}

function Schedule({ info, onSaved }: { info: VaultInfo; onSaved: () => void }) {
  const s = info.schedule;
  const [draft, setDraft] = useState<BackupSettings>(s.settings);
  const [days, setDays] = useState(String(s.settings.retentionDays));
  const [hourText, setHourText] = useState(typeof s.settings.hour === 'number' ? String(s.settings.hour) : String(s.hour));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const toggleKind = (k: VaultKind) => setDraft(d => ({ ...d, kinds: d.kinds.includes(k) ? (d.kinds.length > 1 ? d.kinds.filter(x => x !== k) : d.kinds) : [...d.kinds, k] }));
  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const body = { enabled: draft.enabled, kinds: draft.kinds, hour: draft.hour === 'auto' ? 'auto' : Number(hourText), retentionDays: Number(days) };
      await sa('/backup/vault/settings', { method: 'PATCH', body }); setSaved(true); onSaved();
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const peak = Math.max(1, ...s.profile.map(v => (typeof v === 'number' ? v : 0)));
  const hourLabel = `${String(s.hour).padStart(2, '0')}:00 UTC`;
  return (
    <Card>
      <T weight="bold" size="lg">{tr('Daily backup and clean-up')}</T>
      <Hint>{tr('The server backs up once a day at the quietest hour, only when nobody is using the app, and deletes backups older than the period below.')}</Hint>
      <Segmented testID="sa-backup-enabled" value={draft.enabled ? 'on' : 'off'} onChange={v => setDraft({ ...draft, enabled: v === 'on' })}
        options={[{ value: 'on', label: tr('Daily backup on'), testID: 'sa-backup-on' }, { value: 'off', label: tr('Off'), testID: 'sa-backup-off' }]} />
      <View style={{ marginTop: SA.space.md }}>
        <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{tr('What to back up each day')}</T>
        <Row>{KINDS.map(k => <Toggle key={k} testID={`sa-backup-kind-${k}`} on={draft.kinds.includes(k)} label={kindLabel(k)} onChange={() => toggleKind(k)} />)}</Row>
      </View>
      <View style={{ marginTop: SA.space.md }}>
        <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{tr('Time of day')}</T>
        <Segmented value={draft.hour === 'auto' ? 'auto' : 'fixed'} onChange={v => setDraft({ ...draft, hour: v === 'auto' ? 'auto' : Number(hourText) || 0 })}
          options={[{ value: 'auto', label: tr('Quietest hour (automatic)'), testID: 'sa-backup-hour-auto' }, { value: 'fixed', label: tr('Fixed hour'), testID: 'sa-backup-hour-fixed' }]} />
        {draft.hour === 'auto' ? (
          <View style={{ marginTop: SA.space.sm }}>
            <T size="sm" color={SA.color.muted}>{s.learned >= 12 ? tr('Learned from the traffic: {hour}.', { hour: hourLabel }) : tr('Still learning the traffic ({n} of 24 hours seen). Until then: {hour}.', { n: s.learned, hour: hourLabel })}</T>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 34, gap: 2, marginTop: 6 }}>
              {s.profile.map((v, i) => (
                <View key={i} style={{ flex: 1, height: Math.max(3, ((typeof v === 'number' ? v : 0) / peak) * 34), borderRadius: 2, backgroundColor: i === s.hour || i === (s.hour + 1) % 24 ? SA.color.accent : SA.color.line }} />
              ))}
            </View>
            <T size="xs" color={SA.color.muted}>{tr('Each bar is one hour (UTC). The highlighted bars are the backup window.')}</T>
          </View>
        ) : <View style={{ marginTop: SA.space.sm, maxWidth: 220 }}><Field label={tr('Hour (0-23, UTC)')} value={hourText} onChangeText={v => { setHourText(v.replace(/\D/g, '').slice(0, 2)); setDraft({ ...draft, hour: Number(v.replace(/\D/g, '').slice(0, 2)) || 0 }); }} keyboardType="number-pad" {...({ testID: 'sa-backup-hour' } as object)} /></View>}
      </View>
      <View style={{ marginTop: SA.space.md, maxWidth: 260 }}>
        <Field label={tr('Keep backups for (days)')} value={days} onChangeText={v => setDays(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" {...({ testID: 'sa-backup-days' } as object)} />
        <T size="xs" color={SA.color.muted} style={{ marginTop: -6, marginBottom: SA.space.sm }}>{tr('Default 28 days (4 weeks). The newest backup of each kind is always kept.')}</T>
      </View>
      <Hint>{s.last ? `${tr('Last daily run: {when}.', { when: ago(s.last.at) })} ` : ''}{draft.enabled && s.available ? tr('Next run: {when}.', { when: when(s.next) }) : ''}</Hint>
      <ErrorLine error={error} />
      <Row>
        <Btn testID="sa-backup-save" label={tr('Save')} onPress={save} busy={busy} />
        {saved ? <T size="sm" color={SA.color.ok} testID="sa-backup-saved">{tr('Saved.')}</T> : null}
      </Row>
    </Card>
  );
}

export default function BackupPage() {
  const { data, error, loading, reload } = useLoad(async () => {
    const caps = await sa<BackupCaps>('/backup/capabilities');
    let info: VaultInfo | null = null;
    try { info = await sa<VaultInfo>('/backup/vault'); } catch { info = null; }
    return { caps, info };
  });
  const [kind, setKind] = useState<VaultKind>('all');
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState<BackupJob | null>(null);
  const [restoring, setRestoring] = useState<VaultItem | null>(null);
  const [deleting, setDeleting] = useState<VaultItem | null>(null);
  const [viewing, setViewing] = useState<VaultItem | null>(null);
  const [delError, setDelError] = useState<unknown>(null);
  const [delBusy, setDelBusy] = useState(false);
  const info = data?.info || null;
  const caps = data?.caps;
  const remove = async () => {
    if (!deleting) return;
    setDelBusy(true); setDelError(null);
    try { await sa(`/backup/vault/${deleting.id}`, { method: 'DELETE' }); setDeleting(null); reload(); } catch (e) { setDelError(saMessage(e)); } finally { setDelBusy(false); }
  };
  const groups = new Map<string, VaultItem[]>();
  for (const item of info?.items || []) groups.set(item.version, [...(groups.get(item.version) || []), item]);
  const busy = !!caps?.running || !!info?.schedule.busy;
  return (
    <View>
      <Heading title={tr('Backup & restore')} hint={tr('Full backups of the app, saved in the cloud bucket by app version. Restore any of them, even if the code or the database has changed since.')} />
      <ErrorLine error={error} />
      {loading && !data ? <Loading /> : null}
      {caps && !caps.available ? <Notice tone="warn">{tr('This host cannot make backups (no disk). Use the Neon and Cloudflare dashboards, or run the server on a host with a disk.')}</Notice> : null}
      {caps && caps.available && !info ? <Notice tone="warn">{tr('The backup vault is not configured on this server.')}</Notice> : null}
      {info ? (
        <View>
          <Card>
            <T weight="bold" size="lg">{tr('New backup')}</T>
            <Hint>{kindHint(kind)}</Hint>
            <Segmented testID="sa-backup-kind" value={kind} onChange={setKind} options={KINDS.map(k => ({ value: k, label: kindLabel(k), testID: `sa-backup-pick-${k}` }))} />
            <Row style={{ marginTop: SA.space.md }}>
              <Btn testID="sa-backup-now" icon="shieldCheckOutline" label={tr('Back up now')} onPress={() => setStarting(true)} disabled={busy || !info.schedule.available} busy={busy} />
              <T size="xs" color={SA.color.muted}>{info.kind === 'r2' ? tr('Saved in your Cloudflare R2 bucket, folder backup/v{version}/.', { version: info.version }) : tr('Saved in the backup folder of this server (R2 is not configured), folder backup/v{version}/.', { version: info.version })}{info.encrypted ? ` ${tr('Backups are encrypted.')}` : ''}</T>
            </Row>
          </Card>
          <Schedule key={JSON.stringify(info.schedule.settings)} info={info} onSaved={reload} />
          <T weight="bold" size="lg" style={{ marginTop: SA.space.sm, marginBottom: SA.space.sm }}>{tr('History')}</T>
          {info.items.length === 0 ? <Empty>{tr('No backup yet. Make the first one above.')}</Empty> : [...groups].map(([version, list]) => (
            <Card key={version} style={{ padding: 0, marginBottom: SA.space.md }}>
              <View testID="sa-backup-version" style={{ flexDirection: 'row', justifyContent: 'space-between', padding: SA.space.md, backgroundColor: SA.color.panel2, borderTopLeftRadius: SA.radius.lg, borderTopRightRadius: SA.radius.lg }}>
                <T weight="bold">{tr('Version {version}', { version })}</T>
                <T size="sm" color={SA.color.muted}>{version === info.version ? tr('current') : ''} {tr('{n} backups', { n: list.length })}</T>
              </View>
              {list.map(item => <ItemRow key={item.id} item={item} current={version === info.version} onRestore={() => setRestoring(item)} onDelete={() => { setDelError(null); setDeleting(item); }} onPreview={() => setViewing(item)} />)}
            </Card>
          ))}
        </View>
      ) : null}
      {starting ? <StartSheet kind={kind} onClose={() => setStarting(false)} onStarted={job => { setStarting(false); setRunning(job); }} /> : null}
      {running ? <RunSheet job={running} onClose={() => { setRunning(null); reload(); }} onDone={reload} /> : null}
      {restoring ? <RestoreSheet item={restoring} onClose={() => { setRestoring(null); reload(); }} onChanged={reload} /> : null}
      {viewing ? (
        <Sheet title={`${kindLabel(viewing.kind)} · ${when(viewing.createdAt)}`} onClose={() => setViewing(null)} wide testID="sa-backup-preview">
          <Image source={{ uri: `${API}/vault/${viewing.id}/preview` }} style={{ width: '100%', aspectRatio: 16 / 10 }} resizeMode="contain" />
          <Hint>{viewing.preview?.source === 'screenshot' ? tr('Screenshot taken just before the backup.') : tr('Snapshot drawn from the data at backup time.')}</Hint>
        </Sheet>
      ) : null}
      {deleting ? (
        <Sheet title={tr('Delete this backup?')} onClose={() => setDeleting(null)} testID="sa-backup-delete-sheet">
          <T size="sm">{`${kindLabel(deleting.kind)} · ${when(deleting.createdAt)} · ${tr('Version {version}', { version: deleting.version })}`}</T>
          <Hint>{tr('The files are removed from the bucket for good.')}</Hint>
          <ErrorLine error={delError} />
          <Row>
            <Btn testID="sa-backup-delete-confirm" kind="danger" label={tr('Delete')} onPress={remove} busy={delBusy} />
            <Btn kind="ghost" label={tr('Cancel')} onPress={() => setDeleting(null)} />
          </Row>
        </Sheet>
      ) : null}
    </View>
  );
}
