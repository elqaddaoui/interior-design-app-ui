 
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { Slider } from '@/components/ui/Slider';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { pickPhoto } from '@/lib/photo';
import { mediaUploadsEnabled, uploadDataUrl } from '@/lib/media';
import { toast } from '@/store/useToast';
import { DARK_BG } from '@/lib/brand/color';
import { canEditImage, cropImage, imageSize, ratioOf, trimRect, whiteVersion } from '@/lib/brand/imageTools';
import type { LogoSpec } from '@/lib/brand/spec';
import { Chips, Hint, Label } from './ui';

type Slot = 'light' | 'dark';
type Up = (fn: (s: LogoSpec) => LogoSpec, key?: string) => void;

/** Crop by trimming each edge (sliders) or snapping to a shape; the dimmed frame shows what stays. Works the same with mouse, touch and keyboard. */
function CropSheet({ uri, onClose, onApply }: { uri: string; onClose: () => void; onApply: (rect: { originX: number; originY: number; width: number; height: number }) => void }) {
  const { t } = useT();
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [ins, setIns] = useState({ l: 0, r: 0, t: 0, b: 0 });
  useEffect(() => { void imageSize(uri).then(setDim); }, [uri]);
  const ratio = dim.w && dim.h ? dim.w / dim.h : 1;
  const boxW = Math.min(300, 220 * ratio), boxH = boxW / ratio;
  const snap = (a: number) => {
    if (!dim.w) return;
    const cur = (dim.w * (1 - ins.l - ins.r)) / (dim.h * (1 - ins.t - ins.b));
    void cur;
    if (dim.w / dim.h > a) { const keep = (dim.h * a) / dim.w; setIns({ l: (1 - keep) / 2, r: (1 - keep) / 2, t: 0, b: 0 }); }
    else { const keep = dim.w / a / dim.h; setIns({ l: 0, r: 0, t: (1 - keep) / 2, b: (1 - keep) / 2 }); }
  };
  const sl = (k: 'l' | 'r' | 't' | 'b', label: string) => (
    <View className="mb-1.5"><Label>{label}</Label><Slider testID={`crop-${k}`} label={label} value={Math.round(ins[k] * 100)} min={0} max={45} onChange={(v) => setIns((o) => ({ ...o, [k]: v / 100 }))} /></View>
  );
  const rect = { originX: Math.round(dim.w * ins.l), originY: Math.round(dim.h * ins.t), width: Math.max(1, Math.round(dim.w * (1 - ins.l - ins.r))), height: Math.max(1, Math.round(dim.h * (1 - ins.t - ins.b))) };
  return (
    <Sheet visible onClose={onClose} title={t('br.crop')} footer={<View className="flex-row gap-2.5 mb-1"><Button full variant="soft" title={t('br.cancel')} onPress={onClose} /><Button full testID="crop-apply" title={t('br.apply')} onPress={() => onApply(rect)} /></View>}>
      <View className="items-center mb-3">
        <View style={{ width: boxW, height: boxH, backgroundColor: '#8884', borderRadius: 6, overflow: 'hidden' }}>
          <Image source={{ uri }} contentFit="fill" style={{ width: boxW, height: boxH }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: boxW, height: boxH * ins.t, backgroundColor: '#0009' }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, bottom: 0, width: boxW, height: boxH * ins.b, backgroundColor: '#0009' }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: boxH * ins.t, width: boxW * ins.l, bottom: boxH * ins.b, backgroundColor: '#0009' }} />
          <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: boxH * ins.t, width: boxW * ins.r, bottom: boxH * ins.b, backgroundColor: '#0009' }} />
          <View pointerEvents="none" style={{ position: 'absolute', left: boxW * ins.l, right: boxW * ins.r, top: boxH * ins.t, bottom: boxH * ins.b, borderWidth: 2, borderColor: '#fff' }} />
        </View>
      </View>
      <Chips small value={'x'} onChange={(k) => (k === 'reset' ? setIns({ l: 0, r: 0, t: 0, b: 0 }) : snap(k === 'sq' ? 1 : k === '43' ? 4 / 3 : 3))} testID="crop-shape"
        options={[{ key: 'reset', label: t('br.cropFree'), icon: 'restore' }, { key: 'sq', label: '1:1' }, { key: '43', label: '4:3' }, { key: '31', label: '3:1' }]} />
      {sl('l', t('br.trimLeft'))}{sl('r', t('br.trimRight'))}{sl('t', t('br.trimTop'))}{sl('b', t('br.trimBottom'))}
    </Sheet>
  );
}

