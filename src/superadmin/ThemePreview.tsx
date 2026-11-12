/**
 * Miniature of a store's look, drawn from the colours saved in a store theme (never from the console palette, on purpose: it must
 * show what the store looks like). Plain Views, no tenant imports.
 */
import React from 'react';
import { Image, View } from 'react-native';
import { SA } from './tokens';
import type { LText, StoreTheme } from './types';
import { T } from './ui';
import { tr } from './i18n';

const FALLBACK = { bg: '#F7F5F2', surface: '#FFFFFF', surface2: '#EFEBE6', fg: '#1D1B19', muted: '#5F5A55', line: '#DDD7D0', primary: '#8A5A2B', onprimary: '#FFFFFF', soft: '#F1E7DC', ink: '#1D1B19', onink: '#FFFFFF' };
const text = (value: LText | undefined) => value?.fr || value?.ar || value?.dar || '';

export function ThemePreview({ theme, height = 210 }: { theme: Pick<StoreTheme, 'preview'>; height?: number }) {
  const p = theme.preview;
  const c = { ...FALLBACK, ...(p.colors || {}) } as typeof FALLBACK;
  const tabs = p.tabs.map(text).filter(Boolean).slice(0, 4);
  const tools = p.tools.slice(0, 4);
  return (
    <View accessible accessibilityLabel={tr('Preview of {name}', { name: p.appName || tr('the store') })} style={{ height, borderRadius: SA.radius.md, overflow: 'hidden', backgroundColor: c.bg, borderWidth: 1, borderColor: SA.color.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.line }}>
        {p.logoUri && /^(https?:)?\/\/|^\//.test(p.logoUri) ? <Image source={{ uri: p.logoUri }} style={{ width: 22, height: 22, borderRadius: 5 }} resizeMode="contain" /> : <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: c.primary }} />}
        <T size="sm" weight="bold" color={c.fg} numberOfLines={1} style={{ flexShrink: 1 }}>{p.appName || tr('Store')}</T>
        <View style={{ marginStart: 'auto', backgroundColor: c.primary, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}><T size="xs" weight="bold" color={c.onprimary}>Aa</T></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, padding: 10, flexWrap: 'wrap' }}>
        {(tabs.length ? tabs : ['', '', '']).map((label, i) => (
          <View key={i} style={{ backgroundColor: i === 0 ? c.ink : c.surface2, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, minWidth: 34 }}>
            <T size="xs" weight="medium" color={i === 0 ? c.onink : c.fg} numberOfLines={1}>{label || ' '}</T>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10 }}>
        {(tools.length ? tools : [{ title: {}, image: '' }, { title: {}, image: '' }]).map((tool, i) => (
          <View key={i} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 10, overflow: 'hidden' }}>
            {tool.image && /^(https?:)?\/\/|^\//.test(tool.image) ? <Image source={{ uri: tool.image }} style={{ height: 38, width: '100%', backgroundColor: c.soft }} resizeMode="cover" /> : <View style={{ height: 38, backgroundColor: c.soft }} />}
            <View style={{ padding: 6 }}><T size="xs" weight="bold" color={c.fg} numberOfLines={1}>{text(tool.title) || ' '}</T></View>
          </View>
        ))}
      </View>
      {p.dark ? <View style={{ position: 'absolute', right: 8, bottom: 8, backgroundColor: c.ink, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 }}><T size="xs" weight="bold" color={c.onink}>{tr('dark')}</T></View> : null}
    </View>
  );
}
