import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { IconName } from '@/superadmin/icons';
import type { MediaMove, MediaOverview, MediaStorageKind } from '@/superadmin/types';
import { MediaFolder } from '@/superadmin/MediaFolder';
import { MediaFiles } from '@/superadmin/MediaFiles';
import { MediaHistory } from '@/superadmin/MediaHistory';
import { Figure, IconBox, Section, Share, TextLink, size, storageName, type Tone } from '@/superadmin/MediaBits';
import { Badge, Btn, ErrorLine, Heading, Hint, Loading, Notice, Row, T, Tabs, ago, useLoad } from '@/superadmin/ui';

type Tab = 'storage' | 'files' | 'tidy' | 'history';

/** One place where files can live: cloud (R2), the server folder, or the database. The one in use wears the accent border. */
function StorageTile({ id, icon, title, hint, files, bytes, share, current, available, note, busy, onUse, onMove }: {
  id: string; icon: IconName; title: string; hint: string; files: number; bytes: number; share: number; current: boolean; available: boolean; note?: string; busy: boolean;
  onUse?: () => void; onMove?: () => void;
}) {
  const tone: Tone = current ? 'accent' : available ? 'muted' : 'warn';
  return (
    <View testID={`sa-media-${id}`} style={{
      flexGrow: 1, flexBasis: 250, padding: SA.space.lg, borderRadius: SA.radius.lg, borderWidth: 2, gap: SA.space.md,
      borderColor: current ? SA.color.accent : SA.color.line, backgroundColor: SA.color.panel, opacity: available ? 1 : 0.8,
    }}>
      <Row style={{ flexWrap: 'nowrap' }}>
        <IconBox name={icon} tone={tone} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T weight="bold" numberOfLines={1}>{title}</T>
          <T size="xs" color={SA.color.muted} numberOfLines={2}>{hint}</T>
        </View>
      </Row>
      <View>
        <Row style={{ alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'nowrap', marginBottom: 6 }}>
          <T size="xl" weight="bold">{size(bytes)}</T>
          <T size="xs" color={SA.color.muted}>{tr('{n} files', { n: files })}</T>
        </Row>
        <Share value={share} tone={current ? 'accent' : 'muted'} />
      </View>
      {current ? <Badge label={tr('Used for new files')} tone="accent" /> : !available ? <Badge label={tr('Not available')} tone="warn" /> : null}
      {note ? <T size="xs" color={SA.color.muted}>{note}</T> : null}
      {onUse ? (
        <Row>
          {!current ? <Btn small kind="ghost" testID={`sa-media-use-${id}`} label={tr('Use for new files')} onPress={onUse} disabled={!available || busy} /> : null}
          {onMove ? <Btn small testID={`sa-media-move-${id}`} icon="download" label={tr('Move all media here')} onPress={onMove} disabled={!available || busy || current && !files} /> : null}
        </Row>
      ) : null}
    </View>
  );
}

