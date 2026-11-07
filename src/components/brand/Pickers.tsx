 
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Icon } from '@/components/ui/Icon';
import { Sheet } from '@/components/ui/Sheet';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { fontMeta, searchFonts, supportsText, type FontCat } from '@/lib/brand/fontData';
import { fontStyle, loadFont, useFontRevision } from '@/lib/brand/fonts';
import { ICON_GROUP_IDS, searchIcons } from '@/lib/brand/icons';
import { Chips } from './ui';

export function SearchBox({ value, onChange, placeholder, testID }: { value: string; onChange: (v: string) => void; placeholder: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View className="flex-row items-center gap-2 bg-surface2 rounded-xl px-3 mb-3" style={{ height: 44 }}>
      <Icon name="magnify" size={18} tone="muted" />
      <TextInput testID={testID} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} accessibilityLabel={placeholder} autoCorrect={false} autoCapitalize="none"
        style={{ flex: 1, minWidth: 0, color: colors.fg, fontSize: 15, outlineStyle: 'none' } as any} />
      {value ? <Pressable accessibilityRole="button" accessibilityLabel="clear" onPress={() => onChange('')} hitSlop={8}><Icon name="close-circle" size={18} tone="muted" /></Pressable> : null}
    </View>
  );
}

const CATS: (FontCat | 'all')[] = ['all', 'sans', 'serif', 'display', 'script', 'mono', 'arabic', 'intl'];
const PAGE = 24;

function FontRow({ family, text, on, onPick }: { family: string; text: string; on: boolean; onPick: () => void }) {
  const rev = useFontRevision();
  const { t } = useT();
  const sample = text.trim() || 'Dwira';
  const ok = supportsText(family, sample);
  useEffect(() => { void loadFont(family, 400, false, sample + 'Aa'); }, [family, sample]);
  void rev;
  const f = fontMeta(family);
  return (
    <Pressable testID={`font-${family.replace(/\W/g, '')}`} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={family} onPress={onPick}
      className={`flex-row items-center gap-3 rounded-xl border px-3 py-2 mb-1.5 active:opacity-80 ${on ? 'border-primary bg-soft' : 'border-line bg-surface'}`}>
      <View className="flex-1" style={{ minWidth: 0 }}>
        <View className="flex-row items-center gap-1.5">
          <Txt className="text-muted text-[11px] font-semibold" numberOfLines={1}>{family}</Txt>
          {!ok ? <Txt className="text-[10px] text-danger font-bold">{t('br.noScript')}</Txt> : null}
        </View>
        <Txt style={{ ...(fontStyle(family, f?.weights.includes('..') ? 600 : 400, false) as any), fontSize: 24, lineHeight: 36, opacity: ok ? 1 : 0.4 }} numberOfLines={1}>{sample}</Txt>
      </View>
      <Icon name={on ? 'check-circle' : 'radiobox-blank'} size={20} tone={on ? 'primary' : 'muted'} />
    </Pressable>
  );
}

/** Searchable font picker: category filter, fonts that can draw the brand name first, live specimen of the real name. */
export function FontPicker({ visible, onClose, value, text, onPick, title }: { visible: boolean; onClose: () => void; value: string; text: string; onPick: (family: string) => void; title: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FontCat | 'all'>('all');
  const [shown, setShown] = useState(PAGE);
  const list = useMemo(() => searchFonts(q, cat, text), [q, cat, text]);
  useEffect(() => setShown(PAGE), [q, cat, visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {visible ? (
        <View>
          <SearchBox testID="font-search" value={q} onChange={setQ} placeholder={t('br.searchFonts')} />
          <Chips small value={cat} onChange={setCat} testID="font-cat" options={CATS.map((c) => ({ key: c, label: t(`br.fontCat.${c}`) }))} />
          {list.slice(0, shown).map((f) => <FontRow key={f.family} family={f.family} text={text} on={f.family === value} onPick={() => { onPick(f.family); onClose(); }} />)}
          {!list.length ? <Txt className="text-muted text-center py-6">{t('br.noResults')}</Txt> : null}
          {list.length > shown ? <Pressable testID="font-more" accessibilityRole="button" onPress={() => setShown(shown + PAGE)} className="h-10 rounded-full bg-surface2 items-center justify-center mt-1"><Txt className="font-bold text-[13px]">{t('br.showMore', { n: list.length - shown })}</Txt></Pressable> : null}
        </View>
      ) : null}
    </Sheet>
  );
}

export function GlyphIcon({ d, size = 26, color }: { d: string; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Svg width={size} height={size} viewBox="0 0 24 24"><Path d={d} fill={color ?? colors.fg} /></Svg>;
}

export function IconPicker({ visible, onClose, value, onPick, title }: { visible: boolean; onClose: () => void; value: string; onPick: (name: string) => void; title: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const list = useMemo(() => searchIcons(q, group), [q, group]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {visible ? (
        <View>
          <SearchBox testID="icon-search" value={q} onChange={setQ} placeholder={t('br.searchIcons')} />
          <Chips small value={group} onChange={setGroup} testID="icon-group" options={['all', ...ICON_GROUP_IDS].map((g) => ({ key: g, label: t(`br.iconGroup.${g}`) }))} />
          <View className="flex-row flex-wrap gap-2">
            {list.map((i) => (
              <Pressable key={i.name} testID={`icon-${i.name}`} accessibilityRole="radio" accessibilityState={{ selected: i.name === value }} accessibilityLabel={i.name.replace(/-/g, ' ')} onPress={() => { onPick(i.name); onClose(); }}
                className={`items-center justify-center rounded-xl border active:opacity-80 ${i.name === value ? 'border-primary bg-soft' : 'border-line bg-surface'}`} style={{ width: 56, height: 56 }}>
                <GlyphIcon d={i.d} />
              </Pressable>
            ))}
          </View>
          {!list.length ? <Txt className="text-muted text-center py-6">{t('br.noResults')}</Txt> : null}
        </View>
      ) : null}
    </Sheet>
  );
}
