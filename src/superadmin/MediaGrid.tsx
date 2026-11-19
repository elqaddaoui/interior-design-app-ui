import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { MediaBrowse, MediaItem } from '@/superadmin/types';
import { Badge, Btn, Empty, ErrorLine, Field, Loading, Notice, Row, Sheet, T } from '@/superadmin/ui';

const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};
const PAGE = 48;
const storageName = (s?: string) => (s === 'r2' ? tr('Cloudflare R2') : s === 'app' ? tr('App folder (self-hosted)') : tr('Database'));

/** The pictures of the storage in use as a plain grid (like a media library): read from the storage itself, newest page after page. Click one for its details. */
export function MediaGrid({ storage, onChanged }: { storage: string; onChanged: () => void }) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState('');
  const [active, setActive] = useState<string>(storage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async (after: string) => {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    try {
      const page = await sa<MediaBrowse>(`/media/browse?limit=${PAGE}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      if (mine !== seq.current) return;
      setItems(list => (after ? list.concat(page.items) : page.items)); setMore(page.more); setCursor(page.cursor); setActive(page.storage);
    } catch (e) { if (mine === seq.current) setError(saMessage(e)); } finally { if (mine === seq.current) setLoading(false); }
  }, []);
  useEffect(() => { load(''); }, [storage, load]);

  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter(i => `${i.name} ${i.title} ${i.stores.join(' ')} ${i.folder}`.toLowerCase().includes(needle)) : items;

  const remove = async (item: MediaItem) => {
    setBusy(true); setError(null);
    try {
      const r = await sa<{ removed: string[]; blocked: { id: string; reason: string }[] }>('/media/files/delete', { method: 'POST', body: { ids: [item.id] } });
      if (r.removed.length) { setItems(list => list.filter(i => i.id !== item.id)); setNote(tr('Deleted {name}.', { name: item.name })); onChanged(); }
      else setNote(tr('Kept: a store still uses this picture.'));
      setOpen(null); setConfirm(false);
    } catch (e) { setError(saMessage(e)); } finally { setBusy(false); }
  };

  return (
    <View testID="sa-media-grid">
      <Row style={{ justifyContent: 'space-between', marginBottom: SA.space.sm }}>
        <Badge tone="muted" label={tr('Showing the pictures of {storage}', { storage: storageName(active) })} />
        <View style={{ flexGrow: 1, flexBasis: 200, maxWidth: 320 }}><Field label={tr('Search loaded pictures')} value={q} onChangeText={(v: string) => setQ(v)} /></View>
      </Row>
      <ErrorLine error={error} />
      {note ? <Notice tone="ok">{note}</Notice> : null}
      {loading && !items.length ? <Loading /> : !shown.length ? <Empty>{items.length ? tr('No loaded picture matches.') : tr('No pictures here yet.')}</Empty> : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SA.space.sm }}>
          {shown.map(item => (
            <Pressable key={item.key} testID="sa-media-tile" accessibilityLabel={item.title || item.name} onPress={() => { setOpen(item); setConfirm(false); setNote(''); }}
              style={{ width: 128, height: 128, borderRadius: SA.radius.sm, overflow: 'hidden', backgroundColor: SA.color.panel2, borderWidth: 1, borderColor: item.stray ? SA.color.warn : SA.color.line }}>
              <Image source={{ uri: item.url }} style={{ width: 128, height: 128 }} resizeMode="cover" />
              {item.stray ? <View style={{ position: 'absolute', left: 4, bottom: 4 }}><Badge label={tr('Outside media/')} tone="warn" /></View> : null}
            </Pressable>
          ))}
        </View>
      )}
      {more ? <View style={{ marginTop: SA.space.md }}><Btn kind="ghost" testID="sa-media-more" label={tr('Load more')} onPress={() => load(cursor)} busy={loading} disabled={loading} /></View> : null}
      <T size="xs" color={SA.color.muted} style={{ marginTop: SA.space.sm }}>{tr('{n} pictures loaded', { n: items.length })}</T>

      {open ? (
        <Sheet title={open.title || open.name} onClose={() => { setOpen(null); setConfirm(false); }} testID="sa-media-detail">
          <View style={{ alignItems: 'center', backgroundColor: SA.color.panel2, borderRadius: SA.radius.sm, marginBottom: SA.space.md }}>
            <Image source={{ uri: open.url }} style={{ width: '100%', height: 280 }} resizeMode="contain" />
          </View>
          <Detail label={tr('File')} value={open.name} />
          <Detail label={tr('Folder')} value={open.folder} />
          <Detail label={tr('Size')} value={size(open.size)} />
          {open.modified ? <Detail label={tr('Added')} value={new Date(open.modified).toLocaleString()} /> : null}
          <Detail label={tr('Used by')} value={open.inDatabase ? open.stores.join(', ') + (open.storeCount > open.stores.length ? ` +${open.storeCount - open.stores.length}` : '') : tr('No store in the database')} />
          {open.stray ? <Notice tone="warn">{tr('This picture sits outside media/. Use One media folder above to move it.')}</Notice> : null}
          {open.inDatabase ? (
            confirm ? (
              <Notice tone="warn">
                {tr('Delete this picture from every store and from storage? This cannot be undone. A picture a store still shows is kept.')}
                <Row style={{ marginTop: SA.space.sm }}>
                  <Btn small kind="danger" testID="sa-media-delete-go" label={tr('Delete now')} onPress={() => remove(open)} busy={busy} />
                  <Btn small kind="ghost" label={tr('Cancel')} onPress={() => setConfirm(false)} />
                </Row>
              </Notice>
            ) : <Btn small kind="danger" testID="sa-media-delete" label={tr('Delete')} onPress={() => setConfirm(true)} />
          ) : null}
        </Sheet>
      ) : null}
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginBottom: SA.space.sm }}>
      <T size="xs" weight="bold" color={SA.color.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</T>
      <T selectable>{value}</T>
    </View>
  );
}