/** Drives a running move: the server works in time-boxed slices, this calls it again until it is finished. */
function useMover(initial: MediaMove | undefined, onChange: () => void) {
  const [move, setMove] = useState<MediaMove | undefined>(initial);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  const looping = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (seenInitial !== initial) { setSeenInitial(initial); setMove(initial); } // follow what the server reports
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

/** The Storage tab: where files live now, the move in progress, old copies, and what each store holds. */
function StorageTab({ data, reload, goTidy }: { data: MediaOverview; reload: () => void; goTidy: () => void }) {
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<MediaStorageKind | null>(null);
  const [all, setAll] = useState(false);
  const mover = useMover(data.move, reload);

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
  const current = data.storage.current;
  const t = data.totals;
  const totalFiles = t.r2.files + t.app.files + t.database.files;
  const totalBytes = t.r2.bytes + t.app.bytes + t.database.bytes;
  const share = (bytes: number) => (totalBytes ? bytes / totalBytes : 0);
  const percent = m?.total ? Math.min(100, Math.round(((m.done || 0) + (m.failed || 0)) / m.total * 100)) : 0;
  const stores = data.stores.filter(s => s.kind === 'instance').sort((a, b) => b.bytes - a.bytes);
  const maxBytes = stores.reduce((n, s) => Math.max(n, s.bytes), 0);
  const shownStores = all ? stores : stores.slice(0, 6);

  return (
    <View>
      <ErrorLine error={problem || mover.error} />
      {note ? <Notice tone="ok">{note}</Notice> : null}

      <Row style={{ alignItems: 'stretch', marginBottom: SA.space.xl }}>
        <Figure label={tr('Files')} value={totalFiles.toLocaleString('en')} />
        <Figure label={tr('Size')} value={size(totalBytes)} />
        <Figure label={tr('Client stores')} value={stores.length} />
      </Row>

      <Section title={tr('Where files live')}>
        <Row style={{ alignItems: 'stretch', gap: SA.space.md }}>
          <StorageTile id="r2" icon="cloudOutline" title={tr('Cloudflare R2')} hint={tr('Cloud storage. Fast, shared by every server, nothing to maintain.')}
            files={t.r2.files} bytes={t.r2.bytes} share={share(t.r2.bytes)} current={current === 'r2'} available={data.storage.r2.available} busy={busy !== '' || running}
            note={data.storage.r2.available ? undefined : tr('Not configured on this server. See docs/r2-setup.md.')}
            onUse={() => switchStorage('r2', false)} onMove={() => setConfirm('r2')} />
          <StorageTile id="app" icon="harddisk" title={tr('App folder (self-hosted)')} hint={tr('A folder on this server. No cloud account needed.')}
            files={t.app.files} bytes={t.app.bytes} share={share(t.app.bytes)} current={current === 'app'} available={data.storage.app.available} busy={busy !== '' || running}
            note={!data.storage.app.available ? tr('This host cannot keep files on disk.')
              : data.storage.app.persistent === false ? tr('Files here are lost when the host redeploys. Set MEDIA_DIR to a folder outside the build.')
                : data.storage.app.freeBytes != null ? tr('{size} free on the disk.', { size: size(data.storage.app.freeBytes) }) : undefined}
            onUse={() => switchStorage('app', false)} onMove={() => setConfirm('app')} />
          <StorageTile id="db" icon="databaseOutline" title={tr('Database')} hint={tr('Small files kept inside the database. Used when nothing else is set up.')}
            files={t.database.files} bytes={t.database.bytes} share={share(t.database.bytes)} current={current === 'db'} available busy={false} />
        </Row>
      </Section>

      {confirm ? (
        <Notice tone="warn" testID="sa-media-confirm">
          {tr('Move every file of every store to {where}? Files are copied and checked first. The old copies are kept for 24 hours, then you can remove them.', { where: storageName(confirm) })}
          <Row style={{ marginTop: SA.space.sm }}>
            <Btn small testID="sa-media-move-go" label={tr('Move now')} onPress={() => switchStorage(confirm, true)} busy={busy === 'storage'} />
            <Btn small kind="ghost" label={tr('Cancel')} onPress={() => setConfirm(null)} />
          </Row>
        </Notice>
      ) : null}

      {m && m.status !== 'idle' ? (
        <View testID="sa-media-progress" style={{ padding: SA.space.lg, borderRadius: SA.radius.lg, backgroundColor: SA.color.panel2, marginBottom: SA.space.xl, gap: SA.space.sm }}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <T weight="bold" style={{ flexShrink: 1 }}>{tr('Move to {where}', { where: storageName(m.target) })}</T>
            <Badge label={running ? tr('Running') : m.status === 'done' ? tr('Finished') : tr('Stopped')} tone={running ? 'warn' : m.status === 'done' ? 'ok' : 'muted'} />
          </Row>
          <Share value={percent / 100} tone={m.status === 'done' ? 'ok' : 'accent'} height={8} />
          <T size="sm" color={SA.color.muted}>{tr('{done} of {total} files · {size}', { done: m.done || 0, total: m.total || 0, size: size(m.movedBytes) })}</T>
          {m.failed ? <T size="sm" color={SA.color.danger}>{tr('{n} files could not be moved. Start the move again to retry them.', { n: m.failed })}</T> : null}
          {running ? <Row><Btn small kind="danger" label={tr('Stop')} onPress={mover.cancel} /></Row> : null}
        </View>
      ) : null}

      {data.oldCopies.files ? (
        <View testID="sa-media-old" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SA.space.md, padding: SA.space.lg, borderRadius: SA.radius.lg, borderWidth: 1, borderColor: SA.color.line, backgroundColor: SA.color.panel, marginBottom: SA.space.xl }}>
          <IconBox name="archiveOutline" tone="warn" />
          <View style={{ flex: 1, flexBasis: 220, minWidth: 0 }}>
            <T weight="bold">{tr('Old copies left by a move')}</T>
            <T size="sm" color={SA.color.muted}>
              {data.oldCopies.cleanable
                ? tr('{n} files ({size}) can be removed. Each one is checked in its new place first.', { n: data.oldCopies.files, size: size(data.oldCopies.bytes) })
                : tr('{n} files ({size}) are kept for 24 hours as a safety net. Removable {when}.', { n: data.oldCopies.files, size: size(data.oldCopies.bytes), when: data.oldCopies.cleanableAt ? new Date(data.oldCopies.cleanableAt).toLocaleString() : '' })}
            </T>
          </View>
          <Btn small kind="ghost" testID="sa-media-cleanup" label={tr('Remove old copies')} onPress={cleanup} busy={busy === 'cleanup'} disabled={!data.oldCopies.cleanable} />
        </View>
      ) : null}

      <Section title={tr('Client stores')} right={data.oldCopies.oldestAt ? <T size="xs" color={SA.color.muted}>{tr('Last move {when}', { when: ago(data.oldCopies.oldestAt) })}</T> : undefined}>
        {stores.length ? (
          <View style={{ borderRadius: SA.radius.lg, borderWidth: 1, borderColor: SA.color.line, backgroundColor: SA.color.panel, overflow: 'hidden' }}>
            {shownStores.map((s, i) => (
              <View key={s.id} testID="sa-media-store" style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.md, paddingVertical: SA.space.md, paddingHorizontal: SA.space.lg, borderTopWidth: i ? 1 : 0, borderColor: SA.color.line }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T weight="bold" numberOfLines={1}>{s.name}</T>
                  <T size="xs" color={SA.color.muted} numberOfLines={1}>{`/${s.slug} · ${tr('{n} files', { n: s.files })}`}</T>
                </View>
                <View style={{ width: 72 }}><Share value={maxBytes ? s.bytes / maxBytes : 0} /></View>
                <T size="sm" weight="bold" style={{ width: 70, textAlign: 'right' }}>{size(s.bytes)}</T>
              </View>
            ))}
          </View>
        ) : <T size="sm" color={SA.color.muted}>{tr('No client stores yet.')}</T>}
        {stores.length > 6 ? <View style={{ marginTop: SA.space.sm }}><TextLink label={all ? tr('Show less') : tr('Show all {n}', { n: stores.length })} onPress={() => setAll(!all)} /></View> : null}
        <View style={{ marginTop: SA.space.sm }}>
          <Hint>{tr('Cloned or restored stores share the same files. A file is removed from storage only when the last store using it deletes it.')}</Hint>
        </View>
      </Section>

      <TextLink icon="folderOutline" label={tr('Tidy up the media folder')} onPress={goTidy} />
    </View>
  );
}

