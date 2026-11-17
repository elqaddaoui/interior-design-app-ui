import React, { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { ConfirmSheet, Sheet } from '@/components/ui/Sheet';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { MediaGrid } from '@/components/admin/media/MediaGrid';
import { MediaPreview } from '@/components/admin/media/MediaPreview';
import { useT } from '@/i18n';
import { formatBytes } from '@/lib/backupClient';
import { getLibraryItem, removeLibraryItems, updateLibraryItem, uploadErrorKey, uploadFromDevice, type LibItem, type LibKind, type LibUse } from '@/lib/mediaLibrary';
import { useLibrary } from '@/lib/useLibrary';
import { useMediaPrefs } from '@/store/useMediaPrefs';
import { toast } from '@/store/useToast';

/** Admin > Media: every picture and video of this store, in one grid (WordPress-style). */
export default function MediaAdmin() {
  return <MediaScreen />;
}

function MediaScreen() {
  const { t } = useT();
  const { autoplay, setAutoplay, load: loadPrefs } = useMediaPrefs();
  useEffect(() => { void loadPrefs(); }, [loadPrefs]);
  const [kind, setKind] = useState<LibKind>('');
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<LibItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const lib = useLibrary({ kind, q });

  const add = async () => {
    if (busy) return;
    setBusy(t('ml.uploading', { done: 1, total: 1 }));
    const r = await uploadFromDevice({ kind, multiple: true, onProgress: (done, total) => setBusy(t('ml.uploading', { done: Math.min(done + 1, total), total })) });
    setBusy(null);
    if (r.error) toast(t(uploadErrorKey(r.error)));
    else if (r.failed) toast(t('ml.uploadPartial', { failed: r.failed }));
    if (r.urls.length) { if (!r.failed && !r.error) toast(t('ml.uploaded', { n: r.urls.length })); lib.reload(); }
  };
  const toggle = (m: LibItem) => {
    if (!selecting) { setOpen(m); return; }
    setPicked((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; });
  };
  const stopSelecting = () => { setSelecting(false); setPicked(new Set()); };
  const removeSelected = async () => {
    setBusy('delete');
    try {
      const r = await removeLibraryItems([...picked]);
      if (r.removed.length) toast(t('ml.deleted', { n: r.removed.length }));
      const used = r.blocked.filter((b) => b.reason === 'IN_USE').length;
      if (used) toast(t('ml.keptInUse', { n: used }));
      if (r.blocked.some((b) => !['IN_USE', 'NOT_FOUND'].includes(b.reason))) toast(t('ml.deleteFailed'));
      stopSelecting(); lib.reload();
    } catch { toast(t('ml.deleteFailed')); } finally { setBusy(null); }
  };
  const uploading = !!busy && busy !== 'delete';
  const right = <Button testID="ml-add" size="sm" icon="upload" title={uploading ? busy! : t('ml.upload')} onPress={add} loading={uploading} />;
  const files = lib.items.filter((m) => !m.linked);
  const bytes = files.reduce((n, m) => n + (m.size || 0), 0);
  return (
    <AdminPage title={t('admin.nav.media')} max={1100} right={right}>
      <View className="flex-row flex-wrap items-center mb-4" style={{ gap: 10 }}>
        <Segmented testID="ml-kind" value={kind || 'all'} onChange={(v) => setKind(v === 'all' ? '' : (v as LibKind))} options={[{ key: 'all', label: t('ml.all') }, { key: 'image', label: t('ml.images') }, { key: 'video', label: t('ml.videos') }]} />
        <View style={{ flexGrow: 1, flexBasis: 180, maxWidth: 320 }}><Input testID="ml-search" value={q} onChangeText={setQ} placeholder={t('ml.search')} autoCapitalize="none" tight /></View>
        <View className="flex-row items-center" style={{ gap: 6, marginStart: 'auto' }}>
          <Chip testID="ml-autoplay" icon={autoplay ? 'pause-circle-outline' : 'play-circle-outline'} label={autoplay ? t('ml.autoplayOn') : t('ml.autoplayOff')} on={autoplay} onPress={() => setAutoplay(!autoplay)} />
          <Chip testID="ml-select" icon="checkbox-multiple-marked-outline" label={selecting ? t('ml.done') : t('ml.select')} on={selecting} onPress={() => (selecting ? stopSelecting() : setSelecting(true))} />
        </View>
      </View>
      {lib.total ? <Txt testID="ml-count" className="text-muted text-[12px] mb-3">{t('ml.count', { n: lib.total })}{bytes ? ` · ${formatBytes(bytes)}` : ''}</Txt> : null}
      {selecting ? (
        <View testID="ml-bulk" className="flex-row items-center justify-between rounded-xl bg-surface2 px-3 py-2 mb-3" style={{ gap: 10 }}>
          <Txt className="font-bold text-[13px]">{t('ml.selected', { n: picked.size })}</Txt>
          <Button testID="ml-bulk-delete" size="sm" variant="danger" icon="delete-outline" title={t('ml.deleteSel')} disabled={!picked.size} loading={busy === 'delete'} onPress={() => setConfirm(true)} />
        </View>
      ) : null}
      {lib.error ? (
        <View className="items-center py-10" style={{ gap: 10 }}><Txt className="text-muted">{t('ml.loadFailed')}</Txt><Button size="sm" variant="soft" title={t('ml.retry')} onPress={lib.reload} /></View>
      ) : lib.loading && !lib.items.length ? (
        <AdminLoading />
      ) : !lib.items.length ? (
        <View testID="ml-empty" className="items-center py-12 px-4"><Txt className="text-muted text-center">{q || kind ? t('ml.emptySearch') : t('ml.empty')}</Txt></View>
      ) : (
        <>
          <MediaGrid items={lib.items} selected={selecting ? picked : undefined} onOpen={toggle} autoplay={autoplay} minTile={Platform.OS === 'web' ? 156 : 104} />
          {lib.more ? <View className="items-center mt-4"><Button testID="ml-more" size="sm" variant="soft" title={t('ml.more')} onPress={lib.loadMore} loading={lib.loading} /></View> : null}
        </>
      )}
      <ConfirmSheet visible={confirm} onClose={() => setConfirm(false)} onConfirm={removeSelected} message={t('ml.confirmDelete', { n: picked.size })} confirmLabel={t('ml.deleteSel')} cancelLabel={t('ml.cancel')} />
      {open ? <Details item={open} autoplay={autoplay} onClose={() => setOpen(null)} onChanged={lib.reload} /> : null}
    </AdminPage>
  );
}

/** Small pill button used in the toolbar: an icon and a short label; filled when on. */
function Chip({ icon, label, on, onPress, testID }: { icon: string; label: string; on: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress}
      className={`h-9 px-3 rounded-full flex-row items-center active:opacity-80 ${on ? 'bg-ink' : 'bg-surface2'}`} style={{ gap: 6 }}>
      <Icon name={icon} size={17} tone={on ? 'onink' : 'fg'} />
      <Txt className={`text-[12.5px] font-bold ${on ? 'text-onink' : ''}`} numberOfLines={1}>{label}</Txt>
    </Pressable>
  );
}

