import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Spinner } from '@/components/ui/Spinner';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { AdminPage } from '@/components/admin/AdminShell';
import { AdminLoading } from '@/components/admin/AdminLoading';
import { api, backendEnabled } from '@/lib/backend';
import { useBp } from '@/hooks/useBp';
import { router, useBackCheckpoint, useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useL, useT } from '@/i18n';
import { sorted, useStore } from '@/store/useStore';
import { toast } from '@/store/useToast';
import type { PromptPicture, PromptPreview, PromptRules, PromptRulesInfo, PromptSet } from '@/data/types';

/** 'all' = every tool, EXPLORE = the Explorer tab (its own settings), anything else = one tool id. */
type Scope = string;
const EXPLORE = '@explore';
/** Blocks that follow the global picture settings: never edited per tool. */
const PICTURE_BLOCKS = ['reference', 'styleImage', 'roomImage'];
/** Picture blocks that only exist when their picture is sent as image / both (the setting they follow). */
const AUTO_ROLE: Record<string, 'style' | 'room'> = { styleImage: 'style', roomImage: 'room' };
/** Same rule as the server (`blockOn` in server/imagegen/blocks.js): an explicit switch wins, otherwise automatic blocks follow their picture setting. */
const blockOn = (id: string, item: { on?: boolean } | undefined, images: PromptSet['images']) => (typeof item?.on === 'boolean' ? item.on : AUTO_ROLE[id] ? images[AUTO_ROLE[id]] !== 'text' : true);
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const area = { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 } as const;

/** A card for one section; for a tool it offers "customise for this tool" (otherwise the tool follows All tools). */
function Panel({ id, title, hint, custom, onCustom, children }: { id: string; title: string; hint?: string; custom?: boolean; onCustom?: (on: boolean) => void; children: React.ReactNode }) {
  const { t } = useT();
  const open = !onCustom || custom;
  return (
    <Card className="p-3 mt-3" testID={`pc-${id}`}>
      <View className="flex-row items-center gap-2">
        <Txt className="text-[15px] font-extrabold flex-1">{title}</Txt>
        {onCustom ? <View className={`px-2.5 h-6 rounded-full items-center justify-center ${custom ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[11px] font-bold ${custom ? 'text-onprimary' : 'text-muted'}`}>{t(custom ? 'pc.customBadge' : 'pc.sameBadge')}</Txt></View> : null}
      </View>
      {hint ? <Txt className="text-[12px] text-muted mt-0.5">{hint}</Txt> : null}
      {onCustom ? (
        <View className="flex-row items-center justify-between mt-3">
          <Txt className="flex-1 font-semibold me-3">{t('pc.custom')}</Txt>
          <Toggle testID={`pc-${id}-custom`} value={!!custom} onValueChange={onCustom} label={t('pc.custom')} />
        </View>
      ) : null}
      {onCustom && !custom ? <Txt className="text-[12px] text-muted mt-2">{t('pc.sameHint')}</Txt> : null}
      {open ? <View className="mt-3">{children}</View> : null}
    </Card>
  );
}

