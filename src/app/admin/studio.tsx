import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { StudioPanel, TABS, applyPatch, type StudioTab } from '@/components/admin/studio/StudioPanel';
import { StudioStage } from '@/components/admin/studio/StudioStage';
import { Chips, Sw } from '@/components/admin/studio/ui';
import { SAMPLES } from '@/components/admin/studio/samples';
import { useT, useL } from '@/i18n';
import { useBp } from '@/hooks/useBp';
import { HistoryButtons } from '@/components/admin/HistoryButtons';
import { adminHistory, useAdminHistory } from '@/store/adminHistory';
import { useCollectionDraft, useDraftDoc } from '@/hooks/useDraftDoc';
import { useTheme } from '@/theme/ThemeProvider';
import { FX_FADE } from '@/lib/toolCardFx';
import { DEFAULT_STUDIO, accentOf, activeStudio, cleanSavedPresets, cleanStudio, cloneStudio, isDefaultStudio, makeSavedPreset, type StudioStyle } from '@/lib/fxStudio';
import { deviceFacts, resetLowEnd, useDeviceClass } from '@/lib/toolCardPerf';
import { usePrefs } from '@/store/usePrefs';
import { cardEffectList, cleanFx, availFromKey, availKey, mediaFx, patchGlobal, resolveGlobal, slideshowImages } from '@/lib/toolCards';
import { toast } from '@/store/useToast';
import { useStore } from '@/store/useStore';
import type { Tool } from '@/data/types';

const GLOBAL = '__global';
/** Clock for saved looks (module level: an event-handler-only call, never part of rendering). */
const nowMs = () => Date.now();

/**
 * Admin > Animation Studio: a live editor for the tools-card transitions (Elementor style: every control writes straight into the draft, the stage
 * above replays the REAL engine with the new style at once). One style for every card (`settings.toolCards.studio`) or a style of its own for one
 * card (`tool.media.fx.studio`). Nothing is stored until Submit (the AdminShell leave guard protects an unsaved draft).
 */
export default function StudioAdmin() {
  const contentReady = useStore((s) => s.contentReady);
  const { t, rtl: appRtl } = useT();
  if (!contentReady) return <AdminPage title={t('st.title')}><AdminLoading /></AdminPage>;
  return <Studio appRtl={appRtl} />;
}