/** One file: preview, title, alternative text, address, where it is used, delete. External (linked) files are shown read-only. */
function Details({ item, autoplay, onClose, onChanged }: { item: LibItem; autoplay: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useT();
  const [title, setTitle] = useState(item.title);
  const [alt, setAlt] = useState(item.alt);
  const [uses, setUses] = useState<LibUse[] | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [ask, setAsk] = useState<'one' | 'force' | null>(null);
  React.useEffect(() => {
    let live = true;
    const load = item.linked ? Promise.resolve({ usedIn: [] as LibUse[] }) : getLibraryItem(item.id);
    load.then((r) => { if (live) setUses(r.usedIn); }, () => { if (live) setUses([]); });
    return () => { live = false; };
  }, [item.id, item.linked]);
  const dirty = title !== item.title || alt !== item.alt;
  const save = async () => {
    setBusy('save');
    try { await updateLibraryItem(item.id, { title, alt }); toast(t('ml.saved')); onChanged(); onClose(); } catch { toast(t('ml.saveFailed')); } finally { setBusy(null); }
  };
  const remove = async (force: boolean) => {
    setBusy('delete');
    try {
      const r = await removeLibraryItems([item.id], force);
      const why = r.blocked[0]?.reason;
      if (!why) { toast(t('ml.deleted', { n: 1 })); onChanged(); onClose(); }
      else if (why === 'IN_USE') setAsk('force');
      else toast(t('ml.deleteFailed'));
    } catch { toast(t('ml.deleteFailed')); } finally { setBusy(null); }
  };
  const copy = async () => {
    const full = Platform.OS === 'web' && typeof window !== 'undefined' ? new URL(item.url, window.location.origin).toString() : item.url;
    try { await (globalThis as any).navigator?.clipboard?.writeText(full); toast(t('ml.copied')); } catch { /* the address stays selectable */ }
  };
  const usedLabel = (u: LibUse) => (u.type === 'item' ? t('ml.usedItem', { name: u.coll }) : u.type === 'doc' ? t('ml.usedDoc', { name: u.name }) : t('ml.usedAvatar'));
  const row = (label: string, value: string) => (
    <View className="flex-row justify-between py-1" style={{ gap: 12 }}><Txt className="text-muted text-[12px]">{label}</Txt><Txt className="text-[12px] font-semibold flex-shrink" numberOfLines={1}>{value}</Txt></View>
  );
  return (
    <Sheet visible onClose={onClose} title={t('ml.details')} wide
      footer={item.linked ? undefined : (
        <View className="flex-row gap-2.5">
          <Button testID="ml-delete" variant="outline" icon="delete-outline" title={t('ml.delete')} loading={busy === 'delete'} onPress={() => setAsk('one')} />
          <View className="flex-1"><Button full testID="ml-save" title={t('ml.save')} disabled={!dirty} loading={busy === 'save'} onPress={save} /></View>
        </View>
      )}>
      <View testID="ml-details">
        <View className="rounded-2xl overflow-hidden bg-surface2 mb-3" style={{ width: '100%', height: 240 }}><MediaPreview item={item} autoplay={autoplay} controls={item.kind === 'video'} fit="contain" /></View>
        {item.linked ? <Txt testID="ml-linked" className="text-muted text-[12px] mb-2">{t('ml.linkedNote')}</Txt> : (
          <>
            <Input label={t('ml.titleField')} value={title} onChangeText={setTitle} maxLength={200} />
            <Input label={t('ml.altField')} value={alt} onChangeText={setAlt} maxLength={300} />
          </>
        )}
        {item.linked ? null : row(t('ml.type'), item.mime)}
        {item.size != null ? row(t('ml.size'), formatBytes(item.size)) : null}
        {item.linked ? null : row(t('ml.added'), new Date(item.createdAt).toLocaleString())}
        <View className="flex-row items-center mt-2 mb-3" style={{ gap: 8 }}>
          <View className="flex-1"><Txt className="text-muted text-[11px]" selectable numberOfLines={2}>{item.url}</Txt></View>
          <Button testID="ml-copy" size="sm" variant="soft" icon="content-copy" title={t('ml.copyUrl')} onPress={copy} />
        </View>
        <Txt className="text-[13px] font-bold mb-1">{t('ml.usedIn')}</Txt>
        {uses === null ? <Spinner size={20} /> : uses.length ? uses.map((u, i) => <Txt key={i} className="text-muted text-[12px]">• {usedLabel(u)}</Txt>) : <Txt className="text-muted text-[12px]">{t('ml.unused')}</Txt>}
      </View>
      <ConfirmSheet visible={ask !== null} onClose={() => setAsk(null)} onConfirm={() => remove(ask === 'force')} message={ask === 'force' ? t('ml.confirmForce') : t('ml.confirmOne')} confirmLabel={ask === 'force' ? t('ml.forceDelete') : t('ml.delete')} cancelLabel={t('ml.cancel')} />
    </Sheet>
  );
}
