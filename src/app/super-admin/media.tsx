import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { MediaMove, MediaOverview, MediaStorageKind } from '@/superadmin/types';
import { StorageCheck } from '@/superadmin/MediaAudit';
import { AllFiles } from '@/superadmin/MediaFiles';
import { Badge, Btn, Card, ErrorLine, Heading, Hint, Loading, Meter, Notice, Row, T, ago, useLoad } from '@/superadmin/ui';

const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};
const Label = ({ children }: { children: React.ReactNode }) => <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 }}>{children}</T>;

/** One place where files can live: cloud (R2), the server folder, or the database. */
function StorageCard({ id, title, hint, files, bytes, current, available, note, busy, onUse, onMove }: {
  id: string; title: string; hint: string; files: number; bytes: number; current: boolean; available: boolean; note?: string; busy: boolean;
  onUse?: () => void; onMove?: () => void;
}) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 260, marginBottom: 0 }}>
      <View testID={`sa-media-${id}`}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <T weight="bold">{title}</T>
          {current ? <Badge label={tr('Used for new files')} tone="ok" /> : !available ? <Badge label={tr('Not available')} tone="muted" /> : null}
        </Row>
        <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{hint}</T>
        <T size="xl" weight="bold">{size(bytes)}</T>
        <T size="xs" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{tr('{n} files', { n: files })}</T>
        {note ? <T size="xs" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{note}</T> : null}
        {onUse ? (
          <Row>
            {!current ? <Btn small kind="ghost" testID={`sa-media-use-${id}`} label={tr('Use for new files')} onPress={onUse} disabled={!available || busy} /> : null}
            {onMove ? <Btn small testID={`sa-media-move-${id}`} label={tr('Move all media here')} onPress={onMove} disabled={!available || busy || current && !files} /> : null}
          </Row>
        ) : null}
      </View>
    </Card>
  );
}

