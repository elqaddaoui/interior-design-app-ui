import React, { useEffect, useState } from 'react';
import { Modal, Pressable, TextInput, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { BootLoader } from '@/components/BootLoader';
import { ColorPicker } from '@/components/admin/ColorPicker';
import { ImageField } from '@/components/admin/ImageField';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { LOADER_DELAYS, LOADER_STYLES, MAX_LOADER_DELAY, loaderConfig } from '@/lib/boot';
import type { AppSettings, LoaderAnim } from '@/data/types';

const ANIMS: LoaderAnim[] = ['none', 'spin', 'pulse'];
const seconds = (ms: number) => `${(ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;

/** Admin: Interface > Loading screen. Edits the settings draft (saved with the page's Submit button). */
export function LoaderSettings({ settings, set }: { settings: AppSettings; set: (patch: Partial<AppSettings>) => void }) {
  const { t } = useT();
  const { colors } = useTheme();
  const cfg = loaderConfig(settings, colors);
  const [preview, setPreview] = useState(false);
  // Free-text seconds while typing; any other change (chips, discard) shows the saved value again.
  const [typed, setTyped] = useState<{ text: string; ms: number } | null>(null);
  const delayText = typed && typed.ms === cfg.delayMs ? typed.text : String(cfg.delayMs / 1000);
  // The preview closes by itself after the chosen delay (automatic mode: 2 s, about the time two cards take to appear).
  useEffect(() => {
    if (!preview) return;
    const timer = setTimeout(() => setPreview(false), cfg.delayMs || 2000);
    return () => clearTimeout(timer);
  }, [preview, cfg.delayMs]);
  const chip = (on: boolean) => `px-3 h-9 rounded-full items-center justify-center border ${on ? 'border-ink bg-ink' : 'border-line bg-surface2'}`;
  const chipText = (on: boolean) => `text-[13px] ${on ? 'text-onink font-extrabold' : 'text-muted font-semibold'}`;

  return (
    <Card className="p-3 mb-3">
      <View className="flex-row items-center gap-3 mb-1">
        <Txt className="font-extrabold text-[17px] flex-1">{t('improve.loaderTitle')}</Txt>
        <Toggle testID="loader-enabled" label={t('improve.loaderEnabled')} value={cfg.enabled} onValueChange={(loaderEnabled) => set({ loaderEnabled })} />
      </View>
      <Txt className="text-muted text-[13px] mb-4">{t(cfg.enabled ? 'improve.loaderDesc' : 'improve.loaderOff')}</Txt>

      {cfg.enabled ? <>
        <Txt className="font-bold text-[14px] mb-2">{t('improve.loaderStyle')}</Txt>
        <View testID="loader-style-grid" style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -5 }}>
          {LOADER_STYLES.map((style) => {
            const active = cfg.style === style;
            return (
              <View key={style} style={{ width: '33.3333%', padding: 5, minWidth: 0 }}>
              <Pressable testID={`loader-style-${style}`} accessibilityRole="radio" accessibilityState={{ selected: active }} onPress={() => set({ loaderStyle: style })}
                className={`rounded-2xl border-2 p-2 items-center ${active ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ width: '100%' }}>
                <View className="rounded-xl items-center justify-center overflow-hidden" style={{ width: '100%', height: 84, backgroundColor: cfg.bg }}>
                  {style === 'custom' && !cfg.uri ? <Icon name="image-plus" size={28} tone="muted" /> : <BootLoader config={{ ...cfg, style }} scale={0.75} />}
                </View>
                <View className="flex-row items-center gap-1 mt-2">
                  {active ? <Icon name="check-circle" size={14} tone="primary" /> : null}
                  <Txt className="text-[12.5px] font-bold" numberOfLines={1} style={{ flexShrink: 1 }}>{t(`improve.loader_${style}`)}</Txt>
                </View>
              </Pressable>
              </View>
            );
          })}
        </View>

        {cfg.style === 'custom' ? (
          <View className="mt-4">
            <ImageField label={t('improve.loaderImage')} value={settings.loaderCustomUri ?? ''} onChange={(loaderCustomUri) => set({ loaderCustomUri })} />
            <Txt className="text-muted text-[12px] -mt-1 mb-3">{t('improve.loaderImageHint')}</Txt>
            <Txt className="font-bold text-[14px] mb-2">{t('improve.loaderAnim')}</Txt>
            <View className="flex-row flex-wrap gap-2">
              {ANIMS.map((anim) => <Pressable key={anim} testID={`loader-anim-${anim}`} onPress={() => set({ loaderCustomAnim: anim })} className={chip(cfg.anim === anim)}><Txt className={chipText(cfg.anim === anim)}>{t(`improve.loaderAnim_${anim}`)}</Txt></Pressable>)}
            </View>
          </View>
        ) : (
          <View className="mt-4">
            <ColorPicker label={t('improve.loaderColor')} value={settings.loaderColor || colors.ink} onChange={(loaderColor) => set({ loaderColor })} />
            {settings.loaderColor ? <Pressable onPress={() => set({ loaderColor: '' })} className="-mt-2 mb-2 self-start"><Txt className="text-primary font-bold text-[13px]">{t('improve.loaderColorTheme')}</Txt></Pressable> : null}
          </View>
        )}

        <Txt className="font-bold text-[14px] mt-4 mb-1">{t('improve.loaderDelay')}</Txt>
        <Txt className="text-muted text-[12px] mb-2">{t(cfg.delayMs ? 'improve.loaderDelayFixed' : 'improve.loaderDelayAuto', { s: seconds(cfg.delayMs) })}</Txt>
        <View className="flex-row flex-wrap gap-2 items-center">
          {LOADER_DELAYS.map((ms) => <Pressable key={ms} testID={`loader-delay-${ms}`} onPress={() => set({ loaderDelayMs: ms })} className={chip(cfg.delayMs === ms)}><Txt className={chipText(cfg.delayMs === ms)}>{ms ? seconds(ms) : t('improve.loaderAuto')}</Txt></Pressable>)}
          <View className="flex-row items-center gap-2">
            <TextInput testID="loader-delay-input" value={delayText} keyboardType="decimal-pad" accessibilityLabel={t('improve.loaderDelay')}
              onChangeText={(text) => { const value = Number(text.replace(',', '.')); const ms = Number.isFinite(value) && value >= 0 ? Math.min(MAX_LOADER_DELAY, Math.round(value * 1000)) : cfg.delayMs; setTyped({ text, ms }); if (ms !== cfg.delayMs) set({ loaderDelayMs: ms }); }}
              style={{ width: 64, height: 36, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.surface2, color: colors.fg, fontSize: 14, outlineStyle: 'none' } as any} />
            <Txt className="text-muted text-[13px]">s (max {MAX_LOADER_DELAY / 1000})</Txt>
          </View>
        </View>

        <View className="flex-row mt-4"><Button testID="loader-preview" title={t('improve.loaderPreview')} icon="play" variant="soft" size="sm" onPress={() => setPreview(true)} /></View>
      </> : null}

      <Modal visible={preview} transparent animationType="fade" onRequestClose={() => setPreview(false)}>
        <Pressable testID="loader-preview-overlay" onPress={() => setPreview(false)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: cfg.bg }}>
          <BootLoader config={cfg} />
          <Txt className="text-muted text-[12px] mt-6">{t('improve.loaderPreviewHint')}</Txt>
        </Pressable>
      </Modal>
    </Card>
  );
}