function Studio({ appRtl }: { appRtl: boolean }) {
  const { t } = useT();
  const L = useL();
  const { colors } = useTheme();
  const { desktop } = useBp();
  const settings = useDraftDoc('settings');
  const tools = useCollectionDraft('tools');
  const allTools = useStore((s) => s.tools);
  const cards = useMemo(() => allTools.filter((x) => x.media?.type === 'slideshow'), [allTools]);
  const [scope, setScope] = useState<string>(GLOBAL);
  const [tab, setTab] = useState<StudioTab>('main');
  const [rtl, setRtl] = useState(appRtl);
  const [lowEnd, setLowEnd] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  // The transition shown on the stage, remembered per scope (no effect needed: derived while rendering).
  const [picked, setPicked] = useState<Record<string, number>>({});

  const global = resolveGlobal(settings.draft.toolCards);
  const device = useDeviceClass();
  const facts = deviceFacts();
  const factsText = [facts.platform, facts.memoryGB != null ? `${facts.memoryGB} GB` : null, facts.cores != null ? `${facts.cores} cores` : null, facts.api != null ? `API ${facts.api}` : null].filter(Boolean).join(' · ');
  // The admin's own saved looks live in the admin's preferences (private to the admin, follow them to every device), not in the public settings.
  const adminPrefs = usePrefs((s) => s.admin);
  const savedRaw = adminPrefs?.studioPresets;
  const saved = useMemo(() => cleanSavedPresets(savedRaw), [savedRaw]);
  const card: Tool | undefined = scope === GLOBAL ? undefined : cards.find((x) => x.id === scope);
  const fx = card ? mediaFx(card.media) : null;
  const ownStyle = fx?.studio;                       // the card's own style (undefined = it uses the global one)
  const globalFull = useMemo(() => cleanStudio(settings.draft.toolCards?.studio), [settings.draft.toolCards?.studio]);
  const editing: StudioStyle | null = scope === GLOBAL ? globalFull : ownStyle ?? null;
  const shown = scope === GLOBAL ? activeStudio(globalFull) : ownStyle !== undefined ? activeStudio(ownStyle) : activeStudio(globalFull);

  // The effect shown on the stage: the forced one, else the one picked for this scope, else the card's first effect (or the first transition).
  const avail = useMemo(() => availFromKey(availKey(settings.draft.toolCards)), [settings.draft.toolCards]);
  const firstOf = fx ? cardEffectList(fx, avail, false, null)[0] ?? FX_FADE : 1;
  const effect = shown && shown.force > 0 ? shown.force : picked[scope] ?? firstOf;
  const setEffect = (id: number) => setPicked((old) => ({ ...old, [scope]: id }));

  /* ------------------------------ writing + history ------------------------------ */
  // Undo / redo is the admin's global history (the same steps as the back / forward icons of the draft bar and Ctrl+Z / Ctrl+Y): every tweak
  // writes into the draft, consecutive tweaks within 700 ms (a slider drag) are one step, a whole look (preset, import, reset) is always its own step.
  const hist = useAdminHistory();

  const write = (next: StudioStyle) => {
    const clean = cleanStudio(next);
    if (scope === GLOBAL) {
      settings.set((old) => ({ ...old, toolCards: patchGlobal(old.toolCards, { studio: isDefaultStudio(clean) ? undefined : clean }) }));
    } else if (card) {
      tools.update(card.id, { media: { ...card.media, fx: cleanFx({ ...(card.media.fx ?? {}), studio: clean }) } });
    }
  };
  const change = (patch: Record<string, unknown>) => { if (editing) write(applyPatch(editing, patch)); };
  const replace = (s: StudioStyle) => { adminHistory.breakGroup(); write(s); adminHistory.breakGroup(); };
  const undo = hist.undo;
  const redo = hist.redo;

  const savePreset = (name: string) => {
    if (!editing || !name.trim()) return;
    const made = makeSavedPreset(name, effect, editing, nowMs(), Math.random());
    void usePrefs.getState().save('admin', { studioPresets: [made, ...saved].slice(0, 60) });
    toast(t('st.savedOk'));
  };
  const deleteSaved = (id: string) => { void usePrefs.getState().save('admin', { studioPresets: saved.filter((x) => x.id !== id) }); };

  /* ------------------------------ save ------------------------------ */
  const dirty = settings.dirty || tools.dirty;
  const save = async () => {
    const a = settings.dirty ? await settings.save() : true;
    const b = tools.dirty ? await tools.save() : true;
    if (a && b) toast(t('admin.crud.saved'));
  };
  const discard = () => { settings.discard(); tools.discard(); };

  /* ------------------------------ stage inputs ------------------------------ */
  const own = card ? slideshowImages(card.media) : [];
  const images: [string, string] = own.length >= 2 ? [own[0], own[1]] : SAMPLES;
  const stageH = desktop ? Math.min(260, Math.max(160, global.height)) : Math.min(190, Math.max(130, global.height));
  const accent = accentOf(shown, colors.primary);

  const stage = (
    <View testID="studio-stage-box" style={desktop ? ({ position: 'sticky', top: 8 } as object) : ({ paddingBottom: 6 } as object)}>
      <View className="flex-row items-center mb-2" style={{ gap: 8 }}>
        <View className="w-2 h-2 rounded-full bg-primary" />
        <Txt className="text-[13px] font-extrabold flex-1">{t('mx.sx.stage')}</Txt>
        {shown && shown.force > 0 ? null : <Txt className="text-muted text-[11.5px]">{t('st.tab.main')}</Txt>}
      </View>
      <StudioStage key={scope} style={shown} effect={effect} rtl={rtl} speed={fx?.speed ?? 1} lowEnd={lowEnd} images={images} height={stageH} accent={accent} />
      <View className="flex-row flex-wrap items-center mt-3" style={{ gap: 14 }}>
        <View className="flex-row items-center" style={{ gap: 8 }}><Toggle testID="st-rtl" label={t('st.rtl')} value={rtl} onValueChange={setRtl} /><Txt className="text-[13px] font-semibold">{t('st.rtl')}</Txt></View>
        <View className="flex-row items-center" style={{ gap: 8 }}><Toggle testID="st-lowend" label={t('st.lowEnd')} value={lowEnd} onValueChange={setLowEnd} /><Txt className="text-[13px] font-semibold">{t('st.lowEnd')}</Txt></View>
      </View>
      {lowEnd ? <Txt className="text-muted text-[12px] mt-1">{t('st.lowEndNote')}</Txt> : null}
    </View>
  );

  const right = (
    <View className="flex-row items-center" style={{ gap: 8 }}>
      <HistoryButtons prefix="studio" />
      {dirty ? <Button testID="studio-discard" size="sm" variant="soft" title={t('improve.discard')} onPress={discard} /> : null}
      <Button testID="studio-submit" size="sm" title={t('improve.submit')} disabled={!dirty} onPress={save} />
    </View>
  );

  return (
    <AdminPage title={t('st.title')} right={right} max={1280}>
      <Txt className="text-muted text-[12px] mb-3">{t('st.note')}</Txt>

      <View className="mb-3" style={{ gap: 6 }}>
        <Txt className="text-[13px] font-semibold text-muted">{t('st.scopeTitle')}</Txt>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          <Chips testID="st-scope" value={scope} options={[{ key: GLOBAL, label: t('st.scopeGlobal') }, ...cards.map((c) => ({ key: c.id, label: `${L(c.title) || c.id}${mediaFx(c.media).studio ? '  ●' : ''}` }))]} onChange={setScope} />
        </ScrollView>
        {cards.length === 0 ? <Txt className="text-muted text-[12px]">{t('st.noCards')}</Txt> : null}
      </View>

      <View style={{ flexDirection: desktop ? 'row' : 'column', gap: desktop ? 16 : 10, alignItems: 'flex-start' }}>
        {/* The stage stays in view while the controls scroll. Desktop: this column stretches over the whole row so the sticky box has room to travel.
            Phone: the column itself sticks to the top of the scroll area (opaque, above the controls). */}
        <View testID="studio-stage-col" style={desktop ? { width: 520, maxWidth: '100%', alignSelf: 'stretch' } : ({ width: '100%', position: 'sticky', top: 0, zIndex: 20, backgroundColor: colors.bg } as object)}>{stage}</View>
        <View style={{ flex: desktop ? 1 : undefined, width: desktop ? undefined : '100%', minWidth: 0 }}>
          <View className="bg-surface rounded-2xl border border-line mb-3 overflow-hidden">
            <Pressable testID="st-device-toggle" accessibilityRole="button" accessibilityState={{ expanded: devOpen }} onPress={() => setDevOpen((v) => !v)} className="flex-row items-center px-3 active:opacity-70" style={{ gap: 10, minHeight: 52 }}>
              <Icon name={device.low ? 'speedometer-slow' : 'speedometer'} size={20} tone={device.low ? 'danger' : 'muted'} />
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Txt className="text-[14px] font-extrabold" numberOfLines={1}>{t('mx.sx.device')}</Txt>
                <Txt className="text-muted text-[11.5px]" numberOfLines={1}>{`${global.instantFirst ? t('st.instant') : t('mx.sx.deviceHint')} · ${device.low ? t('tc.devLow', { why: device.reason ? t(`tc.why.${device.reason}`) : '' }) : t('tc.devOk')}`}</Txt>
              </View>
              <Icon name={devOpen ? 'chevron-up' : 'chevron-down'} size={20} tone="muted" />
            </Pressable>
            {devOpen ? (
              <View className="px-3 pb-3" style={{ gap: 10 }}>
                <Sw testID="st-instant" label={t('st.instant')} value={global.instantFirst} onChange={(v) => settings.set((old) => ({ ...old, toolCards: patchGlobal(old.toolCards, { instantFirst: v ? undefined : false }) }))} />
                <Txt className="text-muted text-[12px] -mt-1">{t('st.instantNote')}</Txt>
                <View className="flex-row items-center flex-wrap" style={{ gap: 8 }}>
                  <Txt testID="st-device" className="text-[12px] flex-1" style={{ minWidth: 160 }}>{device.low ? t('tc.devLow', { why: device.reason ? t(`tc.why.${device.reason}`) : '' }) : t('tc.devOk')}</Txt>
                  <Button testID="st-reset-detection" size="sm" variant="soft" icon="restore" title={t('tc.resetDetection')} onPress={resetLowEnd} />
                </View>
                <Txt testID="st-device-facts" className="text-muted text-[11px]">{factsText}{device.measured !== 'unknown' ? ` · ${t(`tc.measured.${device.measured}`)}` : ''}</Txt>
              </View>
            ) : null}
          </View>
          {scope !== GLOBAL && editing === null ? (
            <View className="bg-surface rounded-2xl border border-line p-3" style={{ gap: 10 }}>
              <Txt className="text-muted text-[13px]">{t('st.ownNote')}</Txt>
              <Button testID="st-own-on" size="sm" icon="brush-variant" title={t('st.ownOn')} onPress={() => { if (card) write(cloneStudio(globalFull ?? DEFAULT_STUDIO)); }} />
            </View>
          ) : editing ? (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
                {TABS.map((x) => {
                  const on = x.key === tab;
                  return (
                    <Pressable key={x.key} testID={`st-tab-${x.key}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setTab(x.key)}
                      className={`flex-row items-center h-10 px-4 rounded-full ${on ? 'bg-ink' : 'bg-surface2'}`} style={{ gap: 6 }}>
                      <Icon name={x.icon} size={18} tone={on ? 'onink' : 'fg'} />
                      <Txt className={`text-[13px] font-bold ${on ? 'text-onink' : ''}`}>{t(`st.tab.${x.key}`)}</Txt>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <StudioPanel tab={tab} style={editing} effect={effect} onEffect={setEffect} onChange={change} onReplace={replace} accent={accent}
                history={{ canUndo: hist.canUndo, canRedo: hist.canRedo }} onUndo={undo} onRedo={redo}
                saved={saved} onSave={savePreset} onDeleteSaved={deleteSaved} />
              {scope !== GLOBAL ? <Button testID="st-own-off" size="sm" variant="outline" icon="restore" title={t('st.ownOff')} onPress={() => { if (card) tools.update(card.id, { media: { ...card.media, fx: cleanFx({ ...(card.media.fx ?? {}), studio: undefined }) } }); }} /> : null}
            </>
          ) : null}
        </View>
      </View>
    </AdminPage>
  );
}
