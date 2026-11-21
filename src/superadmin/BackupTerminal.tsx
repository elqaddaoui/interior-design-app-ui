/** Terminal-style progress screen for a backup or a restore job: steps, a progress bar and the live log. Styled by SA_TERMINAL only. */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SA, SA_TERMINAL as TM } from './tokens';
import { SaError, sa, saMessage } from './api';
import { tr } from './i18n';
import type { BackupJob, BackupLogLine } from './types';
import { Btn } from './ui';

export const fmtBytes = (n: number | undefined | null) => {
  const v = Number(n) || 0;
  return v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(v / 1e3))} KB`;
};

export function stepLabel(key: string): string {
  switch (key) {
    case 'prepare': return tr('Preparing');
    case 'database': return tr('Database');
    case 'app': return tr('Code');
    case 'media': return tr('Media files');
    case 'package': return tr('Packing');
    case 'vault': return tr('Saving to the vault');
    case 'upload': return tr('Uploading');
    case 'download': return tr('Downloading');
    case 'inspect': return tr('Reading the archive');
    case 'verify': return tr('Checking every file');
    case 'safety': return tr('Safety copy');
    case 'finish': return tr('Finishing');
    default: return key;
  }
}

/** One line of the log, in the console language. Unknown codes are error codes of the server. */
export function lineText(l: BackupLogLine): string {
  const num = (k: string) => Number(l[k]) || 0;
  const str = (k: string) => String(l[k] ?? '');
  switch (l.code) {
    case 'step.start': return tr('Starting: {step}', { step: stepLabel(str('step')) });
    case 'step.done': return tr('Done: {step}', { step: stepLabel(str('step')) });
    case 'preview.ok': return str('source') === 'screenshot' ? tr('Screenshot of the app attached ({size}).', { size: fmtBytes(num('bytes')) }) : tr('Snapshot drawn from the data attached ({size}).', { size: fmtBytes(num('bytes')) });
    case 'prepare.ok': return tr('Ready: {media} media files, {app} code files, app version {version}.', { media: num('media'), app: num('app'), version: str('version') });
    case 'db.table': return tr('Table {table}: {rows} rows', { table: str('table'), rows: num('rows') });
    case 'app.queued': return tr('{files} code files queued.', { files: num('files') });
    case 'media.missing': return tr('A media file could not be found and was skipped: {entry}', { entry: str('entry') });
    case 'vault.ok': return tr('Saved and verified in the vault: {name} ({size}).', { name: str('name'), size: fmtBytes(num('size')) });
    case 'upload.ok': return tr('Sent to {destination}.', { destination: str('destination') });
    case 'backup.done': return tr('Backup finished ({size}).', { size: fmtBytes(num('size')) });
    case 'validate.ok': return tr('The archive is valid: every file matches its checksum.');
    case 'download.ok': return tr('Downloaded from the vault ({size}).', { size: fmtBytes(num('size')) });
    case 'safety.ok': return tr('Safety copy of the current data saved: {name}', { name: str('name') });
    case 'restore.done': return tr('Restore finished.');
    case 'cancel.requested': return tr('Stop requested...');
    default: return saMessage(new SaError(0, l.code));
  }
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 8);
const mono = { fontFamily: Platform.OS === 'web' ? TM.family : Platform.select({ ios: 'Menlo', default: 'monospace' }) } as const;
const GLYPH = { pending: 'o', running: '~', done: '+', error: 'x', skipped: '-' } as const;

function Mono({ children, color = TM.text, bold, size = 12, style, testID }: { children: React.ReactNode; color?: string; bold?: boolean; size?: number; style?: object; testID?: string }) {
  return <Text testID={testID} selectable style={[mono, { color, fontSize: size, lineHeight: size + 6, fontWeight: bold ? '700' : '400' }, style]}>{children}</Text>;
}

export function Terminal({ jobId, onFinished, heading, testID = 'sa-terminal' }: { jobId: string; onFinished?: (job: BackupJob) => void; heading: string; testID?: string }) {
  const [job, setJob] = useState<BackupJob | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const finished = useRef(false);
  const cb = useRef(onFinished);
  useEffect(() => { cb.current = onFinished; });
  const over = !!job && job.status !== 'running' && job.status !== 'queued';
  useEffect(() => {
    let live = true;
    const poll = () => sa<{ job: BackupJob }>(`/backup/jobs/${jobId}`).then(r => {
      if (!live) return;
      setJob(r.job); setError('');
      if (r.job.status !== 'running' && r.job.status !== 'queued' && !finished.current) { finished.current = true; cb.current?.(r.job); }
    }, e => { if (live) setError(saMessage(e)); });
    void poll();
    const timer = setInterval(() => { if (!finished.current) void poll(); }, 900);
    const clockTimer = setInterval(() => { if (!finished.current) setNow(Date.now()); }, 1000);
    return () => { live = false; clearInterval(timer); clearInterval(clockTimer); };
  }, [jobId]);
  const stop = async () => { setStopping(true); try { await sa(`/backup/jobs/${jobId}/cancel`, { method: 'POST' }); } catch (e) { setError(saMessage(e)); } };
  const pct = job ? (job.status === 'done' ? 100 : job.progress) : 0;
  const cells = 24, filled = Math.round((pct / 100) * cells);
  const secs = job?.startedAt ? Math.max(0, Math.round(((job.finishedAt || now) - job.startedAt) / 1000)) : 0;
  const state = !job ? tr('Connecting...') : job.status === 'done' ? tr('Finished') : job.status === 'error' ? tr('Failed') : job.status === 'cancelled' ? tr('Stopped') : job.cancelling || stopping ? tr('Stopping...') : tr('Running');
  const stateColor = !job ? TM.dim : job.status === 'done' ? TM.ok : job.status === 'error' ? TM.danger : job.status === 'cancelled' ? TM.warn : TM.accent;
  return (
    <View testID={testID} style={{ backgroundColor: TM.bg, borderRadius: SA.radius.md, borderWidth: 1, borderColor: TM.line, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: TM.bar, paddingHorizontal: SA.space.md, paddingVertical: SA.space.sm, borderBottomWidth: 1, borderColor: TM.line }}>
        {[TM.danger, TM.warn, TM.ok].map(c => <View key={c} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c, opacity: 0.8 }} />)}
        <Mono color={TM.dim} size={11} style={{ marginLeft: 8, flexShrink: 1 }}>{heading}</Mono>
        <View style={{ flex: 1 }} />
        <Mono testID="sa-terminal-state" color={stateColor} bold size={11}>{state}</Mono>
      </View>
      <View style={{ padding: SA.space.md, gap: 2 }}>
        <Mono testID="sa-terminal-bar" color={stateColor}>{`[${'#'.repeat(filled)}${'.'.repeat(cells - filled)}] ${String(pct).padStart(3, ' ')}%  ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</Mono>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SA.space.md, marginTop: 2 }}>
          {(job?.steps || []).map(s => (
            <Mono key={s.key} size={11} color={s.status === 'done' ? TM.ok : s.status === 'running' ? TM.accent : s.status === 'error' ? TM.danger : TM.dim}>{`${GLYPH[s.status]} ${stepLabel(s.key)}`}</Mono>
          ))}
        </View>
      </View>
      <ScrollView ref={scroller} testID="sa-terminal-log" style={{ height: 260, borderTopWidth: 1, borderColor: TM.line }} contentContainerStyle={{ padding: SA.space.md }}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}>
        {(job?.log || []).map(l => (
          <Mono key={l.n} size={12} color={l.level === 'error' ? TM.danger : l.level === 'warn' ? TM.warn : l.code === 'step.start' ? TM.accent : l.code === 'step.done' || l.code.endsWith('.done') || l.code === 'vault.ok' ? TM.ok : TM.text}>
            <Text style={{ color: TM.dim }}>{`${clock(l.at)}  `}</Text>{`${l.level === 'error' ? 'x ' : l.level === 'warn' ? '! ' : '> '}${lineText(l)}`}
          </Mono>
        ))}
        {job?.status === 'done' ? <Mono color={TM.ok} bold style={{ marginTop: 6 }}>{`$ ${tr('All done.')}`}</Mono> : null}
        {job?.status === 'cancelled' ? <Mono color={TM.warn} bold style={{ marginTop: 6 }}>{`$ ${tr('Stopped. Nothing half-done is kept.')}`}</Mono> : null}
        {job?.status === 'error' ? <Mono color={TM.danger} bold style={{ marginTop: 6 }}>{`$ ${tr('Failed.')} ${job.errors[0]?.code ? saMessage(new SaError(0, job.errors[0].code)) : ''}`}</Mono> : null}
        {error ? <Mono color={TM.warn} style={{ marginTop: 6 }}>{`! ${error}`}</Mono> : null}
      </ScrollView>
      {!over && job ? (
        <View style={{ padding: SA.space.sm, borderTopWidth: 1, borderColor: TM.line, alignItems: 'flex-start' }}>
          <Btn testID="sa-terminal-stop" small kind="ghost" label={tr('Stop')} onPress={stop} disabled={stopping || job.cancelling} />
        </View>
      ) : null}
    </View>
  );
}
