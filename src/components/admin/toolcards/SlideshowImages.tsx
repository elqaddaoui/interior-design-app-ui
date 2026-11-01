import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View, type ViewStyle } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { MediaView } from '@/components/ui/MediaView';
import { Txt } from '@/components/ui/Txt';
import { DragRow, useReorder } from '@/components/admin/DragReorder';
import { RightClick, sep, type MenuItem } from '@/components/admin/ContextMenu';
import { GestureRoot } from '@/components/GestureRoot';
import { useT } from '@/i18n';
import { toCardWebp } from '@/lib/cardImage';
import { mediaUploadsEnabled, uploadDataUrl } from '@/lib/media';
import { photosFromFiles, pickPhotos } from '@/lib/photo';
import type { PickManyResult } from '@/lib/photoTypes';
import { moveTo } from '@/lib/reorder';
import { toast } from '@/store/useToast';

const MAX_IMAGES = 30;

/**
 * Picked picture -> centered crop to the card's aspect ratio -> compressed WebP (max 800px wide) -> media storage (R2 / database).
 * Resolves '' when it could not be stored. `uploadDataUrl` is tracked, so a save waits for pending uploads.
 */
async function storeCardImage(uri: string, ratio?: number): Promise<string> {
  const webp = await toCardWebp(uri, ratio);
  if (!mediaUploadsEnabled || !webp.startsWith('data:')) return webp;
  try { return await uploadDataUrl(webp); } catch { return ''; }
}

/**
 * The ordered pictures of a slideshow. Order matters: the first is BEFORE, the second AFTER; with 3+ pictures each one is revealed over the previous.
 *  - Add many pictures at once (computer file dialog / phone gallery), or drop files from the computer onto the area.
 *  - Drag a picture (mouse, or touch after a short hold) onto another to set the new order; arrows stay as a keyboard / screen-reader alternative.
 *  - Right click (desktop): duplicate, move first / last, remove.
 */
