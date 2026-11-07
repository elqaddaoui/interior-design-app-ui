import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Spinner';
import { Txt } from '@/components/ui/Txt';
import { api } from '@/lib/backend';
import { useL, useT } from '@/i18n';
import { sorted, useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import type { PromptPreview, PromptRules } from '@/data/types';
import { effectiveCase, isTool, type Scope, type TestCase } from '@/lib/promptCards';
import { Note } from './ui';

type Titled = { id: string; title: Parameters<ReturnType<typeof useL>>[0] };

/** One horizontal row of small choices (keeps the test panel short: nothing wraps over several lines). */
function PickRow({ label, value, options, onChange, testID }: { label: string; value: string; options: { key: string; label: string }[]; onChange: (v: string) => void; testID: string }) {
  return (
    <View className="mb-2.5">
      <Txt className="text-[12px] font-semibold text-muted mb-1">{label}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} testID={testID}>
        {options.map((o) => (
          <Pressable key={o.key || 'none'} testID={`${testID}-${o.key || 'none'}`} accessibilityRole="radio" accessibilityState={{ selected: value === o.key }} onPress={() => onChange(o.key)} className={`px-3 h-8 rounded-full items-center justify-center border ${value === o.key ? 'bg-ink border-ink' : 'bg-surface border-line'}`}>
            <Txt className={`text-[12.5px] font-bold ${value === o.key ? 'text-onink' : ''}`} numberOfLines={1}>{o.label}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}


/** Minimal palette row: a thin colour strip and the name; nothing selected = no colours in the prompt. */
function PaletteRow({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useT();
  const L = useL();
  const palettes = sorted(useStore((x) => x.palettes)).filter((p) => p.visible);
  return (
    <View className="mb-2.5">
      <Txt className="text-[12px] font-semibold text-muted mb-1">{t('pc.prevPalette')}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} testID="pc-prev-palette">
        <Pressable testID="pc-prev-pal-none" accessibilityRole="radio" accessibilityState={{ selected: value === '' }} onPress={() => onChange('')} className={`rounded-xl border-2 px-3 items-center justify-center ${value === '' ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ height: 42 }}><Txt className="text-[12px] font-bold">{t('pc.prevNone')}</Txt></Pressable>
        {palettes.map((p) => (
          <Pressable key={p.id} testID={`pc-prev-pal-${p.id}`} accessibilityRole="radio" accessibilityState={{ selected: value === p.id }} onPress={() => onChange(p.id)} className={`rounded-xl border-2 p-1.5 ${value === p.id ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ width: 92 }}>
            {p.isSurprise ? <View className="items-center justify-center" style={{ height: 12 }}><Icon name="auto-fix" size={12} /></View> : <View className="flex-row rounded-full overflow-hidden" style={{ height: 12 }}>{p.colors.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}</View>}
            <Txt className="text-[11px] font-semibold mt-1 text-center" numberOfLines={1}>{L(p.title)}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PicRow({ label, sent, why, uri, testID }: { label: string; sent: boolean; why?: string; uri?: string; testID?: string }) {
  const { t } = useT();
  return (
    <View testID={testID} className="flex-row items-center gap-3 mb-2">
      <View className={`w-12 h-12 rounded-lg bg-surface2 overflow-hidden items-center justify-center ${sent ? '' : 'opacity-60'}`}>{uri ? <Image source={{ uri }} style={{ width: 48, height: 48 }} contentFit="cover" /> : <Icon name={sent ? 'image-outline' : 'image-off-outline'} size={20} tone="muted" />}</View>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt className="text-[13px] font-bold" numberOfLines={2}>{label}</Txt>
        <Txt className={`text-[12px] ${sent ? 'text-success' : 'text-muted'}`}>{t(sent ? 'pc.prevSent' : 'pc.prevNotSent')}{why ? ` · ${t(`pc.why.${why}`)}` : ''}</Txt>
      </View>
    </View>
  );
}

/**
 * The fake generation, always on. Whatever the admin edits (even unsaved) is sent to the server's preview, which plans a real run
 * without calling any image engine and without a credit, and the answer is shown here as the prompt the model would read, split into
 * its steps. Touching a passage opens the step that wrote it.
 */
export function LivePreview({ rules, scope, tc, onCase, highlight, onPickStep, active }: {
  rules: PromptRules; scope: Scope; tc: TestCase; onCase: (c: TestCase) => void;
  highlight: string[]; onPickStep: (id: string) => void;
  /** Reports the steps of the current prompt (the Steps tab marks them). */
  active: (used: string[] | undefined) => void;
}) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const [res, setRes] = useState<PromptPreview | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const first = useRef(true);

  const modeChoice = s.doc.settings.modeChoice !== false;
  const eff = useMemo(() => effectiveCase(tc, scope, s.tools, s.roomTypes, s.inspirations), [tc, scope, s.tools, s.roomTypes, s.inspirations]);
  const group = s.tools.find((x) => x.id === eff.toolId)?.roomGroup;
  const rooms = s.roomTypes.filter((r) => !group || r.group === group);

  useEffect(() => {
    if (!eff.toolId) { setBusy(false); return; }
    const mine = ++seq.current;
    setBusy(true);
    const id = setTimeout(async () => {
      try {
        const out = await api<PromptPreview>('/admin/prompt-rules/preview', { method: 'POST', body: { toolId: eff.toolId, styleId: eff.styleId || undefined, roomTypeId: eff.roomId || undefined, inspirationId: eff.insId || undefined, paletteId: eff.paletteId || undefined, mode: modeChoice ? eff.mode : 'restyle', prompt: eff.brief || undefined, rules } });
        if (seq.current !== mine) return;
        setRes(out); setErr(false); active(out.blocks.map((b) => b.id));
      } catch { if (seq.current === mine) setErr(true); }
      if (seq.current === mine) setBusy(false);
    }, first.current ? 0 : 450);
    first.current = false;
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, eff, modeChoice]);

  const copy = async () => {
    try { await (globalThis as { navigator?: { clipboard?: { writeText(v: string): Promise<void> } } }).navigator?.clipboard?.writeText(res?.prompt || ''); toast(t('pc.prevCopied')); } catch { /* the text stays selectable */ }
  };
  const name = (list: Titled[], id: string) => (id ? L(list.find((x) => x.id === id)?.title) : '');
  const opts = (list: Titled[]) => [{ key: '', label: t('pc.prevNone') }, ...list.map((x) => ({ key: x.id, label: L(x.title) }))];
  const summary = [isTool(scope) ? '' : name(s.tools, eff.toolId), name(s.styles, eff.styleId), name(s.roomTypes, eff.roomId), eff.paletteId ? name(s.palettes, eff.paletteId) : '', modeChoice ? t(`pc.variants.${eff.mode}`) : ''].filter(Boolean).join(' · ') || t('pc.prevNone');
  const set = (patch: Partial<TestCase>) => onCase({ ...tc, ...patch });

  return (
    <Card className="p-3" testID="pc-preview">
      <View className="flex-row items-center gap-2">
        <Icon name="eye-outline" size={20} tone="primary" />
        <Txt className="text-[15px] font-extrabold flex-1">{t('pc.prevTitle')}</Txt>
        <View testID="pc-prev-status" className="flex-row items-center gap-1.5 px-2.5 h-6 rounded-full bg-surface2">
          {busy ? <Spinner size={12} /> : <View className={`w-2 h-2 rounded-full ${err ? 'bg-danger' : 'bg-success'}`} />}
          <Txt className="text-[11px] font-bold">{t(busy ? 'pc.prevUpdating' : err ? 'pc.prevFail' : 'pc.prevLiveNow')}</Txt>
        </View>
      </View>

      <Pressable testID="pc-prev-try" accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} className="flex-row items-center gap-2 bg-surface2 rounded-xl px-3 py-2 mt-3">
        <Icon name="tune-variant" size={17} tone="muted" />
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Txt className="text-[11px] font-bold text-muted">{t('pc.prevTry')}</Txt>
          <Txt testID="pc-prev-summary" className="text-[13px] font-bold" numberOfLines={1}>{summary}</Txt>
        </View>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={20} tone="muted" />
      </Pressable>

      {open ? (
        <View className="mt-3">
          {!isTool(scope) ? <PickRow testID="pc-prev-tool" label={t('pc.prevTool')} value={eff.toolId} onChange={(v) => set({ toolId: v })} options={s.tools.map((x) => ({ key: x.id, label: L(x.title) }))} /> : null}
          <PickRow testID="pc-prev-style" label={t('pc.prevStyle')} value={eff.styleId} onChange={(v) => set({ styleId: v })} options={opts(s.styles)} />
          <PickRow testID="pc-prev-room" label={t('pc.prevRoom')} value={eff.roomId} onChange={(v) => set({ roomId: v })} options={opts(rooms)} />
          <PaletteRow value={eff.paletteId} onChange={(v) => set({ paletteId: v })} />
          <Txt className="text-[12px] font-semibold text-muted mb-1">{t('pc.prevExplore')}</Txt>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2.5" contentContainerStyle={{ gap: 6 }}>
            <Pressable testID="pc-prev-ins-none" accessibilityRole="radio" accessibilityState={{ selected: eff.insId === '' }} onPress={() => set({ insId: '' })} className={`w-14 h-14 rounded-xl items-center justify-center border-2 ${eff.insId === '' ? 'border-primary bg-surface2' : 'border-line'}`}><Txt className="text-[11px] font-bold text-center">{t('pc.prevNone')}</Txt></Pressable>
            {s.inspirations.slice(0, 40).map((x) => (
              <Pressable key={x.id} testID={`pc-prev-ins-${x.id}`} accessibilityRole="radio" accessibilityState={{ selected: eff.insId === x.id }} onPress={() => set({ insId: x.id })} className={`rounded-xl overflow-hidden border-2 ${eff.insId === x.id ? 'border-primary' : 'border-transparent'}`}><Image source={{ uri: x.image }} style={{ width: 52, height: 52 }} contentFit="cover" /></Pressable>
            ))}
          </ScrollView>
          {modeChoice ? <View className="mb-2.5"><Txt className="text-[12px] font-semibold text-muted mb-1">{t('pc.prevMode')}</Txt><Segmented compact testID="pc-prev-mode" value={eff.mode} onChange={(v) => set({ mode: v })} options={[{ key: 'restyle', label: t('pc.variants.restyle') }, { key: 'renovation', label: t('pc.variants.renovation') }]} /></View> : null}
          <Input tight testID="pc-prev-brief" label={t('pc.prevBrief')} value={eff.brief} onChangeText={(v) => set({ brief: v })} placeholder={t('pc.prevBriefPh')} maxLength={500} />
        </View>
      ) : null}

      {err && !res ? <Txt testID="pc-prev-error" className="text-danger text-[13px] mt-3">{t('pc.prevFail')}</Txt> : null}
      {!res && busy ? <View className="items-center py-8"><Spinner size={22} /></View> : null}

      {res ? (
        <View className={`mt-4 ${busy ? 'opacity-70' : ''}`} testID="pc-prev-result">
          {res.appliesTo === 'explore' && !res.explore ? <Note tone="info" text={t('pc.prevLimited')} /> : null}
          {!res.model.live ? <Note tone="info" text={t('pc.prevNoKey')} /> : null}
          {res.warnings.map((w) => <Note key={w.code} tone="warn" testID={`pc-warn-${w.code}`} text={t(`pc.warn.${w.code}`, { items: (w.items ?? []).join(', ') })} />)}

          <View className="flex-row items-center gap-2 mb-1">
            <Txt className="text-[14px] font-extrabold flex-1">{t('pc.prevFinal')}</Txt>
            <Txt testID="pc-prev-chars" className="text-[12px] text-muted">{t('pc.prevChars', { n: res.chars })}</Txt>
            {Platform.OS === 'web' ? <Pressable testID="pc-prev-copy" accessibilityRole="button" onPress={copy} hitSlop={8} className="flex-row items-center gap-1 px-2.5 h-8 rounded-full bg-surface2"><Icon name="content-copy" size={14} /><Txt className="text-[12px] font-semibold">{t('pc.prevCopy')}</Txt></Pressable> : null}
          </View>
          <Txt className="text-[12px] text-muted mb-2">{t('pc.prevTouch')}</Txt>
          <View testID="pc-prev-prompt" style={{ gap: 6 }}>
            {res.blocks.map((b) => {
              const lit = highlight.includes(b.id);
              return (
                <Pressable key={b.id} testID={`pc-seg-${b.id}`} accessibilityRole="button" accessibilityLabel={t(`pc.blockNames.${b.id}`)} onPress={() => onPickStep(b.id)} className={`rounded-xl px-3 py-2 border-s-4 ${lit ? 'bg-soft' : 'bg-surface2'} ${b.custom ? 'border-primary' : lit ? 'border-primary' : 'border-line'}`}>
                  <View className="flex-row items-center gap-1.5 mb-0.5">
                    <Txt className="text-[11px] font-extrabold text-muted" numberOfLines={1} style={{ flexShrink: 1 }}>{t(`pc.blockNames.${b.id}`)}</Txt>
                    {b.custom ? <Txt className="text-[10px] font-extrabold text-primary">· {t('pc.stepEdited')}</Txt> : null}
                  </View>
                  <Txt selectable className="text-[13px] leading-[19px]">{b.text}</Txt>
                </Pressable>
              );
            })}
          </View>

          <Txt className="text-[14px] font-extrabold mt-4 mb-1.5">{t('pc.prevPictures')}</Txt>
          <PicRow testID="pc-pic-photo" label={t('pc.prevPhotoRole')} sent />
          {res.images.map((im) => <PicRow key={im.role} testID={`pc-pic-${im.role}`} uri={im.uri} label={`${t(`pc.role.${im.role}`)}${im.mode ? ` · ${t(`pc.mode.${im.mode}`)}` : ''}`} sent={im.sent} why={im.why} />)}
          {!res.images.length ? <Txt className="text-[12px] text-muted">{t('pc.prevNoPictures')}</Txt> : null}

          {(res.applied?.colors?.length || res.applied?.colorSource === 'surprise') ? (
            <View testID="pc-prev-colors" className="mt-3">
              {res.applied?.colors?.length ? <View className="flex-row rounded-full overflow-hidden mb-1.5" style={{ height: 8 }}>{res.applied.colors.map((c) => <View key={c.hex} style={{ flex: 1, backgroundColor: c.hex }} />)}</View> : null}
              <View className="flex-row flex-wrap gap-1.5">
                {(res.applied?.colors ?? []).map((c) => <View key={c.hex} className="flex-row items-center gap-1.5 pe-2.5 ps-1.5 h-7 rounded-full bg-surface2"><View className="border border-line" style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.hex }} /><Txt className="text-[12px] font-semibold" style={{ writingDirection: 'ltr' }}>{c.hex}</Txt></View>)}
                {!res.applied?.colors?.length ? <View className="flex-row items-center gap-1.5 px-2.5 h-7 rounded-full bg-surface2"><Icon name="auto-fix" size={14} /><Txt className="text-[12px] font-semibold">{t('pc.prevSurprise')}</Txt></View> : null}
              </View>
            </View>
          ) : null}
          <View className="flex-row flex-wrap gap-1.5 mt-3">
            <View className="flex-row items-center gap-1 px-2.5 h-7 rounded-full bg-surface2"><Icon name="cog-outline" size={13} tone="muted" /><Txt testID="pc-prev-model" className="text-[12px] font-semibold">{res.model.label || res.model.model}</Txt></View>
            <View className="flex-row items-center gap-1 px-2.5 h-7 rounded-full bg-surface2"><Icon name="arrow-expand" size={13} tone="muted" /><Txt testID="pc-prev-size" className="text-[12px] font-semibold">{res.size}</Txt></View>
          </View>
          {isTool(scope) ? (
            <View className="flex-row mt-2" testID="pc-prev-origin"><View className="flex-row items-center gap-1 px-2 h-6 rounded-full border border-line"><Icon name={res.scope.blocks === 'tool' ? 'circle-edit-outline' : 'link-variant'} size={12} tone={res.scope.blocks === 'tool' ? 'primary' : 'muted'} /><Txt className="text-[11px] font-semibold">{t('pc.tabSteps')} · {t(res.scope.blocks === 'tool' ? 'pc.prevFromTool' : 'pc.prevFromGlobal')}</Txt></View></View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