/** Drives a running move: the server works in time-boxed slices, this calls it again until it is finished. */
function useMover(initial: MediaMove | undefined, onChange: () => void) {
  const [move, setMove] = useState<MediaMove | undefined>(initial);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  const looping = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setMove(initial); }, [initial]);
  useEffect(() => {
    if (move?.status !== 'running' || looping.current) return;
    looping.current = true;
    (async () => {
      try {
        while (alive.current) {
          const next = await sa<MediaMove>('/media/move/step', { method: 'POST' });
          if (!alive.current) break;
          setMove(next);
          if (next.status !== 'running') { onChange(); break; }
        }
      } catch (e) { if (alive.current) setError(saMessage(e)); } finally { looping.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [move?.status]);
  const cancel = async () => { try { setMove(await sa<MediaMove>('/media/move/cancel', { method: 'POST' })); onChange(); } catch (e) { setError(saMessage(e)); } };
  return { move, error, cancel, setMove };
}

export default function MediaStorage() {
  const { data, error, loading, reload } = useLoad(() => sa<MediaOverview>('/media'));
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<MediaStorageKind | null>(null);
  const mover = useMover(data?.move, reload);

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key); setProblem(null); setNote('');
    try { await job(); reload(); } catch (e) { setProblem(saMessage(e)); } finally { setBusy(''); }
  };
  const switchStorage = (storage: MediaStorageKind, moveAll: boolean) => run('storage', async () => {
    const next = await sa<MediaOverview>('/media/storage', { method: 'PUT', body: { storage, move: moveAll } });
    mover.setMove(next.move); setConfirm(null);
  });
  const cleanup = () => run('cleanup', async () => {
    const r = await sa<{ removed: number; bytes: number }>('/media/cleanup', { method: 'POST' });
    setNote(tr('Removed {n} old copies ({size}).', { n: r.removed, size: size(r.bytes) }));
  });

  const m = mover.move;
  const running = m?.status === 'running';
  const current = data?.storage.current;
  const label = (kind?: string) => (kind === 'r2' ? tr('Cloudflare R2') : kind === 'app' ? tr('App folder (self-hosted)') : tr('Database'));
  const percent = m?.total ? Math.min(100, Math.round(((m.done || 0) + (m.failed || 0)) / m.total * 100)) : 0;

  return (
    <View>
      <Heading title={tr('Media & storage')} hint={tr('Where the pictures and videos of every store live. A file is stored once and shared by every store that uses it.')} />
      <ErrorLine error={error || problem || mover.error} />
      {note ? <Notice tone="ok">{note}</Notice> : null}
      {loading && !data ? <Loading /> : data ? (
        <View>
          <Label>{tr('Storage')}</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.md, marginBottom: SA.space.md }}>
            <StorageCard id="r2" title={tr('Cloudflare R2')} hint={tr('Cloud storage. Fast, shared by every server, nothing to maintain.')}
              files={data.totals.r2.files} bytes={data.totals.r2.bytes} current={current === 'r2'} available={data.storage.r2.available} busy={busy !== '' || running}
              note={data.storage.r2.available ? undefined : tr('Not configured on this server. See docs/r2-setup.md.')}
              onUse={() => switchStorage('r2', false)} onMove={() => setConfirm('r2')} />
            <StorageCard id="app" title={tr('App folder (self-hosted)')} hint={tr('A folder on this server. No cloud account needed.')}
              files={data.totals.app.files} bytes={data.totals.app.bytes} current={current === 'app'} available={data.storage.app.available} busy={busy !== '' || running}
              note={!data.storage.app.available ? tr('This host cannot keep files on disk.')
                : data.storage.app.persistent === false ? tr('Files here are lost when the host redeploys. Set MEDIA_DIR to a folder outside the build.')
                  : data.storage.app.freeBytes != null ? tr('{size} free on the disk.', { size: size(data.storage.app.freeBytes) }) : undefined}
              onUse={() => switchStorage('app', false)} onMove={() => setConfirm('app')} />
            <StorageCard id="db" title={tr('Database')} hint={tr('Small files kept inside the database. Used when nothing else is set up.')}
              files={data.totals.database.files} bytes={data.totals.database.bytes} current={current === 'db'} available busy={false} />
          </View>

          {confirm ? (
            <Notice tone="warn" testID="sa-media-confirm">
              {tr('Move every file of every store to {where}? Files are copied and checked first. The old copies are kept for 24 hours, then you can remove them.', { where: label(confirm) })}
              <Row style={{ marginTop: SA.space.sm }}>
                <Btn small testID="sa-media-move-go" label={tr('Move now')} onPress={() => switchStorage(confirm, true)} busy={busy === 'storage'} />
                <Btn small kind="ghost" label={tr('Cancel')} onPress={() => setConfirm(null)} />
              </Row>
            </Notice>
          ) : null}

          {m && m.status !== 'idle' ? (
            <Card>
              <View testID="sa-media-progress">
                <Row style={{ justifyContent: 'space-between' }}>
                  <T weight="bold">{tr('Move to {where}', { where: label(m.target) })}</T>
                  <Badge label={running ? tr('Running') : m.status === 'done' ? tr('Finished') : tr('Stopped')} tone={running ? 'warn' : m.status === 'done' ? 'ok' : 'muted'} />
                </Row>
                <View style={{ marginVertical: SA.space.sm }}><Meter used={percent} limit={100} /></View>
                <T size="sm" color={SA.color.muted}>{tr('{done} of {total} files · {size}', { done: m.done || 0, total: m.total || 0, size: size(m.movedBytes) })}</T>
                {m.failed ? <T size="sm" color={SA.color.danger}>{tr('{n} files could not be moved. Start the move again to retry them.', { n: m.failed })}</T> : null}
                {running ? <View style={{ marginTop: SA.space.sm }}><Btn small kind="danger" label={tr('Stop')} onPress={mover.cancel} /></View> : null}
              </View>
            </Card>
          ) : null}

          {data.oldCopies.files ? (
            <Card>
              <View testID="sa-media-old">
                <T weight="bold">{tr('Old copies left by a move')}</T>
                <T size="sm" color={SA.color.muted} style={{ marginVertical: 4 }}>
                  {data.oldCopies.cleanable
                    ? tr('{n} files ({size}) can be removed. Each one is checked in its new place first.', { n: data.oldCopies.files, size: size(data.oldCopies.bytes) })
                    : tr('{n} files ({size}) are kept for 24 hours as a safety net. Removable {when}.', { n: data.oldCopies.files, size: size(data.oldCopies.bytes), when: data.oldCopies.cleanableAt ? new Date(data.oldCopies.cleanableAt).toLocaleString() : '' })}
                </T>
                <Btn small kind="ghost" testID="sa-media-cleanup" label={tr('Remove old copies')} onPress={cleanup} busy={busy === 'cleanup'} disabled={!data.oldCopies.cleanable} />
              </View>
            </Card>
          ) : null}

          <Label>{tr('Storage health')}</Label>
          <StorageCheck onChanged={reload} />

          <Label>{tr('Files')}</Label>
          <AllFiles onChanged={reload} />

          <Label>{tr('Client stores')}</Label>
          <Card style={{ padding: 0 }}>
            <Row style={{ padding: SA.space.md, justifyContent: 'space-between', borderBottomWidth: 1, borderColor: SA.color.line, flexWrap: 'nowrap' }}>
              <T size="xs" weight="bold" color={SA.color.muted} style={{ flex: 1 }}>{tr('Store')}</T>
              <T size="xs" weight="bold" color={SA.color.muted} style={{ width: 80, textAlign: 'right' }}>{tr('Files')}</T>
              <T size="xs" weight="bold" color={SA.color.muted} style={{ width: 90, textAlign: 'right' }}>{tr('Size')}</T>
            </Row>
            {data.stores.filter(s => s.kind === 'instance').map((s, i) => (
              <View key={s.id} testID="sa-media-store" style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, padding: SA.space.md, justifyContent: 'space-between', borderTopWidth: i ? 1 : 0, borderColor: SA.color.line }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T weight="bold" numberOfLines={1}>{s.name}</T>
                  <T size="xs" color={SA.color.muted} numberOfLines={1}>{`/${s.slug}`}</T>
                </View>
                <T style={{ width: 80, textAlign: 'right' }}>{String(s.files)}</T>
                <T weight="bold" style={{ width: 90, textAlign: 'right' }}>{size(s.bytes)}</T>
              </View>
            ))}
            {!data.stores.some(s => s.kind === 'instance') ? <T size="sm" color={SA.color.muted} style={{ padding: SA.space.md }}>{tr('No client stores yet.')}</T> : null}
          </Card>
          <Hint>{tr('Cloned or restored stores share the same files. A file is removed from storage only when the last store using it deletes it.')}</Hint>
          {data.oldCopies.oldestAt ? <T size="xs" color={SA.color.muted}>{tr('Last move {when}', { when: ago(data.oldCopies.oldestAt) })}</T> : null}
        </View>
      ) : null}
    </View>
  );
}
