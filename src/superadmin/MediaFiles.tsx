import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { MediaFile, MediaFiles } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Hint, Loading, Notice, Row, Segmented, T, useLoad } from '@/superadmin/ui';

const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};
type Usage = 'all' | 'unused' | 'used';
const PAGE = 40;

/** Every stored file of the platform, once, with who owns it and whether anything still shows it. Delete whole files; used ones are protected. */
export function AllFiles({ onChanged }: { onChanged: () => void }) {
  const [usage, setUsage] = useState<Usage>('unused');
  const [kind, setKind] = useState<'' | 'image' | 'video' | 'audio'>('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'new' | 'old' | 'size'>('size');
  const [pages, setPages] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'picked' | 'unused' | null>(null);
  const query = `?usage=${usage}&sort=${sort}&limit=${PAGE * pages}${kind ? `&kind=${kind}` : ''}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`;
  const { data, error, loading, reload } = useLoad(() => sa<MediaFiles>(`/media/files${query}`), [query]);

  const toggle = (id: string) => setPicked(list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]));
  const remove = async (body: Record<string, unknown>) => {
    setBusy('delete'); setProblem(null); setNote('');
    try {
      let removed = 0, blocked = 0, bytes = 0;
      for (let round = 0; round < 60; round++) {
        const r = await sa<{ removed: string[]; blocked: unknown[]; bytes: number; remaining?: number }>('/media/files/delete', { method: 'POST', body });
        removed += r.removed.length; blocked += r.blocked.length; bytes += r.bytes;
        if (!body.allUnused || !r.remaining || !r.removed.length) break;
      }
      setNote(tr('Deleted {n} files ({size}). {kept} were kept because something still uses them.', { n: removed, size: size(bytes), kept: blocked }));
      setPicked([]); setConfirm(null); reload(); onChanged();
    } catch (e) { setProblem(saMessage(e)); } finally { setBusy(''); }
  };

  const items = data?.items || [];
  const sub = (f: MediaFile) => [
    f.kind === 'image' ? tr('Image') : f.kind === 'video' ? tr('Video') : tr('Audio'),
    f.storage === 'r2' ? tr('Cloudflare R2') : f.storage === 'fs' ? tr('App folder (self-hosted)') : f.storage === 'db' ? tr('Database') : tr('Mixed'),
    new Date(f.createdAt).toLocaleDateString(),
  ].join(' · ');
  const names = (list: MediaFile['owners']) => list.slice(0, 3).map(o => o.name).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');

  return (
    <View testID="sa-media-files">
      <T size="lg" weight="bold" style={{ marginBottom: 2 }}>{tr('All files')}</T>
      <T size="sm" color={SA.color.muted} style={{ marginBottom: SA.space.sm }}>{tr('Every file stored for every store, demo and theme, once. See who owns it and whether anything still shows it, then keep or delete.')}</T>
      <ErrorLine error={error || problem} />
      {note ? <Notice tone="ok">{note}</Notice> : null}
      {data ? (
        <Row style={{ marginBottom: SA.space.sm }}>
          <Badge label={tr('{n} files · {size}', { n: data.totals.files, size: size(data.totals.bytes) })} tone="muted" />
          <Badge label={tr('{n} not used by anyone · {size}', { n: data.totals.unused.files, size: size(data.totals.unused.bytes) })} tone={data.totals.unused.files ? 'warn' : 'ok'} />
        </Row>
      ) : null}
      <Segmented<Usage> testID="sa-media-usage" value={usage} onChange={v => { setUsage(v); setPages(1); setPicked([]); }}
        options={[{ value: 'unused', label: tr('Not used') }, { value: 'used', label: tr('Used') }, { value: 'all', label: tr('All') }]} />
      <View style={{ height: SA.space.sm }} />
      <Row>
        <Segmented<'' | 'image' | 'video' | 'audio'> value={kind} onChange={v => { setKind(v); setPages(1); }} options={[{ value: '', label: tr('Any type') }, { value: 'image', label: tr('Images') }, { value: 'video', label: tr('Videos') }, { value: 'audio', label: tr('Audio') }]} />
        <Segmented<'size' | 'new' | 'old'> value={sort} onChange={v => { setSort(v); setPages(1); }} options={[{ value: 'size', label: tr('Biggest') }, { value: 'new', label: tr('Newest') }, { value: 'old', label: tr('Oldest') }]} />
      </Row>
      <View style={{ height: SA.space.sm }} />
      <Field label={tr('Search by store, demo or title')} value={q} onChangeText={(v: string) => { setQ(v); setPages(1); }} />

      {picked.length || usage === 'unused' ? (
        <Row style={{ marginBottom: SA.space.sm }}>
          {picked.length ? <Btn small kind="danger" testID="sa-media-delete-picked" label={tr('Delete {n} selected', { n: picked.length })} onPress={() => setConfirm('picked')} disabled={busy !== ''} /> : null}
          {picked.length ? <Btn small kind="ghost" label={tr('Clear selection')} onPress={() => setPicked([])} /> : null}
          {usage === 'unused' && data?.totals.unused.files ? <Btn small kind="ghost" testID="sa-media-delete-unused" label={tr('Delete all unused')} onPress={() => setConfirm('unused')} disabled={busy !== ''} /> : null}
        </Row>
      ) : null}
      {confirm ? (
        <Notice tone="warn" testID="sa-media-files-confirm">
          {confirm === 'picked'
            ? tr('Delete {n} files from every store and from storage? This cannot be undone. Files that a store still shows are kept.', { n: picked.length })
            : tr('Delete every file nobody uses? Files from the last 24 hours, files kept in a store library, and anything in a client’s history are kept.')}
          <Row style={{ marginTop: SA.space.sm }}>
            <Btn small kind="danger" testID="sa-media-files-go" label={tr('Delete now')} busy={busy === 'delete'} onPress={() => remove(confirm === 'picked' ? { ids: picked } : { allUnused: true })} />
            <Btn small kind="ghost" label={tr('Cancel')} onPress={() => setConfirm(null)} />
          </Row>
        </Notice>
      ) : null}

      {loading && !data ? <Loading /> : !items.length ? <Empty>{usage === 'unused' ? tr('No unused files. Nothing to clean.') : tr('No files found.')}</Empty> : (
        <Card style={{ padding: 0 }}>
          {items.map((f, i) => {
            const on = picked.includes(f.id);
            return (
              <View key={f.id} testID="sa-media-file" style={{ padding: SA.space.md, borderTopWidth: i ? 1 : 0, borderColor: SA.color.line, backgroundColor: on ? SA.color.panel2 : 'transparent' }}>
                <Row style={{ flexWrap: 'nowrap' }}>
                  <View style={{ width: 52, height: 52, borderRadius: SA.radius.sm, backgroundColor: SA.color.panel2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                    {f.preview ? <Image source={{ uri: f.preview }} style={{ width: 52, height: 52 }} resizeMode="cover" /> : <T size="xs" color={SA.color.muted}>{f.kind === 'video' ? '▶' : f.kind === 'audio' ? '♪' : '▢'}</T>}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T weight="bold" numberOfLines={1}>{f.title || `${f.id.slice(0, 8)}…`}</T>
                    <T size="xs" color={SA.color.muted} numberOfLines={1}>{sub(f)}</T>
                    <T size="xs" color={SA.color.muted} numberOfLines={2}>{`${tr('Owner')}: ${names(f.owners)}`}</T>
                    <Row style={{ gap: 4, marginTop: 4 }}>
                      {f.used ? <Badge label={tr('Used by {names}', { names: names(f.usedBy) })} tone="ok" />
                        : f.inClientData ? <Badge label={tr('In clients’ history')} tone="accent" />
                          : <Badge label={tr('Not used')} tone="warn" />}
                      {f.legacy ? <Badge label={tr('Old layout')} tone="muted" /> : null}
                      {f.copies > 1 ? <Badge label={tr('{n} copies', { n: f.copies })} tone="danger" /> : null}
                    </Row>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <T weight="bold">{size(f.bytes)}</T>
                    <Btn small kind={on ? 'solid' : 'ghost'} testID="sa-media-pick" label={on ? tr('Selected') : tr('Select')} onPress={() => toggle(f.id)} />
                  </View>
                </Row>
              </View>
            );
          })}
        </Card>
      )}
      {data?.more ? <View style={{ marginTop: SA.space.sm }}><Btn kind="ghost" label={tr('Show more')} onPress={() => setPages(p => p + 1)} /></View> : null}
      <Hint>{tr('A file two stores share is one line: deleting it here removes it for both. To only remove it from one store, use that store’s own library.')}</Hint>
    </View>
  );
}
