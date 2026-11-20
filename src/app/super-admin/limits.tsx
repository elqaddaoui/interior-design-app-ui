import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { BackupCaps, BackupJob, LimitLevel, LimitMetric, LimitSettings, LimitsStatus } from '@/superadmin/types';
import { Badge, Btn, Card, ErrorLine, Field, Heading, Hint, Loading, Notice, Row, Segmented, T, ago, openUrl, useLoad } from '@/superadmin/ui';

const GB = 1e9;
const TITLE: Record<string, string> = {
  'neon.storage': 'Neon database storage', 'neon.compute': 'Neon compute hours', 'neon.egress': 'Neon network transfer',
  'r2.storage': 'R2 file storage', 'r2.classA': 'R2 write operations (Class A)', 'r2.classB': 'R2 read operations (Class B)',
};
const EFFECT: Record<string, string> = {
  writes: 'At the limit, saving fails until you free space or upgrade. Reading and backups still work.',
  suspend: 'At the limit, the database is suspended until the next period and cannot be backed up.',
  billing: 'Above the free amount the service keeps working and Cloudflare starts charging.',
};
const LEVEL_LABEL: Record<LimitLevel, string> = { ok: 'Normal', warn: 'Warning', urgent: 'Back up now', critical: 'Critical' };
const LEVEL_TONE = { ok: 'ok', warn: 'warn', urgent: 'danger', critical: 'danger' } as const;
const LEVEL_COLOR = { ok: SA.color.accent, warn: SA.color.warn, urgent: SA.color.danger, critical: SA.color.danger };
const SERVICES: { id: 'neon' | 'cloudflare'; title: string; hint: string }[] = [
  { id: 'neon', title: 'Neon (database)', hint: 'Everything the platform and its stores save.' },
  { id: 'cloudflare', title: 'Cloudflare R2 (files)', hint: 'Pictures, videos and other uploaded files.' },
];

const size = (v: number) => (v >= GB ? `${(v / GB).toFixed(2)} GB` : `${(v / 1e6).toFixed(1)} MB`);
const amount = (m: LimitMetric, v: number | null) => (v == null ? '?' : m.unit === 'bytes' ? size(v) : m.unit === 'hours' ? `${v.toFixed(1)} h` : Math.round(v).toLocaleString('en'));
const daysSince = (at: number) => Math.floor((Date.now() - at) / 86400000);
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

function Bar({ pct, level }: { pct: number; level: LimitLevel }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: SA.color.panel2, marginTop: 8, overflow: 'hidden' }}>
      <View style={{ height: 8, width: `${Math.max(2, Math.min(100, pct))}%`, backgroundColor: LEVEL_COLOR[level] }} />
    </View>
  );
}

