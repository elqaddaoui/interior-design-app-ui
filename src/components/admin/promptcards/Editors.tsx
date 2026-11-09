import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Toggle } from '@/components/ui/Toggle';
import { Txt } from '@/components/ui/Txt';
import { DragRow, useReorder } from '@/components/admin/DragReorder';
import { useL, useT } from '@/i18n';
import { useStore } from '@/store/useStore';
import type { PromptPicture, PromptRules, PromptRulesInfo, PromptSet } from '@/data/types';
import { BLOCK_MAX, EXPLORE, RULES_MAX, RULE_IDEAS, VOCAB_MAX, addRuleLine, blockOn, canReorder, clone, hasRuleLine, insertVar, moveVisible, removeRuleLine, reorderVisible, stepIsCustom, unknownVars, variantsOf, visibleSteps, type Scope } from '@/lib/promptCards';
import { Chips, Label, Note, OptionTiles } from './ui';

const area = { minHeight: 104, textAlignVertical: 'top', paddingTop: 12 } as const;

/* ------------------------------------------------------------------ Rules */
export function RulesTab({ value, onChange }: { value: PromptSet['rules']; onChange: (v: PromptSet['rules']) => void }) {
  const { t } = useT();
  return (<>
    <Label hint={t('pc.rulesHelp')}>{t('pc.rulesLabel')}</Label>
    <Input tight testID="pc-rules-text" value={value.text} onChangeText={(v) => onChange({ ...value, text: v })} multiline placeholder={t('pc.rulesPlaceholder')} style={area} maxLength={RULES_MAX} />
    <Txt className="text-[11px] text-muted text-end mt-1 mb-2">{value.text.length} / {RULES_MAX}</Txt>
    <Txt className="text-[12px] font-semibold text-muted mb-1.5">{t('pc.ideas')}</Txt>
    <View className="flex-row flex-wrap gap-1.5">
      {RULE_IDEAS.map((idea, i) => {
        const on = hasRuleLine(value.text, idea);
        return (
          <Pressable key={idea} testID={`pc-idea-${i}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => onChange({ ...value, text: on ? removeRuleLine(value.text, idea) : addRuleLine(value.text, idea) })} className={`flex-row items-center gap-1 px-2.5 h-8 rounded-full border ${on ? 'bg-soft border-primary' : 'bg-surface border-line'}`}>
            <Icon name={on ? 'check' : 'plus'} size={14} tone={on ? 'primary' : 'muted'} />
            <Txt className="text-[12px] font-semibold" numberOfLines={1}>{idea}</Txt>
          </Pressable>
        );
      })}
    </View>
  </>);
}

/* ------------------------------------------------------------------ Pictures */
export function PicturesTab({ value, onChange }: { value: PromptSet['images']; onChange: (v: PromptSet['images']) => void }) {
  const { t } = useT();
  const picks: { key: PromptPicture; label: string; sub: string; icon: string }[] = [
    { key: 'text', label: t('pc.picText'), sub: t('pc.picTextSub'), icon: 'format-text' },
    { key: 'image', label: t('pc.picImage'), sub: t('pc.picImageSub'), icon: 'image-outline' },
    { key: 'both', label: t('pc.picBoth'), sub: t('pc.picBothSub'), icon: 'image-text' },
  ];
  return (<>
    <Note tone="info" text={t('pc.picturesHelp')} />
    {(['room', 'style'] as const).map((k) => (
      <View key={k} className="mb-4">
        <Label>{t(k === 'room' ? 'pc.imgRoom' : 'pc.imgStyle')}</Label>
        <OptionTiles testID={`pc-img-${k}`} value={value[k]} onChange={(v) => onChange({ ...value, [k]: v })} options={picks} />
      </View>
    ))}
  </>);
}

/* ------------------------------------------------------------------ Steps (the prompt blocks) */
export function StepsTab({ scope, value, onChange, info, images, used, focusId, onFocus, readOnly }: {
  scope: Scope; value: PromptSet['blocks']; onChange: (v: PromptSet['blocks']) => void; info: PromptRulesInfo; images: PromptSet['images'];
  /** Steps present in the current live preview (undefined while it loads). */
  used?: string[]; focusId: string | null; onFocus: (id: string | null) => void; readOnly: boolean;
}) {
  const { t } = useT();
  const defaults = info.catalog.blocks;
  const visible = visibleSteps(value.order, scope, images);
  const sortable = !readOnly && canReorder(scope, visible);
  const [field, setField] = useState<{ id: string; v: string } | null>(null);
  const reorder = useReorder(visible, [], (ids, to) => onChange({ ...value, order: reorderVisible(value.order, visible, ids, to) }), sortable);
  const patch = (id: string, fn: (item: { on?: boolean; texts?: Record<string, string> }) => void) => {
    const next = clone(value); const item = next.items[id] ?? {}; fn(item); next.items[id] = item; onChange(next);
  };
  const insert = (name: string) => {
    if (!field) return;
    patch(field.id, (item) => { const cur = item.texts?.[field.v] ?? defaults[field.id][field.v]; item.texts = { ...item.texts, [field.v]: insertVar(cur, name) }; });
  };
  const changed = value.order.some((id, i) => id !== info.catalog.order[i]);
  return (<>
    <Note tone="info" text={t(scope === EXPLORE ? 'pc.stepsExploreHelp' : 'pc.stepsHelp')} />
    <View style={{ gap: 8 }}>
      {visible.map((id, i) => {
        const item = value.items[id];
        const on = blockOn(id, item, images);
        const open = focusId === id;
        const edited = stepIsCustom(value, id, defaults);
        const live = used ? used.includes(id) : null;
        return (
          <DragRow key={id} id={id} reorder={reorder} layout="list" onMove={sortable ? (d) => onChange({ ...value, order: moveVisible(value.order, visible, id, d) }) : undefined}>{(handle) => (
            <View testID={`pc-step-${id}`} className={`border rounded-2xl bg-surface overflow-hidden ${open ? 'border-primary' : 'border-line'}`}>
              <Pressable testID={`pc-step-${id}-open`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => onFocus(open ? null : id)} className={`flex-row items-center gap-1.5 pe-2.5 py-2 ${sortable ? 'ps-1' : 'ps-3'} ${on ? '' : 'opacity-60'}`}>
                {sortable ? handle : null}
                <View className="w-6 h-6 rounded-full bg-surface2 items-center justify-center"><Txt className="text-[11px] font-extrabold text-muted">{i + 1}</Txt></View>
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <View className="flex-row items-center gap-1.5">
                    <Txt className="font-extrabold text-[14px]" numberOfLines={1} style={{ flexShrink: 1 }}>{t(`pc.blockNames.${id}`)}</Txt>
                    {edited ? <View className="px-1.5 h-4 rounded-full bg-primary items-center justify-center"><Txt className="text-[9.5px] font-extrabold text-onprimary">{t('pc.stepEdited')}</Txt></View> : null}
                  </View>
                  <Txt className="text-[12px] text-muted" numberOfLines={1}>{!on ? t('pc.stepOff') : live === false ? t('pc.stepIdle') : t(`pc.blockDesc.${id}`)}</Txt>
                </View>
                {live && on ? <View testID={`pc-step-${id}-live`} className="w-2 h-2 rounded-full bg-success" /> : null}
                <Toggle testID={`pc-step-${id}-on`} value={on} onValueChange={(v) => patch(id, (it) => { if (v === blockOn(id, undefined, images)) delete it.on; else it.on = v; })} label={t(`pc.blockNames.${id}`)} />
              </Pressable>
              {open ? (
                <View className="px-3 pb-3 pt-1 border-t border-line">
                  <Txt className="text-[12px] text-muted my-2">{t(`pc.blockDesc.${id}`)}</Txt>
                  {variantsOf(id, defaults, images).map((v) => {
                    const def = defaults[id][v]; const cur = item?.texts?.[v]; const text = cur ?? def;
                    const bad = unknownVars(text, info.catalog.placeholders);
                    return (
                      <View key={v} className="mb-2.5">
                        <View className="flex-row items-center justify-between mb-1">
                          <Txt className="text-[12px] font-bold text-muted">{t(`pc.variants.${v}`)}</Txt>
                          {cur !== undefined && cur !== def ? <Pressable testID={`pc-step-${id}-${v}-reset`} accessibilityRole="button" onPress={() => patch(id, (it) => { const x = { ...it.texts }; delete x[v]; it.texts = x; })} hitSlop={6} className="flex-row items-center gap-1"><Icon name="restore" size={14} tone="primary" /><Txt className="text-[12px] text-primary font-bold">{t('pc.stepReset')}</Txt></Pressable> : null}
                        </View>
                        {def === '' ? <Txt className="text-[12px] text-muted mb-1">{t('pc.stepAuto')}</Txt> : null}
                        <Input tight invalid={bad.length > 0} testID={`pc-step-${id}-${v}`} value={text} onFocus={() => setField({ id, v })} onChangeText={(x) => patch(id, (it) => { it.texts = { ...it.texts, [v]: x }; })} multiline placeholder={def === '' ? t('pc.stepAuto') : undefined} style={{ minHeight: 84, textAlignVertical: 'top', paddingTop: 12, fontSize: 14 }} maxLength={BLOCK_MAX} />
                        {bad.length ? <Txt testID={`pc-step-${id}-${v}-bad`} className="text-danger text-[12px] mt-1">{t('pc.unknownVar', { items: bad.map((n) => `{${n}}`).join(', ') })}</Txt> : null}
                      </View>
                    );
                  })}
                  <Txt className="text-[12px] text-muted mb-1">{t('pc.placeholders')}</Txt>
                  <View className="flex-row flex-wrap gap-1.5">
                    {info.catalog.placeholders.map((p) => {
                      const ready = !!field && field.id === id;
                      return <Pressable key={p} testID={`pc-ph-${p}`} accessibilityRole="button" onPress={() => insert(p)} disabled={!ready} className={`px-2.5 h-7 rounded-full bg-surface2 items-center justify-center ${ready ? '' : 'opacity-50'}`}><Txt className="text-[12px] font-semibold">{`{${p}}`}</Txt></Pressable>;
                    })}
                  </View>
                </View>
              ) : null}
            </View>
          )}</DragRow>
        );
      })}
    </View>
    {sortable && changed ? <Button testID="pc-steps-reset" size="sm" variant="ghost" icon="restore" title={t('pc.stepsReset')} onPress={() => onChange({ ...value, order: [...info.catalog.order] })} className="self-start mt-2" /> : null}
  </>);
}

/* ------------------------------------------------------------------ Words (vocabulary) */
export function WordsTab({ rules, onChange, info }: { rules: PromptRules; onChange: (v: PromptRules['vocab']) => void; info: PromptRulesInfo }) {
  const { t } = useT();
  const L = useL();
  const s = useStore();
  const { style, room } = rules.global.images;
  // Words are only sent where the text is sent: a style / room type sent as an Image alone has nothing to word.
  const kinds = ([style !== 'image' && 'styles', room !== 'image' && 'rooms'].filter(Boolean)) as ('styles' | 'rooms')[];
  const [pick, setPick] = useState<'styles' | 'rooms'>('styles');
  const kind = kinds.includes(pick) ? pick : kinds[0];
  if (!kind) return <Note tone="info" testID="pc-words-none" text={t('pc.wordsNone')} />;
  const list = kind === 'styles' ? s.styles : s.roomTypes;
  const set = (id: string, v: string) => onChange({ ...rules.vocab, [kind]: { ...rules.vocab[kind], [id]: v } });
  const clear = (id: string) => { const m = { ...rules.vocab[kind] }; delete m[id]; onChange({ ...rules.vocab, [kind]: m }); };
  const n = (k: 'styles' | 'rooms') => Object.values(rules.vocab[k]).filter((x) => x.trim()).length;
  return (<>
    <Note tone="info" text={t('pc.wordsHelp')} />
    {kinds.length > 1 ? <View className="mb-3"><Segmented testID="pc-words-kind" value={kind} onChange={setPick} options={kinds.map((k) => ({ key: k, label: `${t(k === 'styles' ? 'pc.wordsStyles' : 'pc.wordsRooms')}${n(k) ? ` (${n(k)})` : ''}` }))} /></View> : null}
    {list.map((x) => {
      const cur = rules.vocab[kind][x.id] ?? '';
      const def = info.catalog.vocab?.[kind]?.[x.id] || '';
      const pic = 'image' in x && x.image && (kind === 'styles' || (x as { displayMode?: string }).displayMode === 'image') ? x.image : '';
      return (
        <View key={x.id} className="flex-row items-start gap-2.5 mb-2.5">
          <View className="w-11 h-11 rounded-xl bg-surface2 overflow-hidden items-center justify-center mt-0.5">{pic ? <Image source={{ uri: pic }} style={{ width: 44, height: 44 }} contentFit="cover" /> : <Icon name={kind === 'styles' ? 'palette-outline' : 'sofa-outline'} size={20} tone="muted" />}</View>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <View className="flex-row items-center justify-between">
              <Txt className="text-[13px] font-bold" numberOfLines={1} style={{ flexShrink: 1 }}>{L(x.title)}</Txt>
              {cur ? <Pressable testID={`pc-vocab-${kind}-${x.id}-clear`} accessibilityRole="button" onPress={() => clear(x.id)} hitSlop={8} className="flex-row items-center gap-1"><Icon name="restore" size={14} tone="primary" /><Txt className="text-[12px] text-primary font-bold">{t('pc.stepReset')}</Txt></Pressable> : null}
            </View>
            <Input tight testID={`pc-vocab-${kind}-${x.id}`} value={cur} onChangeText={(v) => set(x.id, v)} maxLength={VOCAB_MAX} placeholder={def || L(x.title)} multiline style={{ minHeight: 44, fontSize: 14, paddingTop: 11, textAlignVertical: 'top' }} />
          </View>
        </View>
      );
    })}
  </>);
}

/* ------------------------------------------------------------------ Output */
export function OutputTab({ value, onChange }: { value: PromptSet['output']; onChange: (v: PromptSet['output']) => void }) {
  const { t } = useT();
  return (<>
    <Label hint={t('pc.briefHelp')}>{t('pc.briefLabel')}</Label>
    <View className="mb-4"><OptionTiles testID="pc-out-brief" value={value.brief} onChange={(v) => onChange({ ...value, brief: v })} options={[
      { key: 'both', label: t('pc.briefBoth'), sub: t('pc.briefBothSub'), icon: 'translate' },
      { key: 'english', label: t('pc.briefEnglish'), sub: t('pc.briefEnglishSub'), icon: 'format-text' },
      { key: 'original', label: t('pc.briefOriginal'), sub: t('pc.briefOriginalSub'), icon: 'pencil-outline' },
    ]} /></View>
    <Label hint={t('pc.sideHelp')}>{t('pc.sideLabel')}</Label>
    <Chips testID="pc-out-side" value={String(value.maxSide)} onChange={(v) => onChange({ ...value, maxSide: Number(v) })} options={[0, 768, 1024, 1280, 1536].map((n) => ({ key: String(n), label: n ? String(n) : t('pc.sideAuto') }))} />
  </>);
}

/* ------------------------------------------------------------------ Explorer page */
/** Explore page: ONE field, the extra rules added to the prompt only when the client generates from an Explore picture. */
export function ExplorerRules({ text, onText }: { text: string; onText: (v: string) => void }) {
  const { t } = useT();
  return (<>
    <Label hint={t('pc.exploreRulesHint')}>{t('pc.exploreRulesTitle')}</Label>
    <Input tight testID="pc-rules-explore" value={text} onChangeText={onText} multiline placeholder={t('pc.explorePlaceholder')} style={area} maxLength={RULES_MAX} />
    <Txt className="text-[11px] text-muted text-end mt-1 mb-1">{text.length} / {RULES_MAX}</Txt>
  </>);
}
