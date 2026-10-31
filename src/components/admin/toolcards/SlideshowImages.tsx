import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { toCardWebp } from '@/lib/cardImage';
import { mediaUploadsEnabled, uploadDataUrl } from '@/lib/media';
import { pickPhoto } from '@/lib/photo';
import { toast } from '@/store/useToast';

/** Gallery picker -> compressed WebP (max ~600px) -> media storage (R2 / database). Resolves '' when cancelled or failed. */
async function pickCardImage(failed: string): Promise<string> {
  const r = await pickPhoto('gallery');
  if (!('uri' in r)) return '';
  const webp = await toCardWebp(r.uri);
  if (!mediaUploadsEnabled || !webp.startsWith('data:')) return webp;
  try { return await uploadDataUrl(webp); } catch { toast(failed); return ''; }
}

/**
 * The ordered pictures of a slideshow. Order matters: the first is BEFORE, the second AFTER; with 3+ pictures each one is revealed over the previous.
 * Add (one per tap), move left / right, remove.
 */
export function SlideshowImages({ images, onChange }: { images: string[]; onChange: (next: string[]) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { const uri = await pickCardImage(t('admin.f.uploadFailed')); if (uri) onChange([...images, uri]); } finally { setBusy(false); }
  };
  const move = (i: number, to: number) => {
    const next = [...images];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };
  const hint = images.length === 0 ? t('tc.hint0') : images.length === 1 ? t('tc.hint1') : images.length === 2 ? t('tc.hint2') : t('tc.hint3');
  return (
    <View className="gap-2">
      <Txt className="text-muted text-[12px]">{hint}</Txt>
      <View className="flex-row flex-wrap gap-2">
        {images.map((uri, i) => (
          <View key={`${i}-${uri}`} testID={`slide-${i}`} className="rounded-xl border border-line p-1.5 gap-1" style={{ width: 104 }}>
            <MediaView uri={uri} className="rounded-lg" style={{ width: '100%', height: 72 }} />
            <View className="flex-row items-center justify-between">
              <Txt className="text-muted text-[12px] font-bold">{i + 1}</Txt>
              <View className="flex-row items-center gap-1">
                {i > 0 ? <Pressable testID={`slide-left-${i}`} accessibilityRole="button" accessibilityLabel={t('tc.moveStart')} hitSlop={6} onPress={() => move(i, i - 1)}><Icon name="chevron-left" size={20} flip /></Pressable> : null}
                {i < images.length - 1 ? <Pressable testID={`slide-right-${i}`} accessibilityRole="button" accessibilityLabel={t('tc.moveEnd')} hitSlop={6} onPress={() => move(i, i + 1)}><Icon name="chevron-right" size={20} flip /></Pressable> : null}
                <Pressable testID={`slide-remove-${i}`} accessibilityRole="button" accessibilityLabel={t('common.delete')} hitSlop={6} onPress={() => onChange(images.filter((_, j) => j !== i))}><Icon name="trash-can-outline" size={18} tone="danger" /></Pressable>
              </View>
            </View>
          </View>
        ))}
      </View>
      <View className="flex-row"><Button testID="slide-add" size="sm" variant="soft" icon="plus" title={t('tc.addImages')} onPress={add} loading={busy} /></View>
    </View>
  );
}