export default function MediaStorage() {
  const { data, error, loading, reload } = useLoad(() => sa<MediaOverview>('/media'));
  const params = useLocalSearchParams<{ tab?: string }>();
  const router = useRouter();
  const tab: Tab = params.tab === 'files' || params.tab === 'tidy' || params.tab === 'history' ? params.tab : 'storage';
  const setTab = (v: Tab) => router.setParams({ tab: v === 'storage' ? undefined : v });

  return (
    <View>
      <Heading title={tr('Media & storage')} hint={tr('Where the pictures and videos of every store live. A file is stored once and shared by every store that uses it.')} />
      <ErrorLine error={error} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'storage', label: tr('Storage'), testID: 'sa-media-tab-storage' },
        { value: 'files', label: tr('Files'), testID: 'sa-media-tab-files' },
        { value: 'tidy', label: tr('Tidy up'), testID: 'sa-media-tab-tidy' },
        { value: 'history', label: tr('History'), testID: 'sa-media-tab-history' },
      ]} />
      {loading && !data ? <Loading /> : data ? (
        tab === 'storage' ? <StorageTab data={data} reload={reload} goTidy={() => setTab('tidy')} />
          : tab === 'files' ? <MediaFiles storage={data.storage.current} onChanged={reload} goTidy={() => setTab('tidy')} />
            : tab === 'tidy' ? <MediaFolder oldCopies={data.oldCopies.files} onChanged={reload} />
              : <MediaHistory onChanged={reload} />
      ) : null}
    </View>
  );
}
