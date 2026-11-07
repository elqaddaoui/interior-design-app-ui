 
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';
import { useT } from '@/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { DARK_BG, HARMONIES, LIGHT_BG, READY_PALETTES, brandPalette, fixBoth, grade, isHex, normHex, type Harmony } from '@/lib/brand/color';
import { Chips, Hint, Label } from './ui';

export const Dot = ({ c, size = 26, on, onPress, label, testID }: { c: string; size?: number; on?: boolean; onPress?: () => void; label?: string; testID?: string }) => {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label ?? c} onPress={onPress} hitSlop={4}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c, borderWidth: on ? 3 : 1, borderColor: on ? colors.fg : colors.line }} />
  );
};

/** Hex text field that only commits a complete, valid colour (so typing "#12" never breaks the logo). */
function HexInput({ value, onChange, testID }: { value: string; onChange: (v: string) => void; testID?: string }) {
  const { colors } = useTheme();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const bad = text !== '' && !isHex(normHex(text, ''));
  return (
    <TextInput testID={testID} value={text} maxLength={7} autoCapitalize="characters" autoCorrect={false} placeholder="#RRGGBB" placeholderTextColor={colors.muted} accessibilityLabel="HEX"
      onChangeText={(v) => { const x = v.startsWith('#') || !v ? v : '#' + v; setText(x); const n = normHex(x, ''); if (n && x.length >= 4 && (x.length === 4 || x.length === 7)) onChange(n); }}
      onBlur={() => { const n = normHex(text, ''); if (n) { setText(n); onChange(n); } else setText(value); }}
      style={{ width: 104, height: 40, borderRadius: 10, paddingHorizontal: 10, backgroundColor: colors.surface2, color: colors.fg, fontSize: 14, borderWidth: 1, borderColor: bad ? colors.danger : 'transparent', outlineStyle: 'none' } as any} />
  );
}

const Swatch = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const { colors } = useTheme();
  const c = isHex(value) ? value : '#888888';
  if (Platform.OS === 'web') return React.createElement('input', { type: 'color', value: c, 'aria-label': 'color', onChange: (e: any) => onChange(String(e.target.value).toUpperCase()), style: { width: 40, height: 40, border: 0, padding: 0, borderRadius: 10, background: 'transparent', cursor: 'pointer' } });
  return <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: c, borderWidth: 1, borderColor: colors.line }} />;
};

