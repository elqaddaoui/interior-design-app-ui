import React, { useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { useBackCheckpoint } from '@/hooks/useLeaveGuard';
import { useBp } from '@/hooks/useBp';
import { useDraftDoc } from '@/hooks/useDraftDoc';
import { useT } from '@/i18n';
import { DEFAULT_ENABLED, DEFAULT_LOW_END, TIERS, TIER_ORDER, availToStored, resolveAvail, type FxAvail } from '@/lib/toolCardFx';
import { deviceFacts, resetLowEnd, useDeviceClass } from '@/lib/toolCardPerf';
import { resolveGlobal } from '@/lib/toolCards';
import { useStore } from '@/store/useStore';
import { useTheme } from '@/theme/ThemeProvider';
import { BenchStage, type BenchResult } from './BenchStage';

/**
 * Global "Transition availability" popup: all 30 effects grouped by tier, two switches each.
 *  - Enabled: off = the effect can never be chosen or played anywhere (a card using it falls back to the nearest enabled Safe effect,
 *    or the cross-fade).
 *  - Allowed on low-end devices: off = low-end devices play the cross-fade instead (the switch is only meaningful when Enabled is on).
 *  - Buttons: Safe only / Enable all / Reset to defaults. Changes go to the shared store at once (live preview, Home cards), "Done" saves.
 *  - "Test on this phone": plays the effect 3 times on a sample card and reports the average frame time, dropped frames and a verdict.
 * The cross-fade is shown first and has no switches: it is always enabled and cannot be turned off.
 */
export function AvailabilityModal({ images, onClose }: { images: string[]; onClose: () => void }) {
  const { t } = useT();
  const { tablet, height: screenH } = useBp();
  const { style: themeStyle, colors } = useTheme();
  const settings = useDraftDoc('settings');
  const avail = resolveAvail(settings.draft.toolCards);
  const device = useDeviceClass();
  const lowEnd = device.low;
  const reason = device.reason;
  const facts = deviceFacts();
  const factsText = [facts.platform, facts.memoryGB != null ? `${facts.memoryGB} GB` : null, facts.cores != null ? `${facts.cores} cores` : null, facts.api != null ? `API ${facts.api}` : null].filter(Boolean).join(' · ');

  /** Writes a new availability into the shared store (live), keeping the other global settings (height, text zone). */
  const apply = useCallback((next: FxAvail) => settings.patch({ toolCards: { ...resolveGlobal(useStore.getState().doc.settings.toolCards), ...availToStored(next) } }), [settings]);
  const edit = (id: number, key: 'enabled' | 'lowEnd', on: boolean) => {
    const enabled = new Set(avail.enabled), low = new Set(avail.lowEnd);
    const set = key === 'enabled' ? enabled : low;
    if (on) set.add(id); else set.delete(id);
    // Turning an effect off everywhere also removes its low-end permission (it can no longer play at all).
    if (key === 'enabled' && !on) low.delete(id);
    apply({ enabled, lowEnd: low });
  };
  const safeOnly = () => apply({ enabled: new Set(TIERS.safe), lowEnd: new Set(TIERS.safe) });
  const enableAll = () => { const all = new Set([...TIERS.safe, ...TIERS.medium, ...TIERS.heavy]); apply({ enabled: all, lowEnd: new Set(avail.lowEnd) }); };
  const reset = () => apply({ enabled: new Set(DEFAULT_ENABLED), lowEnd: new Set(DEFAULT_LOW_END) });

  const done = async () => { if (!settings.dirty || (await settings.save())) onClose(); };
  const cancel = () => { settings.discard(); onClose(); };
  useBackCheckpoint(true, cancel, 3);

  // One benchmark at a time.
  const [bench, setBench] = useState<{ id: number; run: number } | null>(null);
  const [results, setResults] = useState<Record<number, BenchResult>>({});
  const onProgress = useCallback((run: number) => setBench((b) => (b ? { ...b, run } : b)), []);
  const onBenchDone = useCallback((r: BenchResult) => { setBench((b) => { if (b) setResults((old) => ({ ...old, [b.id]: r })); return null; }); }, []);

  const verdictColor = (v: BenchResult['verdict']) => (v === 'smooth' ? '#1D9E75' : v === 'borderline' ? '#EF9F27' : '#E24B4A');
  const enabledCount = avail.enabled.size;

  const row = (id: number) => {
    const on = avail.enabled.has(id);
    const r = results[id];
    const testing = bench?.id === id;
    return (
      <View key={id} testID={`avail-row-${id}`} className="rounded-xl bg-surface2 px-3 py-2 mb-2" style={{ opacity: on ? 1 : 0.7 }}>
        <View className="flex-row items-center gap-2">
          <Txt className="w-6 text-muted text-[12px] font-bold">{id}</Txt>
          <Txt className="flex-1 text-[14px] font-semibold" numberOfLines={2}>{t(`tc.fx.${id}`)}</Txt>
        </View>
        <View className="flex-row items-center gap-4 mt-2">
          <View className="flex-row items-center gap-2 flex-1">
            <Toggle testID={`avail-en-${id}`} label={`${t('tc.enabledSw')} ${t(`tc.fx.${id}`)}`} value={on} onValueChange={(v) => edit(id, 'enabled', v)} />
            <Txt className="text-[12px] flex-1" numberOfLines={2}>{t('tc.enabledSw')}</Txt>
          </View>
          <View className="flex-row items-center gap-2 flex-1" style={{ opacity: on ? 1 : 0.4 }}>
            <Toggle testID={`avail-low-${id}`} label={`${t('tc.lowEndSw')} ${t(`tc.fx.${id}`)}`} value={on && avail.lowEnd.has(id)} disabled={!on} onValueChange={(v) => edit(id, 'lowEnd', v)} />
            <Txt className="text-[12px] flex-1" numberOfLines={2}>{t('tc.lowEndSw')}</Txt>
          </View>
        </View>
        <View className="flex-row items-center gap-2 mt-2 flex-wrap">
          <Button testID={`avail-test-${id}`} size="sm" variant="soft" icon="speedometer" title={testing ? t('tc.testing', { n: bench?.run ?? 1 }) : t('tc.testPhone')} loading={testing} disabled={!!bench && !testing} onPress={() => { setResults(({ [id]: _drop, ...rest }) => { void _drop; return rest; }); setBench({ id, run: 0 }); }} />
          {r ? (
            <View testID={`avail-result-${id}`} className="flex-row items-center gap-2 flex-1">
              <View style={{ backgroundColor: verdictColor(r.verdict), borderRadius: 999, paddingHorizontal: 10, height: 24, justifyContent: 'center' }}>
                <Txt className="text-[12px] font-extrabold" style={{ color: '#fff' }}>{t(`tc.verdict.${r.verdict}`)}</Txt>
              </View>
              <Txt className="text-muted text-[12px] flex-1">{t('tc.testResult', { avg: r.avgMs.toFixed(1), dropped: r.dropped, frames: r.frames })}</Txt>
            </View>
          ) : null}
        </View>
        {testing ? <View className="mt-2"><BenchStage key={`${id}-${bench?.run === 0 ? 'a' : 'b'}`} effect={id} images={images} onProgress={onProgress} onDone={onBenchDone} /></View> : null}
      </View>
    );
  };

  return (
    <Modal visible transparent animationType={tablet ? 'fade' : 'slide'} onRequestClose={cancel} statusBarTranslucent>
      <View style={[themeStyle, { flex: 1 }]}>
        <Pressable onPress={cancel} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: tablet ? 'center' : 'flex-end', alignItems: 'center' }}>
          <Pressable onPress={() => {}} testID="avail-modal" className={`bg-bg w-full overflow-hidden ${tablet ? 'rounded-2xl max-w-[720px]' : 'rounded-t-2xl'}`} style={{ height: screenH * (tablet ? 0.9 : 0.94), width: tablet ? '92%' : '100%' }}>
            <View className="px-3 pt-2 pb-2 border-b border-line">
              <View className="flex-row items-center gap-2 mb-1">
                <Txt className="text-[16px] font-extrabold flex-1" accessibilityRole="header" numberOfLines={1}>{t('tc.availTitle')}</Txt>
                <Txt testID="avail-count" className="text-muted text-[12px] font-bold">{t('tc.availCount', { on: enabledCount, total: 30 })}</Txt>
                <Pressable testID="avail-close" accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={cancel} hitSlop={8} className="w-8 h-8 rounded-full bg-surface2 items-center justify-center"><Icon name="close" size={18} /></Pressable>
              </View>
              <View className="flex-row items-center gap-2 flex-wrap mt-1">
                <Button testID="avail-safe" size="sm" variant="soft" title={t('tc.safeOnly')} onPress={safeOnly} />
                <Button testID="avail-all" size="sm" variant="soft" title={t('tc.enableAll')} onPress={enableAll} />
                <Button testID="avail-reset" size="sm" variant="soft" title={t('tc.resetDefaults')} onPress={reset} />
              </View>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              <Txt className="text-muted text-[12px] mb-2">{t('tc.availIntro')}</Txt>
              <View className="flex-row items-center gap-2 mb-3 flex-wrap">
                <Icon name={lowEnd ? 'speedometer-slow' : 'speedometer'} size={18} tone={lowEnd ? 'danger' : 'muted'} />
                <Txt testID="avail-device" className="text-[12px] flex-1">{lowEnd ? t('tc.devLow', { why: reason ? t(`tc.why.${reason}`) : '' }) : t('tc.devOk')}</Txt>
                {device.measured !== 'unknown' ? <Button testID="avail-reset-detection" size="sm" variant="soft" title={t('tc.resetDetection')} onPress={resetLowEnd} /> : null}
              </View>
              <Txt testID="avail-device-facts" className="text-muted text-[11px] mb-3">{factsText}{device.measured !== 'unknown' ? ` · ${t(`tc.measured.${device.measured}`)}` : ''}</Txt>
              <View className="rounded-xl px-3 py-2 mb-2 flex-row items-center gap-2" style={{ backgroundColor: colors.surface2 }}>
                <Txt className="w-6 text-muted text-[12px] font-bold">0</Txt>
                <Txt className="flex-1 text-[14px] font-semibold">{t('tc.fx.0')}</Txt>
                <Txt className="text-muted text-[12px]">{t('tc.alwaysOn')}</Txt>
              </View>
              {TIER_ORDER.map((tier) => (
                <View key={tier} testID={`avail-tier-${tier}`}>
                  <Txt className="font-extrabold text-[14px] mt-3 mb-2">{t(`tc.tier.${tier}`)}</Txt>
                  {[...TIERS[tier]].sort((a, b) => a - b).map(row)}
                </View>
              ))}
            </ScrollView>
            <View className="px-3 pt-2.5 pb-3 border-t border-line bg-bg">
              <Button testID="avail-done" title={t('common.done')} onPress={done} full />
            </View>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}
