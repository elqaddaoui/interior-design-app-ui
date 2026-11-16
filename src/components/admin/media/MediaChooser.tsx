import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { uploadErrorKey, uploadFromDevice, type LibItem, type LibKind } from '@/lib/mediaLibrary';
import { useLibrary } from '@/lib/useLibrary';
import { toast } from '@/store/useToast';
import { MediaGrid } from './MediaGrid';

type Tab = 'library' | 'upload';
type Request = { kind: LibKind; multiple: boolean; resolve: (urls: string[] | null) => void };

/**
 * WordPress-style chooser: "Media library" (this store's own files) or "Upload new" (from the device, added to the library).
 * Resolves the chosen /api/media URLs. Rendered by the picker itself (see useMediaChooser), so it opens above any modal the picker lives in.
 */
function ChooserSheet({ kind, multiple, onDone }: { kind: LibKind; multiple: boolean; onDone: (urls: string[] | null) => void }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('library');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<LibItem[]>([]);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const lib = useLibrary({ kind, q });
  const ids = new Set(picked.map((m) => m.id));
  const toggle = (m: LibItem) => setPicked((list) => (list.some((x) => x.id === m.id) ? list.filter((x) => x.id !== m.id) : multiple ? [...list, m] : [m]));
  const upload = async () => {
    if (busy) return;
    setBusy({ done: 0, total: 1 });
    const r = await uploadFromDevice({ kind, multiple, onProgress: (done, total) => setBusy({ done, total }) });
    setBusy(null);
    if (r.error) toast(t(uploadErrorKey(r.error)));
    else if (r.failed) toast(t('ml.uploadPartial', { failed: r.failed }));
    if (r.urls.length) onDone(r.urls);
  };
  const title = kind === 'video' ? t('ml.chooseVideo') : kind === 'image' ? t('ml.chooseImage') : t('ml.chooseTitle');
  return (
    <Sheet visible onClose={() => onDone(null)} title={title} wide history={false}
      footer={tab === 'library' ? (
        <View className="flex-row gap-2.5">
          <Button full variant="soft" title={t('ml.cancel')} onPress={() => onDone(null)} />
          <Button full testID="ml-use" title={picked.length > 1 ? t('ml.useN', { n: picked.length }) : t('ml.use')} disabled={!picked.length} onPress={() => onDone(picked.map((m) => m.url))} />
        </View>
      ) : undefined}>
      <View testID="ml-chooser" className="mb-3"><Segmented testID="ml-tabs" value={tab} onChange={setTab} options={[{ key: 'library', label: t('ml.tabLibrary') }, { key: 'upload', label: t('ml.tabUpload') }]} /></View>
      {tab === 'upload' ? (
        <View className="items-center py-8 px-4" style={{ gap: 12 }}>
          <Icon name="cloud-upload-outline" size={44} tone="muted" />
          <Txt className="text-muted text-[13px] text-center">{t('ml.uploadHint')}</Txt>
          <Button testID="ml-upload-new" icon="upload" title={busy ? t('ml.uploading', { done: Math.min(busy.done + 1, busy.total), total: busy.total }) : t('ml.uploadNew')} onPress={upload} loading={!!busy} />
        </View>
      ) : (
        <View>
          <Input testID="ml-search" value={q} onChangeText={setQ} placeholder={t('ml.search')} autoCapitalize="none" />
          {lib.error ? (
            <View className="items-center py-6" style={{ gap: 10 }}><Txt className="text-muted">{t('ml.loadFailed')}</Txt><Button size="sm" variant="soft" title={t('ml.retry')} onPress={lib.reload} /></View>
          ) : lib.loading && !lib.items.length ? (
            <View className="items-center py-8"><Spinner size={32} /></View>
          ) : !lib.items.length ? (
            <View className="items-center py-8 px-4" style={{ gap: 10 }}>
              <Txt className="text-muted text-center">{q ? t('ml.emptySearch') : t('ml.empty')}</Txt>
              {!q ? <Pressable testID="ml-go-upload" onPress={() => setTab('upload')} className="h-9 px-4 rounded-full bg-surface2 items-center justify-center"><Txt className="font-bold text-[13px]">{t('ml.uploadNew')}</Txt></Pressable> : null}
            </View>
          ) : (
            <>
              <MediaGrid items={lib.items} selected={ids} onOpen={toggle} />
              {lib.more ? <View className="items-center mt-3"><Button size="sm" variant="soft" title={t('ml.more')} onPress={lib.loadMore} loading={lib.loading} /></View> : null}
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}

/**
 * `choose()` opens the chooser and resolves the picked URLs (null when cancelled); render `node` next to the button that calls it.
 * Call it when the backend is on (useLibraryEnabled); otherwise keep the plain upload button.
 */
export function useMediaChooser() {
  const [request, setRequest] = useState<Request | null>(null);
  const choose = useCallback((o: { kind?: LibKind; multiple?: boolean } = {}) => new Promise<string[] | null>((resolve) => {
    setRequest((old) => { old?.resolve(null); return { kind: o.kind ?? '', multiple: !!o.multiple, resolve }; });
  }), []);
  const node = request ? <ChooserSheet key="chooser" kind={request.kind} multiple={request.multiple} onDone={(urls) => { request.resolve(urls); setRequest(null); }} /> : null;
  return { choose, node };
}
