import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import { useStore } from '@/store/useStore';
import { useT } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Txt } from '@/components/ui/Txt';
import { ColorPicker } from '@/components/admin/ColorPicker';
import type { Draft } from '@/data/types';

export const PROMPT_MAX = 500;
export const MAX_COLORS = 5;
const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
const START = ['#C8A27A', '#2F4F4F', '#F3EDE2', '#B5523B', '#1E3A5F'];

/**
 * Optional personalisation shown on the last step: the client's own words, an exact colour palette (overrides the preset
 * palette) and the Explore picture used as a style reference. Everything feeds the same request as the other choices.
 * `showPrompt` is false in text mode, where the description already sits on the first step.
 */
export function StepCustom({ draft, onChange, showPrompt = true }: { draft: Draft; onChange: (p: Partial<Draft>) => void; showPrompt?: boolean }) {
  const { t } = useT();
  const inspiration = useStore((s) => s.inspirations.find((x) => x.id === draft.inspirationId));
  const [list, setList] = useState<string[]>(draft.colors ?? []);
  const [sel, setSel] = useState(0);
  // The draft only ever receives complete #RRGGBB values; half-typed ones stay local.
  useEffect(() => { onChange({ colors: list.filter(isHex).map((c) => c.toUpperCase()).slice(0, MAX_COLORS) }); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, v: string) => setList((l) => l.map((c, k) => (k === i ? v : c)));
  const add = () => { if (list.length >= MAX_COLORS) return; setList((l) => [...l, START[l.length % START.length]]); setSel(list.length); };
  const remove = (i: number) => { setList((l) => l.filter((_, k) => k !== i)); setSel(0); };
  const cur = Math.min(sel, Math.max(0, list.length - 1));
  return (
    <View testID="step-custom" className="mt-8">
      {inspiration ? (
        <View className="mb-5">
          <Txt className="text-[16px] font-bold mb-2">{t('wizard.inspiration')}</Txt>
          <View className="flex-row items-center gap-3 bg-surface2 rounded-xl p-2.5">
            <Image source={{ uri: inspiration.image }} style={{ width: 64, height: 64, borderRadius: 10 }} contentFit="cover" />
            <Txt className="flex-1 text-[12.5px] text-muted leading-4">{t('wizard.inspirationNote')}</Txt>
            <Pressable testID="inspiration-remove" accessibilityLabel={t('wizard.inspirationRemove')} onPress={() => onChange({ inspirationId: undefined })} className="w-8 h-8 rounded-full bg-surface items-center justify-center active:opacity-70">
              <Icon name="close" size={18} />
            </Pressable>
          </View>
        </View>
      ) : null}

      <Txt className="text-[16px] font-bold mb-1">{t('wizard.customColors')}</Txt>
      <Txt className="text-muted text-[12.5px] mb-3">{t('wizard.customColorsNote')}</Txt>
      <View className="flex-row flex-wrap items-center gap-2.5">
        {list.map((c, i) => (
          <Pressable key={i} testID={`custom-color-${i}`} accessibilityLabel={c} onPress={() => setSel(i)} className="items-center justify-center active:opacity-80"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: isHex(c) ? c : '#999', borderWidth: i === cur ? 3 : 1, borderColor: i === cur ? '#111' : '#bbb' }} />
        ))}
        {list.length < MAX_COLORS ? (
          <Pressable testID="custom-color-add" accessibilityLabel={t('wizard.addColor')} onPress={add} className="w-11 h-11 rounded-full border border-dashed border-line items-center justify-center bg-surface2 active:opacity-70">
            <Icon name="plus" size={20} tone="muted" />
          </Pressable>
        ) : null}
      </View>
      {list.length ? (
        <View className="mt-3">
          <ColorPicker value={list[cur] ?? ''} onChange={(v) => set(cur, v.toUpperCase())} compact />
          <Pressable testID="custom-color-remove" onPress={() => remove(cur)} className="flex-row items-center gap-1.5 mt-3 self-start active:opacity-70">
            <Icon name="minus" size={16} tone="muted" /><Txt className="text-muted text-[13px] font-semibold">{t('wizard.removeColor')}</Txt>
          </Pressable>
          <Txt className="text-muted text-[12px] mt-2">{t('wizard.customColorsOverride')}</Txt>
        </View>
      ) : null}

      {showPrompt ? (
        <View className="mt-6">
          <Txt className="text-[16px] font-bold mb-2">{t('wizard.promptTitle')}</Txt>
          <Input testID="prompt-input" value={draft.prompt ?? ''} onChangeText={(v) => onChange({ prompt: v.slice(0, PROMPT_MAX) })} placeholder={t('wizard.promptPlaceholder')} multiline maxLength={PROMPT_MAX} tight style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }} />
          <Txt className="text-muted text-[11.5px] mt-1 text-end">{(draft.prompt ?? '').length}/{PROMPT_MAX}</Txt>
        </View>
      ) : null}
    </View>
  );
}
