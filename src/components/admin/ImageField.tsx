import React from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { pickPhoto } from '@/lib/photo';
import { importMediaUrl, isStoredMedia, mediaUploadsEnabled, uploadDataUrl } from '@/lib/media';
import { toast } from '@/store/useToast';
import { useLibraryEnabled } from '@/lib/mediaLibrary';
import { useMediaChooser } from '@/components/admin/media/MediaChooser';

/**
 * URL input + upload from gallery + preview. Used for every admin image.
 * With the backend, a picked image is uploaded at once and a pasted https link is copied into media storage when the
 * field loses focus, so the field always holds a stable /api/media URL (the server also does this on save, as a safety net).
 */
export function ImageField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = React.useState(false);
  const own = useLibraryEnabled();
  const chooser = useMediaChooser();
  /** Stores with their own library choose between "Media library" and "Upload new"; the others upload straight away. */
  const fromLibrary = async () => { const urls = await chooser.choose({ kind: 'image' }); if (urls?.[0]) onChange(urls[0]); };
  const up = async () => {
    const r = await pickPhoto('gallery', { preserveTransparency: true });
    if (!('uri' in r)) return;
    if (!mediaUploadsEnabled || !r.uri.startsWith('data:')) { onChange(r.uri); return; }
    setBusy(true);
    try { onChange(await uploadDataUrl(r.uri)); } catch { toast(t('admin.f.uploadFailed')); } finally { setBusy(false); }
  };
  const importLink = async () => {
    const url = value.trim();
    if (!mediaUploadsEnabled || !/^https:\/\//i.test(url) || isStoredMedia(url)) return;
    setBusy(true);
    try { onChange(await importMediaUrl(url)); } catch { toast(t('admin.f.importFailed')); } finally { setBusy(false); }
  };
  return (
    <View className="mb-3">
      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{label}</Txt>
      <View className="flex-row gap-3 items-start">
        <MediaView uri={value || undefined} className="rounded-xl" style={{ width: 72, height: 72 }} />
        <View className="flex-1">
          <Input value={value.startsWith('data:') ? '(uploaded image)' : value} editable={!value.startsWith('data:') && !busy} onChangeText={onChange} onBlur={importLink} placeholder="https://…" autoCapitalize="none" />
          <View className="flex-row flex-wrap gap-2 -mt-1">
            {own ? <Button testID="img-library" title={t('ml.choose')} icon="folder-multiple-image" variant="soft" size="sm" onPress={fromLibrary} loading={busy} /> : <Button title={t('admin.f.uploadImage')} icon="upload" variant="soft" size="sm" onPress={up} loading={busy} />}
            {value ? <Pressable onPress={() => onChange('')} className="h-9 px-3 justify-center"><Txt className="text-danger font-bold text-[13px]">{t('admin.brand.remove')}</Txt></Pressable> : null}
          </View>
        </View>
      </View>
    {chooser.node}
    </View>
  );
}
