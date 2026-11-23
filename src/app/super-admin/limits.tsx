import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { BackupTarget, LimitLevel, LimitMetric, LimitSettings, LimitsStatus } from '@/superadmin/types';
import { Icon, type IconName } from '@/superadmin/icons';
import { BrowserNotifyCard } from '@/superadmin/NoticeCenter';
import { Badge, Btn, Card, ErrorLine, Heading, Hint, Loading, Notice, Row, T, ago, useLoad } from '@/superadmin/ui';

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

/** What the automatic full backup (started when a limit reaches the threshold) did last. */
function AutoBackupLine({ status }: { status: LimitsStatus }) {
  const auto = status.autoBackup;
  if (!status.settings.autoBackup) return <Hint>{tr('The automatic full backup is off.')}</Hint>;
  const hint = <Hint>{tr('A full backup is made by itself when a limit reaches {pct} %.', { pct: status.settings.autoBackupAt })}</Hint>;
  if (!auto) return hint;
  const what = (auto.ids || []).map(id => tr(TITLE[id] || id)).join(', ');
  return (
    <View>
      {hint}
      {auto.status === 'running' ? <Notice tone="warn" testID="sa-limits-auto">{tr('An automatic full backup is running ({what}).', { what })}</Notice>
        : auto.status === 'done' ? <Notice tone="ok" testID="sa-limits-auto">{tr('Automatic full backup made {when} ({what}).', { when: ago(auto.finishedAt || auto.at), what })}</Notice>
          : <Notice tone="danger" testID="sa-limits-auto">{tr('The automatic full backup failed {when}. It will be tried again.', { when: ago(auto.finishedAt || auto.at) })}</Notice>}
    </View>
  );
}

/** Backups live on their own page now; here only the reminder and the way there. */
function BackupCard({ status }: { status: LimitsStatus }) {
  const router = useRouter();
  const last = status.lastBackupAt;
  const age = last ? daysSince(last) : null;
  return (
    <Card>
      <T weight="bold" size="lg">{tr('Backup & restore')}</T>
      <Hint>{tr('Full, database, code or media backups, daily backups, history by version and restore now have their own page.')}</Hint>
      <Notice tone={last == null || (age ?? 0) > 14 ? 'warn' : 'ok'} testID="sa-limits-lastbackup">{last == null ? tr('No backup has been saved yet.') : tr('Last backup you saved: {when}.', { when: ago(last) })}</Notice>
      <AutoBackupLine status={status} />
      <Row>
        <Btn testID="sa-limits-backup" icon="shieldCheckOutline" label={tr('Open the backup page')} onPress={() => router.push('/super-admin/backup')} />
      </Row>
    </Card>
  );
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** A pill switch. */
function Toggle({ on, onChange, label, testID }: { on: boolean; onChange: (on: boolean) => void; label: string; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => onChange(!on)}
      style={{ width: 44, height: 26, borderRadius: 13, padding: 3, backgroundColor: on ? SA.color.accent : SA.color.line, justifyContent: 'center' }}>
      <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: SA.color.panel, alignSelf: on ? 'flex-end' : 'flex-start' }} />
    </Pressable>
  );
}

