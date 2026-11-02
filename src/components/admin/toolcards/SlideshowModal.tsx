import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import type { Lang, LText, Media, Tool, ToolCardFx, ToolCardGradient } from '@/data/types';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { Txt } from '@/components/ui/Txt';
import { ToolCard } from '@/components/ToolCard';
import { AnimationPicker } from '@/components/admin/toolcards/AnimationPicker';
import { AvailabilityModal } from '@/components/admin/toolcards/AvailabilityModal';
import { SlideshowImages } from '@/components/admin/toolcards/SlideshowImages';
import { useBackCheckpoint } from '@/hooks/useLeaveGuard';
import { useBp } from '@/hooks/useBp';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { LANGS, useL, useT } from '@/i18n';
import { HEIGHT_MAX, HEIGHT_MIN, HEIGHT_STEP, HOLDS, SPEEDS, cleanFx, imageHeight, mediaFx, resolveGlobal, slideshowImages } from '@/lib/toolCards';
import { FX_FADE, effectiveEffect, enabledIds, resolveAvail } from '@/lib/toolCardFx';
import { useStore } from '@/store/useStore';
import { useTheme, ThemeScope } from '@/theme/ThemeProvider';
import { PRESETS } from '@/theme/presets';

type Opt<T extends string> = { key: T; label: string };
const APP = 'app';

/** Row label with an optional hint line underneath. */
function Row({ label, hint, dim, children }: { label: string; hint?: string; dim?: boolean; children: React.ReactNode }) {
  return (
    <View className="mb-4" style={dim ? { opacity: 0.4 } : undefined} pointerEvents={dim ? 'none' : 'auto'}>
      <Txt className="text-[13px] font-bold mb-1.5">{label}</Txt>
      {children}
      {hint ? <Txt className="text-muted text-[12px] mt-1">{hint}</Txt> : null}
    </View>
  );
}

/** Group heading. The global group carries the "Applies to all cards" badge. */
function Group({ title, global, children }: { title: string; global?: boolean; children: React.ReactNode }) {
  return (
    <Card className="p-3 mb-3">
      <View className="flex-row items-center gap-2 mb-3">
        {global ? <Icon name="link-variant" size={16} tone="primary" /> : null}
        <Txt className="font-extrabold text-[15px] flex-1">{title}</Txt>
      </View>
      {children}
    </Card>
  );
}

/**
 * "Multiple images" popup of the tools form (Admin > Tools > edit a tool > Multiple images).
 *  - TOP (fixed): the live card, the real <ToolCard/> (same component, language and theme as Home) built from the form's current title / subtitle / media + a status line.
 *  - BOTTOM (scrollable): the pictures, "Applies to all cards" (height, text zone) and "This card" (animation, pause, speed, text placement, gradient).
 * Per-card changes go straight into the form's media value (`onChange`), so the preview updates at once and the form's own Save stores them in the tool.
 * Global changes go straight into the shared store (the Home cards update live) and are published by "Done".
 */
