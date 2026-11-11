/**
 * Primitives of the Super Admin console. Plain React Native + StyleSheet driven by `SA` (tokens.ts) only: no NativeWind classes
 * (those resolve against the tenant's theme variables), no ThemeProvider, no tenant store, no tenant fonts, no translations.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SA } from './tokens';
import { saMessage } from './api';

const font = Platform.OS === 'web' ? { fontFamily: SA.family } : {};
export function T({ children, size = 'md', weight = 'regular', color = SA.color.text, style, numberOfLines, testID, selectable }: { children: React.ReactNode; size?: keyof typeof SA.font.size; weight?: keyof typeof SA.font.weight; color?: string; style?: object; numberOfLines?: number; testID?: string; selectable?: boolean }) {
  return <Text testID={testID} selectable={selectable} numberOfLines={numberOfLines} style={[font, { fontSize: SA.font.size[size], fontWeight: SA.font.weight[weight], color }, style]}>{children}</Text>;
}
export function Btn({ label, onPress, kind = 'solid', disabled, busy, small, testID }: { label: string; onPress: () => void; kind?: 'solid' | 'ghost' | 'danger'; disabled?: boolean; busy?: boolean; small?: boolean; testID?: string }) {
  const solid = kind === 'solid', danger = kind === 'danger';
  const bg = solid ? SA.color.accent : 'transparent', fg = solid ? SA.color.onAccent : danger ? SA.color.danger : SA.color.text;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: solid ? SA.color.accent : danger ? SA.color.danger : SA.color.line, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, paddingVertical: small ? 6 : 10, paddingHorizontal: small ? 10 : 16 }]}>
      {busy ? <ActivityIndicator size="small" color={fg} /> : <T size={small ? 'xs' : 'sm'} weight="bold" color={fg}>{label}</T>}
    </Pressable>
  );
}
export function Field({ label, error, ...p }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ marginBottom: SA.space.md }}>
      <T size="xs" weight="bold" color={SA.color.muted} style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</T>
      <TextInput placeholderTextColor={SA.color.muted} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label}
        {...(Platform.OS === 'web' ? ({ autoComplete: p.secureTextEntry ? 'new-password' : 'off' } as object) : {})}
        {...p} style={[s.input, font, p.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null, error ? { borderColor: SA.color.danger } : null]} />
      {error ? <T size="xs" color={SA.color.danger} style={{ marginTop: 4 }}>{error}</T> : null}
    </View>
  );
}
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { return <View style={[s.card, style]}>{children}</View>; }
export function Badge({ label, tone = 'muted' }: { label: string; tone?: 'ok' | 'warn' | 'danger' | 'muted' | 'accent' }) {
  const color = { ok: SA.color.ok, warn: SA.color.warn, danger: SA.color.danger, muted: SA.color.muted, accent: SA.color.accent }[tone];
  return <View style={{ borderColor: color, borderWidth: 1, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}><T size="xs" weight="bold" color={color}>{label}</T></View>;
}
export const statusTone = (status: string) => (status === 'active' || status === 'done' || status === 'published' ? 'ok' : status === 'suspended' || status === 'rejected' ? 'danger' : status === 'open' || status === 'trial' || status === 'in_progress' || status === 'draft' ? 'warn' : 'muted') as 'ok' | 'warn' | 'danger' | 'muted';
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: SA.space.sm, flexWrap: 'wrap' }, style]}>{children}</View>; }
export function Heading({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SA.space.md, marginBottom: SA.space.lg, flexWrap: 'wrap' }}>
      <View style={{ flexShrink: 1 }}><T size="xl" weight="bold" testID="sa-title">{title}</T>{hint ? <T size="sm" color={SA.color.muted} style={{ marginTop: 4, maxWidth: 640 }}>{hint}</T> : null}</View>
      {right}
    </View>
  );
}
export function Sheet({ title, onClose, children, wide, testID }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; testID?: string }) {
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} visible>
      <View style={s.overlay}>
        <View testID={testID} style={[s.sheet, { maxWidth: wide ? 760 : 520 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SA.space.lg, borderBottomWidth: 1, borderColor: SA.color.line }}>
            <T size="lg" weight="bold">{title}</T>
            <Btn label="Close" kind="ghost" small onPress={onClose} />
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ padding: SA.space.lg }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}
/** Secret shown exactly once (a generated password). */
export function Secret({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ backgroundColor: SA.color.panel2, borderColor: SA.color.warn, borderWidth: 1, borderRadius: SA.radius.md, padding: SA.space.md, marginBottom: SA.space.md }}>
      <T size="xs" weight="bold" color={SA.color.warn} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label} - shown once, copy it now</T>
      <T selectable testID="sa-secret" weight="bold" style={{ marginTop: 6, ...(Platform.OS === 'web' ? { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } : {}) }}>{value}</T>
    </View>
  );
}
export function ErrorLine({ error }: { error: unknown }) { return error ? <T size="sm" color={SA.color.danger} testID="sa-error" style={{ marginBottom: SA.space.md }}>{typeof error === 'string' ? error : saMessage(error)}</T> : null; }
export function Empty({ children }: { children: React.ReactNode }) { return <View style={{ padding: SA.space.xl, alignItems: 'center' }}><T color={SA.color.muted}>{children}</T></View>; }
export function Loading() { return <View style={{ padding: SA.space.xxl, alignItems: 'center' }}><ActivityIndicator color={SA.color.accent} /></View>; }

/** Loads on mount and whenever `reload()` is called. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    // `loading` is true from the first render and after reload() (see below), so the effect itself never sets state synchronously.
    load().then(data => live && setState({ data, loading: false }), error => live && setState({ error, loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { ...state, reload: () => { setState(prev => ({ ...prev, loading: true })); setTick(n => n + 1); } };
}
export const ago = (at: number | null | undefined) => {
  if (!at) return 'never';
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
export const openUrl = (path: string) => { if (Platform.OS === 'web') (globalThis as any).window?.open?.(path, '_blank', 'noopener'); };

const s = StyleSheet.create({
  btn: { borderWidth: 1, borderRadius: SA.radius.md, alignItems: 'center', justifyContent: 'center', minHeight: 34 },
  input: { backgroundColor: SA.color.bg, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.md, color: SA.color.text, paddingHorizontal: SA.space.md, paddingVertical: 10, fontSize: SA.font.size.md },
  card: { backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.lg, padding: SA.space.lg, marginBottom: SA.space.md },
  overlay: { flex: 1, backgroundColor: SA.color.overlay, alignItems: 'center', justifyContent: 'center', padding: SA.space.lg },
  sheet: { width: '100%', maxHeight: '90%', backgroundColor: SA.color.panel, borderColor: SA.color.line, borderWidth: 1, borderRadius: SA.radius.lg, overflow: 'hidden' },
});