function MetricCard({ m }: { m: LimitMetric }) {
  const shown = m.status === 'ok' && m.pct != null;
  return (
    <View testID={`sa-limit-${m.id}`} style={{ paddingVertical: SA.space.md, borderTopWidth: 1, borderColor: SA.color.line }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T weight="bold">{tr(TITLE[m.id] || m.id)}</T>
        {shown ? <Badge label={tr(LEVEL_LABEL[m.level])} tone={LEVEL_TONE[m.level]} /> : m.status === 'needs_setup' ? <Badge label={tr('Not connected')} tone="muted" /> : <Badge label={tr('Cannot be read')} tone="warn" />}
      </Row>
      {shown ? (
        <View>
          <T size="sm" style={{ marginTop: 4 }}>{tr('{used} of {limit} ({pct} %)', { used: amount(m, m.used), limit: amount(m, m.limit), pct: m.pct as number })}</T>
          <Bar pct={m.pct as number} level={m.level} />
          {m.source === 'estimate' ? <Hint>{tr('Estimated from the files the app knows about. Add CLOUDFLARE_API_TOKEN for the real figure.')}</Hint> : null}
          {m.limitSource === 'custom' ? <Hint>{tr('Limit set by you.')}</Hint> : null}
          {m.exceeded ? <Notice tone="danger">{tr('The limit is reached.')}</Notice> : null}
          {m.reserve ? <Notice tone="danger">{tr('Only {left} of transfer is left and a full backup needs about {need}. Back up now.', { left: amount(m, m.reserve.left), need: amount(m, m.reserve.need) })}</Notice> : null}
          {m.projection && !m.exceeded ? <Notice tone="warn">{tr('At the current pace it runs out around {date} (in about {days} days).', { date: day(m.projection.at), days: m.projection.days })}</Notice> : null}
          <T size="xs" color={SA.color.muted} style={{ marginTop: 6 }}>{tr(EFFECT[m.effect] || EFFECT.writes)}{m.resetsAt ? ` ${tr('Resets on {date}.', { date: day(m.resetsAt) })}` : ''}</T>
        </View>
      ) : m.status === 'needs_setup' ? (
        <T size="sm" color={SA.color.muted} style={{ marginTop: 4 }}>{tr('Add {vars} on the server to measure this.', { vars: m.needs.join(', ') })}</T>
      ) : (
        <T size="sm" color={SA.color.warn} style={{ marginTop: 4 }}>{tr(m.error === 'AUTH' ? 'The provider refused the key. Check that it is correct and still valid.' : 'The provider could not be reached. The next check tries again.')}</T>
      )}
    </View>
  );
}

/** Starts a full backup (database + files) and follows it until it can be downloaded. */
function BackupCard({ status }: { status: LimitsStatus }) {
  const [job, setJob] = useState<BackupJob | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const running = !!job && (job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!job || !running) return undefined;
    const timer = setInterval(() => { sa<{ job: BackupJob }>(`/backup/jobs/${job.id}`).then(r => { if (live.current) setJob(r.job); }, () => { /* next round */ }); }, 2500);
    return () => clearInterval(timer);
  }, [job?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setBusy(true); setError(null);
    try { const caps = await sa<BackupCaps>('/backup/capabilities'); void caps; const r = await sa<{ job: BackupJob }>('/backup/jobs', { method: 'POST', body: { type: 'both', data: 'content', media: true, destination: 'local' } }); setJob(r.job); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const last = status.lastBackupAt;
  const age = last ? daysSince(last) : null;
  return (
    <Card>
      <T weight="bold" size="lg">{tr('Back up all data')}</T>
      <Hint>{tr('One archive with the database and every uploaded file. Download it and keep it somewhere safe: that is the copy that counts.')}</Hint>
      <Notice tone={last == null || (age ?? 0) > 14 ? 'warn' : 'ok'} testID="sa-limits-lastbackup">{last == null ? tr('No backup has been saved yet.') : tr('Last backup you saved: {when}.', { when: ago(last) })}</Notice>
      {!status.backupHost ? <Notice tone="warn">{tr('This host cannot make backups (no disk). Use the Neon and Cloudflare dashboards, or run the server on a host with a disk.')}</Notice> : null}
      <ErrorLine error={error} />
      {job ? (
        <View style={{ marginBottom: SA.space.md }}>
          <T size="sm" weight="bold">{running ? tr('Backup in progress: {n} %', { n: job.progress }) : job.status === 'done' ? tr('Backup ready.') : job.status === 'cancelled' ? tr('Backup cancelled.') : tr('The backup failed.')}</T>
          {running ? <Bar pct={job.progress} level="ok" /> : null}
          {job.status === 'error' && job.errors[0] ? <T size="sm" color={SA.color.danger}>{job.errors[0]}</T> : null}
          {job.warnings.length ? <Hint>{job.warnings.join(' · ')}</Hint> : null}
        </View>
      ) : null}
      <Row>
        {job?.canDownload && !running ? <Btn testID="sa-limits-download" label={tr('Download the backup')} icon="openInNew" onPress={() => openUrl(`/api/super-admin/backup/jobs/${job.id}/download`)} /> : null}
        <Btn testID="sa-limits-backup" kind={job?.canDownload ? 'ghost' : 'solid'} label={tr('Back up all data now')} onPress={start} busy={busy || running} disabled={!status.backupHost} />
      </Row>
    </Card>
  );
}

const num = (v: string) => Number(v.replace(/\D/g, '')) || 0;

function Settings({ status, onSaved }: { status: LimitsStatus; onSaved: () => void }) {
  const [draft, setDraft] = useState<LimitSettings>(status.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setError(null); setNote(null);
    try { await sa('/limits/settings', { method: 'PATCH', body: draft }); setNote({ tone: 'ok', text: tr('Saved.') }); onSaved(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError(null); setNote(null);
    try { const r = await sa<{ to: string }>('/limits/test', { method: 'POST', body: {} }); setNote({ tone: 'ok', text: tr('Test e-mail sent to {to}.', { to: r.to }) }); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const onOff = (value: boolean, change: (v: boolean) => void) => <Segmented value={value ? 'on' : 'off'} onChange={v => change(v === 'on')} options={[{ value: 'on', label: tr('On') }, { value: 'off', label: tr('Off') }]} />;
  return (
    <Card>
      <T weight="bold" size="lg">{tr('Warning settings')}</T>
      <Hint>{tr('You are e-mailed when a limit gets close, again when it gets closer, and as a reminder while it stays high. The goal: time to back up before anything is restricted.')}</Hint>
      {!status.delivery.transport ? <Notice tone="warn">{tr('No way to send e-mails is configured on the server yet (RESEND_API_KEY or ALERT_WEBHOOK_URL). Warnings are still listed here.')}</Notice> : null}
      <Row style={{ marginBottom: SA.space.md }}>
        <T size="sm">{tr('Warnings')}</T>{onOff(draft.enabled, enabled => setDraft({ ...draft, enabled }))}
        <T size="sm">{tr('Watch Neon')}</T>{onOff(draft.services.neon, neon => setDraft({ ...draft, services: { ...draft.services, neon } }))}
        <T size="sm">{tr('Watch Cloudflare')}</T>{onOff(draft.services.cloudflare, cloudflare => setDraft({ ...draft, services: { ...draft.services, cloudflare } }))}
      </Row>
      <Field label={tr('Send warnings to')} value={draft.email} onChangeText={email => setDraft({ ...draft, email })} placeholder={status.delivery.recipient || 'you@example.com'} keyboardType="email-address" {...({ testID: 'sa-limits-email' } as object)} />
      <Hint>{status.delivery.recipient ? tr('Empty = {to}, the same address as the API warnings.', { to: status.delivery.recipient }) : tr('Empty = the first super admin.')}</Hint>
      <Field label={tr('Warning from (% of the limit)')} value={String(draft.warnAt)} onChangeText={v => setDraft({ ...draft, warnAt: num(v) })} keyboardType="number-pad" />
      <Field label={tr('Back up now from (% of the limit)')} value={String(draft.urgentAt)} onChangeText={v => setDraft({ ...draft, urgentAt: num(v) })} keyboardType="number-pad" />
      <Field label={tr('Critical from (% of the limit)')} value={String(draft.criticalAt)} onChangeText={v => setDraft({ ...draft, criticalAt: num(v) })} keyboardType="number-pad" />
      <Field label={tr('Warn when a limit would be reached within (days, 0 = off)')} value={String(draft.forecastDays)} onChangeText={v => setDraft({ ...draft, forecastDays: num(v) })} keyboardType="number-pad" />
      <Field label={tr('Remind me again after (hours)')} value={String(draft.reminderHours)} onChangeText={v => setDraft({ ...draft, reminderHours: num(v) })} keyboardType="number-pad" />
      <ErrorLine error={error} />
      {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
      <Row>
        <Btn testID="sa-limits-save" label={tr('Save')} onPress={save} busy={busy} />
        <Btn testID="sa-limits-test" kind="ghost" label={tr('Send a test e-mail')} onPress={test} disabled={busy} />
        <Btn kind="ghost" label={tr('Back to the defaults')} onPress={() => setDraft({ ...status.defaults, email: draft.email, limits: draft.limits })} disabled={busy} />
      </Row>
    </Card>
  );
}

/** Free-tier watch: what Neon and Cloudflare R2 have used of their free allowance, and the early warnings. */
export default function Limits() {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { data, error: loadError, loading, reload } = useLoad(() => sa<LimitsStatus>('/limits'));
  const refresh = async () => {
    setRefreshing(true); setError(null);
    try { await sa<LimitsStatus>('/limits?refresh=1'); reload(); } catch (e) { setError(saMessage(e)); } finally { setRefreshing(false); }
  };
  return (
    <View testID="sa-limits">
      <Heading title={tr('Service limits')} hint={tr('How much of the free plans of Neon and Cloudflare R2 is used, with a warning in time to back up all your data before anything is restricted.')}
        right={<Btn testID="sa-limits-refresh" small kind="ghost" icon="refresh" label={tr('Check now')} onPress={refresh} busy={refreshing} />} />
      <ErrorLine error={loadError || error} />
      {loading && !data ? <Loading /> : data ? (
        <View>
          {data.level === 'ok' ? <Notice tone="ok" testID="sa-limits-banner">{tr('Everything is well within the free limits.')}</Notice>
            : <Notice tone={data.level === 'warn' ? 'warn' : 'danger'} testID="sa-limits-banner">{tr(data.level === 'warn' ? 'A limit is getting close. Plan a backup soon.' : 'A limit is very close. Back up all your data now.')}</Notice>}
          {data.mail && !data.mail.ok ? <Notice tone="warn">{tr('The last warning could not be e-mailed. It will be tried again at the next check.')}</Notice> : null}
          <T size="xs" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>{tr('Last checked {when}.', { when: ago(data.at) })}</T>
          <BackupCard status={data} />
          {SERVICES.map(service => {
            const info = data.services[service.id];
            const metrics = data.metrics.filter(m => m.service === service.id);
            return (
              <Card key={service.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T weight="bold" size="lg">{tr(service.title)}</T>
                  {info?.state === 'off' ? <Badge label={tr('Not watched')} /> : info?.state === 'not_used' ? <Badge label={tr('Not used here')} /> : null}
                </Row>
                <Hint>{tr(service.hint)}</Hint>
                {info?.state === 'off' ? <T size="sm" color={SA.color.muted}>{tr('Switched off in the settings below.')}</T>
                  : info?.state === 'not_used' ? <T size="sm" color={SA.color.muted}>{tr('This service is not used by this server.')}</T>
                    : metrics.map(m => <MetricCard key={m.id} m={m} />)}
              </Card>
            );
          })}
          <Settings key={JSON.stringify(data.settings)} status={data} onSaved={reload} />
        </View>
      ) : null}
    </View>
  );
}