/** Contrast checker: ratio + grade on the light AND the dark background, with a one-tap fix. */
export function ContrastCheck({ color, onFix, testID }: { color: string; onFix?: (c: string) => void; testID?: string }) {
  const { t } = useT();
  if (!isHex(color)) return null;
  const rows = [['light', LIGHT_BG, 'br.onLight'], ['dark', DARK_BG, 'br.onDark']] as const;
  const bad = rows.some(([, bg]) => !grade(color, bg).large);
  return (
    <View testID={testID} className="mb-2.5">
      <View className="flex-row gap-2">
        {rows.map(([id, bg, key]) => {
          const g = grade(color, bg);
          const label = g.aaa ? 'AAA' : g.normal ? 'AA' : g.large ? 'AA Large' : t('br.fail');
          return (
            <View key={id} testID={`${testID}-${id}`} className="flex-1 rounded-xl border border-line px-2.5 py-2 flex-row items-center gap-2" style={{ backgroundColor: bg, minWidth: 0 }}>
              <Txt style={{ color, fontWeight: '800', fontSize: 18, lineHeight: 22 }}>Aa</Txt>
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Txt style={{ color: id === 'light' ? '#444' : '#CCC', fontSize: 10 }} numberOfLines={1}>{t(key)}</Txt>
                <Txt style={{ color: g.large ? (id === 'light' ? '#0A7A3B' : '#4ADE80') : '#EF4444', fontWeight: '800', fontSize: 11 }} numberOfLines={1}>{g.ratio}:1 · {label}</Txt>
              </View>
              <Icon name={g.large ? 'check-circle' : 'alert-circle'} size={16} color={g.large ? '#16A34A' : '#EF4444'} />
            </View>
          );
        })}
      </View>
      {bad && onFix ? (
        <Pressable testID={`${testID}-fix`} accessibilityRole="button" onPress={() => onFix(fixBoth(color))} className="flex-row items-center gap-1.5 self-start mt-2 h-8 px-3 rounded-full bg-soft active:opacity-80">
          <Icon name="auto-fix" size={15} tone="primary" /><Txt className="text-[12px] font-bold">{t('br.fixContrast')}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Colour control: picker + hex + (optional) "automatic" + ready palettes + a palette generated from one colour + contrast. */
export function ColorField({ label, value, onChange, auto, autoLabel, base, harmony, onBase, palette = true, contrast, testID }: {
  label: string; value: string; onChange: (v: string) => void; auto?: boolean; autoLabel?: string;
  base?: string; harmony?: Harmony; onBase?: (base: string, harmony: Harmony) => void; palette?: boolean; contrast?: boolean; testID?: string;
}) {
  const { t } = useT();
  const [tab, setTab] = useState<'brand' | 'ready'>('brand');
  const b = base && isHex(base) ? base : isHex(value) ? value : '#FBDD2D';
  const h = harmony ?? 'analogous';
  const gen = brandPalette(b, h);
  return (
    <View testID={testID} className="mb-3">
      <Label right={auto && value ? <Pressable testID={`${testID}-auto`} accessibilityRole="button" onPress={() => onChange('')} className="flex-row items-center gap-1 h-7 px-2.5 rounded-full bg-surface2"><Icon name="restore" size={13} /><Txt className="text-[11px] font-bold">{autoLabel ?? t('br.auto')}</Txt></Pressable> : null}>{label}</Label>
      <View className="flex-row items-center gap-2.5 mb-2">
        <Swatch value={value || (auto ? '#111111' : '#888888')} onChange={onChange} />
        <HexInput testID={`${testID}-hex`} value={value} onChange={onChange} />
        {auto && !value ? <Txt className="text-[11px] text-muted flex-1" numberOfLines={2}>{autoLabel ?? t('br.auto')}</Txt> : null}
      </View>
      {palette ? (
        <View>
          <Chips small value={tab} onChange={setTab} testID={`${testID}-tab`} options={[{ key: 'brand', label: t('br.brandPalette'), icon: 'palette-swatch-variant' }, { key: 'ready', label: t('br.readyPalettes'), icon: 'palette-outline' }]} />
          {tab === 'brand' ? (
            <View>
              <View className="flex-row items-center gap-2.5 mb-2">
                <Txt className="text-[11px] text-muted">{t('br.baseColor')}</Txt>
                <Swatch value={b} onChange={(v) => onBase?.(v, h)} />
                <HexInput testID={`${testID}-base`} value={b} onChange={(v) => onBase?.(v, h)} />
              </View>
              <Chips small value={h} testID={`${testID}-harmony`} onChange={(k) => onBase?.(b, k)} options={HARMONIES.map((k) => ({ key: k, label: t(`br.harmony.${k}`) }))} />
              <View className="flex-row flex-wrap gap-2.5">{gen.map((c) => <Dot key={c} c={c} size={30} on={c === value} onPress={() => onChange(c)} testID={`${testID}-gen-${c.slice(1)}`} />)}</View>
            </View>
          ) : (
            READY_PALETTES.map((p) => (
              <View key={p.id} className="flex-row items-center gap-2 mb-2">
                <Txt className="text-[11px] text-muted" style={{ width: 54 }} numberOfLines={1}>{t(`br.ready.${p.id}`)}</Txt>
                <View className="flex-row flex-wrap gap-2 flex-1">{p.colors.map((c) => <Dot key={c} c={c} on={c === value} onPress={() => onChange(c)} />)}</View>
              </View>
            ))
          )}
        </View>
      ) : null}
      {contrast && value ? <ContrastCheck testID={`${testID}-contrast`} color={value} onFix={onChange} /> : null}
      {contrast && !value ? <Hint>{t('br.autoHint')}</Hint> : null}
    </View>
  );
}