export function SlideshowModal({ title, subtitle, media, onChange, onClose }: {
  title?: LText; subtitle?: LText; media: Media; onChange: (m: Media) => void; onClose: () => void;
}) {
  const { t } = useT();
  const L = useL();
  const { style: themeStyle } = useTheme();
  const { tablet, height: screenH } = useBp();
  const settings = useDraftDoc('settings');
  const global = resolveGlobal(settings.draft.toolCards);
  const fx = mediaFx(media);
  const images = slideshowImages(media);
  // Only ENABLED effects can be chosen. A card that still holds a disabled one plays its fallback (see effectiveEffect) and shows it here.
  const avail = resolveAvail(settings.draft.toolCards);
  const enabled = enabledIds(avail);
  const kept = fx.effects ?? enabled;

  const setGlobal = (patch: Partial<typeof global>) => settings.patch({ toolCards: { ...resolveGlobal(useStore.getState().doc.settings.toolCards), ...patch } });
  const setFx = (patch: ToolCardFx) => onChange({ ...media, fx: cleanFx({ ...(media.fx ?? {}), ...patch }) });
  const setImages = (next: string[]) => onChange({ ...media, images: next, uri: next[0] ?? '' });

  // Done publishes the shared layout; the X discards it (the form decides about the rest).
  const done = async () => { if (!settings.dirty || (await settings.save())) onClose(); };
  const cancel = () => { settings.discard(); onClose(); };
  useBackCheckpoint(true, cancel, 2);

  // "Simulated app": preview only, never saved.
  const [simLang, setSimLang] = useState<string>(APP);
  const [simTheme, setSimTheme] = useState<string>(APP);
  const themeCfg = useMemo(() => ({ active: simTheme, custom: {} }), [simTheme]);
  const [popup, setPopup] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  // Aspect ratio (width / height) of the image zone, measured from the live preview: uploaded pictures are cropped to it.
  const [previewW, setPreviewW] = useState(360);
  const ratio = previewW / Math.max(1, imageHeight(global.height, fx.textPlacement === 'inside', 72));
  const [effectNow, setEffectNow] = useState(-1);
  const onEffect = useCallback((e: number) => setEffectNow(e), []);

  // The card shown in the preview: the tool being edited, with the form's current texts and media.
  const previewTool = { id: 'slideshow-preview', title: title ?? { dar: '', ar: '', fr: '' }, subtitle: subtitle ?? { dar: '', ar: '', fr: '' }, media, tabId: '', steps: [], modelIds: [], roomGroup: 'interior', order: 0, visible: true } as Tool;

  const toggleFx = (id: number) => setFx({ effects: (kept.includes(id) ? kept.filter((x) => x !== id) : [...kept, id]).sort((a, b) => a - b) });
  const holdOpts: Opt<string>[] = HOLDS.map((h) => ({ key: String(h), label: `${h}s` }));
  const speedOpts: Opt<string>[] = SPEEDS.map((s) => ({ key: String(s), label: `${s}x` }));
  const gradOpts: Opt<ToolCardGradient>[] = [{ key: 'soft', label: t('tc.soft') }, { key: 'medium', label: t('tc.medium') }, { key: 'strong', label: t('tc.strong') }];
  const single = effectiveEffect(fx.effect, avail, false);
  const animLabel = fx.mode === 'multiple' ? t('tc.choose', { n: kept.length }) : t(`tc.fx.${single}`);
  const status = effectNow >= 0 && images.length > 1
    ? t('tc.status', { fx: t(`tc.fx.${effectNow}`), pause: `${fx.hold}s`, h: global.height })
    : `${t('tc.staticStatus')} · ${global.height} px`;

  const card = (
    <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }} onLayout={(e) => setPreviewW(Math.round(e.nativeEvent.layout.width))}>
      <ToolCard tool={previewTool} preview lang={simLang === APP ? undefined : (simLang as Lang)} onPress={() => {}} onEffect={onEffect} />
    </View>
  );

  return (
    <Modal visible transparent animationType={tablet ? 'fade' : 'slide'} onRequestClose={cancel} statusBarTranslucent>
      <View style={[themeStyle, { flex: 1 }]}>
        <Pressable onPress={cancel} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: tablet ? 'center' : 'flex-end', alignItems: 'center' }}>
          <Pressable onPress={() => {}} testID="slideshow-modal" className={`bg-bg w-full overflow-hidden ${tablet ? 'rounded-2xl max-w-[880px]' : 'rounded-t-2xl'}`} style={{ height: screenH * (tablet ? 0.9 : 0.94), width: tablet ? '92%' : '100%' }}>
            {/* ---------- TOP (fixed): header + live preview + status ---------- */}
            <View className="px-3 pt-2 pb-2 border-b border-line bg-bg" style={{ zIndex: 5 }}>
              <View className="flex-row items-center gap-2 mb-2">
                <Txt className="text-[16px] font-extrabold flex-1" accessibilityRole="header" numberOfLines={1}>{t('tc.configure')}</Txt>
                <Pressable testID="slideshow-close" accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={cancel} hitSlop={8} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="close" size={18} /></Pressable>
              </View>
              {simTheme === APP ? card : <ThemeScope config={themeCfg} className="rounded-2xl p-2">{card}</ThemeScope>}
              <Txt testID="toolcards-status" className="text-muted text-[12px] text-center mt-2" numberOfLines={1}>{status}</Txt>
            </View>

            {/* ---------- BOTTOM (scrollable): settings. The animation popup fills this area only, so the preview above stays visible. ---------- */}
            <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
                <Txt className="text-muted text-[12px] mb-3">{t('tc.liveNote')}</Txt>

                <Group title={t('tc.imagesLabel')}>
                  <SlideshowImages images={images} onChange={setImages} ratio={ratio} />
                </Group>

                <Group title={t('tc.global')} global>
                  <Row label={`${t('tc.height')}: ${global.height}px`} hint={t('tc.global')}>
                    <Slider testID="tc-height" label={t('tc.height')} value={global.height} min={HEIGHT_MIN} max={HEIGHT_MAX} step={HEIGHT_STEP} onChange={(height) => setGlobal({ height })} />
                  </Row>
                  <Row label={t('tc.textZone')} hint={t('tc.global')}>
                    <Segmented testID="tc-zone" value={global.textZone} options={[{ key: 'top', label: t('tc.top') }, { key: 'bottom', label: t('tc.bottom') }]} onChange={(textZone) => setGlobal({ textZone })} />
                  </Row>
                  <Row label={t('tc.availTitle')} hint={t('tc.global')}>
                    <Pressable testID="tc-availability" accessibilityRole="button" onPress={() => setAvailOpen(true)} className="flex-row items-center gap-2 px-4 h-11 rounded-xl bg-surface2">
                      <Icon name="tune-variant" size={18} tone="primary" />
                      <Txt className="flex-1 font-semibold text-[14px]" numberOfLines={1}>{t('tc.availOpen')}</Txt>
                      <Txt className="text-muted text-[12px] font-bold">{t('tc.availCount', { on: avail.enabled.size, total: 30 })}</Txt>
                    </Pressable>
                  </Row>
                </Group>

                <Group title={t('tc.thisCard')}>
                  <Row label={t('tc.animType')}>
                    <Segmented testID="tc-mode" value={fx.mode} options={[{ key: 'single', label: t('tc.single') }, { key: 'multiple', label: t('tc.multiple') }]} onChange={(mode) => setFx({ mode })} />
                  </Row>
                  <Row label={t('tc.animations')} hint={fx.mode === 'multiple' && kept.length === 0 ? t('tc.noneSelected') : undefined}>
                    <Pressable testID="tc-animations" accessibilityRole="button" onPress={() => setPopup(true)} className="flex-row items-center gap-2 px-4 h-11 rounded-xl bg-surface2">
                      <Txt className="flex-1 font-semibold text-[14px]" numberOfLines={1}>{animLabel}</Txt>
                      <Icon name="chevron-down" size={20} tone="muted" />
                    </Pressable>
                  </Row>
                  <Row label={t('tc.pause')}>
                    <Segmented testID="tc-pause" value={String(fx.hold)} options={holdOpts} onChange={(v) => setFx({ hold: Number(v), pause: undefined })} compact />
                  </Row>
                  <Row label={t('tc.speed')}>
                    <Segmented testID="tc-speed" value={String(fx.speed)} options={speedOpts} onChange={(v) => setFx({ speed: Number(v) })} compact />
                  </Row>
                  <Row label={t('tc.placement')}>
                    <Segmented testID="tc-placement" value={fx.textPlacement} options={[{ key: 'inside', label: t('tc.inside') }, { key: 'outside', label: t('tc.outside') }]} onChange={(textPlacement) => setFx({ textPlacement })} />
                  </Row>
                  <Row label={t('tc.gradient')} dim={fx.textPlacement === 'outside'}>
                    <Segmented testID="tc-gradient" value={fx.gradient} options={gradOpts} onChange={(gradient) => setFx({ gradient })} />
                  </Row>
                </Group>

                {/* Test-only: affects the preview, is never saved. */}
                <Group title={t('tc.simulated')}>
                  <Row label={t('tc.simLang')}>
                    <Segmented testID="tc-sim-lang" value={simLang} options={[{ key: APP, label: t('tc.simApp') }, ...LANGS.map((l) => ({ key: l as string, label: t(`lang.${l}`) }))]} onChange={setSimLang} compact />
                  </Row>
                  <Row label={t('tc.simTheme')}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {[{ key: APP, label: t('tc.simApp') }, ...PRESETS.map((p) => ({ key: p.id, label: L(p.name) }))].map((o) => {
                        const on = simTheme === o.key;
                        return (
                          <Pressable key={o.key} testID={`tc-sim-theme-${o.key}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setSimTheme(o.key)} className={`px-3.5 h-9 rounded-full items-center justify-center border ${on ? 'bg-primary border-primary' : 'bg-surface2 border-transparent'}`}>
                            <Txt className={`text-[13px] font-semibold ${on ? 'text-onprimary' : ''}`} numberOfLines={1}>{o.label}</Txt>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </Row>
                </Group>
              </ScrollView>

              {popup ? (
                <AnimationPicker mode={fx.mode} effects={kept} effect={single} enabled={enabled}
                  onToggle={toggleFx} onAll={() => setFx({ effects: [FX_FADE, ...enabled] })} onClear={() => setFx({ effects: [] })}
                  onPick={(effect) => setFx({ effect })} onClose={() => setPopup(false)} />
              ) : null}
            </View>

            <View className="px-3 pt-2.5 pb-3 border-t border-line bg-bg">
              <Button testID="slideshow-done" title={t('common.done')} onPress={done} full />
            </View>
          </Pressable>
        </Pressable>
      </View>
      {availOpen ? <AvailabilityModal images={images} onClose={() => setAvailOpen(false)} /> : null}
    </Modal>
  );
}