function Chips<T extends string>({ value, options, onChange, testID }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; testID?: string }) {
  return (
    <View className="flex-row flex-wrap gap-2" testID={testID}>
      {options.map((o) => (
        <Pressable key={o.key} testID={testID ? `${testID}-${o.key || 'none'}` : undefined} accessibilityRole="radio" accessibilityState={{ selected: value === o.key }} onPress={() => onChange(o.key)} className={`px-3.5 h-9 rounded-full items-center justify-center border ${value === o.key ? 'bg-ink border-ink' : 'bg-surface border-line'}`}>
          <Txt className={`text-[13px] font-bold ${value === o.key ? 'text-onink' : ''}`} numberOfLines={1}>{o.label}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

function RulesEditor({ value, onChange }: { value: PromptSet['rules']; onChange: (v: PromptSet['rules']) => void }) {
  const { t } = useT();
  return <Input testID="pc-rules-text" label={t('pc.rulesText')} value={value.text} onChangeText={(v) => onChange({ ...value, text: v })} multiline placeholder={t('pc.rulesPlaceholder')} style={area} maxLength={2000} />;
}

function ImagesEditor({ value, onChange }: { value: PromptSet['images']; onChange: (v: PromptSet['images']) => void }) {
  const { t } = useT();
  const pics: { key: PromptPicture; label: string }[] = [{ key: 'text', label: t('pc.picText') }, { key: 'image', label: t('pc.picImage') }, { key: 'both', label: t('pc.picBoth') }];
  return (<>
    {(['room', 'style'] as const).map((k) => (
      <View key={k} className={k === 'room' ? 'mb-3' : ''}>
        <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t(k === 'room' ? 'pc.imgRoom' : 'pc.imgStyle')}</Txt>
        <Segmented testID={`pc-img-${k}`} value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} options={pics} />
      </View>
    ))}
  </>);
}

function BlocksEditor({ value, onChange, info, images, show, order = true }: { value: PromptSet['blocks']; onChange: (v: PromptSet['blocks']) => void; info: PromptRulesInfo; images: PromptSet['images']; show: (id: string) => boolean; order?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ id: string; v: string } | null>(null);
  const defaults = info.catalog.blocks;
  // A picture block only exists when its picture is sent; its text field is the one of the chosen type only (Image or Both).
  const visible = value.order.filter((id) => show(id) && (!AUTO_ROLE[id] || images[AUTO_ROLE[id]] !== 'text'));
  const variantsOf = (id: string) => Object.keys(defaults[id] ?? {}).filter((v) => !AUTO_ROLE[id] || v === images[AUTO_ROLE[id]]);
  const patch = (id: string, fn: (item: { on?: boolean; texts?: Record<string, string> }) => void) => {
    const next = clone(value); const item = next.items[id] ?? {}; fn(item); next.items[id] = item; onChange(next);
  };
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= visible.length) return;
    const all = [...value.order]; const x = all.indexOf(visible[i]); const y = all.indexOf(visible[j]);
    [all[x], all[y]] = [all[y], all[x]]; onChange({ ...value, order: all });
  };
  const insert = (name: string) => {
    if (!focus) return;
    patch(focus.id, (item) => { const cur = item.texts?.[focus.v] ?? defaults[focus.id][focus.v]; item.texts = { ...item.texts, [focus.v]: `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}{${name}}` }; });
  };
  return (<>
    {visible.map((id, i) => {
      const item = value.items[id];
      const off = !blockOn(id, item, images);
      const custom = !!item?.texts && Object.entries(item.texts).some(([k, v]) => v && v !== defaults[id]?.[k]);
      return (
        <View key={id} testID={`pc-block-${id}`} className="border border-line rounded-xl mb-2 overflow-hidden">
          <View className="flex-row items-center gap-1.5 px-2.5 py-2">
            <View className="flex-1">
              <Txt className={`font-bold text-[14px] ${off ? 'text-muted' : ''}`} numberOfLines={2}>{t(`pc.blockNames.${id}`)}</Txt>
              {custom ? <Txt className="text-[11px] text-primary font-bold">{t('pc.blockCustom')}</Txt> : null}
            </View>
            {order && visible.length > 1 ? (<>
              <Pressable testID={`pc-block-${id}-up`} accessibilityLabel={t('pc.blockUp')} disabled={i === 0} onPress={() => move(i, -1)} hitSlop={6} className={i === 0 ? 'opacity-30' : ''}><Icon name="chevron-up" size={20} /></Pressable>
              <Pressable testID={`pc-block-${id}-down`} accessibilityLabel={t('pc.blockDown')} disabled={i === visible.length - 1} onPress={() => move(i, 1)} hitSlop={6} className={i === visible.length - 1 ? 'opacity-30' : ''}><Icon name="chevron-down" size={20} /></Pressable>
            </>) : null}
            <Pressable testID={`pc-block-${id}-edit`} accessibilityLabel={t('pc.blockEdit')} onPress={() => setOpen(open === id ? null : id)} hitSlop={6}><Icon name={open === id ? 'close' : 'pencil-outline'} size={19} tone="primary" /></Pressable>
            <Toggle testID={`pc-block-${id}-on`} value={!off} onValueChange={(v) => patch(id, (it) => { if (v === blockOn(id, undefined, images)) delete it.on; else it.on = v; })} label={t(`pc.blockNames.${id}`)} />
          </View>
          {open === id ? (
            <View className="px-2.5 pb-2.5">
              {variantsOf(id).map((v) => {
                const def = defaults[id][v];
                const cur = item?.texts?.[v];
                return (
                  <View key={v} className="mb-2">
                    <View className="flex-row items-center justify-between mb-1">
                      <Txt className="text-[12px] font-bold text-muted">{t(`pc.variants.${v}`)}</Txt>
                      {cur !== undefined && cur !== def ? <Pressable testID={`pc-block-${id}-${v}-reset`} onPress={() => patch(id, (it) => { const x = { ...it.texts }; delete x[v]; it.texts = x; })} hitSlop={6} className="flex-row items-center gap-1"><Icon name="restore" size={14} tone="primary" /><Txt className="text-[12px] text-primary font-bold">{t('pc.blockReset')}</Txt></Pressable> : null}
                    </View>
                    {def === '' ? <Txt className="text-[12px] text-muted mb-1">{t('pc.blockAuto')}</Txt> : null}
                    <Input tight testID={`pc-block-${id}-${v}`} value={cur ?? def} onFocus={() => setFocus({ id, v })} onChangeText={(x) => patch(id, (it) => { it.texts = { ...it.texts, [v]: x }; })} multiline placeholder={def === '' ? t('pc.blockAuto') : undefined} style={{ minHeight: 84, textAlignVertical: 'top', paddingTop: 12, fontSize: 14 }} maxLength={1500} />
                  </View>
                );
              })}
              <Txt className="text-[12px] text-muted mb-1">{t('pc.placeholders')}</Txt>
              <View className="flex-row flex-wrap gap-1.5">
                {info.catalog.placeholders.map((p) => (
                  <Pressable key={p} testID={`pc-ph-${p}`} onPress={() => insert(p)} disabled={!focus || focus.id !== id} className={`px-2.5 h-7 rounded-full bg-surface2 items-center justify-center ${!focus || focus.id !== id ? 'opacity-50' : ''}`}><Txt className="text-[12px] font-semibold">{`{${p}}`}</Txt></Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      );
    })}
    {order && visible.length > 1 ? <Button testID="pc-blocks-reset" size="sm" variant="ghost" icon="restore" title={t('pc.blocksReset')} onPress={() => onChange({ ...value, order: [...info.catalog.order] })} className="self-start" /> : null}
  </>);
}

function OutputEditor({ value, onChange }: { value: PromptSet['output']; onChange: (v: PromptSet['output']) => void }) {
  const { t } = useT();
  return (<>
    <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.briefLabel')}</Txt>
    <Segmented testID="pc-out-brief" value={value.brief} onChange={(v) => onChange({ ...value, brief: v })} options={[{ key: 'both', label: t('pc.briefBoth') }, { key: 'english', label: t('pc.briefEnglish') }, { key: 'original', label: t('pc.briefOriginal') }]} />
    <Txt className="text-[13px] font-semibold text-muted mt-3 mb-1.5">{t('pc.sideLabel')}</Txt>
    <Chips testID="pc-out-side" value={String(value.maxSide)} onChange={(v) => onChange({ ...value, maxSide: Number(v) })} options={[0, 768, 1024, 1280, 1536].map((n) => ({ key: String(n), label: n ? String(n) : t('pc.sideAuto') }))} />
  </>);
}

/** The English words sent for a style / room type. Only useful where the text is sent (Texte or Les deux); with Image only there is nothing to word. */
function VocabEditor({ rules, onChange }: { rules: PromptRules; onChange: (v: PromptRules['vocab']) => void }) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const [open, setOpen] = useState(false);
  const { style, room } = rules.global.images;
  if (style === 'image' && room === 'image') return null;
  const set = (kind: 'styles' | 'rooms', id: string, v: string) => onChange({ ...rules.vocab, [kind]: { ...rules.vocab[kind], [id]: v } });
  const count = (style !== 'image' ? Object.keys(rules.vocab.styles).length : 0) + (room !== 'image' ? Object.keys(rules.vocab.rooms).length : 0);
  return (
    <Panel id="vocab" title={`${t('pc.vocabTitle')}${count ? ` (${count})` : ''}`} hint={t('pc.vocabHint')}>
      <Button testID="pc-vocab-toggle" size="sm" variant="soft" title={t(open ? 'pc.vocabClose' : 'pc.vocabOpen')} onPress={() => setOpen(!open)} className="self-start" />
      {open ? (<>
        {style !== 'image' ? (<>
          <Txt className="text-[13px] font-bold mt-3 mb-1.5">{t('pc.vocabStyles')}</Txt>
          {s.styles.map((x) => <Input key={x.id} testID={`pc-vocab-style-${x.id}`} label={L(x.title)} value={rules.vocab.styles[x.id] ?? ''} onChangeText={(v) => set('styles', x.id, v)} maxLength={400} placeholder="warm earthy tones, zellige, carved plaster…" />)}
        </>) : null}
        {room !== 'image' ? (<>
          <Txt className="text-[13px] font-bold mt-2 mb-1.5">{t('pc.vocabRooms')}</Txt>
          {s.roomTypes.map((x) => <Input key={x.id} testID={`pc-vocab-room-${x.id}`} label={L(x.title)} value={rules.vocab.rooms[x.id] ?? ''} onChangeText={(v) => set('rooms', x.id, v)} maxLength={400} placeholder="living room" />)}
        </>) : null}
      </>) : null}
    </Panel>
  );
}

/** Minimal palette picker: a thin colour strip and the name; nothing selected = no colours in the prompt. */
function PalettePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useT();
  const L = useL();
  const palettes = sorted(useStore((x) => x.palettes)).filter((p) => p.visible);
  return (
    <View className="flex-row flex-wrap gap-2" testID="pc-prev-palette">
      <Pressable testID="pc-prev-pal-none" accessibilityRole="radio" accessibilityState={{ selected: value === '' }} onPress={() => onChange('')} className={`rounded-xl border-2 px-3 items-center justify-center ${value === '' ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ height: 46 }}>
        <Txt className="text-[12px] font-bold">{t('pc.prevNone')}</Txt>
      </Pressable>
      {palettes.map((p) => {
        const on = value === p.id;
        return (
          <Pressable key={p.id} testID={`pc-prev-pal-${p.id}`} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => onChange(p.id)} className={`rounded-xl border-2 p-1.5 ${on ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ width: 96 }}>
            {p.isSurprise
              ? <View className="items-center justify-center" style={{ height: 14 }}><Icon name="auto-fix" size={14} /></View>
              : <View className="flex-row rounded-full overflow-hidden" style={{ height: 14 }}>{p.colors.map((c, i) => <View key={i} style={{ flex: 1, backgroundColor: c }} />)}</View>}
            <Txt className="text-[11px] font-semibold mt-1 text-center" numberOfLines={1}>{L(p.title)}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The fake generation: everything the app would send to the image model, without calling it or spending a credit. The input is always a client photo. */
function Preview({ rules, scope }: { rules: PromptRules; scope: Scope }) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const modeChoice = s.doc.settings.modeChoice !== false;
  const [pickTool, setPickTool] = useState('');
  const toolId = scope === 'all' || scope === EXPLORE ? (pickTool || s.tools[0]?.id || '') : scope;
  const [styleId, setStyleId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [insId, setInsId] = useState('');
  const [paletteId, setPaletteId] = useState('');
  const [mode, setMode] = useState<'restyle' | 'renovation'>('restyle');
  const [brief, setBrief] = useState('');
  const [res, setRes] = useState<PromptPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [err, setErr] = useState(false);
  const ran = useRef(false);
  const seq = useRef(0);

  // On the Explorer tab the preview starts from an Explorer picture, as a client coming from Explore would.
  useEffect(() => { if (scope === EXPLORE && !insId && s.inspirations[0]) setInsId(s.inspirations[0].id); }, [scope, insId, s.inspirations]);

  const run = useCallback(async (animate: boolean) => {
    if (!toolId) return;
    const mine = ++seq.current;
    ran.current = true; setBusy(true); setErr(false);
    if (animate) setStep(1);
    try {
      const body = { toolId, styleId: styleId || undefined, roomTypeId: roomId || undefined, inspirationId: insId || undefined, paletteId: paletteId || undefined, mode: modeChoice ? mode : 'restyle', prompt: brief || undefined, rules };
      const req = api<PromptPreview>('/admin/prompt-rules/preview', { method: 'POST', body });
      if (animate) { await wait(450); if (seq.current === mine) setStep(2); await wait(450); if (seq.current === mine) setStep(3); await wait(350); }
      const out = await req;
      if (seq.current === mine) setRes(out);
    } catch { if (seq.current === mine) setErr(true); }
    if (seq.current === mine) { setBusy(false); setStep(0); }
  }, [toolId, styleId, roomId, insId, paletteId, mode, modeChoice, brief, rules]);

  // After the first simulation the card keeps itself up to date while the admin edits.
  useEffect(() => {
    if (!ran.current) return;
    const id = setTimeout(() => { void run(false); }, 700);
    return () => clearTimeout(id);
  }, [run]);

  const copy = async () => {
    try { await (globalThis as { navigator?: { clipboard?: { writeText(v: string): Promise<void> } } }).navigator?.clipboard?.writeText(res?.prompt || ''); toast(t('pc.prevCopied')); } catch { /* the text stays selectable */ }
  };
  const label = (list: { id: string; title: Parameters<typeof L>[0] }[], id: string) => L(list.find((x) => x.id === id)?.title);
  const opts = (list: { id: string; title: Parameters<typeof L>[0] }[]) => [{ key: '', label: t('pc.prevNone') }, ...list.map((x) => ({ key: x.id, label: L(x.title) }))];
  const colors = res?.applied?.colors ?? [];

  return (
    <Card className="p-3 mt-3" testID="pc-preview">
      <View className="flex-row items-center gap-2">
        <Icon name="eye-outline" size={20} tone="primary" />
        <Txt className="text-[15px] font-extrabold flex-1">{t('pc.prevTitle')}</Txt>
      </View>
      <Txt className="text-[12px] text-muted mt-0.5 mb-3">{t('pc.prevHint')}</Txt>

      {scope === 'all' || scope === EXPLORE ? (<>
        <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevTool')}</Txt>
        <View className="mb-3"><Chips testID="pc-prev-tool" value={toolId} onChange={setPickTool} options={s.tools.map((x) => ({ key: x.id, label: L(x.title) }))} /></View>
      </>) : <Txt className="text-[13px] mb-3"><Txt className="font-semibold text-muted">{t('pc.prevTool')}: </Txt><Txt className="font-bold">{label(s.tools, scope)}</Txt></Txt>}

      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevStyle')}</Txt>
      <View className="mb-3"><Chips testID="pc-prev-style" value={styleId} onChange={setStyleId} options={opts(s.styles)} /></View>
      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevRoom')}</Txt>
      <View className="mb-3"><Chips testID="pc-prev-room" value={roomId} onChange={setRoomId} options={opts(s.roomTypes)} /></View>

      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevPalette')}</Txt>
      <View className="mb-3"><PalettePicker value={paletteId} onChange={setPaletteId} /></View>

      <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevExplore')}</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" contentContainerStyle={{ gap: 8 }}>
        <Pressable testID="pc-prev-ins-none" onPress={() => setInsId('')} className={`w-16 h-16 rounded-xl items-center justify-center border ${insId === '' ? 'border-primary bg-surface2' : 'border-line'}`}><Txt className="text-[11px] font-bold text-center">{t('pc.prevNone')}</Txt></Pressable>
        {s.inspirations.slice(0, 40).map((x) => (
          <Pressable key={x.id} testID={`pc-prev-ins-${x.id}`} onPress={() => setInsId(x.id)} className={`rounded-xl overflow-hidden border-2 ${insId === x.id ? 'border-primary' : 'border-transparent'}`}><Image source={{ uri: x.image }} style={{ width: 64, height: 64 }} contentFit="cover" /></Pressable>
        ))}
      </ScrollView>

      {modeChoice ? (
        <View className="mb-3"><Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevMode')}</Txt><Segmented compact testID="pc-prev-mode" value={mode} onChange={setMode} options={[{ key: 'restyle', label: t('pc.variants.restyle') }, { key: 'renovation', label: t('pc.variants.renovation') }]} /></View>
      ) : null}
      <Input testID="pc-prev-brief" label={t('pc.prevBrief')} value={brief} onChangeText={setBrief} placeholder={t('pc.prevBriefPh')} maxLength={500} />
      <Button testID="pc-prev-run" icon="play" title={t(busy && step ? 'pc.prevRunning' : 'pc.prevRun')} onPress={() => run(true)} loading={busy && step > 0} disabled={!toolId} />

      {step > 0 ? (
        <View testID="pc-prev-steps" className="mt-3 gap-1.5">
          {[1, 2, 3].map((n) => (
            <View key={n} className="flex-row items-center gap-2">
              {step > n ? <Icon name="check-circle-outline" size={18} tone="success" /> : step === n ? <Spinner size={18} /> : <Icon name="clock-outline" size={18} tone="muted" />}
              <Txt className={`text-[13px] ${step >= n ? 'font-semibold' : 'text-muted'}`}>{t(`pc.prevStep${n}`)}</Txt>
            </View>
          ))}
        </View>
      ) : null}
      {err ? <Txt testID="pc-prev-error" className="text-danger text-[13px] mt-3">{t('pc.prevFail')}</Txt> : null}
      {!res && !busy && !err ? <Txt className="text-[13px] text-muted mt-3">{t('pc.prevEmpty')}</Txt> : null}

      {res ? (
        <View className="mt-4" testID="pc-prev-result">
          {res.appliesTo === 'explore' && !res.explore ? <Note tone="info" text={t('pc.prevLimited')} /> : null}
          {!res.model.live ? <Note tone="info" text={t('pc.prevNoKey')} /> : null}
          {res.warnings.map((w) => <Note key={w.code} tone="warn" text={t(`pc.warn.${w.code}`, { items: (w.items ?? []).join(', ') })} />)}

          <View className="flex-row items-center gap-2 mt-1 mb-1.5">
            <Txt className="text-[14px] font-extrabold flex-1">{t('pc.prevFinal')}</Txt>
            <Txt className="text-[12px] text-muted">{t('pc.prevChars', { n: res.chars })}</Txt>
            {Platform.OS === 'web' ? <Pressable testID="pc-prev-copy" onPress={copy} hitSlop={8} className="flex-row items-center gap-1 px-2.5 h-8 rounded-full bg-surface2"><Icon name="content-copy" size={14} /><Txt className="text-[12px] font-semibold">{t('pc.prevCopy')}</Txt></Pressable> : null}
          </View>
          <View className="bg-surface2 rounded-xl p-3"><Txt testID="pc-prev-prompt" selectable className="text-[13px] leading-[20px]">{res.prompt}</Txt></View>

          {colors.length || res.applied?.colorSource === 'surprise' ? (
            <View testID="pc-prev-colors" className="mt-3">
              <Txt className="text-[13px] font-semibold text-muted mb-1.5">{t('pc.prevColors')}</Txt>
              {colors.length ? <View className="flex-row rounded-full overflow-hidden mb-2" style={{ height: 10 }}>{colors.map((c) => <View key={c.hex} style={{ flex: 1, backgroundColor: c.hex }} />)}</View> : null}
              <View className="flex-row flex-wrap gap-1.5">
                {colors.map((c) => (
                  <View key={c.hex} className="flex-row items-center gap-1.5 pe-2.5 ps-1.5 h-7 rounded-full bg-surface2">
                    <View className="border border-line" style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: c.hex }} />
                    <Txt className="text-[12px] font-semibold" style={{ writingDirection: 'ltr' }}>{c.hex}</Txt>
                  </View>
                ))}
                {!colors.length ? <View className="flex-row items-center gap-1.5 px-2.5 h-7 rounded-full bg-surface2"><Icon name="auto-fix" size={14} /><Txt className="text-[12px] font-semibold">{t('pc.prevSurprise')}</Txt></View> : null}
              </View>
            </View>
          ) : null}

          <View className="mt-3 gap-1">
            <Txt className="text-[13px]"><Txt className="text-muted font-semibold">{t('pc.prevModel')}: </Txt><Txt className="font-bold">{res.model.label || res.model.model}</Txt></Txt>
            <Txt className="text-[13px]"><Txt className="text-muted font-semibold">{t('pc.prevSize')}: </Txt><Txt className="font-bold">{res.size}</Txt></Txt>
            <Txt className="text-[12px] text-muted">{t('pc.prevScope')}: {t('pc.blocksTitle')} → {t(res.scope.blocks === 'tool' ? 'pc.prevFromTool' : 'pc.prevFromGlobal')}</Txt>
          </View>

          <Txt className="text-[14px] font-extrabold mt-4 mb-1.5">{t('pc.prevPictures')}</Txt>
          <PicRow label={t('pc.prevPhotoRole')} sent />
          {res.images.map((im) => <PicRow key={im.role} uri={im.uri} label={`${t(`pc.role.${im.role}`)}${im.mode ? ` · ${im.mode}` : ''}`} sent={im.sent} why={im.why} />)}

          <Txt className="text-[14px] font-extrabold mt-4 mb-1.5">{t('pc.prevBlocks')}</Txt>
          <View className="flex-row flex-wrap gap-1.5">
            {res.blocks.map((b) => <View key={b.id} className={`px-2.5 h-7 rounded-full items-center justify-center ${b.custom ? 'bg-primary' : 'bg-surface2'}`}><Txt className={`text-[12px] font-semibold ${b.custom ? 'text-onprimary' : ''}`}>{t(`pc.blockNames.${b.id}`)}</Txt></View>)}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function Note({ text, tone }: { text: string; tone: 'info' | 'warn' }) {
  return (
    <View className="flex-row items-start gap-2 bg-surface2 rounded-xl p-2.5 mb-2">
      <Icon name={tone === 'warn' ? 'alert-circle-outline' : 'information-outline'} size={18} tone={tone === 'warn' ? 'danger' : 'primary'} />
      <Txt className="text-[12px] leading-[18px] flex-1">{text}</Txt>
    </View>
  );
}

function PicRow({ label, sent, why, uri }: { label: string; sent: boolean; why?: string; uri?: string }) {
  const { t } = useT();
  return (
    <View className="flex-row items-center gap-3 mb-2">
      <View className="w-12 h-12 rounded-lg bg-surface2 overflow-hidden items-center justify-center">{uri ? <Image source={{ uri }} style={{ width: 48, height: 48 }} contentFit="cover" /> : <Icon name={sent ? 'image-outline' : 'image-off-outline'} size={20} tone="muted" />}</View>
      <View className="flex-1">
        <Txt className="text-[13px] font-bold" numberOfLines={2}>{label}</Txt>
        <Txt className={`text-[12px] ${sent ? 'text-success' : 'text-muted'}`}>{t(sent ? 'pc.prevSent' : 'pc.prevNotSent')}{why ? ` · ${t(`pc.why.${why}`)}` : ''}</Txt>
      </View>
    </View>
  );
}

export default function PromptCards() {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const { desktop } = useBp();
  const [info, setInfo] = useState<PromptRulesInfo | null>(null);
  const [saved, setSaved] = useState<PromptRules | null>(null);
  const [draft, setDraft] = useState<PromptRules | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<Scope>('all');

  const load = useCallback(() => {
    api<PromptRulesInfo>('/admin/prompt-rules').then((r) => { setInfo(r); setSaved(r.rules); setDraft(clone(r.rules)); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { if (backendEnabled) load(); }, [load]);

  const dirty = !!draft && !!saved && !same(draft, saved);
  const save = async () => {
    if (!draft) return false;
    setSaving(true);
    try {
      const r = await api<PromptRulesInfo>('/admin/prompt-rules', { method: 'PUT', body: draft });
      setInfo(r); setSaved(r.rules); setDraft(clone(r.rules)); toast(t('pc.saved'));
      return true;
    } catch { toast(t('pc.saveFail')); return false; } finally { setSaving(false); }
  };
  const discard = () => { if (saved) setDraft(clone(saved)); };
  useLeaveGuard(dirty, save, discard, { before: saved, after: draft });
  useBackCheckpoint(dirty, () => router.back());

  const mutate = (fn: (d: PromptRules) => void) => setDraft((d) => { if (!d) return d; const n = clone(d); fn(n); return n; });
  const explore = scope === EXPLORE;
  const isTool = scope !== 'all' && !explore;
  // A tool's own settings are its prompt blocks only: everything else (rules, pictures, output, Explorer) is global.
  const blocksOf = (d: PromptRules) => (isTool ? d.tools[scope]?.blocks ?? d.global.blocks : d.global.blocks);
  const setBlocks = (v: PromptSet['blocks']) => mutate((d) => { if (!isTool) d.global.blocks = v; else d.tools[scope] = { ...d.tools[scope], blocks: v }; });
  const customBlocks = isTool && !!draft?.tools[scope]?.blocks;
  const toggleCustom = (on: boolean) => mutate((d) => {
    if (on) d.tools[scope] = { ...d.tools[scope], blocks: clone(d.global.blocks) };
    else delete d.tools[scope];
  });

  if (!backendEnabled) return <AdminPage title={t('admin.nav.promptCards')} max={1180}><Card className="p-4"><Txt className="text-muted">{t('pc.offline')}</Txt></Card></AdminPage>;
  if (failed) return <AdminPage title={t('admin.nav.promptCards')} max={1180}><Card className="p-4 items-center gap-3"><Txt testID="pc-error" className="text-danger">{t('pc.loadFail')}</Txt><Button size="sm" title={t('pc.retry')} onPress={() => { setFailed(false); load(); }} /></Card></AdminPage>;
  if (!draft || !info) return <AdminPage title={t('admin.nav.promptCards')} max={1180}><AdminLoading testID="pc-loading" /></AdminPage>;

  const overrides = (id: string) => Object.keys(draft.tools[id] ?? {}).length;
  const images = draft.global.images;
  const editors = (
    <View className={desktop ? 'flex-1' : ''} style={desktop ? { minWidth: 0 } : undefined}>
      {explore ? (<>
        <Panel id="applies" title={t('pc.appliesTitle')} hint={t('pc.appliesHint')}>
          <Segmented testID="pc-applies" value={draft.appliesTo} onChange={(v) => mutate((d) => { d.appliesTo = v; })} options={[{ key: 'all', label: t('pc.appliesAll') }, { key: 'explore', label: t('pc.appliesExplore') }]} />
        </Panel>
        <Panel id="explore-rules" title={t('pc.exploreRulesTitle')} hint={t('pc.exploreRulesHint')}>
          <Input testID="pc-rules-explore" label={t('pc.exploreText')} value={draft.global.rules.exploreText} onChangeText={(v) => mutate((d) => { d.global.rules.exploreText = v; })} multiline placeholder={t('pc.explorePlaceholder')} style={area} maxLength={2000} />
        </Panel>
        <Panel id="explore-block" title={t('pc.exploreBlockTitle')} hint={t('pc.exploreBlockHint')}>
          <BlocksEditor key="explore" value={draft.global.blocks} onChange={(v) => mutate((d) => { d.global.blocks = v; })} info={info} images={images} show={(id) => id === 'reference'} order={false} />
        </Panel>
      </>) : isTool ? (
        <Panel id="blocks" title={t('pc.blocksTitle')} hint={t('pc.blocksHint')} custom={customBlocks} onCustom={toggleCustom}>
          <BlocksEditor key={scope} value={blocksOf(draft)} onChange={setBlocks} info={info} images={images} show={(id) => !PICTURE_BLOCKS.includes(id) && !(id === 'style' && images.style === 'image')} />
        </Panel>
      ) : (<>
        <Panel id="rules" title={t('pc.rulesTitle')} hint={t('pc.rulesHint')}><RulesEditor value={draft.global.rules} onChange={(v) => mutate((d) => { d.global.rules = v; })} /></Panel>
        <Panel id="images" title={t('pc.imagesTitle')} hint={t('pc.imagesHint')}><ImagesEditor value={images} onChange={(v) => mutate((d) => { d.global.images = v; })} /></Panel>
        <Panel id="blocks" title={t('pc.blocksTitle')} hint={t('pc.blocksHint')}>
          <BlocksEditor key="all" value={draft.global.blocks} onChange={setBlocks} info={info} images={images} show={(id) => id !== 'reference' && !(id === 'style' && images.style === 'image')} />
        </Panel>
        <Panel id="output" title={t('pc.outputTitle')} hint={t('pc.outputHint')}><OutputEditor value={draft.global.output} onChange={(v) => mutate((d) => { d.global.output = v; })} /></Panel>
        <VocabEditor rules={draft} onChange={(v) => mutate((d) => { d.vocab = v; })} />
      </>)}
    </View>
  );

  return (
    <AdminPage title={t('admin.nav.promptCards')} max={1180}>
      <Txt className="text-[13px] text-muted mb-3">{t('pc.intro')}</Txt>
      <View className="flex-row flex-wrap gap-2" testID="pc-scopes">
        {[
          { id: EXPLORE, label: t('pc.scopeExplore'), icon: 'compass-outline' },
          { id: 'all', label: t('pc.scopeAll'), icon: 'view-grid-outline' },
          ...s.tools.map((x) => ({ id: x.id, label: L(x.title), icon: '' })),
        ].map((x) => {
          const on = scope === x.id; const n = x.id === 'all' || x.id === EXPLORE ? 0 : overrides(x.id);
          const white = x.id === EXPLORE;
          return (
            <Pressable key={x.id} testID={`pc-scope-${x.id === EXPLORE ? 'explore' : x.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setScope(x.id)} className={`flex-row items-center gap-1.5 px-4 h-10 rounded-full border ${white ? (on ? 'bg-white border-primary border-2' : 'bg-white border-line') : on ? 'bg-primary border-primary' : 'bg-surface border-line'}`}>
              {x.icon ? <Icon name={x.icon} size={17} tone={white ? (on ? 'primary' : 'fg') : on ? 'onprimary' : 'fg'} /> : null}
              <Txt className={`text-[13px] font-bold ${white ? (on ? 'text-primary' : 'text-black') : on ? 'text-onprimary' : ''}`} numberOfLines={1}>{x.label}</Txt>
              {n ? <View className={`w-2 h-2 rounded-full ${on ? 'bg-white' : 'bg-primary'}`} /> : null}
            </Pressable>
          );
        })}
      </View>
      {!isTool ? <Txt className="text-[12px] text-muted mt-2">{t(explore ? 'pc.scopeExploreHint' : 'pc.scopeAllHint')}</Txt> : null}

      {dirty ? (
        <Card className="p-3 mt-3 flex-row items-center gap-2 flex-wrap" testID="pc-savebar">
          <Icon name="alert-circle-outline" size={18} tone="primary" />
          <Txt className="font-bold flex-1">{t('pc.unsaved')}</Txt>
          <Button testID="pc-discard" size="sm" variant="ghost" title={t('pc.discard')} onPress={discard} disabled={saving} />
          <Button testID="pc-save" size="sm" icon="content-save-outline" title={t('pc.save')} onPress={save} loading={saving} />
        </Card>
      ) : null}

      {desktop ? (
        <View className="flex-row gap-4 items-start">
          {editors}
          <View style={{ width: 460, ...(Platform.OS === 'web' ? ({ position: 'sticky', top: 12 } as object) : null) }}><Preview rules={draft} scope={scope} /></View>
        </View>
      ) : (<>{editors}<Preview rules={draft} scope={scope} /></>)}
    </AdminPage>
  );
}