/** Light + dark logo versions: upload, crop, auto-trim, one-tap white version for dark backgrounds. */
export function ImagePanel({ spec, up }: { spec: LogoSpec; up: Up }) {
  const { t } = useT();
  const [busy, setBusy] = useState<Slot | ''>('');
  const [cropping, setCropping] = useState<Slot | ''>('');
  const store = async (slot: Slot, uri: string) => {
    const url = mediaUploadsEnabled && uri.startsWith('data:') ? await uploadDataUrl(uri) : uri;
    const ratio = await ratioOf(url);
    up((s) => ({ ...s, image: { ...s.image, [slot]: url, ...(slot === 'light' ? { ratio } : { darkRatio: ratio }) } }), `image-${slot}`);
  };
  const run = async (slot: Slot, job: () => Promise<void>) => { setBusy(slot); try { await job(); } catch { toast(t('br.imageFailed')); } finally { setBusy(''); } };
  const upload = (slot: Slot) => run(slot, async () => { const r = await pickPhoto('gallery', { preserveTransparency: true }); if ('uri' in r) await store(slot, r.uri); });
  const uri = (slot: Slot) => spec.image[slot];
  const slot = (id: Slot) => {
    const u = uri(id);
    return (
      <View key={id} testID={`img-slot-${id}`} className="flex-1 rounded-xl border border-line p-2.5" style={{ minWidth: 150 }}>
        <Label>{id === 'light' ? t('br.imgLight') : t('br.imgDark')}</Label>
        <View className="rounded-lg items-center justify-center mb-2" style={{ height: 76, backgroundColor: id === 'light' ? '#FFFFFF' : DARK_BG, borderWidth: 1, borderColor: '#8884' }}>
          {u ? <Image testID={`img-preview-${id}`} source={{ uri: u }} contentFit="contain" style={{ width: '88%', height: 60 }} accessibilityLabel={t(id === 'light' ? 'br.imgLight' : 'br.imgDark')} /> : <Icon name="image-plus-outline" size={26} tone="muted" />}
        </View>
        <View className="flex-row flex-wrap gap-1.5">
          <Button testID={`img-upload-${id}`} size="sm" variant={u ? 'soft' : 'primary'} icon="upload" title={u ? t('br.replace') : t('br.upload')} loading={busy === id} onPress={() => upload(id)} />
          {u ? <Button testID={`img-crop-${id}`} size="sm" variant="soft" icon="crop" title={t('br.crop')} onPress={() => setCropping(id)} /> : null}
          {u && canEditImage ? <Button testID={`img-trim-${id}`} size="sm" variant="soft" icon="vector-square" title={t('br.autoTrim')} onPress={() => run(id, async () => { const r = await trimRect(u); if (!r) { toast(t('br.nothingToTrim')); return; } await store(id, await cropImage(u, r)); })} /> : null}
          {id === 'dark' && spec.image.light && canEditImage ? <Button testID="img-white" size="sm" variant="soft" icon="invert-colors" title={t('br.whiteVersion')} onPress={() => run('dark', async () => { const w = await whiteVersion(spec.image.light); if (!w) { toast(t('br.needsTransparent')); return; } await store('dark', w); })} /> : null}
          {u && (id === 'dark' || true) ? <Pressable testID={`img-remove-${id}`} accessibilityRole="button" onPress={() => up((s) => ({ ...s, image: { ...s.image, [id]: '' } }))} className="h-9 px-2 justify-center"><Txt className="text-danger font-bold text-[12px]">{t('br.remove')}</Txt></Pressable> : null}
        </View>
      </View>
    );
  };
  return (
    <View>
      <View className="flex-row flex-wrap gap-2.5 mb-2">{slot('light')}{slot('dark')}</View>
      <Hint>{t('br.imgHint')}</Hint>
      {cropping && uri(cropping) ? <CropSheet uri={uri(cropping)} onClose={() => setCropping('')} onApply={(rect) => { const id = cropping; setCropping(''); void run(id, async () => { await store(id, await cropImage(uri(id), rect)); }); }} /> : null}
    </View>
  );
}
