import React from 'react';
import { View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { Chips, Line, Sld, Sw } from '@/components/admin/studio/ui';
import { useT } from '@/i18n';
import { ADV_LIMITS, REAL_CARD_W, REAL_DPR, cleanAdvanced, qualityPreset, realWidth, type RenderSettings } from '@/lib/cardVideoPlan';
import type { VideoAdvanced } from '@/data/types';

type WidthMode = 'preset' | 'real' | 'custom';

/**
 * Admin > Performance > Advanced rendering settings. Every control overrides ONE thing of the chosen quality; an untouched control follows the
 * quality (so "Best" keeps its own recipe). The stored object only holds what the admin changed (`toolCards.videoAdv`).
 */
export function RenderAdvanced({ adv, onAdv, rs }: { adv: VideoAdvanced; onAdv: (a: VideoAdvanced) => void; rs: RenderSettings }) {
  const { t } = useT();
  const preset = qualityPreset(rs.quality);
  const set = (patch: Partial<Record<keyof VideoAdvanced, unknown>>) => onAdv(cleanAdvanced({ ...adv, ...patch }));
  const widthMode: WidthMode = adv.width === 0 ? 'real' : adv.width !== undefined ? 'custom' : preset.real ? 'real' : 'preset';
  const real = widthMode === 'real';
  const cardW = adv.cardW ?? REAL_CARD_W, dpr = adv.dpr ?? REAL_DPR;
  const touched = Object.keys(adv).length > 0;
  const kb = (n: number) => `${n} kbps`;
  const mb = (n: number) => `${n.toFixed(1)} MB`;

  return (
    <View testID="video-advanced" style={{ gap: 12 }}>
      <Txt className="text-muted text-[12px]">{t('ax.vid.adv.intro')}</Txt>

      <Line label={t('ax.vid.adv.size')} value={`${rs.width}×${rs.height} px`}>
        <Chips testID="adv-width-mode" value={widthMode}
          options={[{ key: 'preset', label: t('ax.vid.adv.sizePreset', { w: preset.maxWidth }) }, { key: 'real', label: t('ax.vid.adv.sizeReal') }, { key: 'custom', label: t('ax.vid.adv.sizeCustom') }]}
          onChange={(m) => { if (m === 'real') set({ width: preset.real ? undefined : 0 }); else if (m === 'custom') set({ width: rs.width }); else set({ width: preset.real ? rs.width : undefined }); }} />
      </Line>
      {real ? (
        <>
          <Sld testID="adv-cardw" label={t('ax.vid.adv.cardW')} value={cardW} min={ADV_LIMITS.cardW[0]} max={ADV_LIMITS.cardW[1]} step={10} fmt={(v) => `${v} px`} onChange={(v) => set({ cardW: v === REAL_CARD_W ? undefined : v })} />
          <Sld testID="adv-dpr" label={t('ax.vid.adv.dpr')} value={dpr} min={ADV_LIMITS.dpr[0]} max={ADV_LIMITS.dpr[1]} step={0.5} fmt={(v) => `×${v}`} onChange={(v) => set({ dpr: v === REAL_DPR ? undefined : v })} />
          <Txt testID="adv-real-note" className="text-muted text-[12px] -mt-1">{t('ax.vid.adv.realNote', { w: cardW, d: dpr, px: realWidth(cardW, dpr) })}</Txt>
        </>
      ) : null}
      {widthMode === 'custom' ? <Sld testID="adv-width" label={t('ax.vid.adv.width')} value={rs.width} min={ADV_LIMITS.width[0]} max={ADV_LIMITS.width[1]} step={10} fmt={(v) => `${v} px`} onChange={(v) => set({ width: v })} /> : null}

      <Sld testID="adv-fps" label={t('ax.vid.adv.fps')} value={rs.fps} min={ADV_LIMITS.fps[0]} max={ADV_LIMITS.fps[1]} step={1} fmt={(v) => `${v} fps`} onChange={(v) => set({ fps: v === preset.fps ? undefined : v })} />

      <Sw testID="adv-fit" label={t('ax.vid.adv.fit')} value={rs.fit} onChange={(v) => set({ fit: v === !!preset.fit ? undefined : v })} />
      <Txt className="text-muted text-[12px] -mt-2">{t(rs.fit ? 'ax.vid.adv.fitOn' : 'ax.vid.adv.fitOff')}</Txt>
      {rs.fit ? (
        <>
          <Sld testID="adv-min" label={t('ax.vid.adv.minMB')} value={rs.minMB} min={ADV_LIMITS.minMB[0]} max={ADV_LIMITS.minMB[1]} step={0.1} fmt={mb} onChange={(v) => set({ minMB: v, maxMB: Math.max(v, rs.maxMB) })} />
          <Sld testID="adv-max" label={t('ax.vid.adv.maxMB')} value={rs.maxMB} min={ADV_LIMITS.maxMB[0]} max={ADV_LIMITS.maxMB[1]} step={0.1} fmt={mb} onChange={(v) => set({ maxMB: v, minMB: Math.min(v, rs.minMB) })} />
        </>
      ) : (
        <>
          <Sw testID="adv-manual" label={t('ax.vid.adv.manualRate')} value={adv.kbps !== undefined} onChange={(v) => set({ kbps: v ? Math.round(rs.bitrate ? rs.bitrate / 1000 : 2000) : undefined })} />
          {adv.kbps !== undefined ? <Sld testID="adv-kbps" label={t('ax.vid.adv.kbps')} value={adv.kbps} min={ADV_LIMITS.kbps[0]} max={ADV_LIMITS.kbps[1]} step={50} fmt={kb} onChange={(v) => set({ kbps: v })} /> : <Txt className="text-muted text-[12px] -mt-2">{t('ax.vid.adv.autoRate')}</Txt>}
        </>
      )}

      <Sld testID="adv-keyint" label={t('ax.vid.adv.keyInt')} value={rs.keyInt} min={ADV_LIMITS.keyInt[0]} max={ADV_LIMITS.keyInt[1]} step={0.5} fmt={(v) => `${v} s`} onChange={(v) => set({ keyInt: v === 2 ? undefined : v })} />
      <Line label={t('ax.vid.adv.codec')}>
        <Chips testID="adv-codec" value={rs.codec}
          options={[{ key: 'auto', label: t('ax.vid.adv.codecAuto') }, { key: 'avc', label: 'H.264' }, { key: 'vp9', label: 'VP9' }, { key: 'av1', label: 'AV1' }]}
          onChange={(c) => set({ codec: c === 'auto' ? undefined : c })} />
      </Line>
      <Txt className="text-muted text-[12px] -mt-1">{t('ax.vid.adv.codecNote')}</Txt>

      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Icon name="information-outline" size={16} tone="muted" />
        <Txt className="text-muted text-[12px] flex-1">{t('ax.vid.adv.staleNote')}</Txt>
      </View>
      <View className="flex-row" style={{ gap: 8 }}>
        <Button testID="adv-reset" size="sm" variant="outline" icon="restore" title={t('ax.vid.adv.reset')} disabled={!touched} onPress={() => onAdv({})} />
      </View>
    </View>
  );
}
