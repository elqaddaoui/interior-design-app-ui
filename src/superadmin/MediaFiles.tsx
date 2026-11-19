import React, { useCallback, useRef, useState } from 'react';
import { Image, Platform, Pressable, View } from 'react-native';
import { sa, saMessage } from '@/superadmin/api';
import { SA } from '@/superadmin/tokens';
import { tr } from '@/superadmin/i18n';
import type { MediaFiles as Page, MediaItem, MediaOwner, MediaOwners, MediaSummary, MediaType, MediaTypeFilter } from '@/superadmin/types';
import { Badge, Btn, Card, Empty, ErrorLine, Field, Loading, Notice, Row, Sheet, T } from '@/superadmin/ui';

const size = (bytes: number | null | undefined) => {
  const n = Number(bytes || 0);
  return n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`;
};
const PAGE = 50;
const TYPES: MediaTypeFilter[] = ['all', 'image', 'video', 'audio', 'other'];
const typeLabel = (t: MediaTypeFilter) => (t === 'image' ? tr('Images') : t === 'video' ? tr('Videos') : t === 'audio' ? tr('Audio') : t === 'other' ? tr('Other files') : tr('All types'));
const storageName = (s?: string) => (s === 'r2' ? tr('Cloudflare R2') : s === 'app' ? tr('App folder (self-hosted)') : tr('Database'));
type Mode = '' | 'type' | 'owner';
type Group = 'store' | 'demo' | 'theme' | 'other';
const GROUPS: Group[] = ['store', 'demo', 'theme', 'other'];
const groupLabel = (g: Group) => (g === 'store' ? tr('Stores') : g === 'demo' ? tr('Demos') : g === 'theme' ? tr('Themes') : tr('Other'));

/** A tappable option block (the two ways to look at the hosted files). */
function Option({ id, title, hint, on, onPress }: { id: string; title: string; hint: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable testID={id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      style={{ flexGrow: 1, flexBasis: 260, padding: SA.space.md, borderRadius: SA.radius.md, borderWidth: 2, borderColor: on ? SA.color.accent : SA.color.line, backgroundColor: on ? SA.color.accentSoft : SA.color.panel }}>
      <T weight="bold" color={on ? SA.color.accent : SA.color.text}>{title}</T>
      <T size="sm" color={SA.color.muted}>{hint}</T>
    </Pressable>
  );
}
function Chip({ label, on, onPress, testID, count }: { label: string; on: boolean; onPress: () => void; testID?: string; count?: number }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: SA.radius.sm, borderWidth: 1, borderColor: on ? SA.color.accent : SA.color.line, backgroundColor: on ? SA.color.accentSoft : SA.color.panel }}>
      <T size="sm" weight={on ? 'bold' : 'medium'} color={on ? SA.color.accent : SA.color.text}>{count == null ? label : `${label} · ${count}`}</T>
    </Pressable>
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

/** Plays or shows one file. Only mounted after the owner asks for it: nothing is downloaded before that. */
function Preview({ item }: { item: MediaItem }) {
  if (item.type === 'image') return <Image source={{ uri: item.url }} style={{ width: '100%', height: 280 }} resizeMode="contain" />;
  if (Platform.OS === 'web' && (item.type === 'video' || item.type === 'audio')) {
    return React.createElement(item.type, { src: item.url, controls: true, preload: 'metadata', style: { width: '100%', maxHeight: 320 } });
  }
  return <T size="sm" color={SA.color.muted}>{tr('This kind of file has no preview here.')}</T>;
}

/**
 * The Files manager. Nothing is loaded when the page opens: no picture, no list, no count. The owner first picks HOW to look:
 *   - all the media by type: everything hosted in the storage in use, whatever its folder (media/, old folders, files put there by hand), as images / videos / audio / other.
 *   - by store, demo, theme or other: the files one of them holds.
 * Files are listed as plain rows (name, folder, size); a preview is loaded only for the one file the owner opens and asks to see.
 */
export function MediaFiles({ storage, onChanged }: { storage: string; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>('');
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [group, setGroup] = useState<Group>('store');
  const [owner, setOwner] = useState<MediaOwner | null>(null);
  const [summary, setSummary] = useState<MediaSummary | null>(null);
  const [owners, setOwners] = useState<MediaOwners | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [more, setMore] = useState(false);
  const [cursor, setCursor] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const seq = useRef(0);

  const guard = useCallback(async (key: string, job: () => Promise<void>) => {
    setBusy(key); setError(null);
    try { await job(); } catch (e) { setError(saMessage(e)); } finally { setBusy(''); }
  }, []);

  const list = useCallback((view: Mode, t: MediaTypeFilter, who: MediaOwner | null, after: string) => guard('list', async () => {
    const mine = ++seq.current;
    const query = `view=${view}&type=${t}&limit=${PAGE}${view === 'owner' && who ? `&owner=${encodeURIComponent(who.id)}` : ''}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const page = await sa<Page>(`/media/files?${query}`);
    if (mine !== seq.current) return;
    setItems(prev => (after ? prev.concat(page.items) : page.items)); setMore(page.more); setCursor(page.cursor); setLoaded(true);
  }), [guard]);

  const reset = () => { seq.current++; setItems([]); setMore(false); setCursor(''); setLoaded(false); setQ(''); setOpen(null); setNote(''); };
  const pickMode = (next: Mode) => {
    reset(); setMode(next); setOwner(null); setType('all'); setError(null);
    if (next === 'type' && !summary) guard('summary', async () => setSummary(await sa<MediaSummary>('/media/summary')));
    if (next === 'owner' && !owners) guard('owners', async () => setOwners(await sa<MediaOwners>('/media/owners')));
  };
  const pickType = (t: MediaTypeFilter) => { reset(); setType(t); if (mode === 'type' || owner) list(mode, t, owner, ''); };
  const pickOwner = (o: MediaOwner) => { reset(); setOwner(o); list('owner', type, o, ''); };
  const recount = () => guard('summary', async () => setSummary(await sa<MediaSummary>('/media/summary')));

  const remove = (item: MediaItem) => guard('delete', async () => {
    const r = await sa<{ removed: string[]; blocked: { id: string; reason: string }[] }>('/media/files/delete', { method: 'POST', body: { ids: [item.id] } });
    if (r.removed.length) { setItems(prev => prev.filter(i => i.id !== item.id)); setNote(tr('Deleted {name}.', { name: item.name })); onChanged(); }
    else setNote(tr('Kept: a store still uses this picture.'));
    setOpen(null); setConfirm(false);
  });

  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter(i => `${i.name} ${i.title} ${i.stores.join(' ')} ${i.folder}`.toLowerCase().includes(needle)) : items;
  const count = (t: MediaTypeFilter): number | undefined => {
    if (mode === 'type' && summary) return t === 'all' ? Object.values(summary.types).reduce((n, v) => n + v.files, 0) : summary.types[t as MediaType].files;
    if (mode === 'owner' && owners) return t === 'all' ? Object.values(owners.types).reduce((n, v) => n + v, 0) : owners.types[t as MediaType];
    return undefined;
  };
  const showList = mode === 'type' || (mode === 'owner' && owner);

  return (
    <View testID="sa-media-files">
      <Row style={{ alignItems: 'stretch', marginBottom: SA.space.md }}>
        <Option id="sa-files-by-type" title={tr('All media by type')} hint={tr('Every file hosted in {storage}, in any folder: images, videos, audio and other files.', { storage: storageName(storage) })} on={mode === 'type'} onPress={() => pickMode('type')} />
        <Option id="sa-files-by-owner" title={tr('By store, demo, theme or other')} hint={tr('The files one store, demo, theme or other owner holds.')} on={mode === 'owner'} onPress={() => pickMode('owner')} />
      </Row>
      {!mode ? <Notice>{tr('Nothing is loaded until you choose how to look at the files. Pictures are shown only when you open a file and ask for its preview.')}</Notice> : null}
      <ErrorLine error={error} />
      {note ? <Notice tone="ok">{note}</Notice> : null}
      {busy === 'summary' || busy === 'owners' ? <Loading /> : null}

      {mode === 'owner' && owners ? (
        <Card>
          <Row style={{ marginBottom: SA.space.sm }}>
            {GROUPS.map(g => <Chip key={g} testID={`sa-files-group-${g}`} label={groupLabel(g)} count={owners.groups[g].reduce((n, o) => n + o.files, 0)} on={group === g} onPress={() => { setGroup(g); setOwner(null); reset(); }} />)}
          </Row>
          {owners.groups[group].length ? (
            <Row>
              {owners.groups[group].map(o => (
                <Chip key={o.id} testID="sa-files-owner" label={o.name || tr('Other')} count={o.files} on={owner?.id === o.id} onPress={() => pickOwner(o)} />
              ))}
            </Row>
          ) : <T size="sm" color={SA.color.muted}>{tr('Nothing here holds files yet.')}</T>}
        </Card>
      ) : null}

      {mode === 'type' && summary ? (
        <Card>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
            <View style={{ flexShrink: 1 }}>
              <T size="sm" color={SA.color.muted}>{tr('{n} files found in {storage}.', { n: summary.scanned, storage: storageName(summary.storage) })}</T>
              {!summary.complete ? <T size="xs" color={SA.color.warn}>{tr('The count stopped early: the storage holds a very large number of files.')}</T> : null}
              {Object.values(summary.types).some(v => v.outside > 0) ? <T size="xs" color={SA.color.muted}>{tr('{n} of them are outside media/ (kept as they are: only the app\'s own pictures are moved by One media folder).', { n: Object.values(summary.types).reduce((n, v) => n + v.outside, 0) })}</T> : null}
            </View>
            <Btn small kind="ghost" label={tr('Count again')} onPress={recount} busy={busy === 'summary'} disabled={busy !== ''} />
          </Row>
        </Card>
      ) : null}

      {showList ? (
        <View>
          <Row style={{ marginVertical: SA.space.sm }}>
            {TYPES.map(t => <Chip key={t} testID={`sa-files-type-${t}`} label={typeLabel(t)} count={count(t)} on={type === t} onPress={() => pickType(t)} />)}
          </Row>
          {mode === 'owner' && !owner ? <Empty>{tr('Choose a store, demo, theme or other owner above.')}</Empty> : (
            <View>
              {!loaded && busy === 'list' ? <Loading /> : null}
              {loaded && !items.length ? <Empty>{tr('No files of this kind.')}</Empty> : null}
              {!loaded && !busy ? <Btn testID="sa-files-load" label={tr('Show the list')} onPress={() => list(mode, type, owner, '')} /> : null}
              {items.length ? (
                <View>
                  <View style={{ maxWidth: 320 }}><Field label={tr('Search loaded files')} value={q} onChangeText={(v: string) => setQ(v)} /></View>
                  <Card style={{ padding: 0 }}>
                    {shown.map((item, i) => (
                      <Pressable key={`${item.storage}|${item.key}|${i}`} testID="sa-files-row" onPress={() => { setOpen(item); setShowPreview(false); setConfirm(false); setNote(''); }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, padding: SA.space.sm, borderTopWidth: i ? 1 : 0, borderColor: SA.color.line }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <T numberOfLines={1}>{item.title || item.name}</T>
                          <T size="xs" color={SA.color.muted} numberOfLines={1}>{item.folder}</T>
                        </View>
                        {!item.inMedia ? <Badge label={item.stray ? tr('Old folder') : tr('Outside media/')} tone="warn" /> : null}
                        <Badge label={typeLabel(item.type)} tone="muted" />
                        <T size="xs" color={SA.color.muted} style={{ width: 64, textAlign: 'right' }}>{size(item.size)}</T>
                      </Pressable>
                    ))}
                  </Card>
                  {more ? <View style={{ marginTop: SA.space.md }}><Btn kind="ghost" testID="sa-files-more" label={tr('Load more')} onPress={() => list(mode, type, owner, cursor)} busy={busy === 'list'} disabled={busy !== ''} /></View> : null}
                  <T size="xs" color={SA.color.muted} style={{ marginTop: SA.space.sm }}>{tr('{n} files loaded', { n: items.length })}</T>
                </View>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {open ? (
        <Sheet title={open.title || open.name} onClose={() => { setOpen(null); setConfirm(false); }} testID="sa-media-detail">
          {showPreview ? (
            <View style={{ alignItems: 'center', backgroundColor: SA.color.panel2, borderRadius: SA.radius.sm, marginBottom: SA.space.md }}><Preview item={open} /></View>
          ) : (
            <View style={{ marginBottom: SA.space.md }}><Btn small kind="ghost" testID="sa-files-preview" label={tr('Show preview')} onPress={() => setShowPreview(true)} /></View>
          )}
          <Detail label={tr('File')} value={open.name} />
          <Detail label={tr('Folder')} value={open.folder} />
          <Detail label={tr('Kind')} value={typeLabel(open.type)} />
          <Detail label={tr('Size')} value={size(open.size)} />
          <Detail label={tr('Stored in')} value={storageName(open.storage)} />
          {open.modified ? <Detail label={tr('Added')} value={new Date(open.modified).toLocaleString()} /> : null}
          <Detail label={tr('Used by')} value={open.inDatabase ? open.stores.join(', ') + (open.storeCount > open.stores.length ? ` +${open.storeCount - open.stores.length}` : '') : tr('No store in the database')} />
          {open.stray ? <Notice tone="warn">{tr('This picture sits outside media/. Use One media folder above to move it.')}</Notice> : null}
          {!open.inMedia && !open.stray ? <Notice>{tr('This file is not one of the app\'s own pictures. It is shown so you can see everything hosted; the app never moves or deletes it.')}</Notice> : null}
          {open.inDatabase && open.id ? (
            confirm ? (
              <Notice tone="warn">
                {tr('Delete this picture from every store and from storage? This cannot be undone. A picture a store still shows is kept.')}
                <Row style={{ marginTop: SA.space.sm }}>
                  <Btn small kind="danger" testID="sa-media-delete-go" label={tr('Delete now')} onPress={() => remove(open)} busy={busy === 'delete'} />
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