export function SlideshowImages({ images, onChange, ratio }: { images: string[]; onChange: (next: string[]) => void; ratio?: number }) {
  const { t } = useT();
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  // Tile ids come from the picture itself (+ how many identical ones came before), so a duplicate never shares an id.
  const rows = useMemo(() => {
    const seen = new Map<string, number>();
    return images.map((uri) => { const n = seen.get(uri) ?? 0; seen.set(uri, n + 1); return { id: `${n}:${uri}`, uri }; });
  }, [images]);
  const latest = useRef(images);
  useEffect(() => { latest.current = images; });
  const area = useRef<View>(null);

  const reorder = useReorder(rows.map((r) => r.id), [], (ids, target) => onChange(moveTo(rows, ids, target).map((r) => r.uri)), true);

  const move = (i: number, to: number) => {
    if (to < 0 || to >= images.length || to === i) return;
    const next = [...images];
    [next[i], next[to]] = [next[to], next[i]];
    onChange(next);
  };
  const remove = (i: number) => onChange(images.filter((_, j) => j !== i));
  const duplicate = (i: number) => {
    const next = [...images];
    next.splice(i + 1, 0, images[i]);
    onChange(next);
    toast(t('ax.duplicated'));
  };
  const toFront = (i: number) => { if (i > 0) onChange([images[i], ...images.filter((_, j) => j !== i)]); };
  const toBack = (i: number) => { if (i < images.length - 1) onChange([...images.filter((_, j) => j !== i), images[i]]); };

  /** Pictures just chosen: stored one by one (progress shown); the ones that work are appended in the chosen order, the rest are reported. */
  const ingest = async (picked: PickManyResult) => {
    if (!('uris' in picked)) { if (picked.error === 'failed') toast(t('admin.f.uploadFailed')); return; }
    const room = MAX_IMAGES - latest.current.length;
    const list = picked.uris.slice(0, Math.max(0, room));
    let failed = picked.failed + (picked.uris.length - list.length);
    const done: string[] = [];
    setBusy({ done: 0, total: list.length });
    try {
      for (let i = 0; i < list.length; i++) {
        const stored = await storeCardImage(list[i], ratio);
        if (stored) done.push(stored); else failed++;
        setBusy({ done: i + 1, total: list.length });
      }
      if (done.length) onChange([...latest.current, ...done]);
      if (failed) toast(t('ax.uploadPartial', { failed }));
    } finally { setBusy(null); }
  };
  const add = async () => { if (busy) return; await ingest(await pickPhotos({ limit: Math.max(1, MAX_IMAGES - images.length) })); };

  // Files dropped from the computer (web only): the whole area is a drop zone.
  const dropRef = useRef(ingest);
  const busyRef = useRef(false);
  useEffect(() => { dropRef.current = ingest; busyRef.current = !!busy; });
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = area.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(true); };
    const overFn = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; setOver(true); };
    const leave = (e: DragEvent) => { if (!node.contains(e.relatedTarget as Node | null)) setOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); setOver(false);
      if (busyRef.current) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      void photosFromFiles(files, { limit: Math.max(1, MAX_IMAGES - latest.current.length) }).then((r) => dropRef.current(r));
    };
    node.addEventListener('dragenter', enter); node.addEventListener('dragover', overFn); node.addEventListener('dragleave', leave); node.addEventListener('drop', drop);
    return () => { node.removeEventListener('dragenter', enter); node.removeEventListener('dragover', overFn); node.removeEventListener('dragleave', leave); node.removeEventListener('drop', drop); };
  }, []);

  const menuOf = (i: number): MenuItem[] => [
    { key: 'duplicate', label: t('ax.duplicate'), icon: 'content-copy', disabled: images.length >= MAX_IMAGES, onPress: () => duplicate(i) },
    { key: 'first', label: t('ax.moveFirst'), icon: 'arrow-collapse-up', disabled: i === 0, onPress: () => toFront(i) },
    { key: 'last', label: t('ax.moveLast'), icon: 'arrow-collapse-down', disabled: i === images.length - 1, onPress: () => toBack(i) },
    sep('s1'),
    { key: 'delete', label: t('common.delete'), icon: 'trash-can-outline', danger: true, onPress: () => remove(i) },
  ];

  const hint = images.length === 0 ? t('tc.hint0') : images.length === 1 ? t('tc.hint1') : images.length === 2 ? t('tc.hint2') : t('tc.hint3');
  const cover: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: 'auto', height: 'auto', borderRadius: 8, backgroundColor: 'transparent' };
  return (
    <GestureRoot style={{ width: '100%' }}>
      <View ref={area} testID="slide-area" className={`gap-2 rounded-xl ${over ? 'border-2 border-dashed border-primary bg-soft p-2' : ''}`}>
        <Txt className="text-muted text-[12px]">{hint}</Txt>
         {ratio ? <Txt testID="slide-ratio" className="text-muted text-[12px]">{t('tc.imageRatio', { ratio: ratio.toFixed(2) })}</Txt> : null}
        <Txt testID="slide-drag-hint" className="text-muted text-[12px]">{over ? t('ax.dropHere') : t('ax.dragHint')}</Txt>
        <View testID="slide-grid" className="flex-row flex-wrap gap-2">
          {rows.map((row, i) => (
            <DragRow key={row.id} id={row.id} reorder={reorder} layout="grid" bare handleStyle={cover} onMove={(d) => move(i, i + d)} style={{ width: 104 }}>{(handle) => (
              <RightClick items={() => menuOf(i)}>
                <View testID={`slide-${i}`} className="rounded-xl border border-line p-1.5 gap-1" style={{ width: 104 }}>
                  <View style={{ width: '100%', height: 72 }}>
                    <MediaView uri={row.uri} className="rounded-lg" style={{ width: '100%', height: 72 }} />
                    {handle}
                  </View>
                  <View className="flex-row items-center justify-between">
                    <Txt className="text-muted text-[12px] font-bold">{i + 1}</Txt>
                    <View className="flex-row items-center gap-1">
                      {i > 0 ? <Pressable testID={`slide-left-${i}`} accessibilityRole="button" accessibilityLabel={t('tc.moveStart')} hitSlop={6} onPress={() => move(i, i - 1)}><Icon name="chevron-left" size={20} flip /></Pressable> : null}
                      {i < images.length - 1 ? <Pressable testID={`slide-right-${i}`} accessibilityRole="button" accessibilityLabel={t('tc.moveEnd')} hitSlop={6} onPress={() => move(i, i + 1)}><Icon name="chevron-right" size={20} flip /></Pressable> : null}
                      <Pressable testID={`slide-dup-${i}`} accessibilityRole="button" accessibilityLabel={t('ax.duplicate')} hitSlop={6} disabled={images.length >= MAX_IMAGES} onPress={() => duplicate(i)}><Icon name="content-copy" size={17} /></Pressable>
                      <Pressable testID={`slide-remove-${i}`} accessibilityRole="button" accessibilityLabel={t('common.delete')} hitSlop={6} onPress={() => remove(i)}><Icon name="trash-can-outline" size={18} tone="danger" /></Pressable>
                    </View>
                  </View>
                </View>
              </RightClick>
            )}</DragRow>
          ))}
        </View>
        <View className="flex-row items-center gap-3">
          <Button testID="slide-add" size="sm" variant="soft" icon="plus" title={t('ax.addImagesMulti')} onPress={add} loading={!!busy} disabled={images.length >= MAX_IMAGES} />
          {busy ? <Txt testID="slide-progress" className="text-muted text-[12px]">{t('ax.uploadingN', { done: busy.done, total: busy.total })}</Txt> : null}
        </View>
      </View>
    </GestureRoot>
  );
}