/** − 70 % +  (a number the owner nudges instead of typing). */
function Stepper({ value, min, max, step = 5, unit, onChange, testID, label }: { value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void; testID?: string; label: string }) {
  const button = (icon: 'minus' | 'plus', delta: number, name: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${name}`} disabled={clamp(value + delta, min, max) === value} onPress={() => onChange(clamp(value + delta, min, max))}
      style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? SA.color.line : SA.color.panel2, opacity: clamp(value + delta, min, max) === value ? 0.35 : 1 })}>
      <Icon name={icon} size={16} color={SA.color.text} />
    </Pressable>
  );
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm }}>
      {button('minus', -step, tr('Less'))}
      <T weight="bold" style={{ minWidth: 58, textAlign: 'center' }}>{value} {unit}</T>
      {button('plus', step, tr('More'))}
    </View>
  );
}

/** One line of the settings: what it is on the left, the control on the right. */
function Line({ color, title, hint, children }: { color?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SA.space.md, flexWrap: 'wrap', paddingVertical: SA.space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, flexShrink: 1, minWidth: 180, flex: 1 }}>
        {color ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} /> : null}
        <View style={{ flexShrink: 1 }}>
          <T size="sm" weight="bold">{title}</T>
          {hint ? <T size="xs" color={SA.color.muted}>{hint}</T> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

/** The three levels drawn as one bar: calm, heads-up, back up now, critical, with a shield where the automatic backup starts. */
function Ladder({ draft }: { draft: LimitSettings }) {
  const parts = [
    { to: draft.warnAt, color: SA.color.line }, { to: draft.urgentAt, color: SA.color.warn }, { to: draft.criticalAt, color: SA.color.danger }, { to: 100, color: SA.color.danger },
  ];
  let from = 0;
  const segments = parts.map((p, i) => { const seg = { key: i, left: from, width: Math.max(0, p.to - from), color: p.color, soft: i === 3 }; from = p.to; return seg; });
  return (
    <View testID="sa-limits-ladder" style={{ marginTop: SA.space.sm, marginBottom: SA.space.md }}>
      <View style={{ height: 22 }}>
        {draft.autoBackup ? (
          <View style={{ position: 'absolute', start: `${draft.autoBackupAt}%`, top: 0, marginStart: -9, alignItems: 'center' }}>
            <Icon name="shieldCheckOutline" size={18} color={SA.color.accent} />
          </View>
        ) : null}
      </View>
      <View style={{ height: 12, borderRadius: 6, backgroundColor: SA.color.panel2, overflow: 'hidden', flexDirection: 'row' }}>
        {segments.map(seg => <View key={seg.key} style={{ width: `${seg.width}%`, backgroundColor: seg.color, opacity: seg.soft ? 0.55 : seg.key === 0 ? 0.55 : 1 }} />)}
      </View>
      <View style={{ height: 18, marginTop: 4 }}>
        {[draft.warnAt, draft.urgentAt, draft.criticalAt].map(v => (
          <T key={v} size="xs" color={SA.color.muted} style={{ position: 'absolute', start: `${v}%`, marginStart: -10 }}>{v}</T>
        ))}
      </View>
    </View>
  );
}

const TARGETS: { id: BackupTarget; icon: IconName; label: string }[] = [
  { id: 'auto', icon: 'tuneVariant', label: 'Automatic' }, { id: 'vault', icon: 'shieldCheckOutline', label: 'Backup vault' },
  { id: 'gdrive', icon: 'googleDrive', label: 'Google Drive' }, { id: 'dropbox', icon: 'dropbox', label: 'Dropbox' },
];
const TARGET_HINT: Record<BackupTarget, string> = {
  auto: 'Smart choice: when only R2 is nearly full, the copy goes to Google Drive or Dropbox (if set up on the server) so it does not use the space that is running out. Otherwise it goes to your backup vault.',
  vault: 'Always into your backup vault.',
  gdrive: 'Always to Google Drive.',
  dropbox: 'Always to Dropbox.',
};

function Settings({ status, onSaved }: { status: LimitsStatus; onSaved: () => void }) {
  const [draft, setDraft] = useState<LimitSettings>(status.settings);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(status.settings);
  const set = (patch: Partial<LimitSettings>) => { setNote(null); setDraft({ ...draft, ...patch }); };
  const save = async () => {
    setBusy(true); setError(null); setNote(null);
    try { await sa('/limits/settings', { method: 'PATCH', body: draft }); setNote(tr('Saved.')); onSaved(); } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };
  const ready = (id: BackupTarget) => id === 'gdrive' ? status.destinations.gdrive : id === 'dropbox' ? status.destinations.dropbox : true;
  const missing = !ready(draft.autoBackupTo);
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flexShrink: 1 }}>
          <T weight="bold" size="lg">{tr('Warning settings')}</T>
          <T size="sm" color={SA.color.muted}>{tr('A notification appears here and in your browser when a limit gets close.')}</T>
        </View>
        <Toggle testID="sa-limits-enabled" on={draft.enabled} label={tr('Warnings')} onChange={enabled => set({ enabled })} />
      </Row>

      {draft.enabled ? (
        <View>
          <Ladder draft={draft} />
          <Line color={SA.color.warn} title={tr('Heads-up')} hint={tr('Plan a backup soon')}>
            <Stepper label={tr('Heads-up')} value={draft.warnAt} min={10} max={draft.urgentAt - 1} unit="%" onChange={warnAt => set({ warnAt })} />
          </Line>
          <Line color={SA.color.danger} title={tr('Back up now')} hint={tr('The time to save everything')}>
            <Stepper label={tr('Back up now')} value={draft.urgentAt} min={draft.warnAt + 1} max={draft.criticalAt - 1} unit="%" onChange={urgentAt => set({ urgentAt })} />
          </Line>
          <Line color={SA.color.danger} title={tr('Critical')} hint={tr('Almost at the limit')}>
            <Stepper label={tr('Critical')} value={draft.criticalAt} min={draft.urgentAt + 1} max={100} unit="%" onChange={criticalAt => set({ criticalAt })} />
          </Line>
        </View>
      ) : null}

      <View style={{ height: 1, backgroundColor: SA.color.line, marginVertical: SA.space.md }} />

      <Line title={tr('Automatic full backup')} hint={tr('Database, code and files, made by itself.')}>
        <Toggle testID="sa-limits-auto-on" on={draft.autoBackup} label={tr('Automatic full backup')} onChange={autoBackup => set({ autoBackup })} />
      </Line>
      {draft.autoBackup ? (
        <View>
          <Line title={tr('Start at')} hint={tr('When any limit reaches this level')}>
            <Stepper testID="sa-limits-autoat" label={tr('Start at')} value={draft.autoBackupAt} min={50} max={100} unit="%" onChange={autoBackupAt => set({ autoBackupAt })} />
          </Line>
          <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginTop: SA.space.sm, marginBottom: SA.space.sm }}>{tr('Save the copy to')}</T>
          <View testID="sa-limits-target" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.sm }}>
            {TARGETS.map(t => {
              const on = draft.autoBackupTo === t.id, off = !ready(t.id);
              return (
                <Pressable key={t.id} testID={`sa-limits-target-${t.id}`} accessibilityRole="button" accessibilityState={{ selected: on, disabled: off && !on }} disabled={off && !on} onPress={() => set({ autoBackupTo: t.id })}
                  style={{ flexGrow: 1, flexBasis: 140, flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, paddingVertical: SA.space.sm, paddingHorizontal: SA.space.md, borderRadius: SA.radius.md, borderWidth: 1.5, borderColor: on ? SA.color.accent : SA.color.line, backgroundColor: on ? SA.color.accentSoft : 'transparent', opacity: off && !on ? 0.5 : 1 }}>
                  <Icon name={t.icon} size={20} color={on ? SA.color.accent : SA.color.muted} />
                  <View style={{ flexShrink: 1 }}>
                    <T size="sm" weight="bold" color={on ? SA.color.accent : SA.color.text} numberOfLines={1}>{tr(t.label)}</T>
                    {off ? <T size="xs" color={SA.color.muted} numberOfLines={1}>{tr('Not set up')}</T> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <T size="sm" color={SA.color.muted} style={{ marginTop: SA.space.sm }}>{tr(TARGET_HINT[draft.autoBackupTo])}</T>
          {missing ? <View style={{ marginTop: SA.space.sm }}><Notice tone="warn">{tr('This place is not set up on the server yet, so the automatic backup would fail. Choose Automatic, or add its token in the server settings.')}</Notice></View> : null}
        </View>
      ) : null}

      <View style={{ height: 1, backgroundColor: SA.color.line, marginVertical: SA.space.md }} />

      <Pressable testID="sa-limits-more" accessibilityRole="button" onPress={() => setMore(!more)} style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm }}>
        <Icon name={more ? 'chevronUp' : 'chevronDown'} size={18} color={SA.color.muted} />
        <T size="sm" weight="bold" color={SA.color.muted}>{more ? tr('Fewer options') : tr('More options')}</T>
      </Pressable>
      {more ? (
        <View style={{ marginTop: SA.space.sm }}>
          <Line title={tr('Forecast')} hint={draft.forecastDays ? tr('Warn if a limit would be reached within {n} days', { n: draft.forecastDays }) : tr('Off')}>
            <Stepper label={tr('Forecast')} value={draft.forecastDays} min={0} max={60} step={1} unit={tr('days')} onChange={forecastDays => set({ forecastDays })} />
          </Line>
          <Line title={tr('Reminder')} hint={tr('Remind me again while it stays high')}>
            <Stepper label={tr('Reminder')} value={draft.reminderHours} min={1} max={168} step={1} unit="h" onChange={reminderHours => set({ reminderHours })} />
          </Line>
          <Line title={tr('Watch Neon')} hint={tr('The database')}><Toggle on={draft.services.neon} label={tr('Watch Neon')} onChange={neon => set({ services: { ...draft.services, neon } })} /></Line>
          <Line title={tr('Watch Cloudflare')} hint={tr('The R2 files')}><Toggle on={draft.services.cloudflare} label={tr('Watch Cloudflare')} onChange={cloudflare => set({ services: { ...draft.services, cloudflare } })} /></Line>
        </View>
      ) : null}

      <ErrorLine error={error} />
      {note ? <View style={{ marginTop: SA.space.md }}><Notice tone="ok">{note}</Notice></View> : null}
      <Row style={{ marginTop: SA.space.lg }}>
        <Btn testID="sa-limits-save" label={tr('Save')} onPress={save} busy={busy} disabled={!dirty} />
        <Btn kind="ghost" label={tr('Back to the defaults')} onPress={() => set({ ...status.defaults, limits: draft.limits })} disabled={busy} />
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
          <T size="xs" color={SA.color.muted} style={{ marginBottom: SA.space.md }}>{tr('Last checked {when}.', { when: ago(data.at) })}</T>
          <BrowserNotifyCard />
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
